import { spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { ExtensionContext } from 'vscode';
import { ExtensionController } from './extension-controller.js';
import type { IVSCodeAPI } from './vscode-api.js';

let controller: ExtensionController | null = null;
let spawnedLlama: ChildProcess | null = null;
let spawnedDaemon: ChildProcess | null = null;

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

async function isHttpAlive(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1200) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Ensures CUDA llama-server (port 8080) and NIRMAN Agent Daemon (port 4096) are running
 * when NIRMAN Agentic Studio is launched directly as a native Windows desktop app.
 */
async function ensureBackendServicesRunning(): Promise<void> {
  const installDir = 'C:\\Tools\\nirman';
  const logsDir = path.join(installDir, 'logs');
  const pidsPath = path.join(logsDir, 'pids.json');

  try {
    fs.mkdirSync(logsDir, { recursive: true });
  } catch {}

  // 1. Check / start llama-server on port 8080
  const llamaAlive = await isHttpAlive('http://127.0.0.1:8080/health');
  if (!llamaAlive && !spawnedLlama) {
    const llamaExe = path.join(installDir, 'bin', 'llama-server.exe');
    const modelPath = path.join(installDir, 'models', 'qwen2.5-coder-7b-instruct-q4_k_m.gguf');
    const cudaDir = fs.existsSync(path.join(installDir, 'bin', 'cuda_v13', 'ggml-cuda.dll'))
      ? path.join(installDir, 'bin', 'cuda_v13')
      : path.join(installDir, 'bin', 'cuda_v12');

    if (fs.existsSync(llamaExe) && fs.existsSync(modelPath)) {
      spawnedLlama = spawn(
        llamaExe,
        ['-m', modelPath, '-ngl', '99', '-c', '32768', '--host', '127.0.0.1', '--port', '8080'],
        {
          windowsHide: true,
          stdio: 'ignore',
          env: {
            ...process.env,
            GGML_BACKEND_PATH: path.join(cudaDir, 'ggml-cuda.dll'),
            PATH: `${cudaDir};${path.join(installDir, 'bin')};${process.env['PATH'] ?? ''}`,
          },
        },
      );
    }
  }

  // 2. Check / start agent daemon on port 4096
  let activeToken = resolveSessionToken();
  const daemonAlive = await isHttpAlive(
    `http://127.0.0.1:4096/status?token=${encodeURIComponent(activeToken)}`,
  );

  if (!daemonAlive && !spawnedDaemon) {
    const serverCli = path.join(installDir, 'server', 'dist', 'cli.js');
    if (fs.existsSync(serverCli)) {
      if (activeToken === 'default-token') {
        activeToken = crypto.randomBytes(24).toString('hex');
      }
      process.env['NIRMAN_SESSION_TOKEN'] = activeToken;

      spawnedDaemon = spawn(
        'node',
        [serverCli, '--port', '4096', '--token', activeToken, '--host', '127.0.0.1'],
        {
          windowsHide: true,
          stdio: 'ignore',
          env: {
            ...process.env,
            NIRMAN_SESSION_TOKEN: activeToken,
            NIRMAN_MODEL_URL: 'http://127.0.0.1:8080/v1',
          },
        },
      );

      try {
        fs.writeFileSync(
          pidsPath,
          JSON.stringify(
            {
              llamaPid: spawnedLlama?.pid ?? 0,
              serverPid: spawnedDaemon.pid ?? 0,
              startTime: new Date().toISOString(),
              token: activeToken,
            },
            null,
            2,
          ),
          'utf-8',
        );
      } catch {}

      // Wait briefly for daemon HTTP readiness
      for (let i = 0; i < 12; i++) {
        if (
          await isHttpAlive(`http://127.0.0.1:4096/status?token=${encodeURIComponent(activeToken)}`)
        ) {
          break;
        }
        await new Promise((r) => setTimeout(r, 400));
      }
    }
  }
}

export async function activate(
  context: ExtensionContext,
  customApi?: IVSCodeAPI,
): Promise<ExtensionController> {
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

  // Listen for workspace folder switches to load that folder's chat history
  const wsAny = vscode.workspace as unknown as {
    onDidChangeWorkspaceFolders?: (cb: () => void) => { dispose(): void };
  };
  if (wsAny && typeof wsAny.onDidChangeWorkspaceFolders === 'function') {
    context.subscriptions.push(
      wsAny.onDidChangeWorkspaceFolders(() => {
        controller?.loadWorkspaceChatHistory();
      }),
    );
  }

  if (!customApi) {
    // Auto-start backend services if needed, then connect
    void (async () => {
      await ensureBackendServicesRunning();
      await controller?.activate().catch(() => {});
    })();

    // Automatically reveal the NIRMAN Assistant on the right side (Secondary Side Bar)
    setTimeout(() => {
      void vscode.commands.executeCommand('nirman.chat.focus');
    }, 600);
  } else {
    controller.activate().catch(() => {});
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
  if (spawnedDaemon) {
    try {
      spawnedDaemon.kill();
    } catch {}
    spawnedDaemon = null;
  }
  if (spawnedLlama) {
    try {
      spawnedLlama.kill();
    } catch {}
    spawnedLlama = null;
  }
}
