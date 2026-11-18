import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * [SCRIPTED TEST]
 * Step 16 Item 5: Cold Start Timing Verification
 */
describe('[SCRIPTED] Step 16 Item 5: Cold Start Timing', () => {
  const startScript = path.resolve(__dirname, 'start.ps1');
  const measureScript = path.resolve(__dirname, 'measure-startup.ps1');
  const startupLog = 'C:\\Tools\\nirman\\logs\\startup.log';

  it('verifies that start.ps1 defaults to 120s health timeout', () => {
    const content = fs.readFileSync(startScript, 'utf-8');
    expect(content).toMatch(/HealthTimeoutSeconds = 120/);
  });

  it('verifies startup.log contains valid TIMING-SUMMARY from real cold start', () => {
    expect(fs.existsSync(startupLog)).toBe(true);
    const content = fs.readFileSync(startupLog, 'utf-8');
    const match = content.match(/\[TIMING-SUMMARY\][^\r\n]+/);
    expect(match).not.toBeNull();

    const summaryLine = match![0];
    expect(summaryLine).toContain('lock_acquired=');
    expect(summaryLine).toContain('llama_spawned=');
    expect(summaryLine).toContain('health_ready=');
    expect(summaryLine).toContain('agent_ready=');
    expect(summaryLine).toContain('ide_opened=');
    expect(summaryLine).toContain('health_wait_ms=');
    expect(summaryLine).toContain('total_startup_ms=');
  });

  it('verifies cold-start metrics are positive numbers from real run', () => {
    const content = fs.readFileSync(startupLog, 'utf-8');
    const lines = content.split(/\r?\n/).filter(l => l.includes('lock_acquired='));
    expect(lines.length).toBeGreaterThan(0);

    const latest = lines[lines.length - 1];
    const healthMatch = latest.match(/health_wait_ms=(\d+)/);
    const totalMatch = latest.match(/total_startup_ms=(\d+)/);

    expect(healthMatch).not.toBeNull();
    expect(totalMatch).not.toBeNull();

    const healthWaitMs = parseInt(healthMatch![1], 10);
    const totalStartupMs = parseInt(totalMatch![1], 10);

    expect(healthWaitMs).toBeGreaterThan(0);
    expect(totalStartupMs).toBeGreaterThan(healthWaitMs);

    // Measured values on RTX 5050: health_wait ~6.6s, total startup ~8.9s
    expect(healthWaitMs).toBeGreaterThanOrEqual(1000);
    expect(totalStartupMs).toBeGreaterThanOrEqual(2000);
  });
});
