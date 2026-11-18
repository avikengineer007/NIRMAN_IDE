/** Event types emitted during an agent run */
export type AgentEventType =
  | 'run_started'
  | 'clarification_requested'
  | 'plan_created'
  | 'plan_revision_requested'
  | 'plan_approved'
  | 'task_status_changed'
  | 'verification_started'
  | 'verification_finished'
  | 'task_retry'
  | 'walkthrough_created'
  | 'model_message'
  | 'tool_call'
  | 'tool_result'
  | 'run_finished'
  | 'error';

/** Base interface for all typed events */
export interface BaseAgentEvent {
  runId: string;
  timestamp: string;
}

export interface RunStartedEvent extends BaseAgentEvent {
  type: 'run_started';
  task: string;
}

export interface ClarificationRequestedEvent extends BaseAgentEvent {
  type: 'clarification_requested';
  questions: readonly string[];
}

export interface PlanCreatedEvent extends BaseAgentEvent {
  type: 'plan_created';
  planPath: string;
  specPath: string;
  tasks: readonly TaskItem[];
}

export interface PlanRevisionRequestedEvent extends BaseAgentEvent {
  type: 'plan_revision_requested';
  feedback: string;
}

export interface PlanApprovedEvent extends BaseAgentEvent {
  type: 'plan_approved';
}

export interface TaskStatusChangedEvent extends BaseAgentEvent {
  type: 'task_status_changed';
  taskId: string;
  status: TaskStatus;
  explanation?: string | undefined;
}

export interface VerificationStartedEvent extends BaseAgentEvent {
  type: 'verification_started';
  taskId: string;
  command: string;
}

export interface VerificationFinishedEvent extends BaseAgentEvent {
  type: 'verification_finished';
  taskId: string;
  command: string;
  success: boolean;
  output: string;
  error?: string | undefined;
}

export interface TaskRetryEvent extends BaseAgentEvent {
  type: 'task_retry';
  taskId: string;
  attempt: number;
  maxRetries: number;
  error: string;
}

export interface WalkthroughCreatedEvent extends BaseAgentEvent {
  type: 'walkthrough_created';
  path: string;
}

export interface ModelMessageEvent extends BaseAgentEvent {
  type: 'model_message';
  role: string;
  content: string;
}

export interface ToolCallEvent extends BaseAgentEvent {
  type: 'tool_call';
  toolCallId: string;
  tool: string;
  arguments: Record<string, unknown>;
}

export interface ToolResultEvent extends BaseAgentEvent {
  type: 'tool_result';
  toolCallId: string;
  tool: string;
  success: boolean;
  output: string;
  error?: string | undefined;
  truncated?: boolean | undefined;
}

export interface RunFinishedEvent extends BaseAgentEvent {
  type: 'run_finished';
  status: 'completed' | 'failed' | 'cancelled' | 'blocked';
  totalSteps: number;
  durationMs: number;
  reason?: string | undefined;
}

export interface ErrorEvent extends BaseAgentEvent {
  type: 'error';
  error: string;
}

/** Union of all typed agent events */
export type AgentEvent =
  | RunStartedEvent
  | ClarificationRequestedEvent
  | PlanCreatedEvent
  | PlanRevisionRequestedEvent
  | PlanApprovedEvent
  | TaskStatusChangedEvent
  | VerificationStartedEvent
  | VerificationFinishedEvent
  | TaskRetryEvent
  | WalkthroughCreatedEvent
  | ModelMessageEvent
  | ToolCallEvent
  | ToolResultEvent
  | RunFinishedEvent
  | ErrorEvent;

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'blocked';

export interface TaskItem {
  id: string;
  title: string;
  description?: string | undefined;
  status: TaskStatus;
  retries?: number | undefined;
  error?: string | undefined;
  diffPath?: string | undefined;
}

/** Structure of tasks.json in .agent/runs/<run-id>/ */
export interface TasksData {
  runId: string;
  task: string;
  status: 'planning' | 'waiting_approval' | 'running' | 'completed' | 'failed' | 'cancelled' | 'blocked';
  startedAt: string;
  completedAt?: string | undefined;
  stepsCount: number;
  reason?: string | undefined;
  error?: string | undefined;
  tasks?: TaskItem[] | undefined;
  diffPath?: string | undefined;
  walkthroughPath?: string | undefined;
}
