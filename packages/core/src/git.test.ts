import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalSandbox } from '@nirman/sandbox';
import { captureRunDiff, captureTaskDiff, initGitRepo } from './git.js';

describe('Git integration', () => {
  let tempDir: string;
  let sandbox: LocalSandbox;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nirman-git-test-'));
    sandbox = new LocalSandbox({ workspaceRoot: tempDir });
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore temporary Windows EBUSY locks
    }
  });

  it('initializes git repository in sandbox', async () => {
    await initGitRepo(sandbox);
    const gitExists = await sandbox.exists('.git');
    expect(gitExists).toBe(true);
  }, 15_000);

  it('captures unified diff for task changes', async () => {
    await initGitRepo(sandbox);

    await sandbox.writeFile('app.js', 'console.log("hello world");\n');
    const patch = await captureTaskDiff(sandbox, 'step-1', 'Create application entry');

    expect(patch).toContain('diff --git');
    expect(patch).toContain('+console.log("hello world");');
  }, 15_000);

  it('captures cumulative diff across multiple tasks', async () => {
    await initGitRepo(sandbox);

    await sandbox.writeFile('file1.txt', 'one\n');
    await captureTaskDiff(sandbox, 'step-1', 'Task 1');

    await sandbox.writeFile('file2.txt', 'two\n');
    await captureTaskDiff(sandbox, 'step-2', 'Task 2');

    const cumulative = await captureRunDiff(sandbox);
    expect(cumulative).toContain('file1.txt');
    expect(cumulative).toContain('file2.txt');
  }, 15_000);
});
