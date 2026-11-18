export const PACKAGE_NAME = '@nirman/security';

/**
 * Security policy modes:
 * - 'ask_all': Every tool call requires explicit user confirmation
 * - 'ask_risky': Safe workspace operations are allowed; risky commands/tools require confirmation
 * - 'autonomous_sandbox': Operations strictly inside sandbox are allowed; dangerous/network operations ask or deny
 */
export type PolicyMode = 'ask_all' | 'ask_risky' | 'autonomous_sandbox';

/**
 * Policy decision outcomes:
 * - 'allow': Tool executes automatically without user intervention
 * - 'ask': Tool execution pauses and prompts user for approval
 * - 'deny': Tool execution is strictly rejected and prohibited
 */
export type PolicyAction = 'allow' | 'ask' | 'deny';

/**
 * Risk classification for a tool or command execution
 */
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

/**
 * Rule definition for command execution inside shell
 */
export interface CommandRule {
  /** Regex pattern or substring to match command against */
  pattern: string;
  /** Action to take when matched */
  action: PolicyAction;
  /** Optional human-readable rationale */
  reason?: string | undefined;
  /** Whether the command requires network access */
  requireNetwork?: boolean | undefined;
}

/**
 * Security policy configuration loaded from .agent/policy.yaml
 */
export interface SecurityPolicy {
  version?: string | undefined;
  mode: PolicyMode;
  tools: Record<string, PolicyAction>;
  commands: CommandRule[];
}

/**
 * Request payload when evaluating a tool call against the security policy
 */
export interface PolicyEvaluationRequest {
  toolName: string;
  args: Record<string, unknown>;
  workspaceRoot?: string | undefined;
  isTainted?: boolean | undefined; // Set when recent turns ingested untrusted external content
  taintSource?: string | undefined;
}

/**
 * Result of evaluating a tool call against the security policy
 */
export interface PolicyEvaluationResult {
  action: PolicyAction;
  riskLevel: RiskLevel;
  reason: string;
  matchedRule?: string | undefined;
  requiresUntrustedWarning?: boolean | undefined;
  taintSource?: string | undefined;
}

/**
 * Audit log entry structure forming a cryptographic SHA-256 hash chain
 */
export interface AuditEntry {
  index: number;
  id: string;
  timestamp: string;
  eventType: 'policy_eval' | 'tool_call' | 'approval' | 'secret_access';
  action: PolicyAction;
  tool: string;
  params: Record<string, unknown>;
  result?: unknown;
  userApproval?: ('approved' | 'rejected' | 'none') | undefined;
  tainted?: boolean | undefined;
  prevHash: string;
  hash: string;
}

/**
 * Result of verifying the cryptographic integrity of an audit log
 */
export interface AuditVerificationResult {
  valid: boolean;
  totalEntries: number;
  error?: string | undefined;
  brokenIndex?: number | undefined;
}

/**
 * Secrets store interface
 */
export interface ISecretsStore {
  setSecret(name: string, value: string): Promise<void>;
  getSecret(name: string): Promise<string | undefined>;
  hasSecret(name: string): Promise<boolean>;
  deleteSecret(name: string): Promise<boolean>;
  listSecretNames(): Promise<string[]>;
  expandSecrets(text: string): Promise<string>;
  redactSecrets(text: string): string;
}
