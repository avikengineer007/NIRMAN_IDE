import type { Tool, ToolExecutionContext, ToolResult } from '../types.js';
import { truncateOutput } from '../truncation.js';

export interface ReadFileInput {
  path: string;
  startLine?: number;
  endLine?: number;
}

export const readFileTool: Tool<ReadFileInput> = {
  definition: {
    name: 'read_file',
    description:
      'Read file contents from the workspace. Optional startLine and endLine parameters (1-indexed) allow reading a specific range.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path to file in workspace',
        },
        startLine: {
          type: 'integer',
          description: 'Optional 1-indexed starting line number (inclusive)',
        },
        endLine: {
          type: 'integer',
          description: 'Optional 1-indexed ending line number (inclusive)',
        },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },

  async execute(args: ReadFileInput, context: ToolExecutionContext): Promise<ToolResult> {
    try {
      const exists = await context.sandbox.exists(args.path);
      if (!exists) {
        return {
          success: false,
          output: '',
          error: `File not found: "${args.path}"`,
        };
      }

      const fullContent = await context.sandbox.readFile(args.path);
      const lines = fullContent.split('\n');

      let selectedLines = lines;
      if (args.startLine !== undefined || args.endLine !== undefined) {
        const start = Math.max(1, args.startLine ?? 1);
        const end = Math.min(lines.length, args.endLine ?? lines.length);

        if (start > end) {
          return {
            success: false,
            output: '',
            error: `Invalid line range: startLine (${start}) exceeds endLine (${end})`,
          };
        }

        selectedLines = lines.slice(start - 1, end);
      }

      const formatted = selectedLines.join('\n');
      const truncated = truncateOutput(formatted, context.maxOutputBytes);

      return {
        success: true,
        output: truncated.text,
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
