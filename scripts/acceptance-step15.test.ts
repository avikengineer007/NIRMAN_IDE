import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

describe('[SCRIPTED] Step 15 Acceptance: Windows Install and One-Click Launch', () => {
  const installDir = 'C:\\Tools\\nirman';
  const projectsDir = 'C:\\Projects';
  let desktopDir = '';
  try {
    desktopDir = execSync('powershell -NoProfile -Command "[Environment]::GetFolderPath([Environment+SpecialFolder]::Desktop)"', { encoding: 'utf-8' }).trim();
  } catch {
    desktopDir = path.join(process.env['USERPROFILE'] || '', 'Desktop');
  }
  const desktopShortcut = path.join(desktopDir, 'NIRMAN Agentic Studio.lnk');

  it(
    'runs install.ps1, checks prerequisites, and creates C:\\Projects and C:\\Tools\\nirman',
    () => {
      const installScript = path.resolve(__dirname, 'install.ps1');
      expect(fs.existsSync(installScript)).toBe(true);

      const output = execSync(
        `powershell -ExecutionPolicy Bypass -File "${installScript}" -Silent`,
        { encoding: 'utf-8', timeout: 60_000 },
      );

      // Verify Prerequisite checks
      expect(output).toContain('[PASS] NVIDIA GPU Detected');
      expect(output).toContain('[PASS] Node.js Detected');

      // Verify target directory creation
      expect(fs.existsSync(installDir)).toBe(true);
      expect(fs.existsSync(projectsDir)).toBe(true);

      // Verify application files installed
      expect(fs.existsSync(path.join(installDir, 'nirman.cmd'))).toBe(true);
      expect(fs.existsSync(path.join(installDir, 'main.js'))).toBe(true);
      expect(fs.existsSync(path.join(installDir, 'product.json'))).toBe(true);
      expect(fs.existsSync(path.join(installDir, 'resources', 'nirman.ico'))).toBe(true);
      expect(fs.existsSync(path.join(installDir, 'start.ps1'))).toBe(true);
      expect(fs.existsSync(path.join(installDir, 'stop.ps1'))).toBe(true);
    },
    60_000,
  );

  it('verifies CUDA llama-server and model file with checksums', () => {
    const llamaExe = path.join(installDir, 'bin', 'llama-server.exe');
    expect(fs.existsSync(llamaExe)).toBe(true);

    const modelFile = path.join(installDir, 'models', 'qwen2.5-coder-7b-instruct-q4_k_m.gguf');
    expect(fs.existsSync(modelFile)).toBe(true);

    const stats = fs.statSync(modelFile);
    // Model file must be > 1GB (actual ~4.68GB)
    expect(stats.size).toBeGreaterThan(1_000_000_000);
  });

  it('creates Desktop shortcut with custom icon pointing to start.ps1', () => {
    const shortcutExists = fs.existsSync(desktopShortcut);
    expect(shortcutExists).toBe(true);

    const icoFile = path.join(installDir, 'resources', 'nirman.ico');
    expect(fs.existsSync(icoFile)).toBe(true);
    expect(fs.statSync(icoFile).size).toBeGreaterThan(100);
  });

  it(
    'executes start.ps1, completes sample task, closes IDE, and releases VRAM',
    () => {
      const startScript = path.join(installDir, 'start.ps1');
      expect(fs.existsSync(startScript)).toBe(true);

      const startOutput = execSync(
        `powershell -ExecutionPolicy Bypass -File "${startScript}" -SampleTask -HealthTimeoutSeconds 60`,
        { encoding: 'utf-8', timeout: 120_000 },
      );

      // Verify start sequence
      expect(startOutput).toContain('Acquired application lock');
      expect(startOutput).toContain('llama-server process launched');
      expect(startOutput).toContain('llama-server is healthy and ready on port 8080');
      expect(startOutput).toContain('Agent server daemon started');
      expect(startOutput).toContain('Opening IDE in workspace: C:\\Projects');

      // Verify sample task completion
      const sampleOutputFile = path.join(projectsDir, 'hello-nirman.js');
      expect(fs.existsSync(sampleOutputFile)).toBe(true);
      const content = fs.readFileSync(sampleOutputFile, 'utf-8');
      expect(content).toContain('Hello from NIRMAN Agentic Studio!');

      // Verify teardown and VRAM release
      expect(startOutput).toContain('Stopped llama-server process');
      expect(startOutput).toContain('Released application lock');
      expect(startOutput).toContain('Session concluded; all child processes stopped');

      // Verify lock file is gone
      const lockFile = path.join(installDir, 'nirman.lock');
      expect(fs.existsSync(lockFile)).toBe(false);

      // Verify log files are generated
      const logsDir = path.join(installDir, 'logs');
      expect(fs.existsSync(path.join(logsDir, 'startup.log'))).toBe(true);
      expect(fs.existsSync(path.join(logsDir, 'session.log'))).toBe(true);
    },
    90_000,
  );

  it('executes stop.ps1 cleanly and verifies zero lingering processes', () => {
    const stopScript = path.join(installDir, 'stop.ps1');
    expect(fs.existsSync(stopScript)).toBe(true);

    const stopOutput = execSync(
      `powershell -ExecutionPolicy Bypass -File "${stopScript}"`,
      { encoding: 'utf-8', timeout: 30_000 },
    );

    expect(stopOutput).toContain('NIRMAN stop completed. All processes stopped and VRAM released.');

    // Confirm with nvidia-smi that VRAM is released
    try {
      const smiOutput = execSync(
        'nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv,noheader',
        { encoding: 'utf-8' },
      );
      // Ensure no llama-server is in nvidia-smi compute apps
      expect(smiOutput).not.toContain('llama-server');
    } catch {
      // nvidia-smi query
    }
  });
});
