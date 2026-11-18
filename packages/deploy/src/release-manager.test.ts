import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ReleaseManager } from './release-manager.js';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';

describe('ReleaseManager', () => {
  let tempDir: string;
  let releasesPath: string;
  let manager: ReleaseManager;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nirman-releases-test-'));
    releasesPath = path.join(tempDir, 'releases.json');
    manager = new ReleaseManager(releasesPath, 3); // Max 3 releases
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('records releases and supersedes previous active releases in same environment', async () => {
    await manager.recordRelease({
      releaseId: 'rel-1',
      adapterName: 'self-hosted',
      environment: 'production',
      url: 'https://app.com',
      timestamp: '2026-11-18T20:00:00Z',
      status: 'active',
      metadata: { port: 3000 },
    });

    let active = await manager.getActiveRelease('production');
    expect(active?.releaseId).toBe('rel-1');
    expect(active?.status).toBe('active');

    await manager.recordRelease({
      releaseId: 'rel-2',
      adapterName: 'self-hosted',
      environment: 'production',
      url: 'https://app.com',
      timestamp: '2026-11-18T20:10:00Z',
      status: 'active',
      metadata: { port: 3001 },
    });

    active = await manager.getActiveRelease('production');
    expect(active?.releaseId).toBe('rel-2');

    const previous = await manager.getPreviousRelease('production', 'rel-2');
    expect(previous?.releaseId).toBe('rel-1');
    expect(previous?.status).toBe('rolled_back');
  });

  it('enforces retention of the last N releases', async () => {
    for (let i = 1; i <= 5; i++) {
      await manager.recordRelease({
        releaseId: `rel-${i}`,
        adapterName: 'render',
        environment: 'staging',
        url: `https://app-${i}.onrender.com`,
        timestamp: `2026-11-18T20:0${i}:00Z`,
        status: 'active',
        metadata: {},
      });
    }

    const all = await manager.listReleases('staging');
    expect(all).toHaveLength(3); // Capped at maxHistory = 3
    expect(all.map((r) => r.releaseId)).toEqual(['rel-5', 'rel-4', 'rel-3']);
  });

  it('marks releases as rolled back', async () => {
    await manager.recordRelease({
      releaseId: 'rel-1',
      adapterName: 'self-hosted',
      environment: 'production',
      url: 'https://app.com',
      timestamp: '2026-11-18T20:00:00Z',
      status: 'active',
      metadata: {},
    });

    await manager.recordRelease({
      releaseId: 'rel-2',
      adapterName: 'self-hosted',
      environment: 'production',
      url: 'https://app.com',
      timestamp: '2026-11-18T20:05:00Z',
      status: 'active',
      metadata: {},
    });

    await manager.markRolledBack('rel-2', 'rel-1');

    const rel2 = await manager.getRelease('rel-2');
    const rel1 = await manager.getRelease('rel-1');

    expect(rel2?.status).toBe('rolled_back');
    expect(rel1?.status).toBe('active');
  });
});
