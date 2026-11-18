import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { WorktreeManager } from './worktree-manager.js';

describe('WorktreeManager', () => {
  let tempRepo: string;
  let baseWorktreesDir: string;
  let manager: WorktreeManager;

  beforeEach(async () => {
    tempRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'nirman-repo-test-'));
    baseWorktreesDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nirman-wt-test-'));
    manager = new WorktreeManager(baseWorktreesDir);
  });

  afterEach(async () => {
    try {
      await fs.rm(tempRepo, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      await fs.rm(baseWorktreesDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch {
      // ignore
    }
  });

  it('initializes git repository if missing and creates isolated worktree', async () => {
    await fs.writeFile(path.join(tempRepo, 'app.js'), 'console.log("hello");', 'utf-8');

    const alloc = await manager.createWorktree(tempRepo, 'run-1');
    expect(alloc.worktreePath).toBeDefined();
    expect(alloc.gitBranch).toBe('nirman/run-run-1');

    // Verify files exist in worktree
    const stat = await fs.stat(path.join(alloc.worktreePath, 'app.js'));
    expect(stat.isFile()).toBe(true);

    // Clean up
    await manager.removeWorktree(tempRepo, alloc.worktreePath, alloc.gitBranch);
  });

  it('allocates two concurrent worktrees against the same repo without conflicts', async () => {
    await fs.writeFile(path.join(tempRepo, 'base.txt'), 'base repository content', 'utf-8');

    const alloc1 = await manager.createWorktree(tempRepo, 'run-concurrent-1');
    const alloc2 = await manager.createWorktree(tempRepo, 'run-concurrent-2');

    expect(alloc1.worktreePath).not.toBe(alloc2.worktreePath);
    expect(alloc1.gitBranch).not.toBe(alloc2.gitBranch);

    // Modify file in worktree 1
    await fs.writeFile(path.join(alloc1.worktreePath, 'file1.txt'), 'from run 1', 'utf-8');

    // Modify file in worktree 2
    await fs.writeFile(path.join(alloc2.worktreePath, 'file2.txt'), 'from run 2', 'utf-8');

    // Verify worktree 1 does not see worktree 2's file and vice versa
    await expect(fs.stat(path.join(alloc1.worktreePath, 'file2.txt'))).rejects.toThrow();
    await expect(fs.stat(path.join(alloc2.worktreePath, 'file1.txt'))).rejects.toThrow();

    // Verify base repo does not have either file yet
    await expect(fs.stat(path.join(tempRepo, 'file1.txt'))).rejects.toThrow();
    await expect(fs.stat(path.join(tempRepo, 'file2.txt'))).rejects.toThrow();

    // Clean up both
    await manager.removeWorktree(tempRepo, alloc1.worktreePath, alloc1.gitBranch);
    await manager.removeWorktree(tempRepo, alloc2.worktreePath, alloc2.gitBranch);
  });
});
