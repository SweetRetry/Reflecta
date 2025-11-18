/**
 * Chat API Route - Production-Ready GPT-like Chatbot with Memory
 *
 * Features:
 * - Streaming responses with Server-Sent Events (SSE)
 * - Long-term memory with RAG (Retrieval-Augmented Generation)
 * - Reflective memory extraction using LangGraph
 * - Smart token management and context window optimization
 * - Rate limiting and request metrics
 * - Comprehensive error handling
 *
 * Endpoints:
 * - POST /api/chat: Send a message and get streaming response
 * - GET /api/chat?sessionId={id}: Get chat history
 * - GET /api/chat?listSessions=true: List all sessions
 */

import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { NextRequest, after } from "next/server";
import { chatConfig } from "@/lib/chat-config";
import { ChatValidator } from "@/lib/chat-validator";
import { getRateLimiter, RateLimiter } from "@/lib/rate-limiter";
import { MetricsCollector } from "@/lib/chat-metrics";
import { ChatRequest, StreamChunk, ChatHistoryMessage, SessionSummary } from "@/lib/chat-types";
import {
  buildMessagesWithMemory,
  processMemoryInBackground,
  getHistoryWithTimestamps,
  getRecentSessions,
} from "@/lib/chat-memory";
import { countMessagesTokens } from "@/lib/token-manager";

// Initialize rate limiter
let rateLimiter: RateLimiter;

/**
 * Helper function to create error responses
 */
function createErrorResponse(message: string, status: number = 500): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Helper function to create SSE data
 */
