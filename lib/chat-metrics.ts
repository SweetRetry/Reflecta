import { nanoid } from "nanoid";
import { ChatMetrics } from "./chat-types";

/**
 * Metrics collector for tracking chat request performance
 * Stores metrics in-memory with configurable retention limit
 */
export class MetricsCollector {
  private static metrics: ChatMetrics[] = [];
  private static readonly MAX_METRICS = 1000;

  /**
   * Starts tracking a new request
   * @param modelUsed - Model name used for this request
   * @param userId - Optional user ID
   * @returns Request ID for tracking
   */
  static startRequest(modelUsed: string, userId?: string): string {
    const requestId = `req_${nanoid()}`;
    const metric: ChatMetrics = {
      requestId,
      startTime: Date.now(),
      modelUsed,
      userId,
    };

    this.metrics.push(metric);
    if (this.metrics.length > this.MAX_METRICS) {
      this.metrics = this.metrics.slice(-this.MAX_METRICS);
    }
    return requestId;
  }

  /**
   * Completes tracking for a request
   * @param requestId - Request ID from startRequest
   * @param tokensUsed - Number of tokens used (optional)
   * @param error - Error message if request failed (optional)
   */
  static completeRequest(requestId: string, tokensUsed?: number, error?: string): void {
    const metric = this.metrics.find((m) => m.requestId === requestId);
    if (metric) {
      metric.endTime = Date.now();
      metric.tokensUsed = tokensUsed;
      metric.error = error;
    }
  }

  /**
   * Gets statistics for requests within a time range
   * @param timeRangeMs - Time range in milliseconds (default: 1 hour)
   * @returns Statistics object with request counts, response times, and token usage
   */
  static getStatistics(timeRangeMs: number = 60 * 60 * 1000) {
    const now = Date.now();
    const recentMetrics = this.metrics.filter(
      (m) => m.startTime >= now - timeRangeMs
    );

    if (recentMetrics.length === 0) {
      return {
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        averageResponseTime: 0,
        totalTokensUsed: 0,
      };
    }

    const completedMetrics = recentMetrics.filter((m) => m.endTime);
    const responseTimes = completedMetrics.map(
      (m) => m.endTime! - m.startTime
    );
    const successfulRequests = recentMetrics.filter((m) => !m.error).length;

    return {
      totalRequests: recentMetrics.length,
      successfulRequests,
      failedRequests: recentMetrics.length - successfulRequests,
      averageResponseTime:
        responseTimes.length > 0
          ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
          : 0,
      totalTokensUsed: recentMetrics.reduce(
        (sum, m) => sum + (m.tokensUsed || 0),
        0
      ),
    };
  }

  /**
   * Logs metrics for a specific request to console
   * @param requestId - Request ID to log metrics for
   */
  static logMetrics(requestId: string): void {
    const metric = this.metrics.find((m) => m.requestId === requestId);
    if (!metric) return;

    const duration = metric.endTime
      ? metric.endTime - metric.startTime
      : "incomplete";

    console.log(
      JSON.stringify({
        type: "chat_metrics",
        requestId: metric.requestId,
        duration,
        tokensUsed: metric.tokensUsed,
        model: metric.modelUsed,
        error: metric.error,
        userId: metric.userId,
        timestamp: new Date(metric.startTime).toISOString(),
      })
    );
  }
}
