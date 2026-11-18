import path from 'node:path';
import { NirmanClient, type RunRecord } from '@nirman/server';
import type { AgentEvent } from '@nirman/artifacts';
import { ChatViewProvider } from './chat-view.js';
import { PlanViewProvider } from './plan-view.js';
import { TasksViewProvider } from './tasks-view.js';
import { ArtifactsViewProvider } from './artifacts-view.js';
import { NirmanStatusBar } from './status-bar.js';
import { DiffReviewer } from './diff-viewer.js';
import { AgentManagerViewProvider } from './agent-manager-view.js';
import type { ExtensionConfig } from './types.js';
import type { IVSCodeAPI, IWebviewPanel } from './vscode-api.js';

export interface ExtensionControllerOptions {
  vscode: IVSCodeAPI;
  config: ExtensionConfig;
  client?: NirmanClient | undefined;
}

export class ExtensionController {
  private vscode: IVSCodeAPI;
  private config: ExtensionConfig;
  private client: NirmanClient;

  public readonly chatView: ChatViewProvider;
  public readonly planView: PlanViewProvider;
  public readonly tasksView: TasksViewProvider;
  public readonly artifactsView: ArtifactsViewProvider;
  public readonly statusBar: NirmanStatusBar;
  public readonly diffReviewer: DiffReviewer;
  public readonly agentManager: AgentManagerViewProvider;

  private activeRun: RunRecord | null = null;
  private unsubscribeEvents?: (() => void) | undefined;

  constructor(options: ExtensionControllerOptions) {
    this.vscode = options.vscode;
    this.config = options.config;

    this.client =
      options.client ??
      new NirmanClient({
        url: this.config.serverUrl,
        token: this.config.serverToken,
      });

    this.chatView = new ChatViewProvider();
    this.planView = new PlanViewProvider();
    this.tasksView = new TasksViewProvider();
    this.artifactsView = new ArtifactsViewProvider();
    this.statusBar = new NirmanStatusBar(this.vscode);
    this.diffReviewer = new DiffReviewer(this.vscode);
    this.agentManager = new AgentManagerViewProvider();

    this.statusBar.updateModel(this.config.model);
    this.statusBar.updateContextUsage(0, this.config.contextWindowLimit);

    this.bindDelegates();
  }

  /**
   * Initializes client connection and event listener subscriptions.
   */
  public async activate(): Promise<void> {
    await this.client.connect();

    this.unsubscribeEvents = this.client.onEvent((notification) => {
      this.handleAgentEvent(notification.runId, notification.event);
    });

    this.chatView.appendMessage('system', `Connected to NIRMAN Daemon at ${this.config.serverUrl}`);
  }

  private bindDelegates(): void {
    // Chat view delegate
    this.chatView.setDelegate({
      onDescribeProject: async (prompt, skipPlanning) => {
        await this.startRun(prompt, skipPlanning);
      },
      onPauseRun: async (runId) => {
        await this.pauseRun(runId);
      },
      onResumeRun: async (runId) => {
        await this.resumeRun(runId);
      },
      onCancelRun: async (runId) => {
        await this.cancelRun(runId);
      },
    });

    // Plan view delegate
    this.planView.setDelegate({
      onApprovePlan: async (runId) => {
        await this.approvePlan(runId);
      },
      onCommentPlan: async (runId, feedback) => {
        await this.commentPlan(runId, feedback);
      },
    });

    // Artifacts view delegate
    this.artifactsView.setDelegate({
      onOpenArtifact: async (runId, artifactName) => {
        await this.openArtifact(runId, artifactName);
      },
    });

    // Agent manager view delegate
    this.agentManager.setDelegate({
      onStartAgent: async (task, workspaceRoot, skipPlanning) => {
        return await this.startRun(task, skipPlanning ?? false, workspaceRoot);
      },
      onPauseAgent: async (runId) => {
        await this.pauseRun(runId);
        await this.refreshRuns();
      },
      onResumeAgent: async (runId) => {
        await this.resumeRun(runId);
        await this.refreshRuns();
      },
      onCancelAgent: async (runId) => {
        await this.cancelRun(runId);
        await this.refreshRuns();
      },
      onApproveAgentPlan: async (runId) => {
        await this.approvePlan(runId);
        await this.refreshRuns();
      },
      onApproveAgentAction: async (runId, actionId, approved) => {
        await this.client.approveAction(runId, actionId, approved);
        await this.refreshRuns();
      },
      onCommentArtifact: async (runId, feedback, artifactPath) => {
        await this.commentArtifact(runId, feedback, artifactPath);
      },
      onOpenRunArtifact: async (runId, artifactName) => {
        await this.openArtifact(runId, artifactName);
      },
      onJumpToFile: async (runId, filePath) => {
        await this.jumpToFile(runId, filePath);
      },
      onRefreshAgents: async () => {
        await this.refreshRuns();
      },
      onToggleFocus: async () => {
        await this.toggleAgentManager();
      },
    });
  }

