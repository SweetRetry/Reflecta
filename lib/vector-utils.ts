/**
 * Shared vector utility functions for embeddings
 */

/**
 * Calculate cosine similarity between two vectors
 * Returns a value between -1 and 1, where 1 means identical direction
 * @param a - First vector
 * @param b - Second vector
 * @returns Cosine similarity score
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) {
    return 0;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const va = a[i];
    const vb = b[i];
    dot += va * vb;
    normA += va * va;
    normB += vb * vb;
  }

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Parse a JSON string into a vector array
 * Returns empty array if parsing fails
 * @param json - JSON string representation of a vector
 * @returns Parsed vector array or empty array on error
 */
export function parseVector(json: string): number[] {
  try {
    const parsed = JSON.parse(json);
    if (Array.isArray(parsed)) {
      return parsed.map((v) => Number(v) || 0);
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Serialize a vector array to JSON string
 * @param vector - Vector array to serialize
 * @returns JSON string representation
 */
export function serializeVector(vector: number[]): string {
  return JSON.stringify(vector);
}

/**
 * Validate and convert vector to pgvector format string
 * Throws error if vector contains invalid values (prevents SQL injection)
 *
 * @param vector - Array of numbers to convert
 * @returns Safe pgvector format string: "[1,2,3,...]"
 * @throws Error if vector contains non-finite numbers
 */
export function toPgVectorString(vector: number[]): string {
  if (!Array.isArray(vector) || vector.length === 0) {
    throw new Error("Vector must be a non-empty array");
  }

  // Validate each component to prevent SQL injection
  const validated = vector.map((n, index) => {
    if (!Number.isFinite(n)) {
      throw new Error(`Invalid vector component at index ${index}: ${n}`);
    }
    return n.toString();
  });

  return `[${validated.join(",")}]`;
}
