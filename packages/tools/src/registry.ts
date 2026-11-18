import { validateSchema, type ToolDefinition } from '@nirman/model';
import type { Tool, ToolExecutionContext, ToolResult } from './types.js';
import { readFileTool } from './tools/read-file.js';
import { writeFileTool } from './tools/write-file.js';
import { editFileTool } from './tools/edit-file.js';
import { listDirTool } from './tools/list-dir.js';
import { searchTool } from './tools/search.js';
import { runShellTool } from './tools/run-shell.js';

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  constructor(tools: readonly Tool[] = []) {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  register(tool: Tool): void {
    this.tools.set(tool.definition.name, tool);
  }

  getTool(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  getDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((tool) => tool.definition);
  }

  async execute(
    name: string,
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        success: false,
        output: '',
        error: `Unknown tool: "${name}". Available tools: ${Array.from(this.tools.keys()).join(', ')}`,
      };
    }

    // Input schema validation
    const validation = validateSchema(args, tool.definition.parameters);
    if (!validation.valid) {
      return {
        success: false,
        output: '',
        error: `Tool "${name}" input validation failed: ${validation.errors.join('; ')}`,
      };
    }

    return tool.execute(args, context);
  }
}

/**
 * Creates a default tool registry with all core Nirman tools pre-registered.
 */
export function createDefaultToolRegistry(): ToolRegistry {
  return new ToolRegistry([
    readFileTool,
    writeFileTool,
    editFileTool,
    listDirTool,
    searchTool,
    runShellTool,
  ]);
}
