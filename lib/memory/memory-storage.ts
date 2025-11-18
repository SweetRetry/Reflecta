/**
 * Database storage operations for chat memory
 * Handles CRUD operations for messages, sessions, and embeddings
 */

import { BaseMessage, HumanMessage, AIMessage } from "@langchain/core/messages";
import { ChatValidator } from "../chat-validator";
import { chatConfig } from "../chat-config";
import { prisma } from "../prisma";
import { LocalEmbeddingService } from "../chat-embedding";
import { toPgVectorString } from "../vector-utils";
import { SessionSummary, ChatHistoryMessage } from "../chat-types";

/**
 * Converts database row to LangChain message
 */
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
export async function getMemoryForSession(
  sessionId: string
): Promise<BaseMessage[]> {
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
        const vector = await LocalEmbeddingService.getInstance().embedText(
          userMsg
        );
        if (vector.length > 0) {
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
 * Retrieves chat history with timestamps for a session
 * @param sessionId - The session identifier
 * @returns Array of messages with role, content, and timestamp
 */
export async function getHistoryWithTimestamps(
  sessionId: string
): Promise<ChatHistoryMessage[]> {
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
 * Retrieves recent chat sessions ordered by update time
 * @param limit - Maximum number of sessions to return (default: 50)
 * @returns Array of session objects with id, title, timestamp, and message count
 */
export async function getRecentSessions(
  limit: number = 50
): Promise<SessionSummary[]> {
  const sessions = await prisma.chatSession.findMany({
    orderBy: { updatedAt: "desc" },
    take: limit,
    include: { _count: { select: { messages: true } } },
  });

  return sessions.map((s) => ({
    sessionId: s.id,
    title: s.title || "Untitled Session", // Handle null titles
    lastMessageTimestamp: s.updatedAt.getTime(),
    messageCount: s._count.messages,
  }));
}
