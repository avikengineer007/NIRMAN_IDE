import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');

function collectNonTestSourceFiles(rootDirs: readonly string[]): string[] {
  const results: string[] = [];

  const walk = (dir: string): void => {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') {
        continue;
      }
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (
        entry.isFile() &&
        entry.name.endsWith('.ts') &&
        !entry.name.endsWith('.test.ts') &&
        !entry.name.endsWith('.spec.ts') &&
        !entry.name.endsWith('.d.ts')
      ) {
        results.push(full);
      }
    }
  };

  for (const relDir of rootDirs) {
    walk(path.join(REPO_ROOT, relDir));
  }
  return results;
}

describe('CI Code Hygiene Check', () => {
  const sourceFiles = collectNonTestSourceFiles(['packages', 'apps']);

  it('bans Math.random in non-test source files', () => {
    const violations: string[] = [];
    for (const file of sourceFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      const lines = content.split(/\r?\n/);
      lines.forEach((line, idx) => {
        if (/\bMath\.random\b/.test(line)) {
          violations.push(`${path.relative(REPO_ROOT, file)}:${idx + 1}: ${line.trim()}`);
        }
      });
    }
    expect(violations).toEqual([]);
  });

  it('bans empty catch blocks in non-test source files', () => {
    const violations: string[] = [];
    for (const file of sourceFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      const emptyCatchRegex = /catch\s*(?:\([^)]*\))?\s*\{\s*\}/g;
      let match: RegExpExecArray | null;
      while ((match = emptyCatchRegex.exec(content)) !== null) {
        const lineNum = content.slice(0, match.index).split(/\r?\n/).length;
        violations.push(`${path.relative(REPO_ROOT, file)}:${lineNum}: ${match[0]}`);
      }
    }
    expect(violations).toEqual([]);
  });
});
