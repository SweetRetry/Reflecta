/**
 * Chat Agent Graph - Intelligent conversation orchestration with tool calling
 *
 * Features:
 * - Task planning and decomposition
 * - Conditional tool routing (search, calculate, etc.)
 * - Context-aware response generation
 * - Integration with RAG memory system
 */

import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
import { BaseMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatAnthropic } from "@langchain/anthropic";
import { chatConfig } from "@/lib/chat-config";
import { performWebSearch, formatSearchResults, isSearchAvailable } from "@/lib/tools/search-tool";
import { z } from "zod";

// Tool call types
export type ToolCall = {
  tool: "search" | "calculate" | "none";
  query?: string;
  expression?: string;
  result?: string;
};

// Task planning schema with defaults for better reliability
const TaskPlanSchema = z.object({
  toolType: z.enum(["search", "calculate", "none"]).describe("Which tool to use: 'search' for web lookups, 'calculate' for math, 'none' for direct response"),
  toolQuery: z.string().optional().describe("The search query or calculation expression (only if toolType is 'search' or 'calculate')"),
  reasoning: z.string().default("Direct response").describe("Brief explanation of why this approach was chosen"),
});

// State definition
const ChatAgentStateAnnotation = Annotation.Root({
  sessionId: Annotation<string>({
    reducer: (x, y) => y ?? x,
    default: () => "",
  }),
  messages: Annotation<BaseMessage[]>({
    reducer: (x, y) => y ?? x,
    default: () => [],
  }),
  contextMessages: Annotation<BaseMessage[]>({
    reducer: (x, y) => y ?? x,
    default: () => [],
  }),
  currentMessage: Annotation<string>({
    reducer: (x, y) => y ?? x,
    default: () => "",
  }),
  toolCall: Annotation<ToolCall | null>({
    reducer: (x, y) => y ?? x,
    default: () => null,
  }),
  finalResponse: Annotation<string>({
    reducer: (x, y) => y ?? x,
    default: () => "",
  }),
  thinking: Annotation<string>({
    reducer: (x, y) => y ?? x,
    default: () => "",
  }),
});

export type ChatAgentState = typeof ChatAgentStateAnnotation.State;

// --- Helper: Get model instance ---
function getModelInstance(temperature: number = 0.7, streaming: boolean = false): ChatAnthropic {
  const config = chatConfig.getModelConfig();
  const baseUrl = chatConfig.getBaseUrl();

  return new ChatAnthropic({
    model: config.model,
    apiKey: chatConfig.getApiKey(),
    temperature,
    maxRetries: 2,
    streaming,
    ...(baseUrl && {
      configuration: {
        baseURL: baseUrl,
      },
    }),
  });
}

// --- Node 1: Plan Task ---
/**
 * Analyzes the user's message to determine if tools are needed
 * Uses structured output for reliable JSON parsing
 */
async function planTask(state: ChatAgentState): Promise<Partial<ChatAgentState>> {
  console.log("--- Chat Agent: Planning Task ---");
  const { currentMessage } = state;

  const model = getModelInstance(0.3); // Low temperature for planning

  const searchAvailable = isSearchAvailable();

  const systemPrompt = `You are a task routing agent. Analyze the user's message and choose the appropriate tool.

**Available Tools:**
1. "search" - Web search for real-time information${searchAvailable ? "" : " (UNAVAILABLE - no API key)"}
2. "calculate" - Mathematical computation
3. "none" - Direct response using your knowledge

**Guidelines:**
- Use "search" for: current events, real-time data, recent facts
- Use "calculate" for: math operations, numerical computations
- Use "none" for: general questions, code help, creative tasks, conversation
${searchAvailable ? "" : "- Since search is unavailable, use \"none\" for search queries and explain the limitation"}

**IMPORTANT:** You MUST return a JSON object with:
- toolType: one of "search", "calculate", or "none"
- toolQuery: the query/expression (only if using search or calculate)
- reasoning: brief explanation of your choice

Default to "none" if uncertain.`;


  try {
    const modelWithStructure = model.withStructuredOutput(TaskPlanSchema, {
      name: "plan_task",
      includeRaw: false,
    });

    const result = await modelWithStructure.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage(`User message: "${currentMessage}"\n\nAnalyze and choose the appropriate tool.`),
    ]);

    // Validate result
    if (!result || !result.toolType) {
      console.warn("Invalid task plan result, using fallback");
      return {
        toolCall: {
          tool: "none",
        },
      };
    }

    console.log(`✓ Task Plan: ${result.toolType}${result.toolQuery ? ` (query: ${result.toolQuery.substring(0, 50)}...)` : ""}`);

    return {
      toolCall: {
        tool: result.toolType,
        query: result.toolQuery,
      },
    };
  } catch (error) {
    // Enhanced error logging for debugging
    console.error("⚠️ Error planning task:", error);
    if (error instanceof Error) {
      console.error("Error details:", {
        name: error.name,
        message: error.message,
        // Log additional context if available
        ...(error as any).llmOutput && { llmOutput: (error as any).llmOutput },
      });
    }

    // Fallback: no tool (safe default)
    console.log("→ Falling back to direct response (no tool)");
    return {
      toolCall: {
        tool: "none",
      },
    };
  }
}

