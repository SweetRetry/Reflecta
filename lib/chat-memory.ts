/**
 * Memory management for chat conversations using Prisma
 */

import { BaseMessage, HumanMessage, AIMessage } from "@langchain/core/messages";
import { ChatValidator } from "./chat-validator";
import { chatConfig } from "./chat-config";
import { prisma } from "./prisma";
import { LocalEmbeddingService } from "./chat-embedding";
import { PrismaVectorStore } from "./chat-vector-store";

function rowToMessage(row: { role: string; content: string }): BaseMessage {
  return row.role === "human" 
    ? new HumanMessage(row.content) 
    : new AIMessage(row.content);
}

export async function getMemoryForSession(sessionId: string): Promise<BaseMessage[]> {
  const messages = await prisma.chatMessage.findMany({
    where: { sessionId },
    select: { role: true, content: true },
    orderBy: { createdAt: "asc" },
  });
  return messages.map(rowToMessage);
}

export async function saveToMemory(
  sessionId: string,
  userMessage: string,
  assistantMessage: string
): Promise<void> {
  const userMsg = ChatValidator.sanitizeMessage(userMessage);
  const aiMsg = ChatValidator.sanitizeMessage(assistantMessage);
  const timestamp = Math.floor(Date.now() / 1000);
  const enableEmbedding = chatConfig.getEmbeddingConfig().enabled ?? true;

  await prisma.$transaction(async (tx) => {
    await tx.chatSession.upsert({
      where: { id: sessionId },
      update: { updatedAt: timestamp },
      create: {
        id: sessionId,
        title: userMsg.substring(0, 100),
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    });

    const userMsgRow = await tx.chatMessage.create({
      data: { sessionId, role: "human", content: userMsg },
    });

    if (enableEmbedding) {
      try {
        const vector = await LocalEmbeddingService.getInstance().embedText(userMsg);
        if (vector.length > 0) {
          await (tx as any).messageEmbedding.create({
            data: { messageId: userMsgRow.id, sessionId, vector: JSON.stringify(vector) },
          });
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

export async function searchRelevantContext(
  sessionId: string,
  currentMessage: string
): Promise<BaseMessage[]> {
  const config = chatConfig.getEmbeddingConfig();
  if (!config.enabled) return [];

  const sanitized = ChatValidator.sanitizeMessage(currentMessage);
  if (!sanitized.trim()) return [];

  try {
    const vector = await LocalEmbeddingService.getInstance().embedText(sanitized);
    if (!vector.length) return [];

    const results = await PrismaVectorStore.getInstance().searchSimilar({
      queryVector: vector,
      topK: config.topK ?? 8,
      candidateLimit: config.candidateLimit ?? 500,
      excludeSessionId: sessionId,
    });

    if (!results.length) return [];

    const messages = await prisma.chatMessage.findMany({
      where: { id: { in: results.map((r) => r.messageId) } },
      select: { role: true, content: true },
    });

    return messages.map(rowToMessage);
  } catch (error) {
    console.error("Error searching relevant context:", error);
    return [];
  }
}

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
    timestamp: msg.createdAt * 1000,
  }));
}

export async function buildMessagesWithMemory(
  sessionId: string,
  currentMessage: string
): Promise<BaseMessage[]> {
  const history = await getMemoryForSession(sessionId);
  const sanitized = ChatValidator.sanitizeMessage(currentMessage);
  const modelConfig = chatConfig.getModelConfig();
  const embeddingConfig = chatConfig.getEmbeddingConfig();
  
  const limitedHistory = history.slice(-(modelConfig.maxHistoryLength || 20) * 2);
  const contextMessages = embeddingConfig.enabled && embeddingConfig.enableRag
    ? await searchRelevantContext(sessionId, currentMessage)
    : [];

  return [...contextMessages, ...limitedHistory, new HumanMessage(sanitized)];
}

export async function getRecentSessions(limit: number = 50) {
  const sessions = await prisma.chatSession.findMany({
    orderBy: { updatedAt: "desc" },
    take: limit,
    include: { _count: { select: { messages: true } } },
  });

  return sessions.map((s) => ({
    sessionId: s.id,
    title: s.title,
    lastMessageTimestamp: s.updatedAt * 1000,
    messageCount: s._count.messages,
  }));
}
