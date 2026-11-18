import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME, runAgentLoop, DEFAULT_SYSTEM_PROMPT } from './index.js';

describe('@nirman/core exports', () => {
  it('exports package name and agent loop runner', () => {
    expect(PACKAGE_NAME).toBe('@nirman/core');
    expect(typeof runAgentLoop).toBe('function');
    expect(typeof DEFAULT_SYSTEM_PROMPT).toBe('string');
  });
});
