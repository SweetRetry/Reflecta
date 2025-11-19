import { MetricsCollector } from "@/lib/chat-metrics";

function createErrorResponse(message: string, status: number = 500): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * GET handler to retrieve API statistics
 */
export async function GET() {
  try {
    const stats = MetricsCollector.getStatistics();
    return new Response(JSON.stringify(stats), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("GET /api/stats error:", error);
    return createErrorResponse("Failed to process request", 500);
  }
}
