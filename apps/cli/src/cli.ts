import path from 'node:path';
import readline from 'node:readline/promises';
import { OpenAICompatibleClient, type ModelClient } from '@nirman/model';
import { DockerSandbox, LocalSandbox, type Sandbox } from '@nirman/sandbox';
import { createDefaultToolRegistry } from '@nirman/tools';
import { ArtifactStore, type TaskItem } from '@nirman/artifacts';
import {
  runAgentLoop,
  type AgentLoopResult,
  type ApprovalHandler,
  type ClarificationHandler,
} from '@nirman/core';
import { formatCliEvent } from './formatter.js';

export interface CliOptions {
  task: string;
  baseUrl?: string;
  model?: string;
  toolMode?: 'native' | 'fallback';
  workspaceRoot?: string;
  useDocker?: boolean;
  maxSteps?: number;
  maxTimeMs?: number;
  autoApprove?: boolean;
  skipPlanning?: boolean;
  modelClient?: ModelClient;
  onClarification?: ClarificationHandler;
  onApproval?: ApprovalHandler;
}

export function parseCliArgs(args: readonly string[]): CliOptions | null {
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    return null;
  }

  const firstArg = args[0];
  if (firstArg !== 'run') {
    return null;
  }

  const task = args[1];
  if (!task || task.startsWith('-')) {
    return null;
  }

  let baseUrl = process.env['LLM_BASE_URL'] || 'http://localhost:11434/v1';
  let model = process.env['LLM_MODEL'] || 'qwen2.5-coder';
  let toolMode: 'native' | 'fallback' =
    process.env['LLM_TOOL_MODE'] === 'fallback' ? 'fallback' : 'native';
  let workspaceRoot = process.cwd();
  let useDocker = false;
  let maxSteps = 25;
  let maxTimeMs = 300_000;
  let autoApprove = false;
  let skipPlanning = false;

  for (let i = 2; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--base-url' && args[i + 1]) {
      baseUrl = args[i + 1]!;
      i++;
    } else if (arg === '--model' && args[i + 1]) {
      model = args[i + 1]!;
      i++;
    } else if (arg === '--tool-mode' && args[i + 1]) {
      const mode = args[i + 1]!;
      toolMode = mode === 'fallback' ? 'fallback' : 'native';
      i++;
    } else if (arg === '--workspace' && args[i + 1]) {
      workspaceRoot = path.resolve(args[i + 1]!);
      i++;
    } else if (arg === '--docker') {
      useDocker = true;
    } else if (arg === '--max-steps' && args[i + 1]) {
      maxSteps = parseInt(args[i + 1]!, 10);
      i++;
    } else if (arg === '--max-time' && args[i + 1]) {
      maxTimeMs = parseInt(args[i + 1]!, 10);
      i++;
    } else if (arg === '--auto-approve' || arg === '-y') {
      autoApprove = true;
    } else if (arg === '--skip-planning') {
      skipPlanning = true;
    }
  }

  return {
    task,
    baseUrl,
    model,
    toolMode,
    workspaceRoot,
    useDocker,
    maxSteps,
    maxTimeMs,
    autoApprove,
    skipPlanning,
  };
}

/**
 * Creates interactive clarification and approval handlers using node readline.
 */
function createInteractiveHandlers(outputStream: (text: string) => void): {
  clarificationHandler: ClarificationHandler;
  approvalHandler: ApprovalHandler;
} {
  const clarificationHandler: ClarificationHandler = async (questions) => {
    if (!process.stdin.isTTY) {
      return {};
    }

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answers: Record<string, string> = {};

    try {
      outputStream(
        '\nPlease answer the following clarifying questions (or press Enter to skip):\n',
      );
      for (const q of questions) {
        const answer = await rl.question(`❓ ${q}\n> `);
        if (answer.trim()) {
          answers[q] = answer.trim();
        }
      }
    } finally {
      rl.close();
    }

    return answers;
  };

  const approvalHandler: ApprovalHandler = async (
    planPath,
    _specPath,
    tasks: readonly TaskItem[],
  ) => {
    if (!process.stdin.isTTY) {
      return { action: 'approve' };
    }

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      outputStream(`\n📋 Plan: ${planPath}\nTasks to execute (${tasks.length}):\n`);
      for (const t of tasks) {
        outputStream(`  • ${t.title}\n`);
      }
      outputStream('\nOptions: [y]es approve / [e]dited file / [f]eedback / [n]o reject\n');

      while (true) {
        const input = (await rl.question('Approve plan? (Y/e/f/n): ')).trim().toLowerCase();
        if (input === '' || input === 'y' || input === 'yes') {
          return { action: 'approve' };
        }
        if (input === 'n' || input === 'no') {
          return { action: 'reject', reason: 'User rejected the plan' };
        }
        if (input === 'e' || input === 'edit') {
          await rl.question(`\nEdit ${planPath} in your editor. Press Enter when done...`);
          return { action: 'edited' };
        }
        if (input === 'f' || input === 'feedback') {
          const feedback = await rl.question('Enter your revision feedback: ');
          if (feedback.trim()) {
            return { action: 'feedback', feedback: feedback.trim() };
          }
        } else if (input.length > 2 && !['yes', 'approve'].includes(input)) {
          // If the user directly typed their feedback into the prompt
          return { action: 'feedback', feedback: input };
        }
      }
    } finally {
      rl.close();
    }
  };

  return { clarificationHandler, approvalHandler };
}

