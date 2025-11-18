/**
 * Metrics and monitoring for chat API
 */

import { ChatMetrics } from "./chat-types";

export class MetricsCollector {
  private static metrics: ChatMetrics[] = [];
  private static readonly MAX_METRICS = 1000;

  /**
   * Start tracking a request
   */
  static startRequest(
    modelUsed: string,
    userId?: string
  ): string {
    const requestId = this.generateRequestId();
    const metric: ChatMetrics = {
      requestId,
      startTime: Date.now(),
      modelUsed,
      userId,
    };

    this.metrics.push(metric);

    // Keep only recent metrics
    if (this.metrics.length > this.MAX_METRICS) {
      this.metrics = this.metrics.slice(-this.MAX_METRICS);
    }

    return requestId;
  }

  /**
   * Complete request tracking
   */
  static completeRequest(
    requestId: string,
    tokensUsed?: number,
    error?: string
  ): void {
    const metric = this.metrics.find((m) => m.requestId === requestId);
    if (metric) {
      metric.endTime = Date.now();
      metric.tokensUsed = tokensUsed;
      metric.error = error;
    }
  }

  /**
   * Get metrics for a time range
   */
  static getMetrics(startTime?: number, endTime?: number): ChatMetrics[] {
    const now = Date.now();
    const start = startTime || now - 60 * 60 * 1000; // Last hour by default
    const end = endTime || now;

    return this.metrics.filter(
      (m) => m.startTime >= start && m.startTime <= end
    );
  }

  /**
   * Get aggregated statistics
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
   * Log metrics (can be extended to send to external services)
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

  /**
   * Generate unique request ID
   */
  private static generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Clear old metrics
   */
  static clearOldMetrics(olderThanMs: number): void {
    const cutoff = Date.now() - olderThanMs;
    this.metrics = this.metrics.filter((m) => m.startTime >= cutoff);
  }
}
