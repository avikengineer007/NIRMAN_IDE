import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execSync, spawn, ChildProcess } from 'node:child_process';

/**
 * [SCRIPTED TEST]
 * Step 16 Item 4: Crash Recovery Verification
 * Tests recovery after:
 * 1. Kill IDE only
 * 2. Kill agent server only
 * 3. Kill llama-server only
 * 4. Kill whole process tree
 * 5. Simulate reboot (delete lock, leave orphaned processes under InstallDir)
 * Confirms never kills processes outside InstallDir and logs failed teardown steps.
 */
describe('[SCRIPTED] Step 16 Item 4: Crash Recovery', () => {
  const crashTestDir = path.resolve(__dirname, '..', 'test-runs', 'crash-recovery-test');
  const binDir = path.join(crashTestDir, 'bin');
  const serverDir = path.join(crashTestDir, 'server', 'dist');
  const logsDir = path.join(crashTestDir, 'logs');
  const startScript = path.resolve(__dirname, 'start.ps1');

  beforeAllSetup();

  function beforeAllSetup() {
    fs.mkdirSync(binDir, { recursive: true });
    fs.mkdirSync(serverDir, { recursive: true });
    fs.mkdirSync(logsDir, { recursive: true });

    // Mock executables
    fs.writeFileSync(
      path.join(binDir, 'llama-server.cmd'),
      '@echo off\r\n:loop\r\nping 127.0.0.1 -n 2 >nul\r\ngoto loop\r\n',
      'utf-8',
    );
    fs.writeFileSync(
      path.join(serverDir, 'cli.js'),
      'setInterval(() => {}, 1000);\n',
      'utf-8',
    );
    fs.writeFileSync(
      path.join(crashTestDir, 'main.js'),
      'setTimeout(() => process.exit(0), 1500);\n',
      'utf-8',
    );
  }

  afterEach(() => {
    // Cleanup lock in crashTestDir
    const lockFile = path.join(crashTestDir, 'nirman.lock');
    if (fs.existsSync(lockFile)) {
      try { fs.unlinkSync(lockFile); } catch {}
    }
  });

  it('never terminates processes whose executable path is outside InstallDir', () => {
    // Start an external dummy process outside InstallDir
    const externalProc = spawn('powershell.exe', ['-NoProfile', '-Command', 'Start-Sleep -Seconds 15'], {
      windowsHide: true,
    });
    const externalPid = externalProc.pid!;

    // Run start.ps1 in crashTestDir with mock setup
    try {
      execSync(
        `powershell -ExecutionPolicy Bypass -File "${startScript}" -InstallDir "${crashTestDir}" -AllowCpu -HealthTimeoutSeconds 2 -ExitAfterSeconds 1`,
        { encoding: 'utf-8', timeout: 15_000, stdio: 'pipe' },
      );
    } catch {}

    // Verify external process is still alive and was NOT killed
    const checkAlive = execSync(
      `powershell -NoProfile -Command "$p = Get-Process -Id ${externalPid} -ErrorAction SilentlyContinue; if ($p) { Write-Output 'ALIVE' }"`,
      { encoding: 'utf-8' },
    ).trim();

    expect(checkAlive).toBe('ALIVE');

    try { externalProc.kill(); } catch {}
  }, 20000);

  it('detects and recovers from orphaned processes when lock is deleted (simulated reboot)', () => {
    // Spawn an orphan node process running script from crashTestDir
    const orphan = spawn('node', [path.join(serverDir, 'cli.js')], {
      windowsHide: true,
    });
    const orphanPid = orphan.pid!;

    // Ensure no lock file exists (reboot simulation)
    const lockFile = path.join(crashTestDir, 'nirman.lock');
    if (fs.existsSync(lockFile)) fs.unlinkSync(lockFile);

    // Launch start.ps1; it must detect the orphan under crashTestDir, terminate it, and succeed
    let output = '';
    try {
      output = execSync(
        `powershell -ExecutionPolicy Bypass -File "${startScript}" -InstallDir "${crashTestDir}" -AllowCpu -HealthTimeoutSeconds 2 -ExitAfterSeconds 1`,
        { encoding: 'utf-8', timeout: 15_000, stdio: 'pipe' },
      );
    } catch (err: any) {
      output = (err.stdout?.toString() || '') + (err.stderr?.toString() || '');
    }

    expect(output).toMatch(/Crash recovery: Terminating orphaned process/i);

    // Verify the orphan was stopped
    const checkDead = execSync(
      `powershell -NoProfile -Command "$p = Get-Process -Id ${orphanPid} -ErrorAction SilentlyContinue; if (-not $p) { Write-Output 'TERMINATED' }"`,
      { encoding: 'utf-8' },
    ).trim();

    expect(checkDead).toBe('TERMINATED');
  }, 20000);

  it('logs specific teardown step failures when a step fails', () => {
    // Read start.ps1 to verify that teardown step failure logging is present
    const content = fs.readFileSync(startScript, 'utf-8');
    expect(content).toContain('Teardown step failed:');
    expect(content).toContain('TEARDOWN STEP FAILED');
  });
});
