import type { Sandbox } from '@nirman/sandbox';

/**
 * Initializes a git repository in the sandbox if one does not exist.
 */
export async function initGitRepo(sandbox: Sandbox): Promise<void> {
  const hasGit = await sandbox.exists('.git');
  if (!hasGit) {
    await sandbox.executeCommand('git init');
    await sandbox.executeCommand('git config user.name "Nirman Agent"');
    await sandbox.executeCommand('git config user.email "agent@nirman.local"');
    // Create initial commit so HEAD exists
    await sandbox.executeCommand('git add -A');
    await sandbox.executeCommand('git commit --allow-empty -m "initial commit"');
  }
}

/**
 * Captures changes made during a task, stages them, commits, and returns the unified diff.
 */
export async function captureTaskDiff(
  sandbox: Sandbox,
  taskId: string,
  taskTitle: string,
): Promise<string> {
  try {
    await initGitRepo(sandbox);

    // Stage all changes (untracked, modified, deleted)
    await sandbox.executeCommand('git add -A');

    // Get the staged diff against HEAD
    const diffRes = await sandbox.executeCommand('git diff --cached');
    const patch = diffRes.stdout || '';

    // Commit the task changes
    const cleanTitle = taskTitle.replace(/["\r\n]/g, ' ').slice(0, 72);
    await sandbox.executeCommand(`git commit --allow-empty -m "task(${taskId}): ${cleanTitle}"`);

    return patch;
  } catch (err) {
    return `# Failed to capture git diff for ${taskId}: ${(err as Error).message}\n`;
  }
}

/**
 * Captures the total cumulative diff of the entire run against the initial commit.
 */
export async function captureRunDiff(sandbox: Sandbox): Promise<string> {
  try {
    await initGitRepo(sandbox);
    await sandbox.executeCommand('git add -A');

    // Get diff against the root commit
    const rootCommitRes = await sandbox.executeCommand('git rev-list --max-parents=0 HEAD');
    const rootCommit = rootCommitRes.stdout.trim().split('\n')[0];

    if (rootCommit) {
      const diffRes = await sandbox.executeCommand(`git diff ${rootCommit} HEAD`);
      return diffRes.stdout || '';
    }

    const fallbackRes = await sandbox.executeCommand('git diff HEAD~1 HEAD');
    return fallbackRes.stdout || '';
  } catch (err) {
    return `# Failed to capture cumulative run diff: ${(err as Error).message}\n`;
  }
}
