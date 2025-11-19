/**
 * Chat request payload structure
 */
export interface ChatRequest {
  message: string;

  userId?: string;
  sessionId: string; // Required for memory management
  context?: Record<string, unknown>;
}

/**
 * Server-Sent Events (SSE) chunk structure for streaming responses
 */
export interface StreamChunk {
  content?: string;
  thinking?: string; // AI's thinking process (for extended thinking models)
  error?: string;
  metadata?: {
    model?: string;
    tokensUsed?: number;
    finishReason?: string;
  };
}

/**
 * Configuration for the chat model
 */
export interface ChatConfig {
  model: string;
  maxTokens: number;
  temperature?: number;
  topP?: number;
  maxHistoryLength?: number;
}

export interface EmbeddingConfig {
  /**
   * 是否启用 embedding / RAG 功能（默认开启）
   */
  enabled?: boolean;
  /**
   * 是否在构建消息历史时启用 RAG 检索（默认开启）
   */
  enableRag?: boolean;
  /**
   * 使用的 embedding 模型名称
   */
  model?: string;
  /**
   * RAG 检索时的 topK
   */
  topK?: number;
}

/**
 * Rate limiting configuration
 */
export interface RateLimitConfig {
  maxRequestsPerMinute: number;
  maxRequestsPerHour: number;
  windowMs: number;
}

/**
 * Validation error structure
 */
export interface ValidationError {
  field: string;
  message: string;
}

/**
 * Chat metrics for tracking request performance
 */
export interface ChatMetrics {
  requestId: string;
  startTime: number;
  endTime?: number;
  tokensUsed?: number;
  modelUsed: string;
  error?: string;
  userId?: string;
}

/**
 * RAG context message from semantic search
 */
export interface RAGContext {
  type: "message" | "memory";
  content: string;
  score: number;
  metadata?: {
    sessionId?: string;
    messageId?: number;
    memoryId?: number;
  };
}

/**
 * Chat history message with timestamp
 */
export interface ChatHistoryMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

/**
 * Session summary info
 */
export interface SessionSummary {
  sessionId: string;
  title: string;
  lastMessageTimestamp: number;
  messageCount: number;
}

/**
 * Token statistics for debugging
 */
export interface TokenStats {
  totalTokens: number;
  maxTokens: number;
  remaining: number;
  usagePercentage: string;
  messageCount: number;
  averageTokensPerMessage: string | number;
}
