import type { Tool, ToolExecutionContext, ToolResult } from '../types.js';
import { truncateOutput } from '../truncation.js';

export interface SearchInput {
  query: string;
  path?: string;
  regex?: boolean;
  caseSensitive?: boolean;
  maxResults?: number;
}

const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage', '.agent']);

export const searchTool: Tool<SearchInput> = {
  definition: {
    name: 'search',
    description:
      'Search files within the workspace for text or regex patterns (ripgrep-style search).',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search string or regex pattern',
        },
        path: {
          type: 'string',
          description: 'Subdirectory to search in (defaults to ".")',
        },
        regex: {
          type: 'boolean',
          description: 'Whether to interpret query as a regular expression (defaults to false)',
        },
        caseSensitive: {
          type: 'boolean',
          description: 'Whether search is case-sensitive (defaults to false)',
        },
        maxResults: {
          type: 'integer',
          description: 'Maximum matching lines to return (defaults to 100)',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },

  async execute(args: SearchInput, context: ToolExecutionContext): Promise<ToolResult> {
    try {
      if (!args.query) {
        return {
          success: false,
          output: '',
          error: 'Search query must not be empty',
        };
      }

      const maxResults = args.maxResults ?? 100;
      const targetDir = args.path ?? '.';

      // Prepare matcher
      let matcher: (line: string) => boolean;
      if (args.regex) {
        const flags = args.caseSensitive ? 'u' : 'iu';
        const re = new RegExp(args.query, flags);
        matcher = (line: string) => re.test(line);
      } else {
        const needle = args.caseSensitive ? args.query : args.query.toLowerCase();
        matcher = (line: string) => {
          const haystack = args.caseSensitive ? line : line.toLowerCase();
          return haystack.includes(needle);
        };
      }

      // Collect files
      const entries = await context.sandbox.listDir(targetDir, { recursive: true });
      const files = entries.filter((e) => {
        if (e.type !== 'file') {
          return false;
        }
        const segments = e.path.split('/');
        return !segments.some((seg) => IGNORED_DIRS.has(seg));
      });

      const matches: string[] = [];

      for (const file of files) {
        if (matches.length >= maxResults) {
          break;
        }

        try {
          const content = await context.sandbox.readFile(file.path);
          const lines = content.split('\n');

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i] ?? '';
            if (matcher(line)) {
              matches.push(`${file.path}:${i + 1}: ${line.trimEnd()}`);
              if (matches.length >= maxResults) {
                break;
              }
            }
          }
        } catch {
          // Ignore unreadable binary or missing files
        }
      }

      if (matches.length === 0) {
        return {
          success: true,
          output: `No matches found for query: "${args.query}"`,
        };
      }

      const formatted = matches.join('\n');
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
