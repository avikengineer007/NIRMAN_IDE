import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { NirmanDaemon, RunManager } from '@nirman/server';
import { MockModelClient } from '@nirman/model';
import { MockVSCodeAPI, MockWebviewView, MockWebviewPanel } from '@nirman/vscode-ext';
import {
  IdeWorkbench,
  buildWindowsPackage,
} from './index.js';

describe('Step 13 Acceptance: Rebranded Code-OSS Fork with Open VSX, Built-in Agent & Windows Build', () => {
  let tempBaseDir: string;
  let tempRepo: string;
  let tempWorktreesDir: string;
  let daemon: NirmanDaemon;
  let mockVsCode: MockVSCodeAPI;
  let ide: IdeWorkbench;

  let chatWebview: MockWebviewView;
  let planWebview: MockWebviewView;
  let tasksWebview: MockWebviewView;
  let managerPanel: MockWebviewPanel;

  beforeAll(async () => {
    // 1. Setup isolated directories
    tempBaseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nirman-fork-acc-'));
    tempRepo = path.join(tempBaseDir, 'repo');
    tempWorktreesDir = path.join(tempBaseDir, 'worktrees');
    await fs.mkdir(tempRepo, { recursive: true });
    await fs.mkdir(tempWorktreesDir, { recursive: true });

    await fs.writeFile(
      path.join(tempRepo, 'package.json'),
      '{"name": "nirman-ide-sample", "version": "1.0.0"}',
      'utf-8',
    );
    await fs.writeFile(path.join(tempRepo, 'index.html'), '<h1>NIRMAN Studio</h1>', 'utf-8');

    // 2. Start Daemon Server with Mock Model
    const runManager = new RunManager({
      baseWorktreesDir: tempWorktreesDir,
      modelClientFactory: () =>
        new MockModelClient([
          // Step 1: Clarification check
          { response: '{"questions": []}' },
          // Step 2: Plan and Spec generation
          {
            response: `=== PLAN.MD ===
# Execution Plan for Greeting Service
### Step 1: Implement greeting module
Create greeting.js with greeting functions.

=== SPEC.MD ===
# Project Spec
- Stack: Node.js, JavaScript
- Commands:
  - Run: node greeting.js
  - Test: node greeting.js
`,
          },
          // Step 3: Tool execution - create greeting.js
          {
            response: {
              content: 'Writing greeting.js file',
              toolCalls: [
                {
                  id: 'call_greet',
                  type: 'function',
                  function: {
                    name: 'write_file',
                    arguments: JSON.stringify({
                      path: 'greeting.js',
                      content: 'console.log("Welcome to NIRMAN Studio!");\n',
                    }),
                  },
                },
              ],
            },
          },
          // Step 4: Finish task
          { response: 'Greeting module implementation complete.' },
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

    // 3. Initialize Mock VS Code API
    mockVsCode = new MockVSCodeAPI();
    mockVsCode.workspaceFolders.push({
      uri: mockVsCode.Uri.file(tempRepo),
    });

    // 4. Initialize Forked IDE Workbench
    ide = new IdeWorkbench({
      vscode: mockVsCode,
      dataDir: tempBaseDir,
      serverUrl: daemon.getUrl(),
      serverToken: daemon.getToken(),
    });
  });

  afterAll(async () => {
    ide.shutdown();
    await daemon.close();

    try {
      await fs.rm(tempBaseDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('forked app launches, looks like VS Code, runs full flow from Step 11 & 12, installs extensions from Open VSX, and produces Windows builds', async () => {
    // =========================================================================
    // 1. Launch the Forked App & Verify Rebranding / Open VSX Configuration
    // =========================================================================
    const launchResult = await ide.launch({
      provider: 'ollama',
      baseUrl: 'http://127.0.0.1:11434/v1',
      model: 'qwen2.5-coder:7b',
      contextWindowLimit: 32_768,
    });

    expect(ide.isLaunched()).toBe(true);
    expect(launchResult.isFirstRun).toBe(true);
    expect(launchResult.modelConfig.model).toBe('qwen2.5-coder:7b');

    // Verify rebranded product.json
    const product = launchResult.product;
    expect(product.nameShort).toBe('NIRMAN');
    expect(product.nameLong).toContain('NIRMAN');
    expect(product.dataFolderName).toBe('.nirman');
    expect(product.enableTelemetry).toBe(false);
    expect(product.telemetry).toBe('off');

    // Verify Open VSX extension gallery
    expect(product.extensionsGallery.serviceUrl).toContain('open-vsx.org');
    expect(ide.productManager.isOpenVsxGallery()).toBe(true);

    // =========================================================================
    // 2. Built-in Extension Bundling with Agent Manager as First-Class View
    // =========================================================================
    const builtinMetadata = ide.builtinManager.getMetadata();
    expect(builtinMetadata.isFirstClassView).toBe(true);
    expect(builtinMetadata.views).toContain('nirman.agentManagerView');

    const controller = ide.builtinManager.getController();
    expect(controller).toBeDefined();

    // Mount webviews
    chatWebview = new MockWebviewView();
    planWebview = new MockWebviewView();
    tasksWebview = new MockWebviewView();
    managerPanel = new MockWebviewPanel('NIRMAN: Agent Manager');

    controller!.chatView.resolveWebviewView(chatWebview);
    controller!.planView.resolveWebviewView(planWebview);
    controller!.tasksView.resolveWebviewView(tasksWebview);
    controller!.agentManager.setWebviewPanel(managerPanel);

    // =========================================================================
    // 3. Run Step 11 Flow: Describe, Plan, Approve, Diff, Status Bar
    // =========================================================================
    // Describe project
    const runId1 = await controller!.startRun('Implement greeting service', false);
    expect(runId1).toBeDefined();

    // Plan generated -> Approve plan
    await controller!.approvePlan(runId1);

    // Wait for execution
    await new Promise((r) => setTimeout(r, 600));

    // Verify diff review command is registered and works
    await controller!.reviewDiff('greeting.js');
    const diffCalls = mockVsCode.executedCommands.filter((c) => c.command === 'vscode.diff');
    expect(diffCalls.length).toBeGreaterThan(0);

    // Verify status bar
    expect(controller!.statusBar.getText().toLowerCase()).toContain('nirman');
    expect(controller!.statusBar.getText()).toContain('qwen2.5-coder:7b');

    // =========================================================================
    // 4. Run Step 12 Flow: Multi-Agent Manager Oversight, Controls & Comments
    // =========================================================================
    // Start second parallel agent
    const runId2 = await controller!.startRun('Build background sync worker', true);
    expect(runId2).toBeDefined();

    // Both agents visible simultaneously on the Manager screen
    const runs = await controller!.refreshRuns();
    expect(runs.length).toBeGreaterThanOrEqual(2);

    const managerHtml = controller!.agentManager.getHtml();
    expect(managerHtml).toContain(runId1);
    expect(managerHtml).toContain('Implement greeting service');
    expect(managerHtml).toContain(runId2);
    expect(managerHtml).toContain('Build background sync worker');

    // Pause and resume Agent 2 from Manager
    managerPanel.simulateWebviewMessage({ type: 'pause_agent', runId: runId2 });
    await new Promise((r) => setTimeout(r, 100));

    let updatedRuns = await controller!.refreshRuns();
    const pausedRun2 = updatedRuns.find((r) => r.runId === runId2);
    expect(pausedRun2?.status).toBe('paused');

    managerPanel.simulateWebviewMessage({ type: 'resume_agent', runId: runId2 });
    await new Promise((r) => setTimeout(r, 100));

    updatedRuns = await controller!.refreshRuns();
    const resumedRun2 = updatedRuns.find((r) => r.runId === runId2);
    expect(resumedRun2?.status).toBe('running');

    // Comment on artifact of Agent 1 without stopping it
    managerPanel.simulateWebviewMessage({
      type: 'comment_artifact',
      runId: runId1,
      artifactPath: 'greeting.js',
      feedback: 'Add support for localized greetings in Hindi and Spanish.',
    });
    await new Promise((r) => setTimeout(r, 100));

    updatedRuns = await controller!.refreshRuns();
    const run1 = updatedRuns.find((r) => r.runId === runId1);
    expect(run1?.comments?.length).toBeGreaterThan(0);
    expect(run1?.comments?.[0]?.feedback).toContain('localized greetings');

    // Jump to file in editor
    managerPanel.simulateWebviewMessage({
      type: 'jump_to_file',
      runId: runId1,
      filePath: 'greeting.js',
    });
    await new Promise((r) => setTimeout(r, 50));

    const openCalls = mockVsCode.executedCommands.filter(
      (c) =>
        c.command === 'vscode.open' &&
        typeof c.args[0] === 'object' &&
        (c.args[0] as { fsPath?: string })?.fsPath?.includes('greeting.js'),
    );
    expect(openCalls.length).toBeGreaterThan(0);

    // Keyboard shortcut to toggle between Editor and Manager
    await controller!.toggleAgentManager();
    const focusEditorCalls = mockVsCode.executedCommands.filter(
      (c) => c.command === 'workbench.action.focusActiveEditorGroup',
    );
    expect(focusEditorCalls.length).toBeGreaterThan(0);

    // =========================================================================
    // 5. Install Extensions from Open VSX
    // =========================================================================
    const installedExt = await ide.installFromOpenVsx('ms-python.python');
    expect(installedExt.id).toBe('ms-python.python');
    expect(installedExt.packageJson['publisher']).toBe('ms-python');

    const installedList = await ide.galleryClient.listInstalled(ide.getExtensionsDir());
    expect(installedList.some((e) => e.id === 'ms-python.python')).toBe(true);

    // =========================================================================
    // 6. Produce Windows Builds
    // =========================================================================
    const winBuildDir = path.join(tempBaseDir, 'dist', 'win32-x64');
    const buildResult = await buildWindowsPackage({
      outputDir: winBuildDir,
    });

    expect(buildResult.filesGenerated).toContain('nirman.exe');
    expect(buildResult.filesGenerated).toContain('nirman.cmd');
    expect(buildResult.filesGenerated).toContain('build-manifest.json');

    const manifestRaw = await fs.readFile(buildResult.manifestPath, 'utf-8');
    const manifest = JSON.parse(manifestRaw) as Record<string, unknown>;
    expect(manifest['platform']).toBe('win32-x64');
    expect(manifest['target']).toBe('Windows');
    expect(manifest['executable']).toBe('nirman.exe');
  }, 35_000);
});
