/**
 * Chat Memory Management - Main Entry Point
 *
 * This module provides a unified interface for chat memory operations including:
 * - Message storage and retrieval
 * - RAG-based context search
 * - Smart message building with token management
 * - Background memory processing with reflective memory extraction
 *
 * Architecture:
 * - memory-storage.ts: Database CRUD operations
 * - memory-rag.ts: Semantic search and context retrieval
 * - memory-builder.ts: Message construction with token management
 * - memory-processor.ts: Background processing with Memory Graph
 */

// Re-export storage operations
export {
  getMemoryForSession,
  saveToMemory,
  getHistoryWithTimestamps,
  getRecentSessions,
} from "./memory/memory-storage";

// Re-export RAG operations
export {
  searchRelevantContext,
} from "./memory/memory-rag";

// Re-export builder operations
export {
  buildMessagesWithMemory,
} from "./memory/memory-builder";

// Re-export processor operations
export {
  processMemoryInBackground,
} from "./memory/memory-processor";
