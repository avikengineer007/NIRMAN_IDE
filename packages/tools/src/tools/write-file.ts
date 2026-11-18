import type { Tool, ToolExecutionContext, ToolResult } from '../types.js';

export interface WriteFileInput {
  path: string;
  content: string;
  overwrite?: boolean;
}

export const writeFileTool: Tool<WriteFileInput> = {
  definition: {
    name: 'write_file',
    description:
      'Write content to a file in the workspace. Automatically creates any missing parent directories.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path to file in workspace',
        },
        content: {
          type: 'string',
          description: 'Full content to write to the file',
        },
        overwrite: {
          type: 'boolean',
          description: 'Whether to overwrite an existing file (defaults to true)',
        },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
  },

  async execute(args: WriteFileInput, context: ToolExecutionContext): Promise<ToolResult> {
    try {
      const exists = await context.sandbox.exists(args.path);
      const allowOverwrite = args.overwrite ?? true;

      if (exists && !allowOverwrite) {
        return {
          success: false,
          output: '',
          error: `File already exists at "${args.path}" and overwrite was set to false.`,
        };
      }

      await context.sandbox.writeFile(args.path, args.content);
      const byteCount = Buffer.byteLength(args.content, 'utf-8');

      return {
        success: true,
        output: `Successfully wrote ${byteCount} bytes to "${args.path}".`,
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
