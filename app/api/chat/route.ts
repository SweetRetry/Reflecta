/**
 * Optimized Chat API Route with comprehensive error handling,
 * rate limiting, monitoring, and production-ready features
 */

import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { NextRequest } from "next/server";
import { chatConfig } from "@/lib/chat-config";
import { ChatValidator } from "@/lib/chat-validator";
import { getRateLimiter, RateLimiter } from "@/lib/rate-limiter";
import { MetricsCollector } from "@/lib/chat-metrics";
import { ChatRequest, StreamChunk } from "@/lib/chat-types";

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
 * Convert history messages to LangChain message format
 */
function buildMessageHistory(request: ChatRequest) {
  const { history = [], message } = request;

  const messages = history
    .slice(-chatConfig.getModelConfig().maxHistoryLength!)
    .map((msg) => {
      const sanitizedContent = ChatValidator.sanitizeMessage(msg.content);

      if (msg.role === "user" || msg.role === "human") {
        return new HumanMessage(sanitizedContent);
      }
      if (msg.role === "assistant" || msg.role === "ai") {
        return new AIMessage(sanitizedContent);
      }
      // Default to user message
      return new HumanMessage(sanitizedContent);
    });

  // Add current message
  messages.push(new HumanMessage(ChatValidator.sanitizeMessage(message)));

  return messages;
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
    } catch (_error) {
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

    // Build message history
    const messages = buildMessageHistory(chatRequest);

    // Create streaming response
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        let tokensUsed = 0;

        try {
          // Get streaming response from model
          const streamResponse = await model.stream(messages);

          // Process chunks
          for await (const chunk of streamResponse) {
            const content = chunk.content;

            // Handle string content
            if (typeof content === "string" && content) {
              tokensUsed += content.length / 4; // Rough estimation
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
                  tokensUsed += stringItem.length / 4;
                  const sseData = createSSEData({ content: stringItem });
                  controller.enqueue(encoder.encode(sseData));
                }
              }
            }
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
 * GET handler to retrieve API statistics (optional)
 */
export async function GET() {
  try {
    const stats = MetricsCollector.getStatistics();

    return new Response(JSON.stringify(stats), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (_error) {
    return createErrorResponse("Failed to retrieve statistics", 500);
  }
}
