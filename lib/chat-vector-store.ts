import { prisma } from "./prisma";
import { Prisma } from "@prisma/client";
import { toPgVectorString } from "./vector-utils";

export interface VectorStoreSearchResult {
  messageId?: number;
  memoryId?: number;
  sessionId: string;
  score: number;
}

export interface VectorStoreSearchParams {
  queryVector: number[];
  topK: number;
  excludeSessionId?: string;
  minScore?: number;
}

export interface MemorySearchResult {
  memoryId: number;
  sessionId: string;
  score: number;
}

/**
 * Vector store implementation using Prisma and pgvector
 * Provides semantic search capabilities for messages and memories
 */
export class PrismaVectorStore {
  private static instance: PrismaVectorStore;

  private constructor() {}

  /**
   * Gets the singleton instance of PrismaVectorStore
   * @returns The singleton PrismaVectorStore instance
   */
  static getInstance(): PrismaVectorStore {
    if (!PrismaVectorStore.instance) {
      PrismaVectorStore.instance = new PrismaVectorStore();
    }
    return PrismaVectorStore.instance;
  }

  /**
   * Search for similar messages using MessageEmbedding with pgvector
   * Typically used for cross-session RAG (retrieving similar historical conversations)
   * @param params - Search parameters including query vector, topK, and filters
   * @returns Array of search results with message IDs, session IDs, and similarity scores
   */
  async searchSimilarMessages(
    params: VectorStoreSearchParams
  ): Promise<VectorStoreSearchResult[]> {
    const {
      queryVector,
      topK,
      excludeSessionId,
      minScore = 0,
    } = params;

    if (queryVector.length === 0 || topK <= 0) return [];

    // Convert vector to safe pgvector format with validation
    const vectorString = toPgVectorString(queryVector);

    // Use pgvector's <=> operator for cosine distance
    // Note: pgvector returns distance (0 = identical, 2 = opposite)
    // Convert to similarity score: 1 - (distance / 2)
    const results = await prisma.$queryRaw<
      Array<{ message_id: number; session_id: string; distance: number }>
    >`
      SELECT
        message_id,
        session_id,
        vector <=> ${vectorString}::vector as distance
      FROM message_embeddings
      WHERE ${excludeSessionId ? Prisma.sql`session_id != ${excludeSessionId}` : Prisma.sql`true`}
      ORDER BY vector <=> ${vectorString}::vector
      LIMIT ${topK * 2}
    `;

    // Convert distance to similarity and filter by minScore
    return results
      .map((r) => ({
        messageId: r.message_id,
        sessionId: r.session_id,
        score: 1 - r.distance / 2, // Convert cosine distance to similarity
      }))
      .filter((r) => r.score >= minScore)
      .slice(0, topK);
  }

  /**
   * Search for similar memories using MemoryEmbedding with pgvector
   * Typically used for retrieving user preferences/facts/constraints
   *
   * Note: This searches globally across all sessions. If multi-user support is needed,
   * add userId field to schema and filter by it.
   * @param params - Search parameters including query vector, topK, and minimum score threshold
   * @returns Array of search results with memory IDs, session IDs, and similarity scores
   */
  async searchSimilarMemories(
    params: VectorStoreSearchParams
  ): Promise<MemorySearchResult[]> {
    const {
      queryVector,
      topK,
      minScore = 0.7, // Higher threshold for factual memories
    } = params;

    if (queryVector.length === 0 || topK <= 0) return [];

    // Convert vector to safe pgvector format with validation
    const vectorString = toPgVectorString(queryVector);

    // Use pgvector's <=> operator for cosine distance
    const results = await prisma.$queryRaw<
      Array<{ memory_id: number; session_id: string; distance: number }>
    >`
      SELECT
        memory_id,
        session_id,
        vector <=> ${vectorString}::vector as distance
      FROM memory_embeddings
      ORDER BY vector <=> ${vectorString}::vector
      LIMIT ${topK * 2}
    `;

    // Convert distance to similarity and filter by minScore
    return results
      .map((r) => ({
        memoryId: r.memory_id,
        sessionId: r.session_id,
        score: 1 - r.distance / 2, // Convert cosine distance to similarity
      }))
      .filter((r) => r.score >= minScore)
      .slice(0, topK);
  }

}
