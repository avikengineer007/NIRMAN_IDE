import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ArtifactStore, type AgentEvent } from '@nirman/artifacts';
import { OpenAICompatibleClient, type ModelClient } from '@nirman/model';
import { RunController } from './run-controller.js';
import { WorktreeManager } from './worktree-manager.js';
import type {
  ArtifactFileInfo,
  RunRecord,
  StartRunParams,
  StartRunResult,
  AgentEventNotificationParams,
} from './types.js';

export type EventBroadcaster = (notification: AgentEventNotificationParams) => void;

export interface RunManagerOptions {
  worktreeManager?: WorktreeManager | undefined;
  modelClientFactory?: ((config?: StartRunParams['modelConfig']) => ModelClient) | undefined;
  baseWorktreesDir?: string | undefined;
}

export class RunManager {
  private runs = new Map<string, RunController>();
  private worktreeManager: WorktreeManager;
  private modelClientFactory: (config?: StartRunParams['modelConfig']) => ModelClient;
  private broadcasters = new Set<EventBroadcaster>();

  constructor(options?: RunManagerOptions) {
    this.worktreeManager =
      options?.worktreeManager ?? new WorktreeManager(options?.baseWorktreesDir);

    this.modelClientFactory =
      options?.modelClientFactory ??
      ((config) =>
        new OpenAICompatibleClient({
          model: config?.model ?? 'qwen2.5-coder:7b',
          baseUrl: config?.baseUrl ?? 'http://127.0.0.1:11434/v1',
          temperature: config?.temperature ?? 0.2,
        }));
  }

  public subscribeEvents(broadcaster: EventBroadcaster): () => void {
    this.broadcasters.add(broadcaster);
    return () => {
      this.broadcasters.delete(broadcaster);
    };
  }

  private broadcastEvent(runId: string, event: AgentEvent): void {
    const payload: AgentEventNotificationParams = { runId, event };
    for (const broadcaster of this.broadcasters) {
      try {
        broadcaster(payload);
      } catch {
        // ignore broadcaster errors
      }
    }
  }

  /**
   * Starts a new run in an isolated git worktree and sandbox.
   */
  public async startRun(params: StartRunParams): Promise<StartRunResult> {
    const runId = params.runId ?? `run-${Date.now()}-${crypto.randomUUID().slice(0, 5)}`;

    // Allocate an isolated worktree for this run
    const allocation = await this.worktreeManager.createWorktree(params.workspaceRoot, runId);
    const artifacts = new ArtifactStore(allocation.worktreePath, runId);

    const modelClient = this.modelClientFactory(params.modelConfig);

    const controller = new RunController({
      runId,
      task: params.task,
      repoRoot: params.workspaceRoot,
      worktreePath: allocation.worktreePath,
      gitBranch: allocation.gitBranch,
      modelClient,
      artifacts,
      skipPlanning: params.skipPlanning,
      autoApprove: params.autoApprove,
      maxSteps: params.maxSteps,
      maxTimeMs: params.maxTimeMs,
      onEvent: (event) => {
        this.broadcastEvent(runId, event);
      },
    });

    this.runs.set(runId, controller);
    controller.start();

    return {
      runId,
      status: controller.getStatus(),
      worktreePath: allocation.worktreePath,
      gitBranch: allocation.gitBranch,
    };
  }

  public listRuns(): RunRecord[] {
    return Array.from(this.runs.values()).map((c) => c.getRecord());
  }

  public getRun(runId: string): RunRecord | null {
    const controller = this.runs.get(runId);
    return controller ? controller.getRecord() : null;
  }

  public getController(runId: string): RunController | undefined {
    return this.runs.get(runId);
  }

  public approvePlan(runId: string): boolean {
    const controller = this.runs.get(runId);
    if (!controller) {
      throw new Error(`Run ${runId} not found`);
    }
    return controller.approvePlan();
  }

  public comment(runId: string, feedback: string, artifactPath?: string): boolean {
    const controller = this.runs.get(runId);
    if (!controller) {
      throw new Error(`Run ${runId} not found`);
    }
    return controller.comment(feedback, artifactPath);
  }

  public pause(runId: string): boolean {
    const controller = this.runs.get(runId);
    if (!controller) {
      throw new Error(`Run ${runId} not found`);
    }
    return controller.pause();
  }

  public resume(runId: string): boolean {
    const controller = this.runs.get(runId);
    if (!controller) {
      throw new Error(`Run ${runId} not found`);
    }
    return controller.resume();
  }

  public cancel(runId: string): boolean {
    const controller = this.runs.get(runId);
    if (!controller) {
      throw new Error(`Run ${runId} not found`);
    }
    return controller.cancel();
  }

  public approveAction(
    runId: string,
    actionId: string | undefined,
    approved: boolean,
  ): boolean {
    const controller = this.runs.get(runId);
    if (!controller) {
      throw new Error(`Run ${runId} not found`);
    }
    return controller.approveAction(approved);
  }

  /**
   * Lists all artifacts in .agent/runs/<runId>/
   */
  public async listArtifacts(runId: string): Promise<ArtifactFileInfo[]> {
    const controller = this.runs.get(runId);
    if (!controller) {
      throw new Error(`Run ${runId} not found`);
    }

    const runArtifactsDir = path.join(controller.worktreePath, '.agent', 'runs', runId);
    try {
      await fs.stat(runArtifactsDir);
    } catch {
      return [];
    }

    const files: ArtifactFileInfo[] = [];
    const walk = async (currentDir: string): Promise<void> => {
      const entries = await fs.readdir(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.isFile()) {
          const stat = await fs.stat(fullPath);
          const relativePath = path.relative(runArtifactsDir, fullPath).replace(/\\/g, '/');
          files.push({
            name: entry.name,
            relativePath,
            sizeBytes: stat.size,
            modifiedTime: stat.mtime.toISOString(),
          });
        }
      }
    };

    await walk(runArtifactsDir);
    return files;
  }

  /**
   * Reads content of an artifact file in .agent/runs/<runId>/
   */
  public async readArtifact(runId: string, artifactName: string): Promise<string> {
    const controller = this.runs.get(runId);
    if (!controller) {
      throw new Error(`Run ${runId} not found`);
    }

    const runArtifactsDir = path.resolve(controller.worktreePath, '.agent', 'runs', runId);
    const targetPath = path.resolve(runArtifactsDir, artifactName);

    // Prevent directory traversal attacks
    if (!targetPath.startsWith(runArtifactsDir)) {
      throw new Error(`Artifact path escape attempt: ${artifactName}`);
    }

    return await fs.readFile(targetPath, 'utf-8');
  }

  /**
   * Cleanup resources for all completed runs or server shutdown
   */
  public async cleanup(): Promise<void> {
    for (const controller of this.runs.values()) {
      controller.cancel();
      await this.worktreeManager.removeWorktree(
        controller.repoRoot,
        controller.worktreePath,
        controller.gitBranch,
      );
    }
    this.runs.clear();
  }
}
