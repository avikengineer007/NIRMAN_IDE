import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { RpcHandler } from './rpc-handler.js';
import { RunManager } from './run-manager.js';
import { MockModelClient } from '@nirman/model';

describe('RpcHandler JSON-RPC 2.0 Dispatcher', () => {
  let tempRepo: string;
  let runManager: RunManager;
  let rpcHandler: RpcHandler;

  beforeEach(async () => {
    tempRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'nirman-rpc-test-'));
    await fs.writeFile(path.join(tempRepo, 'README.md'), '# Repo', 'utf-8');

    runManager = new RunManager({
      modelClientFactory: () =>
        new MockModelClient([
          {
            response: 'Done',
          },
        ]),
    });
    rpcHandler = new RpcHandler(runManager);
  });

  afterEach(async () => {
    await runManager.cleanup();
    try {
      await fs.rm(tempRepo, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch {
      // ignore
    }
  });

  it('returns -32700 Parse error on malformed JSON', async () => {
    const res = await rpcHandler.handleRequest('{ bad json }');
    expect(res.error?.code).toBe(-32700);
    expect(res.error?.message).toContain('Parse error');
  });

  it('returns -32600 Invalid Request if jsonrpc version is missing or invalid', async () => {
    const res = await rpcHandler.handleRequest(JSON.stringify({ method: 'list_runs' }));
    expect(res.error?.code).toBe(-32600);
    expect(res.error?.message).toContain('Invalid Request');
  });

  it('returns -32601 Method not found for unknown methods', async () => {
    const res = await rpcHandler.handleRequest(
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'non_existent_method' }),
    );
    expect(res.error?.code).toBe(-32601);
    expect(res.error?.message).toContain('Unknown method');
  });

  it('handles start_run, list_runs, get_run, and cancel', async () => {
    // 1. start_run
    const startRes = await rpcHandler.handleRequest(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 'start-1',
        method: 'start_run',
        params: {
          task: 'Create test file',
          workspaceRoot: tempRepo,
          skipPlanning: true,
        },
      }),
    );

    expect(startRes.error).toBeUndefined();
    const startResult = startRes.result as { runId: string; status: string };
    expect(startResult.runId).toBeDefined();
    expect(startResult.status).toBeDefined();

    const runId = startResult.runId;

    // 2. list_runs
    const listRes = await rpcHandler.handleRequest(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 'list-1',
        method: 'list_runs',
      }),
    );
    expect(listRes.error).toBeUndefined();
    const runs = listRes.result as Array<{ runId: string }>;
    expect(runs.some((r) => r.runId === runId)).toBe(true);

    // 3. get_run
    const getRes = await rpcHandler.handleRequest(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 'get-1',
        method: 'get_run',
        params: { runId },
      }),
    );
    expect(getRes.error).toBeUndefined();
    const run = getRes.result as { runId: string; task: string };
    expect(run.runId).toBe(runId);
    expect(run.task).toBe('Create test file');

    // 4. cancel
    const cancelRes = await rpcHandler.handleRequest(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 'cancel-1',
        method: 'cancel',
        params: { runId },
      }),
    );
    expect(cancelRes.error).toBeUndefined();
    const cancelResult = cancelRes.result as { cancelled: boolean };
    expect(cancelResult.cancelled).toBe(true);
  });
});
