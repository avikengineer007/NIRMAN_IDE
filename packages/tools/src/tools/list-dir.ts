import type { Tool, ToolExecutionContext, ToolResult } from '../types.js';
import { truncateOutput } from '../truncation.js';

export interface ListDirInput {
  path?: string;
  recursive?: boolean;
  maxEntries?: number;
}

export const listDirTool: Tool<ListDirInput> = {
  definition: {
    name: 'list_dir',
    description: 'List files and directories in the workspace.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path to directory in workspace (defaults to ".")',
        },
        recursive: {
          type: 'boolean',
          description: 'Whether to list recursively (defaults to false)',
        },
        maxEntries: {
          type: 'integer',
          description: 'Maximum number of entries to return (defaults to 1000)',
        },
      },
      required: [],
      additionalProperties: false,
    },
  },

  async execute(args: ListDirInput, context: ToolExecutionContext): Promise<ToolResult> {
    try {
      const targetPath = args.path ?? '.';
      const entries = await context.sandbox.listDir(targetPath, {
        recursive: args.recursive ?? false,
        maxEntries: args.maxEntries ?? 1000,
      });

      if (entries.length === 0) {
        return {
          success: true,
          output: `(Directory "${targetPath}" is empty)`,
        };
      }

      // Sort directories first, then alphabetical by path
      entries.sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === 'directory' ? -1 : 1;
        }
        return a.path.localeCompare(b.path);
      });

      const lines = entries.map((e) => {
        const typeTag = e.type === 'directory' ? '[DIR] ' : '[FILE]';
        return `${typeTag} ${e.path}`;
      });

      const formatted = lines.join('\n');
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
