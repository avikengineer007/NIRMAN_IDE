import type { TaskItem } from '@nirman/artifacts';
import type { WebviewToExtensionMessage } from './types.js';
import type { IWebviewView } from './vscode-api.js';

export interface PlanViewDelegate {
  onApprovePlan(runId: string): Promise<void>;
  onCommentPlan(runId: string, feedback: string): Promise<void>;
}

export class PlanViewProvider {
  private view?: IWebviewView | undefined;
  private delegate?: PlanViewDelegate | undefined;
  private activeRunId?: string | undefined;
  private planMarkdown = '';
  private specMarkdown = '';
  private tasks: readonly TaskItem[] = [];
  private isWaitingApproval = false;

  public setDelegate(delegate: PlanViewDelegate): void {
    this.delegate = delegate;
  }

  public resolveWebviewView(webviewView: IWebviewView): void {
    this.view = webviewView;
    webviewView.webview.html = this.getHtml();

    webviewView.webview.onDidReceiveMessage((msg: WebviewToExtensionMessage) => {
      if (!this.delegate) return;

      void (async () => {
        if (msg.type === 'approve_plan') {
          await this.delegate!.onApprovePlan(msg.runId);
        } else if (msg.type === 'comment_plan') {
          await this.delegate!.onCommentPlan(msg.runId, msg.feedback);
        }
      })();
    });

    this.updateWebview();
  }

  public setPlanData(data: {
    runId: string;
    planMarkdown: string;
    specMarkdown: string;
    tasks: readonly TaskItem[];
    isWaitingApproval: boolean;
  }): void {
    this.activeRunId = data.runId;
    this.planMarkdown = data.planMarkdown;
    this.specMarkdown = data.specMarkdown;
    this.tasks = data.tasks;
    this.isWaitingApproval = data.isWaitingApproval;
    this.updateWebview();
  }

  public getPlanMarkdown(): string {
    return this.planMarkdown;
  }

  public getSpecMarkdown(): string {
    return this.specMarkdown;
  }

  private updateWebview(): void {
    if (!this.view) return;
    void this.view.webview.postMessage({
      type: 'plan_updated',
      runId: this.activeRunId ?? '',
      planMarkdown: this.planMarkdown,
      specMarkdown: this.specMarkdown,
      tasks: this.tasks,
    });
  }

  private getHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>NIRMAN Plan View</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 12px; margin: 0; box-sizing: border-box; color: #ccc; }
    h2 { font-size: 14px; margin-top: 0; border-bottom: 1px solid #333; padding-bottom: 6px; }
    textarea { width: 100%; height: 220px; box-sizing: border-box; background: #1e1e1e; color: #d4d4d4; border: 1px solid #3c3c3c; border-radius: 4px; padding: 8px; font-family: monospace; font-size: 12px; resize: vertical; }
    .actions { margin-top: 10px; display: flex; gap: 8px; align-items: center; }
    button.approve { background: #388a34; color: #fff; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-weight: bold; }
    button.approve:hover { background: #45a141; }
    button.feedback { background: #2d2d2d; color: #ccc; border: 1px solid #444; padding: 8px 12px; border-radius: 4px; cursor: pointer; }
    button.feedback:hover { background: #3e3e3e; }
    #feedback-input { flex: 1; padding: 6px; background: #252526; border: 1px solid #3c3c3c; color: #fff; border-radius: 4px; }
    .badge { display: inline-block; padding: 2px 6px; border-radius: 3px; font-size: 11px; font-weight: bold; }
    .badge.waiting { background: #e2c08d; color: #1e1e1e; }
    .badge.approved { background: #388a34; color: #fff; }
  </style>
</head>
<body>
  <h2>NIRMAN Execution Plan <span id="status-badge" class="badge"></span></h2>
  <textarea id="plan-text" placeholder="Execution plan will appear here..."></textarea>
  <div class="actions">
    <button id="approve-btn" class="approve">✔ Approve Plan</button>
  </div>
  <div class="actions" style="margin-top: 8px;">
    <input type="text" id="feedback-input" placeholder="Feedback or requested changes..." />
    <button id="feedback-btn" class="feedback">Request Revision</button>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    let currentRunId = '';

    const planArea = document.getElementById('plan-text');
    const approveBtn = document.getElementById('approve-btn');
    const feedbackInput = document.getElementById('feedback-input');
    const feedbackBtn = document.getElementById('feedback-btn');

    approveBtn.addEventListener('click', () => {
      if (!currentRunId) return;
      vscode.postMessage({ type: 'approve_plan', runId: currentRunId });
    });

    feedbackBtn.addEventListener('click', () => {
      const feedback = feedbackInput.value.trim();
      if (!currentRunId || !feedback) return;
      vscode.postMessage({ type: 'comment_plan', runId: currentRunId, feedback });
      feedbackInput.value = '';
    });

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'plan_updated') {
        currentRunId = msg.runId;
        planArea.value = msg.planMarkdown || '';
      }
    });
  </script>
</body>
</html>`;
  }
}
