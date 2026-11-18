import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execSync, spawn, ChildProcess } from 'node:child_process';
import { runCli } from '../apps/cli/src/cli.js';
import { OpenAICompatibleClient } from '@nirman/model';

/**
 * [MODEL-DRIVEN via CLI/daemon, IDE not involved]
 * Step 16 Item 9: End-to-End Real Model Run
 *
 * Runs a complete real task with the local Qwen2.5-Coder 7B model on CUDA:
 * - Full flow: Plan -> Approve -> Execute -> Verify
 * - Records pass/fail, number of steps, time, and asserts all 4 run artifacts
 *   (plan.md, tasks.json, diff.patch, log.txt) exist and are non-empty.
 * - Teardown: stops llama-server, asserts PID is gone, asserts GPU memory released.
 */
describe('[MODEL-DRIVEN via CLI/daemon, IDE not involved] Step 16 Item 9: End-to-End Run', () => {
  const llamaPort = 8088;
  const installDir = 'C:\\Tools\\nirman';
  const workspaceDir = path.resolve(__dirname, '..', 'test-runs', 'e2e-model-workspace');
  const resultsJsonPath = path.resolve(__dirname, '..', 'test-runs', 'e2e-model-results.json');

  let llamaProcess: ChildProcess | null = null;
  let llamaPid: number | null = null;
  let memBefore = -1;
  let memDuring = -1;
  let memAfter = -1;

  function getGpuMemUsed(): number {
    try {
      const out = execSync('nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits', {
        encoding: 'utf-8',
        stdio: 'pipe',
      }).trim();
      return parseInt(out.split('\n')[0]!, 10);
    } catch {
      return -1;
    }
  }

  it(
    'executes real task through plan-approve-execute-verify with local model and verifies VRAM release',
    async () => {
      // 1. Measure GPU VRAM before launch
      memBefore = getGpuMemUsed();

      // Clean workspace
      if (fs.existsSync(workspaceDir)) {
        fs.rmSync(workspaceDir, { recursive: true, force: true });
      }
      fs.mkdirSync(workspaceDir, { recursive: true });

      // 2. Launch llama-server with CUDA 13 on port 8088
      const llamaExe = path.join(installDir, 'bin', 'llama-server.exe');
      const modelPath = path.join(installDir, 'models', 'qwen2.5-coder-7b-instruct-q4_k_m.gguf');
      const cudaDir = path.join(installDir, 'bin', 'cuda_v13');

      expect(fs.existsSync(llamaExe), 'llama-server.exe must exist in installDir').toBe(true);
      expect(fs.existsSync(modelPath), 'model GGUF must exist in installDir').toBe(true);

      const llamaEnv = {
        ...process.env,
        GGML_BACKEND_PATH: path.join(cudaDir, 'ggml-cuda.dll'),
        PATH: `${cudaDir};${path.join(installDir, 'bin')};${process.env['PATH'] || ''}`,
      };

      const llamaArgs = [
        '-m', modelPath,
        '-ngl', '99',
        '-c', '8192',
        '--host', '127.0.0.1',
        '--port', String(llamaPort),
        '-lv', '4',
      ];

      llamaProcess = spawn(llamaExe, llamaArgs, {
        env: llamaEnv,
        windowsHide: true,
        stdio: 'pipe',
      });
      llamaPid = llamaProcess.pid!;

      // Wait for /health endpoint
      const startTime = Date.now();
      let healthy = false;
      while (Date.now() - startTime < 60_000) {
        try {
          const res = execSync(
            `powershell -NoProfile -Command "(Invoke-RestMethod -Uri http://127.0.0.1:${llamaPort}/health -TimeoutSec 1).status"`,
            { encoding: 'utf-8', stdio: 'pipe' },
          ).trim();
          if (res === 'ok') {
            healthy = true;
            break;
          }
        } catch {}
        await new Promise((r) => setTimeout(r, 1000));
      }

      expect(healthy, 'llama-server failed to become healthy within 60s').toBe(true);
      memDuring = getGpuMemUsed();

      // 3. Run Agent Loop on a real small coding task
      const taskDescription =
        'Create a node file named calc.js that defines an add(a, b) function, calculates 15 + 27, and prints the sum using console.log. Then verify it by running node calc.js.';

      const modelClient = new OpenAICompatibleClient({
        baseUrl: `http://127.0.0.1:${llamaPort}/v1`,
        model: 'qwen2.5-coder',
        toolMode: 'native',
        timeoutMs: 90_000,
      });

      const runStart = Date.now();
      const logs: string[] = [];

      let runResult = null;
      let runError: string | null = null;

      try {
        runResult = await runCli(
          [
            'run',
            taskDescription,
            '--workspace', workspaceDir,
            '--auto-approve',
            '--max-steps', '8',
            '--max-time', '120000',
          ],
          (txt) => logs.push(txt),
          modelClient,
          {
            task: taskDescription,
            workspaceRoot: workspaceDir,
            autoApprove: true,
            maxSteps: 8,
          },
        );
      } catch (err: any) {
        runError = err.message || String(err);
      }

      const runElapsedMs = Date.now() - runStart;

      // 4. Assert and collect artifacts
      // Find latest run directory in .agent/runs
      const runsDir = path.join(workspaceDir, '.agent', 'runs');
      expect(fs.existsSync(runsDir), 'Agent runs directory must exist').toBe(true);

      const runEntries = fs.readdirSync(runsDir);
      expect(runEntries.length).toBeGreaterThan(0);
      const latestRunDir = path.join(runsDir, runEntries[runEntries.length - 1]!);

      const planPath = path.join(latestRunDir, 'plan.md');
      const tasksPath = path.join(latestRunDir, 'tasks.json');
      const patchPath = path.join(latestRunDir, 'diff.patch');
      const logPath = path.join(latestRunDir, 'log.txt');

      expect(fs.existsSync(planPath), 'plan.md must exist').toBe(true);
      expect(fs.existsSync(tasksPath), 'tasks.json must exist').toBe(true);
      expect(fs.existsSync(patchPath), 'diff.patch must exist').toBe(true);
      expect(fs.existsSync(logPath), 'log.txt must exist').toBe(true);

      const planContent = fs.readFileSync(planPath, 'utf-8');
      const tasksContent = fs.readFileSync(tasksPath, 'utf-8');
      const patchContent = fs.readFileSync(patchPath, 'utf-8');
      const logContent = fs.readFileSync(logPath, 'utf-8');

      expect(planContent.length, 'plan.md must be non-empty').toBeGreaterThan(0);
      expect(tasksContent.length, 'tasks.json must be non-empty').toBeGreaterThan(0);
      expect(patchContent.length, 'diff.patch must be non-empty').toBeGreaterThan(0);
      expect(logContent.length, 'log.txt must be non-empty').toBeGreaterThan(0);

      // Record detailed run metrics
      const runRecord = {
        timestamp: new Date().toISOString(),
        task: taskDescription,
        status: runResult?.status ?? (runError ? 'error' : 'unknown'),
        error: runError,
        stepsExecuted: runResult?.stepCount ?? 0,
        elapsedMs: runElapsedMs,
        artifacts: {
          planBytes: planContent.length,
          tasksBytes: tasksContent.length,
          patchBytes: patchContent.length,
          logBytes: logContent.length,
        },
        gpu: {
          memBeforeMiB: memBefore,
          memDuringMiB: memDuring,
        },
      };

      fs.writeFileSync(resultsJsonPath, JSON.stringify(runRecord, null, 2), 'utf-8');

      // 5. Teardown: Stop llama-server and verify process termination and VRAM release
      if (llamaProcess && !llamaProcess.killed) {
        try {
          execSync(`powershell -NoProfile -Command "Stop-Process -Id ${llamaPid} -Force"`);
        } catch {}
      }

      // Allow 3s for driver to release VRAM
      await new Promise((r) => setTimeout(r, 3000));

      const isPidAlive = execSync(
        `powershell -NoProfile -Command "$p = Get-Process -Id ${llamaPid} -ErrorAction SilentlyContinue; if ($p) { Write-Output 'ALIVE' } else { Write-Output 'DEAD' }"`,
        { encoding: 'utf-8' },
      ).trim();

      expect(isPidAlive).toBe('DEAD');

      memAfter = getGpuMemUsed();
      runRecord.gpu['memAfterMiB'] = memAfter;
      fs.writeFileSync(resultsJsonPath, JSON.stringify(runRecord, null, 2), 'utf-8');

      // Assert memory returned within tolerance
      const toleranceMiB = 350;
      expect(
        memAfter,
        `VRAM after (${memAfter} MiB) must return near baseline (${memBefore} MiB)`,
      ).toBeLessThanOrEqual(memBefore + toleranceMiB);
    },
    180_000,
  );
});