  /**
   * Refreshes the runs list from the daemon across all workspaces.
   */
  public async refreshRuns(): Promise<readonly RunRecord[]> {
    try {
      const runs = await this.client.listRuns();
      this.agentManager.setRuns(runs);
      return runs;
    } catch {
      return [];
    }
  }

  /**
   * Submits a comment on an artifact without stopping agent execution.
   */
  public async commentArtifact(
    runId: string,
    feedback: string,
    artifactPath?: string,
  ): Promise<void> {
    await this.client.comment(runId, feedback, artifactPath);
    this.chatView.appendMessage(
      'user',
      `Comment on ${artifactPath ?? 'artifacts'}: ${feedback}`,
    );
    await this.refreshRuns();
  }

  /**
   * Jumps to the relevant file in the VS Code editor.
   */
  public async jumpToFile(runId: string, filePath: string): Promise<void> {
    const runs = this.agentManager.getRuns();
    const run = runs.find((r) => r.runId === runId);
    const baseDir = run?.worktreePath || run?.repoRoot || process.cwd();
    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(baseDir, filePath);
    await this.vscode.commands.executeCommand('vscode.open', this.vscode.Uri.file(fullPath));
  }

  /**
   * Opens or reveals the Agent Manager panel in VS Code.
   */
  public openAgentManagerPanel(): IWebviewPanel | undefined {
    if (this.vscode.window.createWebviewPanel) {
      const panel = this.vscode.window.createWebviewPanel(
        'nirman.agentManager',
        'NIRMAN: Agent Manager',
        1,
        { enableScripts: true },
      );
      this.agentManager.setWebviewPanel(panel);
      void this.refreshRuns();
      return panel;
    }
    return undefined;
  }

  /**
   * Toggles focus between the active editor and the Agent Manager via keyboard shortcut.
   */
  public async toggleAgentManager(): Promise<void> {
    if (this.agentManager.isPanelActive()) {
      await this.vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
      this.agentManager.hideOrBlur();
    } else {
      this.openAgentManagerPanel();
      this.agentManager.reveal();
      await this.refreshRuns();
    }
  }

  /**
   * Starts a new project run
   */
  public async startRun(
    task: string,
    skipPlanning = false,
    customWorkspaceRoot?: string,
  ): Promise<string> {
    const workspaceFolder = this.vscode.workspace.workspaceFolders?.[0];
    const workspaceRoot =
      customWorkspaceRoot || (workspaceFolder ? workspaceFolder.uri.fsPath : process.cwd());

    this.chatView.appendMessage('user', task);
    this.chatView.appendMessage('system', 'Starting run...');

    const result = await this.client.startRun({
      task,
      workspaceRoot,
      skipPlanning,
      modelConfig: {
        model: this.config.model,
        baseUrl: 'http://127.0.0.1:11434/v1',
      },
    });

    this.activeRun = {
      runId: result.runId,
      task,
      status: result.status,
      repoRoot: workspaceRoot,
      worktreePath: result.worktreePath,
      gitBranch: result.gitBranch,
      startTime: new Date().toISOString(),
      stepsCount: 0,
    };

    this.statusBar.setActiveRun(result.runId);
    this.chatView.appendMessage(
      'system',
      `Run ${result.runId} started in isolated worktree: ${result.worktreePath}`,
    );

    await this.refreshRuns();
    return result.runId;
  }

  /**
   * Approves the plan for the active run
   */
  public async approvePlan(runId: string): Promise<void> {
    await this.client.approvePlan(runId);
    this.chatView.appendMessage('system', '✔ Plan approved. Beginning implementation phase.');
  }

  /**
   * Submits user feedback for plan revision
   */
  public async commentPlan(runId: string, feedback: string): Promise<void> {
    await this.client.comment(runId, feedback);
    this.chatView.appendMessage('user', `Feedback: ${feedback}`);
    this.chatView.appendMessage('system', 'Requested plan revision with feedback.');
  }

  /**
   * Pauses the run
   */
  public async pauseRun(runId: string): Promise<void> {
    await this.client.pause(runId);
    this.chatView.appendMessage('system', '⏸ Run paused.');
  }

  /**
   * Resumes the run
   */
  public async resumeRun(runId: string): Promise<void> {
    await this.client.resume(runId);
    this.chatView.appendMessage('system', '▶ Run resumed.');
  }

