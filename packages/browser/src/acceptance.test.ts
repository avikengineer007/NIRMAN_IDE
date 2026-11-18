import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DevServerManager } from './server-manager.js';
import { BrowserVerifier } from './verifier.js';
import { BrowserDriver } from './browser-driver.js';
import type { BrowserChecklistItem, BrowserVerificationReport } from './types.js';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';

describe('Step 8 Acceptance: End-to-End Sample Web App Verification with Playwright', () => {
  let workspaceDir: string;
  let runDir: string;
  let screenshotsDir: string;
  let serverManager: DevServerManager;
  let verifier: BrowserVerifier;
  let driver: BrowserDriver;
  const port = 4567;
  const webAppUrl = `http://127.0.0.1:${port}`;
  const runId = 'run-acceptance-web-app';

  beforeAll(async () => {
    // 1. Create temporary workspace and run directory
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nirman-sample-webapp-'));
    runDir = path.join(workspaceDir, '.agent', 'runs', runId);
    screenshotsDir = path.join(runDir, 'screenshots');
    await fs.mkdir(screenshotsDir, { recursive: true });

    // 2. Build the sample web application files
    const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>NIRMAN Task Manager</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <div class="container">
    <h1>NIRMAN Task Manager</h1>
    <div class="input-row">
      <input id="todo-input" type="text" placeholder="Add a new task..." />
      <button id="add-btn">Add Task</button>
    </div>
    <ul id="todo-list"></ul>
    <div id="task-stats"><span id="task-count">0</span> items total</div>
  </div>
  <script src="app.js"></script>
</body>
</html>`;

    const cssContent = `body { font-family: sans-serif; margin: 2rem; background: #f4f4f9; }
.container { max-width: 500px; margin: 0 auto; background: white; padding: 1.5rem; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
h1 { color: #333; font-size: 1.5rem; }
.input-row { display: flex; gap: 8px; margin-bottom: 1rem; }
input[type="text"] { flex: 1; padding: 8px; border: 1px solid #ccc; border-radius: 4px; }
button { padding: 8px 16px; background: #2563eb; color: white; border: none; border-radius: 4px; cursor: pointer; }
ul { list-style: none; padding: 0; }
li { display: flex; align-items: center; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee; }
li.completed span { text-decoration: line-through; color: #888; }
#task-stats { margin-top: 1rem; font-size: 0.9rem; color: #666; }`;

    const jsContent = `document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('todo-input');
  const addBtn = document.getElementById('add-btn');
  const list = document.getElementById('todo-list');
  const countSpan = document.getElementById('task-count');
  let tasks = [];

  function update() {
    list.innerHTML = '';
    tasks.forEach((t, i) => {
      const li = document.createElement('li');
      if (t.completed) li.className = 'completed';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'toggle-checkbox';
      checkbox.checked = t.completed;
      checkbox.addEventListener('change', () => {
        t.completed = checkbox.checked;
        update();
      });

      const span = document.createElement('span');
      span.textContent = t.text;

      const delBtn = document.createElement('button');
      delBtn.textContent = 'Delete';
      delBtn.className = 'delete-btn';
      delBtn.addEventListener('click', () => {
        tasks.splice(i, 1);
        update();
      });

      li.appendChild(checkbox);
      li.appendChild(span);
      li.appendChild(delBtn);
      list.appendChild(li);
    });
    countSpan.textContent = tasks.length;
  }

  addBtn.addEventListener('click', () => {
    const val = input.value.trim();
    if (val) {
      tasks.push({ text: val, completed: false });
      input.value = '';
      update();
    }
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addBtn.click();
  });
});`;

    const serverScript = `const http = require('http');
const fs = require('fs');
const path = require('path');

const server = http.createServer((req, res) => {
  if (req.url === '/favicon.ico') {
    res.writeHead(204);
    res.end();
    return;
  }

  let file = req.url === '/' ? 'index.html' : req.url.substring(1);
  const filePath = path.join(__dirname, file);

  let ext = path.extname(filePath);
  let contentType = 'text/html';
  if (ext === '.js') contentType = 'text/javascript';
  if (ext === '.css') contentType = 'text/css';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    }
  });
});

server.listen(${port}, '127.0.0.1');`;

    const specContent = `# Sample Web App SPEC
Architecture: Single Page Application
Dev Server: node server.js
URL: ${webAppUrl}
`;

    await fs.writeFile(path.join(workspaceDir, 'index.html'), htmlContent, 'utf-8');
    await fs.writeFile(path.join(workspaceDir, 'style.css'), cssContent, 'utf-8');
    await fs.writeFile(path.join(workspaceDir, 'app.js'), jsContent, 'utf-8');
    await fs.writeFile(path.join(workspaceDir, 'server.js'), serverScript, 'utf-8');
    await fs.writeFile(path.join(workspaceDir, 'SPEC.md'), specContent, 'utf-8');

    // 3. Start dev server and wait for readiness
    const serverConfig = DevServerManager.extractServerConfig(specContent);
    expect(serverConfig).not.toBeNull();

    serverManager = new DevServerManager();
    await serverManager.startServer({
      command: serverConfig!.command,
      cwd: workspaceDir,
      url: serverConfig!.url,
      timeoutMs: 15_000,
    });

    expect(serverManager.isRunning).toBe(true);

    driver = new BrowserDriver({ headless: true });
    verifier = new BrowserVerifier(driver);
  });

  afterAll(async () => {
    if (verifier) {
      await verifier.close();
    }
    if (serverManager) {
      await serverManager.stopServer();
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
    try {
      await fs.rm(workspaceDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // ignore cleanup lock on windows
    }
  });

  it('drives the browser through 3 distinct behaviors and saves screenshots to the run folder', async () => {
    // 3 distinct user behaviors derived from plan / web app spec:
    // Behavior 1: Initial load, layout rendering, and input readiness
    // Behavior 2: Adding a new task item and asserting list updates
    // Behavior 3: Toggling completion state and asserting styling updates
    const checklist: BrowserChecklistItem[] = [
      {
        id: 'behavior-1-initial-render',
        description: 'Verify page loads with NIRMAN Task Manager title, input field, and add button',
        actions: [
          { type: 'open', url: webAppUrl },
          { type: 'assert_element', selector: 'h1' },
          { type: 'assert_element', selector: '#todo-input' },
          { type: 'assert_element', selector: '#add-btn' },
          { type: 'screenshot', screenshotName: '1-initial-render.png' },
        ],
      },
      {
        id: 'behavior-2-add-todo-item',
        description: 'Verify user can type a task, click Add Task, and item appears in list',
        actions: [
          {
            type: 'type',
            selector: '#todo-input',
            text: 'Verify Playwright automated browser tests',
          },
          {
            type: 'click',
            selector: '#add-btn',
          },
          {
            type: 'assert_text',
            text: 'Verify Playwright automated browser tests',
          },
          { type: 'screenshot', screenshotName: '2-item-added.png' },
        ],
      },
      {
        id: 'behavior-3-toggle-completion',
        description: 'Verify user can click task checkbox and mark item as completed',
        actions: [
          {
            type: 'click',
            selector: '.toggle-checkbox',
          },
          {
            type: 'assert_element',
            selector: 'li.completed',
          },
          { type: 'screenshot', screenshotName: '3-task-completed.png' },
        ],
      },
    ];

    const reportPath = path.join(runDir, 'browser-verification.md');
    const report = await verifier.executeChecklist(checklist, {
      runId,
      screenshotsDir,
      reportPath,
      url: webAppUrl,
    });

    // 1. All 3 behaviors passed
    expect(report.totalItems).toBe(3);
    expect(report.passedItems).toBe(3);
    expect(report.failedItems).toBe(0);
    expect(report.consoleErrors).toHaveLength(0);
    expect(report.failedRequests).toHaveLength(0);

    // 2. Screenshots exist in the run folder with valid non-empty file size
    const shot1 = path.join(screenshotsDir, '1-initial-render.png');
    const shot2 = path.join(screenshotsDir, '2-item-added.png');
    const shot3 = path.join(screenshotsDir, '3-task-completed.png');

    const [stat1, stat2, stat3] = await Promise.all([
      fs.stat(shot1),
      fs.stat(shot2),
      fs.stat(shot3),
    ]);

    expect(stat1.size).toBeGreaterThan(1000);
    expect(stat2.size).toBeGreaterThan(1000);
    expect(stat3.size).toBeGreaterThan(1000);

    // 3. Artifact report files exist
    const mdReport = await fs.readFile(reportPath, 'utf-8');
    expect(mdReport).toContain('# Browser Verification Report');
    expect(mdReport).toContain('PASSED (3/3 checks passed)');
    expect(mdReport).toContain('1-initial-render.png');
    expect(mdReport).toContain('2-item-added.png');
    expect(mdReport).toContain('3-task-completed.png');

    const jsonReport = JSON.parse(
      await fs.readFile(path.join(runDir, 'browser-verification.json'), 'utf-8'),
    ) as BrowserVerificationReport;
    expect(jsonReport.passedItems).toBe(3);
  });

  it('routes failures and diagnostic errors back when an assertion fails', async () => {
    const failingChecklist: BrowserChecklistItem[] = [
      {
        id: 'failing-behavior',
        description: 'Expects non-existent element to fail gracefully',
        actions: [
          {
            type: 'assert_element',
            selector: '#non-existent-button-xyz',
          },
        ],
      },
    ];

    const failReport = await verifier.executeChecklist(failingChecklist, {
      runId: 'fail-test-run',
      screenshotsDir,
      url: webAppUrl,
    });

    expect(failReport.failedItems).toBe(1);
    expect(failReport.items[0]?.status).toBe('failed');
    expect(failReport.items[0]?.error).toContain(
      'Expected element matching "#non-existent-button-xyz" was not visible',
    );

    // Verification took a failure screenshot
    expect(failReport.items[0]?.screenshotPath).toBeDefined();
    const failStat = await fs.stat(failReport.items[0]!.screenshotPath!);
    expect(failStat.size).toBeGreaterThan(1000);
  });
});
