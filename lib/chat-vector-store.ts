import { prisma } from "./prisma";

export interface VectorStoreSearchResult {
  messageId: number;
  sessionId: string;
  score: number;
}

export interface VectorStoreSearchParams {
  queryVector: number[];
  topK: number;
  candidateLimit?: number;
  excludeSessionId?: string;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const va = a[i];
    const vb = b[i];
    dot += va * vb;
    normA += va * va;
    normB += vb * vb;
  }

  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function parseVector(json: string): number[] {
  try {
    const parsed = JSON.parse(json);
    if (Array.isArray(parsed)) {
      return parsed.map((v) => Number(v) || 0);
    }
    return [];
  } catch {
    return [];
  }
}

export class PrismaVectorStore {
  private static instance: PrismaVectorStore;

  private constructor() {}

  static getInstance(): PrismaVectorStore {
    if (!PrismaVectorStore.instance) {
      PrismaVectorStore.instance = new PrismaVectorStore();
    }
    return PrismaVectorStore.instance;
  }

  async searchSimilar(
    params: VectorStoreSearchParams
  ): Promise<VectorStoreSearchResult[]> {
    const {
      queryVector,
      topK,
      candidateLimit = 500,
      excludeSessionId,
    } = params;

    if (queryVector.length === 0 || topK <= 0) return [];

    const embeddings = await prisma.messageEmbedding.findMany({
      where: excludeSessionId
        ? {
            sessionId: {
              not: excludeSessionId,
            },
          }
        : undefined,
      orderBy: {
        createdAt: "desc",
      },
      take: candidateLimit,
    });

    const scored: VectorStoreSearchResult[] = [];
    for (const emb of embeddings) {
      const vector = parseVector(emb.vector);
      if (vector.length === 0) continue;
      const score = cosineSimilarity(queryVector, vector);
      if (score > 0) {
        scored.push({ messageId: emb.messageId, sessionId: emb.sessionId, score });
      }
    }

    return scored.sort((a, b) => b.score - a.score).slice(0, topK);
  }
}
