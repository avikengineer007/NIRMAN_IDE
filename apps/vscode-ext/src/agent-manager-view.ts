import type { ArtifactFileInfo, RunRecord } from '@nirman/server';
import type { WebviewToExtensionMessage } from './types.js';
import type { IWebview, IWebviewPanel, IWebviewView } from './vscode-api.js';

export interface AgentManagerDelegate {
  onStartAgent(task: string, workspaceRoot?: string, skipPlanning?: boolean): Promise<string>;
  onPauseAgent(runId: string): Promise<void>;
  onResumeAgent(runId: string): Promise<void>;
  onCancelAgent(runId: string): Promise<void>;
  onApproveAgentPlan(runId: string): Promise<void>;
  onApproveAgentAction(runId: string, actionId: string | undefined, approved: boolean): Promise<void>;
  onCommentArtifact(runId: string, feedback: string, artifactPath?: string): Promise<void>;
  onOpenRunArtifact(runId: string, artifactName: string): Promise<void>;
  onJumpToFile(runId: string, filePath: string): Promise<void>;
  onRefreshAgents(): Promise<void>;
  onToggleFocus(): Promise<void>;
}

export class AgentManagerViewProvider {
  private view?: IWebviewView | undefined;
  private panel?: IWebviewPanel | undefined;
  private delegate?: AgentManagerDelegate | undefined;
  private runs: readonly RunRecord[] = [];
  private runArtifacts = new Map<string, readonly ArtifactFileInfo[]>();
  private activePanel = false;

  public setDelegate(delegate: AgentManagerDelegate): void {
    this.delegate = delegate;
  }

  /**
   * Binds to a sidebar WebviewView (nirman.agentManagerView)
   */
  public resolveWebviewView(webviewView: IWebviewView): void {
    this.view = webviewView;
    this.setupWebview(webviewView.webview);
  }

  /**
   * Binds or updates a dedicated full-tab WebviewPanel (nirman.agentManagerPanel)
   */
  public setWebviewPanel(panel: IWebviewPanel): void {
    this.panel = panel;
    this.activePanel = true;
    panel.onDidDispose(() => {
      this.activePanel = false;
      this.panel = undefined;
    });
    this.setupWebview(panel.webview);
  }

  public isPanelActive(): boolean {
    return Boolean(this.activePanel && this.panel?.visible);
  }

  public reveal(): void {
    if (this.panel) {
      this.panel.reveal();
      this.activePanel = true;
    } else if (this.view && this.view.show) {
      this.view.show(true);
    }
  }

  public hideOrBlur(): void {
    this.activePanel = false;
  }

  private setupWebview(webview: IWebview): void {
    webview.html = this.getHtml();

    webview.onDidReceiveMessage((msg: WebviewToExtensionMessage) => {
      if (!this.delegate) return;

      void (async () => {
        switch (msg.type) {
          case 'start_agent':
            await this.delegate!.onStartAgent(msg.task, msg.workspaceRoot, msg.skipPlanning);
            break;
          case 'pause_agent':
            await this.delegate!.onPauseAgent(msg.runId);
            break;
          case 'resume_agent':
            await this.delegate!.onResumeAgent(msg.runId);
            break;
          case 'cancel_agent':
            await this.delegate!.onCancelAgent(msg.runId);
            break;
          case 'approve_agent_plan':
            await this.delegate!.onApproveAgentPlan(msg.runId);
            break;
          case 'approve_agent_action':
            await this.delegate!.onApproveAgentAction(msg.runId, msg.actionId, msg.approved);
            break;
          case 'comment_artifact':
            await this.delegate!.onCommentArtifact(msg.runId, msg.feedback, msg.artifactPath);
            break;
          case 'open_run_artifact':
            await this.delegate!.onOpenRunArtifact(msg.runId, msg.artifactName);
            break;
          case 'jump_to_file':
            await this.delegate!.onJumpToFile(msg.runId, msg.filePath);
            break;
          case 'refresh_agents':
            await this.delegate!.onRefreshAgents();
            break;
          case 'toggle_manager_focus':
            await this.delegate!.onToggleFocus();
            break;
        }
      })();
    });

    this.postRunsUpdate();
  }

  public setRuns(runs: readonly RunRecord[]): void {
    this.runs = runs;
    this.postRunsUpdate();
    this.refreshHtmlIfActive();
  }

  public getRuns(): readonly RunRecord[] {
    return this.runs;
  }

  public setRunArtifacts(runId: string, artifacts: readonly ArtifactFileInfo[]): void {
    this.runArtifacts.set(runId, artifacts);
    const webview = this.getActiveWebview();
    if (webview) {
      void webview.postMessage({
        type: 'artifacts_list',
        runId,
        artifacts,
      });
    }
  }

