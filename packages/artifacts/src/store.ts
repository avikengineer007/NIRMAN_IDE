import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import type { AgentEvent, TasksData, TaskStatus, TaskItem } from './types.js';
import { formatEventLog } from './events.js';

export function generateRunId(): string {
  const dateStr = new Date()
    .toISOString()
    .replace(/[-:T.]/g, '')
    .slice(0, 14);
  const randomSuffix = crypto.randomBytes(3).toString('hex');
  return `run_${dateStr}_${randomSuffix}`;
}

export class ArtifactStore {
  readonly workspaceRoot: string;
  readonly runId: string;
  readonly runDir: string;
  readonly logPath: string;
  readonly tasksPath: string;
  readonly planPath: string;
  readonly specPath: string;
  readonly runDiffPath: string;
  readonly walkthroughPath: string;

  constructor(workspaceRoot: string, runId?: string) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.runId = runId ?? generateRunId();
    this.runDir = path.join(this.workspaceRoot, '.agent', 'runs', this.runId);
    this.logPath = path.join(this.runDir, 'log.txt');
    this.tasksPath = path.join(this.runDir, 'tasks.json');
    this.planPath = path.join(this.runDir, 'plan.md');
    this.specPath = path.join(this.workspaceRoot, 'SPEC.md');
    this.runDiffPath = path.join(this.runDir, 'diff.patch');
    this.walkthroughPath = path.join(this.runDir, 'walkthrough.md');
  }

  async init(task: string): Promise<void> {
    await fs.mkdir(this.runDir, { recursive: true });

    const initialTasks: TasksData = {
      runId: this.runId,
      task,
      status: 'planning',
      startedAt: new Date().toISOString(),
      stepsCount: 0,
      tasks: [],
    };

    await fs.writeFile(this.tasksPath, JSON.stringify(initialTasks, null, 2), 'utf-8');
    await fs.writeFile(
      this.logPath,
      `=== NIRMAN AGENT RUN LOG ===\nRun ID: ${this.runId}\nTask: ${task}\nStarted At: ${initialTasks.startedAt}\n============================\n\n`,
      'utf-8',
    );
  }

  async appendLog(line: string): Promise<void> {
    await fs.appendFile(this.logPath, `${line}\n`, 'utf-8');
  }

  async appendEvent(event: AgentEvent): Promise<void> {
    const formatted = formatEventLog(event);
    await this.appendLog(formatted);
  }

  async updateTasks(patch: Partial<TasksData>): Promise<void> {
    let current: TasksData;
    try {
      const raw = await fs.readFile(this.tasksPath, 'utf-8');
      current = JSON.parse(raw) as TasksData;
    } catch {
      current = {
        runId: this.runId,
        task: '',
        status: 'planning',
        startedAt: new Date().toISOString(),
        stepsCount: 0,
      };
    }

    const updated: TasksData = {
      ...current,
      ...patch,
    };

    await fs.writeFile(this.tasksPath, JSON.stringify(updated, null, 2), 'utf-8');
  }

  async updateTaskStatus(
    taskId: string,
    status: TaskStatus,
    patch?: Partial<TaskItem>,
  ): Promise<void> {
    const current = await this.readTasks();
    const tasks = (current.tasks ?? []).map((t) =>
      t.id === taskId ? { ...t, ...patch, status } : t,
    );
    await this.updateTasks({ tasks });
  }

  taskDiffPath(taskId: string): string {
    return path.join(this.runDir, 'tasks', taskId, 'diff.patch');
  }

  async writeTaskDiff(taskId: string, patch: string): Promise<string> {
    const filePath = this.taskDiffPath(taskId);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, patch, 'utf-8');
    return filePath;
  }

  async readTaskDiff(taskId: string): Promise<string> {
    return fs.readFile(this.taskDiffPath(taskId), 'utf-8');
  }

  async writeRunDiff(patch: string): Promise<string> {
    await fs.mkdir(this.runDir, { recursive: true });
    await fs.writeFile(this.runDiffPath, patch, 'utf-8');
    await this.updateTasks({ diffPath: this.runDiffPath });
    return this.runDiffPath;
  }

  async readRunDiff(): Promise<string> {
    return fs.readFile(this.runDiffPath, 'utf-8');
  }

  async writeWalkthrough(markdown: string): Promise<string> {
    await fs.mkdir(this.runDir, { recursive: true });
    await fs.writeFile(this.walkthroughPath, markdown, 'utf-8');
    await this.updateTasks({ walkthroughPath: this.walkthroughPath });
    return this.walkthroughPath;
  }

  async readWalkthrough(): Promise<string> {
    return fs.readFile(this.walkthroughPath, 'utf-8');
  }

  async writePlan(markdown: string): Promise<string> {
    await fs.mkdir(this.runDir, { recursive: true });
    await fs.writeFile(this.planPath, markdown, 'utf-8');
    return this.planPath;
  }

  async readPlan(): Promise<string> {
    return fs.readFile(this.planPath, 'utf-8');
  }

  async writeSpec(markdown: string): Promise<string> {
    await fs.writeFile(this.specPath, markdown, 'utf-8');
    return this.specPath;
  }

  async readSpec(): Promise<string> {
    return fs.readFile(this.specPath, 'utf-8');
  }

  async readLog(): Promise<string> {
    return fs.readFile(this.logPath, 'utf-8');
  }

  async readTasks(): Promise<TasksData> {
    const raw = await fs.readFile(this.tasksPath, 'utf-8');
    return JSON.parse(raw) as TasksData;
  }
}
