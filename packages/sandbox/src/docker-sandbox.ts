import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { CommandOptions, CommandResult, DirEntry, Sandbox, SandboxConfig } from './types.js';
import { resolveSafePath, toWorkspaceRelative } from './path-safety.js';

/**
 * Docker-based isolated container execution sandbox.
 */
export class DockerSandbox implements Sandbox {
  readonly config: SandboxConfig;

  constructor(config: SandboxConfig) {
    this.config = {
      workspaceRoot: path.resolve(config.workspaceRoot),
      image: config.image ?? 'node:20-bookworm-slim',
      timeoutMs: config.timeoutMs ?? 30_000,
      cpuLimit: config.cpuLimit ?? 2.0,
      memoryLimit: config.memoryLimit ?? '1g',
      networkMode: config.networkMode ?? 'none',
      allowNetwork: config.allowNetwork ?? false,
    };
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

  /**
   * Helper to inspect Docker daemon availability.
   */
  static async isDockerAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const child = spawn('docker', ['info'], { stdio: 'ignore' });
      child.on('close', (code) => {
        resolve(code === 0);
      });
      child.on('error', () => {
        resolve(false);
      });
    });
  }

  async executeCommand(cmd: string, options?: CommandOptions): Promise<CommandResult> {
    const timeoutMs = options?.timeoutMs ?? this.config.timeoutMs ?? 30_000;
    const network =
      (options?.allowNetwork ?? this.config.allowNetwork)
        ? this.config.networkMode === 'none'
          ? 'bridge'
          : (this.config.networkMode ?? 'bridge')
        : 'none';

    const containerName = `nirman_box_${crypto.randomBytes(6).toString('hex')}`;
    const startTime = Date.now();

    // Inside container, workspace is mounted at /workspace
    const containerCwd = options?.cwd
      ? `/workspace/${toWorkspaceRelative(this.config.workspaceRoot, this.resolveSafePath(options.cwd))}`
      : '/workspace';

    const dockerArgs = [
      'run',
      '--rm',
      '--name',
      containerName,
      '-i',
      '--network',
      network,
      '--cpus',
      String(this.config.cpuLimit ?? 2.0),
      '-m',
      this.config.memoryLimit ?? '1g',
      '-v',
      `${this.config.workspaceRoot}:/workspace:rw`,
      '-w',
      containerCwd,
      this.config.image ?? 'node:20-bookworm-slim',
      'sh',
      '-c',
      cmd,
    ];

    return new Promise<CommandResult>((resolve) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let timer: NodeJS.Timeout | null = null;

      const child = spawn('docker', dockerArgs);

      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          timedOut = true;
          // Kill the docker container by name
          spawn('docker', ['kill', containerName], { stdio: 'ignore' });
          child.kill('SIGKILL');
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
            ? `${stderr}\n[TIMEOUT: Docker process killed after exceeding ${timeoutMs}ms limit]`
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
          stderr: `${stderr}\nDocker invocation error: ${err.message}`,
          durationMs,
          timedOut: false,
        });
      });
    });
  }
}
