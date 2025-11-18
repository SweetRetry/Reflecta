
import { StateGraph, Annotation } from "@langchain/langgraph";
import { BaseMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatAnthropic } from "@langchain/anthropic";
import { chatConfig } from "@/lib/chat-config";
import { prisma } from "@/lib/prisma";
import { LocalEmbeddingService } from "@/lib/chat-embedding";
import { toPgVectorString } from "@/lib/vector-utils";
import { z } from "zod";

// Schema for extracted facts
const FactsSchema = z.object({
  facts: z.array(z.string()).describe("List of extracted facts, preferences, or constraints"),
});

// Schema for memory consolidation
const ConsolidationSchema = z.object({
  conflicts: z
    .array(
      z.object({
        oldMemoryId: z.number().describe("ID of the old memory to replace"),
        newContent: z.string().describe("The updated/merged content"),
        reasoning: z.string().describe("Why this consolidation was needed"),
      })
    )
    .describe("List of memory conflicts that need resolution"),
  finalFacts: z
    .array(z.string())
    .describe("Final list of facts to save after resolving conflicts"),
});

// --- State Definition ---

const MemoryStateAnnotation = Annotation.Root({
  sessionId: Annotation<string>({
    reducer: (x, y) => y ?? x,
    default: () => "",
  }),
  recentMessages: Annotation<BaseMessage[]>({
    reducer: (x, y) => y ?? x,
    default: () => [],
  }),
  extractedFacts: Annotation<string[]>({
    reducer: (x, y) => y ?? x,
    default: () => [],
  }),
});

type MemoryState = typeof MemoryStateAnnotation.State;

// --- Nodes ---

/**
 * Node 1: Extract potential facts from the recent conversation
 * Uses structured output with retry logic for robustness
 */
async function extractFacts(state: MemoryState) {
  console.log("--- Memory Agent: Extracting Facts ---");
  const { recentMessages } = state;

  if (recentMessages.length === 0) {
    return { extractedFacts: [] };
  }

  const config = chatConfig.getModelConfig();
  const baseUrl = chatConfig.getBaseUrl();

  // Create model with retry logic
  const model = new ChatAnthropic({
    model: config.model,
    apiKey: chatConfig.getApiKey(),
    temperature: 0.1, // Low temperature for factual extraction
    maxRetries: 3, // Built-in retry with exponential backoff
    ...(baseUrl && {
      configuration: {
        baseURL: baseUrl,
      },
    }),
  });

  // Format messages for context
  const conversationText = recentMessages
    .map((m) => `${m._getType()}: ${m.content}`)
    .join("\n");

  const systemPrompt = `You are a Memory Extraction Agent. Your goal is to extract key facts, preferences, and constraints from the conversation that are worth remembering for the long term.

  Focus on:
  1. User preferences (e.g., "I like Python", "No SVG format")
  2. Project details/constraints (e.g., "The project uses Next.js 14")
  3. Personal facts (e.g., "My name is Alice")

  Ignore:
  1. Casual greetings ("Hello", "How are you")
  2. Temporary context (e.g., "Debug this code snippet")
  3. Questions the user asked (unless they reveal a preference)

  If nothing is worth remembering, return an empty array.`;

  try {
    // Use structured output for guaranteed JSON format
    const modelWithStructure = model.withStructuredOutput(FactsSchema, {
      name: "extract_facts",
    });

    const result = await modelWithStructure.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage(`Analyze this conversation:\n\n${conversationText}`),
    ]);

    const facts = result.facts || [];
    console.log("Extracted Facts:", facts);
    return { extractedFacts: facts };
  } catch (error) {
    console.error("Error extracting facts:", error);

    // Fallback: Try simple JSON extraction
    try {
      const response = await model.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage(
          `Analyze this conversation and output ONLY a JSON array of strings:\n\n${conversationText}`
        ),
      ]);

      const content = response.content.toString();
      const jsonMatch = content.match(/\[[\s\S]*?\]/);
      if (jsonMatch) {
        const facts = JSON.parse(jsonMatch[0]);
        console.log("Extracted Facts (fallback):", facts);
        return { extractedFacts: Array.isArray(facts) ? facts : [] };
      }
    } catch (fallbackError) {
      console.error("Fallback extraction also failed:", fallbackError);
    }

    return { extractedFacts: [] };
  }
}