function createSSEData(chunk: StreamChunk): string {
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

/**
 * Build messages using LangChain memory
 * This function retrieves conversation history from memory and adds the current message
 */
async function buildMessageHistory(
  request: ChatRequest
): Promise<Array<HumanMessage | AIMessage>> {
  const { message, sessionId } = request;

  if (!sessionId) {
    throw new Error("sessionId is required for memory management");
  }

  // Build messages from memory (includes history + current message)
  const messages = await buildMessagesWithMemory(sessionId, message);
  return messages as Array<HumanMessage | AIMessage>;
}

/**
 * Initialize and get model instance
 */
function getModelInstance(): ChatAnthropic {
  const config = chatConfig.getModelConfig();
  const baseUrl = chatConfig.getBaseUrl();

  return new ChatAnthropic({
    model: config.model,
    maxTokens: config.maxTokens,
    temperature: config.temperature,
    topP: config.topP,
    anthropicApiKey: chatConfig.getApiKey(),
    ...(baseUrl && {
      configuration: {
        baseURL: baseUrl,
      },
    }),
  });
}

/**
 * Main POST handler for chat requests
 */
export async function POST(req: NextRequest) {
  let requestId: string | null = null;

  try {
    // Validate configuration on first request
    const configValidation = chatConfig.validateConfiguration();
    if (!configValidation.valid) {
      console.error("Configuration errors:", configValidation.errors);
      return createErrorResponse(
        `Configuration error: ${configValidation.errors.join(", ")}`,
        500
      );
    }

    // Initialize rate limiter if not already initialized
    if (!rateLimiter) {
      rateLimiter = getRateLimiter(chatConfig.getRateLimitConfig());
    }

    // Parse request body
    let requestData: unknown;
    try {
      requestData = await req.json();
    } catch {
      return createErrorResponse("Invalid JSON in request body", 400);
    }

    // Validate request
    const validation = ChatValidator.validateRequest(requestData);
    if (!validation.valid) {
      return createErrorResponse(
        `Validation error: ${validation.errors
          .map((e) => `${e.field}: ${e.message}`)
          .join(", ")}`,
        400
      );
    }

    const chatRequest = validation.sanitized!;

    // Validate sessionId is provided
    if (!chatRequest.sessionId) {
      return createErrorResponse("sessionId is required", 400);
    }

    // Rate limiting
    const identifier = RateLimiter.getIdentifier(req, chatRequest.userId);
    const rateLimitResult = rateLimiter.checkLimit(identifier);

    if (!rateLimitResult.allowed) {
      const retryAfter = Math.ceil(
        (rateLimitResult.resetTime - Date.now()) / 1000
      );
      return new Response(
        JSON.stringify({
          error: "Rate limit exceeded",
          retryAfter,
        }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": retryAfter.toString(),
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": new Date(
              rateLimitResult.resetTime
            ).toISOString(),
          },
        }
      );
    }

    // Start metrics tracking
    const config = chatConfig.getModelConfig();
    requestId = MetricsCollector.startRequest(config.model, chatRequest.userId);

    // Initialize model
    const model = getModelInstance();

    // Build message history from memory
    const messages = await buildMessageHistory(chatRequest);

    // Create streaming response
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        let tokensUsed = 0;

        try {
          // Get streaming response from model
          const streamResponse = await model.stream(messages);

          let accumulatedResponse = "";

          // Process chunks
          for await (const chunk of streamResponse) {
            const content = chunk.content;

            // Handle string content
            if (typeof content === "string" && content) {
              accumulatedResponse += content;
              const sseData = createSSEData({ content });
              controller.enqueue(encoder.encode(sseData));
            }
            // Handle array content
            else if (Array.isArray(content)) {
              for (const item of content) {
                // Type guard for string items
                const stringItem =
                  typeof item === "object" && item !== null && "text" in item
                    ? String(item.text)
                    : typeof item === "string"
                    ? item
                    : null;

                if (stringItem) {
                  accumulatedResponse += stringItem;
                  const sseData = createSSEData({ content: stringItem });
                  controller.enqueue(encoder.encode(sseData));
                }
              }
            }
          }

          // Calculate accurate token count after streaming completes
          if (accumulatedResponse) {
            const aiMessage = new AIMessage(accumulatedResponse);
            tokensUsed = countMessagesTokens([aiMessage], config.model);
          }

          // Save conversation to memory asynchronously after response is sent
          if (accumulatedResponse && chatRequest.sessionId) {
            const sessionId = chatRequest.sessionId;
            const message = chatRequest.message;
            const response = accumulatedResponse;

            after(async () => {
              try {
                await processMemoryInBackground(sessionId, message, response);
              } catch (memoryError) {
                console.error("Error processing memory in background:", memoryError);
              }
            });
          }

          // Send completion marker
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));

          // Complete metrics tracking
          if (requestId) {
            MetricsCollector.completeRequest(requestId, tokensUsed);
            MetricsCollector.logMetrics(requestId);
          }

          controller.close();
        } catch (error) {
          console.error("Streaming error:", error);

          // Send error through stream
          const errorMessage =
            error instanceof Error ? error.message : "Streaming error occurred";
          const errorData = createSSEData({ error: errorMessage });
          controller.enqueue(encoder.encode(errorData));

          // Track error in metrics
          if (requestId) {
            MetricsCollector.completeRequest(
              requestId,
              tokensUsed,
              errorMessage
            );
            MetricsCollector.logMetrics(requestId);
          }

          controller.close();
        }
      },
    });

    // Return SSE response with proper headers
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-RateLimit-Remaining": rateLimitResult.remaining.toString(),
        "X-RateLimit-Reset": new Date(rateLimitResult.resetTime).toISOString(),
        "X-Request-ID": requestId || "unknown",
      },
    });
  } catch (error) {
    console.error("Chat API error:", error);

    // Track error in metrics
    if (requestId) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      MetricsCollector.completeRequest(requestId, 0, errorMessage);
      MetricsCollector.logMetrics(requestId);
    }

    // Determine appropriate error response
    if (error instanceof Error) {
      if (error.message.includes("API key")) {
        return createErrorResponse("Authentication error", 401);
      }
      if (error.message.includes("timeout")) {
        return createErrorResponse("Request timeout", 504);
      }
      return createErrorResponse(error.message, 500);
    }

    return createErrorResponse("Internal server error", 500);
  }
}

/**
 * GET handler to retrieve chat history, sessions list, or API statistics
 *
 * Query parameters:
 * - ?listSessions=true: Get all recent sessions
 * - ?sessionId={id}: Get chat history for a specific session
 * - (none): Get API statistics
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const sessionId = searchParams.get("sessionId");
    const listSessions = searchParams.get("listSessions");

    // If listSessions is true, return recent sessions
    if (listSessions === "true") {
      try {
        const sessions: SessionSummary[] = await getRecentSessions();
        return new Response(JSON.stringify({ sessions }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      } catch (error) {
        console.error("Error loading sessions:", error);
        return createErrorResponse(
          error instanceof Error ? error.message : "Failed to load sessions",
          500
        );
      }
    }

    // If sessionId is provided, return chat history
    if (sessionId) {
      try {
        const history: ChatHistoryMessage[] = await getHistoryWithTimestamps(sessionId);

        return new Response(JSON.stringify({ messages: history }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      } catch (error) {
        console.error("Error loading history:", error);
        return createErrorResponse(
          error instanceof Error ? error.message : "Failed to load history",
          500
        );
      }
    }

    // Otherwise, return API statistics
    const stats = MetricsCollector.getStatistics();

    return new Response(JSON.stringify(stats), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("GET handler error:", error);
    return createErrorResponse("Failed to process request", 500);
  }
}
