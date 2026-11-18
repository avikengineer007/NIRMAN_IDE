import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  AuditLogger,
  GENESIS_HASH,
  verifyAuditLogIntegrity,
  verifyAuditEntries,
} from './audit.js';
import type { AuditEntry } from './types.js';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';

describe('Append-Only, Hash-Chained Audit Log & Tamper Detection', () => {
  let tempDir: string;
  let auditLogPath: string;
  let logger: AuditLogger;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nirman-audit-test-'));
    auditLogPath = path.join(tempDir, 'audit.jsonl');
    logger = new AuditLogger(auditLogPath);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('creates an append-only hash chain starting with genesis hash and valid sequential indices', async () => {
    const entry0 = await logger.log({
      id: 'evt-1',
      timestamp: '2026-11-18T20:00:00Z',
      eventType: 'policy_eval',
      action: 'allow',
      tool: 'read_file',
      params: { path: 'src/main.ts' },
    });

    expect(entry0.index).toBe(0);
    expect(entry0.prevHash).toBe(GENESIS_HASH);
    expect(entry0.hash).toMatch(/^[a-f0-9]{64}$/);

    const entry1 = await logger.log({
      id: 'evt-2',
      timestamp: '2026-11-18T20:00:01Z',
      eventType: 'tool_call',
      action: 'allow',
      tool: 'write_file',
      params: { path: 'src/main.ts' },
      result: { success: true },
    });

    expect(entry1.index).toBe(1);
    expect(entry1.prevHash).toBe(entry0.hash);
    expect(entry1.hash).toMatch(/^[a-f0-9]{64}$/);

    const entry2 = await logger.log({
      id: 'evt-3',
      timestamp: '2026-11-18T20:00:02Z',
      eventType: 'approval',
      action: 'ask',
      tool: 'run_shell',
      params: { command: 'git push' },
      userApproval: 'approved',
    });

    expect(entry2.index).toBe(2);
    expect(entry2.prevHash).toBe(entry1.hash);

    // Verify integrity of the valid chain
    const verification = await logger.verifyIntegrity();
    expect(verification.valid).toBe(true);
    expect(verification.totalEntries).toBe(3);
    expect(verification.error).toBeUndefined();
  });

  it('detects tampering when an attacker modifies a record payload in the audit log', async () => {
    await logger.log({
      id: 'evt-1',
      timestamp: '2026-11-18T20:00:00Z',
      eventType: 'policy_eval',
      action: 'allow',
      tool: 'read_file',
      params: { path: 'src/index.ts' },
    });

    await logger.log({
      id: 'evt-2',
      timestamp: '2026-11-18T20:00:01Z',
      eventType: 'tool_call',
      action: 'deny',
      tool: 'run_shell',
      params: { command: 'rm -rf /' },
    });

    // Tamper with record 1: Attacker changes "deny" to "allow" in the log file
    const rawContent = await fs.readFile(auditLogPath, 'utf-8');
    const lines = rawContent.trim().split(/\r?\n/);
    const tamperedEntry = JSON.parse(lines[1]!) as AuditEntry;
    tamperedEntry.action = 'allow'; // Alter record without knowing correct HMAC/Hash key
    lines[1] = JSON.stringify(tamperedEntry);
    await fs.writeFile(auditLogPath, lines.join('\n') + '\n', 'utf-8');

    // Run verification
    const verification = await verifyAuditLogIntegrity(auditLogPath);
    expect(verification.valid).toBe(false);
    expect(verification.brokenIndex).toBe(1);
    expect(verification.error).toContain('Tampered record detected at index 1');
  });

  it('detects tampering when an entry is deleted from the middle of the log', async () => {
    for (let i = 0; i < 4; i++) {
      await logger.log({
        id: `evt-${i}`,
        timestamp: `2026-11-18T20:00:0${i}Z`,
        eventType: 'tool_call',
        action: 'allow',
        tool: 'read_file',
        params: { step: i },
      });
    }

    // Delete record 2 from disk
    const rawContent = await fs.readFile(auditLogPath, 'utf-8');
    const lines = rawContent.trim().split(/\r?\n/);
    lines.splice(2, 1); // remove entry 2
    await fs.writeFile(auditLogPath, lines.join('\n') + '\n', 'utf-8');

    // Verification detects the index or hash chain break
    const verification = await verifyAuditLogIntegrity(auditLogPath);
    expect(verification.valid).toBe(false);
    expect(verification.brokenIndex).toBe(2);
  });

  it('detects tampering when entries are reordered or swapped', async () => {
    const entries: AuditEntry[] = [];
    for (let i = 0; i < 3; i++) {
      const e = await logger.log({
        id: `evt-${i}`,
        timestamp: `2026-11-18T20:00:0${i}Z`,
        eventType: 'tool_call',
        action: 'allow',
        tool: 'read_file',
        params: { step: i },
      });
      entries.push(e);
    }

    // Swap entry 1 and entry 2 in-memory
    const swapped = [entries[0]!, entries[2]!, entries[1]!];
    const verification = verifyAuditEntries(swapped);

    expect(verification.valid).toBe(false);
    expect(verification.brokenIndex).toBe(1);
  });

  it('detects tampering if an attacker alters the stored hash itself', async () => {
    await logger.log({
      id: 'evt-1',
      timestamp: '2026-11-18T20:00:00Z',
      eventType: 'policy_eval',
      action: 'allow',
      tool: 'read_file',
      params: { path: 'file.txt' },
    });

    const rawContent = await fs.readFile(auditLogPath, 'utf-8');
    const entry = JSON.parse(rawContent.trim()) as AuditEntry;
    entry.hash = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    await fs.writeFile(auditLogPath, JSON.stringify(entry) + '\n', 'utf-8');

    const verification = await verifyAuditLogIntegrity(auditLogPath);
    expect(verification.valid).toBe(false);
    expect(verification.brokenIndex).toBe(0);
    expect(verification.error).toContain('Tampered record detected');
  });
});
