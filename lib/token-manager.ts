/**
 * Token management utilities for context window optimization
 */

import { BaseMessage } from "@langchain/core/messages";
import { encodingForModel, TiktokenModel } from "js-tiktoken";

// Claude model token limits
const MODEL_LIMITS: Record<string, number> = {
  default: 200000,
};

// Reserve tokens for response
const RESPONSE_BUFFER = 4096; // Reserve 4k tokens for output

/**
 * Get token encoding for a specific model
 */
function getEncoding(_model: string) {
  // Claude uses cl100k_base encoding (same as GPT-4)
  return encodingForModel("gpt-4" as TiktokenModel);
}

/**
 * Count tokens in a string using tiktoken
 * Note: js-tiktoken uses cl100k_base encoding (GPT-4) which is similar to Claude's tokenization
 */
function countTokens(
  text: string,
  model: string = "claude-3-5-sonnet-20241022"
): number {
  if (!text || text.length === 0) return 0;

  try {
    const encoding = getEncoding(model);
    const tokens = encoding.encode(text);
    // js-tiktoken doesn't require manual cleanup (no .free() method)
    return tokens.length;
  } catch (error) {
    console.error("Error counting tokens:", error);
    // Fallback: rough estimation (1 token ≈ 3.5 chars for Claude)
    return Math.ceil(text.length / 3.5);
  }
}

/**
 * Count tokens in a BaseMessage
 */
function countMessageTokens(
  message: BaseMessage,
  model: string = "claude-3-5-sonnet-20241022"
): number {
  const content =
    typeof message.content === "string"
      ? message.content
      : JSON.stringify(message.content);

  // Add overhead for message formatting (~4 tokens per message)
  return countTokens(content, model) + 4;
}

/**
 * Count tokens in an array of messages
 * @param messages - Array of BaseMessage objects
 * @param model - Model name for token counting (default: "claude-3-5-sonnet-20241022")
 * @returns Total token count across all messages
 */
export function countMessagesTokens(
  messages: BaseMessage[],
  model: string = "claude-3-5-sonnet-20241022"
): number {
  return messages.reduce(
    (total, msg) => total + countMessageTokens(msg, model),
    0
  );
}

/**
 * Get the maximum context tokens available for input
 * Accounts for response buffer reservation
 * @param model - Model name to get limits for
 * @returns Maximum context tokens available for input
 */
export function getMaxContextTokens(model: string): number {
  const limit = MODEL_LIMITS[model] || MODEL_LIMITS.default;
  return limit - RESPONSE_BUFFER;
}

/**
 * Truncate messages to fit within token limit
 * Keeps the most recent messages and removes older ones
 */
function truncateMessages(
  messages: BaseMessage[],
  maxTokens: number,
  model: string = "claude-3-5-sonnet-20241022"
): BaseMessage[] {
  if (messages.length === 0) return [];

  const truncated: BaseMessage[] = [];
  let totalTokens = 0;

  // Iterate from newest to oldest
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    const messageTokens = countMessageTokens(message, model);

    if (totalTokens + messageTokens > maxTokens) {
      break; // Stop if adding this message would exceed limit
    }

    truncated.unshift(message); // Add to beginning
    totalTokens += messageTokens;
  }

  return truncated;
}

/**
 * Smart truncation that preserves important messages
 * - Always keeps system messages
 * - Keeps the most recent N messages
 * - Fills remaining space with older messages
 * @param messages - Array of messages to truncate
 * @param maxTokens - Maximum token budget
 * @param model - Model name for token counting
 * @param keepRecentCount - Number of recent messages to guarantee keeping (default: 4)
 * @returns Truncated array of messages that fits within token budget
 */
export function smartTruncateMessages(
  messages: BaseMessage[],
  maxTokens: number,
  model: string = "claude-3-5-sonnet-20241022",
  keepRecentCount: number = 4
): BaseMessage[] {
  if (messages.length === 0) return [];

  const systemMessages: BaseMessage[] = [];
  const regularMessages: BaseMessage[] = [];

  // Separate system messages from regular messages
  for (const msg of messages) {
    if (msg._getType() === "system") {
      systemMessages.push(msg);
    } else {
      regularMessages.push(msg);
    }
  }

  // Start with system messages
  let totalTokens = countMessagesTokens(systemMessages, model);
  const result: BaseMessage[] = [...systemMessages];

  if (totalTokens >= maxTokens) {
    console.warn("System messages exceed token limit, truncating...");
    return truncateMessages(systemMessages, maxTokens, model);
  }

  // Add recent messages (guaranteed to keep)
  const recentMessages = regularMessages.slice(-keepRecentCount);
  const recentTokens = countMessagesTokens(recentMessages, model);

  if (totalTokens + recentTokens >= maxTokens) {
    // Even recent messages don't fit, truncate them
    const available = maxTokens - totalTokens;
    const truncatedRecent = truncateMessages(recentMessages, available, model);
    return [...result, ...truncatedRecent];
  }

  totalTokens += recentTokens;
  result.push(...recentMessages);

  // Fill remaining space with older messages
  const olderMessages = regularMessages.slice(0, -keepRecentCount);
  const remainingTokens = maxTokens - totalTokens;

  if (olderMessages.length > 0 && remainingTokens > 0) {
    const truncatedOlder = truncateMessages(
      olderMessages,
      remainingTokens,
      model
    );
    // Insert older messages before recent messages
    result.splice(systemMessages.length, 0, ...truncatedOlder);
  }

  return result;
}

/**
 * Get token statistics for debugging
 * @param messages - Array of messages to analyze
 * @param model - Model name for token counting
 * @returns Token statistics including total, max, remaining, usage percentage, and message count
 */
export function getTokenStats(
  messages: BaseMessage[],
  model: string = "claude-3-5-sonnet-20241022"
) {
  const totalTokens = countMessagesTokens(messages, model);
  const maxTokens = getMaxContextTokens(model);
  const remaining = maxTokens - totalTokens;
  const usagePercentage = (totalTokens / maxTokens) * 100;

  return {
    totalTokens,
    maxTokens,
    remaining,
    usagePercentage: usagePercentage.toFixed(2),
    messageCount: messages.length,
    averageTokensPerMessage:
      messages.length > 0 ? (totalTokens / messages.length).toFixed(2) : 0,
  };
}
