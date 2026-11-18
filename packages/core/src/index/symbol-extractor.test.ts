import { describe, it, expect } from 'vitest';
import { extractSymbols, generateFileSummary } from './symbol-extractor.js';

describe('Symbol Extractor', () => {
  it('extracts symbols from TypeScript code', async () => {
    const code = `
/**
 * User service handling authentication and registration.
 */
export interface UserSession {
  token: string;
  userId: string;
}

export class AuthService {
  async login(email: string, pass: string): Promise<UserSession> {
    return { token: 'jwt', userId: '123' };
  }

  logout(): void {}
}

export function hashPassword(plain: string): string {
  return 'hashed';
}
`;

    const symbols = await extractSymbols(code, 'src/auth/service.ts');
    expect(symbols.length).toBeGreaterThanOrEqual(4);

    const names = symbols.map((s) => s.name);
    expect(names).toContain('UserSession');
    expect(names).toContain('AuthService');
    expect(names).toContain('login');
    expect(names).toContain('logout');
    expect(names).toContain('hashPassword');

    const iface = symbols.find((s) => s.name === 'UserSession');
    expect(iface?.kind).toBe('interface');

    const cls = symbols.find((s) => s.name === 'AuthService');
    expect(cls?.kind).toBe('class');

    const method = symbols.find((s) => s.name === 'login');
    expect(method?.kind).toBe('method');
  });

  it('extracts symbols from Python code', async () => {
    const pythonCode = `
"""
Database connection pool and migration utilities.
"""
class DatabasePool:
    def connect(self):
        pass

def execute_query(sql):
    return []
`;

    const symbols = await extractSymbols(pythonCode, 'app/db.py');
    expect(symbols.length).toBeGreaterThanOrEqual(2);

    const names = symbols.map((s) => s.name);
    expect(names).toContain('DatabasePool');
    expect(names).toContain('execute_query');
  });

  it('generates concise per-file summary with docstrings and symbols', async () => {
    const code = `
// Fast cryptographic utilities for token generation
export function generateToken(): string { return 'token'; }
export function verifyToken(t: string): boolean { return true; }
`;
    const symbols = await extractSymbols(code, 'src/crypto.ts');
    const summary = generateFileSummary('src/crypto.ts', code, symbols);

    expect(summary).toContain('Fast cryptographic utilities');
    expect(summary).toContain('Defines 2 symbol(s)');
    expect(summary).toContain('generateToken');
  });
});
