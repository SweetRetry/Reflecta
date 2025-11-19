export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  thinking?: string; // Optional: AI's thinking process (for assistant messages)
}

export interface ChatSession {
  sessionId: string;
  title: string | null;
  lastMessageTimestamp: number;
  messageCount?: number;
}
