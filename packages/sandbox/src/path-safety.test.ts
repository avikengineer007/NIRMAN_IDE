import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PathEscapeError, resolveSafePath, toWorkspaceRelative } from './path-safety.js';

describe('path-safety', () => {
  const workspaceRoot = path.resolve('temp-workspace');

  it('safely resolves relative path inside workspace', () => {
    const resolved = resolveSafePath(workspaceRoot, 'src/index.ts');
    expect(resolved).toBe(path.join(workspaceRoot, 'src', 'index.ts'));
  });

  it('safely resolves root target "."', () => {
    const resolved = resolveSafePath(workspaceRoot, '.');
    expect(resolved).toBe(workspaceRoot);
  });

  it('safely resolves nested path that stays inside workspace', () => {
    const resolved = resolveSafePath(workspaceRoot, 'src/subdir/../index.ts');
    expect(resolved).toBe(path.join(workspaceRoot, 'src', 'index.ts'));
  });

  it('rejects path escaping via parent navigation ".."', () => {
    expect(() => resolveSafePath(workspaceRoot, '../outside.txt')).toThrow(PathEscapeError);
    expect(() => resolveSafePath(workspaceRoot, '../../etc/passwd')).toThrow(PathEscapeError);
    expect(() => resolveSafePath(workspaceRoot, 'src/../../outside.txt')).toThrow(PathEscapeError);
  });

  it('rejects absolute paths outside workspace', () => {
    const outside = path.resolve('completely-outside');
    expect(() => resolveSafePath(workspaceRoot, outside)).toThrow(PathEscapeError);
  });

  it('computes workspace relative path with forward slashes', () => {
    const absPath = path.join(workspaceRoot, 'src', 'components', 'App.tsx');
    expect(toWorkspaceRelative(workspaceRoot, absPath)).toBe('src/components/App.tsx');
  });
});