// --- Node 2: Execute Web Search ---
/**
 * Performs web search using the configured search tool
 * Currently uses a placeholder - integrate with Tavily/SerpAPI
 */
async function executeSearch(state: ChatAgentState): Promise<Partial<ChatAgentState>> {
  console.log("--- Chat Agent: Executing Search ---");
  const { toolCall } = state;

  if (!toolCall?.query) {
    return {
      toolCall: {
        ...toolCall!,
        result: "Error: No search query provided",
      },
    };
  }

  try {
    const searchResponse = await performWebSearch(toolCall.query);
    const formattedResults = formatSearchResults(searchResponse);

    console.log(`Search completed: ${searchResponse.results.length} results found`);

    return {
      toolCall: {
        ...toolCall!,
        result: formattedResults,
      },
    };
  } catch (error) {
    console.error("Search error:", error);
    return {
      toolCall: {
        ...toolCall!,
        result: `Search failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      },
    };
  }
}

// --- Node 3: Execute Calculation ---
/**
 * Performs mathematical calculations
 */
async function executeCalculation(state: ChatAgentState): Promise<Partial<ChatAgentState>> {
  console.log("--- Chat Agent: Executing Calculation ---");
  const { toolCall } = state;

  if (!toolCall?.expression) {
    return {
      toolCall: {
        ...toolCall!,
        result: "Error: No expression provided",
      },
    };
  }

  try {
    // Safe math evaluation (basic implementation)
    const result = evaluateExpression(toolCall.expression);

    console.log(`Calculation result: ${result}`);

    return {
      toolCall: {
        ...toolCall!,
        result: result.toString(),
      },
    };
  } catch (error) {
    console.error("Calculation error:", error);
    return {
      toolCall: {
        ...toolCall!,
        result: `Calculation failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      },
    };
  }
}

// --- Node 4: Generate Response ---
/**
 * Generates the final response using LLM with context and tool results
 * Note: This node is now designed to be streamed directly
 */
async function generateResponse(state: ChatAgentState): Promise<Partial<ChatAgentState>> {
  console.log("--- Chat Agent: Generating Response ---");
  const { messages, contextMessages, currentMessage, toolCall } = state;

  // Use streaming enabled model instance
  const model = getModelInstance(0.7, true); 

  // Build system message with tool results
  let systemContent = `You are a knowledgeable and context-aware AI assistant. Your capabilities include:

📚 **Memory & Context Access:**
- Full conversation history: All previous messages in this session
- Long-term memories: Key facts, preferences, and details about the user/project
- Semantic context: Related discussions from other sessions (when relevant)

🎯 **Response Guidelines:**
1. **Contextual Awareness**: Always reference relevant history when answering questions about past conversations
2. **Memory Integration**: Naturally incorporate user preferences and project details into your responses
3. **Language Adaptation**: Match the user's language and communication style
4. **Honesty**: If information isn't in the context or memories, say so clearly
5. **Conciseness**: Be thorough but avoid unnecessary verbosity

⚠️ **Critical**: When users ask about previous conversations, their preferences, or identity:
- DO use the provided conversation history and memories
- DO NOT claim lack of access to information that's clearly in your context
- BE specific by referencing actual content from the history`;

  if (toolCall?.result && toolCall.tool !== "none") {
    systemContent += `\n\n🔍 **Tool Result (${toolCall.tool}):**\n${toolCall.result}`;
  }

  // Extract system messages from context and merge them
  const contextSystemMessages = contextMessages.filter(
    (msg) => msg instanceof SystemMessage
  ) as SystemMessage[];
  const contextNonSystemMessages = contextMessages.filter(
    (msg) => !(msg instanceof SystemMessage)
  );

  const messagesSystemMessages = messages.filter(
    (msg) => msg instanceof SystemMessage
  ) as SystemMessage[];
  const messagesNonSystem = messages.filter(
    (msg) => !(msg instanceof SystemMessage)
  );

  // Merge all system message contents into one
  for (const sysMsg of [...contextSystemMessages, ...messagesSystemMessages]) {
    systemContent += `\n\n${sysMsg.content}`;
  }

  // Combine all messages with system message first, then non-system messages only
  const allMessages: BaseMessage[] = [
    new SystemMessage(systemContent),
    ...contextNonSystemMessages,
    ...messagesNonSystem,
    new HumanMessage(currentMessage),
  ];

  // Debug logging
  console.log(`[Debug] Context: ${contextMessages.length} total (${contextSystemMessages.length} system, ${contextNonSystemMessages.length} non-system)`);
  console.log(`[Debug] Messages: ${messages.length} total (${messagesSystemMessages.length} system, ${messagesNonSystem.length} non-system)`);
  console.log(`[Debug] Final allMessages: ${allMessages.length} messages`);
  console.log(`[Debug] System content preview: ${systemContent.substring(0, 500)}...`);

  try {
    // We return the model response directly. 
    // When using .streamEvents() on the graph, this will yield chunks.
    const response = await model.invoke(allMessages);

    // Extract text and thinking content from response
    let finalResponse: string;
    let thinking: string = "";

    if (typeof response.content === "string") {
      finalResponse = response.content;
    } else if (Array.isArray(response.content)) {
      // Handle array of content blocks (e.g., thinking + text blocks)
      const textBlocks = response.content
        .filter((block: any) => block.type === "text")
        .map((block: any) => block.text);
      finalResponse = textBlocks.join("\n");

      // Extract thinking blocks
      const thinkingBlocks = response.content
        .filter((block: any) => block.type === "thinking")
        .map((block: any) => block.thinking);
      thinking = thinkingBlocks.join("\n\n");
    } else {
      finalResponse = JSON.stringify(response.content);
    }

    return {
      finalResponse,
      thinking,
    };
  } catch (error) {
    console.error("Error generating response:", error);
    return {
      finalResponse: "I apologize, but I encountered an error generating a response. Please try again.",
      thinking: "",
    };
  }
}

