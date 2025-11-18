export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

export interface ChatSession {
  sessionId: string;
  title: string | null;
  lastMessageTimestamp: number;
  messageCount?: number;
}
