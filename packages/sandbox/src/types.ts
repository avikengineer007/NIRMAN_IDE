/** Sandbox execution configuration */
export interface SandboxConfig {
  /** Absolute path on host to project workspace root */
  workspaceRoot: string;
  /** Docker image to execute within */
  image?: string;
  /** CPU limit (e.g. 2.0) */
  cpuLimit?: number;
  /** Memory limit (e.g. '1g', '512m') */
  memoryLimit?: string;
  /** Default command timeout in ms */
  timeoutMs?: number;
  /** Network isolation mode */
  networkMode?: 'none' | 'host' | 'bridge';
  /** Whether network is permitted (e.g. for package installation) */
  allowNetwork?: boolean;
}

/** Options for a single command execution */
export interface CommandOptions {
  /** Timeout in ms for this specific execution */
  timeoutMs?: number;
  /** Override network allowance for this execution */
  allowNetwork?: boolean;
  /** Working directory relative to workspace root */
  cwd?: string;
  /** Environment variables to pass into command */
  env?: Record<string, string>;
}

/** Result of command execution */
export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

/** File system directory entry */
export interface DirEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  sizeBytes?: number;
}

/** Generic Sandbox execution environment */
export interface Sandbox {
  readonly config: Readonly<SandboxConfig>;

  /** Execute a shell command inside the sandbox */
  executeCommand(cmd: string, options?: CommandOptions): Promise<CommandResult>;

  /** Read file content from workspace */
  readFile(relativePath: string): Promise<string>;

  /** Write file content into workspace */
  writeFile(relativePath: string, content: string): Promise<void>;

  /** Delete a file in workspace */
  deleteFile(relativePath: string): Promise<void>;

  /** List directory entries within workspace */
  listDir(
    relativePath?: string,
    options?: { recursive?: boolean; maxEntries?: number },
  ): Promise<DirEntry[]>;

  /** Check if a path exists within workspace */
  exists(relativePath: string): Promise<boolean>;

  /** Resolve and verify a path is safely inside the workspace */
  resolveSafePath(relativePath: string): string;
}
