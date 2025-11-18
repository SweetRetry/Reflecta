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

import { AIMessage } from "@langchain/core/messages";
import { NextRequest, after } from "next/server";
import { chatConfig } from "@/lib/chat-config";
import { ChatValidator } from "@/lib/chat-validator";
import { getRateLimiter, RateLimiter } from "@/lib/rate-limiter";
import { MetricsCollector } from "@/lib/chat-metrics";
import { StreamChunk, ChatHistoryMessage, SessionSummary } from "@/lib/chat-types";
import {
  processMemoryInBackground,
  getHistoryWithTimestamps,
  getRecentSessions
} from "@/lib/chat-memory";
import { countMessagesTokens } from "@/lib/token-manager";
import { createChatAgentGraph } from "@/lib/agents/chat-agent-graph";
import { getMemoryForSession } from "@/lib/chat-memory";
import { searchRelevantContextEnhanced } from "@/lib/memory/memory-rag-enhanced";

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

    // Create streaming response
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        let tokensUsed = 0;

        try {
          let accumulatedResponse = "";

          // --- Use Chat Agent Graph (with intelligent task planning and tool calling) ---
          console.log("[Chat Agent] Processing request with enhanced agent graph...");

          // Get conversation history and context with enhanced RAG
          const history = await getMemoryForSession(chatRequest.sessionId!);
          const embeddingConfig = chatConfig.getEmbeddingConfig();

          const contextMessages = embeddingConfig.enabled && embeddingConfig.enableRag
            ? await searchRelevantContextEnhanced(chatRequest.sessionId!, chatRequest.message)
            : [];

          // Invoke agent graph with planning and tool execution
          const agentGraph = createChatAgentGraph();
          const result = await agentGraph.invoke({
            sessionId: chatRequest.sessionId!,
            currentMessage: chatRequest.message,
            messages: history.slice(-10), // Last 10 messages for context
            contextMessages,
          });

          accumulatedResponse = result.finalResponse;
          const thinking = result.thinking || "";

          // Stream thinking first (if available)
          if (thinking) {
            const thinkingData = createSSEData({ thinking });
            controller.enqueue(encoder.encode(thinkingData));
            // Small delay before streaming actual response
            await new Promise(resolve => setTimeout(resolve, 100));
          }

          // Stream the complete response
          // Split into chunks for progressive display
          const chunkSize = 50;
          for (let i = 0; i < accumulatedResponse.length; i += chunkSize) {
            const chunk = accumulatedResponse.substring(i, i + chunkSize);
            const sseData = createSSEData({ content: chunk });
            controller.enqueue(encoder.encode(sseData));
            // Small delay for better UX (simulates typing)
            await new Promise(resolve => setTimeout(resolve, 20));
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
