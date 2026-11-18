import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { ModelClient, ModelConfig } from '@nirman/model';
import { LocalSandbox } from '@nirman/sandbox';
import { createDefaultToolRegistry } from '@nirman/tools';
import { ArtifactStore, type AgentEvent } from '@nirman/artifacts';
import { runAgentLoop } from '@nirman/core';
import type {
  EvalTask,
  TaskExecutionResult,
  ModelBenchmarkSummary,
  FailureCategory,
  CheckResult,
} from './types.js';
import { TaskCheckRunner } from './checker.js';

export interface EvalRunnerOptions {
  modelClient: ModelClient;
  modelConfig: ModelConfig;
  providerName?: string;
  tasks: readonly EvalTask[];
  baseWorkspaceDir?: string;
  maxStepsPerTask?: number;
  taskTimeoutMs?: number;
  concurrency?: number;
  onTaskCompleted?: (result: TaskExecutionResult, index: number, total: number) => void;
}

export class EvalRunner {
  private options: EvalRunnerOptions;

  constructor(options: EvalRunnerOptions) {
    this.options = options;
  }

  /**
   * Executes the full evaluation suite across the given tasks
   */
  public async runSuite(): Promise<ModelBenchmarkSummary> {
    const startTime = Date.now();
    const results: TaskExecutionResult[] = [];

    const failureBreakdown: Record<FailureCategory, number> = {
      none: 0,
      bad_edits: 0,
      wrong_tool_use: 0,
      context_overflow: 0,
      stuck_loops: 0,
      timeout: 0,
      assertion_failed: 0,
    };

    const tasks = this.options.tasks;
    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i]!;
      const result = await this.runSingleTask(task);
      results.push(result);
      failureBreakdown[result.failureCategory]++;

      if (this.options.onTaskCompleted) {
        this.options.onTaskCompleted(result, i + 1, tasks.length);
      }
    }

    const totalDurationMs = Date.now() - startTime;
    const passedTasks = results.filter((r) => r.passed).length;
    const passRatePercent = tasks.length > 0 ? (passedTasks / tasks.length) * 100 : 0;
    const totalSteps = results.reduce((acc, r) => acc + r.steps, 0);
    const totalTokens = results.reduce((acc, r) => acc + r.tokensUsed, 0);

    return {
      modelName: this.options.modelConfig.model,
      provider: this.options.providerName ?? 'Ollama / Local',
      toolMode: this.options.modelConfig.toolMode ?? 'native',
      totalTasks: tasks.length,
      passedTasks,
      passRatePercent: Number(passRatePercent.toFixed(1)),
      avgSteps: tasks.length > 0 ? Number((totalSteps / tasks.length).toFixed(1)) : 0,
      avgTokens: tasks.length > 0 ? Number((totalTokens / tasks.length).toFixed(0)) : 0,
      totalDurationMs,
      failureBreakdown,
      taskResults: results,
    };
  }

  /**
   * Runs an individual evaluation task in an isolated workspace
   */
  public async runSingleTask(task: EvalTask): Promise<TaskExecutionResult> {
    const taskStart = Date.now();
    const workspaceRoot = await fs.mkdtemp(
      path.join(this.options.baseWorkspaceDir ?? os.tmpdir(), `nirman-eval-${task.id}-`),
    );

    // Write initial task files
    if (task.initialFiles) {
      for (const [filename, content] of Object.entries(task.initialFiles)) {
        const full = path.join(workspaceRoot, filename);
        await fs.mkdir(path.dirname(full), { recursive: true });
        await fs.writeFile(full, content, 'utf-8');
      }
    }

    const sandbox = new LocalSandbox({ workspaceRoot });
    const tools = createDefaultToolRegistry();
    const artifacts = new ArtifactStore(workspaceRoot, `eval-${task.id}`);
    await artifacts.init(task.description);

    let steps = 0;
    let tokensUsed = 0;
    let detectedFailure: FailureCategory = 'none';
    let failureReason: string | undefined;

    const maxSteps = this.options.maxStepsPerTask ?? 15;
    const timeoutMs = task.timeoutMs ?? this.options.taskTimeoutMs ?? 45_000;

    try {
      const loop = runAgentLoop({
        task: task.description,
        workspaceRoot,
        modelClient: this.options.modelClient,
        sandbox,
        tools,
        artifacts,
        skipPlanning: true, // Directly execute tools for deterministic eval
        maxSteps,
        maxTimeMs: timeoutMs,
        onEvent: (event: AgentEvent) => {
          if (event.type === 'tool_result' && !event.success) {
            if (event.error?.includes('unique') || event.error?.includes('exact search-and-replace')) {
              detectedFailure = 'bad_edits';
              failureReason = `Failed exact string replacement: ${event.error}`;
            } else if (event.error?.includes('JSON schema') || event.error?.includes('Invalid tool arguments')) {
              detectedFailure = 'wrong_tool_use';
              failureReason = `Invalid tool arguments: ${event.error}`;
            }
          }
        },
      });

      for await (const event of loop) {
        if (event.type === 'tool_call') {
          steps++;
        } else if (event.type === 'model_message') {
          // Token estimate ~ 4 chars per token
          tokensUsed += Math.ceil(event.content.length / 4) + 120;
        } else if (event.type === 'task_retry') {
          if (event.attempt >= event.maxRetries) {
            detectedFailure = 'stuck_loops';
            failureReason = `Exhausted task retry limit (${event.maxRetries})`;
          }
        }
      }

      // Check context limit
      const contextLimit = this.options.modelConfig.contextWindowLimit ?? 32_768;
      if (tokensUsed >= contextLimit) {
        detectedFailure = 'context_overflow';
        failureReason = `Exceeded model context limit (${tokensUsed} >= ${contextLimit})`;
      }

      // Run automated pass/fail verification checks
      const checker = new TaskCheckRunner(sandbox, workspaceRoot);
      const checkResults: CheckResult[] = [];
      let allChecksPassed = true;

      for (const check of task.checks) {
        const checkRes = await checker.runCheck(check);
        checkResults.push(checkRes);
        if (!checkRes.passed) {
          allChecksPassed = false;
        }
      }

      const durationMs = Date.now() - taskStart;

      if (allChecksPassed) {
        return {
          taskId: task.id,
          title: task.title,
          category: task.category,
          passed: true,
          steps,
          tokensUsed,
          durationMs,
          failureCategory: 'none',
          checkResults,
        };
      } else {
        const primaryFailure: FailureCategory =
          detectedFailure !== 'none' ? detectedFailure : 'assertion_failed';
        const reason =
          failureReason ?? checkResults.find((c) => !c.passed)?.error ?? 'Check failed';

        return {
          taskId: task.id,
          title: task.title,
          category: task.category,
          passed: false,
          steps,
          tokensUsed,
          durationMs,
          failureCategory: primaryFailure,
          failureReason: reason,
          checkResults,
        };
      }
    } catch (err) {
      const durationMs = Date.now() - taskStart;
      const isTimeout = durationMs >= timeoutMs;
      const category: FailureCategory = isTimeout ? 'timeout' : 'wrong_tool_use';

      return {
        taskId: task.id,
        title: task.title,
        category: task.category,
        passed: false,
        steps,
        tokensUsed,
        durationMs,
        failureCategory: category,
        failureReason: err instanceof Error ? err.message : String(err),
        checkResults: [
          {
            check: 'Execution completed without crash',
            passed: false,
            error: err instanceof Error ? err.message : String(err),
          },
        ],
      };
    } finally {
      try {
        await fs.rm(workspaceRoot, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  }
}
