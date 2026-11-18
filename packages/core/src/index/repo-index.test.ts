import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RepoIndex } from './repo-index.js';
import { LocalSandbox } from '@nirman/sandbox';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('RepoIndex', () => {
  let tempDir: string;
  let repoIndex: RepoIndex;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nirman-index-test-'));
    repoIndex = new RepoIndex(tempDir, { dbPath: ':memory:' });
  });

  afterEach(async () => {
    repoIndex.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('indexes individual files and stores symbols, summaries, and snippets in SQLite', async () => {
    const authCode = `
export interface AuthToken {
  accessToken: string;
  expiresIn: number;
}

export class AuthenticationManager {
  login(username: string, pass: string): AuthToken {
    return { accessToken: 'xyz', expiresIn: 3600 };
  }

  verify(token: string): boolean {
    return token.length > 0;
  }
}
`;
    await repoIndex.indexFile('src/auth/manager.ts', authCode);

    const files = repoIndex.getFileTree();
    expect(files.length).toBe(1);
    expect(files[0]?.path).toBe('src/auth/manager.ts');
    expect(files[0]?.lineCount).toBeGreaterThan(10);
    expect(files[0]?.summary).toContain('AuthenticationManager');

    const symbols = repoIndex.getSymbols('src/auth/manager.ts');
    expect(symbols.length).toBeGreaterThanOrEqual(3);
    const symNames = symbols.map((s) => s.name);
    expect(symNames).toContain('AuthToken');
    expect(symNames).toContain('AuthenticationManager');
    expect(symNames).toContain('login');
  });

  it('retrieves relevant snippets within a token budget for a query', async () => {
    await repoIndex.indexFile(
      'src/auth/jwt.ts',
      `
export function generateJwt(userId: string): string {
  // Signs and generates a JSON Web Token
  return 'jwt.' + userId;
}
export function verifyJwt(token: string): boolean {
  return token.startsWith('jwt.');
}
`,
    );

    await repoIndex.indexFile(
      'src/billing/invoice.ts',
      `
export function generateInvoice(customerId: string, amount: number): string {
  // Computes billing totals and tax rates
  return 'inv_' + customerId + '_' + amount;
}
`,
    );

    const authResults = await repoIndex.retrieve('verify JSON web token', { maxTokens: 1000 });
    expect(authResults.length).toBeGreaterThan(0);
    expect(authResults[0]?.filePath).toBe('src/auth/jwt.ts');
    expect(authResults[0]?.content).toContain('verifyJwt');

    const billingResults = await repoIndex.retrieve('billing customer invoice amount', { maxTokens: 1000 });
    expect(billingResults.length).toBeGreaterThan(0);
    expect(billingResults[0]?.filePath).toBe('src/billing/invoice.ts');
    expect(billingResults[0]?.content).toContain('generateInvoice');
  });

  it('indexes a full workspace recursively using sandbox', async () => {
    const sandbox = new LocalSandbox({ workspaceRoot: tempDir });
    await sandbox.writeFile('src/utils/math.ts', 'export function add(a: number, b: number): number { return a + b; }');
    await sandbox.writeFile('src/utils/string.ts', 'export function capitalize(s: string): string { return s.toUpperCase(); }');
    await sandbox.writeFile('README.md', '# Project\nDocumentation');

    const stats = await repoIndex.indexWorkspace(sandbox);
    expect(stats.indexedFilesCount).toBe(3);
    expect(stats.symbolsCount).toBeGreaterThanOrEqual(2);

    const tree = repoIndex.getFileTree();
    expect(tree.length).toBe(3);
  });
});
