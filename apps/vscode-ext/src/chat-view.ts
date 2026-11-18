import type { ChatMessageItem, WebviewToExtensionMessage } from './types.js';
import type { IWebviewView } from './vscode-api.js';

export interface ChatViewDelegate {
  onDescribeProject(prompt: string, skipPlanning?: boolean): Promise<void>;
  onPauseRun(runId: string): Promise<void>;
  onResumeRun(runId: string): Promise<void>;
  onCancelRun(runId: string): Promise<void>;
  onApproveActivePlan?(): Promise<void>;
  onReviseActivePlan?(feedback: string): Promise<void>;
  onOpenFile?(filePath: string): Promise<void>;
  onClearChat?(): Promise<void>;
}

type ExtraChatWebviewMessage =
  | { type: 'approve_active_plan' }
  | { type: 'revise_active_plan'; feedback: string }
  | { type: 'open_file'; filePath: string }
  | { type: 'clear_chat' };

export class ChatViewProvider {
  private view?: IWebviewView | undefined;
  private delegate?: ChatViewDelegate | undefined;
  private messages: ChatMessageItem[] = [];
  private activeFolderName = 'Workspace';

  public setDelegate(delegate: ChatViewDelegate): void {
    this.delegate = delegate;
  }

  public setActiveFolder(folderName: string): void {
    this.activeFolderName = folderName || 'Workspace';
    if (this.view) {
      void (this.view.webview as unknown as { postMessage(msg: unknown): Promise<boolean> }).postMessage({
        type: 'folder_changed',
        folderName: this.activeFolderName,
      });
    }
  }

  public setMessages(messages: readonly ChatMessageItem[], folderName?: string): void {
    this.messages = [...messages];
    if (folderName) {
      this.activeFolderName = folderName;
    }
    if (this.view) {
      void (this.view.webview as unknown as { postMessage(msg: unknown): Promise<boolean> }).postMessage({
        type: 'reset_messages',
        folderName: this.activeFolderName,
        messages: this.messages,
      });
    }
  }

