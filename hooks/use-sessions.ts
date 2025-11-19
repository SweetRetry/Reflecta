import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChatSession } from "@/stores/chat-store";

export const SESSIONS_QUERY_KEY = ["sessions"];

interface SessionsResponse {
  sessions: ChatSession[];
}

/**
 * Custom hook to manage chat sessions using React Query
 */
export function useSessions() {
  const queryClient = useQueryClient();

  // Fetch sessions
  const {
    data,
    isLoading,
    error,
    refetch
  } = useQuery<SessionsResponse>({
    queryKey: SESSIONS_QUERY_KEY,
    queryFn: async () => {
      const response = await fetch("/api/sessions");
      if (!response.ok) {
        throw new Error("Failed to fetch sessions");
      }
      return response.json();
    },
    staleTime: 30000, // 30 seconds
    refetchOnWindowFocus: true,
  });

  // Optimistically update session
  const updateSession = useMutation({
    mutationFn: async ({
      sessionId,
      updates,
    }: {
      sessionId: string;
      updates: Partial<ChatSession>;
    }) => {
      // This is just for optimistic updates
      return { sessionId, updates };
    },
    onMutate: async ({ sessionId, updates }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: SESSIONS_QUERY_KEY });

      // Snapshot the previous value
      const previousSessions = queryClient.getQueryData<SessionsResponse>(
        SESSIONS_QUERY_KEY
      );

      // Optimistically update
      if (previousSessions) {
        queryClient.setQueryData<SessionsResponse>(SESSIONS_QUERY_KEY, {
          sessions: previousSessions.sessions.map((s) =>
            s.sessionId === sessionId ? { ...s, ...updates } : s
          ),
        });
      }

      return { previousSessions };
    },
    onError: (_err, _variables, context) => {
      // Rollback on error
      if (context?.previousSessions) {
        queryClient.setQueryData(SESSIONS_QUERY_KEY, context.previousSessions);
      }
    },
    onSettled: () => {
      // Refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY });
    },
  });

  // Add new session optimistically
  const addSession = useMutation({
    mutationFn: async (newSession: ChatSession) => {
      return newSession;
    },
    onMutate: async (newSession) => {
      await queryClient.cancelQueries({ queryKey: SESSIONS_QUERY_KEY });

      const previousSessions = queryClient.getQueryData<SessionsResponse>(
        SESSIONS_QUERY_KEY
      );

      if (previousSessions) {
        queryClient.setQueryData<SessionsResponse>(SESSIONS_QUERY_KEY, {
          sessions: [newSession, ...previousSessions.sessions],
        });
      }

      return { previousSessions };
    },
    onError: (_err, _variables, context) => {
      if (context?.previousSessions) {
        queryClient.setQueryData(SESSIONS_QUERY_KEY, context.previousSessions);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY });
    },
  });

  // Delete session optimistically
  const deleteSession = useMutation({
    mutationFn: async (sessionId: string) => {
      const response = await fetch(`/api/sessions/${sessionId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to delete session");
      }

      return response.json();
    },
    onMutate: async (sessionId) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: SESSIONS_QUERY_KEY });

      // Snapshot the previous value
      const previousSessions = queryClient.getQueryData<SessionsResponse>(
        SESSIONS_QUERY_KEY
      );

      // Optimistically remove the session
      if (previousSessions) {
        queryClient.setQueryData<SessionsResponse>(SESSIONS_QUERY_KEY, {
          sessions: previousSessions.sessions.filter(
            (s) => s.sessionId !== sessionId
          ),
        });
      }

      return { previousSessions };
    },
    onError: (_err, _variables, context) => {
      // Rollback on error
      if (context?.previousSessions) {
        queryClient.setQueryData(SESSIONS_QUERY_KEY, context.previousSessions);
      }
    },
    onSettled: () => {
      // Refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY });
    },
  });

  return {
    sessions: data?.sessions ?? [],
    isLoading,
    error,
    refetch,
    updateSession: updateSession.mutate,
    addSession: addSession.mutate,
    deleteSession: deleteSession.mutateAsync,
  };
}
