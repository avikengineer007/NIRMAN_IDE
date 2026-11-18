import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { NirmanDaemon, RunManager } from '@nirman/server';
import { MockModelClient } from '@nirman/model';
import { ExtensionController } from './extension-controller.js';
import { MockVSCodeAPI, MockWebviewView } from './vscode-api.js';

describe('Step 11 Acceptance: VS Code Extension with Chat, Plan, Tasks, Native Diff, Artifacts, Screenshots & Status Bar', () => {
  let tempRepo: string;
  let tempWorktreesDir: string;
  let daemon: NirmanDaemon;
  let mockVsCode: MockVSCodeAPI;
  let controller: ExtensionController;

  let chatWebview: MockWebviewView;
  let planWebview: MockWebviewView;
  let tasksWebview: MockWebviewView;
  let artifactsWebview: MockWebviewView;

  beforeAll(async () => {
    // 1. Setup temporary workspace repository
    tempRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'nirman-vscode-repo-'));
    tempWorktreesDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nirman-vscode-wts-'));

    await fs.writeFile(
      path.join(tempRepo, 'package.json'),
      '{"name": "vscode-sample-app", "version": "1.0.0", "scripts": {"test": "node app.js"}}',
      'utf-8',
    );
    await fs.writeFile(path.join(tempRepo, 'index.html'), '<h1>Initial Skeleton</h1>', 'utf-8');

    // 2. Start NirmanDaemon with MockModelClient for the project lifecycle
    const runManager = new RunManager({
      baseWorktreesDir: tempWorktreesDir,
      modelClientFactory: () =>
        new MockModelClient([
          // Step 1: Clarification check (no questions needed)
          {
            response: '{"questions": []}',
          },
          // Step 2: Plan and Spec generation
          {
            response: `=== PLAN.MD ===
# Execution Plan for Task Manager
### Step 1: Implement web application
Create index.html and app.js with task manager features.

=== SPEC.MD ===
# Project Spec
- Stack: HTML5, JavaScript
- Commands:
  - Run: node app.js
  - Test: node app.js
`,
          },
          // Step 3: Tool execution - create app.js
          {
            response: {
              content: 'Writing app.js for task manager',
              toolCalls: [
                {
                  id: 'call_app',
                  type: 'function',
                  function: {
                    name: 'write_file',
                    arguments: JSON.stringify({
                      path: 'app.js',
                      content: 'console.log("NIRMAN Task Manager loaded successfully");\n',
                    }),
                  },
                },
              ],
            },
          },
          // Step 4: Finish task
          {
            response: 'Web application implemented and ready.',
          },
        ]),
    });

    daemon = new NirmanDaemon(
      {
        host: '127.0.0.1',
        port: 0,
        baseWorktreesDir: tempWorktreesDir,
      },
      runManager,
    );

    await daemon.start();

    // 3. Initialize Mock VS Code Environment
    mockVsCode = new MockVSCodeAPI();
    mockVsCode.workspaceFolders.push({
      uri: mockVsCode.Uri.file(tempRepo),
    });

    // 4. Instantiate and activate ExtensionController
    controller = new ExtensionController({
      vscode: mockVsCode,
      config: {
        serverUrl: daemon.getUrl(),
        serverToken: daemon.getToken(),
        model: 'qwen2.5-coder:7b',
        contextWindowLimit: 32_768,
      },
    });

    await controller.activate();

    // 5. Mount mock webviews for the views
    chatWebview = new MockWebviewView();
    planWebview = new MockWebviewView();
    tasksWebview = new MockWebviewView();
    artifactsWebview = new MockWebviewView();

    controller.chatView.resolveWebviewView(chatWebview);
    controller.planView.resolveWebviewView(planWebview);
    controller.tasksView.resolveWebviewView(tasksWebview);
    controller.artifactsView.resolveWebviewView(artifactsWebview);
  });

  afterAll(async () => {
    controller.deactivate();
    await daemon.close();

    try {
      await fs.rm(tempRepo, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      await fs.rm(tempWorktreesDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch {
      // ignore
    }
  });

  it('describes a small project, approves plan, watches files appear, reviews diffs, checks approval prompts, and views browser screenshots', async () => {
    // =========================================================================
    // 1. From inside VS Code: User describes a small project in the Chat Panel
    // =========================================================================
    const runId = await controller.startRun('Build a small static task manager web app', false);

    expect(runId).toBeDefined();
    expect(controller.getActiveRun()).not.toBeNull();
    expect(controller.statusBar.getText()).toContain('qwen2.5-coder:7b');

    // Verify chat received user message
    const chatMsgs = controller.chatView.getMessages();
    expect(chatMsgs.some((m) => m.content.includes('Build a small static task manager'))).toBe(true);

    // =========================================================================
    // 2. Plan View: Wait for plan generation and click Approve Button
    // =========================================================================
    const maxWaitMs = 10_000;
    const planWaitStart = Date.now();
    let planApproved = false;

    while (Date.now() - planWaitStart < maxWaitMs) {
      const activeRun = controller.getActiveRun();
      if (activeRun) {
        const daemonRun = daemon.getRunManager().getRun(runId);
        if (daemonRun?.status === 'waiting_approval') {
          // Verify plan view has tasks
          expect(daemonRun.tasks?.length).toBeGreaterThan(0);

          // User clicks "Approve Plan" in the Plan View
          await controller.approvePlan(runId);
          planApproved = true;
          break;
        }
      }
      await new Promise((r) => setTimeout(r, 100));
    }

    expect(planApproved).toBe(true);

    // =========================================================================
    // 3. Watch files appear and tasks transition live
    // =========================================================================
    const execWaitStart = Date.now();
    let runCompleted = false;

    while (Date.now() - execWaitStart < maxWaitMs) {
      const daemonRun = daemon.getRunManager().getRun(runId);
      if (daemonRun?.status === 'completed') {
        runCompleted = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }

    expect(runCompleted).toBe(true);

    const activeRun = controller.getActiveRun();
    expect(activeRun).not.toBeNull();

    // Verify app.js appeared in the worktree
    const appJsPath = path.join(activeRun!.worktreePath, 'app.js');
    const appJsStat = await fs.stat(appJsPath);
    expect(appJsStat.isFile()).toBe(true);

    const appJsContent = await fs.readFile(appJsPath, 'utf-8');
    expect(appJsContent).toContain('NIRMAN Task Manager loaded successfully');

    // =========================================================================
    // 4. Diff Review: Open VS Code Native Diff Editor
    // =========================================================================
    await controller.reviewDiff('app.js');

    const diffCommandCalls = mockVsCode.executedCommands.filter((c) => c.command === 'vscode.diff');
    expect(diffCommandCalls.length).toBeGreaterThan(0);

    const lastDiffCall = diffCommandCalls[diffCommandCalls.length - 1]!;
    expect(lastDiffCall.args[0]).toBeDefined(); // left URI
    expect(lastDiffCall.args[1]).toBeDefined(); // right URI
    expect(lastDiffCall.args[2]).toContain('app.js'); // title

    // =========================================================================
    // 5. Risky Action Approval Prompt
    // =========================================================================
    mockVsCode.defaultPromptResponse = 'Approve';
    const approved = await controller.promptRiskyActionApproval(
      runId,
      'act-install-1',
      'run_shell (npm install)',
      'Requires network access to install external dependencies',
    );

    expect(approved).toBe(true);
    expect(mockVsCode.messagesShown.some((m) => m.type === 'warn' && m.message.includes('npm install'))).toBe(true);

    // =========================================================================
    // 6. Artifacts View & Browser-Verification Screenshots
    // =========================================================================
    // Seed mock browser-verification screenshot into run artifacts directory
    const runArtifactsDir = path.join(activeRun!.worktreePath, '.agent', 'runs', runId);
    const screenshotsDir = path.join(runArtifactsDir, 'screenshots');
    await fs.mkdir(screenshotsDir, { recursive: true });

    const screenshotPath = path.join(screenshotsDir, 'browser-verify-1.png');
    await fs.writeFile(screenshotPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])); // PNG header

    // Refresh artifacts in controller
    const artifactsList = await daemon.getRunManager().listArtifacts(runId);
    controller.artifactsView.setArtifacts(runId, artifactsList);

    const listedArtifacts = controller.artifactsView.getArtifacts();
    expect(listedArtifacts.some((a) => a.relativePath.includes('browser-verify-1.png'))).toBe(true);
    expect(listedArtifacts.some((a) => a.relativePath === 'tasks.json')).toBe(true);

    // Open the browser-verification screenshot in VS Code image viewer
    await controller.openArtifact(runId, 'screenshots/browser-verify-1.png');
    expect(
      mockVsCode.executedCommands.some(
        (c) => c.command === 'vscode.open' && (c.args[0] as { fsPath: string }).fsPath.includes('browser-verify-1.png'),
      ),
    ).toBe(true);

    // Open walkthrough.md in VS Code markdown preview
    await controller.openArtifact(runId, 'walkthrough.md');
    expect(
      mockVsCode.executedCommands.some(
        (c) => c.command === 'markdown.showPreview' && (c.args[0] as { fsPath: string }).fsPath.includes('walkthrough.md'),
      ),
    ).toBe(true);

    // =========================================================================
    // 7. Status Bar item shows model and context tokens
    // =========================================================================
    expect(controller.statusBar.getText()).toContain('qwen2.5-coder:7b');
    expect(controller.statusBar.getTooltip()).toContain('NIRMAN Coding Agent');
    expect(controller.statusBar.getTooltip()).toContain(runId);
  }, 25_000);
});
