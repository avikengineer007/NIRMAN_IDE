import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ChildProcess } from 'node:child_process';
import type { Sandbox } from '@nirman/sandbox';
import type { TaskCheck, CheckResult } from './types.js';

export class TaskCheckRunner {
  private sandbox: Sandbox;
  private workspaceRoot: string;

  constructor(sandbox: Sandbox, workspaceRoot: string) {
    this.sandbox = sandbox;
    this.workspaceRoot = workspaceRoot;
  }

  public async runCheck(check: TaskCheck): Promise<CheckResult> {
    switch (check.type) {
      case 'test':
        return await this.runTestCheck(check);
      case 'endpoint':
        return await this.runEndpointCheck(check);
      case 'ui':
        return await this.runUiCheck(check);
    }
  }

  private async runTestCheck(check: Extract<TaskCheck, { type: 'test' }>): Promise<CheckResult> {
    try {
      const res = await this.sandbox.executeCommand(check.command, { timeoutMs: 10_000 });
      const expectedCode = check.expectedExitCode ?? 0;

      if (res.exitCode !== expectedCode) {
        return {
          check: check.description,
          passed: false,
          error: `Exit code ${res.exitCode} (expected ${expectedCode}). Output: ${res.stdout} ${res.stderr}`.trim(),
        };
      }

      if (check.expectedOutput && !res.stdout.includes(check.expectedOutput)) {
        return {
          check: check.description,
          passed: false,
          error: `Expected output substring "${check.expectedOutput}" not found. Got: ${res.stdout}`,
        };
      }

      return {
        check: check.description,
        passed: true,
      };
    } catch (err) {
      return {
        check: check.description,
        passed: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async runEndpointCheck(
    check: Extract<TaskCheck, { type: 'endpoint' }>,
  ): Promise<CheckResult> {
    let backgroundProcess: ChildProcess | null = null;
    try {
      // Start server in background via child process
      const child = await import('node:child_process');
      const proc = child.spawn('cmd.exe', ['/c', check.startCommand], {
        cwd: this.workspaceRoot,
        stdio: 'pipe',
      });
      backgroundProcess = proc;

      // Wait for port readiness
      const isReady = await this.waitForPort(check.port, 6000);
      if (!isReady) {
        return {
          check: check.description,
          passed: false,
          error: `Server failed to start or bind to port ${check.port} within timeout`,
        };
      }

      // Perform HTTP request
      const httpResult = await this.performHttpRequest({
        port: check.port,
        path: check.path,
        method: check.method ?? 'GET',
        body: check.body,
      });

      if (httpResult.statusCode !== check.expectedStatus) {
        return {
          check: check.description,
          passed: false,
          error: `HTTP status ${httpResult.statusCode} (expected ${check.expectedStatus}). Body: ${httpResult.body}`,
        };
      }

      if (check.expectedBodySubstr && !httpResult.body.includes(check.expectedBodySubstr)) {
        return {
          check: check.description,
          passed: false,
          error: `Expected body substring "${check.expectedBodySubstr}" not found in response. Got: ${httpResult.body}`,
        };
      }

      return {
        check: check.description,
        passed: true,
      };
    } catch (err) {
      return {
        check: check.description,
        passed: false,
        error: err instanceof Error ? err.message : String(err),
      };
    } finally {
      if (backgroundProcess) {
        try {
          const child = await import('node:child_process');
          child.execSync(`taskkill /F /T /PID ${backgroundProcess['pid']}`, { stdio: 'ignore' });
        } catch {
          // ignore cleanup
        }
      }
    }
  }

  private async runUiCheck(check: Extract<TaskCheck, { type: 'ui' }>): Promise<CheckResult> {
    try {
      const fullPath = path.isAbsolute(check.filePath)
        ? check.filePath
        : path.join(this.workspaceRoot, check.filePath);

      const content = await fs.readFile(fullPath, 'utf-8');
      const lower = content.toLowerCase();

      for (const kw of check.requiredKeywords) {
        if (!lower.includes(kw.toLowerCase())) {
          return {
            check: check.description,
            passed: false,
            error: `UI file "${check.filePath}" is missing required element keyword "${kw}"`,
          };
        }
      }

      return {
        check: check.description,
        passed: true,
      };
    } catch (err) {
      return {
        check: check.description,
        passed: false,
        error: `Could not read UI file "${check.filePath}": ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  private waitForPort(port: number, timeoutMs: number): Promise<boolean> {
    const startTime = Date.now();
    return new Promise((resolve) => {
      const check = () => {
        if (Date.now() - startTime > timeoutMs) {
          return resolve(false);
        }
        const req = http.get(`http://127.0.0.1:${port}/`, () => {
          resolve(true);
        });
        req.on('error', () => {
          setTimeout(check, 250);
        });
      };
      check();
    });
  }

  private performHttpRequest(opts: {
    port: number;
    path: string;
    method: string;
    body?: unknown;
  }): Promise<{ statusCode: number; body: string }> {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: opts.port,
          path: opts.path,
          method: opts.method,
          headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk: Buffer) => {
            data += chunk.toString();
          });
          res.on('end', () => {
            resolve({ statusCode: res.statusCode ?? 0, body: data });
          });
        },
      );

      req.on('error', reject);
      if (opts.body) {
        req.write(JSON.stringify(opts.body));
      }
      req.end();
    });
  }
}
