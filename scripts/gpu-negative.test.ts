import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync, ChildProcess } from 'node:child_process';

/**
 * [SCRIPTED TEST]
 * Step 16 Item 11: Negative GPU Verification (Zero Layers Offloaded)
 * Confirms that start.ps1 refuses to start and fails loudly if llama-server
 * reports 0 layers offloaded to GPU, without falling back to CPU silently.
 */
describe('[SCRIPTED] Step 16 Item 11: Negative GPU Verification', () => {
  const fakeDir = path.resolve(__dirname, '..', 'test-runs', 'gpu-negative-test');
  const binDir = path.join(fakeDir, 'bin');
  const cudaDir = path.join(binDir, 'cuda_v13');
  const startScript = path.resolve(__dirname, 'start.ps1');
  const mockHealthScript = path.resolve(__dirname, '..', 'test-runs', 'mock-health.cjs');

  beforeAllSetup();

  function beforeAllSetup() {
    fs.mkdirSync(cudaDir, { recursive: true });
    fs.writeFileSync(path.join(cudaDir, 'ggml-cuda.dll'), 'mock-dll', 'utf-8');

    // Fake llama-server that simulates 0 layers offloaded
    const fakeServerScript = [
      '@echo off',
      'echo using device CUDA0',
      'echo offloaded 0/29 layers to GPU',
      ':loop',
      'ping 127.0.0.1 -n 2 >nul',
      'goto loop',
    ].join('\r\n');

    fs.writeFileSync(path.join(binDir, 'llama-server.cmd'), fakeServerScript, 'utf-8');

    // Write mock health script
    const cjs = `
const http = require('node:http');
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok' }));
}).listen(8085, '127.0.0.1');
setInterval(() => {}, 1000);
`;
    fs.writeFileSync(mockHealthScript, cjs.trim(), 'utf-8');
  }

  it('fails loudly and refuses to continue when llama-server reports 0 layers offloaded', () => {
    // Spawn background health responder
    const healthProc: ChildProcess = spawn('node', [mockHealthScript], {
      windowsHide: true,
      stdio: 'ignore',
    });

    let exitCode = 0;
    let output = '';

    try {
      // Allow 500ms for listener to bind
      execSync('powershell -NoProfile -Command "Start-Sleep -Milliseconds 500"');

      output = execSync(
        `powershell -ExecutionPolicy Bypass -File "${startScript}" -InstallDir "${fakeDir}" -LlamaPort 8085 -HealthTimeoutSeconds 5`,
        { encoding: 'utf-8', stdio: 'pipe' },
      );
    } catch (err: any) {
      exitCode = err.status ?? 1;
      output = (err.stdout?.toString() || '') + (err.stderr?.toString() || '');
    } finally {
      try { healthProc.kill(); } catch {}
    }

    // Must fail
    expect(exitCode).not.toBe(0);
    // Must complain about 0/29 layers
    expect(output).toMatch(/GPU OFFLOAD NOT CONFIRMED/i);
    expect(output).toMatch(/layers offloaded: 0\/29/i);
    expect(output).toMatch(/refusing to continue on CPU silently/i);
  }, 15000);
});
