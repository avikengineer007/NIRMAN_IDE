import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { LocalSandbox } from '@nirman/sandbox';
import { MockModelClient } from '@nirman/model';
import {
  TaskCheckRunner,
  EvalRunner,
  EvalReporter,
  ALL_EVAL_TASKS,
  type ComparisonReport,
  type EvalTask,
} from './index.js';

describe('Evaluation Harness Unit Tests', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nirman-eval-test-'));
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('validates 20 tasks exist across cli, api, ui, and algo categories', () => {
    expect(ALL_EVAL_TASKS).toHaveLength(20);
    const categories = new Set(ALL_EVAL_TASKS.map((t) => t.category));
    expect(categories.has('cli')).toBe(true);
    expect(categories.has('api')).toBe(true);
    expect(categories.has('ui')).toBe(true);
    expect(categories.has('algo')).toBe(true);
  });

  it('TaskCheckRunner executes test check and validates exit code and output', async () => {
    const sandbox = new LocalSandbox({ workspaceRoot: tempDir });
    await sandbox.writeFile('sum.js', 'console.log("RESULT: 42");\nprocess.exit(0);');

    const checker = new TaskCheckRunner(sandbox, tempDir);

    const passingCheck = await checker.runCheck({
      type: 'test',
      description: 'Check math result',
      command: 'node sum.js',
      expectedExitCode: 0,
      expectedOutput: 'RESULT: 42',
    });
    expect(passingCheck.passed).toBe(true);

    const failingCheck = await checker.runCheck({
      type: 'test',
      description: 'Check nonexistent output',
      command: 'node sum.js',
      expectedOutput: 'RESULT: 999',
    });
    expect(failingCheck.passed).toBe(false);
    expect(failingCheck.error).toContain('not found');
  });

  it('TaskCheckRunner executes UI check and checks required keywords', async () => {
    const sandbox = new LocalSandbox({ workspaceRoot: tempDir });
    await sandbox.writeFile(
      'index.html',
      '<html><body><button class="operator">+</button><div id="display">0</div></body></html>',
    );

    const checker = new TaskCheckRunner(sandbox, tempDir);

    const passingUi = await checker.runCheck({
      type: 'ui',
      description: 'Verify calculator DOM keywords',
      filePath: 'index.html',
      requiredKeywords: ['button', 'display', 'operator'],
    });
    expect(passingUi.passed).toBe(true);

    const failingUi = await checker.runCheck({
      type: 'ui',
      description: 'Verify missing keywords',
      filePath: 'index.html',
      requiredKeywords: ['stopwatch', 'lap-timer'],
    });
    expect(failingUi.passed).toBe(false);
    expect(failingUi.error).toContain('missing required element keyword');
  });

  it('EvalRunner runs single task with model client and diagnoses results', async () => {
    const sampleTask: EvalTask = {
      id: 'task-test-sample',
      title: 'Simple CLI Echo',
      category: 'cli',
      description: 'Create echo.js that prints "HELLO NIRMAN".',
      checks: [
        {
          type: 'test',
          description: 'Runs echo.js',
          command: 'node echo.js',
          expectedOutput: 'HELLO NIRMAN',
        },
      ],
    };

    const mockClient = new MockModelClient([
      {
        response: {
          content: 'Creating echo.js',
          toolCalls: [
            {
              id: 'call_echo',
              type: 'function',
              function: {
                name: 'write_file',
                arguments: JSON.stringify({
                  path: 'echo.js',
                  content: 'console.log("HELLO NIRMAN");\n',
                }),
              },
            },
          ],
        },
      },
      {
        response: 'Done creating echo.js',
      },
    ]);

    const runner = new EvalRunner({
      modelClient: mockClient,
      modelConfig: {
        baseUrl: 'http://127.0.0.1:11434/v1',
        model: 'qwen2.5-coder:7b',
        toolMode: 'fallback',
      },
      tasks: [sampleTask],
      baseWorkspaceDir: tempDir,
    });

    const result = await runner.runSingleTask(sampleTask);
    expect(result.passed).toBe(true);
    expect(result.failureCategory).toBe('none');
    expect(result.steps).toBeGreaterThan(0);
    expect(result.tokensUsed).toBeGreaterThan(0);
  });

  it('EvalReporter formats comparison report and exports markdown/json', async () => {
    const mockReport: ComparisonReport = {
      timestamp: new Date().toISOString(),
      benchmarks: [
        {
          modelName: 'qwen2.5-coder:7b',
          provider: 'Local Ollama',
          toolMode: 'fallback',
          totalTasks: 20,
          passedTasks: 13,
          passRatePercent: 65.0,
          avgSteps: 3.2,
          avgTokens: 2150,
          totalDurationMs: 45_000,
          failureBreakdown: {
            none: 13,
            bad_edits: 3,
            wrong_tool_use: 2,
            context_overflow: 0,
            stuck_loops: 1,
            timeout: 0,
            assertion_failed: 1,
          },
          taskResults: [
            {
              taskId: 'task-01-cli-csv-parser',
              title: 'CSV to JSON Converter CLI',
              category: 'cli',
              passed: true,
              steps: 2,
              tokensUsed: 1800,
              durationMs: 2500,
              failureCategory: 'none',
              checkResults: [{ check: 'Parses input.csv', passed: true }],
            },
          ],
        },
        {
          modelName: 'claude-3-5-sonnet-20241022',
          provider: 'Hosted Anthropic',
          toolMode: 'native',
          totalTasks: 20,
          passedTasks: 19,
          passRatePercent: 95.0,
          avgSteps: 2.1,
          avgTokens: 1450,
          totalDurationMs: 28_000,
          failureBreakdown: {
            none: 19,
            bad_edits: 0,
            wrong_tool_use: 0,
            context_overflow: 0,
            stuck_loops: 0,
            timeout: 0,
            assertion_failed: 1,
          },
          taskResults: [
            {
              taskId: 'task-01-cli-csv-parser',
              title: 'CSV to JSON Converter CLI',
              category: 'cli',
              passed: true,
              steps: 1,
              tokensUsed: 1200,
              durationMs: 1400,
              failureCategory: 'none',
              checkResults: [{ check: 'Parses input.csv', passed: true }],
            },
          ],
        },
      ],
      nextImprovements: [
        'Fuzzy Whitespace Tolerance & AST Search in edit_file',
        'Automatic Schema Coercion in Tool Call Fallback Parser',
        'Dynamic Prompt Rolling Compaction for 32K Context Windows',
        'Oscillation & Negative-Prior Loop Breaker',
        'Pre-Flight Verification & Dev Server Readiness Probing',
      ],
    };

    const outputDir = path.join(tempDir, 'reports');
    const { mdPath, jsonPath } = await EvalReporter.saveReport(mockReport, outputDir);

    const mdContent = await fs.readFile(mdPath, 'utf-8');
    expect(mdContent).toContain('# NIRMAN Model Evaluation & Benchmark Report');
    expect(mdContent).toContain('qwen2.5-coder:7b');
    expect(mdContent).toContain('claude-3-5-sonnet');
    expect(mdContent).toContain('65%');
    expect(mdContent).toContain('95%');
    expect(mdContent).toContain('Next 5 Proposed Improvements');

    const jsonContent = await fs.readFile(jsonPath, 'utf-8');
    const parsed = JSON.parse(jsonContent) as ComparisonReport;
    expect(parsed.benchmarks).toHaveLength(2);
    expect(parsed.nextImprovements).toHaveLength(5);
  });
});
