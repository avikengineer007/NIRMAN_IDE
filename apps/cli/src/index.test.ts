import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME, formatCliEvent, parseCliArgs, runCli } from './index.js';

describe('@nirman/cli exports', () => {
  it('exports package name and CLI helpers', () => {
    expect(PACKAGE_NAME).toBe('@nirman/cli');
    expect(typeof formatCliEvent).toBe('function');
    expect(typeof parseCliArgs).toBe('function');
    expect(typeof runCli).toBe('function');
  });
});
