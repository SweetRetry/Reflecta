/**
 * Chat Memory Management - Main Entry Point
 *
 * This module provides a unified interface for chat memory operations including:
 * - Message storage and retrieval
 * - Enhanced RAG-based context search with dynamic thresholding and hybrid search
 * - Smart message building with token management
 * - Background memory processing with reflective memory extraction
 *
 * Architecture:
 * - memory-storage.ts: Database CRUD operations
 * - memory-rag-enhanced.ts: Enhanced semantic + keyword hybrid search
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

// Re-export enhanced RAG operations
export {
  searchRelevantContextEnhanced,
} from "./memory/memory-rag-enhanced";

// Re-export builder operations
export {
  buildMessagesWithMemory,
} from "./memory/memory-builder";

// Re-export processor operations
export {
  processMemoryInBackground,
} from "./memory/memory-processor";
