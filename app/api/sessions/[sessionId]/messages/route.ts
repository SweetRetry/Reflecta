import { NextRequest } from "next/server";
import { getHistoryWithTimestamps } from "@/lib/chat-memory";
import { ChatHistoryMessage } from "@/lib/chat-types";

function createErrorResponse(message: string, status: number = 500): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * GET handler to retrieve chat history for a specific session
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { sessionId: string } }
) {
  const { sessionId } = params;

  if (!sessionId) {
    return createErrorResponse("Session ID is required", 400);
  }

  try {
    const history: ChatHistoryMessage[] = await getHistoryWithTimestamps(sessionId);
    return new Response(JSON.stringify({ messages: history }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error(`Error loading history for session ${sessionId}:`, error);
    return createErrorResponse(
      error instanceof Error ? error.message : "Failed to load history",
      500
    );
  }
}
