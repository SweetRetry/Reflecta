/**
 * Memory management for chat conversations using Prisma
 */

import { BaseMessage, HumanMessage, AIMessage, SystemMessage } from "@langchain/core/messages";
import { ChatValidator } from "./chat-validator";
import { chatConfig } from "./chat-config";
import { prisma } from "./prisma";
import { LocalEmbeddingService } from "./chat-embedding";
import { PrismaVectorStore } from "./chat-vector-store";
import { createMemoryGraph } from "./agents/memory-graph";
import { smartTruncateMessages, getMaxContextTokens, countMessagesTokens, getTokenStats } from "./token-manager";
import { toPgVectorString } from "./vector-utils";

function rowToMessage(row: { role: string; content: string }): BaseMessage {
  return row.role === "human" 
    ? new HumanMessage(row.content) 
    : new AIMessage(row.content);
}

/**
 * Retrieves all messages for a given session from the database
 * @param sessionId - The session identifier
 * @returns Array of BaseMessage objects ordered by creation time
 */
export async function getMemoryForSession(sessionId: string): Promise<BaseMessage[]> {
  const messages = await prisma.chatMessage.findMany({
    where: { sessionId },
    select: { role: true, content: true },
    orderBy: { createdAt: "asc" },
  });
  return messages.map(rowToMessage);
}

/**
 * Saves a conversation turn (user message + assistant response) to the database
 * Also creates embeddings if embedding is enabled
 * @param sessionId - The session identifier
 * @param userMessage - The user's message content
 * @param assistantMessage - The assistant's response content
 */
export async function saveToMemory(
  sessionId: string,
  userMessage: string,
  assistantMessage: string
): Promise<void> {
  const userMsg = ChatValidator.sanitizeMessage(userMessage);
  const aiMsg = ChatValidator.sanitizeMessage(assistantMessage);
  const enableEmbedding = chatConfig.getEmbeddingConfig().enabled ?? true;

  await prisma.$transaction(async (tx) => {
    await tx.chatSession.upsert({
      where: { id: sessionId },
      update: {},
      create: {
        id: sessionId,
        title: userMsg.substring(0, 100),
      },
    });

    const userMsgRow = await tx.chatMessage.create({
      data: { sessionId, role: "human", content: userMsg },
    });

    if (enableEmbedding) {
      try {
        const vector = await LocalEmbeddingService.getInstance().embedText(userMsg);
        if (vector.length > 0) {
          // Convert vector to safe pgvector format with validation
          const vectorString = toPgVectorString(vector);
          await tx.$executeRaw`
            INSERT INTO message_embeddings (message_id, session_id, vector)
            VALUES (${userMsgRow.id}, ${sessionId}, ${vectorString}::vector)
          `;
        }
      } catch (error) {
        console.error("Error creating embedding:", error);
      }
    }

    await tx.chatMessage.create({
      data: { sessionId, role: "ai", content: aiMsg },
    });
  });
}

/**
 * Processes memory in the background: saves conversation and triggers Memory Graph
 * This function should be called asynchronously after sending the response
 * @param sessionId - The session identifier
 * @param userMessage - The user's message content
 * @param assistantMessage - The assistant's response content
 */
export async function processMemoryInBackground(
  sessionId: string,
  userMessage: string,
  assistantMessage: string
) {
  // 1. Save raw conversation
  await saveToMemory(sessionId, userMessage, assistantMessage);

  // 2. Trigger Memory Graph (Reflective Memory)
  try {
    // Fetch recent context for the graph
    const recentMessages = await getMemoryForSession(sessionId);
    const limitedMessages = recentMessages.slice(-6); // Look at last 6 messages for context

    const graph = createMemoryGraph();
    await graph.invoke({
      sessionId,
      recentMessages: limitedMessages,
    });
  } catch (error) {
    console.error("Error running Memory Graph:", error);
  }
}

// Removed duplicate utility functions - now using shared vector-utils module

/**
 * Searches for relevant context using RAG (Retrieval-Augmented Generation)
 * Combines semantic search across historical messages and refined memories
 * @param sessionId - The current session identifier (excluded from search)
 * @param currentMessage - The current user message to find context for
 * @returns Array of relevant BaseMessage objects (system messages for memories, regular messages for history)
 */
