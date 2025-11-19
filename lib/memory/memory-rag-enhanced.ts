/**
 * Enhanced RAG (Retrieval-Augmented Generation) with dynamic thresholding and hybrid search
 *
 * Features:
 * - Dynamic similarity thresholds based on query complexity
 * - Hybrid search (semantic + keyword matching)
 * - Improved relevance scoring
 * - Context Compression (filtering and summarization)
 */

import { BaseMessage, HumanMessage, AIMessage, SystemMessage } from "@langchain/core/messages";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatValidator } from "../chat-validator";
import { chatConfig } from "../chat-config";
import { prisma } from "../prisma";
import { LocalEmbeddingService } from "../chat-embedding";
import { toPgVectorString } from "../vector-utils";

/**
 * Analyzes query complexity to determine optimal search parameters
 */
function analyzeQueryComplexity(query: string): {
  complexity: "simple" | "medium" | "complex";
  tokenCount: number;
  semanticThreshold: number;
  keywordThreshold: number;
  maxResults: number;
} {
  const words = query.trim().split(/\s+/);
  const tokenCount = words.length;

  // Classify complexity
  let complexity: "simple" | "medium" | "complex";
  let semanticThreshold: number;
  let keywordThreshold: number;
  let maxResults: number;

  if (tokenCount <= 5) {
    // Simple queries (e.g., "how to install?")
    complexity = "simple";
    semanticThreshold = 0.78; // Very high threshold for simple queries to avoid noise
    keywordThreshold = 0.15;
    maxResults = 2; // Reduced results count
  } else if (tokenCount <= 15) {
    // Medium queries (e.g., "explain the difference between X and Y")
    complexity = "medium";
    semanticThreshold = 0.75; // High threshold
    keywordThreshold = 0.1;
    maxResults = 4;
  } else {
    // Complex queries (e.g., detailed questions with multiple clauses)
    complexity = "complex";
    semanticThreshold = 0.72; // Still relatively high
    keywordThreshold = 0.08;
    maxResults = 6;
  }

  return {
    complexity,
    tokenCount,
    semanticThreshold,
    keywordThreshold,
    maxResults,
  };
}

/**
 * Converts database row to LangChain message
 */
function rowToMessage(row: { role: string; content: string }): BaseMessage {
  return row.role === "human"
    ? new HumanMessage(row.content)
    : new AIMessage(row.content);
}

/**
 * Enhanced semantic + keyword hybrid search for messages
 */
