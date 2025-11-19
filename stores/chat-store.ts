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
 * - URL is the single source of truth for sessionId (not stored here)
 * - Transient state only: streaming content, temporary mode
 */
interface ChatState {
  // UI state (transient)
  isTemporaryMode: boolean;
  isStreaming: boolean;
  streamingContent: string;
  streamingThinking: string;
  pendingMessage: string | null;

  // Actions
  setIsTemporaryMode: (mode: boolean) => void;
  setIsStreaming: (isStreaming: boolean) => void;
  setStreamingContent: (content: string) => void;
  setStreamingThinking: (thinking: string) => void;
  setPendingMessage: (message: string | null) => void;
  clearStreaming: () => void;
  resetSession: () => void;
}

export const useChatStore = create<ChatState>()((set) => ({
  // Initial state
  isTemporaryMode: false,
  isStreaming: false,
  streamingContent: "",
  streamingThinking: "",
  pendingMessage: null,

  // Actions
  setIsTemporaryMode: (mode) =>
    set({ isTemporaryMode: mode }),

  setIsStreaming: (isStreaming) =>
    set({ isStreaming }),

  setStreamingContent: (content) =>
    set({ streamingContent: content }),

  setStreamingThinking: (thinking) =>
    set({ streamingThinking: thinking }),

  setPendingMessage: (message) =>
    set({ pendingMessage: message }),

  clearStreaming: () =>
    set({ streamingContent: "", streamingThinking: "", isStreaming: false }),

  resetSession: () =>
    set({
      isTemporaryMode: false,
      streamingContent: "",
      streamingThinking: "",
      isStreaming: false,
      pendingMessage: null,
    }),
}));
