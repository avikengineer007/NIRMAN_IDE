import path from 'node:path';
import type { Sandbox } from '@nirman/sandbox';
import {
  extractSpecCommand,
  filterProjectFiles,
  isPythonTestOrMetaFile,
} from './walkthrough.js';

export type VerificationFailureClass =
  | 'command_not_found'
  | 'import_error'
  | 'syntax_error'
  | 'test_assertion'
  | 'missing_file'
  | 'timeout'
  | 'unknown';

export interface VerificationResult {
  success: boolean;
  command: string;
  output: string;
  error?: string | undefined;
  failureClass?: VerificationFailureClass | undefined;
}

export interface StructuredSpecCommands {
  build?: string | null;
  run?: string | null;
  test?: string | null;
  expectedFiles?: string[];
}

/**
 * Strict allow-list of first-token executables permitted in verification commands (F1).
 * Prevents prose lines like "Not applicable (...)" or "/ Test / Run Commands:" from running.
 */
export const ALLOWED_EXECUTABLES = new Set<string>([
  'python',
  'python3',
  'py',
  'pytest',
  'node',
  'npm',
  'npx',
  'pnpm',
  'yarn',
  'bun',
  'deno',
  'tsc',
  'vitest',
  'jest',
  'mocha',
  'gcc',
  'g++',
  'clang',
  'clang++',
  'javac',
  'java',
  'mvn',
  'gradle',
  'go',
  'cargo',
  'rustc',
  'dotnet',
  'ruby',
  'rspec',
  'php',
  'phpunit',
  'make',
  'cmake',
  'sh',
  'bash',
  'pwsh',
  'powershell',
  'cmd',
]);

/**
 * Validates that a candidate command string begins with an allowed executable token
 * and is not prose, a markdown heading, or a "None"/"Not applicable" placeholder (F1).
 */
export function isAllowedShellCommand(candidate?: string | null): candidate is string {
  if (!candidate) return false;
  const trimmed = candidate.trim();
  if (!trimmed) return false;
  if (trimmed.endsWith(':')) return false;

  const lower = trimmed.toLowerCase();
  if (
    lower === 'none' ||
    lower.startsWith('none ') ||
    lower.startsWith('none(') ||
    lower === 'n/a' ||
    lower.startsWith('not applicable') ||
    lower.startsWith('see spec') ||
    lower.startsWith('no ')
  ) {
    return false;
  }

  // Extract first token (skipping leading KEY=VALUE env assignments if present)
  const tokens = trimmed.split(/\s+/);
  let firstToken = '';
  for (const tok of tokens) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tok)) {
      continue;
    }
    firstToken = tok.replace(/^["']|["']$/g, '');
    break;
  }
  if (!firstToken) return false;

  // Reject path-like or operator tokens like "/", "-", "#", "*"
  if (/^[/\\#*\-:]/.test(firstToken)) {
    return false;
  }

  const baseExe = path
    .basename(firstToken)
    .toLowerCase()
    .replace(/\.exe$/i, '');

  return ALLOWED_EXECUTABLES.has(baseExe);
}

/**
 * Extracts a structured JSON commands block embedded in SPEC.md (F1 + F6).
 * Supports either `{"nirman_commands": { ... }}` or a direct `{"build": ..., "run": ..., "test": ...}` JSON fence.
 */
export function extractStructuredCommands(specMarkdown: string): StructuredSpecCommands | null {
  if (!specMarkdown) return null;

  const fenceRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = fenceRegex.exec(specMarkdown)) !== null) {
    const raw = match[1]?.trim();
    if (!raw || !raw.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const candidate =
        parsed['nirman_commands'] && typeof parsed['nirman_commands'] === 'object'
          ? (parsed['nirman_commands'] as Record<string, unknown>)
          : parsed;

      if (
        'run' in candidate ||
        'test' in candidate ||
        'build' in candidate ||
        'expectedFiles' in candidate
      ) {
        return {
          build: typeof candidate['build'] === 'string' ? candidate['build'] : null,
          run: typeof candidate['run'] === 'string' ? candidate['run'] : null,
          test: typeof candidate['test'] === 'string' ? candidate['test'] : null,
          expectedFiles: Array.isArray(candidate['expectedFiles'])
            ? candidate['expectedFiles'].filter((x): x is string => typeof x === 'string')
            : [],
        };
      }
    } catch {
      // Ignore non-JSON fences
    }
  }

  return null;
}

