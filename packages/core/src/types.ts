import type { ChatMessage, ModelClient } from '@nirman/model';
import type { Sandbox } from '@nirman/sandbox';
import type { ToolRegistry } from '@nirman/tools';
import type { AgentEvent, ArtifactStore, TaskItem } from '@nirman/artifacts';
import type { Planner } from './planner.js';
import type { RepoIndex } from './index/repo-index.js';
import type { ContextManager } from './context/context-manager.js';
import type {
  PolicyEngine,
  AuditLogger,
  EncryptedSecretsStore,
  TaintTracker,
} from '@nirman/security';
import type { BrowserVerifier } from '@nirman/browser';

export type ApprovalDecision =
  | { action: 'approve' }
  | { action: 'reject'; reason?: string }
  | { action: 'feedback'; feedback: string }
  | { action: 'edited'; editedPlan?: string };

export type ClarificationHandler = (
  questions: readonly string[],
) => Promise<Record<string, string>>;

export type ApprovalHandler = (
  planPath: string,
  specPath: string,
  tasks: readonly TaskItem[],
) => Promise<ApprovalDecision>;

export type ToolApprovalHandler = (
  toolName: string,
  args: Record<string, unknown>,
  reason: string,
) => Promise<boolean>;

/** Options for configuring an agent execution loop */
export interface AgentLoopOptions {
  task: string;
  workspaceRoot: string;
  modelClient: ModelClient;
  tools?: ToolRegistry;
  sandbox?: Sandbox;
  artifacts?: ArtifactStore;
  planner?: Planner;
  skipPlanning?: boolean;
  skipClarifications?: boolean;
  onClarification?: ClarificationHandler;
  onApproval?: ApprovalHandler;
  onToolApproval?: ToolApprovalHandler;
  maxSteps?: number;
  maxTimeMs?: number;
  maxTokens?: number;
  maxRetriesPerTask?: number;
  maxTotalRetries?: number;
  verificationTimeoutMs?: number;
  systemPrompt?: string;
  repoIndex?: RepoIndex;
  contextManager?: ContextManager;
  policyEngine?: PolicyEngine;
  auditLogger?: AuditLogger;
  secretsStore?: EncryptedSecretsStore;
  taintTracker?: TaintTracker;
  browserVerifier?: BrowserVerifier;
  enableBrowserVerification?: boolean;
  onEvent?: (event: AgentEvent) => void;
}

/** Final result of the agent loop */
export interface AgentLoopResult {
  runId: string;
  status: 'completed' | 'failed' | 'cancelled' | 'blocked';
  totalSteps: number;
  durationMs: number;
  reason?: string | undefined;
  error?: string | undefined;
  messages: readonly ChatMessage[];
  artifacts: ArtifactStore;
  tasks?: readonly TaskItem[] | undefined;
  diffPath?: string | undefined;
  walkthroughPath?: string | undefined;
}
