import { create } from "zustand";

/**
 * Chat session metadata
 */
export interface ChatSession {
  sessionId: string;
  title: string;
  lastMessageTimestamp: number;
  messageCount: number;
}

/**
 * Individual chat message
 */
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  thinking?: string;
}

/**
 * Chat store state
 *
 * Design decisions:
 * - No persistence: URL is the single source of truth for currentSessionId
 * - Transient state only: streaming content, temporary mode
 * - Store syncs with URL, but URL controls session navigation
 */
interface ChatState {
  // Session state (derived from URL, not persisted)
  currentSessionId: string | null;
  isTemporaryMode: boolean;

  // UI state (transient)
  streamingContent: string;
  streamingThinking: string;

  // Actions
  setCurrentSessionId: (sessionId: string | null) => void;
  setIsTemporaryMode: (mode: boolean) => void;
  setStreamingContent: (content: string) => void;
  setStreamingThinking: (thinking: string) => void;
  clearStreaming: () => void;
  resetSession: () => void;
}

export const useChatStore = create<ChatState>()((set) => ({
  // Initial state
  currentSessionId: null,
  isTemporaryMode: false,
  streamingContent: "",
  streamingThinking: "",

  // Actions
  setCurrentSessionId: (sessionId) =>
    set({ currentSessionId: sessionId }),

  setIsTemporaryMode: (mode) =>
    set({ isTemporaryMode: mode }),

  setStreamingContent: (content) =>
    set({ streamingContent: content }),

  setStreamingThinking: (thinking) =>
    set({ streamingThinking: thinking }),

  clearStreaming: () =>
    set({ streamingContent: "", streamingThinking: "" }),

  resetSession: () =>
    set({
      currentSessionId: null,
      isTemporaryMode: false,
      streamingContent: "",
      streamingThinking: ""
    }),
}));