  public resolveWebviewView(webviewView: IWebviewView): void {
    this.view = webviewView;
    const wv = webviewView.webview as unknown as { options?: { enableScripts?: boolean } };
    if (wv) {
      wv.options = { enableScripts: true };
    }
    webviewView.webview.html = this.getHtml();

    webviewView.webview.onDidReceiveMessage(
      (msg: WebviewToExtensionMessage | ExtraChatWebviewMessage) => {
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
            case 'revise_active_plan':
              if (this.delegate!.onReviseActivePlan) {
                await this.delegate!.onReviseActivePlan(msg.feedback);
              }
              break;
            case 'open_file':
              if (this.delegate!.onOpenFile) {
                await this.delegate!.onOpenFile(msg.filePath);
              }
              break;
            case 'clear_chat':
              if (this.delegate!.onClearChat) {
                await this.delegate!.onClearChat();
              }
              break;
          }
        })();
      },
    );

    void (webviewView.webview as unknown as { postMessage(msg: unknown): Promise<boolean> }).postMessage({
      type: 'folder_changed',
      folderName: this.activeFolderName,
    });

    // Replay existing messages (kept compatible with unit tests expecting chat_message posts)
    for (const msg of this.messages) {
      void webviewView.webview.postMessage({ type: 'chat_message', message: msg });
    }
  }

  public appendMessage(sender: 'user' | 'assistant' | 'system', content: string): ChatMessageItem {
    const item: ChatMessageItem = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      sender,
      content,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    this.messages.push(item);
    if (this.view) {
      void this.view.webview.postMessage({ type: 'chat_message', message: item });
    }
    return item;
  }

  public getMessages(): ChatMessageItem[] {
    return [...this.messages];
  }

  public clearMessages(): void {
    this.messages = [];
    if (this.view) {
      void (this.view.webview as unknown as { postMessage(msg: unknown): Promise<boolean> }).postMessage({
        type: 'reset_messages',
        folderName: this.activeFolderName,
        messages: [],
      });
    }
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
      --bg: #131316;
      --surface: #1c1c21;
      --surface-elevated: #24242b;
      --surface-hover: #2c2c35;
      --border: #2e2e38;
      --accent: #2563eb;
      --accent-hover: #3b82f6;
      --accent-glow: rgba(59, 130, 246, 0.22);
      --text: #ececf1;
      --text-muted: #9ca3af;
      --success: #16a34a;
      --success-hover: #15803d;
    }
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Roboto, sans-serif;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      height: 100vh;
      background: var(--bg);
      color: var(--text);
      overflow: hidden;
    }
    .header {
      padding: 10px 14px;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: var(--surface);
      gap: 8px;
    }
    .header-left {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }
    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #22c55e;
      box-shadow: 0 0 8px #22c55e;
      flex-shrink: 0;
    }
    .header-title {
      font-size: 12.5px;
      font-weight: 600;
      color: #fff;
      white-space: nowrap;
    }
    .folder-pill {
      font-size: 11px;
      padding: 2px 7px;
      border-radius: 999px;
      background: var(--surface-elevated);
      color: #93c5fd;
      border: 1px solid var(--border);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 130px;
    }
    .header-right {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
    }
    .model-badge {
      font-size: 10px;
      padding: 2px 6px;
      border-radius: 4px;
      background: rgba(37, 99, 235, 0.15);
      color: #60a5fa;
      border: 1px solid rgba(59, 130, 246, 0.3);
    }
    .icon-btn {
      background: transparent;
      border: 1px solid var(--border);
      color: var(--text-muted);
      border-radius: 5px;
      padding: 3px 8px;
      font-size: 11px;
      cursor: pointer;
    }
    .icon-btn:hover {
      background: var(--surface-hover);
      color: #fff;
    }
    #chat-log {
      flex: 1;
      overflow-y: auto;
      padding: 16px 14px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      scroll-behavior: smooth;
    }
    #empty-state {
      margin: auto 0;
      text-align: center;
      padding: 20px 10px;
    }
    .hero-logo {
      width: 42px;
      height: 42px;
      border-radius: 12px;
      background: linear-gradient(135deg, #2563eb, #10b981);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      font-size: 20px;
      color: #fff;
      margin-bottom: 12px;
      box-shadow: 0 6px 20px rgba(37, 99, 235, 0.35);
    }
    #empty-state h3 {
      margin: 0 0 6px 0;
      font-size: 15px;
      font-weight: 600;
      color: #fff;
    }
    #empty-state p {
      margin: 0 0 16px 0;
      font-size: 12px;
      color: var(--text-muted);
      line-height: 1.5;
    }
    .chips {
      display: flex;
      flex-direction: column;
      gap: 7px;
    }
    .chip {
      padding: 9px 12px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      color: var(--text);
      font-size: 12px;
      text-align: left;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .chip:hover {
      background: var(--surface-hover);
      border-color: #60a5fa;
      transform: translateY(-1px);
    }
    .msg-wrapper {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .msg-wrapper.user { align-items: flex-end; }
    .msg-wrapper.assistant { align-items: flex-start; }
    .msg-wrapper.system { align-items: stretch; }
    .msg-meta {
      font-size: 10px;
      color: var(--text-muted);
      padding: 0 4px;
    }
    .msg {
      padding: 10px 13px;
      border-radius: 10px;
      font-size: 12.5px;
      line-height: 1.55;
      max-width: 95%;
      word-break: break-word;
    }
    .msg.user {
      background: var(--accent);
      color: #fff;
      border-bottom-right-radius: 3px;
    }
    .msg.assistant {
      background: var(--surface);
      color: var(--text);
      border: 1px solid var(--border);
      border-bottom-left-radius: 3px;
      width: 100%;
    }
    .msg.system {
      background: var(--surface);
      color: var(--text);
      border: 1px solid var(--border);
      border-left: 3px solid #60a5fa;
      font-size: 12px;
      padding: 9px 12px;
    }
    .msg h3, .msg h4 {
      margin: 10px 0 5px 0;
      color: #fff;
      font-size: 13px;
    }
    .msg h3:first-child, .msg h4:first-child {
      margin-top: 0;
    }
    .msg p {
      margin: 5px 0;
    }
    .msg ul, .msg ol {
      margin: 6px 0;
      padding-left: 20px;
    }
    .msg li {
      margin: 3px 0;
    }
    .msg code {
      background: rgba(255, 255, 255, 0.08);
      padding: 1px 5px;
      border-radius: 4px;
      font-family: Consolas, 'Courier New', monospace;
      font-size: 11.5px;
      color: #93c5fd;
    }
    .msg pre {
      background: #0d0d10;
      border: 1px solid var(--border);
      padding: 9px 11px;
      border-radius: 6px;
      overflow-x: auto;
      margin: 8px 0;
    }
    .msg pre code {
      background: transparent;
      padding: 0;
      color: #e4e4e7;
    }
    .plan-card {
      background: linear-gradient(180deg, rgba(37, 99, 235, 0.08), rgba(28, 28, 33, 0.95));
      border: 1px solid rgba(59, 130, 246, 0.4);
      border-radius: 10px;
      padding: 13px;
    }
    .plan-card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 10px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--border);
    }
    .plan-card-title {
      font-weight: 700;
      font-size: 13px;
      color: #93c5fd;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .plan-actions {
      margin-top: 12px;
      padding-top: 10px;
      border-top: 1px solid var(--border);
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
    }
    .btn-proceed {
      padding: 7px 14px;
      background: var(--success);
      color: #fff;
      border: none;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
    }
    .btn-proceed:hover { background: var(--success-hover); }
    .btn-proceed:disabled { opacity: 0.65; cursor: default; }
    .btn-secondary {
      padding: 6px 11px;
      background: var(--surface-elevated);
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 6px;
      font-size: 11.5px;
      cursor: pointer;
    }
    .btn-secondary:hover { background: var(--surface-hover); }
    .revise-box {
      margin-top: 8px;
      display: none;
      gap: 6px;
      width: 100%;
    }
    .revise-box input {
      flex: 1;
      padding: 6px 9px;
      border-radius: 5px;
      border: 1px solid var(--border);
      background: var(--bg);
      color: #fff;
      font-size: 12px;
    }
    .action-pill {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 7px;
      padding: 6px 10px;
      font-size: 11.5px;
      color: var(--text-muted);
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
      min-height: 62px;
      max-height: 160px;
      padding: 9px 11px;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: var(--bg);
      color: #fff;
      font-family: inherit;
      font-size: 12.5px;
      resize: vertical;
      outline: none;
      line-height: 1.45;
    }
    #prompt-input:focus {
      border-color: #3b82f6;
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
      gap: 5px;
      cursor: pointer;
      user-select: none;
    }
    #send-btn {
      padding: 6px 16px;
      background: var(--accent);
      color: #fff;
      border: none;
      border-radius: 6px;
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
    <div class="header-left">
      <span class="status-dot"></span>
      <span class="header-title">NIRMAN</span>
      <span class="folder-pill" id="folder-pill" title="Chat history is saved per workspace folder">📁 Workspace</span>
    </div>
    <div class="header-right">
      <span class="model-badge">Qwen2.5 7B • GPU</span>
      <button type="button" class="icon-btn" id="new-chat-btn" title="Start a fresh conversation for this folder">+ New</button>
    </div>
  </div>

  <div id="chat-log">
    <div id="empty-state">
      <div class="hero-logo">N</div>
      <h3>How can I help you build today?</h3>
      <p>Ask questions or describe a feature. NIRMAN explains its implementation plan first, writes code, and saves chat history for this folder.</p>
      <div class="chips">
        <button type="button" class="chip" data-prompt="Build a modern personal portfolio website with dark mode and a contact form">✨ Build a personal portfolio website</button>
        <button type="button" class="chip" data-prompt="Create a scientific calculator in Python with unit tests">🧮 Create a Python scientific calculator</button>
        <button type="button" class="chip" data-prompt="Explain the current project structure and how to run it">💡 Explain this workspace & how to run it</button>
      </div>
    </div>
  </div>

  <div class="composer">
    <form id="prompt-form">
      <textarea id="prompt-input" placeholder="Ask anything or describe what to build... (Enter to send, Shift+Enter for new line)" required></textarea>
      <div class="composer-footer">
        <label class="fast-toggle">
          <input type="checkbox" id="skip-plan" />
          <span>Auto-proceed (skip plan approval)</span>
        </label>
        <button type="submit" id="send-btn">Send ⏎</button>
      </div>
    </form>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const chatLog = document.getElementById('chat-log');
    const emptyState = document.getElementById('empty-state');
    const folderPill = document.getElementById('folder-pill');
    const newChatBtn = document.getElementById('new-chat-btn');
    const form = document.getElementById('prompt-form');
    const input = document.getElementById('prompt-input');
    const skipPlanInput = document.getElementById('skip-plan');

    function escapeHtml(str) {
      return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }

    function renderMarkdown(md) {
      let html = escapeHtml(md);
      // Fenced code blocks
      html = html.replace(/\`\`\`([a-zA-Z0-9_-]*)\\n([\\s\\S]*?)\`\`\`/g, '<pre><code>$2</code></pre>');
      // Headings
      html = html.replace(/^####\\s+(.+)$/gm, '<h4>$1</h4>');
      html = html.replace(/^###\\s+(.+)$/gm, '<h3>$1</h3>');
      html = html.replace(/^##\\s+(.+)$/gm, '<h3>$1</h3>');
      html = html.replace(/^#\\s+(.+)$/gm, '<h3>$1</h3>');
      // Bold
      html = html.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
      // Inline code
      html = html.replace(/\`([^\`\\n]+)\`/g, '<code>$1</code>');
      // Bullet lists
      html = html.replace(/^\\s*[-*]\\s+(.+)$/gm, '<li>$1</li>');
      // Line breaks
      html = html.replace(/\\n\\n/g, '<br/><br/>');
      html = html.replace(/\\n/g, '<br/>');
      return html;
    }

    function appendMessageToDom(message) {
      if (emptyState && emptyState.parentNode) {
        emptyState.remove();
      }

      const content = String(message.content || '');
      const wrapper = document.createElement('div');
      wrapper.className = 'msg-wrapper ' + message.sender;

      // Implementation Plan Card
      if (content.includes('Execution plan created')) {
        const card = document.createElement('div');
        card.className = 'msg system plan-card';

        const header = document.createElement('div');
        header.className = 'plan-card-header';
        header.innerHTML = '<div class="plan-card-title">📋 Implementation Plan</div><span style="font-size:10px;color:#9ca3af;">Awaiting Approval</span>';
        card.appendChild(header);

        const body = document.createElement('div');
        const cleanedPlan = content.replace(/^📋 Execution plan created[^\\n]*\\n*/, '');
        body.innerHTML = renderMarkdown(cleanedPlan);
        card.appendChild(body);

        const actions = document.createElement('div');
        actions.className = 'plan-actions';

        const approveBtn = document.createElement('button');
        approveBtn.className = 'btn-proceed';
        approveBtn.textContent = '✔ Proceed & Execute';
        approveBtn.onclick = () => {
          approveBtn.disabled = true;
          approveBtn.textContent = '✔ Approved — Executing...';
          vscode.postMessage({ type: 'approve_active_plan' });
        };

        const openPlanBtn = document.createElement('button');
        openPlanBtn.className = 'btn-secondary';
        openPlanBtn.textContent = '📄 Open PLAN.md';
        openPlanBtn.onclick = () => {
          vscode.postMessage({ type: 'open_file', filePath: 'PLAN.md' });
        };

        const reviseToggleBtn = document.createElement('button');
        reviseToggleBtn.className = 'btn-secondary';
        reviseToggleBtn.textContent = '✏️ Request Changes';

        const reviseBox = document.createElement('div');
        reviseBox.className = 'revise-box';
        const reviseInput = document.createElement('input');
        reviseInput.type = 'text';
        reviseInput.placeholder = 'Tell NIRMAN how to adjust the plan...';
        const reviseSend = document.createElement('button');
        reviseSend.className = 'btn-secondary';
        reviseSend.textContent = 'Update Plan';
        reviseSend.onclick = () => {
          const fb = reviseInput.value.trim();
          if (!fb) return;
          vscode.postMessage({ type: 'revise_active_plan', feedback: fb });
          reviseInput.value = '';
          reviseBox.style.display = 'none';
        };
        reviseBox.appendChild(reviseInput);
        reviseBox.appendChild(reviseSend);

        reviseToggleBtn.onclick = () => {
          reviseBox.style.display = reviseBox.style.display === 'flex' ? 'none' : 'flex';
          reviseInput.focus();
        };

        actions.appendChild(approveBtn);
        actions.appendChild(openPlanBtn);
        actions.appendChild(reviseToggleBtn);
        card.appendChild(actions);
        card.appendChild(reviseBox);

        wrapper.appendChild(card);
        chatLog.appendChild(wrapper);
        chatLog.scrollTop = chatLog.scrollHeight;
        return;
      }

      // Compact Action Pill for tool calls / file updates
      if (message.sender === 'system' && (content.startsWith('🛠') || content.startsWith('📄'))) {
        const pill = document.createElement('div');
        pill.className = 'action-pill';
        const span = document.createElement('span');
        span.textContent = content;
        pill.appendChild(span);

        const fileMatch = content.match(/\\(([^)]+)\\)/);
        if (fileMatch && fileMatch[1]) {
          const openBtn = document.createElement('button');
          openBtn.className = 'btn-secondary';
          openBtn.style.padding = '2px 8px';
          openBtn.style.fontSize = '10.5px';
          openBtn.textContent = 'Open';
          openBtn.onclick = () => {
            vscode.postMessage({ type: 'open_file', filePath: fileMatch[1] });
          };
          pill.appendChild(openBtn);
        }

        wrapper.appendChild(pill);
        chatLog.appendChild(wrapper);
        chatLog.scrollTop = chatLog.scrollHeight;
        return;
      }

      const div = document.createElement('div');
      div.className = 'msg ' + message.sender;
      if (message.sender === 'user') {
        div.textContent = content;
      } else {
        div.innerHTML = renderMarkdown(content);
      }

      wrapper.appendChild(div);
      if (message.timestamp) {
        const meta = document.createElement('div');
        meta.className = 'msg-meta';
        meta.textContent = (message.sender === 'user' ? 'You • ' : 'NIRMAN • ') + message.timestamp;
        wrapper.appendChild(meta);
      }

      chatLog.appendChild(wrapper);
      chatLog.scrollTop = chatLog.scrollHeight;
    }

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

    newChatBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'clear_chat' });
    });

    document.querySelectorAll('.chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        input.value = btn.getAttribute('data-prompt') || '';
        input.focus();
      });
    });

    window.addEventListener('message', (event) => {
      const data = event.data;
      if (!data) return;

      if (data.type === 'folder_changed') {
        folderPill.textContent = '📁 ' + (data.folderName || 'Workspace');
      } else if (data.type === 'reset_messages') {
        if (data.folderName) {
          folderPill.textContent = '📁 ' + data.folderName;
        }
        chatLog.innerHTML = '';
        const list = Array.isArray(data.messages) ? data.messages : [];
        if (list.length === 0) {
          chatLog.appendChild(emptyState);
        } else {
          list.forEach((m) => appendMessageToDom(m));
        }
      } else if (data.type === 'chat_message' && data.message) {
        appendMessageToDom(data.message);
      }
    });
  </script>
</body>
</html>`;
  }
}
