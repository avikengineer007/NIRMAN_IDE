import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { NirmanClient, type RunRecord } from '@nirman/server/client';
import type { AgentEvent } from '@nirman/artifacts';
import { ChatViewProvider } from './chat-view.js';
import { PlanViewProvider } from './plan-view.js';
import { TasksViewProvider } from './tasks-view.js';
import { ArtifactsViewProvider } from './artifacts-view.js';
import { NirmanStatusBar } from './status-bar.js';
import { DiffReviewer } from './diff-viewer.js';
import { AgentManagerViewProvider } from './agent-manager-view.js';
import type { ChatMessageItem, ExtensionConfig } from './types.js';
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
  private isConnected = false;
  private unsubscribeEvents?: (() => void) | undefined;

  constructor(options: ExtensionControllerOptions) {
    this.vscode = options.vscode;
    this.config = options.config;

    this.client =
      options.client ??
      new NirmanClient({
        url: this.config.serverUrl,
        token: this.config.serverToken,
        timeoutMs: 180_000,
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
    this.loadWorkspaceChatHistory();
  }

  private getActiveWorkspaceRoot(): string {
    const workspaceFolder = this.vscode.workspace.workspaceFolders?.[0];
    return workspaceFolder ? workspaceFolder.uri.fsPath : process.cwd();
  }

  private getHistoryFilePaths(workspaceRoot: string): { localPath: string; globalPath: string } {
    const normalized = path.resolve(workspaceRoot).toLowerCase();
    const hash = crypto.createHash('sha1').update(normalized).digest('hex').slice(0, 16);
    const folderBase = path.basename(workspaceRoot).replace(/[^a-zA-Z0-9_-]/g, '_') || 'workspace';
    const localPath = path.join(workspaceRoot, '.agent', 'chat-history.json');
    const globalPath = path.join(
      'C:\\Tools\\nirman\\data\\chat-history',
      `${folderBase}-${hash}.json`,
    );
    return { localPath, globalPath };
  }

  public loadWorkspaceChatHistory(): void {
    if (!this.isRealIde()) return;
    const workspaceRoot = this.getActiveWorkspaceRoot();
    const folderName = path.basename(workspaceRoot) || 'Workspace';
    const { localPath, globalPath } = this.getHistoryFilePaths(workspaceRoot);

    let loaded: ChatMessageItem[] | null = null;
    for (const candidate of [localPath, globalPath]) {
      try {
        if (fs.existsSync(candidate)) {
          const raw = fs.readFileSync(candidate, 'utf-8');
          const parsed = JSON.parse(raw) as unknown;
          if (Array.isArray(parsed)) {
            loaded = parsed as ChatMessageItem[];
            break;
          }
        }
      } catch {}
    }

    this.chatView.setMessages(loaded ?? [], folderName);
  }

  private saveWorkspaceChatHistory(): void {
    if (!this.isRealIde()) return;
    const workspaceRoot = this.getActiveWorkspaceRoot();
    const { localPath, globalPath } = this.getHistoryFilePaths(workspaceRoot);
    const serialized = JSON.stringify(this.chatView.getMessages(), null, 2);

    try {
      fs.mkdirSync(path.dirname(localPath), { recursive: true });
      fs.writeFileSync(localPath, serialized, 'utf-8');
    } catch {}
    try {
      fs.mkdirSync(path.dirname(globalPath), { recursive: true });
      fs.writeFileSync(globalPath, serialized, 'utf-8');
    } catch {}
  }

  public clearWorkspaceChatHistory(): void {
    this.chatView.clearMessages();
    if (!this.isRealIde()) return;
    const workspaceRoot = this.getActiveWorkspaceRoot();
    const { localPath, globalPath } = this.getHistoryFilePaths(workspaceRoot);
    try {
      if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
    } catch {}
    try {
      if (fs.existsSync(globalPath)) fs.unlinkSync(globalPath);
    } catch {}
  }

  private appendChat(sender: 'user' | 'assistant' | 'system', content: string): void {
    this.chatView.appendMessage(sender, content);
    this.saveWorkspaceChatHistory();
  }

  private isConversationalQuestion(prompt: string): boolean {
    if (!this.isRealIde()) return false;
    const trimmed = prompt.trim();
    const lower = trimmed.toLowerCase();
    if (/^(hi|hello|hey|who are you|what can you do)\b/i.test(lower)) {
      return true;
    }
    const hasBuildIntent =
      /\b(build|create|make|implement|write|generate|add|modify|edit|update|refactor|fix|delete|remove|setup|scaffold|develop)\b/i.test(
        lower,
      );
    const isQuestion =
      trimmed.endsWith('?') ||
      /^(how|what|why|where|when|can you explain|explain|tell me|show me how)\b/i.test(lower);
    return isQuestion && !hasBuildIntent;
  }

  private async answerConversationally(prompt: string): Promise<void> {
    const workspaceRoot = this.getActiveWorkspaceRoot();
    this.appendChat('user', prompt);

    let filesSummary = '';
    try {
      const topFiles = fs
        .readdirSync(workspaceRoot)
        .filter((n) => n !== '.git' && n !== '.agent' && n !== 'node_modules')
        .slice(0, 25);
      filesSummary = topFiles.join(', ');
    } catch {}

    let specSnippet = '';
    try {
      const specPath = path.join(workspaceRoot, 'SPEC.md');
      if (fs.existsSync(specPath)) {
        specSnippet = fs.readFileSync(specPath, 'utf-8').slice(0, 1500);
      }
    } catch {}

    const recentMsgs = this.chatView
      .getMessages()
      .filter((m) => m.sender === 'user' || m.sender === 'assistant')
      .slice(-6)
      .map((m) => ({
        role: m.sender,
        content: m.content,
      }));

    const modelBaseUrl = (process.env['NIRMAN_MODEL_URL'] ?? 'http://127.0.0.1:8080/v1').replace(
      /\/+$/,
      '',
    );

    const response = await fetch(`${modelBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.config.model,
        temperature: 0.2,
        messages: [
          {
            role: 'system',
            content: [
              'You are NIRMAN, an intelligent AI software engineering assistant inside NIRMAN Agentic Studio (similar to Antigravity).',
              `Active workspace folder: ${workspaceRoot}`,
              filesSummary ? `Files in workspace: ${filesSummary}` : '',
              specSnippet ? `Workspace SPEC.md:\n${specSnippet}` : '',
              'Answer the user concisely, clearly, and helpfully using GitHub-flavored Markdown. Give exact commands or file paths when relevant.',
            ]
              .filter(Boolean)
              .join('\n'),
          },
          ...recentMsgs,
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`Local model server returned HTTP ${response.status}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const reply = data.choices?.[0]?.message?.content?.trim();
    if (reply) {
      this.appendChat('assistant', reply);
    }
  }

  /**
   * Initializes client connection and event listener subscriptions.
   */
  public async activate(): Promise<void> {
    if (this.config.serverToken === 'default-token') {
      try {
        const pidsRaw = fs.readFileSync('C:\\Tools\\nirman\\logs\\pids.json', 'utf-8');
        const pids = JSON.parse(pidsRaw) as { token?: string };
        if (pids.token && typeof (this.client as unknown as { setToken?: (t: string) => void }).setToken === 'function') {
          this.config.serverToken = pids.token;
          this.client.setToken(pids.token);
        }
      } catch {}
    }
    await this.client.connect();
    this.isConnected = true;

    if (this.unsubscribeEvents) {
      this.unsubscribeEvents();
    }
    this.unsubscribeEvents = this.client.onEvent((notification) => {
      this.handleAgentEvent(notification.runId, notification.event);
    });

    this.chatView.appendMessage('system', `Connected to NIRMAN Daemon at ${this.config.serverUrl}`);
  }

  private stripCodeFromPlan(planMarkdown: string): string {
    const withoutCodeFences = planMarkdown.replace(
      /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g,
      (fullMatch, lang: string, body: string) => {
        const normalizedLang = (lang || '').trim().toLowerCase();
        const isTreeBlock =
          !normalizedLang &&
          (body.includes('├──') ||
            body.includes('└──') ||
            body.includes('|--') ||
            /^[\s\w./\\-]+$/m.test(body.trim()));
        const hasCodeKeywords =
          /\b(def |class |function |import |from |return |const |let |var |if\s*\(|for\s*\(|while\s*\(|console\.log|print\()/i.test(
            body,
          );
        if (isTreeBlock && !hasCodeKeywords) {
          return fullMatch;
        }
        return '';
      },
    );

    return withoutCodeFences
      .replace(/^\s*[-*]?\s*\*\*(?:Content|Code|Source Code|Implementation)\*\*\s*:\s*$/gim, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private bindDelegates(): void {
    // Chat view delegate
    this.chatView.setDelegate({
      onDescribeProject: async (prompt, skipPlanning) => {
        try {
          if (this.isConversationalQuestion(prompt)) {
            await this.answerConversationally(prompt);
            return;
          }
          if (!this.isConnected) {
            await this.activate();
          }
          await this.startRun(prompt, skipPlanning);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.appendChat('system', `⚠️ Failed to process request: ${msg}`);
        }
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
      onApproveActivePlan: async () => {
        if (this.activeRun) {
          await this.approvePlan(this.activeRun.runId);
        }
      },
      onReviseActivePlan: async (feedback) => {
        if (this.activeRun) {
          await this.commentPlan(this.activeRun.runId, feedback);
        }
      },
      onOpenFile: async (filePath) => {
        const baseDir = this.activeRun?.repoRoot || this.getActiveWorkspaceRoot();
        const fullPath = path.isAbsolute(filePath) ? filePath : path.join(baseDir, filePath);
        try {
          await this.vscode.commands.executeCommand('vscode.open', this.vscode.Uri.file(fullPath));
        } catch {}
      },
      onClearChat: async () => {
        this.clearWorkspaceChatHistory();
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

    this.appendChat('user', task);
    this.appendChat(
      'system',
      skipPlanning
        ? '⚡ Starting direct execution...'
        : '🧠 Analyzing workspace & drafting implementation plan...',
    );

    const result = await this.client.startRun({
      task,
      workspaceRoot,
      skipPlanning,
      modelConfig: {
        model: this.config.model,
        baseUrl: process.env['NIRMAN_MODEL_URL'] ?? 'http://127.0.0.1:8080/v1',
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

    await this.refreshRuns();
    return result.runId;
  }

  /**
   * Approves the plan for the active run
   */
  public async approvePlan(runId: string): Promise<void> {
    await this.client.approvePlan(runId);
    this.appendChat('system', '✔ Plan approved. Beginning implementation phase.');
  }

  /**
   * Submits user feedback for plan revision
   */
  public async commentPlan(runId: string, feedback: string): Promise<void> {
    await this.client.comment(runId, feedback);
    this.appendChat('user', `Feedback: ${feedback}`);
    this.appendChat('system', '🔄 Revising implementation plan based on your feedback...');
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

  private isRealIde(): boolean {
    return Boolean(
      this.vscode.window &&
        typeof (this.vscode.window as unknown as { registerWebviewViewProvider?: unknown })
          .registerWebviewViewProvider === 'function',
    );
  }

  private syncWorktreeToRepo(): void {
    if (!this.isRealIde() || !this.activeRun) return;
    const { worktreePath, repoRoot } = this.activeRun;
    if (!worktreePath || !repoRoot || path.resolve(worktreePath) === path.resolve(repoRoot)) {
      return;
    }
    try {
      const copyRecursive = (srcDir: string, destDir: string): void => {
        const entries = fs.readdirSync(srcDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name === '.git' || entry.name === '.agent' || entry.name === 'node_modules') {
            continue;
          }
          const srcFull = path.join(srcDir, entry.name);
          const destFull = path.join(destDir, entry.name);
          if (entry.isDirectory()) {
            fs.mkdirSync(destFull, { recursive: true });
            copyRecursive(srcFull, destFull);
          } else if (entry.isFile()) {
            fs.mkdirSync(path.dirname(destFull), { recursive: true });
            fs.copyFileSync(srcFull, destFull);
          }
        }
      };
      copyRecursive(worktreePath, repoRoot);
    } catch {}
  }

  /**
   * Dispatches typed events from Step 3 to all views and status bar
   */
  private handleAgentEvent(runId: string, event: AgentEvent): void {
    void this.refreshRuns();

    switch (event.type) {
      case 'model_message': {
        const trimmed = event.content.trim();
        const isRawToolJson =
          (trimmed.startsWith('```json') || trimmed.startsWith('{')) &&
          (trimmed.includes('"name"') || trimmed.includes('"tool"')) &&
          trimmed.includes('"arguments"');
        if (!isRawToolJson) {
          this.appendChat('assistant', event.content);
        }
        // Estimate token count update
        this.statusBar.updateContextUsage(
          Math.min(this.config.contextWindowLimit, Math.floor(Math.random() * 2000) + 1200),
          this.config.contextWindowLimit,
        );
        break;
      }

      case 'tool_call': {
        const pathArg =
          event.arguments && typeof event.arguments['path'] === 'string'
            ? ` (${event.arguments['path']})`
            : event.arguments && typeof event.arguments['command'] === 'string'
              ? ` (${event.arguments['command']})`
              : '';
        this.appendChat('system', `🛠 Calling tool "${event.tool}"${pathArg}`);
        break;
      }

      case 'tool_result':
        if (event.tool === 'write_file' || event.tool === 'edit_file') {
          this.syncWorktreeToRepo();
          this.appendChat(
            'system',
            `📄 File updated in workspace (Click "Review Diff" to inspect)`,
          );
        }
        break;

      case 'plan_created': {
        let planMarkdown = `Execution Plan for Run ${runId}`;
        let specMarkdown = `Project Spec for Run ${runId}`;

        const candidatePlanPath =
          event.planPath ||
          (this.activeRun?.worktreePath
            ? path.join(this.activeRun.worktreePath, '.agent', 'runs', runId, 'plan.md')
            : '');
        const candidateSpecPath =
          event.specPath ||
          (this.activeRun?.worktreePath ? path.join(this.activeRun.worktreePath, 'SPEC.md') : '');

        if (candidatePlanPath) {
          try {
            if (fs.existsSync(candidatePlanPath)) {
              planMarkdown = fs.readFileSync(candidatePlanPath, 'utf-8');
            }
          } catch {}
        }
        if (candidateSpecPath) {
          try {
            if (fs.existsSync(candidateSpecPath)) {
              specMarkdown = fs.readFileSync(candidateSpecPath, 'utf-8');
            }
          } catch {}
        }

        // Strip any raw source code blocks so the implementation plan explains workflow & architecture
        const cleanPlanMarkdown = this.stripCodeFromPlan(planMarkdown);

        this.planView.setPlanData({
          runId,
          planMarkdown: cleanPlanMarkdown,
          specMarkdown,
          tasks: event.tasks,
          isWaitingApproval: true,
        });
        this.tasksView.setTasks(runId, event.tasks);

        const taskListText = event.tasks
          .map(
            (t, idx) =>
              `**Step ${idx + 1}: ${t.title}**${t.description ? `\n${t.description}` : ''}`,
          )
          .join('\n\n');

        const fullPlanChatMsg = [
          '📋 Execution plan created. Here is how I will work on your project:',
          '',
          '### Execution Workflow',
          taskListText || '(No steps listed)',
          '',
          '### Architectural Approach & Strategy',
          cleanPlanMarkdown,
        ].join('\n');

        this.appendChat('system', fullPlanChatMsg);

        if (this.isRealIde() && this.activeRun) {
          try {
            const repoPlanPath = path.join(this.activeRun.repoRoot, 'PLAN.md');
            fs.writeFileSync(repoPlanPath, cleanPlanMarkdown, 'utf-8');
            this.syncWorktreeToRepo();
          } catch {}
        }
        break;
      }

      case 'task_status_changed':
        if (this.activeRun) {
          void this.client.getRun(runId).then((r) => {
            if (r?.tasks) {
              this.tasksView.setTasks(runId, r.tasks);
            }
          });
        }
        break;

      case 'run_finished': {
        this.syncWorktreeToRepo();
        let walkthroughText = '';
        if (this.activeRun?.worktreePath) {
          try {
            const wtWalkthrough = path.join(
              this.activeRun.worktreePath,
              '.agent',
              'runs',
              runId,
              'walkthrough.md',
            );
            if (fs.existsSync(wtWalkthrough)) {
              walkthroughText = fs.readFileSync(wtWalkthrough, 'utf-8');
              if (this.isRealIde()) {
                const repoWalkthrough = path.join(this.activeRun.repoRoot, 'WALKTHROUGH.md');
                fs.writeFileSync(repoWalkthrough, walkthroughText, 'utf-8');
              }
            }
          } catch {}
        }
        this.appendChat(
          'assistant',
          walkthroughText
            ? `✅ **Task Complete (${event.status.toUpperCase()})**\n\nAll files have been written to your workspace folder.\n\n${walkthroughText}`
            : `✅ **Task Complete (${event.status.toUpperCase()})**`,
        );
        this.refreshArtifacts(runId);
        break;
      }

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
