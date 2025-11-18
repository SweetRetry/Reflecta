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
import { BaseMessage, HumanMessage, SystemMessage, AIMessage } from "@langchain/core/messages";
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

// Task planning schema
const TaskPlanSchema = z.object({
  needsTools: z.boolean().describe("Whether this task requires external tools"),
  toolType: z.enum(["search", "calculate", "none"]).describe("Which tool to use"),
  toolQuery: z.string().optional().describe("The query/expression for the tool"),
  reasoning: z.string().describe("Why this approach was chosen"),
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
});

export type ChatAgentState = typeof ChatAgentStateAnnotation.State;

// --- Helper: Get model instance ---
function getModelInstance(temperature: number = 0.7): ChatAnthropic {
  const config = chatConfig.getModelConfig();
  const baseUrl = chatConfig.getBaseUrl();

  return new ChatAnthropic({
    model: config.model,
    apiKey: chatConfig.getApiKey(),
    temperature,
    maxRetries: 2,
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

  const systemPrompt = `You are a task planning agent. Analyze the user's message to determine if external tools are needed.

Available tools:
1. **search**: Web search for real-time information, current events, or factual data${searchAvailable ? "" : " (currently unavailable - requires API key)"}
2. **calculate**: Mathematical calculations or data processing
3. **none**: Answer directly using your knowledge and provided context

Guidelines:
- Use "search" if the question requires${searchAvailable ? ":" : " (but check if API is configured first):"}
  - Current/recent information (news, prices, weather, etc.)
  - Specific factual data you're not confident about
  - Real-time data or updates
- Use "calculate" for:
  - Math problems
  - Data analysis
- Use "none" for:
  - General knowledge questions
  - Creative writing
  - Advice based on context
  - Conversational responses${searchAvailable ? "" : "\n  - Questions requiring search (explain search is unavailable)"}`;

  try {
    const modelWithStructure = model.withStructuredOutput(TaskPlanSchema, {
      name: "plan_task",
    });

    const result = await modelWithStructure.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage(`User message: "${currentMessage}"\n\nWhat approach should we take?`),
    ]);

    console.log(`Task Plan: ${result.toolType} - ${result.reasoning}`);

    return {
      toolCall: {
        tool: result.toolType,
        query: result.toolQuery,
      },
    };
  } catch (error) {
    console.error("Error planning task:", error);
    // Fallback: no tool
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
 */
async function generateResponse(state: ChatAgentState): Promise<Partial<ChatAgentState>> {
  console.log("--- Chat Agent: Generating Response ---");
  const { messages, contextMessages, currentMessage, toolCall } = state;

  const model = getModelInstance(); // Normal temperature

  // Build system message with tool results
  let systemContent = "You are a helpful AI assistant with access to the user's conversation history and extracted memories.";

  if (toolCall?.result && toolCall.tool !== "none") {
    systemContent += `\n\nTool Result (${toolCall.tool}):\n${toolCall.result}`;
  }

  // Combine all messages
  const allMessages: BaseMessage[] = [
    new SystemMessage(systemContent),
    ...contextMessages,
    ...messages,
    new HumanMessage(currentMessage),
  ];

  try {
    const response = await model.invoke(allMessages);
    const finalResponse = typeof response.content === "string"
      ? response.content
      : JSON.stringify(response.content);

    return {
      finalResponse,
    };
  } catch (error) {
    console.error("Error generating response:", error);
    return {
      finalResponse: "I apologize, but I encountered an error generating a response. Please try again.",
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
