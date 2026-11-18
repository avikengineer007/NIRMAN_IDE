import { describe, it, expect } from 'vitest';
import {
  generateLocalEmbedding,
  cosineSimilarity,
  vectorToBuffer,
  bufferToVector,
  tokenizeForEmbedding,
  DEFAULT_EMBEDDING_DIM,
} from './embeddings.js';

describe('Local Embeddings', () => {
  it('tokenizes camelCase, snake_case, and subwords', () => {
    const tokens = tokenizeForEmbedding('createJwtToken user_id auth');
    expect(tokens).toContain('createjwttoken');
    expect(tokens).toContain('create');
    expect(tokens).toContain('jwt');
    expect(tokens).toContain('token');
    expect(tokens).toContain('user_id');
    expect(tokens).toContain('user');
    expect(tokens).toContain('id');
    expect(tokens).toContain('auth');
  });

  it('generates normalized unit vector of correct dimension', () => {
    const vec = generateLocalEmbedding('function authenticateUser(token: string) {}');
    expect(vec.length).toBe(DEFAULT_EMBEDDING_DIM);

    let sumSq = 0;
    for (let i = 0; i < vec.length; i++) {
      sumSq += vec[i]! * vec[i]!;
    }
    expect(Math.abs(sumSq - 1.0)).toBeLessThan(0.001);
  });

  it('computes higher similarity for semantically related texts', () => {
    const query = generateLocalEmbedding('authentication and user tokens');
    const authCode = generateLocalEmbedding(
      'export function verifyAuthToken(jwtToken: string): UserSession { return decode(jwtToken); }',
    );
    const billingCode = generateLocalEmbedding(
      'export function calculateTax(amount: number, vatRate: number): number { return amount * vatRate; }',
    );

    const authSim = cosineSimilarity(query, authCode);
    const billingSim = cosineSimilarity(query, billingCode);

    expect(authSim).toBeGreaterThan(billingSim);
    expect(authSim).toBeGreaterThan(0.2);
  });

  it('serializes and deserializes vector to/from Buffer for SQLite', () => {
    const original = generateLocalEmbedding('test serialization code');
    const buf = vectorToBuffer(original);
    expect(buf.length).toBe(DEFAULT_EMBEDDING_DIM * 4); // 4 bytes per float32

    const restored = bufferToVector(buf);
    expect(restored.length).toBe(DEFAULT_EMBEDDING_DIM);

    for (let i = 0; i < original.length; i++) {
      expect(restored[i]).toBeCloseTo(original[i]!, 5);
    }
  });
});
