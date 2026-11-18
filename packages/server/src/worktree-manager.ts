import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export interface WorktreeAllocation {
  worktreePath: string;
  gitBranch: string;
  isWorktree: boolean;
}

export class WorktreeManager {
  private baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? path.join(os.tmpdir(), 'nirman-worktrees');
  }

  /**
   * Runs a git command in the specified directory and returns stdout.
   */
  private async execGit(
    args: string[],
    cwd: string,
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      const child = spawn('git', args, {
        cwd,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
        },
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (d: Buffer) => {
        stdout += d.toString('utf-8');
      });
      child.stderr.on('data', (d: Buffer) => {
        stderr += d.toString('utf-8');
      });

      child.on('close', (code) => {
        resolve({
          exitCode: code ?? 0,
          stdout,
          stderr,
        });
      });

      child.on('error', (err) => {
        resolve({
          exitCode: 1,
          stdout: '',
          stderr: err.message,
        });
      });
    });
  }

  /**
   * Ensures the repository is initialized with at least one commit so worktree branching works.
   */
  public async ensureGitRepo(repoRoot: string): Promise<boolean> {
    const gitDir = path.join(repoRoot, '.git');
    try {
      await fs.stat(gitDir);
    } catch {
      // Initialize git repo
      const initRes = await this.execGit(['init'], repoRoot);
      if (initRes.exitCode !== 0) return false;

      await this.execGit(['config', 'user.name', 'Nirman Agent'], repoRoot);
      await this.execGit(['config', 'user.email', 'agent@nirman.local'], repoRoot);
      await this.execGit(['add', '-A'], repoRoot);
      await this.execGit(['commit', '--allow-empty', '-m', 'Initial commit for Nirman'], repoRoot);
      return true;
    }

    // Check if HEAD has at least one commit
    const headCheck = await this.execGit(['rev-parse', '--verify', 'HEAD'], repoRoot);
    if (headCheck.exitCode !== 0) {
      await this.execGit(['config', 'user.name', 'Nirman Agent'], repoRoot);
      await this.execGit(['config', 'user.email', 'agent@nirman.local'], repoRoot);
      await this.execGit(['add', '-A'], repoRoot);
      await this.execGit(['commit', '--allow-empty', '-m', 'Initial commit for Nirman'], repoRoot);
    }

    return true;
  }

  /**
   * Creates an isolated git worktree for a run.
   */
  public async createWorktree(repoRoot: string, runId: string): Promise<WorktreeAllocation> {
    await fs.mkdir(this.baseDir, { recursive: true });
    const worktreePath = path.join(this.baseDir, `wt-${runId}`);
    const gitBranch = `nirman/run-${runId}`;

    const hasGit = await this.ensureGitRepo(repoRoot);
    if (!hasGit) {
      // Fallback to directory copy if git is unavailable
      await fs.mkdir(worktreePath, { recursive: true });
      await this.copyDirectory(repoRoot, worktreePath);
      return { worktreePath, gitBranch, isWorktree: false };
    }

    // Try creating worktree
    // Remove if previously existing stale path
    try {
      await fs.rm(worktreePath, { recursive: true, force: true });
    } catch {
      // ignore
    }

    const wtRes = await this.execGit(
      ['worktree', 'add', '-B', gitBranch, worktreePath, 'HEAD'],
      repoRoot,
    );

    if (wtRes.exitCode === 0) {
      return {
        worktreePath,
        gitBranch,
        isWorktree: true,
      };
    }

    // If worktree add failed (e.g. submodules or locked state), fall back to isolated copy
    await fs.mkdir(worktreePath, { recursive: true });
    await this.copyDirectory(repoRoot, worktreePath);
    return {
      worktreePath,
      gitBranch,
      isWorktree: false,
    };
  }

  /**
   * Removes and cleans up an allocated worktree.
   */
  public async removeWorktree(
    repoRoot: string,
    worktreePath: string,
    gitBranch?: string,
  ): Promise<void> {
    try {
      await this.execGit(['worktree', 'remove', '--force', worktreePath], repoRoot);
      await this.execGit(['worktree', 'prune'], repoRoot);
    } catch {
      // ignore
    }

    if (gitBranch) {
      try {
        await this.execGit(['branch', '-D', gitBranch], repoRoot);
      } catch {
        // ignore
      }
    }

    try {
      await fs.rm(worktreePath, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch {
      // ignore
    }
  }

  /**
   * Deep copies files and folders from src to dest excluding .git and .agent
   */
  private async copyDirectory(src: string, dest: string): Promise<void> {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.agent') {
        continue;
      }

      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        await this.copyDirectory(srcPath, destPath);
      } else if (entry.isFile()) {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }
}
