import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SelfHostedAdapter } from './adapters/self-hosted.js';
import { ReleaseManager } from './release-manager.js';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';

describe('SelfHostedAdapter (SSH & Caddy with TLS)', () => {
  let tempDir: string;
  let adapter: SelfHostedAdapter;
  let releaseManager: ReleaseManager;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nirman-self-hosted-test-'));
    releaseManager = new ReleaseManager(path.join(tempDir, 'releases.json'));
    adapter = new SelfHostedAdapter(releaseManager);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('detects node project and generates Dockerfile when missing', async () => {
    await fs.writeFile(
      path.join(tempDir, 'package.json'),
      '{"name": "my-api", "main": "src/index.js", "scripts": {"start": "node src/index.js"}}',
      'utf-8',
    );

    const detection = await adapter.detect({
      workspaceRoot: tempDir,
      specMarkdown: 'Port: 4000',
    });

    expect(detection.detected).toBe(true);
    expect(detection.projectType).toBe('node');
    expect(detection.port).toBe(4000);

    const { path: dfPath, generated } = await adapter.ensureDockerfile(
      { workspaceRoot: tempDir },
      detection,
    );

    expect(generated).toBe(true);
    const content = await fs.readFile(dfPath, 'utf-8');
    expect(content).toContain('FROM node:20-alpine');
    expect(content).toContain('EXPOSE 4000');
    expect(content).toContain('CMD ["npm", "start"]');
  });

  it('detects static web project and generates static serve Dockerfile', async () => {
    await fs.writeFile(path.join(tempDir, 'index.html'), '<h1>Static Site</h1>', 'utf-8');

    const detection = await adapter.detect({
      workspaceRoot: tempDir,
    });

    expect(detection.projectType).toBe('static');

    const { path: dfPath } = await adapter.ensureDockerfile(
      { workspaceRoot: tempDir },
      detection,
    );
    const content = await fs.readFile(dfPath, 'utf-8');
    expect(content).toContain('Static Web App');
    expect(content).toContain('serve');
  });

  it('generates a Caddyfile reverse proxy configuration with automatic TLS', () => {
    const caddyfile = adapter.generateCaddyfile('app.example.com', 3000);

    expect(caddyfile).toContain('app.example.com {');
    expect(caddyfile).toContain('reverse_proxy 127.0.0.1:3000');
    expect(caddyfile).toContain('encode gzip zstd');
    expect(caddyfile).toContain('X-Content-Type-Options nosniff');
  });

  it('generates a deployment preview with planned actions and injected secrets', async () => {
    await fs.writeFile(path.join(tempDir, 'index.html'), '<h1>App</h1>', 'utf-8');

    const preview = await adapter.preview(
      { workspaceRoot: tempDir },
      {
        name: 'production',
        domain: 'app.example.com',
        host: '192.168.1.100',
        secrets: {
          SSH_PRIVATE_KEY: '{{secret:PROD_SSH_KEY}}',
        },
      },
    );

    expect(preview.adapterName).toBe('self-hosted');
    expect(preview.environment).toBe('production');
    expect(preview.targetUrl).toBe('https://app.example.com');
    expect(preview.targetHost).toBe('192.168.1.100');
    expect(preview.injectedSecretKeys).toContain('SSH_PRIVATE_KEY');
    expect(preview.actions.length).toBeGreaterThanOrEqual(5);
  });

  it('deploys, records releases, and performs rollback to previous release', async () => {
    await fs.writeFile(path.join(tempDir, 'index.html'), '<h1>App</h1>', 'utf-8');

    // Deploy Release 1
    const deploy1 = await adapter.deploy(
      { workspaceRoot: tempDir, gitCommit: 'commit-1' },
      {
        name: 'production',
        domain: 'app.example.com',
        host: '192.168.1.100',
      },
    );

    expect(deploy1.success).toBe(true);
    expect(deploy1.releaseId).toBeDefined();

    // Deploy Release 2
    const deploy2 = await adapter.deploy(
      { workspaceRoot: tempDir, gitCommit: 'commit-2' },
      {
        name: 'production',
        domain: 'app.example.com',
        host: '192.168.1.100',
      },
    );

    expect(deploy2.releaseId).not.toBe(deploy1.releaseId);

    // Rollback to Release 1
    const rollback = await adapter.rollback(deploy2.releaseId);
    expect(rollback.success).toBe(true);
    expect(rollback.rolledBackFromReleaseId).toBe(deploy2.releaseId);
    expect(rollback.activeReleaseId).toBe(deploy1.releaseId);

    // Verify logs
    const logs = await adapter.logs(deploy1.releaseId);
    expect(logs.length).toBeGreaterThan(0);
  });
});