// --- Conditional Edge: Route to appropriate tool or response ---
function routeToTool(state: ChatAgentState): string {
  const { toolCall } = state;

  if (!toolCall || toolCall.tool === "none") {
    return "respond";
  }

  if (toolCall.tool === "search") {
    return "search";
  }

  if (toolCall.tool === "calculate") {
    return "calculate";
  }

  return "respond";
}

// --- Helper Functions ---

/**
 * Safe mathematical expression evaluator
 * Uses Function constructor with restricted scope
 */
function evaluateExpression(expression: string): number {
  // Sanitize input: allow only numbers, operators, and basic math functions
  const sanitized = expression.replace(/[^0-9+\-*/().\s]/g, "");

  if (sanitized !== expression) {
    throw new Error("Invalid characters in expression");
  }

  try {
    // Use Function constructor in restricted scope
    const result = Function(`"use strict"; return (${sanitized})`)();

    if (typeof result !== "number" || !isFinite(result)) {
      throw new Error("Result is not a valid number");
    }

    return result;
  } catch (error) {
    throw new Error(`Invalid expression: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}

// --- Graph Construction ---

/**
 * Creates and compiles the Chat Agent workflow graph
 *
 * Flow:
 * 1. Plan task → Determine if tools needed
 * 2. Route to appropriate tool or direct response
 * 3. Execute tool if needed
 * 4. Generate final response with all context
 *
 * @returns Compiled StateGraph ready to invoke
 */
export function createChatAgentGraph() {
  const workflow = new StateGraph(ChatAgentStateAnnotation)
    .addNode("plan", planTask)
    .addNode("search", executeSearch)
    .addNode("calculate", executeCalculation)
    .addNode("respond", generateResponse)
    .addEdge(START, "plan")
    .addConditionalEdges("plan", routeToTool, {
      search: "search",
      calculate: "calculate",
      respond: "respond",
    })
    .addEdge("search", "respond")
    .addEdge("calculate", "respond")
    .addEdge("respond", END);

  return workflow.compile();
}

/**
 * Convenience function to invoke the chat agent
 *
 * @param sessionId - Session identifier
 * @param currentMessage - User's current message
 * @param messages - Conversation history
 * @param contextMessages - RAG context messages
 * @returns Final response string
 */
export async function invokeChatAgent(
  sessionId: string,
  currentMessage: string,
  messages: BaseMessage[],
  contextMessages: BaseMessage[]
): Promise<string> {
  const graph = createChatAgentGraph();

  const result = await graph.invoke({
    sessionId,
    currentMessage,
    messages,
    contextMessages,
  });

  return result.finalResponse;
}
