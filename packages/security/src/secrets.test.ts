import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EncryptedSecretsStore } from './secrets.js';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';

describe('EncryptedSecretsStore & Redaction', () => {
  let tempDir: string;
  let secretsPath: string;
  let store: EncryptedSecretsStore;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nirman-secrets-test-'));
    secretsPath = path.join(tempDir, 'secrets.enc');
    store = new EncryptedSecretsStore({
      storagePath: secretsPath,
      masterKey: 'test-master-passphrase-secure-key-1234',
    });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('stores and retrieves secrets with authenticated AES-256-GCM encryption', async () => {
    await store.setSecret('GITHUB_TOKEN', 'ghp_secretValue1234567890');
    await store.setSecret('DATABASE_URL', 'postgres://user:superpass@db:5432/app');

    // Retrieve from memory cache
    expect(await store.getSecret('GITHUB_TOKEN')).toBe('ghp_secretValue1234567890');
    expect(await store.getSecret('DATABASE_URL')).toBe('postgres://user:superpass@db:5432/app');

    // Verify raw file on disk is encrypted ciphertext (never plaintext)
    const diskBytes = await fs.readFile(secretsPath);
    const diskString = diskBytes.toString('utf-8');
    expect(diskString).not.toContain('ghp_secretValue1234567890');
    expect(diskString).not.toContain('superpass');

    // Load in fresh store instance to verify decryption
    const store2 = new EncryptedSecretsStore({
      storagePath: secretsPath,
      masterKey: 'test-master-passphrase-secure-key-1234',
    });

    expect(await store2.getSecret('GITHUB_TOKEN')).toBe('ghp_secretValue1234567890');
    expect(await store2.getSecret('DATABASE_URL')).toBe('postgres://user:superpass@db:5432/app');
  });

  it('lists and deletes secrets', async () => {
    await store.setSecret('API_KEY', 'key123');
    await store.setSecret('AWS_SECRET', 'aws456');

    const names = await store.listSecretNames();
    expect(names).toEqual(['API_KEY', 'AWS_SECRET']);

    const deleted = await store.deleteSecret('API_KEY');
    expect(deleted).toBe(true);
    expect(await store.getSecret('API_KEY')).toBeUndefined();
    expect(await store.listSecretNames()).toEqual(['AWS_SECRET']);
  });

  it('expands {{secret:NAME}} references into actual secret values for tool execution', async () => {
    await store.setSecret('OPENAI_API_KEY', 'sk-proj-xyz789');
    await store.setSecret('AUTH_TOKEN', 'bearer-abc-000');

    const command = 'curl -H "Authorization: Bearer {{secret:AUTH_TOKEN}}" -d "key={{secret:OPENAI_API_KEY}}" https://api.com';
    const expanded = await store.expandSecrets(command);

    expect(expanded).toBe('curl -H "Authorization: Bearer bearer-abc-000" -d "key=sk-proj-xyz789" https://api.com');
  });

  it('throws descriptive error when expanding a missing secret', async () => {
    await store.setSecret('EXISTING_SECRET', 'val');

    await expect(
      store.expandSecrets('echo {{secret:NON_EXISTENT}}'),
    ).rejects.toThrow('Referenced secret "NON_EXISTENT" was not found in the secrets store');
  });

  it('redacts secret values from strings and logs before sending to model or disk', async () => {
    await store.setSecret('DISCORD_WEBHOOK', 'https://discord.com/api/webhooks/123/tokenXYZ');
    await store.setSecret('API_TOKEN', 'tok_production_secret_999');

    const logMessage = 'Executed command with token tok_production_secret_999 and posted to https://discord.com/api/webhooks/123/tokenXYZ';
    const redacted = store.redactSecrets(logMessage);

    expect(redacted).not.toContain('tok_production_secret_999');
    expect(redacted).not.toContain('https://discord.com/api/webhooks/123/tokenXYZ');
    expect(redacted).toContain('[REDACTED_SECRET:API_TOKEN]');
    expect(redacted).toContain('[REDACTED_SECRET:DISCORD_WEBHOOK]');
  });

  it('redacts unexpanded secret placeholders {{secret:NAME}} into [SECRET_REF:NAME]', () => {
    const prompt = 'Run curl with header Authorization: {{secret:MY_API_KEY}}';
    const redacted = store.redactSecrets(prompt);

    expect(redacted).toBe('Run curl with header Authorization: [SECRET_REF:MY_API_KEY]');
  });

  it('redacts secrets recursively within nested objects and arrays', async () => {
    await store.setSecret('DB_PASSWORD', 'superSecretP@ssword');

    const payload = {
      command: 'connect',
      options: {
        connectionString: 'db://user:superSecretP@ssword@host:5432',
        extraArgs: ['--password', 'superSecretP@ssword'],
      },
    };

    const redacted = store.redactObject(payload);

    expect(redacted.options.connectionString).toBe('db://user:[REDACTED_SECRET:DB_PASSWORD]@host:5432');
    expect(redacted.options.extraArgs[1]).toBe('[REDACTED_SECRET:DB_PASSWORD]');
  });
});