async function searchMessagesHybrid(
  sessionId: string,
  vector: number[],
  query: string,
  params: ReturnType<typeof analyzeQueryComplexity>
): Promise<BaseMessage[]> {
  const vectorString = toPgVectorString(vector);

  // Prepare keyword search query (simple tokenization)
  const keywords = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2) // Filter short words
    .slice(0, 5); // Limit to top 5 keywords

  const tsQuery = keywords.join(" | "); // OR query

  try {
    // Hybrid search: Combine semantic and keyword search
    const results = await prisma.$queryRaw<
      Array<{
        role: string;
        content: string;
        semantic_score: number;
        keyword_rank: number;
        combined_score: number;
      }>
    >`
      WITH semantic_search AS (
        SELECT
          me.message_id,
          1 - (me.vector <=> ${vectorString}::vector) / 2 AS semantic_score
        FROM message_embeddings me
        WHERE me.session_id != ${sessionId}
          AND (1 - (me.vector <=> ${vectorString}::vector) / 2) >= ${params.semanticThreshold}
        ORDER BY me.vector <=> ${vectorString}::vector
        LIMIT ${params.maxResults * 2}
      ),
      keyword_search AS (
        SELECT
          cm.id as message_id,
          ts_rank(to_tsvector('english', cm.content), to_tsquery('english', ${tsQuery})) as keyword_rank
        FROM chat_messages cm
        WHERE cm.session_id != ${sessionId}
          AND to_tsvector('english', cm.content) @@ to_tsquery('english', ${tsQuery})
          AND ts_rank(to_tsvector('english', cm.content), to_tsquery('english', ${tsQuery})) >= ${params.keywordThreshold}
        LIMIT ${params.maxResults * 2}
      ),
      combined AS (
        SELECT
          COALESCE(ss.message_id, ks.message_id) as message_id,
          COALESCE(ss.semantic_score, 0) as semantic_score,
          COALESCE(ks.keyword_rank, 0) as keyword_rank,
          -- Combined score: 70% semantic, 30% keyword
          (COALESCE(ss.semantic_score, 0) * 0.7 + COALESCE(ks.keyword_rank, 0) * 0.3) as combined_score
        FROM semantic_search ss
        FULL OUTER JOIN keyword_search ks ON ss.message_id = ks.message_id
      )
      SELECT
        cm.role,
        cm.content,
        c.semantic_score,
        c.keyword_rank,
        c.combined_score
      FROM combined c
      JOIN chat_messages cm ON cm.id = c.message_id
      ORDER BY c.combined_score DESC
      LIMIT ${params.maxResults}
    `;

    console.log(
      `[Hybrid Search] Found ${results.length} messages (complexity: ${params.complexity}, threshold: ${params.semanticThreshold})`
    );

    return results.map((r) => rowToMessage({ role: r.role, content: r.content }));
  } catch (error) {
    console.error("Hybrid search failed, falling back to semantic only:", error);

    // Fallback: Pure semantic search
    const fallbackResults = await prisma.$queryRaw<
      Array<{
        role: string;
        content: string;
        score: number;
      }>
    >`
      SELECT
        cm.role,
        cm.content,
        1 - (me.vector <=> ${vectorString}::vector) / 2 AS score
      FROM message_embeddings me
      JOIN chat_messages cm ON cm.id = me.message_id
      WHERE me.session_id != ${sessionId}
        AND (1 - (me.vector <=> ${vectorString}::vector) / 2) >= ${params.semanticThreshold}
      ORDER BY me.vector <=> ${vectorString}::vector
      LIMIT ${params.maxResults}
    `;

    return fallbackResults.map((r) => rowToMessage({ role: r.role, content: r.content }));
  }
}

/**
 * Enhanced semantic search for memories (always high precision)
 */
async function searchMemories(
  vector: number[],
  maxResults: number = 3
): Promise<string[]> {
  const vectorString = toPgVectorString(vector);

    const results = await prisma.$queryRaw<
      Array<{
        content: string;
        score: number;
      }>
    >`
    SELECT
      um.content,
      1 - (me.vector <=> ${vectorString}::vector) / 2 AS score
    FROM memory_embeddings me
    JOIN user_memories um ON um.id = me.memory_id
    WHERE (1 - (me.vector <=> ${vectorString}::vector) / 2) >= 0.80
    ORDER BY me.vector <=> ${vectorString}::vector
    LIMIT ${maxResults}
  `;

  console.log(`[Memory Search] Found ${results.length} relevant memories`);

  return results.map((r) => r.content);
}

/**
 * Compresses context by extracting only relevant information using a lightweight LLM
 * Only runs if the total content length exceeds a threshold to avoid unnecessary latency
 */
