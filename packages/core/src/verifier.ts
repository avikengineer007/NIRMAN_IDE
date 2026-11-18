import type { Sandbox } from '@nirman/sandbox';

export interface VerificationResult {
  success: boolean;
  command: string;
  output: string;
  error?: string | undefined;
}

/**
 * Extracts build and test verification commands from SPEC.md and task details.
 */
export function extractVerificationCommands(
  specMarkdown: string,
  taskTitle = '',
  taskDescription = '',
): string[] {
  const commands: string[] = [];

  // Check for explicit commands in task description/title (e.g., "Run node test.js" or "Verify: npm test")
  const taskCommandMatch = `${taskTitle} ${taskDescription}`.match(
    /(?:run|verify|test with)[:\s]+`?((?:npm|node|python|pytest|pnpm|yarn|cargo|go|sh|bash)\s+[^`\n]+)`?/i,
  );
  if (taskCommandMatch && taskCommandMatch[1]) {
    commands.push(taskCommandMatch[1].trim());
  }

  // Look for build / test commands in SPEC.md
  // Patterns: "Test: <cmd>", "- Test: <cmd>", "Commands:\n- Test: <cmd>"
  const testRegex = /(?:^|\n)\s*[-*]?\s*(?:Test|Build|Verify)\s*[:=-]\s*`?([^\n`]+)`?/gi;
  for (const match of specMarkdown.matchAll(testRegex)) {
    const cmd = match[1]?.trim();
    if (cmd && !cmd.toLowerCase().startsWith('none') && !commands.includes(cmd)) {
      commands.push(cmd);
    }
  }

  // Look for command codeblocks in SPEC.md under a Commands heading
  const commandsHeadingMatch = specMarkdown.match(/#+\s*Commands[\s\S]*?(?=(?:^#+\s+|$))/i);
  if (commandsHeadingMatch && commands.length === 0) {
    const codeBlockMatch = commandsHeadingMatch[0].match(/```(?:bash|sh|shell)?\s*([\s\S]*?)```/i);
    if (codeBlockMatch && codeBlockMatch[1]) {
      const lines = codeBlockMatch[1]
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith('#'));
      for (const line of lines) {
        if (!commands.includes(line)) {
          commands.push(line);
        }
      }
    }
  }

  return commands;
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

    // Check for start of error / failure sections
    const isErrorStart =
      lower.includes('error:') ||
      lower.includes('typeerror:') ||
      lower.includes('assertionerror:') ||
      lower.includes('err_assertion') ||
      lower.includes('syntaxerror:') ||
      lower.includes('referenceerror:') ||
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

  // Hard truncate to 2048 bytes for small context
  if (result.length > 2048) {
    return `${result.slice(0, 2048)}\n... [error output truncated to fit context budget]`;
  }

  return result.trim();
}

/**
 * Runs verification commands deterministically in the sandbox.
 */
export async function runVerification(
  commands: readonly string[],
  sandbox: Sandbox,
  timeoutMs = 30_000,
): Promise<VerificationResult> {
  if (commands.length === 0) {
    // If no commands specified, verify that workspace has non-empty files
    const entries = await sandbox.listDir('.');
    if (entries.length === 0) {
      return {
        success: false,
        command: '(workspace-check)',
        output: '',
        error: 'No files were created in the workspace.',
      };
    }
    return {
      success: true,
      command: '(workspace-check)',
      output: `Workspace contains ${entries.length} file(s).`,
    };
  }

  for (const cmd of commands) {
    const result = await sandbox.executeCommand(cmd, { timeoutMs });
    if (result.exitCode !== 0 || result.timedOut) {
      const errorMsg = result.timedOut
        ? `Command timed out after ${timeoutMs}ms`
        : result.stderr || result.stdout;

      return {
        success: false,
        command: cmd,
        output: result.stdout,
        error: errorMsg,
      };
    }
  }

  return {
    success: true,
    command: commands.join(' && '),
    output: 'All verification commands passed successfully.',
  };
}
