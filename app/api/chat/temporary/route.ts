/**
 * Temporary Chat API Route - No Memory or Persistence
 *
 * Features:
 * - Streaming responses using Vercel AI SDK
 * - NO long-term memory or RAG
 * - NO database persistence
 * - Messages exist only in client memory
 * - Rate limiting and request metrics
 * - Comprehensive error handling
 *
 * Endpoint:
 * - POST /api/chat/temporary: Send a message and get a streaming response
 */

import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { NextRequest } from "next/server";
import { chatConfig } from "@/lib/chat-config";
import { ChatValidator } from "@/lib/chat-validator";
import { getRateLimiter, RateLimiter } from "@/lib/rate-limiter";
import { MetricsCollector } from "@/lib/chat-metrics";
import { createChatAgentGraph } from "@/lib/agents/chat-agent-graph";

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
 * Main POST handler for temporary chat requests
 */
export async function POST(req: NextRequest) {
  let requestId: string | null = null;
  const config = chatConfig.getModelConfig();

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

    // Parse and validate request body
    const requestData = await req.json();
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
      const retryAfter = Math.ceil((rateLimitResult.resetTime - Date.now()) / 1000);
      return new Response(JSON.stringify({ error: "Rate limit exceeded", retryAfter }), {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": retryAfter.toString(),
        },
      });
    }

    // Start metrics tracking
    requestId = MetricsCollector.startRequest(config.model, chatRequest.userId);

    // --- Streaming Logic using LangGraph and AI SDK v5 ---

    // Parse conversation history from request (if provided)
    // Expected format: [{ role: "user" | "assistant", content: string }, ...]
    const conversationHistory = requestData.history || [];
    const history = conversationHistory.map((msg: { role: string; content: string }) => {
      if (msg.role === "user") {
        return new HumanMessage(msg.content);
      } else {
        return new AIMessage(msg.content);
      }
    });

    // Create an SSE stream that processes LangGraph execution
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          const agentGraph = createChatAgentGraph();

          // Use streamEvents to get real-time updates from the graph
          // NOTE: No sessionId for temporary chat, no context messages (no RAG)
          const eventStream = agentGraph.streamEvents(
            {
              sessionId: "temporary", // Use a placeholder, won't be persisted
              currentMessage: chatRequest.message,
              messages: history.slice(-10), // Keep last 10 messages for context
              contextMessages: [], // No RAG context for temporary chat
            },
            {
              version: "v2",
            }
          );

          let finalResponse = "";

          for await (const event of eventStream) {
            // Handle LLM streaming events
            if (event.event === "on_chat_model_stream") {
              // Check if this event is from the final response node
              if (event.metadata?.langgraph_node === "respond") {
                const chunk = event.data.chunk;

                if (chunk.content) {
                  // Handle text content
                  if (typeof chunk.content === "string") {
                    const content = chunk.content;
                    finalResponse += content;

                    const sseChunk = JSON.stringify({
                      content: content,
                    });
                    controller.enqueue(encoder.encode(`data: ${sseChunk}\n\n`));
                  } else if (Array.isArray(chunk.content)) {
                    // Handle complex content (e.g. thinking blocks)
                    for (const block of chunk.content) {
                      if (block.type === "text") {
                        finalResponse += block.text;
                        const sseChunk = JSON.stringify({
                          content: block.text,
                        });
                        controller.enqueue(encoder.encode(`data: ${sseChunk}\n\n`));
                      } else if (block.type === "thinking") {
                        const sseChunk = JSON.stringify({
                          thinking: block.thinking,
                        });
                        controller.enqueue(encoder.encode(`data: ${sseChunk}\n\n`));
                      }
                    }
                  }
                }
              }
            }
          }

          // Send completion marker
          controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
          controller.close();

          // Complete metrics tracking (no memory processing for temporary chat)
          if (requestId && finalResponse) {
            const tokensUsed = history.length * 100 + finalResponse.length / 4; // Rough estimate
            MetricsCollector.completeRequest(requestId, tokensUsed);
            MetricsCollector.logMetrics(requestId);
          }
        } catch (error) {
          console.error("Stream error:", error);
          const errorMessage =
            error instanceof Error ? error.message : "Unknown error";
          const errorChunk = JSON.stringify({ error: errorMessage });
          controller.enqueue(encoder.encode(`data: ${errorChunk}\n\n`));
          controller.close();

          if (requestId) {
            MetricsCollector.completeRequest(requestId, 0, errorMessage);
            MetricsCollector.logMetrics(requestId);
          }
        }
      },
    });

    // Return SSE stream response
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-RateLimit-Remaining": rateLimitResult.remaining.toString(),
        "X-RateLimit-Reset": new Date(rateLimitResult.resetTime).toISOString(),
        "X-Request-ID": requestId || "unknown",
      },
    });

  } catch (error) {
    console.error("Temporary chat API error:", error);

    // Track error in metrics if a request ID was generated
    if (requestId) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      MetricsCollector.completeRequest(requestId, 0, errorMessage);
      MetricsCollector.logMetrics(requestId);
    }

    if (error instanceof Error) {
        return createErrorResponse(error.message, 500);
    }

    return createErrorResponse("Internal server error", 500);
  }
}
