import { ChatConfig, EmbeddingConfig, RateLimitConfig } from "./chat-types";

class ChatConfiguration {
  private static instance: ChatConfiguration;

  private constructor() {}

  static getInstance(): ChatConfiguration {
    if (!ChatConfiguration.instance) {
      ChatConfiguration.instance = new ChatConfiguration();
    }
    return ChatConfiguration.instance;
  }

  getEmbeddingConfig(): EmbeddingConfig {
    return {
      enabled: process.env.EMBEDDING_ENABLED !== "false",
      enableRag: process.env.RAG_ENABLED !== "false",
      model: process.env.EMBEDDING_MODEL || "Xenova/multilingual-e5-small",
      topK: parseInt(process.env.RAG_TOP_K || "8", 10),
      candidateLimit: parseInt(process.env.RAG_CANDIDATE_LIMIT || "500", 10),
    };
  }

  getModelConfig(): ChatConfig {
    return {
      model: process.env.CHAT_MODEL || "MiniMax-M2",
      maxTokens: parseInt(process.env.MAX_TOKENS || "1000", 10),
      temperature: parseFloat(process.env.TEMPERATURE || "0.7"),
      topP: parseFloat(process.env.TOP_P || "1.0"),
      maxHistoryLength: parseInt(process.env.MAX_HISTORY_LENGTH || "20", 10),
    };
  }

  getRateLimitConfig(): RateLimitConfig {
    return {
      maxRequestsPerMinute: parseInt(process.env.RATE_LIMIT_PER_MINUTE || "20", 10),
      maxRequestsPerHour: parseInt(process.env.RATE_LIMIT_PER_HOUR || "200", 10),
      windowMs: 60 * 1000,
    };
  }

  getApiKey(): string {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is not configured");
    }
    return process.env.ANTHROPIC_API_KEY;
  }

  getBaseUrl(): string | undefined {
    return process.env.ANTHROPIC_BASE_URL;
  }

  validateConfiguration(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    if (!process.env.ANTHROPIC_API_KEY) {
      errors.push("ANTHROPIC_API_KEY is required");
    }
    const maxTokens = parseInt(process.env.MAX_TOKENS || "1000", 10);
    if (maxTokens < 1 || maxTokens > 100000) {
      errors.push("MAX_TOKENS must be between 1 and 100000");
    }
    const temperature = parseFloat(process.env.TEMPERATURE || "0.7");
    if (temperature < 0 || temperature > 2) {
      errors.push("TEMPERATURE must be between 0 and 2");
    }
    return { valid: errors.length === 0, errors };
  }
}

export const chatConfig = ChatConfiguration.getInstance();
