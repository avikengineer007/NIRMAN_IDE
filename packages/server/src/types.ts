import type { AgentEvent, TaskItem } from '@nirman/artifacts';
import type { ModelConfig } from '@nirman/model';

/**
 * Standard JSON-RPC 2.0 Error Codes
 */
export const JSON_RPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  UNAUTHORIZED: -32001,
  RUN_NOT_FOUND: -32002,
  INVALID_STATE: -32003,
} as const;

export interface JsonRpcRequest<T = Record<string, unknown>> {
  jsonrpc: '2.0';
  id?: string | number | null | undefined;
  method: string;
  params?: T | undefined;
}

export interface JsonRpcResponse<T = unknown> {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: T | undefined;
  error?: JsonRpcError | undefined;
}

export interface JsonRpcNotification<T = unknown> {
  jsonrpc: '2.0';
  method: string;
  params: T;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

/**
 * Run status lifecycle states
 */
export type RunStatus =
  | 'starting'
  | 'planning'
  | 'waiting_approval'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'blocked';

export interface RunComment {
  timestamp: string;
  feedback: string;
  artifactPath?: string | undefined;
}

export interface RunPendingApproval {
  type: 'plan' | 'action';
  actionId?: string | undefined;
  toolName?: string | undefined;
  reason?: string | undefined;
}

/**
 * Record representing an active or completed run
 */
export interface RunRecord {
  runId: string;
  task: string;
  status: RunStatus;
  repoRoot: string;
  worktreePath: string;
  gitBranch: string;
  startTime: string;
  endTime?: string | undefined;
  stepsCount: number;
  error?: string | undefined;
  tasks?: readonly TaskItem[] | undefined;
  currentTask?: string | undefined;
  pendingApproval?: RunPendingApproval | undefined;
  comments?: readonly RunComment[] | undefined;
}

/**
 * Parameters for starting a new run
 */
export interface StartRunParams {
  task: string;
  workspaceRoot: string;
  runId?: string | undefined;
  modelConfig?: ModelConfig | undefined;
  skipPlanning?: boolean | undefined;
  autoApprove?: boolean | undefined;
  maxSteps?: number | undefined;
  maxTimeMs?: number | undefined;
}

/**
 * Result returned upon starting a run
 */
export interface StartRunResult {
  runId: string;
  status: RunStatus;
  worktreePath: string;
  gitBranch: string;
}

/**
 * Options for configuring the Nirman daemon server
 */
export interface ServerConfig {
  /** Port to listen on (0 for automatic ephemeral port, defaults to 4096) */
  port?: number | undefined;
  /** Host to bind to. Must be '127.0.0.1' or 'localhost' */
  host?: string | undefined;
  /** Per-session authentication token (auto-generated if omitted) */
  token?: string | undefined;
  /** Custom directory for worktrees and run metadata */
  baseWorktreesDir?: string | undefined;
}

/**
 * Information on an artifact file
 */
export interface ArtifactFileInfo {
  name: string;
  relativePath: string;
  sizeBytes: number;
  modifiedTime: string;
}

/**
 * Payload sent over WebSocket when an agent event occurs
 */
export interface AgentEventNotificationParams {
  runId: string;
  event: AgentEvent;
}
