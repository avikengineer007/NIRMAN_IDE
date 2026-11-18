import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execSync, spawn, ChildProcess } from 'node:child_process';

/**
 * [SCRIPTED TEST]
 * Step 16 Items 2 & 3: Lock File Validation & Double Launch Prevention
 */
describe('[SCRIPTED] Step 16 Items 2 & 3: Lock File & Double Launch', () => {
  const tempDir = path.resolve(__dirname, '..', 'test-runs', 'lock-test');
  const lockFile = path.join(tempDir, 'nirman.lock');
  const testLockScript = path.resolve(__dirname, 'test-lock.ps1');
  const startScript = path.resolve(__dirname, 'start.ps1');

  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  let backgroundChild: ChildProcess | null = null;

  afterEach(() => {
    if (backgroundChild && !backgroundChild.killed) {
      try {
        backgroundChild.kill();
      } catch {}
      backgroundChild = null;
    }
    if (fs.existsSync(lockFile)) {
      try {
        fs.unlinkSync(lockFile);
      } catch {}
    }
  });

  it('detects a dead PID as stale lock', () => {
    const deadPayload = JSON.stringify({
      pid: 9999999,
      startTime: new Date(2020, 0, 1).toISOString(),
      processName: 'powershell',
    });
    fs.writeFileSync(lockFile, deadPayload, 'utf-8');

    const out = execSync(
      `powershell -ExecutionPolicy Bypass -File "${testLockScript}" -Action "test-lock" -LockFile "${lockFile}"`,
      { encoding: 'utf-8' },
    ).trim();

    expect(out).toContain('STALE');
    expect(out).toContain('does not exist');
  });

  it('detects PID reused by an unrelated process with start-time mismatch as stale', () => {
    // Current node process PID is alive, but pass start time 10 years ago
    const reusedPayload = JSON.stringify({
      pid: process.pid,
      startTime: new Date(2015, 0, 1).toISOString(),
      processName: 'node',
    });
    fs.writeFileSync(lockFile, reusedPayload, 'utf-8');

    const out = execSync(
      `powershell -ExecutionPolicy Bypass -File "${testLockScript}" -Action "test-lock" -LockFile "${lockFile}"`,
      { encoding: 'utf-8' },
    ).trim();

    expect(out).toContain('STALE');
    expect(out).toContain('start time mismatch');
  });

  it('detects PID reused with process name mismatch as stale', () => {
    const reusedPayload = JSON.stringify({
      pid: process.pid,
      startTime: new Date().toISOString(),
      processName: 'some_other_process_xyz',
    });
    fs.writeFileSync(lockFile, reusedPayload, 'utf-8');

    const out = execSync(
      `powershell -ExecutionPolicy Bypass -File "${testLockScript}" -Action "test-lock" -LockFile "${lockFile}"`,
      { encoding: 'utf-8' },
    ).trim();

    expect(out).toContain('STALE');
    expect(out).toContain('reused by unrelated process');
  });

  it('detects a live lock when PID, start time, and process name match a running process', () => {
    // Spawn a sleep process that lives during the test
    backgroundChild = spawn('powershell.exe', ['-NoProfile', '-Command', 'Start-Sleep -Seconds 10'], {
      windowsHide: true,
    });
    const childPid = backgroundChild.pid!;

    // Query its exact start time and name from PowerShell
    const procInfo = execSync(
      `powershell -NoProfile -Command "$p = Get-Process -Id ${childPid}; @{ pid = $p.Id; startTime = $p.StartTime.ToUniversalTime().ToString('o'); processName = $p.ProcessName } | ConvertTo-Json"`,
      { encoding: 'utf-8' },
    ).trim();

    fs.writeFileSync(lockFile, procInfo, 'utf-8');

    const out = execSync(
      `powershell -ExecutionPolicy Bypass -File "${testLockScript}" -Action "test-lock" -LockFile "${lockFile}"`,
      { encoding: 'utf-8' },
    ).trim();

    expect(out).toBe('LOCK_LIVE');
  });

  it('exits with code 2 and duplicate prevention message when launch is attempted with active live lock', () => {
    backgroundChild = spawn('powershell.exe', ['-NoProfile', '-Command', 'Start-Sleep -Seconds 10'], {
      windowsHide: true,
    });
    const childPid = backgroundChild.pid!;

    const procInfo = execSync(
      `powershell -NoProfile -Command "$p = Get-Process -Id ${childPid}; @{ pid = $p.Id; startTime = $p.StartTime.ToUniversalTime().ToString('o'); processName = $p.ProcessName } | ConvertTo-Json"`,
      { encoding: 'utf-8' },
    ).trim();

    fs.writeFileSync(lockFile, procInfo, 'utf-8');

    let exitCode = 0;
    let stdout = '';
    try {
      stdout = execSync(
        `powershell -ExecutionPolicy Bypass -File "${startScript}" -InstallDir "${tempDir}"`,
        { encoding: 'utf-8', stdio: 'pipe' },
      );
    } catch (err: any) {
      exitCode = err.status ?? 0;
      stdout = (err.stdout?.toString() || '') + (err.stderr?.toString() || '');
    }

    expect(exitCode).toBe(2);
    expect(stdout).toMatch(/Duplicate instance prevented/i);
  });

  it('handles two launches started less than 1 second apart by rejecting the second with code 2', () => {
    // Setup lightweight mock install tree
    const concurrentDir = path.resolve(__dirname, '..', 'test-runs', 'concurrent-launch');
    const binDir = path.join(concurrentDir, 'bin');
    const serverDir = path.join(concurrentDir, 'server', 'dist');
    fs.mkdirSync(binDir, { recursive: true });
    fs.mkdirSync(serverDir, { recursive: true });

    // Dummy mock files
    fs.writeFileSync(path.join(binDir, 'llama-server.cmd'), '@echo off\r\nping 127.0.0.1 -n 5 >nul\r\n', 'utf-8');
    fs.writeFileSync(path.join(serverDir, 'cli.js'), 'setInterval(() => {}, 1000);\n', 'utf-8');
    fs.writeFileSync(path.join(concurrentDir, 'main.js'), 'setTimeout(() => process.exit(0), 2000);\n', 'utf-8');

    // Launch first instance
    const p1 = spawn('powershell.exe', [
      '-ExecutionPolicy', 'Bypass',
      '-File', startScript,
      '-InstallDir', concurrentDir,
      '-AllowCpu',
      '-ExitAfterSeconds', '2'
    ], { stdio: 'pipe' });

    // Wait 250ms (< 1s apart) and launch second instance
    const startP2 = `
      Start-Sleep -Milliseconds 250
      powershell -ExecutionPolicy Bypass -File "${startScript}" -InstallDir "${concurrentDir}" -AllowCpu
      exit $LASTEXITCODE
    `;
    let p2ExitCode = 0;
    let p2Output = '';
    try {
      p2Output = execSync(`powershell -NoProfile -Command "${startP2.replace(/\n/g, '; ')}"`, { encoding: 'utf-8', stdio: 'pipe' });
    } catch (err: any) {
      p2ExitCode = err.status ?? 0;
      p2Output = (err.stdout?.toString() || '') + (err.stderr?.toString() || '');
    }

    expect(p2ExitCode).toBe(2);
    expect(p2Output).toMatch(/Duplicate instance prevented/i);

    // Clean up first process
    try { p1.kill(); } catch {}
  }, 15000);
});
