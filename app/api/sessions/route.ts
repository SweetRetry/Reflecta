import { getRecentSessions } from "@/lib/chat-memory";
import { SessionSummary } from "@/lib/chat-types";

function createErrorResponse(message: string, status: number = 500): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * GET handler to retrieve recent sessions
 */
export async function GET() {
  try {
    const sessions: SessionSummary[] = await getRecentSessions();
    return new Response(JSON.stringify({ sessions }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error loading sessions:", error);
    return createErrorResponse(
      error instanceof Error ? error.message : "Failed to load sessions",
      500
    );
  }
}
