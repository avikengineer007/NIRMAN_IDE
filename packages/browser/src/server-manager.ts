import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import type { DevServerOptions } from './types.js';

export class DevServerManager {
  private serverProcess: ChildProcess | null = null;
  private serverUrl: string | null = null;

  /**
   * Parses dev server command and URL/port from SPEC.md content or task descriptions.
   */
  public static extractServerConfig(specMarkdown: string): { command: string; url: string } | null {
    // Look for patterns like:
    // Run: npm start (URL: http://localhost:3000)
    // Server: npx serve (Port: 3000)
    // Dev: python -m http.server 8080
    let command: string | null = null;
    let url = 'http://localhost:3000';

    const lines = specMarkdown.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();

      // Look for dev server or run command
      const cmdMatch = trimmed.match(
        /^(?:Run|Server|Dev Server|Serve|Start Command|Command to run):\s*`?([^`\n]+)`?/i,
      );
      if (cmdMatch && cmdMatch[1]) {
        command = cmdMatch[1].trim();
      }

      // Look for explicit Port or URL
      const urlMatch = trimmed.match(/(https?:\/\/[a-zA-Z0-9_.-]+:\d+(?:\/[^\s`]*)?)/i);
      if (urlMatch && urlMatch[1]) {
        url = urlMatch[1].trim();
      } else {
        const portMatch = trimmed.match(/(?:Port|port):\s*(\d+)/i);
        if (portMatch && portMatch[1]) {
          url = `http://localhost:${portMatch[1]}`;
        }
      }
    }

    if (!command) {
      // Check for generic node or static server hints in SPEC.md
      if (/index\.html/i.test(specMarkdown)) {
        // Simple static web app
        command = 'npx serve -l 3000 .';
        url = 'http://localhost:3000';
      }
    }

    return command ? { command, url } : null;
  }

  /**
   * Starts the dev server child process
   */
  public async startServer(options: DevServerOptions): Promise<void> {
    if (this.serverProcess) {
      await this.stopServer();
    }

    this.serverUrl = options.url;
    const isWindows = process.platform === 'win32';
    const shell = isWindows ? 'powershell.exe' : '/bin/sh';
    const shellArgs = isWindows ? ['-NoProfile', '-Command', options.command] : ['-c', options.command];

    this.serverProcess = spawn(shell, shellArgs, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: !isWindows, // Allow process group kill on Unix
    });

    this.serverProcess.on('error', (err) => {
      console.error(`Dev server process error: ${err.message}`);
    });

    // Wait for server readiness
    await this.waitForReadiness(options.url, options.timeoutMs ?? 20_000);
  }

  /**
   * Polls the dev server URL until it responds with HTTP 200..399 or timeout occurs.
   */
  public async waitForReadiness(url: string, timeoutMs = 20_000): Promise<void> {
    const startTime = Date.now();
    const intervalMs = 250;

    while (Date.now() - startTime < timeoutMs) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 1000);
        const res = await fetch(url, {
          signal: controller.signal,
          method: 'GET',
        });
        clearTimeout(timeoutId);

        if (res.status >= 200 && res.status < 500) {
          return; // Server is ready
        }
      } catch {
        // Server not ready yet; wait and retry
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    throw new Error(
      `Dev server at "${url}" failed to become ready within ${timeoutMs}ms`,
    );
  }

  /**
   * Stops the running dev server and its child processes cleanly
   */
  public async stopServer(): Promise<void> {
    if (!this.serverProcess || this.serverProcess.killed) {
      this.serverProcess = null;
      return;
    }

    const pid = this.serverProcess.pid;
    if (pid) {
      if (process.platform === 'win32') {
        try {
          spawnSync('taskkill', ['/pid', pid.toString(), '/T', '/F'], { stdio: 'ignore' });
        } catch {
          this.serverProcess.kill();
        }
      } else {
        try {
          process.kill(-pid, 'SIGKILL');
        } catch {
          this.serverProcess.kill('SIGKILL');
        }
      }
    }

    this.serverProcess = null;
    this.serverUrl = null;
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
  }

  public get runningUrl(): string | null {
    return this.serverUrl;
  }

  public get isRunning(): boolean {
    return this.serverProcess !== null && !this.serverProcess.killed;
  }
}