export async function searchRelevantContext(
  sessionId: string,
  currentMessage: string
): Promise<BaseMessage[]> {
  const config = chatConfig.getEmbeddingConfig();
  if (!config.enabled) return [];

  const sanitized = ChatValidator.sanitizeMessage(currentMessage);
  if (!sanitized.trim()) return [];

  let vector: number[];
  try {
    const embeddingService = LocalEmbeddingService.getInstance();
    vector = await embeddingService.embedText(sanitized);

    if (!vector.length) {
      console.warn("Embedding service returned empty vector, skipping RAG");
      return [];
    }
  } catch (embeddingError) {
    console.error("Embedding generation failed, falling back to recent history:", embeddingError);
    // Fallback: Return recent messages from current session instead of semantic search
    try {
      const recentMessages = await prisma.chatMessage.findMany({
        where: { sessionId },
        orderBy: { createdAt: "desc" },
        take: 3,
        select: { role: true, content: true },
      });
      return recentMessages.reverse().map(rowToMessage);
    } catch (fallbackError) {
      console.error("Fallback query also failed:", fallbackError);
      return [];
    }
  }

  try {
    // Optimized: Single query with JOIN to fetch both messages and memories
    // This reduces 4 separate queries to 1, cutting latency by ~50%
    const vectorString = toPgVectorString(vector);

    const results = await prisma.$queryRaw<
      Array<{
        type: 'message' | 'memory';
        role: string | null;
        content: string;
        score: number;
      }>
    >`
      WITH message_search AS (
        SELECT
          me.message_id,
          1 - (me.vector <=> ${vectorString}::vector) / 2 AS score
        FROM message_embeddings me
        WHERE me.session_id != ${sessionId}
        ORDER BY me.vector <=> ${vectorString}::vector
        LIMIT 10
      ),
      memory_search AS (
        SELECT
          mem.memory_id,
          1 - (mem.vector <=> ${vectorString}::vector) / 2 AS score
        FROM memory_embeddings mem
        ORDER BY mem.vector <=> ${vectorString}::vector
        LIMIT 6
      )
      SELECT
        'message'::text as type,
        cm.role,
        cm.content,
        ms.score
      FROM message_search ms
      JOIN chat_messages cm ON cm.id = ms.message_id
      WHERE ms.score >= 0.6
      ORDER BY ms.score DESC
      LIMIT 5

      UNION ALL

      SELECT
        'memory'::text as type,
        NULL as role,
        um.content,
        mem.score
      FROM memory_search mem
      JOIN user_memories um ON um.id = mem.memory_id
      WHERE mem.score >= 0.7
      ORDER BY mem.score DESC
      LIMIT 3
    `;

    // Separate messages and memories from unified results
    const messages = results
      .filter(r => r.type === 'message' && r.role)
      .map(r => rowToMessage({ role: r.role!, content: r.content }));

    const memories = results
      .filter(r => r.type === 'memory')
      .map(r => r.content);

    // Combine results: Refined memories as System context, Raw messages as examples
    const contextMessages: BaseMessage[] = [];

    if (memories.length > 0) {
      const memoryText = memories.map(m => `- ${m}`).join("\n");
      contextMessages.push(new SystemMessage(`Recall these facts about the user/project:\n${memoryText}`));
    }

    contextMessages.push(...messages);

    return contextMessages;
  } catch (error) {
    console.error("Error searching relevant context:", error);
    return [];
  }
}

/**
 * Retrieves chat history with timestamps for a session
 * @param sessionId - The session identifier
 * @returns Array of messages with role, content, and timestamp
 */
export async function getHistoryWithTimestamps(
  sessionId: string
): Promise<Array<{ role: string; content: string; timestamp: number }>> {
  const messages = await prisma.chatMessage.findMany({
    where: { sessionId },
    select: { role: true, content: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  return messages.map((msg) => ({
    role: msg.role === "human" ? "user" : "assistant",
    content: msg.content,
    timestamp: msg.createdAt.getTime(),
  }));
}

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

  // Get context messages from RAG
  const contextMessages = embeddingConfig.enabled && embeddingConfig.enableRag
    ? await searchRelevantContext(sessionId, currentMessage)
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

/**
 * Retrieves recent chat sessions ordered by update time
 * @param limit - Maximum number of sessions to return (default: 50)
 * @returns Array of session objects with id, title, timestamp, and message count
 */
export async function getRecentSessions(limit: number = 50) {
  const sessions = await prisma.chatSession.findMany({
    orderBy: { updatedAt: "desc" },
    take: limit,
    include: { _count: { select: { messages: true } } },
  });

  return sessions.map((s) => ({
    sessionId: s.id,
    title: s.title,
    lastMessageTimestamp: s.updatedAt.getTime(),
    messageCount: s._count.messages,
  }));
}
