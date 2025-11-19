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
  streamingContent: string;
  streamingThinking: string;

  // Actions
  setIsTemporaryMode: (mode: boolean) => void;
  setStreamingContent: (content: string) => void;
  setStreamingThinking: (thinking: string) => void;
  clearStreaming: () => void;
  resetSession: () => void;
}

export const useChatStore = create<ChatState>()((set) => ({
  // Initial state
  isTemporaryMode: false,
  streamingContent: "",
  streamingThinking: "",

  // Actions
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
      isTemporaryMode: false,
      streamingContent: "",
      streamingThinking: ""
    }),
}));
