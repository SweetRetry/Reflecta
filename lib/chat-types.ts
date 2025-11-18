export interface ChatRequest {
  message: string;

  userId?: string;
  sessionId: string; // Required for memory management
  context?: Record<string, unknown>;
}

export interface StreamChunk {
  content?: string;
  error?: string;
  metadata?: {
    model?: string;
    tokensUsed?: number;
    finishReason?: string;
  };
}

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
  /**
   * 从数据库中加载的候选数量上限
   */
  candidateLimit?: number;
}

export interface RateLimitConfig {
  maxRequestsPerMinute: number;
  maxRequestsPerHour: number;
  windowMs: number;
}

export interface ValidationError {
  field: string;
  message: string;
}

export interface ChatMetrics {
  requestId: string;
  startTime: number;
  endTime?: number;
  tokensUsed?: number;
  modelUsed: string;
  error?: string;
  userId?: string;
}
