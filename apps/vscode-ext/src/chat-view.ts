import type { ChatMessageItem, WebviewToExtensionMessage } from './types.js';
import type { IWebviewView } from './vscode-api.js';

export interface ChatViewDelegate {
  onDescribeProject(prompt: string, skipPlanning?: boolean): Promise<void>;
  onPauseRun(runId: string): Promise<void>;
  onResumeRun(runId: string): Promise<void>;
  onCancelRun(runId: string): Promise<void>;
  onApproveActivePlan?(): Promise<void>;
}

export class ChatViewProvider {
  private view?: IWebviewView | undefined;
  private delegate?: ChatViewDelegate | undefined;
  private messages: ChatMessageItem[] = [];

  public setDelegate(delegate: ChatViewDelegate): void {
    this.delegate = delegate;
  }

  public resolveWebviewView(webviewView: IWebviewView): void {
    this.view = webviewView;
    const wv = webviewView.webview as unknown as { options?: { enableScripts?: boolean } };
    if (wv) {
      wv.options = { enableScripts: true };
    }
    webviewView.webview.html = this.getHtml();

    webviewView.webview.onDidReceiveMessage((msg: WebviewToExtensionMessage | { type: 'approve_active_plan' }) => {
      if (!this.delegate) return;

      void (async () => {
        switch (msg.type) {
          case 'describe_project':
            await this.delegate!.onDescribeProject(msg.prompt, msg.skipPlanning);
            break;
          case 'pause_run':
            await this.delegate!.onPauseRun(msg.runId);
            break;
          case 'resume_run':
            await this.delegate!.onResumeRun(msg.runId);
            break;
          case 'cancel_run':
            await this.delegate!.onCancelRun(msg.runId);
            break;
          case 'approve_active_plan':
            if (this.delegate!.onApproveActivePlan) {
              await this.delegate!.onApproveActivePlan();
            }
            break;
        }
      })();
    });

    // Replay existing messages
    for (const msg of this.messages) {
      void webviewView.webview.postMessage({ type: 'chat_message', message: msg });
    }
  }

