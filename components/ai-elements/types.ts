import type { ToolUIPart } from "ai";

/**
 * Extended state type that includes approval-related states
 * not present in the base ToolUIPart type
 */
export type ExtendedToolUIState =
  | ToolUIPart["state"]
  | "approval-requested"
  | "approval-responded"
  | "output-denied";
