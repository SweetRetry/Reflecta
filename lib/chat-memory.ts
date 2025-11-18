/**
 * Memory management for chat conversations using LangChain Memory
 * Currently uses in-memory storage, can be replaced with database later
 */

import { InMemoryChatMessageHistory } from "@langchain/core/chat_history";
import { HumanMessage, BaseMessage } from "@langchain/core/messages";
import { ChatValidator } from "./chat-validator";
import { chatConfig } from "./chat-config";

/**
 * In-memory storage for conversation histories
 * Key: sessionId, Value: InMemoryChatMessageHistory instance
 */
const memoryStore = new Map<string, InMemoryChatMessageHistory>();

/**
 * Get or create a chat history instance for a session
 */
export function getMemoryForSession(
  sessionId: string
): InMemoryChatMessageHistory {
  if (!memoryStore.has(sessionId)) {
    const chatHistory = new InMemoryChatMessageHistory();
    memoryStore.set(sessionId, chatHistory);
  }
  return memoryStore.get(sessionId)!;
}

/**
 * Save user message and assistant response to memory
 */
export async function saveToMemory(
  sessionId: string,
  userMessage: string,
  assistantMessage: string
): Promise<void> {
  const chatHistory = getMemoryForSession(sessionId);
  const sanitizedUserMessage = ChatValidator.sanitizeMessage(userMessage);
  const sanitizedAssistantMessage = ChatValidator.sanitizeMessage(
    assistantMessage
  );

  await chatHistory.addUserMessage(sanitizedUserMessage);
  await chatHistory.addAIMessage(sanitizedAssistantMessage);
}

/**
 * Get conversation history from memory
 */
export async function getHistoryFromMemory(
  sessionId: string
): Promise<BaseMessage[]> {
  const chatHistory = getMemoryForSession(sessionId);
  const messages = await chatHistory.getMessages();

  // Limit history length based on config
  const maxHistoryLength = chatConfig.getModelConfig().maxHistoryLength || 20;
  if (messages.length > maxHistoryLength * 2) {
    // Keep only the most recent messages (user + assistant pairs)
    const startIndex = messages.length - maxHistoryLength * 2;
    return messages.slice(startIndex);
  }

  return messages;
}

/**
 * Clear memory for a session
 */
export async function clearMemory(sessionId: string): Promise<void> {
  const chatHistory = memoryStore.get(sessionId);
  if (chatHistory) {
    await chatHistory.clear();
    memoryStore.delete(sessionId);
  }
}

/**
 * Get all messages from memory and add current user message
 */
export async function buildMessagesWithMemory(
  sessionId: string,
  currentMessage: string
): Promise<BaseMessage[]> {
  const history = await getHistoryFromMemory(sessionId);
  const sanitizedMessage = ChatValidator.sanitizeMessage(currentMessage);
  const messages = [...history, new HumanMessage(sanitizedMessage)];
  return messages;
}

/**
 * Clean up old sessions (optional, for memory management)
 * This can be called periodically to prevent memory leaks
 */
export function cleanupOldSessions(_maxAge: number = 24 * 60 * 60 * 1000): void {
  // For now, we'll keep all sessions in memory
  // In the future, when using database, we can implement proper cleanup
  // This is a placeholder for future database implementation
}