async function compressContext(query: string, docs: BaseMessage[]): Promise<BaseMessage[]> {
  // Calculate approximate token count (1 token ~= 4 chars)
  const totalChars = docs.reduce((acc, doc) => acc + doc.content.length, 0);
  
  // Skip compression if content is reasonable size (e.g., < 8000 chars ~= 2000 tokens)
  // Modern LLMs handle this context size easily, so latency of compression outweighs the benefit
  if (totalChars < 8000) {
    return docs;
  }

  console.log(`[Context Compression] Triggered. Total length: ${totalChars} chars`);

  try {
    const config = chatConfig.getModelConfig();
    const baseUrl = chatConfig.getBaseUrl();

    // Use a lightweight model instance (or same model with lower temp)
    const model = new ChatAnthropic({
      model: config.model,
      apiKey: chatConfig.getApiKey(),
      temperature: 0, // Zero temperature for factual extraction
      maxRetries: 1,
      streaming: false, // Explicitly disable streaming for background tasks
      ...(baseUrl && {
        configuration: {
          baseURL: baseUrl,
        },
      }),
    });

    const contextText = docs
      .map((d, i) => `[Document ${i + 1}]: ${d.content}`)
      .join("\n\n");

    const systemPrompt = `You are a Context Compression Agent. Your task is to extract ONLY the sentences or facts from the provided documents that are directly relevant to answering the user's query.
    
Rules:
1. Keep the extracted information verbatim or close to original.
2. If a document has no relevant information, ignore it.
3. Do not add your own knowledge or opinions.
4. Output the result as a concise list of relevant facts/sentences.`;

    const response = await model.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage(`User Query: "${query}"\n\nDocuments:\n${contextText}`),
    ]);

    let compressedContent = "";
    if (typeof response.content === "string") {
      compressedContent = response.content;
    } else if (Array.isArray(response.content)) {
      compressedContent = response.content
        .map((block) => {
          if (typeof block === "string") return block;
          if (block.type === "text") return block.text;
          return "";
        })
        .join("");
    } else {
      compressedContent = JSON.stringify(response.content);
    }
    
    console.log(`[Context Compression] Compression complete. Length: ${contextText.length} -> ${compressedContent.length} chars`);

    // Return as a single system message containing the compressed context
    return [new SystemMessage(`Relevant Context (Compressed):\n${compressedContent}`)];
  } catch (error) {
    console.error("[Context Compression] Failed:", error);
    // Fallback: return original docs
    return docs;
  }
}

/**
 * Main enhanced RAG search with dynamic thresholding and hybrid search
 *
 * @param sessionId - The current session identifier (excluded from message search)
 * @param currentMessage - The current user message to find context for
 * @returns Array of relevant BaseMessage objects (system messages for memories, regular messages for history)
 */
export async function searchRelevantContextEnhanced(
  sessionId: string,
  currentMessage: string
): Promise<BaseMessage[]> {
  const config = chatConfig.getEmbeddingConfig();
  if (!config.enabled) return [];

  const sanitized = ChatValidator.sanitizeMessage(currentMessage);
  if (!sanitized.trim()) return [];

  // Analyze query complexity
  const queryParams = analyzeQueryComplexity(sanitized);
  console.log(
    `[RAG] Query complexity: ${queryParams.complexity} (${queryParams.tokenCount} words)`
  );

  // Generate embedding
  let vector: number[];
  try {
    const embeddingService = LocalEmbeddingService.getInstance();
    vector = await embeddingService.embedText(sanitized);

    if (!vector.length) {
      console.warn("Embedding service returned empty vector, skipping RAG");
      return [];
    }
  } catch (embeddingError) {
    console.error("Embedding generation failed:", embeddingError);
    return [];
  }

  try {
    // Parallel search: messages (hybrid) + memories (semantic)
    const [messages, memories] = await Promise.all([
      searchMessagesHybrid(sessionId, vector, sanitized, queryParams),
      searchMemories(vector, Math.ceil(queryParams.maxResults / 2)),
    ]);

    // Combine results
    let contextMessages: BaseMessage[] = [];

    if (memories.length > 0) {
      const memoryText = memories.map((m) => `- ${m}`).join("\n");
      contextMessages.push(
        new SystemMessage(`Recall these facts about the user/project:\n${memoryText}`)
      );
    }

    contextMessages.push(...messages);

    console.log(
      `[RAG] Total context before compression: ${memories.length} memories + ${messages.length} messages`
    );

    // Apply Context Compression
    if (contextMessages.length > 0) {
      contextMessages = await compressContext(sanitized, contextMessages);
    }

    return contextMessages;
  } catch (error) {
    console.error("Error searching relevant context:", error);
    return [];
  }
}
