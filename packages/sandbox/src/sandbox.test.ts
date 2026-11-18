import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalSandbox } from './local-sandbox.js';
import { PathEscapeError } from './path-safety.js';

describe('LocalSandbox', () => {
  let tempDir: string;
  let sandbox: LocalSandbox;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nirman-test-sandbox-'));
    sandbox = new LocalSandbox({ workspaceRoot: tempDir, timeoutMs: 5000 });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('writes and reads files within workspace', async () => {
    await sandbox.writeFile('nested/hello.txt', 'Hello, World!');
    expect(await sandbox.exists('nested/hello.txt')).toBe(true);

    const content = await sandbox.readFile('nested/hello.txt');
    expect(content).toBe('Hello, World!');
  });

  it('lists directory entries', async () => {
    await sandbox.writeFile('a.txt', 'A');
    await sandbox.writeFile('sub/b.txt', 'B');

    const entries = await sandbox.listDir('.', { recursive: true });
    const paths = entries.map((e) => e.path);
    expect(paths).toContain('a.txt');
    expect(paths).toContain('sub/b.txt');
  });

  it('rejects path escape attempts on file operations', async () => {
    await expect(sandbox.readFile('../outside.txt')).rejects.toThrow(PathEscapeError);
    await expect(sandbox.writeFile('../outside.txt', 'evil')).rejects.toThrow(PathEscapeError);
    await expect(sandbox.deleteFile('../outside.txt')).rejects.toThrow(PathEscapeError);
  });

  it('executes simple shell command successfully', async () => {
    const isWin = process.platform === 'win32';
    const cmd = isWin ? 'Write-Output "ok"' : 'echo "ok"';

    const result = await sandbox.executeCommand(cmd);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('ok');
    expect(result.timedOut).toBe(false);
  });

  it('kills process when timeout is reached', async () => {
    const isWin = process.platform === 'win32';
    // Sleep longer than 300ms timeout
    const sleepCmd = isWin ? 'Start-Sleep -Milliseconds 1500' : 'sleep 1.5';

    const result = await sandbox.executeCommand(sleepCmd, { timeoutMs: 300 });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBe(124);
    expect(result.stderr).toContain('TIMEOUT');
  });
});
