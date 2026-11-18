import type { Tool, ToolExecutionContext, ToolResult } from '../types.js';
import { truncateOutput } from '../truncation.js';

export interface RunShellInput {
  command: string;
  timeoutMs?: number;
  allowNetwork?: boolean;
}

export const runShellTool: Tool<RunShellInput> = {
  definition: {
    name: 'run_shell',
    description:
      'Execute a shell command inside the sandbox. Shell timeouts kill the process. Network is disabled by default.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'Shell command string to execute',
        },
        timeoutMs: {
          type: 'integer',
          description: 'Timeout in milliseconds (defaults to 30000)',
        },
        allowNetwork: {
          type: 'boolean',
          description: 'Whether to allow network access (for package installation)',
        },
      },
      required: ['command'],
      additionalProperties: false,
    },
  },

  async execute(args: RunShellInput, context: ToolExecutionContext): Promise<ToolResult> {
    try {
      if (!args.command || args.command.trim().length === 0) {
        return {
          success: false,
          output: '',
          error: 'Command string must not be empty',
        };
      }

      const result = await context.sandbox.executeCommand(args.command, {
        ...(args.timeoutMs !== undefined ? { timeoutMs: args.timeoutMs } : {}),
        ...(args.allowNetwork !== undefined ? { allowNetwork: args.allowNetwork } : {}),
      });

      const outputParts: string[] = [];
      if (result.stdout) {
        outputParts.push(result.stdout.trimEnd());
      }
      if (result.stderr) {
        outputParts.push(`[STDERR]\n${result.stderr.trimEnd()}`);
      }
      if (result.timedOut) {
        outputParts.push('[STATUS: Process timed out and was killed]');
      }

      const rawCombined =
        outputParts.length > 0
          ? outputParts.join('\n\n')
          : `(Command completed with exit code ${result.exitCode} and no output)`;

      const truncated = truncateOutput(rawCombined, context.maxOutputBytes);

      return {
        success: result.exitCode === 0 && !result.timedOut,
        output: truncated.text,
        ...(result.exitCode !== 0
          ? {
              error: result.timedOut
                ? 'Command timed out and was killed'
                : `Command failed with exit code ${result.exitCode}`,
            }
          : {}),
        truncated: truncated.truncated,
      };
    } catch (err) {
      return {
        success: false,
        output: '',
        error: (err as Error).message,
      };
    }
  },
};
