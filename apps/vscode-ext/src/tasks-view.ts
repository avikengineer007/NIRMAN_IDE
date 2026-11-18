import type { TaskItem } from '@nirman/artifacts';
import type { IWebviewView } from './vscode-api.js';

export class TasksViewProvider {
  private view?: IWebviewView | undefined;
  private activeRunId?: string | undefined;
  private tasks: readonly TaskItem[] = [];

  public resolveWebviewView(webviewView: IWebviewView): void {
    this.view = webviewView;
    webviewView.webview.html = this.getHtml();
    this.updateWebview();
  }

  public setTasks(runId: string, tasks: readonly TaskItem[]): void {
    this.activeRunId = runId;
    this.tasks = tasks;
    this.updateWebview();
  }

  public getTasks(): readonly TaskItem[] {
    return this.tasks;
  }

  private updateWebview(): void {
    if (!this.view) return;
    void this.view.webview.postMessage({
      type: 'tasks_updated',
      runId: this.activeRunId ?? '',
      tasks: this.tasks,
    });
  }

  private getHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>NIRMAN Tasks</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 12px; margin: 0; color: #ccc; }
    h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; color: #888; margin-top: 0; }
    .task-list { display: flex; flex-direction: column; gap: 8px; }
    .task-card { padding: 8px 12px; border-radius: 4px; background: #252526; border: 1px solid #333; font-size: 13px; display: flex; align-items: center; justify-content: space-between; }
    .task-title { font-weight: 500; }
    .status-badge { font-size: 11px; padding: 2px 6px; border-radius: 3px; font-weight: bold; }
    .status-pending { background: #333; color: #aaa; }
    .status-in_progress { background: #007acc; color: #fff; }
    .status-completed { background: #388a34; color: #fff; }
    .status-failed { background: #a1260d; color: #fff; }
    .status-blocked { background: #cca700; color: #1e1e1e; }
  </style>
</head>
<body>
  <h2>Execution Tasks</h2>
  <div id="tasks-container" class="task-list"></div>

  <script>
    const container = document.getElementById('tasks-container');

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'tasks_updated') {
        container.innerHTML = '';
        if (!msg.tasks || msg.tasks.length === 0) {
          container.innerHTML = '<div style="color: #666; font-style: italic;">No tasks queued</div>';
          return;
        }

        for (const task of msg.tasks) {
          const card = document.createElement('div');
          card.className = 'task-card';

          const title = document.createElement('div');
          title.className = 'task-title';
          title.textContent = task.title;

          const badge = document.createElement('span');
          badge.className = 'status-badge status-' + task.status;
          badge.textContent = task.status.replace('_', ' ').toUpperCase();

          card.appendChild(title);
          card.appendChild(badge);
          container.appendChild(card);
        }
      }
    });
  </script>
</body>
</html>`;
  }
}
