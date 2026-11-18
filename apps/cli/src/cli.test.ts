import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MockModelClient } from '@nirman/model';
import { parseCliArgs, runCli } from './cli.js';
import { formatCliEvent } from './formatter.js';
import { createRunStartedEvent } from '@nirman/artifacts';

describe('CLI', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nirman-cli-test-'));
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch {
      // ignore
    }
  });

  describe('parseCliArgs', () => {
    it('returns null on empty args or help flag', () => {
      expect(parseCliArgs([])).toBeNull();
      expect(parseCliArgs(['--help'])).toBeNull();
      expect(parseCliArgs(['unknown'])).toBeNull();
    });

    it('parses valid run command and options', () => {
      const parsed = parseCliArgs([
        'run',
        'create hello.py',
        '--model',
        'qwen2.5-coder:7b',
        '--base-url',
        'http://localhost:8080/v1',
        '--tool-mode',
        'fallback',
        '--max-steps',
        '10',
      ]);

      expect(parsed).not.toBeNull();
      expect(parsed?.task).toBe('create hello.py');
      expect(parsed?.model).toBe('qwen2.5-coder:7b');
      expect(parsed?.baseUrl).toBe('http://localhost:8080/v1');
      expect(parsed?.toolMode).toBe('fallback');
      expect(parsed?.maxSteps).toBe(10);
    });
  });

  describe('formatCliEvent', () => {
    it('formats run_started cleanly', () => {
      const event = createRunStartedEvent('run_1', 'my task');
      const text = formatCliEvent(event);
      expect(text).toContain('NIRMAN RUN STARTED');
      expect(text).toContain('my task');
    });
  });

  describe('runCli integration', () => {
    it('streams events to terminal and completes task with mock model', async () => {
      const mockModel = new MockModelClient([
        // Step 1: Model writes python file
        {
          response: {
            content: 'Writing hello.py script',
            toolCalls: [
              {
                id: 'call_1',
                type: 'function',
                function: {
                  name: 'write_file',
                  arguments: JSON.stringify({
                    path: 'hello.py',
                    content: 'print("hello from nirman")\n',
                  }),
                },
              },
            ],
          },
        },
        // Step 2: Model finishes
        {
          response: 'hello.py has been created and verified.',
        },
      ]);

      const capturedOutput: string[] = [];
      const result = await runCli(
        ['run', 'create hello.py', '--workspace', tempDir, '--skip-planning'],
        (text) => capturedOutput.push(text),
        mockModel,
      );

      // Verify execution succeeded
      expect(result).not.toBeNull();
      expect(result?.status).toBe('completed');

      // Verify file was written
      const createdFile = await fs.readFile(path.join(tempDir, 'hello.py'), 'utf-8');
      expect(createdFile).toContain('print("hello from nirman")');

      // Verify terminal output streamed events
      const joined = capturedOutput.join('');
      expect(joined).toContain('NIRMAN RUN STARTED');
      expect(joined).toContain('write_file');
      expect(joined).toContain('NIRMAN RUN COMPLETED');
    }, 15_000);

    it('runs end-to-end describe, plan, edit, and approve flow', async () => {
      const mockModel = new MockModelClient([
        // 1. Clarification (at most 3 questions)
        {
          response: '{"questions": ["Which database would you prefer (SQLite or PostgreSQL)?"]}',
        },
        // 2. Initial Plan & Spec generation
        {
          response: `=== PLAN.MD ===
# Execution Plan for To-Do Web App

### Step 1: Create server skeleton
Initialize basic HTTP server with SQLite.

### Step 2: Implement task routes
Add CRUD endpoints for tasks.

=== SPEC.MD ===
# Project Spec
- Stack: Node.js, Express
- Commands:
  - Run: node server.js
  - Test: node server.js
`,
        },
        // 3. Tool execution after approval
        {
          response: {
            content: 'Creating server.js file',
            toolCalls: [
              {
                id: 'call_srv',
                type: 'function',
                function: {
                  name: 'write_file',
                  arguments: JSON.stringify({
                    path: 'server.js',
                    content: 'console.log("server ready");\n',
                  }),
                },
              },
            ],
          },
        },
        // 4. Model finishes Step 1
        {
          response: 'Step 1 server created.',
        },
        // 5. Model finishes Step 2
        {
          response: 'Step 2 routes created.',
        },
      ]);

      const capturedOutput: string[] = [];
      let clarificationAnswered = false;
      let editHandled = false;
      let approvedHandled = false;

      const result = await runCli(
        ['run', 'Build a to-do web application with login', '--workspace', tempDir],
        (text) => capturedOutput.push(text),
        mockModel,
        {
          onClarification: async (questions) => {
            await Promise.resolve();
            clarificationAnswered = true;
            expect(questions).toHaveLength(1);
            return { [questions[0]!]: 'SQLite' };
          },
          onApproval: async () => {
            await Promise.resolve();
            if (!editHandled) {
              editHandled = true;
              return {
                action: 'edited',
                editedPlan: `# Custom Execution Plan\n\n### Step 1: Create custom server\nCustom server creation.\n\n### Step 2: Implement custom routes\nCustom routes.\n`,
              };
            }
            approvedHandled = true;
            return { action: 'approve' };
          },
        },
      );

      expect(result).not.toBeNull();
      expect(result?.status).toBe('completed');
      expect(clarificationAnswered).toBe(true);
      expect(editHandled).toBe(true);
      expect(approvedHandled).toBe(true);

      // Verify files generated
      const createdServer = await fs.readFile(path.join(tempDir, 'server.js'), 'utf-8');
      expect(createdServer).toContain('server ready');

      const specFile = await fs.readFile(path.join(tempDir, 'SPEC.md'), 'utf-8');
      expect(specFile).toContain('# Project Spec');

      // Verify plan.md in .agent/runs/<run-id>/
      const planFile = await fs.readFile(result!.artifacts.planPath, 'utf-8');
      expect(planFile).toContain('Custom Execution Plan');

      // Verify tasks tracking in tasks.json
      const tasksData = await result!.artifacts.readTasks();
      expect(tasksData.status).toBe('completed');
      expect(tasksData.tasks).toHaveLength(2);
      expect(tasksData.tasks?.[0]?.title).toBe('Create custom server');
      expect(tasksData.tasks?.every((t) => t.status === 'completed')).toBe(true);

      // Verify CLI streamed output
      const output = capturedOutput.join('');
      expect(output).toContain('❓ [Clarifications Requested]');
      expect(output).toContain('=== EXECUTION PLAN CREATED ===');
      expect(output).toContain('✔ [Plan Approved]');
      expect(output).toContain('NIRMAN RUN COMPLETED');
    }, 15_000);
  });
});
