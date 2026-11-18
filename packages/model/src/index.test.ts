import { describe, expect, it } from 'vitest';
import {
  PACKAGE_NAME,
  OpenAICompatibleClient,
  MockModelClient,
  countTokens,
  validateSchema,
  analyzeContextWindow,
  formatToolsFallbackPrompt,
  parseFallbackToolCall,
} from './index.js';

describe('@nirman/model barrel exports', () => {
  it('exports package name and primary interfaces/classes', () => {
    expect(PACKAGE_NAME).toBe('@nirman/model');
    expect(typeof OpenAICompatibleClient).toBe('function');
    expect(typeof MockModelClient).toBe('function');
    expect(typeof countTokens).toBe('function');
    expect(typeof validateSchema).toBe('function');
    expect(typeof analyzeContextWindow).toBe('function');
    expect(typeof formatToolsFallbackPrompt).toBe('function');
    expect(typeof parseFallbackToolCall).toBe('function');
  });
});
