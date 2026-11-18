import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RenderAdapter } from './adapters/render.js';
import { ReleaseManager } from './release-manager.js';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';

describe('RenderAdapter (Render PaaS Deployment)', () => {
  let tempDir: string;
  let adapter: RenderAdapter;
  let releaseManager: ReleaseManager;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nirman-render-test-'));
    releaseManager = new ReleaseManager(path.join(tempDir, 'releases.json'));
    adapter = new RenderAdapter(releaseManager, {
      apiKey: 'rnd_testApiKey123',
      serviceId: 'srv-my-web-app',
    });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('detects project and generates render.yaml blueprint if missing', async () => {
    await fs.writeFile(
      path.join(tempDir, 'package.json'),
      '{"name": "my-render-service", "scripts": {"start": "node index.js"}}',
      'utf-8',
    );

    const detection = await adapter.detect({ workspaceRoot: tempDir });
    expect(detection.detected).toBe(true);
    expect(detection.adapterName).toBe('render');

    const { path: bpPath, generated } = await adapter.ensureRenderBlueprint(
      { workspaceRoot: tempDir },
      'my-render-service',
    );

    expect(generated).toBe(true);
    const content = await fs.readFile(bpPath, 'utf-8');
    expect(content).toContain('type: web');
    expect(content).toContain('name: my-render-service');
    expect(content).toContain('runtime: node');
  });

  it('previews Render deployment showing target URL and secret references', async () => {
    const preview = await adapter.preview(
      { workspaceRoot: tempDir },
      {
        name: 'production',
        secrets: {
          RENDER_API_KEY: '{{secret:MY_RENDER_KEY}}',
          DATABASE_URL: '{{secret:PROD_DB_URL}}',
        },
        config: {
          serviceName: 'my-frontend',
        },
      },
    );

    expect(preview.adapterName).toBe('render');
    expect(preview.targetUrl).toBe('https://my-frontend.onrender.com');
    expect(preview.injectedSecretKeys).toEqual(['RENDER_API_KEY', 'DATABASE_URL']);
    expect(preview.actions).toContain('Trigger cloud container build and deploy via Render REST API');
  });

  it('deploys to Render, records releases, and rolls back cleanly', async () => {
    // Deploy Release 1
    const deploy1 = await adapter.deploy(
      { workspaceRoot: tempDir, gitCommit: 'commit-1' },
      {
        name: 'production',
        config: { serviceName: 'my-service' },
      },
    );

    expect(deploy1.success).toBe(true);
    expect(deploy1.url).toBe('https://my-service.onrender.com');

    // Deploy Release 2
    const deploy2 = await adapter.deploy(
      { workspaceRoot: tempDir, gitCommit: 'commit-2' },
      {
        name: 'production',
        config: { serviceName: 'my-service' },
      },
    );

    // Rollback to Release 1
    const rollback = await adapter.rollback(deploy2.releaseId);
    expect(rollback.success).toBe(true);
    expect(rollback.rolledBackFromReleaseId).toBe(deploy2.releaseId);
    expect(rollback.activeReleaseId).toBe(deploy1.releaseId);
    expect(rollback.url).toBe('https://my-service.onrender.com');

    // Fetch logs
    const logs = await adapter.logs(deploy1.releaseId);
    expect(logs.length).toBeGreaterThan(0);
  });
});
