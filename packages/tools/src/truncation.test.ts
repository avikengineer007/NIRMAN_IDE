import { describe, expect, it } from 'vitest';
import { truncateOutput } from './truncation.js';

describe('truncation', () => {
  it('returns original content when under maxBytes limit', () => {
    const text = 'Hello Nirman!';
    const result = truncateOutput(text, 100);

    expect(result.text).toBe(text);
    expect(result.truncated).toBe(false);
    expect(result.originalBytes).toBe(text.length);
  });

  it('truncates content when exceeding maxBytes and appends marker', () => {
    const largeText = 'A line of code here.\n'.repeat(50);
    const maxBytes = 250;
    const result = truncateOutput(largeText, maxBytes);

    expect(result.truncated).toBe(true);
    expect(result.text).toContain('[TRUNCATED: Output exceeded 250 bytes limit');
    expect(result.originalBytes).toBeGreaterThan(maxBytes);
  });
});
