/**
 * Input validation and sanitization for chat API
 */

import { z } from "zod";
import { ChatRequest, ValidationError } from "./chat-types";

const MAX_MESSAGE_LENGTH = 10000;
const MIN_MESSAGE_LENGTH = 1;

// Zod schema for ChatRequest validation
const ChatRequestSchema = z.object({
  message: z
    .string()
    .min(MIN_MESSAGE_LENGTH, `Message must be at least ${MIN_MESSAGE_LENGTH} character`)
    .max(MAX_MESSAGE_LENGTH, `Message must not exceed ${MAX_MESSAGE_LENGTH} characters`)
    .transform((val) => val.trim()),
  sessionId: z.string().min(1, "sessionId is required for memory management"),
  userId: z.string().optional(),
  context: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Chat request validator for input validation and sanitization
 */
export class ChatValidator {
  /**
   * Validates and sanitizes a chat request
   * @param data - Raw request data to validate
   * @returns Validation result with sanitized data if valid
   */
  static validateRequest(data: unknown): {
    valid: boolean;
    errors: ValidationError[];
    sanitized?: ChatRequest;
  } {
    const result = ChatRequestSchema.safeParse(data);

    if (!result.success) {
      // Convert Zod errors to ValidationError format
      const errors: ValidationError[] = result.error.issues.map((issue) => {
        const field = issue.path.length > 0 ? issue.path.join(".") : "request";
        return {
          field,
          message: issue.message,
        };
      });

      return { valid: false, errors };
    }

    return {
      valid: true,
      errors: [],
      sanitized: result.data,
    };
  }

  /**
   * Sanitizes a message by removing control characters and trimming
   * @param message - Raw message string to sanitize
   * @returns Sanitized message string
   */
  static sanitizeMessage(message: string): string {
    return message
      .trim()
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
      .slice(0, MAX_MESSAGE_LENGTH);
  }
}