export async function runCli(
  args: readonly string[],
  outputStream: (text: string) => void = (t) => process.stdout.write(t),
  customModelClient?: ModelClient,
  customOptions?: Partial<CliOptions>,
): Promise<AgentLoopResult | null> {
  const parsed = parseCliArgs(args);
  if (!parsed && !customOptions?.task) {
    outputStream(`
NIRMAN CLI - Agentic coding IDE

Usage:
  nirman run "<task description>" [options]

Options:
  --model <model>       Model name (default: qwen2.5-coder or $LLM_MODEL)
  --base-url <url>      OpenAI-compatible base URL (default: http://localhost:11434/v1 or $LLM_BASE_URL)
  --tool-mode <mode>    Tool calling mode: "native" | "fallback" (default: native)
  --workspace <path>    Workspace directory (default: current directory)
  --docker              Execute in Docker sandbox instead of host sandbox
  --max-steps <num>     Maximum execution steps (default: 25)
  --auto-approve, -y    Automatically approve generated execution plan
  --skip-planning       Skip planning phase and start tools immediately
  --help, -h            Show this help message

Example:
  nirman run "create a to-do web app with login"
\n`);
    return null;
  }

  const options: CliOptions = {
    ...parsed,
    ...customOptions,
    task: customOptions?.task ?? parsed!.task,
  };

  const workspaceRoot = options.workspaceRoot ?? process.cwd();

  const modelClient =
    customModelClient ??
    options.modelClient ??
    new OpenAICompatibleClient({
      baseUrl: options.baseUrl ?? 'http://localhost:11434/v1',
      model: options.model ?? 'qwen2.5-coder',
      toolMode: options.toolMode ?? 'native',
      timeoutMs: 60_000,
    });

  const sandbox: Sandbox = options.useDocker
    ? new DockerSandbox({ workspaceRoot })
    : new LocalSandbox({ workspaceRoot });

  const artifacts = new ArtifactStore(workspaceRoot);
  const tools = createDefaultToolRegistry();

  const { clarificationHandler, approvalHandler } = createInteractiveHandlers(outputStream);

  const onClarification = options.onClarification ?? clarificationHandler;
  const onApproval = options.autoApprove
    ? () => Promise.resolve({ action: 'approve' as const })
    : (options.onApproval ?? approvalHandler);

  const loop = runAgentLoop({
    task: options.task,
    workspaceRoot,
    modelClient,
    sandbox,
    artifacts,
    tools,
    maxSteps: options.maxSteps ?? 25,
    maxTimeMs: options.maxTimeMs ?? 300_000,
    skipPlanning: options.skipPlanning ?? false,
    onClarification,
    onApproval,
  });

  for await (const event of loop) {
    const formatted = formatCliEvent(event);
    outputStream(formatted);
  }

  const tasks = await artifacts.readTasks();
  const finalStatus = tasks.status === 'running' ? 'completed' : tasks.status;
  return {
    runId: artifacts.runId,
    status: finalStatus as 'completed' | 'failed' | 'cancelled' | 'blocked',
    totalSteps: tasks.stepsCount,
    durationMs: 0,
    messages: [],
    artifacts,
    ...(tasks.tasks ? { tasks: tasks.tasks } : {}),
    ...(tasks.diffPath ? { diffPath: tasks.diffPath } : {}),
    ...(tasks.walkthroughPath ? { walkthroughPath: tasks.walkthroughPath } : {}),
  };
}
