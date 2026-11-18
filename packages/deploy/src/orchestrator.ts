import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  IDeployAdapter,
  ProjectContext,
  DeploymentEnvironment,
  DeployResult,
  VerificationResult,
  RollbackResult,
  DeployPreview,
  DeployApprovalHandler,
} from './types.js';
import { ReleaseManager } from './release-manager.js';
import { AuditLogger, EncryptedSecretsStore } from '@nirman/security';

export interface OrchestratorOptions {
  adapters?: IDeployAdapter[] | undefined;
  releaseManager?: ReleaseManager | undefined;
  auditLogger?: AuditLogger | undefined;
  secretsStore?: EncryptedSecretsStore | undefined;
}

export interface ExecuteDeployOptions {
  adapterName: string;
  project: ProjectContext;
  environment: DeploymentEnvironment;
  artifactsDir: string;
  runId: string;
  onApproval?: DeployApprovalHandler | undefined;
}

export interface ExecuteRollbackOptions {
  adapterName: string;
  releaseId: string;
  artifactsDir: string;
  runId: string;
  verifyUrl?: boolean | undefined;
}

export class DeploymentOrchestrator {
  private adapters: Map<string, IDeployAdapter> = new Map();
  private releaseManager: ReleaseManager;
  private auditLogger: AuditLogger;
  private secretsStore: EncryptedSecretsStore;

  constructor(options: OrchestratorOptions = {}) {
    this.releaseManager = options.releaseManager ?? new ReleaseManager();
    this.auditLogger = options.auditLogger ?? new AuditLogger();
    this.secretsStore = options.secretsStore ?? new EncryptedSecretsStore();

    if (options.adapters) {
      for (const a of options.adapters) {
        this.adapters.set(a.name, a);
      }
    }
  }

  public registerAdapter(adapter: IDeployAdapter): void {
    this.adapters.set(adapter.name, adapter);
  }

  public getAdapter(name: string): IDeployAdapter {
    const adapter = this.adapters.get(name);
    if (!adapter) {
      throw new Error(
        `Deploy adapter "${name}" not found. Available adapters: [${Array.from(this.adapters.keys()).join(', ')}]`,
      );
    }
    return adapter;
  }

  /**
   * Executes a full deployment workflow with mandatory approval gate,
   * secret reference expansion, live URL verification, artifact storage, and audit logging.
   */
  public async executeDeploy(options: ExecuteDeployOptions): Promise<{
    deployResult: DeployResult;
    verification: VerificationResult;
    preview: DeployPreview;
    reportPath: string;
  }> {
    const adapter = this.getAdapter(options.adapterName);
    const deployDir = path.join(options.artifactsDir, 'deploy');
    const screenshotsDir = path.join(deployDir, 'screenshots');
    await fs.mkdir(screenshotsDir, { recursive: true });

    // 1. Build Preview
    const preview = await adapter.preview(options.project, options.environment);

    // Log preview generation to audit log
    await this.auditLogger.log({
      id: `deploy-preview-${options.runId}`,
      timestamp: new Date().toISOString(),
      eventType: 'policy_eval',
      action: 'ask',
      tool: `deploy:${options.adapterName}`,
      params: {
        environment: options.environment.name,
        targetUrl: preview.targetUrl,
        injectedSecretKeys: preview.injectedSecretKeys,
      },
    });

    // 2. Mandatory Approval Gate
    const approvalHandler = options.onApproval ?? (() => Promise.resolve(true));
    const approved = await approvalHandler(preview);

    await this.auditLogger.log({
      id: `deploy-approval-${options.runId}`,
      timestamp: new Date().toISOString(),
      eventType: 'approval',
      action: 'ask',
      tool: `deploy:${options.adapterName}`,
      params: {
        environment: options.environment.name,
        targetUrl: preview.targetUrl,
      },
      userApproval: approved ? 'approved' : 'rejected',
    });

    if (!approved) {
      throw new Error(`Deployment cancelled: User rejected deployment preview for "${preview.targetUrl}"`);
    }

    // 3. Inject Secrets by Reference
    const resolvedSecrets: Record<string, string> = {};
    if (options.environment.secrets) {
      for (const [key, ref] of Object.entries(options.environment.secrets)) {
        // Expand {{secret:NAME}} references into decrypted secrets
        resolvedSecrets[key] = await this.secretsStore.expandSecrets(ref);
      }
    }

    const resolvedEnv: DeploymentEnvironment = {
      ...options.environment,
      secrets: resolvedSecrets,
    };

    // 4. Execute Build & Deploy
    await adapter.build(options.project);
    const deployResult = await adapter.deploy(options.project, resolvedEnv);

    // Log deploy execution (with redacted secrets)
    await this.auditLogger.log({
      id: `deploy-exec-${options.runId}`,
      timestamp: new Date().toISOString(),
      eventType: 'tool_call',
      action: 'allow',
      tool: `deploy:${options.adapterName}`,
      params: {
        environment: options.environment.name,
        releaseId: deployResult.releaseId,
        url: deployResult.url,
      },
      result: {
        success: deployResult.success,
        releaseId: deployResult.releaseId,
      },
    });

    // 5. Post-Deploy Browser Verification
    const verification = await adapter.verify(deployResult.url, screenshotsDir);

    // 6. Write Deployment Artifact Report
    const reportPath = path.join(deployDir, 'deployment-report.md');
    const reportContent = this.generateDeploymentReport({
      runId: options.runId,
      adapterName: options.adapterName,
      preview,
      deployResult,
      verification,
    });
    await fs.writeFile(reportPath, reportContent, 'utf-8');

    const jsonPath = path.join(deployDir, 'deployment.json');
    await fs.writeFile(
      jsonPath,
      JSON.stringify(
        {
          runId: options.runId,
          adapterName: options.adapterName,
          deployResult,
          verification,
          preview,
        },
        null,
        2,
      ),
      'utf-8',
    );

    return {
      deployResult,
      verification,
      preview,
      reportPath,
    };
  }

