import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ArtifactStore } from './store.js';
import {
  createModelMessageEvent,
  createRunFinishedEvent,
  createRunStartedEvent,
  createToolCallEvent,
  createToolResultEvent,
} from './events.js';

describe('ArtifactStore', () => {
  let tempDir: string;
  let store: ArtifactStore;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nirman-artifacts-test-'));
    store = new ArtifactStore(tempDir, 'test_run_123');
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('initializes .agent/runs/<run-id>/ directory with log.txt and tasks.json', async () => {
    await store.init('Build a to-do web application');

    expect(await fs.stat(store.runDir)).toBeDefined();
    expect(await fs.stat(store.logPath)).toBeDefined();
    expect(await fs.stat(store.tasksPath)).toBeDefined();

    const tasks = await store.readTasks();
    expect(tasks.runId).toBe('test_run_123');
    expect(tasks.task).toBe('Build a to-do web application');
    expect(tasks.status).toBe('planning');
    expect(tasks.stepsCount).toBe(0);

    const log = await store.readLog();
    expect(log).toContain('=== NIRMAN AGENT RUN LOG ===');
    expect(log).toContain('test_run_123');
  });

  it('appends events and updates tasks.json correctly', async () => {
    await store.init('Write a script');

    const startEvent = createRunStartedEvent(store.runId, 'Write a script');
    await store.appendEvent(startEvent);

    const modelEvent = createModelMessageEvent(
      store.runId,
      'assistant',
      'I will now call write_file',
    );
    await store.appendEvent(modelEvent);

    const toolCallEvent = createToolCallEvent(store.runId, 'call_1', 'write_file', {
      path: 'test.py',
    });
    await store.appendEvent(toolCallEvent);

    const toolResultEvent = createToolResultEvent(
      store.runId,
      'call_1',
      'write_file',
      true,
      'File written',
    );
    await store.appendEvent(toolResultEvent);

    const finishEvent = createRunFinishedEvent(store.runId, 'completed', 1, 150);
    await store.appendEvent(finishEvent);

    await store.updateTasks({
      status: 'completed',
      stepsCount: 1,
      completedAt: new Date().toISOString(),
    });

    const tasks = await store.readTasks();
    expect(tasks.status).toBe('completed');
    expect(tasks.stepsCount).toBe(1);
    expect(tasks.completedAt).toBeDefined();

    const log = await store.readLog();
    expect(log).toContain('[RUN_STARTED]');
    expect(log).toContain('[MODEL_MESSAGE]');
    expect(log).toContain('[TOOL_CALL] write_file');
    expect(log).toContain('[TOOL_RESULT] write_file');
    expect(log).toContain('[RUN_FINISHED] Status: completed');
  });

  it('writes and reads plan.md and SPEC.md', async () => {
    await store.init('Build a web service');

    const planContent = '# Execution Plan\n\n1. Step one\n2. Step two';
    const specContent = '# Project Spec\n\n- Stack: Node.js, Express';

    const planPath = await store.writePlan(planContent);
    const specPath = await store.writeSpec(specContent);

    expect(planPath).toBe(store.planPath);
    expect(specPath).toBe(store.specPath);

    expect(await store.readPlan()).toBe(planContent);
    expect(await store.readSpec()).toBe(specContent);
  });

  it('updates task item status in tasks.json', async () => {
    await store.init('Build a CLI tool');

    await store.updateTasks({
      tasks: [
        { id: 'step-1', title: 'Setup project', status: 'pending' },
        { id: 'step-2', title: 'Implement feature', status: 'pending' },
      ],
    });

    await store.updateTaskStatus('step-1', 'in_progress');
    let data = await store.readTasks();
    expect(data.tasks?.[0]?.status).toBe('in_progress');
    expect(data.tasks?.[1]?.status).toBe('pending');

    await store.updateTaskStatus('step-1', 'completed');
    await store.updateTaskStatus('step-2', 'in_progress');
    data = await store.readTasks();
    expect(data.tasks?.[0]?.status).toBe('completed');
    expect(data.tasks?.[1]?.status).toBe('in_progress');
  });
});
