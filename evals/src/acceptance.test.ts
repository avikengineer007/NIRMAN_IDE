import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { runEvaluationHarness } from './cli.js';
import { ALL_EVAL_TASKS } from './tasks.js';
import type { ComparisonReport } from './types.js';

describe('Step 14 Acceptance: 20-Task Evaluation Harness with Baseline vs Hosted Comparison', () => {
  let tempReportsDir: string;
  let report: ComparisonReport;

  beforeAll(async () => {
    tempReportsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nirman-eval-reports-'));

    // Execute the full evaluation harness
    report = await runEvaluationHarness({
      localModelUrl: 'http://127.0.0.1:11434/v1',
      localModelName: 'qwen2.5-coder:7b',
      outputDir: tempReportsDir,
    });
  }, 120_000);

  afterAll(async () => {
    try {
      await fs.rm(tempReportsDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('evaluates all 20 project-description tasks with automated pass/fail checks', () => {
    expect(ALL_EVAL_TASKS).toHaveLength(20);
    expect(report.benchmarks).toHaveLength(2);

    const [localSummary, hostedSummary] = report.benchmarks;
    expect(localSummary?.totalTasks).toBe(20);
    expect(hostedSummary?.totalTasks).toBe(20);
  });

  it('produces a baseline report for local model and comparison against stronger hosted model', () => {
    const [localSummary, hostedSummary] = report.benchmarks;
    expect(localSummary?.modelName).toBe('qwen2.5-coder:7b');
    expect(localSummary?.provider).toContain('Local');

    expect(hostedSummary?.modelName).toContain('claude-3-5-sonnet');
    expect(hostedSummary?.provider).toContain('Hosted');

    // Both models track pass rate, steps, tokens, duration, and failure categories
    expect(localSummary?.passRatePercent).toBeGreaterThanOrEqual(0);
    expect(hostedSummary?.passRatePercent).toBeGreaterThanOrEqual(localSummary?.passRatePercent ?? 0);

    expect(localSummary?.avgSteps).toBeGreaterThan(0);
    expect(localSummary?.avgTokens).toBeGreaterThan(0);
    expect(localSummary?.totalDurationMs).toBeGreaterThan(0);

    // Verify failure breakdown categories
    expect(localSummary?.failureBreakdown).toHaveProperty('none');
    expect(localSummary?.failureBreakdown).toHaveProperty('bad_edits');
    expect(localSummary?.failureBreakdown).toHaveProperty('wrong_tool_use');
    expect(localSummary?.failureBreakdown).toHaveProperty('context_overflow');
    expect(localSummary?.failureBreakdown).toHaveProperty('stuck_loops');
  });

  it('generates benchmark-report.md and benchmark-report.json on disk', async () => {
    const mdPath = path.join(tempReportsDir, 'benchmark-report.md');
    const jsonPath = path.join(tempReportsDir, 'benchmark-report.json');

    const mdStat = await fs.stat(mdPath);
    expect(mdStat.isFile()).toBe(true);
    expect(mdStat.size).toBeGreaterThan(500);

    const jsonStat = await fs.stat(jsonPath);
    expect(jsonStat.isFile()).toBe(true);

    const mdContent = await fs.readFile(mdPath, 'utf-8');
    expect(mdContent).toContain('NIRMAN Model Evaluation & Benchmark Report');
    expect(mdContent).toContain('Executive Summary');
    expect(mdContent).toContain('Failure Category Breakdown');
    expect(mdContent).toContain('Next 5 Proposed Improvements');
  });

  it('derives the next 5 concrete improvements from empirical failure analysis', () => {
    expect(report.nextImprovements).toHaveLength(5);

    const improvementText = report.nextImprovements.join('\n');
    expect(improvementText).toContain('edit_file');
    expect(improvementText).toContain('Fallback Parser');
    expect(improvementText).toContain('Context Windows');
    expect(improvementText).toContain('Loop Breaker');
    expect(improvementText).toContain('Readiness Probing');
  });
});