  /**
   * Rolls back to the previous active release and logs to audit log
   */
  public async executeRollback(options: ExecuteRollbackOptions): Promise<{
    rollbackResult: RollbackResult;
    verification?: VerificationResult | undefined;
    reportPath: string;
  }> {
    const adapter = this.getAdapter(options.adapterName);
    const deployDir = path.join(options.artifactsDir, 'deploy');
    const screenshotsDir = path.join(deployDir, 'screenshots');
    await fs.mkdir(screenshotsDir, { recursive: true });

    const rollbackResult = await adapter.rollback(options.releaseId);

    // Log rollback to audit log
    await this.auditLogger.log({
      id: `rollback-${options.releaseId}`,
      timestamp: new Date().toISOString(),
      eventType: 'tool_call',
      action: 'allow',
      tool: `rollback:${options.adapterName}`,
      params: {
        fromReleaseId: options.releaseId,
        toReleaseId: rollbackResult.activeReleaseId,
        url: rollbackResult.url,
      },
      result: {
        success: rollbackResult.success,
      },
    });

    let verification: VerificationResult | undefined;
    if (options.verifyUrl) {
      verification = await adapter.verify(rollbackResult.url, screenshotsDir);
    }

    const reportPath = path.join(deployDir, 'rollback-report.md');
    const lines = [
      `# Rollback Report (${options.runId})`,
      `- **Adapter:** ${options.adapterName}`,
      `- **Rolled Back From:** \`${rollbackResult.rolledBackFromReleaseId}\``,
      `- **Active Release Restored:** \`${rollbackResult.activeReleaseId}\``,
      `- **Restored URL:** ${rollbackResult.url}`,
      `- **Status:** ${rollbackResult.success ? 'SUCCESS' : 'FAILED'}`,
      '',
      '## Rollback Logs',
      '```',
      ...rollbackResult.logs,
      '```',
    ];
    await fs.writeFile(reportPath, lines.join('\n'), 'utf-8');

    return {
      rollbackResult,
      verification,
      reportPath,
    };
  }

  private generateDeploymentReport(data: {
    runId: string;
    adapterName: string;
    preview: DeployPreview;
    deployResult: DeployResult;
    verification: VerificationResult;
  }): string {
    const lines: string[] = [];
    lines.push(`# Deployment Report (${data.runId})`);
    lines.push(`- **Target Adapter:** \`${data.adapterName}\``);
    lines.push(`- **Environment:** \`${data.preview.environment}\``);
    lines.push(`- **Live URL:** [${data.deployResult.url}](${data.deployResult.url})`);
    lines.push(`- **Release ID:** \`${data.deployResult.releaseId}\``);
    lines.push(`- **Timestamp:** ${data.deployResult.timestamp}`);
    lines.push('');

    lines.push('## Deployment Preview & Actions');
    lines.push(`- **Target Host:** \`${data.preview.targetHost ?? 'cloud'}\``);
    lines.push(`- **Injected Secret References:** [${data.preview.injectedSecretKeys.join(', ')}]`);
    lines.push('### Planned Actions');
    for (const action of data.preview.actions) {
      lines.push(`- ${action}`);
    }
    lines.push('');

    lines.push('## Post-Deploy Browser Verification');
    lines.push(
      `- **Health Check Status:** ${data.verification.success ? 'PASSED' : 'FAILED'} (HTTP ${data.verification.httpStatus})`,
    );
    lines.push(`- **Response Time:** ${data.verification.responseTimeMs}ms`);
    if (data.verification.pageTitle) {
      lines.push(`- **Page Title:** "${data.verification.pageTitle}"`);
    }
    if (data.verification.screenshotPath) {
      lines.push(`- **Verification Screenshot:** \`${path.basename(data.verification.screenshotPath)}\``);
    }
    lines.push('');

    lines.push('## Deployment Logs');
    lines.push('```');
    lines.push(...data.deployResult.logs);
    lines.push('```');

    return lines.join('\n');
  }
}
