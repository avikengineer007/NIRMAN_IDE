import { describe, expect, it } from 'vitest';
import {
  analyzeContextWindow,
  countTokens,
  estimateMessagesTokens,
  DEFAULT_CONTEXT_WINDOW_LIMIT,
} from './tokens.js';
import type { ChatMessage } from './types.js';

describe('tokens', () => {
  describe('countTokens', () => {
    it('returns 0 for empty string', () => {
      expect(countTokens('')).toBe(0);
    });

    it('estimates tokens for short English text', () => {
      const text = 'Hello world, this is a test.';
      const tokens = countTokens(text);
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThan(15);
    });

    it('estimates tokens for code snippets', () => {
      const code = 'function add(a: number, b: number): number { return a + b; }';
      const tokens = countTokens(code);
      expect(tokens).toBeGreaterThan(10);
      expect(tokens).toBeLessThan(35);
    });
  });

  describe('estimateMessagesTokens', () => {
    it('returns 0 for empty message array', () => {
      expect(estimateMessagesTokens([])).toBe(0);
    });

    it('includes framing and content tokens', () => {
      const messages: ChatMessage[] = [
        { role: 'system', content: 'You are an expert engineer.' },
        { role: 'user', content: 'Write a quicksort in TypeScript.' },
      ];
      const tokens = estimateMessagesTokens(messages);
      expect(tokens).toBeGreaterThan(15);
    });

    it('accounts for tool calls in assistant messages', () => {
      const messages: ChatMessage[] = [
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: {
                name: 'read_file',
                arguments: JSON.stringify({ path: 'src/index.ts' }),
              },
            },
          ],
        },
      ];
      const tokens = estimateMessagesTokens(messages);
      expect(tokens).toBeGreaterThan(10);
    });
  });

  describe('analyzeContextWindow', () => {
    it('correctly reports context usage below threshold', () => {
      const messages: ChatMessage[] = [{ role: 'user', content: 'Short query' }];
      const analysis = analyzeContextWindow(messages, 1000);

      expect(analysis.contextLimit).toBe(1000);
      expect(analysis.usedTokens).toBeGreaterThan(0);
      expect(analysis.remainingTokens).toBe(1000 - analysis.usedTokens);
      expect(analysis.percentUsed).toBeLessThan(10);
      expect(analysis.isNearLimit).toBe(false);
      expect(analysis.isExceeded).toBe(false);
    });

    it('detects near limit condition at >= 80%', () => {
      const largeContent = 'word '.repeat(700);
      const messages: ChatMessage[] = [{ role: 'user', content: largeContent }];
      const analysis = analyzeContextWindow(messages, 1000);

      expect(analysis.percentUsed).toBeGreaterThanOrEqual(80);
      expect(analysis.isNearLimit).toBe(true);
    });

    it('detects exceeded context window', () => {
      const largeContent = 'word '.repeat(1000);
      const messages: ChatMessage[] = [{ role: 'user', content: largeContent }];
      const analysis = analyzeContextWindow(messages, 500);

      expect(analysis.isExceeded).toBe(true);
      expect(analysis.remainingTokens).toBe(0);
    });

    it('uses DEFAULT_CONTEXT_WINDOW_LIMIT if not provided', () => {
      const analysis = analyzeContextWindow([{ role: 'user', content: 'test' }]);
      expect(analysis.contextLimit).toBe(DEFAULT_CONTEXT_WINDOW_LIMIT);
    });
  });
});
