import type { ToolDefinition } from '@nirman/model';
import type { Sandbox } from '@nirman/sandbox';

/** Result of executing a tool */
export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
  truncated?: boolean;
}

/** Execution context passed to each tool */
export interface ToolExecutionContext {
  sandbox: Sandbox;
  maxOutputBytes?: number;
}

/** Tool contract */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface Tool<T = any> {
  readonly definition: ToolDefinition;
  execute(args: T, context: ToolExecutionContext): Promise<ToolResult>;
}
