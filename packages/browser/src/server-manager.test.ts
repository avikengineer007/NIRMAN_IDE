import { describe, it, expect, afterEach } from 'vitest';
import { DevServerManager } from './server-manager.js';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';

describe('DevServerManager', () => {
  let serverManager: DevServerManager | null = null;

  afterEach(async () => {
    if (serverManager) {
      await serverManager.stopServer();
      serverManager = null;
    }
  });

  it('extracts server command and port/URL from SPEC.md', () => {
    const spec = `
# Sample Project SPEC
Architecture: Web Application
Dev Server: npm run dev
URL: http://localhost:5173
Test: npm test
`;

    const config = DevServerManager.extractServerConfig(spec);
    expect(config).not.toBeNull();
    expect(config?.command).toBe('npm run dev');
    expect(config?.url).toBe('http://localhost:5173');
  });

  it('starts a dev server, waits for HTTP readiness, and terminates cleanly', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nirman-server-test-'));
    const testPort = 3456;
    const testUrl = `http://127.0.0.1:${testPort}`;

    // Write a tiny HTTP server script
    const serverScript = `
const http = require('http');
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<h1>Server Ready</h1>');
});
server.listen(${testPort}, '127.0.0.1');
`;
    await fs.writeFile(path.join(tempDir, 'server.js'), serverScript, 'utf-8');

    serverManager = new DevServerManager();
    await serverManager.startServer({
      command: 'node server.js',
      cwd: tempDir,
      url: testUrl,
      timeoutMs: 10_000,
    });

    expect(serverManager.isRunning).toBe(true);
    expect(serverManager.runningUrl).toBe(testUrl);

    // Verify server response
    const res = await fetch(testUrl);
    const body = await res.text();
    expect(body).toContain('<h1>Server Ready</h1>');

    // Stop server
    await serverManager.stopServer();
    expect(serverManager.isRunning).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 300));
    try {
      await fs.rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // ignore Windows cleanup locks
    }
  });
});
