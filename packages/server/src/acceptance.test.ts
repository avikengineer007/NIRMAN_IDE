import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { NirmanDaemon } from './daemon.js';
import { NirmanClient } from './client.js';
import { RunManager } from './run-manager.js';
import { MockModelClient } from '@nirman/model';
import type { AgentEvent } from '@nirman/artifacts';

describe('Step 10 Acceptance: WebSocket JSON-RPC Daemon with Parallel Runs, Worktrees & Client Control', () => {
  let tempRepo: string;
  let tempWorktreesDir: string;
  let daemon: NirmanDaemon;
  let client: NirmanClient;

  // Track events received by client over WebSocket
  const receivedEvents: Array<{ runId: string; event: AgentEvent }> = [];

  beforeAll(async () => {
    // 1. Setup temporary repository
    tempRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'nirman-acceptance-repo-'));
    tempWorktreesDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nirman-acceptance-wts-'));

    await fs.writeFile(
      path.join(tempRepo, 'package.json'),
      '{"name": "acceptance-sample-app", "version": "1.0.0", "scripts": {"test": "node index.js"}}',
      'utf-8',
    );
    await fs.writeFile(
      path.join(tempRepo, 'index.js'),
      'console.log("Main repo original code");\n',
      'utf-8',
    );

    // 2. Initialize RunManager with MockModelClient for deterministic testing
    const runManager = new RunManager({
      baseWorktreesDir: tempWorktreesDir,
      modelClientFactory: (config) => {
        const isRun2 = config?.model === 'mock-run-2';
        if (isRun2) {
          // Model responses for Run 2 (creates feat2.js)
          return new MockModelClient([
            {
              response: {
                content: 'Creating feat2.js in worktree 2',
                toolCalls: [
                  {
                    id: 'call_f2',
                    type: 'function',
                    function: {
                      name: 'write_file',
                      arguments: JSON.stringify({
                        path: 'feat2.js',
                        content: 'console.log("Run 2 Feature");\n',
                      }),
                    },
                  },
                ],
              },
            },
            {
              response: 'Run 2 finished creating feat2.js',
            },
          ]);
        }

        // Model responses for Run 1 (Clarify -> Plan -> Approve -> creates feat1.js)
        return new MockModelClient([
          // 0. Clarification query (returns empty questions array)
          {
            response: '{"questions": []}',
          },
          // 1. Plan generation
          {
            response: `=== PLAN.MD ===
# Execution Plan for Feature 1
### Step 1: Implement feat1.js
Create feature 1 module.

=== SPEC.MD ===
# Project Spec
- Stack: Node.js
- Commands:
  - Run: node feat1.js
  - Test: node feat1.js
`,
          },
          // 2. Execution step after approval
          {
            response: {
              content: 'Creating feat1.js in worktree 1',
              toolCalls: [
                {
                  id: 'call_f1',
                  type: 'function',
                  function: {
                    name: 'write_file',
                    arguments: JSON.stringify({
                      path: 'feat1.js',
                      content: 'console.log("Run 1 Feature");\n',
                    }),
                  },
                },
              ],
            },
          },
          // 3. Conclude
          {
            response: 'Run 1 successfully created feat1.js and verified.',
          },
        ]);
      },
    });

    // 3. Start NirmanDaemon on localhost with ephemeral port and auth token
    daemon = new NirmanDaemon(
      {
        host: '127.0.0.1',
        port: 0,
        baseWorktreesDir: tempWorktreesDir,
      },
      runManager,
    );

    await daemon.start();

    // 4. Initialize NirmanClient and connect to the daemon over WebSocket
    client = new NirmanClient({
      url: daemon.getUrl(),
      token: daemon.getToken(),
    });

    await client.connect();

    // Subscribe to event stream
    client.onEvent((notification) => {
      receivedEvents.push(notification);
    });
  });

  afterAll(async () => {
    client.close();
    await daemon.close();

    try {
      await fs.rm(tempRepo, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      await fs.rm(tempWorktreesDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch {
      // ignore
    }
  });

  it('runs two parallel runs against the same repo without conflicts, streams events, and supports approve, pause, resume, and cancel', async () => {
    // =========================================================================
    // 1. Start Run 1 (Requires planning approval)
    // =========================================================================
    const run1 = await client.startRun({
      task: 'Build Feature 1 in parallel',
      workspaceRoot: tempRepo,
      skipPlanning: false,
    });

    expect(run1.runId).toBeDefined();
    expect(run1.worktreePath).toBeDefined();
    expect(run1.gitBranch).toContain(run1.runId);

    // =========================================================================
    // 2. Start Run 2 (Parallel run against the SAME repo with its own worktree)
    // =========================================================================
    const run2 = await client.startRun({
      task: 'Build Feature 2 concurrently',
      workspaceRoot: tempRepo,
      skipPlanning: true,
      modelConfig: { model: 'mock-run-2', baseUrl: 'http://127.0.0.1:11434/v1' },
    });

    expect(run2.runId).toBeDefined();
    expect(run2.runId).not.toBe(run1.runId);
    expect(run2.worktreePath).not.toBe(run1.worktreePath);

    // Both runs exist in list_runs
    const allRuns = await client.listRuns();
    expect(allRuns.length).toBeGreaterThanOrEqual(2);
    expect(allRuns.some((r) => r.runId === run1.runId)).toBe(true);
    expect(allRuns.some((r) => r.runId === run2.runId)).toBe(true);

    // =========================================================================
    // 3. Test Event Streaming: Wait until Run 1 reaches waiting_approval
    // =========================================================================
    let run1PlanApproved = false;
    const maxWaitMs = 10_000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      const r1 = await client.getRun(run1.runId);
      if (r1.status === 'waiting_approval') {
        // Run 1 is waiting for plan approval
        expect(r1.tasks?.length).toBeGreaterThan(0);

        // Test Pause and Resume
        const pauseRes = await client.pause(run1.runId);
        expect(pauseRes.paused).toBe(true);
        const r1Paused = await client.getRun(run1.runId);
        expect(r1Paused.status).toBe('paused');

        const resumeRes = await client.resume(run1.runId);
        expect(resumeRes.resumed).toBe(true);

        // Approve the plan
        const approveRes = await client.approvePlan(run1.runId);
        expect(approveRes.approved).toBe(true);
        run1PlanApproved = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }

    expect(run1PlanApproved).toBe(true);

    // =========================================================================
    // 4. Test Cancel on Run 2 while running
    // =========================================================================
    const cancelRes = await client.cancel(run2.runId);
    expect(cancelRes.cancelled).toBe(true);

    const r2Status = await client.getRun(run2.runId);
    expect(r2Status.status).toBe('cancelled');

    // =========================================================================
    // 5. Wait for Run 1 to complete its task
    // =========================================================================
    const run1WaitStart = Date.now();
    let run1Completed = false;

    while (Date.now() - run1WaitStart < maxWaitMs) {
      const r1 = await client.getRun(run1.runId);
      if (r1.status === 'completed') {
        run1Completed = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }

    expect(run1Completed).toBe(true);

    // =========================================================================
    // 6. Verify Worktree Isolation & Zero Conflicts
    // =========================================================================
    // Verify Run 1 created feat1.js inside its worktree
    const feat1Stat = await fs.stat(path.join(run1.worktreePath, 'feat1.js'));
    expect(feat1Stat.isFile()).toBe(true);

    const feat1Content = await fs.readFile(path.join(run1.worktreePath, 'feat1.js'), 'utf-8');
    expect(feat1Content).toContain('Run 1 Feature');

    // Verify main repository was NOT affected or corrupted
    await expect(fs.stat(path.join(tempRepo, 'feat1.js'))).rejects.toThrow();

    // =========================================================================
    // 7. Test Artifact Listing and Reading
    // =========================================================================
    const artifacts = await client.listArtifacts(run1.runId);
    expect(artifacts.length).toBeGreaterThan(0);
    expect(artifacts.some((a) => a.name === 'tasks.json')).toBe(true);
    expect(artifacts.some((a) => a.name === 'log.txt')).toBe(true);
    expect(artifacts.some((a) => a.name === 'plan.md')).toBe(true);

    // Read tasks.json
    const tasksArtifact = await client.readArtifact(run1.runId, 'tasks.json');
    expect(tasksArtifact.artifactName).toBe('tasks.json');
    expect(tasksArtifact.content).toContain('"status": "completed"');

    // Read log.txt
    const logArtifact = await client.readArtifact(run1.runId, 'log.txt');
    expect(logArtifact.content).toContain('[RUN_STARTED]');
    expect(logArtifact.content).toContain('[PLAN_APPROVED]');

    // =========================================================================
    // 8. Verify Typed Event Stream over WebSocket
    // =========================================================================
    expect(receivedEvents.length).toBeGreaterThan(5);
    const eventTypes = receivedEvents.map((e) => e.event.type);
    expect(eventTypes).toContain('run_started');
    expect(eventTypes).toContain('plan_created');
    expect(eventTypes).toContain('plan_approved');
    expect(eventTypes).toContain('tool_call');
    expect(eventTypes).toContain('tool_result');
    expect(eventTypes).toContain('run_finished');
  }, 25_000);
});
