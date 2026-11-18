import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DeploymentOrchestrator } from './orchestrator.js';
import { SelfHostedAdapter } from './adapters/self-hosted.js';
import { RenderAdapter } from './adapters/render.js';
import { ReleaseManager } from './release-manager.js';
import { EncryptedSecretsStore, AuditLogger, verifyAuditLogIntegrity } from '@nirman/security';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';

describe('Step 9 Acceptance: End-to-End Deploy, Live Verification, Rollback & Artifacts', () => {
  let workspaceDir: string;
  let runDir: string;
  let testServer: http.Server;
  const targetPort = 5678;
  const targetUrl = `http://127.0.0.1:${targetPort}`;
  const runId = 'run-deploy-acceptance-001';

  let orchestrator: DeploymentOrchestrator;
  let secretsStore: EncryptedSecretsStore;
  let auditLogger: AuditLogger;
  let releaseManager: ReleaseManager;
  let auditLogPath: string;

  beforeAll(async () => {
    // 1. Setup temporary workspace and directories
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nirman-deploy-acceptance-'));
    runDir = path.join(workspaceDir, '.agent', 'runs', runId);
    await fs.mkdir(runDir, { recursive: true });

    auditLogPath = path.join(workspaceDir, '.agent', 'audit.jsonl');
    auditLogger = new AuditLogger(auditLogPath);
    releaseManager = new ReleaseManager(path.join(workspaceDir, '.agent', 'releases.json'));
    secretsStore = new EncryptedSecretsStore({
      storagePath: path.join(workspaceDir, '.agent', 'secrets.enc'),
      masterKey: 'test-master-deploy-passphrase-secure-999',
    });

    // Seed deployment secret into the encrypted store
    await secretsStore.setSecret('DEPLOY_SSH_KEY', 'ssh-ed25519-secret-key-production-val-777');

    // 2. Build the sample web app in workspace
    const htmlContent = `<!DOCTYPE html>
<html>
  <head><title>Deployed NIRMAN Task Manager</title></head>
  <body>
    <h1>NIRMAN Task Manager (Live Production)</h1>
    <p id="status">System Status: Operational</p>
  </body>
</html>`;

    await fs.writeFile(path.join(workspaceDir, 'index.html'), htmlContent, 'utf-8');
    await fs.writeFile(
      path.join(workspaceDir, 'package.json'),
      '{"name": "nirman-deployed-app", "version": "1.0.0"}',
      'utf-8',
    );
    await fs.writeFile(
      path.join(workspaceDir, 'SPEC.md'),
      `# Deployed Web App SPEC\nPort: ${targetPort}\nURL: ${targetUrl}`,
      'utf-8',
    );

    // 3. Start local target HTTP server to act as live deployment endpoint
    await new Promise<void>((resolve) => {
      testServer = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(htmlContent);
      });
      testServer.listen(targetPort, '127.0.0.1', () => resolve());
    });

    // 4. Initialize Orchestrator with both Self-Hosted and Render adapters
    orchestrator = new DeploymentOrchestrator({
      releaseManager,
      auditLogger,
      secretsStore,
      adapters: [
        new SelfHostedAdapter(releaseManager),
        new RenderAdapter(releaseManager, { serviceId: 'srv-acceptance-app' }),
      ],
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      if (testServer) {
        testServer.close(() => resolve());
      } else {
        resolve();
      }
    });

    await new Promise((r) => setTimeout(r, 200));
    try {
      await fs.rm(workspaceDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // ignore
    }
  });

  it('enforces mandatory approval gate before executing any deployment', async () => {
    // When user rejects approval, deploy must abort immediately and log rejection
    await expect(
      orchestrator.executeDeploy({
        adapterName: 'self-hosted',
        project: { workspaceRoot: workspaceDir },
        environment: {
          name: 'production',
          host: '127.0.0.1',
          domain: `127.0.0.1:${targetPort}`,
        },
        artifactsDir: runDir,
        runId,
        onApproval: () => false, // User clicks reject
      }),
    ).rejects.toThrow('Deployment cancelled: User rejected deployment preview');
  });

  it('deploys sample web app with secret injection, verifies live URL with browser, rolls back, and generates artifacts', async () => {
    let previewReceived = false;

    // 1. Deploy Release 1 with approval and secret reference
    const deploy1 = await orchestrator.executeDeploy({
      adapterName: 'self-hosted',
      project: { workspaceRoot: workspaceDir, gitCommit: 'commit-sha-v1' },
      environment: {
        name: 'production',
        host: '127.0.0.1',
        domain: `127.0.0.1:${targetPort}`,
        secrets: {
          SSH_PRIVATE_KEY: '{{secret:DEPLOY_SSH_KEY}}',
        },
      },
      artifactsDir: runDir,
      runId,
      onApproval: (preview) => {
        previewReceived = true;
        // Verify preview shows target URL, environment, actions, and secret reference keys (values hidden)
        expect(preview.environment).toBe('production');
        expect(preview.targetUrl).toBe(targetUrl);
        expect(preview.injectedSecretKeys).toContain('SSH_PRIVATE_KEY');
        expect(preview.actions.length).toBeGreaterThan(0);
        return true; // Approve
      },
    });

    expect(previewReceived).toBe(true);
    expect(deploy1.deployResult.success).toBe(true);
    expect(deploy1.deployResult.url).toBe(targetUrl);
    expect(deploy1.deployResult.releaseId).toBeDefined();

    // 2. Verify Post-Deploy Live Browser Health Check & Screenshot
    expect(deploy1.verification.success).toBe(true);
    expect(deploy1.verification.httpStatus).toBe(200);
    expect(deploy1.verification.pageTitle).toBe('Deployed NIRMAN Task Manager');
    expect(deploy1.verification.screenshotPath).toBeDefined();

    const shot1Stat = await fs.stat(deploy1.verification.screenshotPath!);
    expect(shot1Stat.size).toBeGreaterThan(1000); // Valid PNG screenshot

    // 3. Deploy Release 2
    const deploy2 = await orchestrator.executeDeploy({
      adapterName: 'self-hosted',
      project: { workspaceRoot: workspaceDir, gitCommit: 'commit-sha-v2' },
      environment: {
        name: 'production',
        host: '127.0.0.1',
        domain: `127.0.0.1:${targetPort}`,
        secrets: {
          SSH_PRIVATE_KEY: '{{secret:DEPLOY_SSH_KEY}}',
        },
      },
      artifactsDir: runDir,
      runId: `${runId}-v2`,
      onApproval: () => true,
    });

    expect(deploy2.deployResult.releaseId).not.toBe(deploy1.deployResult.releaseId);

    // 4. Rollback to Release 1
    const rollback = await orchestrator.executeRollback({
      adapterName: 'self-hosted',
      releaseId: deploy2.deployResult.releaseId,
      artifactsDir: runDir,
      runId,
      verifyUrl: true,
    });

    expect(rollback.rollbackResult.success).toBe(true);
    expect(rollback.rollbackResult.rolledBackFromReleaseId).toBe(deploy2.deployResult.releaseId);
    expect(rollback.rollbackResult.activeReleaseId).toBe(deploy1.deployResult.releaseId);
    expect(rollback.rollbackResult.url).toBe(targetUrl);

    // 5. Verify Artifacts exist and contain complete information
    const deployDir = path.join(runDir, 'deploy');

    // Deployment report markdown
    const mdReport = await fs.readFile(path.join(deployDir, 'deployment-report.md'), 'utf-8');
    expect(mdReport).toContain('# Deployment Report');
    expect(mdReport).toContain('**Target Adapter:** `self-hosted`');
    expect(mdReport).toContain(targetUrl);
    expect(mdReport).toContain('**Health Check Status:** PASSED');
    expect(mdReport).toContain('**Verification Screenshot:**');

    // Deployment JSON
    const jsonReport = JSON.parse(
      await fs.readFile(path.join(deployDir, 'deployment.json'), 'utf-8'),
    ) as { deployResult: { success: boolean; releaseId: string } };
    expect(jsonReport.deployResult.success).toBe(true);
    expect(jsonReport.deployResult.releaseId).toBeDefined();

    // Rollback report markdown
    const rollbackReport = await fs.readFile(path.join(deployDir, 'rollback-report.md'), 'utf-8');
    expect(rollbackReport).toContain('# Rollback Report');
    expect(rollbackReport).toContain(deploy2.deployResult.releaseId);
    expect(rollbackReport).toContain(deploy1.deployResult.releaseId);
    expect(rollbackReport).toContain('**Status:** SUCCESS');

    // Release manager retention
    const releases = await releaseManager.listReleases('production');
    expect(releases.length).toBeGreaterThanOrEqual(2);
    expect(releases[0]?.releaseId).toBe(deploy2.deployResult.releaseId);
    expect(releases[1]?.releaseId).toBe(deploy1.deployResult.releaseId);

    // 6. Verify Append-Only, Hash-Chained Audit Log
    const auditVerification = await verifyAuditLogIntegrity(auditLogPath);
    expect(auditVerification.valid).toBe(true);
    expect(auditVerification.totalEntries).toBeGreaterThanOrEqual(6); // preview, approval, deploy v1, deploy v2, rollback, etc.

    // Check that secret plaintext was NEVER leaked into the audit log
    const rawAuditLog = await fs.readFile(auditLogPath, 'utf-8');
    expect(rawAuditLog).not.toContain('ssh-ed25519-secret-key-production-val-777');
  }, 15_000);

  it('also tests the Render PaaS adapter deployment and rollback cycle', async () => {
    const deployRender = await orchestrator.executeDeploy({
      adapterName: 'render',
      project: { workspaceRoot: workspaceDir },
      environment: {
        name: 'production',
        secrets: {
          RENDER_API_KEY: '{{secret:DEPLOY_SSH_KEY}}',
        },
        config: { serviceName: 'acceptance-task-manager' },
      },
      artifactsDir: runDir,
      runId: 'run-render-test',
      onApproval: (preview) => {
        expect(preview.adapterName).toBe('render');
        expect(preview.targetUrl).toContain('acceptance-task-manager.onrender.com');
        return true;
      },
    });

    expect(deployRender.deployResult.success).toBe(true);
    expect(deployRender.deployResult.url).toContain('onrender.com');
  }, 15_000);
});
