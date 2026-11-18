import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME } from './index.js';

describe('@nirman/vscode-ext', () => {
  it('exports its package name placeholder', () => {
    expect(PACKAGE_NAME).toBe('@nirman/vscode-ext');
  });
});