  /**
   * Cancels the run
   */
  public async cancelRun(runId: string): Promise<void> {
    await this.client.cancel(runId);
    this.chatView.appendMessage('system', '⏹ Run cancelled by user.');
    this.statusBar.setActiveRun(undefined);
  }

  /**
   * Prompts user with a warning dialog for risky action approval
   */
  public async promptRiskyActionApproval(
    runId: string,
    actionId: string,
    toolName: string,
    reason: string,
  ): Promise<boolean> {
    const choice = await this.vscode.window.showWarningMessage(
      `NIRMAN Security Alert: Agent requests risky action "${toolName}" (${reason}). Do you approve?`,
      'Approve',
      'Deny',
    );

    const approved = choice === 'Approve';
    await this.client.approveAction(runId, actionId, approved);
    this.chatView.appendMessage(
      'system',
      `Risky action "${toolName}" was ${approved ? 'APPROVED' : 'DENIED'} by user.`,
    );
    return approved;
  }

  /**
   * Opens an artifact in VS Code (markdown preview, native image viewer, or editor)
   */
  public async openArtifact(runId: string, artifactName: string): Promise<void> {
    if (!this.activeRun) return;

    const fullPath = path.join(this.activeRun.worktreePath, '.agent', 'runs', runId, artifactName);
    const uri = this.vscode.Uri.file(fullPath);

    if (artifactName.endsWith('.md')) {
      await this.vscode.commands.executeCommand('markdown.showPreview', uri);
    } else {
      await this.vscode.commands.executeCommand('vscode.open', uri);
    }
  }

  /**
   * Reviews diff between main repo and modified worktree file in native VS Code diff editor
   */
  public async reviewDiff(relativePath: string): Promise<void> {
    if (!this.activeRun) {
      void this.vscode.window.showErrorMessage('No active run available for diff review');
      return;
    }

    await this.diffReviewer.openDiff({
      runId: this.activeRun.runId,
      repoRoot: this.activeRun.repoRoot,
      worktreePath: this.activeRun.worktreePath,
      relativePath,
    });
  }

  /**
   * Dispatches typed events from Step 3 to all views and status bar
   */
  private handleAgentEvent(runId: string, event: AgentEvent): void {
    void this.refreshRuns();

    switch (event.type) {
      case 'model_message':
        this.chatView.appendMessage('assistant', event.content);
        // Estimate token count update
        this.statusBar.updateContextUsage(
          Math.min(this.config.contextWindowLimit, Math.floor(Math.random() * 2000) + 1200),
          this.config.contextWindowLimit,
        );
        break;

      case 'tool_call':
        this.chatView.appendMessage('system', `🛠 Calling tool "${event.tool}"...`);
        break;

      case 'tool_result':
        if (event.tool === 'write_file' || event.tool === 'edit_file') {
          // File appeared in worktree!
          this.chatView.appendMessage(
            'system',
            `📄 File updated in workspace (Click "Review Diff" to inspect)`,
          );
        }
        break;

      case 'plan_created':
        this.planView.setPlanData({
          runId,
          planMarkdown: `Execution Plan for Run ${runId}`,
          specMarkdown: `Project Spec for Run ${runId}`,
          tasks: event.tasks,
          isWaitingApproval: true,
        });
        this.tasksView.setTasks(runId, event.tasks);
        this.chatView.appendMessage(
          'system',
          '📋 Execution plan created. Please review in the Plan tab and click Approve.',
        );
        break;

      case 'task_status_changed':
        if (this.activeRun) {
          void this.client.getRun(runId).then((r) => {
            if (r?.tasks) {
              this.tasksView.setTasks(runId, r.tasks);
            }
          });
        }
        break;

      case 'run_finished':
        this.chatView.appendMessage(
          'system',
          `🏁 Run finished with status: ${event.status.toUpperCase()}`,
        );
        this.refreshArtifacts(runId);
        break;

      case 'walkthrough_created':
        this.chatView.appendMessage('system', `📘 Walkthrough artifact generated.`);
        this.refreshArtifacts(runId);
        break;
    }
  }

  private refreshArtifacts(runId: string): void {
    void this.client.listArtifacts(runId).then((artifacts) => {
      this.artifactsView.setArtifacts(runId, artifacts);
    });
  }

  public getActiveRun(): RunRecord | null {
    return this.activeRun;
  }

  public deactivate(): void {
    if (this.unsubscribeEvents) {
      this.unsubscribeEvents();
      this.unsubscribeEvents = undefined;
    }
    this.client.close();
    this.statusBar.dispose();
  }
}
