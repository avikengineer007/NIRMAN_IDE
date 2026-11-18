import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { NirmanDaemon, RunManager } from '@nirman/server';
import { MockModelClient } from '@nirman/model';
import { ExtensionController } from './extension-controller.js';
import { MockVSCodeAPI, MockWebviewPanel } from './vscode-api.js';

describe('Step 12 Acceptance: Agent Manager View with Parallel Runs, Controls & Artifact Comments', () => {
  let tempRepo1: string;
  let tempRepo2: string;
  let tempRepo3: string;
  let tempWorktreesDir: string;
  let daemon: NirmanDaemon;
  let mockVsCode: MockVSCodeAPI;
  let controller: ExtensionController;
  let managerPanel: MockWebviewPanel;

  beforeAll(async () => {
    // 1. Setup temporary workspace repositories for 3 distinct projects
    tempRepo1 = await fs.mkdtemp(path.join(os.tmpdir(), 'nirman-mgr-repo1-'));
    tempRepo2 = await fs.mkdtemp(path.join(os.tmpdir(), 'nirman-mgr-repo2-'));
    tempRepo3 = await fs.mkdtemp(path.join(os.tmpdir(), 'nirman-mgr-repo3-'));
    tempWorktreesDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nirman-mgr-wts-'));

    await fs.writeFile(
      path.join(tempRepo1, 'package.json'),
      '{"name": "csv-parser-cli", "version": "1.0.0"}',
      'utf-8',
    );
    await fs.writeFile(
      path.join(tempRepo2, 'package.json'),
      '{"name": "rest-api-service", "version": "1.0.0"}',
      'utf-8',
    );
    await fs.writeFile(
      path.join(tempRepo3, 'package.json'),
      '{"name": "web-dashboard-app", "version": "1.0.0"}',
      'utf-8',
    );
    await fs.writeFile(
      path.join(tempRepo3, 'index.html'),
      '<!DOCTYPE html><html><body><h1>Dashboard</h1></body></html>',
      'utf-8',
    );

    // 2. Start NirmanDaemon with MockModelClient for multi-agent execution
    const runManager = new RunManager({
      baseWorktreesDir: tempWorktreesDir,
      modelClientFactory: () =>
        new MockModelClient([
          // Step 1: Clarification check
          { response: '{"questions": []}' },
          // Step 2: Planning phase
          {
            response: `=== PLAN.MD ===
# Execution Plan
### Step 1: Initialize component
Implement application component.

=== SPEC.MD ===
# Spec
- Stack: TypeScript
- Commands:
  - Run: echo "Running"
  - Test: echo "Testing"
`,
          },
          // Step 3: Tool execution - create entry file
          {
            response: {
              content: 'Generating component file',
              toolCalls: [
                {
                  id: 'call_entry',
                  type: 'function',
                  function: {
                    name: 'write_file',
                    arguments: JSON.stringify({
                      path: 'index.js',
                      content: 'console.log("Component online");\n',
                    }),
                  },
                },
              ],
            },
          },
          // Step 4: Complete task
          { response: 'Component complete and verified.' },
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
    mockVsCode.workspaceFolders.push(
      { uri: mockVsCode.Uri.file(tempRepo1) },
      { uri: mockVsCode.Uri.file(tempRepo2) },
      { uri: mockVsCode.Uri.file(tempRepo3) },
    );

    // 4. Initialize ExtensionController
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

    // 5. Open Agent Manager Panel
    managerPanel = new MockWebviewPanel('NIRMAN: Agent Manager');
    controller.agentManager.setWebviewPanel(managerPanel);
  });

  afterAll(async () => {
    controller.deactivate();
    await daemon.close();

    try {
      await fs.rm(tempRepo1, { recursive: true, force: true });
      await fs.rm(tempRepo2, { recursive: true, force: true });
      await fs.rm(tempRepo3, { recursive: true, force: true });
      await fs.rm(tempWorktreesDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('three agents running in parallel are visible and controllable from one screen', async () => {
    // =========================================================================
    // 1. Start 3 agents in parallel across workspaces
    // =========================================================================
    const runId1 = await controller.startRun('Build CSV Parser CLI tool', true, tempRepo1);
    const runId2 = await controller.startRun('Build REST API microservice', true, tempRepo2);
    const runId3 = await controller.startRun('Build Interactive Web Dashboard', true, tempRepo3);

    expect(runId1).toBeDefined();
    expect(runId2).toBeDefined();
    expect(runId3).toBeDefined();
    expect(runId1).not.toBe(runId2);
    expect(runId2).not.toBe(runId3);

    // Refresh manager state
    const allRuns = await controller.refreshRuns();
    expect(allRuns.length).toBeGreaterThanOrEqual(3);

    // =========================================================================
    // 2. Acceptance: All 3 agents are visible simultaneously on ONE screen
    // =========================================================================
    const html = controller.agentManager.getHtml();

    // Check Run 1
    expect(html).toContain(runId1);
    expect(html).toContain('Build CSV Parser CLI tool');

    // Check Run 2
    expect(html).toContain(runId2);
    expect(html).toContain('Build REST API microservice');

    // Check Run 3
    expect(html).toContain(runId3);
    expect(html).toContain('Build Interactive Web Dashboard');

    // =========================================================================
    // 3. Acceptance: Pause Agent 1, then Resume Agent 1 from the Manager screen
    // =========================================================================
    // Simulate clicking "Pause" on Agent 1 in the Agent Manager UI
    managerPanel.simulateWebviewMessage({
      type: 'pause_agent',
      runId: runId1,
    });
    // Allow pause to process
    await new Promise((r) => setTimeout(r, 200));

    let updatedRuns = await controller.refreshRuns();
    const run1Paused = updatedRuns.find((r) => r.runId === runId1);
    expect(run1Paused?.status).toBe('paused');

    let updatedHtml = controller.agentManager.getHtml();
    expect(updatedHtml).toContain(`id="run_${runId1}"`);
    expect(updatedHtml).toContain('badge-paused');

    // Now resume Agent 1 from the Manager screen
    managerPanel.simulateWebviewMessage({
      type: 'resume_agent',
      runId: runId1,
    });
    await new Promise((r) => setTimeout(r, 200));

    updatedRuns = await controller.refreshRuns();
    const run1Resumed = updatedRuns.find((r) => r.runId === runId1);
    expect(run1Resumed?.status).toBe('running');

    // =========================================================================
    // 4. Acceptance: Cancel Agent 2 from the Manager screen
    // =========================================================================
    managerPanel.simulateWebviewMessage({
      type: 'cancel_agent',
      runId: runId2,
    });
    await new Promise((r) => setTimeout(r, 200));

    updatedRuns = await controller.refreshRuns();
    const run2Cancelled = updatedRuns.find((r) => r.runId === runId2);
    expect(run2Cancelled?.status).toBe('cancelled');

    updatedHtml = controller.agentManager.getHtml();
    expect(updatedHtml).toContain('badge-cancelled');

    // =========================================================================
    // 5. Acceptance: Open Agent 3's artifacts and comment without stopping it
    // =========================================================================
    // Open artifact for Agent 3
    managerPanel.simulateWebviewMessage({
      type: 'open_run_artifact',
      runId: runId3,
      artifactName: 'tasks.json',
    });

    // Verify open command was triggered
    const openArtifactCalls = mockVsCode.executedCommands.filter(
      (c) => c.command === 'vscode.open' || c.command === 'markdown.showPreview',
    );
    expect(openArtifactCalls.length).toBeGreaterThan(0);

    // Comment on an artifact of Agent 3 (comments are fed back without stopping it)
    managerPanel.simulateWebviewMessage({
      type: 'comment_artifact',
      runId: runId3,
      artifactPath: 'index.html',
      feedback: 'Please ensure high contrast and accessible font sizes.',
    });
    await new Promise((r) => setTimeout(r, 200));

    updatedRuns = await controller.refreshRuns();
    const run3 = updatedRuns.find((r) => r.runId === runId3);
    // Agent 3 was NOT stopped (still running or completed, never cancelled or paused)
    expect(run3?.status).not.toBe('cancelled');
    expect(run3?.status).not.toBe('paused');

    // Comment appears in run record and HTML on screen
    expect(run3?.comments?.length).toBeGreaterThan(0);
    expect(run3?.comments?.[0]?.feedback).toContain('Please ensure high contrast');
    expect(run3?.comments?.[0]?.artifactPath).toBe('index.html');

    const htmlWithComment = controller.agentManager.getHtml();
    expect(htmlWithComment).toContain('Please ensure high contrast');
    expect(htmlWithComment).toContain('[index.html]');

    // =========================================================================
    // 6. Acceptance: Jump to editor on relevant files from the Manager screen
    // =========================================================================
    managerPanel.simulateWebviewMessage({
      type: 'jump_to_file',
      runId: runId3,
      filePath: 'index.html',
    });
    await new Promise((r) => setTimeout(r, 100));

    const fileOpenCalls = mockVsCode.executedCommands.filter(
      (c) =>
        c.command === 'vscode.open' &&
        typeof c.args[0] === 'object' &&
        (c.args[0] as { fsPath?: string })?.fsPath?.includes('index.html'),
    );
    expect(fileOpenCalls.length).toBeGreaterThan(0);

    // =========================================================================
    // 7. Acceptance: Keyboard shortcut switches between Editor and Manager
    // =========================================================================
    // When manager is active: toggle focuses the editor
    expect(controller.agentManager.isPanelActive()).toBe(true);
    await controller.toggleAgentManager();

    const editorFocusCalls = mockVsCode.executedCommands.filter(
      (c) => c.command === 'workbench.action.focusActiveEditorGroup',
    );
    expect(editorFocusCalls.length).toBeGreaterThan(0);

    // When manager was blurred/inactive: toggle reveals the manager
    await controller.toggleAgentManager();
    expect(controller.agentManager.isPanelActive()).toBe(true);
  }, 30_000);
});