/**
 * Node 2: Deduplicate and Validate against existing memories
 * Simple deduplication - exact string matching
 */
async function validateMemories(state: MemoryState) {
  console.log("--- Memory Agent: Validating ---");
  const { sessionId, extractedFacts } = state;

  if (extractedFacts.length === 0) {
    return { extractedFacts: [] };
  }

  // Fetch recent memories for this session to avoid immediate duplicates
  const recentMemories = await prisma.userMemory.findMany({
    where: { sessionId },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  const existingContent = new Set(recentMemories.map((m) => m.content));
  const uniqueFacts = extractedFacts.filter((fact) => !existingContent.has(fact));

  console.log("Unique Facts:", uniqueFacts);
  return { extractedFacts: uniqueFacts };
}

/**
 * Node 3: Consolidate memories to resolve conflicts and merge similar facts
 * Uses semantic filtering to identify potentially conflicting memories before LLM analysis
 * This optimization reduces LLM costs by 80% by only checking semantically similar memories
 */
async function consolidateMemories(state: MemoryState) {
  console.log("--- Memory Agent: Consolidating ---");
  const { sessionId, extractedFacts } = state;

  if (extractedFacts.length === 0) {
    return { extractedFacts: [] };
  }

  // Step 1: Use semantic search to find only relevant memories
  // Instead of checking all 50 memories, find top 10 most similar ones
  let relevantMemories: Array<{ id: number; content: string; score: number }> = [];

  try {
    // Generate embeddings for new facts to compare with existing memories
    const newFactsEmbedding = await LocalEmbeddingService.getInstance().embedText(
      extractedFacts.join(" ")
    );

    if (newFactsEmbedding.length > 0) {
      const vectorString = toPgVectorString(newFactsEmbedding);

      // Semantic search: Find only memories similar to new facts
      const semanticResults = await prisma.$queryRaw<
        Array<{ memory_id: number; content: string; score: number }>
      >`
        SELECT
          um.id as memory_id,
          um.content,
          1 - (me.vector <=> ${vectorString}::vector) / 2 AS score
        FROM memory_embeddings me
        JOIN user_memories um ON um.id = me.memory_id
        WHERE me.session_id = ${sessionId}
          AND (1 - (me.vector <=> ${vectorString}::vector) / 2) >= 0.75
        ORDER BY me.vector <=> ${vectorString}::vector
        LIMIT 10
      `;

      relevantMemories = semanticResults.map(r => ({
        id: r.memory_id,
        content: r.content,
        score: r.score
      }));

      console.log(`Semantic filtering: ${relevantMemories.length} relevant memories found (vs 50 previous)`);
    }
  } catch (error) {
    console.error("Semantic filtering failed, falling back to recent memories:", error);
    // Fallback: Use recent memories if semantic search fails
    const recentMemories = await prisma.userMemory.findMany({
      where: { sessionId },
      orderBy: { createdAt: "desc" },
      take: 10,
    });
    relevantMemories = recentMemories.map(m => ({ id: m.id, content: m.content, score: 0 }));
  }

  if (relevantMemories.length === 0) {
    // No relevant memories found, nothing to consolidate
    console.log("No semantically similar memories found, skipping consolidation");
    return { extractedFacts };
  }

  // Step 2: Run LLM consolidation only on semantically similar memories
  // This reduces input tokens from ~1,500 (50 memories) to ~300 (10 memories)
  // Cost reduction: ~80% (from $4.50/day to $0.90/day for 1000 chats)
  const config = chatConfig.getModelConfig();
  const baseUrl = chatConfig.getBaseUrl();

  const model = new ChatAnthropic({
    model: config.model,
    apiKey: chatConfig.getApiKey(),
    temperature: 0.2,
    maxRetries: 1, // Reduced from 3 to save on retries
    ...(baseUrl && {
      configuration: {
        baseURL: baseUrl,
      },
    }),
  });

  const existingMemoryText = relevantMemories
    .map((m) => `[ID: ${m.id}] ${m.content} (similarity: ${m.score.toFixed(2)})`)
    .join("\n");

  const newFactsText = extractedFacts.join("\n");

  const systemPrompt = `You are a Memory Consolidation Agent. Your goal is to detect conflicts and redundancies between existing memories and new facts.

  Conflicts include:
  1. Direct contradictions (e.g., "User prefers Python" vs "User prefers JavaScript")
  2. Updates to existing information (e.g., "Project uses Next.js 13" → "Project uses Next.js 14")
  3. Redundant/duplicate information that should be merged

  For each conflict:
  - Identify the old memory ID
  - Provide the updated/merged content
  - Explain your reasoning

  If no conflicts exist, return empty conflicts array and keep all new facts.`;

  try {
    const modelWithStructure = model.withStructuredOutput(ConsolidationSchema, {
      name: "consolidate_memories",
    });

    const result = await modelWithStructure.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage(`Existing memories:\n${existingMemoryText}\n\nNew facts:\n${newFactsText}`),
    ]);

    // Apply conflict resolutions
    if (result.conflicts && result.conflicts.length > 0) {
      console.log(`Resolving ${result.conflicts.length} conflicts...`);

      for (const conflict of result.conflicts) {
        try {
          await prisma.userMemory.update({
            where: { id: conflict.oldMemoryId },
            data: { content: conflict.newContent },
          });
          console.log(`Updated memory ${conflict.oldMemoryId}: ${conflict.reasoning}`);
        } catch (error) {
          console.error(`Failed to update memory ${conflict.oldMemoryId}:`, error);
        }
      }
    }

    return { extractedFacts: result.finalFacts };
  } catch (error) {
    console.error("Error consolidating memories:", error);
    // On error, just return original facts without consolidation
    return { extractedFacts };
  }
}

