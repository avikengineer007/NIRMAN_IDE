import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ISecretsStore } from './types.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // Standard 96-bit IV for GCM
const SALT_LENGTH = 16;
const TAG_LENGTH = 16;
const PBKDF2_ITERATIONS = 100_000;
const KEY_LENGTH = 32;

export interface SecretsStoreOptions {
  storagePath?: string;
  masterKey?: string;
}

export class EncryptedSecretsStore implements ISecretsStore {
  private readonly storagePath: string;
  private readonly masterKey: string;
  private cache: Map<string, string> = new Map();
  private loaded = false;

  constructor(options: SecretsStoreOptions = {}) {
    this.storagePath = options.storagePath ?? path.join(process.cwd(), '.agent', 'secrets.enc');
    this.masterKey =
      options.masterKey ??
      process.env['NIRMAN_MASTER_KEY'] ??
      'nirman-default-agent-local-secret-key-32';
  }

  /**
   * Derives a 256-bit cryptographic encryption key from the master passphrase and salt.
   */
  private deriveKey(salt: Buffer): Buffer {
    return crypto.pbkdf2Sync(this.masterKey, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256');
  }

  /**
   * Loads and decrypts the secrets database into memory cache.
   */
  private async load(): Promise<void> {
    if (this.loaded) return;

    try {
      const encryptedBuffer = await fs.readFile(this.storagePath);
      if (encryptedBuffer.length < SALT_LENGTH + IV_LENGTH + TAG_LENGTH) {
        this.cache = new Map();
        this.loaded = true;
        return;
      }

      const salt = encryptedBuffer.subarray(0, SALT_LENGTH);
      const iv = encryptedBuffer.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
      const tag = encryptedBuffer.subarray(
        SALT_LENGTH + IV_LENGTH,
        SALT_LENGTH + IV_LENGTH + TAG_LENGTH,
      );
      const ciphertext = encryptedBuffer.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH);

      const key = this.deriveKey(salt);
      const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
      decipher.setAuthTag(tag);

      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
        'utf-8',
      );

      const data = JSON.parse(decrypted) as Record<string, string>;
      this.cache = new Map(Object.entries(data));
    } catch {
      // If file doesn't exist or is empty, initialize fresh cache
      this.cache = new Map();
    }

    this.loaded = true;
  }

  /**
   * Encrypts and writes the in-memory secrets cache to disk.
   */
  private async persist(): Promise<void> {
    const parentDir = path.dirname(this.storagePath);
    await fs.mkdir(parentDir, { recursive: true });

    const salt = crypto.randomBytes(SALT_LENGTH);
    const iv = crypto.randomBytes(IV_LENGTH);
    const key = this.deriveKey(salt);

    const plaintext = JSON.stringify(Object.fromEntries(this.cache));
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    // Format: [salt 16b] [iv 12b] [tag 16b] [ciphertext]
    const finalBuffer = Buffer.concat([salt, iv, tag, ciphertext]);
    await fs.writeFile(this.storagePath, finalBuffer);
  }

  public async setSecret(name: string, value: string): Promise<void> {
    await this.load();
    this.cache.set(name, value);
    await this.persist();
  }

  public async getSecret(name: string): Promise<string | undefined> {
    await this.load();
    return this.cache.get(name);
  }

  public async hasSecret(name: string): Promise<boolean> {
    await this.load();
    return this.cache.has(name);
  }

  public async deleteSecret(name: string): Promise<boolean> {
    await this.load();
    const deleted = this.cache.delete(name);
    if (deleted) {
      await this.persist();
    }
    return deleted;
  }

  public async listSecretNames(): Promise<string[]> {
    await this.load();
    return Array.from(this.cache.keys()).sort();
  }

  /**
   * Expands {{secret:NAME}} references into their actual decrypted values.
   * Throws an error if a referenced secret is missing.
   */
  public async expandSecrets(text: string): Promise<string> {
    await this.load();
    const regex = /\{\{secret:([a-zA-Z0-9_.-]+)\}\}/g;

    let result = text;
    const matches = Array.from(text.matchAll(regex));

    for (const match of matches) {
      const fullMatch = match[0];
      const secretName = match[1]!;
      const value = this.cache.get(secretName);

      if (value === undefined) {
        throw new Error(
          `Referenced secret "${secretName}" was not found in the secrets store. Available secrets: [${(await this.listSecretNames()).join(', ')}]`,
        );
      }

      result = result.replaceAll(fullMatch, value);
    }

    return result;
  }

  /**
   * Redacts secret values and secret references from text, logs, and model messages.
   * Replaces raw secrets with [REDACTED_SECRET:NAME] or [REDACTED_SECRET].
   */
  public redactSecrets(text: string): string {
    if (!text) return text;
    let redacted = text;

    // 1. Redact all actual secret values stored in memory cache
    for (const [name, val] of this.cache.entries()) {
      if (val && val.length > 0) {
        redacted = redacted.replaceAll(val, `[REDACTED_SECRET:${name}]`);
      }
    }

    // 2. Also redact unexpanded {{secret:NAME}} patterns if present
    redacted = redacted.replaceAll(
      /\{\{secret:([a-zA-Z0-9_.-]+)\}\}/g,
      (_match, name: string) => `[SECRET_REF:${name}]`,
    );

    return redacted;
  }

  /**
   * Recursively redacts secrets in arbitrary objects (e.g. tool arguments or results)
   */
  public redactObject<T>(obj: T): T {
    if (obj === null || obj === undefined) {
      return obj;
    }

    if (typeof obj === 'string') {
      return this.redactSecrets(obj) as unknown as T;
    }

    if (Array.isArray(obj)) {
      const redactedItems: unknown[] = obj.map((item: unknown) => this.redactObject(item));
      return redactedItems as unknown as T;
    }

    if (typeof obj === 'object') {
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) {
        result[k] = this.redactObject(v);
      }
      return result as unknown as T;
    }

    return obj;
  }
}
