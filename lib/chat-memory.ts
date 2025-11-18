/**
 * Memory management for chat conversations using Prisma
 * Type-safe database access with Prisma ORM
 */

import { BaseMessage, HumanMessage, AIMessage } from "@langchain/core/messages";
import { ChatValidator } from "./chat-validator";
import { chatConfig } from "./chat-config";
import { prisma } from "./prisma";

/**
 * Convert database row to LangChain message
 */
function rowToMessage(row: {
  role: string;
  content: string;
}): BaseMessage {
  if (row.role === "human") {
    return new HumanMessage(row.content);
  } else if (row.role === "ai") {
    return new AIMessage(row.content);
  }
  throw new Error(`Unknown role: ${row.role}`);
}

/**
 * Get or create a chat history instance for a session
 * Returns messages from database
 */
export async function getMemoryForSession(
  sessionId: string
): Promise<BaseMessage[]> {
  const messages = await prisma.chatMessage.findMany({
    where: { sessionId },
    select: {
      role: true,
      content: true,
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  return messages.map(rowToMessage);
}

/**
 * Save user message and assistant response to memory
 */
export async function saveToMemory(
  sessionId: string,
  userMessage: string,
  assistantMessage: string
): Promise<void> {
  const sanitizedUserMessage = ChatValidator.sanitizeMessage(userMessage);
  const sanitizedAssistantMessage = ChatValidator.sanitizeMessage(
    assistantMessage
  );

  // Use transaction to ensure session and messages are saved atomically
  await prisma.$transaction(async (tx) => {
    // Create or update session
    await tx.chatSession.upsert({
      where: { id: sessionId },
      update: {
        updatedAt: Math.floor(Date.now() / 1000),
      },
      create: {
        id: sessionId,
        title: sanitizedUserMessage.substring(0, 100), // Use first message as title
        createdAt: Math.floor(Date.now() / 1000),
        updatedAt: Math.floor(Date.now() / 1000),
      },
    });

    // Create user message
    await tx.chatMessage.create({
      data: {
        sessionId,
        role: "human",
        content: sanitizedUserMessage,
      },
    });

    // Create AI message
    await tx.chatMessage.create({
      data: {
        sessionId,
        role: "ai",
        content: sanitizedAssistantMessage,
      },
    });
  });
}

/**
 * Get conversation history from memory
 */
export async function getHistoryFromMemory(
  sessionId: string
): Promise<BaseMessage[]> {
  const messages = await getMemoryForSession(sessionId);
  
  // Limit history length based on config
  // Note: We'll limit in buildMessagesWithMemory to keep it simple
  return messages;
}

/**
 * Get conversation history with timestamps for frontend display
 */
export async function getHistoryWithTimestamps(
  sessionId: string
): Promise<Array<{ role: string; content: string; timestamp: number }>> {
  const messages = await prisma.chatMessage.findMany({
    where: { sessionId },
    select: {
      role: true,
      content: true,
      createdAt: true,
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  return messages.map((msg: { role: string; content: string; createdAt: number }) => ({
    role: msg.role === "human" ? "user" : "assistant",
    content: msg.content,
    timestamp: msg.createdAt * 1000, // Convert from seconds to milliseconds
  }));
}

/**
 * Clear memory for a session
 */
export async function clearMemory(sessionId: string): Promise<void> {
  await prisma.chatMessage.deleteMany({
    where: { sessionId },
  });
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
  
  // Limit history length
  const maxHistoryLength = chatConfig.getModelConfig().maxHistoryLength || 20;
  const limitedHistory = history.slice(-maxHistoryLength * 2);
  
  const messages = [...limitedHistory, new HumanMessage(sanitizedMessage)];
  return messages;
}

/**
 * Create or update a chat session
 */
export async function createOrUpdateSession(
  sessionId: string,
  title?: string
): Promise<void> {
  await prisma.chatSession.upsert({
    where: { id: sessionId },
    update: {
      updatedAt: Math.floor(Date.now() / 1000),
      ...(title && { title }),
    },
    create: {
      id: sessionId,
      title: title || null,
      createdAt: Math.floor(Date.now() / 1000),
      updatedAt: Math.floor(Date.now() / 1000),
    },
  });
}

/**
 * Get recent chat sessions
 */
export async function getRecentSessions(
  limit: number = 50
): Promise<Array<{
  sessionId: string;
  title: string | null;
  lastMessageTimestamp: number;
  messageCount?: number;
}>> {
  // Fetch sessions from ChatSession table with message count
  const sessions = await prisma.chatSession.findMany({
    orderBy: {
      updatedAt: "desc",
    },
    take: limit,
    include: {
      _count: {
        select: { messages: true },
      },
    },
  });

  return sessions.map((session) => ({
    sessionId: session.id,
    title: session.title,
    lastMessageTimestamp: session.updatedAt * 1000, // Convert to ms
    messageCount: session._count.messages,
  }));
}

/**
 * Get session by ID with metadata
 */
export async function getSessionById(sessionId: string): Promise<{
  id: string;
  title: string | null;
  createdAt: number;
  updatedAt: number;
} | null> {
  const session = await prisma.chatSession.findUnique({
    where: { id: sessionId },
  });

  if (!session) return null;

  return {
    id: session.id,
    title: session.title,
    createdAt: session.createdAt * 1000,
    updatedAt: session.updatedAt * 1000,
  };
}

/**
 * Update session title
 */
export async function updateSessionTitle(
  sessionId: string,
  title: string
): Promise<void> {
  await prisma.chatSession.update({
    where: { id: sessionId },
    data: { title },
  });
}

/**
 * Delete a session and all its messages
 */
export async function deleteSession(sessionId: string): Promise<void> {
  // Cascade delete will handle messages automatically
  await prisma.chatSession.delete({
    where: { id: sessionId },
  });
}

/**
 * Clean up old sessions (optional, for memory management)
 */
export async function cleanupOldSessions(maxAge: number = 24 * 60 * 60 * 1000): Promise<void> {
  const cutoffTime = Math.floor((Date.now() - maxAge) / 1000);
  
  await prisma.chatMessage.deleteMany({
    where: {
      createdAt: {
        lt: cutoffTime,
      },
    },
  });
}

/**
 * Close database connection (useful for cleanup)
 * Note: Prisma Client manages connections automatically, but we can disconnect if needed
 */
export async function closeDatabase(): Promise<void> {
  await prisma.$disconnect();
}
