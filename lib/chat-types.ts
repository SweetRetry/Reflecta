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
