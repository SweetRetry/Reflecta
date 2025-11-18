/**
 * Input validation and sanitization for chat API
 */

import { ChatRequest, ValidationError } from "./chat-types";

export class ChatValidator {
  private static readonly MAX_MESSAGE_LENGTH = 10000;
  private static readonly MAX_HISTORY_ITEMS = 50;
  private static readonly MIN_MESSAGE_LENGTH = 1;

  /**
   * Validate chat request
   */
  static validateRequest(data: unknown): {
    valid: boolean;
    errors: ValidationError[];
    sanitized?: ChatRequest;
  } {
    const errors: ValidationError[] = [];

    // Type check
    if (typeof data !== "object" || data === null) {
      errors.push({
        field: "request",
        message: "Request body must be a valid object",
      });
      return { valid: false, errors };
    }

    const request = data as Partial<ChatRequest>;

    // Validate message
    if (!request.message) {
      errors.push({
        field: "message",
        message: "Message is required",
      });
    } else if (typeof request.message !== "string") {
      errors.push({
        field: "message",
        message: "Message must be a string",
      });
    } else {
      const trimmedMessage = request.message.trim();

      if (trimmedMessage.length < this.MIN_MESSAGE_LENGTH) {
        errors.push({
          field: "message",
          message: `Message must be at least ${this.MIN_MESSAGE_LENGTH} character`,
        });
      }

      if (trimmedMessage.length > this.MAX_MESSAGE_LENGTH) {
        errors.push({
          field: "message",
          message: `Message must not exceed ${this.MAX_MESSAGE_LENGTH} characters`,
        });
      }
    }

    // Validate history
    if (request.history !== undefined) {
      if (!Array.isArray(request.history)) {
        errors.push({
          field: "history",
          message: "History must be an array",
        });
      } else if (request.history.length > this.MAX_HISTORY_ITEMS) {
        errors.push({
          field: "history",
          message: `History must not exceed ${this.MAX_HISTORY_ITEMS} items`,
        });
      } else {
        // Validate each history item
        request.history.forEach((item, index) => {
          if (typeof item !== "object" || item === null) {
            errors.push({
              field: `history[${index}]`,
              message: "History item must be an object",
            });
          } else if (!item.role || !item.content) {
            errors.push({
              field: `history[${index}]`,
              message: "History item must have role and content",
            });
          } else if (
            !["user", "assistant", "system", "human", "ai"].includes(item.role)
          ) {
            errors.push({
              field: `history[${index}].role`,
              message: "Invalid role in history item",
            });
          }
        });
      }
    }

    if (errors.length > 0) {
      return { valid: false, errors };
    }

    // Sanitize and return
    const sanitized: ChatRequest = {
      message: request.message!.trim(),
      history: request.history || [],
      userId: request.userId,
      sessionId: request.sessionId,
      context: request.context,
    };

    return { valid: true, errors: [], sanitized };
  }

  /**
   * Sanitize message content to prevent injection attacks
   */
  static sanitizeMessage(message: string): string {
    return message
      .trim()
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "") // Remove control characters
      .slice(0, this.MAX_MESSAGE_LENGTH);
  }

  /**
   * Validate and sanitize history
   */
  static sanitizeHistory(
    history: unknown[]
  ): Array<{ role: string; content: string }> {
    if (!Array.isArray(history)) {
      return [];
    }

    return history
      .filter(
        (item): item is { role: string; content: string } =>
          typeof item === "object" &&
          item !== null &&
          "role" in item &&
          "content" in item &&
          typeof item.content === "string"
      )
      .slice(-this.MAX_HISTORY_ITEMS)
      .map((item) => ({
        role: item.role,
        content: this.sanitizeMessage(item.content),
      }));
  }
}
