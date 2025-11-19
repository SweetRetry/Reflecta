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
import { createChatAgentGraph, determineUserIntent } from "@/lib/agents/chat-agent-graph";
import { getMemoryForSession } from "@/lib/chat-memory";
import { searchRelevantContextEnhanced } from "@/lib/memory/memory-rag-enhanced";
import { isNewSession, updateSessionTitle } from "@/lib/memory/memory-storage";
import { generateSessionTitle } from "@/lib/title-generator";

// Validate configuration once at module initialization
const configValidation = chatConfig.validateConfiguration();
if (!configValidation.valid) {
  console.error("Configuration errors:", configValidation.errors);
  throw new Error(`Configuration error: ${configValidation.errors.join(", ")}`);
}

// Initialize rate limiter once at module initialization
const rateLimiter = getRateLimiter(chatConfig.getRateLimitConfig());

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

    // Create an SSE stream that processes LangGraph execution
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          // Send initial status to improve perceived performance
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ event: "status-update", status: "analyzing" })}\n\n`));

          // Parallel database queries for optimal performance moved INSIDE stream
          // This ensures TTFB (Time to First Byte) is instant, while data loading happens
          // - history: limited to last 10 messages (reduces memory and improves performance)
          // - isNew: check if session is new (for title generation)
          // - contextMessages: RAG-based context search (only if enabled)
          // - toolCall: Parallelized intent determination (Planning)
          const embeddingConfig = chatConfig.getEmbeddingConfig();
          const [history, isNew, contextMessages, toolCall] = await Promise.all([
            getMemoryForSession(chatRequest.sessionId!, 10), // Limit to last 10 messages
            isNewSession(chatRequest.sessionId!),
            embeddingConfig.enabled && embeddingConfig.enableRag
              ? searchRelevantContextEnhanced(chatRequest.sessionId!, chatRequest.message)
              : Promise.resolve([]),
            // Parallelize intent determination with RAG
            determineUserIntent(chatRequest.message)
          ]);

          // Update status before generation
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ event: "status-update", status: "generating" })}\n\n`));

          const agentGraph = createChatAgentGraph();
          
          // Use streamEvents to get real-time updates from the graph
          const eventStream = agentGraph.streamEvents(
            {
              sessionId: chatRequest.sessionId!,
              currentMessage: chatRequest.message,
              messages: history, // Already limited to 10 messages in query
              contextMessages,
              toolCall, // Inject the pre-calculated plan
            },
            {
              version: "v2",
            }
          );

          let finalResponse = "";
          let thinking = ""; // Accumulate thinking content

          for await (const event of eventStream) {
            // Handle LLM streaming events
            if (event.event === "on_chat_model_stream") {
              // Check if this event is from the final response node
              // We filter by node name to avoid streaming tool outputs or planning steps
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
                      if (block.type === "text" && block.text !== undefined) {
                        finalResponse += block.text;
                        const sseChunk = JSON.stringify({
                          content: block.text,
                        });
                        controller.enqueue(encoder.encode(`data: ${sseChunk}\n\n`));
                      } else if (block.type === "thinking" && block.thinking !== undefined) {
                        thinking += block.thinking;
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

          /**
           * Title Generation Strategy: Non-blocking Wait Pattern
           *
           * Why this approach (vs. fully async after()):
           * 1. User has already received all content (streaming complete)
           * 2. Waiting for title doesn't block content reading
           * 3. SSE push provides instant UI update (better UX than polling)
           * 4. Timeout protection (5s) prevents indefinite waiting
           *
           * Flow:
           * - Content streaming: DONE (user can read)
           * - Title generation: ~1-2s (background)
           * - SSE push: title-update event
           * - Connection close: [DONE] + close()
           *
           * Trade-off: SSE connection stays open 1-5s longer, but no UI blocking
           */
          if (isNew && finalResponse && chatRequest.sessionId) {
            const titleGenerationPromise = (async () => {
              try {
                const generatedTitle = await generateSessionTitle(
                  chatRequest.message,
                  finalResponse
                );
                await updateSessionTitle(chatRequest.sessionId!, generatedTitle);

                // Send title update event to frontend via SSE
                const titleEvent = JSON.stringify({
                  event: "title-update",
                  title: generatedTitle,
                });
                controller.enqueue(encoder.encode(`data: ${titleEvent}\n\n`));
              } catch (titleError) {
                console.error("Error generating session title:", titleError);
                // Gracefully degrade: connection closes normally without title
              }
            })();

            // Wait for title with timeout protection (max 5 seconds)
            await Promise.race([
              titleGenerationPromise,
              new Promise((resolve) => setTimeout(resolve, 5000)),
            ]);
          }

          // Send completion marker and close stream
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
                  finalResponse,
                  thinking
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
