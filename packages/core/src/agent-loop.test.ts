import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MockModelClient } from '@nirman/model';
import { LocalSandbox } from '@nirman/sandbox';
import { createDefaultToolRegistry } from '@nirman/tools';
import { ArtifactStore, type AgentEvent } from '@nirman/artifacts';
import { runAgentLoop } from './agent-loop.js';

describe('runAgentLoop', () => {
  let tempDir: string;
  let sandbox: LocalSandbox;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nirman-core-test-'));
    sandbox = new LocalSandbox({ workspaceRoot: tempDir });
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch {
      // ignore
    }
  });

  it('completes a scripted run that creates a file and finishes', async () => {
    const mockModel = new MockModelClient([
      // Step 1: Model requests write_file
      {
        response: {
          content: 'Creating the file now.',
          toolCalls: [
            {
              id: 'call_write_1',
              type: 'function',
              function: {
                name: 'write_file',
                arguments: JSON.stringify({
                  path: 'hello.txt',
                  content: 'Hello Nirman!',
                }),
              },
            },
          ],
        },
      },
      // Step 2: Model finishes
      {
        response: 'I have created hello.txt with the requested text. Task complete.',
      },
    ]);

    const artifacts = new ArtifactStore(tempDir, 'scripted_run_1');
    const events: AgentEvent[] = [];

    const iterator = runAgentLoop({
      task: 'Create hello.txt with content Hello Nirman!',
      workspaceRoot: tempDir,
      modelClient: mockModel,
      sandbox,
      artifacts,
      tools: createDefaultToolRegistry(),
      skipPlanning: true,
    });

    for await (const event of iterator) {
      events.push(event);
    }

    // 1. Verify file was created in sandbox
    const createdFile = await sandbox.readFile('hello.txt');
    expect(createdFile).toBe('Hello Nirman!');

    // 2. Verify all event types were emitted
    const types = events.map((e) => e.type);
    expect(types).toContain('run_started');
    expect(types).toContain('model_message');
    expect(types).toContain('tool_call');
    expect(types).toContain('tool_result');
    expect(types).toContain('run_finished');

    // 3. Verify .agent/runs/<run-id>/ artifacts
    const tasks = await artifacts.readTasks();
    expect(tasks.status).toBe('completed');
    expect(tasks.stepsCount).toBe(2);

    const log = await artifacts.readLog();
    expect(log).toContain('[TOOL_CALL] write_file');
    expect(log).toContain('[TOOL_RESULT] write_file');
    expect(log).toContain('[RUN_FINISHED] Status: completed');
  }, 15_000);

  it('stops when maxSteps limit is reached', async () => {
    const mockModel = new MockModelClient([
      {
        response: {
          content: 'Doing step 1',
          toolCalls: [
            {
              id: 'c1',
              type: 'function',
              function: {
                name: 'read_file',
                arguments: JSON.stringify({ path: 'nonexistent.txt' }),
              },
            },
          ],
        },
      },
      {
        response: {
          content: 'Doing step 2',
          toolCalls: [
            {
              id: 'c2',
              type: 'function',
              function: {
                name: 'read_file',
                arguments: JSON.stringify({ path: 'nonexistent.txt' }),
              },
            },
          ],
        },
      },
    ]);

    const events: AgentEvent[] = [];
    const iterator = runAgentLoop({
      task: 'Infinite loop test',
      workspaceRoot: tempDir,
      modelClient: mockModel,
      sandbox,
      maxSteps: 1, // hard stop after 1 step
      skipPlanning: true,
    });

    for await (const event of iterator) {
      events.push(event);
    }

    const finishEvent = events.find((e) => e.type === 'run_finished');
    expect(finishEvent).toBeDefined();
    if (finishEvent && finishEvent.type === 'run_finished') {
      expect(finishEvent.status).toBe('failed');
      expect(finishEvent.reason).toContain('Max steps limit');
    }
  });

  it('stops when maxTimeMs limit is reached', async () => {
    const mockModel = new MockModelClient([
      {
        response: {
          content: 'Step 1',
          toolCalls: [
            {
              id: 'c1',
              type: 'function',
              function: {
                name: 'run_shell',
                arguments: JSON.stringify({ command: 'Start-Sleep -Milliseconds 200' }),
              },
            },
          ],
        },
      },
    ]);

    const events: AgentEvent[] = [];
    const iterator = runAgentLoop({
      task: 'Timeout test',
      workspaceRoot: tempDir,
      modelClient: mockModel,
      sandbox,
      maxTimeMs: 50, // very short timeout
      skipPlanning: true,
    });

    for await (const event of iterator) {
      events.push(event);
    }

    const finishEvent = events.find((e) => e.type === 'run_finished');
    expect(finishEvent).toBeDefined();
    if (finishEvent && finishEvent.type === 'run_finished') {
      expect(finishEvent.status).toBe('failed');
      expect(finishEvent.reason).toContain('Max execution time');
    }
  });

  it('runs planning phase end-to-end with clarification, plan creation, approval, and task execution', async () => {
    const mockModel = new MockModelClient([
      // 1. Clarification check
      {
        response: '{"questions": ["Which database would you prefer?"]}',
      },
      // 2. Plan and Spec generation
      {
        response: `=== PLAN.MD ===
# Execution Plan

### Step 1: Create application file
Create app.js with basic logic.

### Step 2: Run verification
Verify the application works.

=== SPEC.MD ===
# SPEC.MD
- Stack: Node.js
- Commands:
  - Run: node app.js
`,
      },
      // 3. Execution Step 1: Tool call write_file
      {
        response: {
          content: 'Creating app.js',
          toolCalls: [
            {
              id: 'c_write',
              type: 'function',
              function: {
                name: 'write_file',
                arguments: JSON.stringify({ path: 'app.js', content: 'console.log("running");' }),
              },
            },
          ],
        },
      },
      // 4. Execution Step 1: Conclude
      {
        response: 'Step 1 complete.',
      },
      // 5. Execution Step 2: Conclude
      {
        response: 'Step 2 complete and verified.',
      },
    ]);

    const artifacts = new ArtifactStore(tempDir, 'plan_run_1');
    const events: AgentEvent[] = [];
    let clarificationHandled = false;
    let approvalHandled = false;

    const iterator = runAgentLoop({
      task: 'Build a Node app',
      workspaceRoot: tempDir,
      modelClient: mockModel,
      sandbox,
      artifacts,
      tools: createDefaultToolRegistry(),
      onClarification: async (questions) => {
        await Promise.resolve();
        clarificationHandled = true;
        expect(questions).toHaveLength(1);
        return { [questions[0]!]: 'SQLite' };
      },
      onApproval: async (planPath, specPath, tasks) => {
        await Promise.resolve();
        approvalHandled = true;
        expect(planPath).toBe(artifacts.planPath);
        expect(specPath).toBe(artifacts.specPath);
        expect(tasks).toHaveLength(2);
        return { action: 'approve' };
      },
    });

    for await (const event of iterator) {
      events.push(event);
    }

    expect(clarificationHandled).toBe(true);
    expect(approvalHandled).toBe(true);

    // Verify plan.md and SPEC.md were created
    const planOnDisk = await artifacts.readPlan();
    expect(planOnDisk).toContain('### Step 1: Create application file');

    const specOnDisk = await artifacts.readSpec();
    expect(specOnDisk).toContain('# SPEC.MD');

    // Verify events sequence
    const types = events.map((e) => e.type);
    expect(types).toContain('clarification_requested');
    expect(types).toContain('plan_created');
    expect(types).toContain('plan_approved');
    expect(types).toContain('task_status_changed');
    expect(types).toContain('tool_call');
    expect(types).toContain('run_finished');

    // Verify tasks.json
    const tasksData = await artifacts.readTasks();
    expect(tasksData.status).toBe('completed');
    expect(tasksData.tasks).toHaveLength(2);
    expect(tasksData.tasks?.every((t) => t.status === 'completed')).toBe(true);
  });

  it('handles user feedback and plan revision before approval', async () => {
    const mockModel = new MockModelClient([
      // 1. Clarification (none needed)
      {
        response: '{"questions": []}',
      },
      // 2. Initial Plan
      {
        response: `=== PLAN.MD ===
# Initial Plan
### Step 1: Initial Task
Initial task description.
=== SPEC.MD ===
# Initial Spec
`,
      },
      // 3. Plan Revision after user feedback
      {
        response: `=== PLAN.MD ===
# Revised Plan
### Step 1: Revised Task with Tests
Revised task description including tests.
=== SPEC.MD ===
# Revised Spec
`,
      },
      // 4. Execution Step: Finish immediately
      {
        response: 'Executed revised plan successfully.',
      },
    ]);

    const artifacts = new ArtifactStore(tempDir, 'plan_run_revised');
    const events: AgentEvent[] = [];
    let feedbackGiven = false;

    const iterator = runAgentLoop({
      task: 'Build a project with tests',
      workspaceRoot: tempDir,
      modelClient: mockModel,
      sandbox,
      artifacts,
      onApproval: async () => {
        await Promise.resolve();
        if (!feedbackGiven) {
          feedbackGiven = true;
          return { action: 'feedback', feedback: 'Please add automated tests' };
        }
        return { action: 'approve' };
      },
    });

    for await (const event of iterator) {
      events.push(event);
    }

    expect(feedbackGiven).toBe(true);
    const types = events.map((e) => e.type);
    expect(types).toContain('plan_revision_requested');
    expect(types).toContain('plan_approved');

    const finalPlan = await artifacts.readPlan();
    expect(finalPlan).toContain('Revised Task with Tests');
  });

  it('cancels run immediately without executing tools if user rejects plan', async () => {
    const mockModel = new MockModelClient([
      // 1. Clarifications
      { response: '{"questions": []}' },
      // 2. Initial Plan
      {
        response: `=== PLAN.MD ===
# Plan
### Step 1: Task 1
=== SPEC.MD ===
# Spec
`,
      },
    ]);

    const artifacts = new ArtifactStore(tempDir, 'plan_run_rejected');
    const events: AgentEvent[] = [];

    const iterator = runAgentLoop({
      task: 'Build something rejected',
      workspaceRoot: tempDir,
      modelClient: mockModel,
      sandbox,
      artifacts,
      onApproval: async () => {
        await Promise.resolve();
        return {
          action: 'reject',
          reason: 'Architecture rejected by user',
        };
      },
    });

    for await (const event of iterator) {
      events.push(event);
    }

    const finishEvent = events.find((e) => e.type === 'run_finished');
    expect(finishEvent).toBeDefined();
    if (finishEvent && finishEvent.type === 'run_finished') {
      expect(finishEvent.status).toBe('cancelled');
      expect(finishEvent.reason).toContain('Architecture rejected');
    }

    // Ensure no tools were called
    expect(events.some((e) => e.type === 'tool_call')).toBe(false);

    const tasksData = await artifacts.readTasks();
    expect(tasksData.status).toBe('cancelled');
  });

  it('retries a task on verification failure, feeds relevant error, and completes when fixed', async () => {
    const mockModel = new MockModelClient([
      // 1. Initial attempt: writes faulty file
      {
        response: {
          content: 'Creating calculator with bug',
          toolCalls: [
            {
              id: 'c1',
              type: 'function',
              function: {
                name: 'write_file',
                arguments: JSON.stringify({
                  path: 'calc.js',
                  content: 'module.exports = { add: () => 0 };\n',
                }),
              },
            },
            {
              id: 'c2',
              type: 'function',
              function: {
                name: 'write_file',
                arguments: JSON.stringify({
                  path: 'test.js',
                  content:
                    'const { add } = require("./calc"); const assert = require("assert"); assert.strictEqual(add(2, 2), 4);\n',
                }),
              },
            },
          ],
        },
      },
      // 2. Conclude attempt 1 (triggers verification `node test.js` which fails)
      {
        response: 'Calculator and test created.',
      },
      // 3. Fix attempt: model receives AssertionError error and fixes calc.js
      {
        response: {
          content: 'Fixing addition logic in calc.js',
          toolCalls: [
            {
              id: 'c3',
              type: 'function',
              function: {
                name: 'write_file',
                arguments: JSON.stringify({
                  path: 'calc.js',
                  content: 'module.exports = { add: (a, b) => a + b };\n',
                }),
              },
            },
          ],
        },
      },
      // 4. Conclude fix attempt (triggers verification which now passes!)
      {
        response: 'Bug fixed, tests should pass now.',
      },
    ]);

    const artifacts = new ArtifactStore(tempDir, 'retry_run_1');
    const events: AgentEvent[] = [];

    // Pre-create SPEC.md with verification test command
    await artifacts.writeSpec('# Spec\n## Commands\n- Test: node test.js\n');

    const iterator = runAgentLoop({
      task: 'Build calculator: node test.js',
      workspaceRoot: tempDir,
      modelClient: mockModel,
      sandbox,
      artifacts,
      skipPlanning: true,
      maxRetriesPerTask: 3,
    });

    for await (const event of iterator) {
      events.push(event);
    }

    // Verify retry event was emitted
    const retryEvent = events.find((e) => e.type === 'task_retry');
    expect(retryEvent).toBeDefined();
    if (retryEvent && retryEvent.type === 'task_retry') {
      expect(retryEvent.attempt).toBe(1);
      expect(retryEvent.error).toMatch(/AssertionError|ERR_ASSERTION|0 !== 4/);
    }

    // Verify task passed and diff.patch was written
    const tasksData = await artifacts.readTasks();
    expect(tasksData.status).toBe('completed');
    expect(tasksData.tasks?.[0]?.status).toBe('completed');
    expect(tasksData.tasks?.[0]?.retries).toBe(1);

    // Verify walkthrough.md exists
    const walkthrough = await artifacts.readWalkthrough();
    expect(walkthrough).toContain('# Project Walkthrough');
    expect(walkthrough).toContain('node test.js');

    // Verify diff.patch exists
    const diff = await artifacts.readRunDiff();
    expect(diff).toContain('calc.js');
  });

  it('caps retries on persistent verification failure, marks task blocked, and saves walkthrough.md', async () => {
    const mockModel = new MockModelClient([
      // Initial attempt
      {
        response: {
          content: 'Attempt 1',
          toolCalls: [
            {
              id: 'c1',
              type: 'function',
              function: {
                name: 'write_file',
                arguments: JSON.stringify({ path: 'test.js', content: 'process.exit(1);\n' }),
              },
            },
          ],
        },
      },
      { response: 'Done attempt 1' },
      // Retry attempt 1
      { response: 'Attempt 2: trying again' },
      // Retry attempt 2
      { response: 'Attempt 3: trying again' },
    ]);

    const artifacts = new ArtifactStore(tempDir, 'blocked_run_1');
    const events: AgentEvent[] = [];

    await artifacts.writeSpec('# Spec\n## Commands\n- Test: node test.js\n');

    const iterator = runAgentLoop({
      task: 'Build persistently failing app',
      workspaceRoot: tempDir,
      modelClient: mockModel,
      sandbox,
      artifacts,
      skipPlanning: true,
      maxRetriesPerTask: 2, // cap at 2 retries
    });

    for await (const event of iterator) {
      events.push(event);
    }

    // Verify task status changed to blocked
    const blockedEvent = events.find(
      (e) => e.type === 'task_status_changed' && e.status === 'blocked',
    );
    expect(blockedEvent).toBeDefined();

    const tasksData = await artifacts.readTasks();
    expect(tasksData.status).toBe('blocked');
    expect(tasksData.tasks?.[0]?.status).toBe('blocked');
    expect(tasksData.tasks?.[0]?.retries).toBe(3); // attempt 1 + 2 retries = 3

    // Verify walkthrough explains blocker
    const walkthrough = await artifacts.readWalkthrough();
    expect(walkthrough).toContain('🛑 BLOCKED');
    expect(walkthrough).toContain('Failures & Blockers');
  });
});
