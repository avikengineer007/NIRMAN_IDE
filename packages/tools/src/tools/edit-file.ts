import type { Tool, ToolExecutionContext, ToolResult } from '../types.js';

export interface EditFileInput {
  path: string;
  target: string;
  replacement: string;
}

export const editFileTool: Tool<EditFileInput> = {
  definition: {
    name: 'edit_file',
    description:
      'Perform an exact search-and-replace edit on an existing file. Fails if the target string is not found or is ambiguous (appears multiple times).',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path to file in workspace',
        },
        target: {
          type: 'string',
          description: 'Exact string to find and replace',
        },
        replacement: {
          type: 'string',
          description: 'Replacement string',
        },
      },
      required: ['path', 'target', 'replacement'],
      additionalProperties: false,
    },
  },

  async execute(args: EditFileInput, context: ToolExecutionContext): Promise<ToolResult> {
    try {
      const exists = await context.sandbox.exists(args.path);
      if (!exists) {
        return {
          success: false,
          output: '',
          error: `File not found: "${args.path}"`,
        };
      }

      const content = await context.sandbox.readFile(args.path);

      if (args.target.length === 0) {
        return {
          success: false,
          output: '',
          error: 'Target string must not be empty',
        };
      }

      // Count exact occurrences of target
      let occurrences = 0;
      let pos = 0;
      while ((pos = content.indexOf(args.target, pos)) !== -1) {
        occurrences++;
        pos += args.target.length;
      }

      if (occurrences === 0) {
        return {
          success: false,
          output: '',
          error: `Target string not found in "${args.path}". Verify whitespace and character casing.`,
        };
      }

      if (occurrences > 1) {
        return {
          success: false,
          output: '',
          error: `Ambiguous match: target string occurs ${occurrences} times in "${args.path}". Include more surrounding lines/context to make the match unique.`,
        };
      }

      // Exactly 1 match: execute replacement
      const newContent = content.replace(args.target, args.replacement);
      await context.sandbox.writeFile(args.path, newContent);

      return {
        success: true,
        output: `Successfully applied edit to "${args.path}".`,
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
