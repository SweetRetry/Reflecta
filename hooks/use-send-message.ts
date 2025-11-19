import { useCallback } from "react";
import { nanoid } from "nanoid";
import { useChatStore, ChatMessage } from "@/stores/chat-store";
import { useChatMessages } from "./use-chat";
import { useStreamingResponse } from "./use-streaming";
import { useSessions } from "./use-sessions";

interface SendMessageOptions {
  onSessionCreated?: (sessionId: string) => void;
  onMessageSent?: () => void;
}

/**
 * Custom hook to handle sending chat messages
 */
export function useSendMessage(
  messages: ChatMessage[],
  options: SendMessageOptions = {}
) {
  const {
    currentSessionId,
    isTemporaryMode,
    setCurrentSessionId,
  } = useChatStore();

  const { addMessage } = useChatMessages(currentSessionId);
  const { addSession, updateSession, refetch: refetchSessions } = useSessions();

  const { processStream, isStreaming } = useStreamingResponse({
    onComplete: (assistantMessage) => {
      // Add assistant message to cache
      addMessage(assistantMessage);

      // Update sessions in non-temporary mode
      if (!isTemporaryMode && currentSessionId) {
        const existingSession = messages.length > 0;

        if (existingSession) {
          // Update existing session
          updateSession({
            sessionId: currentSessionId,
            updates: {
              lastMessageTimestamp: Date.now(),
              messageCount: messages.length + 2, // +2 for user and assistant
            },
          });
        } else {
          // Add new session
          const firstUserMessage = messages.find((m) => m.role === "user");
          addSession({
            sessionId: currentSessionId,
            title: firstUserMessage?.content.substring(0, 100) || "New Chat",
            lastMessageTimestamp: Date.now(),
            messageCount: 2,
          });
        }

        // Refresh sessions from server
        setTimeout(() => {
          refetchSessions();
        }, 500);
      }
    },
    onError: (error) => {
      // Add error message
      addMessage({
        role: "assistant",
        content: "Sorry, an error occurred. Please try again.",
        timestamp: new Date(),
      });
    },
  });

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isStreaming) return;

      // Create session ID if needed
      let sessionId = currentSessionId;
      if (!isTemporaryMode && !sessionId) {
        sessionId = nanoid();
        setCurrentSessionId(sessionId);

        if (options.onSessionCreated) {
          options.onSessionCreated(sessionId);
        }
      }

      // Add user message
      const userMessage: ChatMessage = {
        role: "user",
        content: text,
        timestamp: new Date(),
      };
      addMessage(userMessage);

      // Prepare API request
      const endpoint = isTemporaryMode ? "/api/chat/temporary" : "/api/chat";
      const payload = isTemporaryMode
        ? {
            message: text,
            history: messages.map((msg) => ({
              role: msg.role,
              content: msg.content,
            })),
          }
        : {
            message: text,
            sessionId: sessionId,
          };

      // Process streaming response
      await processStream(endpoint, payload);

      if (options.onMessageSent) {
        options.onMessageSent();
      }
    },
    [
      currentSessionId,
      isTemporaryMode,
      isStreaming,
      messages,
      setCurrentSessionId,
      addMessage,
      processStream,
      options,
    ]
  );

  return {
    sendMessage,
    isLoading: isStreaming,
  };
}
