import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { CommandOptions, CommandResult, DirEntry, Sandbox, SandboxConfig } from './types.js';
import { resolveSafePath, toWorkspaceRelative } from './path-safety.js';

let localSandboxWarningShown = false;

/**
 * Workspace-scoped local execution runner (NOT isolated).
 * Confines file path resolution to workspaceRoot, but executes child commands directly
 * on the host with host user privileges (networkMode, cpuLimit, and memoryLimit are NOT enforced).
 */
export class LocalSandbox implements Sandbox {
  readonly config: SandboxConfig;
  readonly isolationMode = 'workspace-scoped (not isolated)' as const;

  constructor(config: SandboxConfig) {
    this.config = {
      workspaceRoot: path.resolve(config.workspaceRoot),
      timeoutMs: config.timeoutMs ?? 30_000,
      cpuLimit: config.cpuLimit ?? 2.0,
      memoryLimit: config.memoryLimit ?? '1g',
      networkMode: config.networkMode ?? 'none',
      allowNetwork: config.allowNetwork ?? false,
      image: config.image ?? 'node:20-bookworm-slim',
    };

    if (!localSandboxWarningShown && process.env['NIRMAN_SUPPRESS_SANDBOX_WARNING'] !== '1') {
      localSandboxWarningShown = true;
      console.warn(
        '[NIRMAN SANDBOX WARNING] LocalSandbox is workspace-scoped, NOT isolated. ' +
          'Commands run directly on the host without network, CPU, or memory isolation.',
      );
    }
  }

  resolveSafePath(relativePath: string): string {
    return resolveSafePath(this.config.workspaceRoot, relativePath);
  }

  async readFile(relativePath: string): Promise<string> {
    const safePath = this.resolveSafePath(relativePath);
    return fs.readFile(safePath, 'utf-8');
  }

  async writeFile(relativePath: string, content: string): Promise<void> {
    const safePath = this.resolveSafePath(relativePath);
    await fs.mkdir(path.dirname(safePath), { recursive: true });
    await fs.writeFile(safePath, content, 'utf-8');
  }

  async deleteFile(relativePath: string): Promise<void> {
    const safePath = this.resolveSafePath(relativePath);
    await fs.rm(safePath, { force: true, recursive: false });
  }

  async exists(relativePath: string): Promise<boolean> {
    const safePath = this.resolveSafePath(relativePath);
    try {
      await fs.access(safePath);
      return true;
    } catch {
      return false;
    }
  }

  async listDir(
    relativePath = '.',
    options?: { recursive?: boolean; maxEntries?: number },
  ): Promise<DirEntry[]> {
    const safePath = this.resolveSafePath(relativePath);
    const maxEntries = options?.maxEntries ?? 1000;
    const entries: DirEntry[] = [];

    const walk = async (currentDir: string): Promise<void> => {
      if (entries.length >= maxEntries) {
        return;
      }
      const dirItems = await fs.readdir(currentDir, { withFileTypes: true });
      for (const item of dirItems) {
        if (entries.length >= maxEntries) {
          break;
        }
        const fullItemPath = path.join(currentDir, item.name);
        const relPath = toWorkspaceRelative(this.config.workspaceRoot, fullItemPath);
        const isDir = item.isDirectory();

        entries.push({
          name: item.name,
          path: relPath,
          type: isDir ? 'directory' : 'file',
        });

        if (isDir && options?.recursive) {
          await walk(fullItemPath);
        }
      }
    };

    await walk(safePath);
    return entries;
  }

  async executeCommand(cmd: string, options?: CommandOptions): Promise<CommandResult> {
    const timeoutMs = options?.timeoutMs ?? this.config.timeoutMs ?? 30_000;
    const cwd = options?.cwd ? this.resolveSafePath(options.cwd) : this.config.workspaceRoot;

    const startTime = Date.now();
    const isWindows = process.platform === 'win32';
    const shell = isWindows ? 'powershell.exe' : '/bin/sh';
    const args = isWindows ? ['-NoProfile', '-Command', cmd] : ['-c', cmd];

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...(options?.env ?? {}),
    };

    if (isWindows) {
      const appData = process.env.APPDATA;
      if (appData) {
        const npmPath = path.join(appData, 'npm');
        const currentPath = env.PATH || env.Path || '';
        if (!currentPath.split(';').includes(npmPath)) {
          env.PATH = `${npmPath};${currentPath}`;
          env.Path = `${npmPath};${currentPath}`;
        }
      }
    }

    return new Promise<CommandResult>((resolve) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let timer: NodeJS.Timeout | null = null;

      const child = spawn(shell, args, {
        cwd,
        env,
      });

      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          timedOut = true;
          if (isWindows && child.pid) {
            // Force terminate child process tree on Windows
            spawn('taskkill', ['/pid', child.pid.toString(), '/T', '/F']);
          } else {
            child.kill('SIGKILL');
          }
        }, timeoutMs);
      }

      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf-8');
      });

      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf-8');
      });

      child.on('close', (code) => {
        if (timer) {
          clearTimeout(timer);
        }
        const durationMs = Date.now() - startTime;
        resolve({
          exitCode: timedOut ? 124 : (code ?? 1),
          stdout,
          stderr: timedOut
            ? `${stderr}\n[TIMEOUT: Process was killed after exceeding ${timeoutMs}ms limit]`
            : stderr,
          durationMs,
          timedOut,
        });
      });

      child.on('error', (err) => {
        if (timer) {
          clearTimeout(timer);
        }
        const durationMs = Date.now() - startTime;
        resolve({
          exitCode: 1,
          stdout,
          stderr: `${stderr}\nProcess error: ${err.message}`,
          durationMs,
          timedOut: false,
        });
      });
    });
  }
}
