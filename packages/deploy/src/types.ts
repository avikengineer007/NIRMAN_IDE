export const PACKAGE_NAME = '@nirman/deploy';

export interface ProjectContext {
  workspaceRoot: string;
  specMarkdown?: string | undefined;
  gitCommit?: string | undefined;
  environmentVariables?: Record<string, string> | undefined;
}

export interface DetectionResult {
  detected: boolean;
  adapterName: string;
  projectType: 'docker' | 'node' | 'static' | 'python' | 'unknown';
  entrypoint?: string | undefined;
  port: number;
  dockerfilePath?: string | undefined;
  details: Record<string, unknown>;
}

export interface BuildResult {
  success: boolean;
  artifactPath?: string | undefined;
  imageTag?: string | undefined;
  logs: string[];
  error?: string | undefined;
}

export interface DeploymentEnvironment {
  name: string; // e.g. 'production' | 'staging' | 'test'
  domain?: string | undefined;
  host?: string | undefined;
  secrets?: Record<string, string> | undefined; // Secret references e.g. { SSH_KEY: '{{secret:MY_SSH_KEY}}' }
  config?: Record<string, unknown> | undefined;
}

export interface DeployPreview {
  adapterName: string;
  environment: string;
  targetHost?: string | undefined;
  targetUrl: string;
  actions: string[];
  injectedSecretKeys: string[];
  dockerfileGenerated: boolean;
  caddyfileGenerated?: boolean | undefined;
  releaseTag: string;
}

export interface DeployResult {
  success: boolean;
  url: string;
  releaseId: string;
  timestamp: string;
  logs: string[];
  error?: string | undefined;
}

export interface VerificationResult {
  success: boolean;
  url: string;
  httpStatus: number;
  responseTimeMs: number;
  pageTitle?: string | undefined;
  screenshotPath?: string | undefined;
  error?: string | undefined;
}

export interface RollbackResult {
  success: boolean;
  rolledBackFromReleaseId: string;
  activeReleaseId: string;
  url: string;
  logs: string[];
  error?: string | undefined;
}

export interface ReleaseRecord {
  releaseId: string;
  adapterName: string;
  environment: string;
  url: string;
  timestamp: string;
  gitCommit?: string | undefined;
  status: 'active' | 'rolled_back' | 'failed';
  metadata: Record<string, unknown>;
}

export interface IDeployAdapter {
  readonly name: string;
  detect(project: ProjectContext): Promise<DetectionResult>;
  build(project: ProjectContext): Promise<BuildResult>;
  preview(project: ProjectContext, env: DeploymentEnvironment): Promise<DeployPreview>;
  deploy(project: ProjectContext, env: DeploymentEnvironment): Promise<DeployResult>;
  verify(url: string, screenshotsDir?: string): Promise<VerificationResult>;
  rollback(releaseId: string): Promise<RollbackResult>;
  logs(releaseId: string, lines?: number): Promise<string[]>;
}

export type DeployApprovalHandler = (preview: DeployPreview) => Promise<boolean> | boolean;
