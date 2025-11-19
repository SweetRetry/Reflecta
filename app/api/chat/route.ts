/**
 * Chat API Route - Production-Ready GPT-like Chatbot with Memory
 *
 * Features:
 * - Streaming responses using Vercel AI SDK
 * - Long-term memory with RAG (Retrieval-Augmented Generation)
 * - Reflective memory extraction using LangGraph
 * - Smart token management and context window optimization
 * - Rate limiting and request metrics
 * - Comprehensive error handling
 *
 * Endpoint:
 * - POST /api/chat: Send a message and get a streaming response
 */

import { AIMessage } from "@langchain/core/messages";
import { NextRequest, after } from "next/server";
import { chatConfig } from "@/lib/chat-config";
import { ChatValidator } from "@/lib/chat-validator";
import { getRateLimiter, RateLimiter } from "@/lib/rate-limiter";
import { MetricsCollector } from "@/lib/chat-metrics";
import { processMemoryInBackground } from "@/lib/chat-memory";
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
 * Main POST handler for chat requests
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
    if (!chatRequest.sessionId) {
      return createErrorResponse("sessionId is required", 400);
    }

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

    // Get conversation history and context with enhanced RAG
    const history = await getMemoryForSession(chatRequest.sessionId!);
    const embeddingConfig = chatConfig.getEmbeddingConfig();
    const contextMessages =
      embeddingConfig.enabled && embeddingConfig.enableRag
        ? await searchRelevantContextEnhanced(
            chatRequest.sessionId!,
            chatRequest.message
          )
        : [];

    // Create an SSE stream that processes LangGraph execution
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          const agentGraph = createChatAgentGraph();
          
          // Invoke the agent graph to get the response
          const result = await agentGraph.invoke({
            sessionId: chatRequest.sessionId!,
            currentMessage: chatRequest.message,
            messages: history.slice(-10),
            contextMessages,
          });

          const finalResponse = result.finalResponse || "";
          const thinking = result.thinking || "";

          // Stream the response token by token (simulate streaming)
          // Split by words and stream with small delays for better UX
          const words = finalResponse.split(/(\s+)/);
          let currentIndex = 0;

          for (const word of words) {
            if (word.trim()) {
              // Format as SSE chunk
              const chunk = JSON.stringify({
                content: word,
                thinking: currentIndex === 0 ? thinking : undefined,
              });
              controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));
              currentIndex++;
              
              // Small delay to simulate streaming (optional)
              await new Promise((resolve) => setTimeout(resolve, 10));
            } else {
              // Include whitespace
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: word })}\n\n`));
            }
          }

          // Send completion marker
          controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
          controller.close();

          // Post-response processing
          if (finalResponse && chatRequest.sessionId) {
            const tokensUsed = countMessagesTokens(
              [new AIMessage(finalResponse)],
              config.model
            );

            after(async () => {
              try {
                await processMemoryInBackground(
                  chatRequest.sessionId!,
                  chatRequest.message,
                  finalResponse
                );
              } catch (memoryError) {
                console.error(
                  "Error processing memory in background:",
                  memoryError
                );
              }
            });

            // Complete metrics tracking
            if (requestId) {
              MetricsCollector.completeRequest(requestId, tokensUsed);
              MetricsCollector.logMetrics(requestId);
            }
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
    console.error("Chat API error:", error);

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
