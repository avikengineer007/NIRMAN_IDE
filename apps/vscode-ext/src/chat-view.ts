import type { ChatMessageItem, WebviewToExtensionMessage } from './types.js';
import type { IWebviewView } from './vscode-api.js';

export interface ChatViewDelegate {
  onDescribeProject(prompt: string, skipPlanning?: boolean): Promise<void>;
  onPauseRun(runId: string): Promise<void>;
  onResumeRun(runId: string): Promise<void>;
  onCancelRun(runId: string): Promise<void>;
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
    webviewView.webview.html = this.getHtml();

    webviewView.webview.onDidReceiveMessage((msg: WebviewToExtensionMessage) => {
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
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 12px; display: flex; flex-direction: column; height: 100vh; box-sizing: border-box; }
    #chat-log { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
    .msg { padding: 8px 12px; border-radius: 6px; font-size: 13px; max-width: 90%; word-break: break-word; }
    .msg.user { background: #007acc; color: #fff; align-self: flex-end; }
    .msg.assistant { background: #252526; color: #ccc; border: 1px solid #333; align-self: flex-start; }
    .msg.system { background: #1e1e1e; color: #888; font-style: italic; align-self: center; font-size: 11px; }
    #prompt-form { display: flex; gap: 6px; }
    #prompt-input { flex: 1; padding: 8px; border-radius: 4px; border: 1px solid #3c3c3c; background: #2d2d2d; color: #fff; }
    button { padding: 8px 16px; background: #0e639c; color: #fff; border: none; border-radius: 4px; cursor: pointer; }
    button:hover { background: #1177bb; }
  </style>
</head>
<body>
  <div id="chat-log"></div>
  <form id="prompt-form">
    <input type="text" id="prompt-input" placeholder="Describe your project (e.g. Build a task manager web app)..." required />
    <button type="submit" id="send-btn">Start</button>
  </form>

  <script>
    const vscode = acquireVsCodeApi();
    const chatLog = document.getElementById('chat-log');
    const form = document.getElementById('prompt-form');
    const input = document.getElementById('prompt-input');

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const prompt = input.value.trim();
      if (!prompt) return;
      vscode.postMessage({ type: 'describe_project', prompt });
      input.value = '';
    });

    window.addEventListener('message', (event) => {
      const data = event.data;
      if (data.type === 'chat_message') {
        const div = document.createElement('div');
        div.className = 'msg ' + data.message.sender;
        div.textContent = data.message.content;
        chatLog.appendChild(div);
        chatLog.scrollTop = chatLog.scrollHeight;
      }
    });
  </script>
</body>
</html>`;
  }
}
