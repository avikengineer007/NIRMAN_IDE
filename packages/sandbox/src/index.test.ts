import { describe, expect, it } from 'vitest';
import {
  PACKAGE_NAME,
  DockerSandbox,
  LocalSandbox,
  PathEscapeError,
  resolveSafePath,
  toWorkspaceRelative,
} from './index.js';

describe('@nirman/sandbox exports', () => {
  it('exports package name and key classes/functions', () => {
    expect(PACKAGE_NAME).toBe('@nirman/sandbox');
    expect(typeof DockerSandbox).toBe('function');
    expect(typeof LocalSandbox).toBe('function');
    expect(typeof PathEscapeError).toBe('function');
    expect(typeof resolveSafePath).toBe('function');
    expect(typeof toWorkspaceRelative).toBe('function');
  });
});
