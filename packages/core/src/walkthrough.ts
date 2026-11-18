import type { TaskItem } from '@nirman/artifacts';

export interface WalkthroughOptions {
  task: string;
  runId: string;
  status: 'completed' | 'failed' | 'cancelled' | 'blocked';
  tasks: readonly TaskItem[];
  specMarkdown?: string | undefined;
  planMarkdown?: string | undefined;
  createdFiles?: readonly string[] | undefined;
  durationMs?: number | undefined;
}

/**
 * Generates a comprehensive markdown walkthrough report for the agent run.
 */
export function generateWalkthrough(options: WalkthroughOptions): string {
  const { task, runId, status, tasks, specMarkdown, createdFiles } = options;
  const isSuccess = status === 'completed';
  const statusBadge = isSuccess
    ? '✅ SUCCESS'
    : status === 'blocked'
      ? '🛑 BLOCKED'
      : `⚠️ ${status.toUpperCase()}`;

  // Extract How-to-run commands from SPEC.md
  const runCommandsMatch = specMarkdown?.match(/(?:^|\n)\s*[-*]?\s*Run\s*[:=-]\s*`?([^\n`]+)`?/i);
  const testCommandsMatch = specMarkdown?.match(/(?:^|\n)\s*[-*]?\s*Test\s*[:=-]\s*`?([^\n`]+)`?/i);

  const runCommand = runCommandsMatch?.[1]?.trim() ?? 'See SPEC.md for start command';
  const testCommand = testCommandsMatch?.[1]?.trim() ?? 'See SPEC.md for test command';

  // Build task table
  const taskRows = tasks.map((t) => {
    const icon =
      t.status === 'completed'
        ? '✅ Completed'
        : t.status === 'blocked'
          ? '🛑 Blocked'
          : t.status === 'failed'
            ? '❌ Failed'
            : '⏳ Pending';
    const retries = t.retries ? `${t.retries}` : '0';
    const notes = t.error ? t.error.slice(0, 60).replace(/[\r\n]/g, ' ') : '-';
    return `| \`${t.id}\` | ${t.title} | ${icon} | ${retries} | ${notes} |`;
  });

  const fileList =
    createdFiles && createdFiles.length > 0
      ? createdFiles.map((f) => `- \`${f}\``).join('\n')
      : '- Created files are tracked in `diff.patch`';

  // Blockers / Failures section
  const blockedTasks = tasks.filter((t) => t.status === 'blocked' || t.status === 'failed');
  let failuresSection = 'No blocking failures encountered. All tasks passed verification.';
  if (blockedTasks.length > 0) {
    failuresSection = blockedTasks
      .map(
        (bt) => `### Task \`${bt.id}\`: ${bt.title}
- **Status:** ${bt.status.toUpperCase()} (after ${bt.retries ?? 0} retries)
- **Error:**
\`\`\`
${bt.error ?? 'Unknown error'}
\`\`\`
`,
      )
      .join('\n');
  }

  return `# Project Walkthrough: ${task}

## Overview
- **Run ID:** \`${runId}\`
- **Result:** ${statusBadge}
- **Artifacts:** \`.agent/runs/${runId}/\`
- **Task Completion:** ${tasks.filter((t) => t.status === 'completed').length} / ${tasks.length} tasks completed

---

## What Was Built
${fileList}

---

## How to Run & Verify

### Run the Application
\`\`\`bash
${runCommand}
\`\`\`

### Run Tests
\`\`\`bash
${testCommand}
\`\`\`

---

## Task Execution Summary

| Task ID | Task Title | Status | Retries | Notes |
| :--- | :--- | :--- | :---: | :--- |
${taskRows.join('\n')}

---

## Failures & Blockers
${failuresSection}
`;
}
