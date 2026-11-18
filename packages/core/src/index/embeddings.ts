/**
 * Deterministic local vector embeddings and similarity functions for code retrieval.
 * Uses a hashed subword n-gram dense projection (FastText/MurmurHash style)
 * producing 256-dimensional unit vectors optimized for code and technical terminology.
 */

export const DEFAULT_EMBEDDING_DIM = 256;

export type EmbeddingProvider = (texts: readonly string[]) => Promise<Float32Array[]>;

/**
 * 32-bit FNV-1a hash function for strings.
 */
function fnv1a(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Splits text into code tokens, identifiers, camelCase parts, and snake_case parts.
 */
export function tokenizeForEmbedding(text: string): string[] {
  const tokens: string[] = [];

  // Match words, numbers, and symbols
  const rawWords = text.match(/[A-Za-z0-9_$-]+/g) ?? [];

  for (const raw of rawWords) {
    if (raw.length === 0) continue;
    const lower = raw.toLowerCase();
    tokens.push(lower);

    // Split camelCase: e.g. "createUserToken" -> "create", "user", "token"
    const camelParts = raw
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
      .split(/\s+/)
      .map((p) => p.toLowerCase())
      .filter((p) => p.length > 1);

    for (const part of camelParts) {
      if (!tokens.includes(part)) {
        tokens.push(part);
      }
    }

    // Split snake_case or kebab-case
    const delimiterParts = raw
      .split(/[_-]+/)
      .map((p) => p.toLowerCase())
      .filter((p) => p.length > 1);

    for (const part of delimiterParts) {
      if (!tokens.includes(part)) {
        tokens.push(part);
      }
    }

    // Generate character 3-grams and 4-grams for subword matching (e.g. "auth" in "authenticate")
    if (lower.length >= 3 && lower.length <= 25) {
      const padded = `<${lower}>`;
      for (let i = 0; i <= padded.length - 3; i++) {
        tokens.push(padded.slice(i, i + 3));
      }
      for (let i = 0; i <= padded.length - 4; i++) {
        tokens.push(padded.slice(i, i + 4));
      }
    }
  }

  return tokens;
}

/**
 * Generates a normalized dense float vector from input text using feature hashing.
 */
export function generateLocalEmbedding(
  text: string,
  dimension: number = DEFAULT_EMBEDDING_DIM,
): Float32Array {
  const vector = new Float32Array(dimension);
  const tokens = tokenizeForEmbedding(text);

  if (tokens.length === 0) {
    return vector;
  }

  for (const token of tokens) {
    const hash = fnv1a(token);
    const index = hash % dimension;
    // Determine sign from 31st bit
    const sign = (hash & 0x80000000) === 0 ? 1.0 : -1.0;

    // Weight exact full words higher than n-grams
    let weight = 1.0;
    if (token.startsWith('<') && token.endsWith('>')) {
      weight = 0.5; // subword n-gram
    } else if (token.length > 2) {
      weight = 2.0; // full token
    }

    vector[index] = (vector[index] ?? 0) + sign * weight;
  }

  // L2 Normalize to unit sphere for cosine similarity via dot product
  let sumSq = 0;
  for (let i = 0; i < dimension; i++) {
    const val = vector[i] ?? 0;
    sumSq += val * val;
  }

  const norm = Math.sqrt(sumSq);
  if (norm > 0) {
    const invNorm = 1.0 / norm;
    for (let i = 0; i < dimension; i++) {
      vector[i] = (vector[i] ?? 0) * invNorm;
    }
  }

  return vector;
}

/**
 * Computes cosine similarity between two normalized vectors (dot product).
 * Returns value in range [-1.0, 1.0].
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i]! * b[i]!;
  }
  return Math.max(-1.0, Math.min(1.0, dot));
}

/**
 * Serializes a Float32Array into a Node.js Buffer for SQLite BLOB storage.
 */
export function vectorToBuffer(vector: Float32Array): Buffer {
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
}

/**
 * Deserializes a Node.js Buffer back into a Float32Array.
 */
export function bufferToVector(buffer: Buffer): Float32Array {
  const arrayBuffer = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  );
  return new Float32Array(arrayBuffer);
}
