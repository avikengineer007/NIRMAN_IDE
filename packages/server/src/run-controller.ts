import type { AgentEvent, ArtifactStore, TaskItem } from '@nirman/artifacts';
import type { ModelClient } from '@nirman/model';
import { LocalSandbox, type Sandbox } from '@nirman/sandbox';
import { createDefaultToolRegistry, type ToolRegistry } from '@nirman/tools';
import {
  runAgentLoop,
  type AgentLoopResult,
  type ApprovalDecision,
  type ApprovalHandler,
} from '@nirman/core';
import type { RunRecord, RunStatus, RunComment, RunPendingApproval } from './types.js';

export interface RunControllerOptions {
  runId: string;
  task: string;
  repoRoot: string;
  worktreePath: string;
  gitBranch: string;
  modelClient: ModelClient;
  artifacts: ArtifactStore;
  sandbox?: Sandbox | undefined;
  tools?: ToolRegistry | undefined;
  skipPlanning?: boolean | undefined;
  autoApprove?: boolean | undefined;
  maxSteps?: number | undefined;
  maxTimeMs?: number | undefined;
  onEvent?: ((event: AgentEvent) => void) | undefined;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export class RunController {
  public readonly runId: string;
  public readonly task: string;
  public readonly repoRoot: string;
  public readonly worktreePath: string;
  public readonly gitBranch: string;
  public readonly startTime: string;

  private status: RunStatus = 'starting';
  private endTime?: string | undefined;
  private error?: string | undefined;
  private stepsCount = 0;
  private tasks?: readonly TaskItem[] | undefined;

  private modelClient: ModelClient;
  private artifacts: ArtifactStore;
  private sandbox: Sandbox;
  private tools: ToolRegistry;
  private skipPlanning: boolean;
  private autoApprove: boolean;
  private maxSteps: number;
  private maxTimeMs: number;
  private onEventCallback?: ((event: AgentEvent) => void) | undefined;

  private isCancelled = false;
  private isPaused = false;
  private pauseDeferred: Deferred<void> | null = null;
  private approvalDeferred: Deferred<ApprovalDecision> | null = null;
  private actionApprovalDeferred: Deferred<boolean> | null = null;

  private comments: RunComment[] = [];
  private pendingActionId?: string | undefined;
  private pendingToolName?: string | undefined;
  private pendingActionReason?: string | undefined;

  private loopPromise?: Promise<AgentLoopResult> | undefined;

  constructor(options: RunControllerOptions) {
    this.runId = options.runId;
    this.task = options.task;
    this.repoRoot = options.repoRoot;
    this.worktreePath = options.worktreePath;
    this.gitBranch = options.gitBranch;
    this.startTime = new Date().toISOString();

    this.modelClient = options.modelClient;
    this.artifacts = options.artifacts;
    this.sandbox = options.sandbox ?? new LocalSandbox({ workspaceRoot: options.worktreePath });
    this.tools = options.tools ?? createDefaultToolRegistry();
    this.skipPlanning = options.skipPlanning ?? false;
    this.autoApprove = options.autoApprove ?? false;
    this.maxSteps = options.maxSteps ?? 50;
    this.maxTimeMs = options.maxTimeMs ?? 180_000;
    this.onEventCallback = options.onEvent;
  }

  public getStatus(): RunStatus {
    return this.status;
  }

  public getRecord(): RunRecord {
    const inProgressTask = this.tasks?.find((t) => t.status === 'in_progress');
    const firstPendingTask = this.tasks?.find((t) => t.status === 'pending');
    const currentTaskTitle =
      inProgressTask?.title ??
      firstPendingTask?.title ??
      (this.status === 'planning' ? 'Generating execution plan' : undefined);

    let pendingApproval: RunPendingApproval | undefined = undefined;
    if (this.status === 'waiting_approval' || this.approvalDeferred) {
      pendingApproval = { type: 'plan', reason: 'Execution plan awaiting approval' };
    } else if (this.actionApprovalDeferred) {
      pendingApproval = {
        type: 'action',
        actionId: this.pendingActionId,
        toolName: this.pendingToolName,
        reason: this.pendingActionReason ?? 'Security policy approval required',
      };
    }

    return {
      runId: this.runId,
      task: this.task,
      status: this.status,
      repoRoot: this.repoRoot,
      worktreePath: this.worktreePath,
      gitBranch: this.gitBranch,
      startTime: this.startTime,
      endTime: this.endTime,
      stepsCount: this.stepsCount,
      error: this.error,
      tasks: this.tasks,
      currentTask: currentTaskTitle,
      pendingApproval,
      comments: this.comments,
    };
  }

  /**
   * Starts the run execution loop in the background.
   */
  public start(): void {
    if (this.loopPromise) return;
    this.status = this.skipPlanning ? 'running' : 'planning';

    this.loopPromise = this.executeLoop();
  }

  private async executeLoop(): Promise<AgentLoopResult> {
    const onApprovalHandler: ApprovalHandler = async (planPath, specPath, tasks) => {
      this.tasks = tasks;
      if (this.autoApprove) {
        return { action: 'approve' };
      }

      this.status = 'waiting_approval';
      this.approvalDeferred = createDeferred<ApprovalDecision>();
      const decision = await this.approvalDeferred.promise;
      this.approvalDeferred = null;

      if (decision.action === 'approve') {
        this.status = this.isPaused ? 'paused' : 'running';
      }
      return decision;
    };

    const iterator = runAgentLoop({
      task: this.task,
      workspaceRoot: this.worktreePath,
      modelClient: this.modelClient,
      sandbox: this.sandbox,
      tools: this.tools,
      artifacts: this.artifacts,
      skipPlanning: this.skipPlanning,
      skipClarifications: true,
      onApproval: onApprovalHandler,
      onToolApproval: async (toolName: string, _args: Record<string, unknown>, reason: string) => {
        this.pendingToolName = toolName;
        this.pendingActionReason = reason || `Tool call '${toolName}' requires user approval`;
        this.actionApprovalDeferred = createDeferred<boolean>();
        const res = await this.actionApprovalDeferred.promise;
        this.actionApprovalDeferred = null;
        this.pendingToolName = undefined;
        this.pendingActionReason = undefined;
        return res;
      },
      maxSteps: this.maxSteps,
      maxTimeMs: this.maxTimeMs,
      onEvent: (event) => {
        this.handleEvent(event);
      },
    });

    try {
      while (!this.isCancelled) {
        if (this.isPaused && this.pauseDeferred) {
          await this.pauseDeferred.promise;
        }

        const next = await iterator.next();
        if (next.done) {
          const finalResult = next.value;
          this.status = finalResult.status;
          this.tasks = finalResult.tasks;
          this.endTime = new Date().toISOString();
          return finalResult;
        }
      }

      // If cancelled loop
      this.status = 'cancelled';
      this.endTime = new Date().toISOString();
      return {
        runId: this.runId,
        status: 'cancelled',
        totalSteps: this.stepsCount,
        durationMs: Date.now() - new Date(this.startTime).getTime(),
        messages: [],
        artifacts: this.artifacts,
      };
    } catch (err) {
      this.status = 'failed';
      this.error = err instanceof Error ? err.message : String(err);
      this.endTime = new Date().toISOString();
      throw err;
    }
  }

  private handleEvent(event: AgentEvent): void {
    if (event.type === 'tool_result' || event.type === 'model_message') {
      this.stepsCount++;
    }
    if (event.type === 'plan_created') {
      this.tasks = event.tasks;
    }
    if (event.type === 'task_status_changed' && this.tasks) {
      this.tasks = this.tasks.map((t) =>
        t.id === event.taskId ? { ...t, status: event.status } : t,
      );
    }

    if (this.onEventCallback) {
      this.onEventCallback(event);
    }
  }

  /**
   * Approves a plan waiting in waiting_approval state.
   */
  public approvePlan(): boolean {
    if (this.approvalDeferred) {
      this.approvalDeferred.resolve({ action: 'approve' });
      return true;
    }
    return false;
  }

  /**
   * Submits user feedback for plan revision or comments on an artifact during execution.
   * Comments are fed back to the agent without stopping it.
   */
  public comment(feedback: string, artifactPath?: string): boolean {
    const commentRecord: RunComment = {
      timestamp: new Date().toISOString(),
      feedback,
      artifactPath,
    };
    this.comments.push(commentRecord);

    if (this.approvalDeferred) {
      this.approvalDeferred.resolve({ action: 'feedback', feedback });
      return true;
    }

    // Feed comment back to run log and event stream without stopping execution
    void this.artifacts.appendLog(
      `[COMMENT] ${artifactPath ? `(${artifactPath}) ` : ''}${feedback}\n`,
    );

    if (this.onEventCallback) {
      this.onEventCallback({
        type: 'plan_revision_requested',
        runId: this.runId,
        timestamp: commentRecord.timestamp,
        feedback: `${artifactPath ? `[${artifactPath}] ` : ''}${feedback}`,
      });
    }

    return true;
  }

  /**
   * Pauses the run execution.
   */
  public pause(): boolean {
    if (this.status === 'running' || this.status === 'planning' || this.status === 'waiting_approval') {
      this.isPaused = true;
      this.status = 'paused';
      if (!this.pauseDeferred) {
        this.pauseDeferred = createDeferred<void>();
      }
      return true;
    }
    return false;
  }

  /**
   * Resumes a paused run.
   */
  public resume(): boolean {
    if (this.isPaused) {
      this.isPaused = false;
      this.status = this.approvalDeferred ? 'waiting_approval' : 'running';
      if (this.pauseDeferred) {
        this.pauseDeferred.resolve();
        this.pauseDeferred = null;
      }
      return true;
    }
    return false;
  }

  /**
   * Cancels a running or paused run.
   */
  public cancel(): boolean {
    this.isCancelled = true;
    this.status = 'cancelled';
    this.endTime = new Date().toISOString();

    if (this.approvalDeferred) {
      this.approvalDeferred.resolve({ action: 'reject', reason: 'Run cancelled by user' });
      this.approvalDeferred = null;
    }
    if (this.pauseDeferred) {
      this.pauseDeferred.resolve();
      this.pauseDeferred = null;
    }
    if (this.actionApprovalDeferred) {
      this.actionApprovalDeferred.resolve(false);
      this.actionApprovalDeferred = null;
    }

    return true;
  }

  /**
   * Approves or rejects a pending security policy action.
   */
  public approveAction(approved: boolean): boolean {
    if (this.actionApprovalDeferred) {
      this.actionApprovalDeferred.resolve(approved);
      return true;
    }
    return false;
  }

  /**
   * Awaits completion of the run.
   */
  public async waitForCompletion(): Promise<AgentLoopResult> {
    if (!this.loopPromise) {
      throw new Error(`Run ${this.runId} has not been started`);
    }
    return this.loopPromise;
  }
}
