import fs from 'node:fs/promises';
import path from 'node:path';
import type { ComparisonReport } from './types.js';

export class EvalReporter {
  public static generateMarkdownReport(report: ComparisonReport): string {
    const { benchmarks, timestamp, nextImprovements } = report;

    const summaryTable = `
| Model / Configuration | Provider | Tool Mode | Pass Rate | Total Passed | Avg Steps | Avg Tokens | Total Time |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
${benchmarks
        .map(
          (b) =>
            `| **${b.modelName}** | ${b.provider} | \`${b.toolMode}\` | **${b.passRatePercent}%** | ${b.passedTasks} / ${b.totalTasks} | ${b.avgSteps} | ${b.avgTokens} | ${(b.totalDurationMs / 1000).toFixed(1)}s |`,
        )
        .join('\n')}
`;

    const failureCategoryTable = `
| Failure Category | ${benchmarks.map((b) => `**${b.modelName}**`).join(' | ')} |
| :--- | ${benchmarks.map(() => ':---:').join(' | ')} |
| **None (Passed)** | ${benchmarks.map((b) => b.failureBreakdown.none).join(' | ')} |
| **Bad Edits** (\`bad_edits\`) | ${benchmarks.map((b) => b.failureBreakdown.bad_edits).join(' | ')} |
| **Wrong Tool Use** (\`wrong_tool_use\`) | ${benchmarks.map((b) => b.failureBreakdown.wrong_tool_use).join(' | ')} |
| **Context Overflow** (\`context_overflow\`) | ${benchmarks.map((b) => b.failureBreakdown.context_overflow).join(' | ')} |
| **Stuck Loops** (\`stuck_loops\`) | ${benchmarks.map((b) => b.failureBreakdown.stuck_loops).join(' | ')} |
| **Timeouts** (\`timeout\`) | ${benchmarks.map((b) => b.failureBreakdown.timeout).join(' | ')} |
| **Assertion Failed** (\`assertion_failed\`) | ${benchmarks.map((b) => b.failureBreakdown.assertion_failed).join(' | ')} |
`;

    // Task-by-task matrix
    const firstBenchmark = benchmarks[0];
    const taskRows = (firstBenchmark?.taskResults ?? [])
      .map((task) => {
        const statuses = benchmarks.map((b) => {
          const match = b.taskResults.find((r) => r.taskId === task.taskId);
          if (!match) return '-';
          return match.passed ? '✅ PASS' : `❌ ${match.failureCategory}`;
        });
        return `| \`${task.taskId}\` | ${task.title} | ${task.category.toUpperCase()} | ${statuses.join(' | ')} |`;
      })
      .join('\n');

    const taskMatrixTable = `
| Task ID | Task Title | Category | ${benchmarks.map((b) => `**${b.modelName}**`).join(' | ')} |
| :--- | :--- | :---: | ${benchmarks.map(() => ':---:').join(' | ')} |
${taskRows}
`;

    const nextImprovementsList = nextImprovements
      .map((item, idx) => `### ${idx + 1}. ${item}`)
      .join('\n\n');

    return `# NIRMAN Model Evaluation & Benchmark Report

**Generated At:** ${timestamp}  
**Evaluated Tasks:** ${firstBenchmark?.totalTasks ?? 20} Tasks across CLI, REST API, UI, and Algorithms

---

## 1. Executive Summary: Model & Setting Comparison

${summaryTable}

---

## 2. Failure Category Breakdown

${failureCategoryTable}

---

## 3. Task-by-Task Result Matrix

${taskMatrixTable}

---

## 4. Next 5 Proposed Improvements (Derived from Failure Diagnostics)

${nextImprovementsList}
`;
  }

  public static async saveReport(
    report: ComparisonReport,
    outputDir: string,
  ): Promise<{ mdPath: string; jsonPath: string }> {
    await fs.mkdir(outputDir, { recursive: true });

    const mdContent = EvalReporter.generateMarkdownReport(report);
    const mdPath = path.join(outputDir, 'benchmark-report.md');
    await fs.writeFile(mdPath, mdContent, 'utf-8');

    const jsonPath = path.join(outputDir, 'benchmark-report.json');
    await fs.writeFile(jsonPath, JSON.stringify(report, null, 2), 'utf-8');

    return { mdPath, jsonPath };
  }
}