  public appendMessage(sender: 'user' | 'assistant' | 'system', content: string): void {
    const item: ChatMessageItem = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      sender,
      content,
      timestamp: new Date().toLocaleTimeString(),
    };
    this.messages.push(item);
    if (this.view) {
      void this.view.webview.postMessage({ type: 'chat_message', message: item });
    }
  }

  public getMessages(): ChatMessageItem[] {
    return [...this.messages];
  }

  public clearMessages(): void {
    this.messages = [];
  }

  private getHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>NIRMAN Agent Chat</title>
  <style>
    :root {
      --bg: #18181b;
      --surface: #202024;
      --surface-hover: #27272a;
      --border: #303036;
      --accent: #0e639c;
      --accent-hover: #1177bb;
      --accent-glow: rgba(88, 166, 255, 0.2);
      --text: #e4e4e7;
      --text-muted: #a1a1aa;
      --success: #1f883d;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      height: 100vh;
      box-sizing: border-box;
      background: var(--bg);
      color: var(--text);
    }
    .header {
      padding: 10px 14px;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: var(--surface);
    }
    .header-title {
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.4px;
      display: flex;
      align-items: center;
      gap: 6px;
      color: #fff;
    }
    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #22c55e;
      box-shadow: 0 0 6px #22c55e;
    }
    .model-badge {
      font-size: 10px;
      padding: 2px 6px;
      border-radius: 4px;
      background: #27272a;
      color: #58a6ff;
      border: 1px solid #3f3f46;
    }
    #chat-log {
      flex: 1;
      overflow-y: auto;
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    #empty-state {
      margin: auto 0;
      text-align: center;
      padding: 16px 8px;
    }
    #empty-state h3 {
      margin: 0 0 6px 0;
      font-size: 14px;
      color: #fff;
    }
    #empty-state p {
      margin: 0 0 14px 0;
      font-size: 12px;
      color: var(--text-muted);
      line-height: 1.4;
    }
    .chips {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .chip {
      padding: 8px 10px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text);
      font-size: 11.5px;
      text-align: left;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .chip:hover {
      background: var(--surface-hover);
      border-color: #58a6ff;
    }
    .msg {
      padding: 10px 12px;
      border-radius: 8px;
      font-size: 12.5px;
      line-height: 1.45;
      max-width: 92%;
      word-break: break-word;
      white-space: pre-wrap;
    }
    .msg.user {
      background: var(--accent);
      color: #fff;
      align-self: flex-end;
      border-bottom-right-radius: 2px;
    }
    .msg.assistant {
      background: var(--surface);
      color: var(--text);
      border: 1px solid var(--border);
      align-self: flex-start;
      border-bottom-left-radius: 2px;
    }
    .msg.system {
      background: rgba(255, 255, 255, 0.03);
      color: var(--text-muted);
      border: 1px dashed var(--border);
      align-self: stretch;
      font-size: 11.5px;
      padding: 6px 10px;
    }
    .approve-inline-btn {
      margin-top: 8px;
      display: inline-block;
      padding: 5px 12px;
      background: var(--success);
      color: #fff;
      border: none;
      border-radius: 4px;
      font-size: 11.5px;
      font-weight: 600;
      cursor: pointer;
    }
    .composer {
      padding: 10px 12px 12px;
      border-top: 1px solid var(--border);
      background: var(--surface);
    }
    #prompt-form {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    #prompt-input {
      width: 100%;
      min-height: 58px;
      max-height: 150px;
      padding: 8px 10px;
      border-radius: 6px;
      border: 1px solid var(--border);
      background: var(--bg);
      color: #fff;
      font-family: inherit;
      font-size: 12.5px;
      resize: vertical;
      box-sizing: border-box;
      outline: none;
    }
    #prompt-input:focus {
      border-color: #58a6ff;
      box-shadow: 0 0 0 2px var(--accent-glow);
    }
    .composer-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .fast-toggle {
      font-size: 11px;
      color: var(--text-muted);
      display: flex;
      align-items: center;
      gap: 4px;
      cursor: pointer;
      user-select: none;
    }
    #send-btn {
      padding: 6px 16px;
      background: var(--accent);
      color: #fff;
      border: none;
      border-radius: 5px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
    }
    #send-btn:hover {
      background: var(--accent-hover);
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-title">
      <span class="status-dot"></span>
      <span>NIRMAN Agent Chat</span>
    </div>
    <span class="model-badge">Qwen2.5-Coder 7B • GPU</span>
  </div>

  <div id="chat-log">
    <div id="empty-state">
      <h3>What should we build today?</h3>
      <p>NIRMAN plans, writes files, and verifies tasks locally on your NVIDIA GPU.</p>
      <div class="chips">
        <button type="button" class="chip" data-prompt="Build a modern personal portfolio website with dark mode and a contact form">✨ Build a personal portfolio website</button>
        <button type="button" class="chip" data-prompt="Create a Node.js CLI utility that parses CSV files into formatted JSON">⚡ Create a CSV-to-JSON CLI tool</button>
        <button type="button" class="chip" data-prompt="Analyze the current workspace and create a README with setup instructions">📄 Generate project documentation</button>
      </div>
    </div>
  </div>

  <div class="composer">
    <form id="prompt-form">
      <textarea id="prompt-input" placeholder="Ask NIRMAN to build, edit, or debug... (Enter to send, Shift+Enter for new line)" required></textarea>
      <div class="composer-footer">
        <label class="fast-toggle">
          <input type="checkbox" id="skip-plan" />
          <span>Fast execute (skip plan approval)</span>
        </label>
        <button type="submit" id="send-btn">Send ⏎</button>
      </div>
    </form>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const chatLog = document.getElementById('chat-log');
    const emptyState = document.getElementById('empty-state');
    const form = document.getElementById('prompt-form');
    const input = document.getElementById('prompt-input');
    const skipPlanInput = document.getElementById('skip-plan');

    function submitPrompt() {
      const prompt = input.value.trim();
      if (!prompt) return;
      vscode.postMessage({
        type: 'describe_project',
        prompt,
        skipPlanning: skipPlanInput.checked
      });
      input.value = '';
    }

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      submitPrompt();
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submitPrompt();
      }
    });

    document.querySelectorAll('.chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        input.value = btn.getAttribute('data-prompt') || '';
        input.focus();
      });
    });

    window.addEventListener('message', (event) => {
      const data = event.data;
      if (data.type === 'chat_message') {
        if (emptyState && emptyState.parentNode) {
          emptyState.remove();
        }
        const div = document.createElement('div');
        div.className = 'msg ' + data.message.sender;
        div.textContent = data.message.content;

        if (data.message.content && data.message.content.includes('Execution plan created')) {
          const br = document.createElement('div');
          const btn = document.createElement('button');
          btn.className = 'approve-inline-btn';
          btn.textContent = '✔ Approve Plan & Execute';
          btn.onclick = () => {
            btn.disabled = true;
            btn.textContent = '✔ Approved';
            vscode.postMessage({ type: 'approve_active_plan' });
          };
          br.appendChild(btn);
          div.appendChild(br);
        }

        chatLog.appendChild(div);
        chatLog.scrollTop = chatLog.scrollHeight;
      }
    });
  </script>
</body>
</html>`;
  }
}
