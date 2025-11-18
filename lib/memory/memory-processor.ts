/**
 * Background memory processing with Memory Graph integration
 * Handles conversation saving and reflective memory extraction
 */

import { saveToMemory, getMemoryForSession } from "./memory-storage";
import { createMemoryGraph } from "../agents/memory-graph";

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
): Promise<void> {
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
