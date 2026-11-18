import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { AuditEntry, AuditVerificationResult } from './types.js';

export const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

/**
 * Computes deterministic canonical JSON string with sorted keys
 */
export function canonicalStringify(obj: unknown): string {
  if (obj === null || obj === undefined) {
    return 'null';
  }
  if (typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalStringify).join(',') + ']';
  }

  const record = obj as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const entries = keys.map(
    (k) => `${JSON.stringify(k)}:${canonicalStringify(record[k])}`,
  );
  return '{' + entries.join(',') + '}';
}

/**
 * Computes the cryptographic SHA-256 hash for an audit entry
 */
export function computeEntryHash(
  prevHash: string,
  entryData: Omit<AuditEntry, 'hash' | 'prevHash'>,
): string {
  const canonicalData = canonicalStringify(entryData);
  return crypto
    .createHash('sha256')
    .update(`${prevHash}:${canonicalData}`, 'utf-8')
    .digest('hex');
}

export class AuditLogger {
  private readonly logPath: string;
  private lastHash: string = GENESIS_HASH;
  private nextIndex = 0;
  private initialized = false;

  constructor(logPath?: string) {
    this.logPath = logPath ?? path.join(process.cwd(), '.agent', 'audit.jsonl');
  }

  /**
   * Initializes logger and synchronizes with existing chain on disk if present
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    try {
      const content = await fs.readFile(this.logPath, 'utf-8');
      const lines = content.trim().split(/\r?\n/).filter((l) => l.trim().length > 0);

      if (lines.length > 0) {
        const lastLine = lines[lines.length - 1]!;
        const lastEntry = JSON.parse(lastLine) as AuditEntry;
        this.nextIndex = lastEntry.index + 1;
        this.lastHash = lastEntry.hash;
      }
    } catch {
      // File does not exist yet; starts at index 0 and GENESIS_HASH
      this.nextIndex = 0;
      this.lastHash = GENESIS_HASH;
    }

    this.initialized = true;
  }

  /**
   * Appends a new immutable, hash-chained record to the audit log
   */
  public async log(
    payload: Omit<AuditEntry, 'index' | 'prevHash' | 'hash'>,
  ): Promise<AuditEntry> {
    await this.ensureInitialized();

    const parentDir = path.dirname(this.logPath);
    await fs.mkdir(parentDir, { recursive: true });

    const index = this.nextIndex++;
    const prevHash = this.lastHash;

    const entryToHash: Omit<AuditEntry, 'hash' | 'prevHash'> = {
      index,
      id: payload.id,
      timestamp: payload.timestamp,
      eventType: payload.eventType,
      action: payload.action,
      tool: payload.tool,
      params: payload.params,
      ...(payload.result !== undefined ? { result: payload.result } : {}),
      ...(payload.userApproval !== undefined ? { userApproval: payload.userApproval } : {}),
      ...(payload.tainted !== undefined ? { tainted: payload.tainted } : {}),
    };

    const hash = computeEntryHash(prevHash, entryToHash);

    const fullEntry: AuditEntry = {
      ...entryToHash,
      prevHash,
      hash,
    };

    this.lastHash = hash;

    // Append-only write
    await fs.appendFile(this.logPath, JSON.stringify(fullEntry) + '\n', 'utf-8');
    return fullEntry;
  }

  /**
   * Reads all entries in the audit log
   */
  public async readEntries(): Promise<AuditEntry[]> {
    try {
      const content = await fs.readFile(this.logPath, 'utf-8');
      return content
        .trim()
        .split(/\r?\n/)
        .filter((l) => l.trim().length > 0)
        .map((l) => JSON.parse(l) as AuditEntry);
    } catch {
      return [];
    }
  }

  /**
   * Verifies the cryptographic chain integrity of this audit log
   */
  public async verifyIntegrity(): Promise<AuditVerificationResult> {
    const entries = await this.readEntries();
    return verifyAuditEntries(entries);
  }
}

/**
 * Validates the cryptographic integrity of audit entries.
 * Detects any tampering, alteration, reordering, deletion, or insertion.
 */
export function verifyAuditEntries(entries: AuditEntry[]): AuditVerificationResult {
  if (entries.length === 0) {
    return { valid: true, totalEntries: 0 };
  }

  let expectedPrevHash = GENESIS_HASH;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;

    // 1. Verify sequential indexing
    if (entry.index !== i) {
      return {
        valid: false,
        totalEntries: entries.length,
        error: `Invalid index sequence: expected ${i}, found ${entry.index}`,
        brokenIndex: i,
      };
    }

    // 2. Verify previous hash pointer
    if (entry.prevHash !== expectedPrevHash) {
      return {
        valid: false,
        totalEntries: entries.length,
        error: `Broken hash chain at index ${i}: prevHash mismatch. Expected ${expectedPrevHash}, found ${entry.prevHash}`,
        brokenIndex: i,
      };
    }

    // 3. Verify entry hash integrity
    const { hash: statedHash, prevHash: _ph, ...entryData } = entry;
    const computed = computeEntryHash(entry.prevHash, entryData);

    if (statedHash !== computed) {
      return {
        valid: false,
        totalEntries: entries.length,
        error: `Tampered record detected at index ${i}: stated hash ${statedHash} does not match recomputed SHA-256 hash ${computed}`,
        brokenIndex: i,
      };
    }

    expectedPrevHash = entry.hash;
  }

  return {
    valid: true,
    totalEntries: entries.length,
  };
}

/**
 * Verifies an audit log file on disk
 */
export async function verifyAuditLogIntegrity(logPath: string): Promise<AuditVerificationResult> {
  try {
    const content = await fs.readFile(logPath, 'utf-8');
    const entries = content
      .trim()
      .split(/\r?\n/)
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as AuditEntry);
    return verifyAuditEntries(entries);
  } catch (err) {
    return {
      valid: false,
      totalEntries: 0,
      error: `Could not read audit log file: ${String(err)}`,
    };
  }
}
