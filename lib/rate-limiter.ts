/**
 * Rate limiting implementation for chat API
 */

import { RateLimitConfig } from "./chat-types";

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

/**
 * Rate limiter implementation using in-memory storage
 * Tracks requests per identifier (IP or user ID) with configurable limits
 */
export class RateLimiter {
  private store: Map<string, RateLimitEntry> = new Map();
  private cleanupInterval: NodeJS.Timeout;

  constructor(private config: RateLimitConfig) {
    // Cleanup expired entries every minute
    this.cleanupInterval = setInterval(
      () => this.cleanup(),
      60 * 1000
    );
  }

  /**
   * Check if request should be rate limited
   * @param identifier - Unique identifier (IP address or user ID)
   * @returns Rate limit check result with allowed status, remaining requests, and reset time
   */
  checkLimit(identifier: string): {
    allowed: boolean;
    remaining: number;
    resetTime: number;
  } {
    const now = Date.now();
    const entry = this.store.get(identifier);

    // No existing entry or expired
    if (!entry || now > entry.resetTime) {
      const newEntry: RateLimitEntry = {
        count: 1,
        resetTime: now + this.config.windowMs,
      };
      this.store.set(identifier, newEntry);

      return {
        allowed: true,
        remaining: this.config.maxRequestsPerMinute - 1,
        resetTime: newEntry.resetTime,
      };
    }

    // Check if limit exceeded
    if (entry.count >= this.config.maxRequestsPerMinute) {
      return {
        allowed: false,
        remaining: 0,
        resetTime: entry.resetTime,
      };
    }

    // Increment count
    entry.count++;
    this.store.set(identifier, entry);

    return {
      allowed: true,
      remaining: this.config.maxRequestsPerMinute - entry.count,
      resetTime: entry.resetTime,
    };
  }

  /**
   * Get identifier from request (IP or user ID)
   * @param request - HTTP request object
   * @param userId - Optional user ID to use as identifier
   * @returns Identifier string in format "user:{userId}" or "ip:{ipAddress}"
   */
  static getIdentifier(request: Request, userId?: string): string {
    if (userId) {
      return `user:${userId}`;
    }

    // Try to get IP from various headers
    const forwarded = request.headers.get("x-forwarded-for");
    if (forwarded) {
      return `ip:${forwarded.split(",")[0].trim()}`;
    }

    const realIp = request.headers.get("x-real-ip");
    if (realIp) {
      return `ip:${realIp}`;
    }

    // Fallback to a default identifier
    return "ip:unknown";
  }

  /**
   * Clean up expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.resetTime) {
        this.store.delete(key);
      }
    }
  }
}

// Singleton instance
let rateLimiterInstance: RateLimiter | null = null;

/**
 * Gets or creates a singleton RateLimiter instance
 * @param config - Rate limit configuration
 * @returns Singleton RateLimiter instance
 */
export function getRateLimiter(config: RateLimitConfig): RateLimiter {
  if (!rateLimiterInstance) {
    rateLimiterInstance = new RateLimiter(config);
  }
  return rateLimiterInstance;
}
