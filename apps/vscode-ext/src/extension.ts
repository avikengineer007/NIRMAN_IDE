import type { ExtensionContext } from 'vscode';
import { ExtensionController } from './extension-controller.js';
import type { IVSCodeAPI } from './vscode-api.js';

let controller: ExtensionController | null = null;

export async function activate(context: ExtensionContext, customApi?: IVSCodeAPI): Promise<ExtensionController> {
  const vscodeModule = customApi ?? (await import('vscode'));
  const vscode = vscodeModule as unknown as IVSCodeAPI;

  const serverUrl = process.env['NIRMAN_SERVER_URL'] ?? 'ws://127.0.0.1:4096';
  const serverToken = process.env['NIRMAN_SESSION_TOKEN'] ?? process.env['NIRMAN_TOKEN'] ?? 'default-token';
  const model = 'qwen2.5-coder:7b';
  const contextWindowLimit = 32_768;

  controller = new ExtensionController({
    vscode,
    config: {
      serverUrl,
      serverToken,
      model,
      contextWindowLimit,
    },
  });

  // Register webview view providers in sidebar when supported
  if (vscode.window && typeof (vscode.window as any).registerWebviewViewProvider === 'function') {
    const win = vscode.window as any;
    try {
      context.subscriptions.push(
        win.registerWebviewViewProvider('nirman.chat', controller.chatView),
        win.registerWebviewViewProvider('nirman.plan', controller.planView),
        win.registerWebviewViewProvider('nirman.tasks', controller.tasksView),
        win.registerWebviewViewProvider('nirman.artifacts', controller.artifactsView),
        win.registerWebviewViewProvider('nirman.agentManager', controller.agentManager),
      );
    } catch {}
  }

  // Connect controller to daemon (non-blocking)
  controller.activate().catch(() => {});

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('nirman.startRun', async () => {
      const task = await vscode.window.showInformationMessage('Describe project to NIRMAN:');
      if (task) {
        await controller?.startRun(task);
      }
    }),
    vscode.commands.registerCommand('nirman.approvePlan', async () => {
      const run = controller?.getActiveRun();
      if (run) {
        await controller?.approvePlan(run.runId);
      }
    }),
    vscode.commands.registerCommand('nirman.reviewDiff', async (...args: unknown[]) => {
      const relativePath = args[0];
      if (typeof relativePath === 'string') {
        await controller?.reviewDiff(relativePath);
      }
    }),
    vscode.commands.registerCommand('nirman.pauseRun', async () => {
      const run = controller?.getActiveRun();
      if (run) {
        await controller?.pauseRun(run.runId);
      }
    }),
    vscode.commands.registerCommand('nirman.resumeRun', async () => {
      const run = controller?.getActiveRun();
      if (run) {
        await controller?.resumeRun(run.runId);
      }
    }),
    vscode.commands.registerCommand('nirman.cancelRun', async () => {
      const run = controller?.getActiveRun();
      if (run) {
        await controller?.cancelRun(run.runId);
      }
    }),
    vscode.commands.registerCommand('nirman.openAgentManager', () => {
      controller?.openAgentManagerPanel();
    }),
    vscode.commands.registerCommand('nirman.toggleAgentManager', async () => {
      await controller?.toggleAgentManager();
    }),
    vscode.commands.registerCommand('nirman.focusEditor', async () => {
      await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
    }),
    vscode.commands.registerCommand('nirman.refreshAgents', async () => {
      await controller?.refreshRuns();
    }),
  );

  return controller;
}

export function deactivate(): void {
  if (controller) {
    controller.deactivate();
    controller = null;
  }
}
