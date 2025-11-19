import { useState, useCallback } from "react";
import { useChatStore, ChatMessage } from "@/stores/chat-store";

interface StreamingOptions {
  onComplete?: (message: ChatMessage) => void;
  onError?: (error: Error) => void;
  onTitleUpdate?: (title: string) => void;
}

/**
 * Custom hook to handle streaming chat responses
 */
export function useStreamingResponse(options: StreamingOptions = {}) {
  const [isStreaming, setIsStreaming] = useState(false);
  const {
    streamingContent,
    streamingThinking,
    setStreamingContent,
    setStreamingThinking,
    clearStreaming,
  } = useChatStore();

  const processStream = useCallback(
    async (
      endpoint: string,
      payload: Record<string, unknown>
    ): Promise<ChatMessage | null> => {
      setIsStreaming(true);
      clearStreaming();

      let accumulatedContent = "";
      let accumulatedThinking = "";

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        if (!reader) {
          throw new Error("No response body");
        }

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          // Decode chunk and add to buffer
          const chunk = decoder.decode(value, { stream: true });
          buffer += chunk;

          // Split by double newline (SSE event separator)
          const events = buffer.split("\n\n");

          // Keep the last incomplete event in buffer
          buffer = events.pop() || "";

          // Process complete events
          for (const event of events) {
            if (!event.trim()) continue;

            const lines = event.split("\n");
            for (const line of lines) {
              if (line.startsWith("data: ")) {
                const data = line.slice(6).trim();

                // Handle completion marker
                if (data === "[DONE]") {
                  const completedMessage: ChatMessage = {
                    role: "assistant",
                    content: accumulatedContent,
                    timestamp: new Date(),
                    thinking: accumulatedThinking || undefined,
                  };

                  clearStreaming();
                  setIsStreaming(false);

                  if (options.onComplete) {
                    options.onComplete(completedMessage);
                  }

                  return completedMessage;
                }

                // Parse JSON data
                try {
                  const parsed = JSON.parse(data);

                  // Handle title update event
                  if (parsed.event === "title-update" && parsed.title) {
                    if (options.onTitleUpdate) {
                      options.onTitleUpdate(parsed.title);
                    }
                  }

                  if (parsed.thinking) {
                    accumulatedThinking += parsed.thinking;
                    setStreamingThinking(accumulatedThinking);
                  }

                  if (parsed.content) {
                    accumulatedContent += parsed.content;
                    setStreamingContent(accumulatedContent);
                  }

                  if (parsed.error) {
                    throw new Error(parsed.error);
                  }
                } catch (e) {
                  if (
                    e instanceof Error &&
                    e.message !== "Unexpected end of JSON input"
                  ) {
                    console.error("Parse error:", e, "Raw data:", data);
                  }
                }
              }
            }
          }
        }

        // If we reach here without [DONE], create message from accumulated content
        if (accumulatedContent) {
          const completedMessage: ChatMessage = {
            role: "assistant",
            content: accumulatedContent,
            timestamp: new Date(),
            thinking: accumulatedThinking || undefined,
          };

          if (options.onComplete) {
            options.onComplete(completedMessage);
          }

          return completedMessage;
        }

        return null;
      } catch (error) {
        console.error("Streaming error:", error);
        const errorObj = error instanceof Error ? error : new Error(String(error));

        if (options.onError) {
          options.onError(errorObj);
        }

        clearStreaming();
        setIsStreaming(false);
        throw errorObj;
      } finally {
        setIsStreaming(false);
      }
    },
    [
      clearStreaming,
      setStreamingContent,
      setStreamingThinking,
      options,
    ]
  );

  return {
    isStreaming,
    streamingContent,
    streamingThinking,
    processStream,
  };
}