/**
 * Extracts build and test verification commands from SPEC.md and task details.
 * Reads structured JSON commands first (F1+F6), then falls back to markdown parsing,
 * filtering EVERY command through the strict executable allow-list (F1).
 */
export function extractVerificationCommands(
  specMarkdown: string,
  taskTitle = '',
  taskDescription = '',
): string[] {
  const commands: string[] = [];
  const addIfAllowed = (cmd?: string | null): void => {
    if (isAllowedShellCommand(cmd) && !commands.includes(cmd.trim())) {
      commands.push(cmd.trim());
    }
  };

  // 1. Check for explicit commands in task description/title (e.g., "Run node test.js" or "Verify: npm test")
  const taskCommandMatch = `${taskTitle} ${taskDescription}`.match(
    /(?:run|verify|test with)[:\s]+`?((?:npm|node|python|python3|py|pytest|pnpm|yarn|cargo|go|gcc|g\+\+|javac|sh|bash)\s+[^`\n]+)`?/i,
  );
  if (taskCommandMatch?.[1]) {
    addIfAllowed(taskCommandMatch[1]);
  }

  // 2. Prefer structured JSON commands block in SPEC.md (F1 + F6)
  const structured = extractStructuredCommands(specMarkdown);
  if (structured) {
    addIfAllowed(structured.build);
    addIfAllowed(structured.test);
    if (commands.length > 0) {
      return commands;
    }
  }

  // 3. Fallback: extract Build / Test / Verify commands from SPEC.md markdown
  addIfAllowed(extractSpecCommand(specMarkdown, 'Build'));
  addIfAllowed(extractSpecCommand(specMarkdown, 'Test|Verify'));

  // 4. Fallback: command codeblocks in SPEC.md under a Commands heading
  const commandsHeadingMatch = specMarkdown.match(/#+\s*Commands[\s\S]*?(?=(?:^#+\s+|$))/i);
  if (commandsHeadingMatch && commands.length === 0) {
    const codeBlockMatch = commandsHeadingMatch[0].match(/```(?:bash|sh|shell)?\s*([\s\S]*?)```/i);
    if (codeBlockMatch?.[1]) {
      const lines = codeBlockMatch[1]
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith('#'));
      for (const line of lines) {
        addIfAllowed(line);
      }
    }
  }

  return commands;
}

/**
 * Classifies verification failures so retries only occur on fixable code errors
 * and invalid/unrecognized shell commands fail fast (F4).
 */
export function classifyVerificationFailure(
  command: string,
  output: string,
  error?: string,
): VerificationFailureClass {
  const combined = `${output}\n${error ?? ''}`;
  const lower = combined.toLowerCase();

  if (lower.includes('timed out after') || lower.includes('etimedout')) {
    return 'timeout';
  }
  if (
    lower.includes('is not recognized as the name of a cmdlet') ||
    lower.includes('command not found') ||
    lower.includes('not recognized as an internal or external command') ||
    lower.includes('commandnotfoundexception')
  ) {
    return 'command_not_found';
  }
  if (
    lower.includes('importerror') ||
    lower.includes('modulenotfounderror') ||
    lower.includes('start directory is not importable') ||
    lower.includes('cannot find module')
  ) {
    return 'import_error';
  }
  if (
    lower.includes('syntaxerror') ||
    lower.includes('indentationerror') ||
    lower.includes('error ts') ||
    lower.includes('parseerror')
  ) {
    return 'syntax_error';
  }
  if (
    lower.includes("can't open file") ||
    lower.includes('enoent') ||
    lower.includes('no source files were created') ||
    lower.includes('no application source file found')
  ) {
    return 'missing_file';
  }
  if (
    lower.includes('assertionerror') ||
    lower.includes('err_assertion') ||
    lower.includes('failed (failures=') ||
    lower.includes('fail:') ||
    /\bexpected\b.*\breceived\b/i.test(combined)
  ) {
    return 'test_assertion';
  }
  if (!command.startsWith('(') && !isAllowedShellCommand(command)) {
    return 'command_not_found';
  }
  return 'unknown';
}

/**
 * Parses raw terminal output and extracts only the relevant error lines,
 * stripping extraneous build logs to fit into a small model context window.
 */
export function parseRelevantError(rawOutput: string, rawError?: string): string {
  const combined = `${rawOutput}\n${rawError ?? ''}`.trim();
  if (!combined) {
    return 'Command exited with non-zero exit code without output.';
  }

  const lines = combined.split('\n');
  const relevantLines: string[] = [];
  let capturing = false;
  let capturedCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lower = line.toLowerCase();

    const isErrorStart =
      lower.includes('error:') ||
      lower.includes('typeerror:') ||
      lower.includes('assertionerror:') ||
      lower.includes('err_assertion') ||
      lower.includes('syntaxerror:') ||
      lower.includes('referenceerror:') ||
      lower.includes('importerror:') ||
      lower.includes('modulenotfounderror:') ||
      lower.includes('traceback (most recent call last):') ||
      lower.includes('failed:') ||
      lower.includes('fail ') ||
      lower.includes('failures:') ||
      line.includes('error TS') ||
      lower.includes('command failed');

    if (isErrorStart) {
      capturing = true;
    }

    if (capturing) {
      relevantLines.push(line);
      capturedCount++;
      if (capturedCount >= 30) {
        break;
      }
    }
  }

  const result =
    relevantLines.length > 0 ? relevantLines.join('\n') : lines.slice(-20).join('\n');

  if (result.length > 2048) {
    return `${result.slice(0, 2048)}\n... [error output truncated to fit context budget]`;
  }

  return result.trim();
}

/**
 * Deterministically ensures `__init__.py` exists along a Python unittest start directory
 * so `python -m unittest discover -s <dir> -t .` never fails with "Start directory is not importable" (F2).
 */
export async function ensurePythonPackageMarkers(
  sandbox: Sandbox,
  startDir: string,
): Promise<void> {
  const normalized = startDir.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  if (!normalized || normalized === '.') return;

  const dirExists = await sandbox.exists(normalized);
  if (!dirExists) return;

  const segments = normalized.split('/');
  let current = '';
  for (const seg of segments) {
    current = current ? `${current}/${seg}` : seg;
    const initFile = `${current}/__init__.py`;
    if (!(await sandbox.exists(initFile))) {
      await sandbox.writeFile(initFile, '');
    }
  }
}

export interface WorkspaceVerificationContext {
  taskTitle?: string | undefined;
  taskDescription?: string | undefined;
  expectedFiles?: readonly string[] | undefined;
}

/**
 * Per-step file-exists and syntax/compile verification replacing vacuous `(workspace-verification)` (F3).
 */
async function runWorkspaceIntegrityCheck(
  sandbox: Sandbox,
  timeoutMs: number,
  context?: WorkspaceVerificationContext,
): Promise<VerificationResult> {
  const entries = await sandbox.listDir('.', { recursive: true });
  const filePaths = filterProjectFiles(entries.filter((e) => e.type === 'file').map((e) => e.path));

  if (filePaths.length === 0) {
    return {
      success: false,
      command: '(workspace-verification)',
      output: '',
      error: 'No source files were created in the workspace.',
      failureClass: 'missing_file',
    };
  }

  // Check if this step is meant to implement application code (not solely tests)
  const stepText = `${context?.taskTitle ?? ''} ${context?.taskDescription ?? ''}`.toLowerCase();
  const isTestOnlyStep =
    /\b(test|verify|verification|unittest|pytest)\b/.test(stepText) &&
    !/\b(implement application|create application|build|calculator|entry point)\b/.test(stepText);

  const pyFiles = filePaths.filter((f) => f.endsWith('.py') && !f.endsWith('__init__.py'));
  const pyAppFiles = pyFiles.filter((f) => !isPythonTestOrMetaFile(f));
  if (!isTestOnlyStep && pyFiles.length > 0 && pyAppFiles.length === 0) {
    return {
      success: false,
      command: '(workspace-verification)',
      output: `Files found: ${filePaths.join(', ')}`,
      error:
        'No application source file found (only Python test files exist). Create the main application script before completing this step.',
      failureClass: 'missing_file',
    };
  }

  // Syntax / compile check on Python and JS source files
  for (const pyFile of pyFiles) {
    const res = await sandbox.executeCommand(`python -m py_compile ${pyFile}`, {
      timeoutMs: Math.min(timeoutMs, 10_000),
    });
    if (res.exitCode !== 0 || res.timedOut) {
      const errMsg = res.timedOut ? `py_compile timed out for ${pyFile}` : res.stderr || res.stdout;
      return {
        success: false,
        command: `python -m py_compile ${pyFile}`,
        output: res.stdout,
        error: errMsg,
        failureClass: classifyVerificationFailure(`python -m py_compile ${pyFile}`, res.stdout, errMsg),
      };
    }
  }

  const jsFiles = filePaths.filter(
    (f) => (f.endsWith('.js') || f.endsWith('.mjs')) && !f.includes('node_modules'),
  );
  for (const jsFile of jsFiles) {
    const res = await sandbox.executeCommand(`node --check ${jsFile}`, {
      timeoutMs: Math.min(timeoutMs, 10_000),
    });
    if (res.exitCode !== 0 || res.timedOut) {
      const errMsg = res.timedOut ? `node --check timed out for ${jsFile}` : res.stderr || res.stdout;
      return {
        success: false,
        command: `node --check ${jsFile}`,
        output: res.stdout,
        error: errMsg,
        failureClass: classifyVerificationFailure(`node --check ${jsFile}`, res.stdout, errMsg),
      };
    }
  }

  return {
    success: true,
    command: '(workspace-verification)',
    output: `Verified ${filePaths.length} project file(s) with syntax/compile checks.`,
  };
}

/**
 * Runs verification commands deterministically in the sandbox.
 */
export async function runVerification(
  commands: readonly string[],
  sandbox: Sandbox,
  timeoutMs = 30_000,
  context?: WorkspaceVerificationContext,
): Promise<VerificationResult> {
  if (commands.length === 0) {
    return runWorkspaceIntegrityCheck(sandbox, timeoutMs, context);
  }

  for (const cmd of commands) {
    if (!isAllowedShellCommand(cmd)) {
      return {
        success: false,
        command: cmd,
        output: '',
        error: `Blocked invalid verification command "${cmd}": executable is not in the allow-list.`,
        failureClass: 'command_not_found',
      };
    }

    // F2: Deterministically ensure __init__.py markers exist for python unittest discover -s <dir>
    const discoverMatch = cmd.match(/^python3?\s+-m\s+unittest\s+discover\s+.*?-s\s+([^\s]+)/i);
    if (discoverMatch?.[1]) {
      await ensurePythonPackageMarkers(sandbox, discoverMatch[1]);
    }

    let result = await sandbox.executeCommand(cmd, { timeoutMs });

    // F2: Bidirectional -t . fallback for Python unittest discovery
    if (
      result.exitCode !== 0 &&
      !result.timedOut &&
      /^python3?\s+-m\s+unittest\s+discover\s+/i.test(cmd)
    ) {
      const altCmd = cmd.includes('-t .')
        ? cmd.replace(/\s+-t\s+\.\b/, '').trim()
        : `${cmd} -t .`;
      const retryRes = await sandbox.executeCommand(altCmd, { timeoutMs });
      if (retryRes.exitCode === 0) {
        result = retryRes;
      }
    }

    if (result.exitCode !== 0 || result.timedOut) {
      const errorMsg = result.timedOut
        ? `Command timed out after ${timeoutMs}ms`
        : result.stderr || result.stdout;

      return {
        success: false,
        command: cmd,
        output: result.stdout,
        error: errorMsg,
        failureClass: classifyVerificationFailure(cmd, result.stdout, errorMsg),
      };
    }
  }

  return {
    success: true,
    command: commands.join(' && '),
    output: 'All verification commands passed successfully.',
  };
}
