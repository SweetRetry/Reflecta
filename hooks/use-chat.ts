import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChatMessage } from "@/stores/chat-store";

export const MESSAGES_QUERY_KEY = (sessionId: string | null) => [
  "messages",
  sessionId,
];

interface MessagesResponse {
  messages: Array<{
    role: string;
    content: string;
    thinking?: string;
    timestamp?: number;
  }>;
}

/**
 * Custom hook to manage chat messages for a session
 */
export function useChatMessages(sessionId: string | null, enabled = true) {
  const queryClient = useQueryClient();

  const {
    data,
    isLoading,
    error
  } = useQuery<ChatMessage[]>({
    queryKey: MESSAGES_QUERY_KEY(sessionId),
    queryFn: async () => {
      if (!sessionId) return [];

      const response = await fetch(`/api/sessions/${sessionId}/messages`);
      if (!response.ok) {
        throw new Error(`Failed to fetch messages: ${response.status}`);
      }

      const data: MessagesResponse = await response.json();
      return (data.messages || []).map((msg) => ({
        role: msg.role as "user" | "assistant",
        content: msg.content,
        thinking: msg.thinking,
        timestamp: msg.timestamp ? new Date(msg.timestamp) : new Date(),
      }));
    },
    enabled: enabled && !!sessionId,
    staleTime: Infinity, // Messages don't change unless we mutate them
  });

  // Add message optimistically
  const addMessage = useMutation({
    mutationFn: async (message: ChatMessage) => {
      return message;
    },
    onMutate: async (newMessage) => {
      await queryClient.cancelQueries({
        queryKey: MESSAGES_QUERY_KEY(sessionId),
      });

      const previousMessages = queryClient.getQueryData<ChatMessage[]>(
        MESSAGES_QUERY_KEY(sessionId)
      );

      if (previousMessages) {
        queryClient.setQueryData<ChatMessage[]>(
          MESSAGES_QUERY_KEY(sessionId),
          [...previousMessages, newMessage]
        );
      } else {
        queryClient.setQueryData<ChatMessage[]>(
          MESSAGES_QUERY_KEY(sessionId),
          [newMessage]
        );
      }

      return { previousMessages };
    },
    onError: (err, variables, context) => {
      if (context?.previousMessages) {
        queryClient.setQueryData(
          MESSAGES_QUERY_KEY(sessionId),
          context.previousMessages
        );
      }
    },
  });

  // Clear messages for a session
  const clearMessages = () => {
    queryClient.setQueryData<ChatMessage[]>(MESSAGES_QUERY_KEY(sessionId), []);
  };

  return {
    messages: data ?? [],
    isLoading,
    error,
    addMessage: addMessage.mutate,
    clearMessages,
  };
}