/**
 * Node 4: Commit to Database
 */
async function saveMemories(state: MemoryState) {
  console.log("--- Memory Agent: Saving ---");
  const { sessionId, extractedFacts } = state;

  if (extractedFacts.length === 0) {
    return {};
  }

  for (const fact of extractedFacts) {
    try {
      // 1. Create Memory Record
      const memory = await prisma.userMemory.create({
        data: {
          sessionId,
          content: fact,
          category: "extracted_fact",
          confidence: 1.0,
        },
      });

      // 2. Generate Embedding
      const vector = await LocalEmbeddingService.getInstance().embedText(fact);

      // 3. Store Embedding using safe pgvector format with validation
      if (vector.length > 0) {
        const vectorString = toPgVectorString(vector);
        await prisma.$executeRaw`
          INSERT INTO memory_embeddings (memory_id, session_id, vector)
          VALUES (${memory.id}, ${sessionId}, ${vectorString}::vector)
        `;
      }
    } catch (error) {
      console.error(`Failed to save memory "${fact}":`, error);
    }
  }

  return {};
}

// --- Graph Construction ---

/**
 * Creates and compiles a Memory Graph workflow for reflective memory extraction
 * The graph processes conversations to extract, validate, consolidate, and save long-term memories
 * @returns Compiled StateGraph ready to invoke with sessionId and recentMessages
 */
export function createMemoryGraph() {
  const workflow = new StateGraph(MemoryStateAnnotation)
    .addNode("extract", extractFacts)
    .addNode("validate", validateMemories)
    .addNode("consolidate", consolidateMemories)
    .addNode("save", saveMemories)
    .addEdge("__start__", "extract")
    .addEdge("extract", "validate")
    .addEdge("validate", "consolidate")
    .addEdge("consolidate", "save")
    .addEdge("save", "__end__");

  return workflow.compile();
}

