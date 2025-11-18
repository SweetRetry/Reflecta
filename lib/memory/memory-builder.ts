/**
 * Message builder with memory context and token management
 * Builds complete message arrays with RAG context, history, and smart truncation
 */

import { BaseMessage, HumanMessage } from "@langchain/core/messages";
import { ChatValidator } from "../chat-validator";
import { chatConfig } from "../chat-config";
import { getMemoryForSession } from "./memory-storage";
import { searchRelevantContextEnhanced } from "./memory-rag-enhanced";
import { smartTruncateMessages, getMaxContextTokens, countMessagesTokens, getTokenStats } from "../token-manager";

/**
 * Builds a complete message array with context, history, and current message
 * Includes RAG retrieval, smart token-aware truncation, and token statistics logging
 * @param sessionId - The session identifier
 * @param currentMessage - The current user message
 * @returns Array of BaseMessage objects ready for LLM processing
 */
export async function buildMessagesWithMemory(
  sessionId: string,
  currentMessage: string
): Promise<BaseMessage[]> {
  const history = await getMemoryForSession(sessionId);
  const sanitized = ChatValidator.sanitizeMessage(currentMessage);
  const modelConfig = chatConfig.getModelConfig();
  const embeddingConfig = chatConfig.getEmbeddingConfig();

  // Get context messages from enhanced RAG (with dynamic thresholds and hybrid search)
  const contextMessages = embeddingConfig.enabled && embeddingConfig.enableRag
    ? await searchRelevantContextEnhanced(sessionId, currentMessage)
    : [];

  // Add current message
  const currentMsg = new HumanMessage(sanitized);

  // Calculate token budget
  const model = modelConfig.model;
  const maxContextTokens = getMaxContextTokens(model);

  // Reserve tokens for context messages and current message
  const contextTokens = countMessagesTokens(contextMessages, model);
  const currentTokens = countMessagesTokens([currentMsg], model);
  const availableForHistory = maxContextTokens - contextTokens - currentTokens;

  // Smart truncate history to fit token budget
  // Keep last 4 messages guaranteed, fill rest with older messages
  const truncatedHistory = smartTruncateMessages(
    history,
    availableForHistory,
    model,
    4 // Keep at least last 4 messages (2 turns)
  );

  // Combine all messages
  const finalMessages = [...contextMessages, ...truncatedHistory, currentMsg];

  // Log token statistics in development
  if (process.env.NODE_ENV === "development") {
    const stats = getTokenStats(finalMessages, model);
    console.log("[Token Stats]", {
      total: stats.totalTokens,
      max: stats.maxTokens,
      usage: `${stats.usagePercentage}%`,
      messages: stats.messageCount,
      historyMessages: truncatedHistory.length,
      contextMessages: contextMessages.length,
    });
  }

  return finalMessages;
}
