import type {
  AgentEvent,
  ClarificationRequestedEvent,
  ErrorEvent,
  ModelMessageEvent,
  PlanApprovedEvent,
  PlanCreatedEvent,
  PlanRevisionRequestedEvent,
  RunFinishedEvent,
  RunStartedEvent,
  TaskItem,
  TaskRetryEvent,
  TaskStatus,
  TaskStatusChangedEvent,
  ToolCallEvent,
  ToolResultEvent,
  VerificationFinishedEvent,
  VerificationStartedEvent,
  WalkthroughCreatedEvent,
} from './types.js';

export function createRunStartedEvent(runId: string, task: string): RunStartedEvent {
  return {
    type: 'run_started',
    runId,
    task,
    timestamp: new Date().toISOString(),
  };
}

export function createClarificationRequestedEvent(
  runId: string,
  questions: readonly string[],
): ClarificationRequestedEvent {
  return {
    type: 'clarification_requested',
    runId,
    questions,
    timestamp: new Date().toISOString(),
  };
}

export function createPlanCreatedEvent(
  runId: string,
  planPath: string,
  specPath: string,
  tasks: readonly TaskItem[],
): PlanCreatedEvent {
  return {
    type: 'plan_created',
    runId,
    planPath,
    specPath,
    tasks,
    timestamp: new Date().toISOString(),
  };
}

export function createPlanRevisionRequestedEvent(
  runId: string,
  feedback: string,
): PlanRevisionRequestedEvent {
  return {
    type: 'plan_revision_requested',
    runId,
    feedback,
    timestamp: new Date().toISOString(),
  };
}

export function createPlanApprovedEvent(runId: string): PlanApprovedEvent {
  return {
    type: 'plan_approved',
    runId,
    timestamp: new Date().toISOString(),
  };
}

export function createTaskStatusChangedEvent(
  runId: string,
  taskId: string,
  status: TaskStatus,
  explanation?: string,
): TaskStatusChangedEvent {
  return {
    type: 'task_status_changed',
    runId,
    taskId,
    status,
    ...(explanation !== undefined ? { explanation } : {}),
    timestamp: new Date().toISOString(),
  };
}

export function createVerificationStartedEvent(
  runId: string,
  taskId: string,
  command: string,
): VerificationStartedEvent {
  return {
    type: 'verification_started',
    runId,
    taskId,
    command,
    timestamp: new Date().toISOString(),
  };
}

export function createVerificationFinishedEvent(
  runId: string,
  taskId: string,
  command: string,
  success: boolean,
  output: string,
  error?: string,
): VerificationFinishedEvent {
  return {
    type: 'verification_finished',
    runId,
    taskId,
    command,
    success,
    output,
    ...(error !== undefined ? { error } : {}),
    timestamp: new Date().toISOString(),
  };
}

export function createTaskRetryEvent(
  runId: string,
  taskId: string,
  attempt: number,
  maxRetries: number,
  error: string,
): TaskRetryEvent {
  return {
    type: 'task_retry',
    runId,
    taskId,
    attempt,
    maxRetries,
    error,
    timestamp: new Date().toISOString(),
  };
}

export function createWalkthroughCreatedEvent(
  runId: string,
  path: string,
): WalkthroughCreatedEvent {
  return {
    type: 'walkthrough_created',
    runId,
    path,
    timestamp: new Date().toISOString(),
  };
}

export function createModelMessageEvent(
  runId: string,
  role: string,
  content: string,
): ModelMessageEvent {
  return {
    type: 'model_message',
    runId,
    role,
    content,
    timestamp: new Date().toISOString(),
  };
}

export function createToolCallEvent(
  runId: string,
  toolCallId: string,
  tool: string,
  args: Record<string, unknown>,
): ToolCallEvent {
  return {
    type: 'tool_call',
    runId,
    toolCallId,
    tool,
    arguments: args,
    timestamp: new Date().toISOString(),
  };
}

export function createToolResultEvent(
  runId: string,
  toolCallId: string,
  tool: string,
  success: boolean,
  output: string,
  error?: string,
  truncated?: boolean,
): ToolResultEvent {
  return {
    type: 'tool_result',
    runId,
    toolCallId,
    tool,
    success,
    output,
    ...(error !== undefined ? { error } : {}),
    ...(truncated !== undefined ? { truncated } : {}),
    timestamp: new Date().toISOString(),
  };
}

export function createRunFinishedEvent(
  runId: string,
  status: 'completed' | 'failed' | 'cancelled' | 'blocked',
  totalSteps: number,
  durationMs: number,
  reason?: string,
): RunFinishedEvent {
  return {
    type: 'run_finished',
    runId,
    status,
    totalSteps,
    durationMs,
    ...(reason !== undefined ? { reason } : {}),
    timestamp: new Date().toISOString(),
  };
}

export function createErrorEvent(runId: string, error: string): ErrorEvent {
  return {
    type: 'error',
    runId,
    error,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Format an event for the plain-text append-only log.txt
 */
export function formatEventLog(event: AgentEvent): string {
  const ts = event.timestamp;
  switch (event.type) {
    case 'run_started':
      return `[${ts}] [RUN_STARTED] Task: "${event.task}"`;
    case 'clarification_requested':
      return `[${ts}] [CLARIFICATION_REQUESTED] Questions:\n${event.questions.map((q, i) => `  ${i + 1}. ${q}`).join('\n')}`;
    case 'plan_created':
      return `[${ts}] [PLAN_CREATED] Plan: ${event.planPath}, Spec: ${event.specPath}, Tasks: ${event.tasks.length} steps`;
    case 'plan_revision_requested':
      return `[${ts}] [PLAN_REVISION_REQUESTED] Feedback: "${event.feedback}"`;
    case 'plan_approved':
      return `[${ts}] [PLAN_APPROVED] Plan approved by user. Proceeding to execution.`;
    case 'task_status_changed':
      return `[${ts}] [TASK_STATUS_CHANGED] Task "${event.taskId}" -> ${event.status}${event.explanation ? ` (${event.explanation})` : ''}`;
    case 'verification_started':
      return `[${ts}] [VERIFICATION_STARTED] Task "${event.taskId}" Command: "${event.command}"`;
    case 'verification_finished':
      return `[${ts}] [VERIFICATION_FINISHED] Task "${event.taskId}" Success: ${event.success} Command: "${event.command}"${event.error ? ` Error: ${event.error}` : ''}`;
    case 'task_retry':
      return `[${ts}] [TASK_RETRY] Task "${event.taskId}" Attempt ${event.attempt}/${event.maxRetries} Error: ${event.error}`;
    case 'walkthrough_created':
      return `[${ts}] [WALKTHROUGH_CREATED] Path: ${event.path}`;
    case 'model_message':
      return `[${ts}] [MODEL_MESSAGE] (${event.role}):\n${event.content}\n`;
    case 'tool_call':
      return `[${ts}] [TOOL_CALL] ${event.tool} (id: ${event.toolCallId}) args: ${JSON.stringify(event.arguments)}`;
    case 'tool_result':
      return `[${ts}] [TOOL_RESULT] ${event.tool} (id: ${event.toolCallId}) success=${event.success}${event.error ? ` error="${event.error}"` : ''}\nOutput:\n${event.output}\n`;
    case 'run_finished':
      return `[${ts}] [RUN_FINISHED] Status: ${event.status}, Steps: ${event.totalSteps}, Duration: ${event.durationMs}ms${event.reason ? ` Reason: ${event.reason}` : ''}`;
    case 'error':
      return `[${ts}] [ERROR] ${event.error}`;
  }
}