  private getActiveWebview(): IWebview | undefined {
    return this.panel?.webview ?? this.view?.webview;
  }

  private postRunsUpdate(): void {
    const webview = this.getActiveWebview();
    if (webview) {
      void webview.postMessage({
        type: 'runs_updated',
        runs: this.runs,
      });
    }
  }

  private refreshHtmlIfActive(): void {
    if (this.panel) {
      this.panel.webview.html = this.getHtml();
    }
    if (this.view) {
      this.view.webview.html = this.getHtml();
    }
  }

  public getHtml(): string {
    const runningCount = this.runs.filter(
      (r) => r.status === 'running' || r.status === 'planning',
    ).length;
    const pendingApprovalCount = this.runs.filter(
      (r) => r.status === 'waiting_approval' || Boolean(r.pendingApproval),
    ).length;

    const runsHtml =
      this.runs.length === 0
        ? `<div class="empty-state">No active or completed agent runs found. Start one above.</div>`
        : this.runs.map((run) => this.renderRunCard(run)).join('\n');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>NIRMAN Agent Manager</title>
  <style>
    :root {
      --bg: var(--vscode-editor-background, #1e1e1e);
      --fg: var(--vscode-editor-foreground, #d4d4d4);
      --card-bg: var(--vscode-sideBar-background, #252526);
      --border: var(--vscode-panel-border, #333333);
      --accent: var(--vscode-button-background, #0e639c);
      --accent-hover: var(--vscode-button-hoverBackground, #1177bb);
      --success: #3fb950;
      --warn: #d29922;
      --danger: #f85149;
      --font: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--font);
      background: var(--bg);
      color: var(--fg);
      padding: 16px;
      line-height: 1.5;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 16px;
    }
    .title {
      font-size: 1.2rem;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .stats {
      font-size: 0.85rem;
      color: var(--vscode-descriptionForeground, #888);
      display: flex;
      gap: 12px;
    }
    .stat-badge {
      padding: 2px 8px;
      border-radius: 12px;
      background: var(--card-bg);
      border: 1px solid var(--border);
    }
    .new-agent-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 12px;
      margin-bottom: 16px;
    }
    .new-agent-title {
      font-size: 0.95rem;
      font-weight: 600;
      margin-bottom: 8px;
    }
    .input-row {
      display: flex;
      gap: 8px;
      margin-bottom: 8px;
    }
    input[type="text"] {
      flex: 1;
      padding: 6px 10px;
      background: var(--bg);
      border: 1px solid var(--border);
      color: var(--fg);
      border-radius: 4px;
      font-family: inherit;
    }
    button {
      padding: 6px 12px;
      background: var(--accent);
      color: #fff;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-family: inherit;
      font-size: 0.85rem;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    button:hover { background: var(--accent-hover); }
    button.secondary {
      background: var(--card-bg);
      border: 1px solid var(--border);
      color: var(--fg);
    }
    button.secondary:hover { background: var(--border); }
    button.danger { background: var(--danger); }
    button.success { background: var(--success); }
    .runs-grid {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .run-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .run-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 8px;
    }
    .run-id {
      font-weight: 600;
      font-size: 0.95rem;
    }
    .run-task {
      font-size: 0.9rem;
      margin: 4px 0;
      font-weight: 500;
    }
    .run-meta {
      font-size: 0.8rem;
      color: var(--vscode-descriptionForeground, #888);
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
    }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
    }
    .badge-running { background: rgba(63, 185, 80, 0.2); color: var(--success); border: 1px solid var(--success); }
    .badge-planning { background: rgba(14, 99, 156, 0.2); color: #58a6ff; border: 1px solid #58a6ff; }
    .badge-waiting_approval { background: rgba(210, 153, 34, 0.2); color: var(--warn); border: 1px solid var(--warn); }
    .badge-paused { background: rgba(210, 153, 34, 0.15); color: var(--warn); border: 1px solid var(--warn); }
    .badge-completed { background: rgba(163, 113, 247, 0.2); color: #bc8cff; border: 1px solid #bc8cff; }
    .badge-failed, .badge-blocked, .badge-cancelled { background: rgba(248, 81, 73, 0.2); color: var(--danger); border: 1px solid var(--danger); }
    .section-title {
      font-size: 0.8rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--vscode-descriptionForeground, #888);
      margin-top: 4px;
    }
    .current-task {
      font-size: 0.85rem;
      padding: 6px 10px;
      background: var(--bg);
      border-left: 3px solid var(--accent);
      border-radius: 2px;
    }
    .pending-approval-box {
      background: rgba(210, 153, 34, 0.1);
      border: 1px solid var(--warn);
      padding: 8px 12px;
      border-radius: 4px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
    }
    .actions-bar {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 4px;
    }
    .comment-box {
      margin-top: 6px;
      padding: 8px;
      background: var(--bg);
      border-radius: 4px;
      border: 1px solid var(--border);
    }
    .comments-list {
      margin-top: 4px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      max-height: 120px;
      overflow-y: auto;
    }
    .comment-item {
      font-size: 0.8rem;
      padding: 4px 6px;
      background: var(--card-bg);
      border-radius: 3px;
      border-left: 2px solid var(--accent);
    }
    .empty-state {
      text-align: center;
      padding: 32px 16px;
      color: var(--vscode-descriptionForeground, #888);
    }
    .shortcut-hint {
      font-size: 0.75rem;
      color: var(--vscode-descriptionForeground, #888);
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="title">🤖 NIRMAN Agent Manager</div>
      <div class="shortcut-hint">Press <strong>Ctrl+Alt+M</strong> to toggle between Editor and Manager</div>
    </div>
    <div class="stats">
      <div class="stat-badge">Active: <strong>${runningCount}</strong></div>
      <div class="stat-badge">Approvals: <strong>${pendingApprovalCount}</strong></div>
      <button class="secondary" onclick="postMessage({ type: 'refresh_agents' })">🔄 Refresh</button>
      <button class="secondary" onclick="postMessage({ type: 'toggle_manager_focus' })">Editor ⇋ Manager</button>
    </div>
  </div>

  <div class="new-agent-card">
    <div class="new-agent-title">🚀 Start Parallel Agent</div>
    <div class="input-row">
      <input type="text" id="newAgentTask" placeholder="Enter task or project description (e.g. 'Build a REST API in Node.js')..." />
      <input type="text" id="newAgentWorkspace" placeholder="Workspace path (optional)..." style="max-width: 200px;" />
      <button onclick="startNewAgent()">+ Start Agent</button>
    </div>
    <label style="font-size: 0.8rem; display: inline-flex; align-items: center; gap: 4px; cursor: pointer;">
      <input type="checkbox" id="newAgentSkipPlanning" /> Skip planning phase (execute directly)
    </label>
  </div>

  <div class="runs-grid">
    ${runsHtml}
  </div>

  <script>
    const vscode = acquireVsCodeApi ? acquireVsCodeApi() : null;

    function postMessage(msg) {
      if (vscode) {
        vscode.postMessage(msg);
      }
    }

    function startNewAgent() {
      const taskInput = document.getElementById('newAgentTask');
      const wsInput = document.getElementById('newAgentWorkspace');
      const skipInput = document.getElementById('newAgentSkipPlanning');

      const task = taskInput ? taskInput.value.trim() : '';
      if (!task) return;

      postMessage({
        type: 'start_agent',
        task,
        workspaceRoot: wsInput && wsInput.value.trim() ? wsInput.value.trim() : undefined,
        skipPlanning: Boolean(skipInput && skipInput.checked)
      });

      if (taskInput) taskInput.value = '';
    }

    function commentOnArtifact(runId) {
      const input = document.getElementById('commentInput_' + runId);
      const artifactSelect = document.getElementById('artifactSelect_' + runId);
      if (!input || !input.value.trim()) return;

      postMessage({
        type: 'comment_artifact',
        runId,
        feedback: input.value.trim(),
        artifactPath: artifactSelect ? artifactSelect.value : undefined
      });
      input.value = '';
    }

    function jumpToFile(runId) {
      const input = document.getElementById('jumpFileInput_' + runId);
      if (!input || !input.value.trim()) return;
      postMessage({
        type: 'jump_to_file',
        runId,
        filePath: input.value.trim()
      });
    }

    window.addEventListener('message', (event) => {
      // Live event handlers if needed
    });
  </script>
</body>
</html>`;
  }

  private renderRunCard(run: RunRecord): string {
    const statusClass = `badge-${run.status}`;
    const currentTaskText =
      run.currentTask ??
      (run.status === 'planning'
        ? 'Generating project plan and specification...'
        : run.status === 'completed'
          ? 'Completed all tasks'
          : run.status === 'cancelled'
            ? 'Cancelled by user'
            : 'Idle');

    const pendingApproval = run.pendingApproval;
    const pendingApprovalHtml = pendingApproval
      ? `<div class="pending-approval-box">
          <div>
            <strong>⚠️ Pending ${pendingApproval.type === 'plan' ? 'Plan Approval' : 'Action Approval'}:</strong>
            ${escapeHtml(pendingApproval.reason ?? '')}
          </div>
          <div style="display: flex; gap: 4px;">
            ${
              pendingApproval.type === 'plan'
                ? `<button class="success" onclick="postMessage({ type: 'approve_agent_plan', runId: '${run.runId}' })">✔ Approve Plan</button>`
                : `<button class="success" onclick="postMessage({ type: 'approve_agent_action', runId: '${run.runId}', actionId: '${pendingApproval.actionId ?? ''}', approved: true })">✔ Allow</button>
                   <button class="danger" onclick="postMessage({ type: 'approve_agent_action', runId: '${run.runId}', actionId: '${pendingApproval.actionId ?? ''}', approved: false })">✖ Deny</button>`
            }
          </div>
        </div>`
      : '';

    const comments = run.comments ?? [];
    const commentsHtml =
      comments.length > 0
        ? `<div class="comments-list">
            ${comments
              .map(
                (c) =>
                  `<div class="comment-item"><strong>${c.artifactPath ? `[${escapeHtml(c.artifactPath)}] ` : ''}</strong>${escapeHtml(c.feedback)} <span style="opacity: 0.6; font-size: 0.7rem;">(${new Date(c.timestamp).toLocaleTimeString()})</span></div>`,
              )
              .join('')}
          </div>`
        : '';

    return `
    <div class="run-card" id="run_${run.runId}">
      <div class="run-header">
        <div>
          <span class="run-id">Agent Run: ${escapeHtml(run.runId)}</span>
          <span class="badge ${statusClass}">${escapeHtml(run.status)}</span>
        </div>
        <div class="run-meta">
          <span>Branch: <code>${escapeHtml(run.gitBranch)}</code></span>
          <span>Steps: <strong>${run.stepsCount}</strong></span>
        </div>
      </div>

      <div class="run-task">Goal: ${escapeHtml(run.task)}</div>
      <div class="run-meta">
        <span>Workspace: <code>${escapeHtml(run.worktreePath || run.repoRoot)}</code></span>
      </div>

      <div class="section-title">Current Task</div>
      <div class="current-task">${escapeHtml(currentTaskText)}</div>

      ${pendingApprovalHtml}

      <div class="actions-bar">
        ${
          run.status === 'running' || run.status === 'planning'
            ? `<button class="secondary" onclick="postMessage({ type: 'pause_agent', runId: '${run.runId}' })">⏸ Pause</button>`
            : run.status === 'paused'
              ? `<button class="success" onclick="postMessage({ type: 'resume_agent', runId: '${run.runId}' })">▶ Resume</button>`
              : ''
        }
        ${
          run.status !== 'completed' && run.status !== 'failed' && run.status !== 'cancelled'
            ? `<button class="danger" onclick="postMessage({ type: 'cancel_agent', runId: '${run.runId}' })">⏹ Cancel</button>`
            : ''
        }
        <button class="secondary" onclick="postMessage({ type: 'open_run_artifact', runId: '${run.runId}', artifactName: 'plan.md' })">📄 plan.md</button>
        <button class="secondary" onclick="postMessage({ type: 'open_run_artifact', runId: '${run.runId}', artifactName: 'tasks.json' })">📋 tasks.json</button>
        <button class="secondary" onclick="postMessage({ type: 'open_run_artifact', runId: '${run.runId}', artifactName: 'walkthrough.md' })">📝 walkthrough.md</button>
        <button class="secondary" onclick="postMessage({ type: 'open_run_artifact', runId: '${run.runId}', artifactName: 'log.txt' })">📜 log.txt</button>
      </div>

      <div class="comment-box">
        <div style="font-size: 0.8rem; font-weight: 600; margin-bottom: 4px;">💬 Comment on Artifacts (fed back without stopping agent):</div>
        <div class="input-row">
          <input type="text" id="commentInput_${run.runId}" placeholder="Enter comment or refinement suggestion..." />
          <input type="text" id="artifactSelect_${run.runId}" placeholder="File/artifact (optional)" style="max-width: 140px;" />
          <button class="secondary" onclick="commentOnArtifact('${run.runId}')">Send Comment</button>
        </div>
        ${commentsHtml}
      </div>

      <div style="display: flex; gap: 8px; align-items: center; margin-top: 4px;">
        <span style="font-size: 0.8rem; font-weight: 600;">🔍 Jump to File in Editor:</span>
        <input type="text" id="jumpFileInput_${run.runId}" placeholder="e.g. app.js or index.html" style="max-width: 220px;" />
        <button class="secondary" onclick="jumpToFile('${run.runId}')">Open in Editor</button>
      </div>
    </div>`;
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
