import fs from 'node:fs';
import type { ExtensionContext } from 'vscode';
import { ExtensionController } from './extension-controller.js';
import type { IVSCodeAPI } from './vscode-api.js';

let controller: ExtensionController | null = null;

function resolveSessionToken(): string {
  const envToken = process.env['NIRMAN_SESSION_TOKEN'] ?? process.env['NIRMAN_TOKEN'];
  if (envToken) return envToken;
  try {
    const pidsRaw = fs.readFileSync('C:\\Tools\\nirman\\logs\\pids.json', 'utf-8');
    const pids = JSON.parse(pidsRaw) as { token?: string };
    if (pids.token) return pids.token;
  } catch {}
  return 'default-token';
}

export async function activate(context: ExtensionContext, customApi?: IVSCodeAPI): Promise<ExtensionController> {
  const vscodeModule = customApi ?? (await import('vscode'));
  const vscode = vscodeModule as unknown as IVSCodeAPI;

  const serverUrl = process.env['NIRMAN_SERVER_URL'] ?? 'ws://127.0.0.1:4096';
  const serverToken = resolveSessionToken();
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
        win.registerWebviewViewProvider('nirman.chat', controller.chatView, {
          webviewOptions: { retainContextWhenHidden: true },
        }),
        win.registerWebviewViewProvider('nirman.plan', controller.planView, {
          webviewOptions: { retainContextWhenHidden: true },
        }),
        win.registerWebviewViewProvider('nirman.tasks', controller.tasksView, {
          webviewOptions: { retainContextWhenHidden: true },
        }),
        win.registerWebviewViewProvider('nirman.artifacts', controller.artifactsView, {
          webviewOptions: { retainContextWhenHidden: true },
        }),
        win.registerWebviewViewProvider('nirman.agentManager', controller.agentManager, {
          webviewOptions: { retainContextWhenHidden: true },
        }),
      );
    } catch {}
  }

  // Connect controller to daemon (non-blocking)
  controller.activate().catch(() => {});

  // Automatically reveal the NIRMAN Assistant on the right side (Secondary Side Bar)
  if (!customApi) {
    setTimeout(() => {
      void vscode.commands.executeCommand('nirman.chat.focus');
    }, 600);
  }

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('nirman.startRun', async () => {
      const win = vscode.window as any;
      let task: string | undefined;
      if (typeof win.showInputBox === 'function') {
        void vscode.commands.executeCommand('nirman.chat.focus');
        task = await win.showInputBox({
          title: 'NIRMAN Agentic Studio — Start Project Run',
          prompt: 'Describe what you want NIRMAN to build, edit, or fix:',
          placeHolder: 'e.g. Build a personal portfolio website with dark mode and contact form',
        });
      } else {
        task = await vscode.window.showInformationMessage('Describe project to NIRMAN:');
      }
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
