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
  currentSessionId: string | null,
  messages: ChatMessage[],
  options: SendMessageOptions = {}
) {
  const {
    isTemporaryMode,
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

          // Refresh sessions from server for existing sessions
          setTimeout(() => {
            refetchSessions();
          }, 500);
        } else {
          // Add new session (with placeholder title)
          // Title will be updated by onTitleUpdate callback when backend sends title-update event
          const firstUserMessage = messages.find((m) => m.role === "user");
          addSession({
            sessionId: currentSessionId,
            title: firstUserMessage?.content.substring(0, 100) || "New Chat",
            lastMessageTimestamp: Date.now(),
            messageCount: 2,
          });

          // Note: For new sessions, we don't refetch here because:
          // 1. onTitleUpdate will trigger invalidateQueries which auto-refetches
          // 2. This avoids a race condition where we fetch before title is generated
        }
      }
    },
    onTitleUpdate: (title) => {
      // Update session title when received from backend
      if (!isTemporaryMode && currentSessionId) {
        console.log(`[Title Update] Session ${currentSessionId}: "${title}"`);
        updateSession({
          sessionId: currentSessionId,
          updates: {
            title,
          },
        });
      }
    },
    onError: (_error) => {
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
