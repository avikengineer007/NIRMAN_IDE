import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

/**
 * [SCRIPTED TEST]
 * Step 16 Item 1: Path Hygiene Verification
 * Ensures no hardcoded user paths or user names remain in the codebase,
 * and verifies that install.ps1 and start.ps1 fail fast when given a OneDrive path.
 */
describe('[SCRIPTED] Step 16 Item 1: Path Hygiene Verification', () => {
  const repoRoot = path.resolve(__dirname, '..');

  it('contains zero hardcoded user names ("LENOVO") in repo files', () => {
    const forbiddenPattern = /LENOVO/i;
    const scannedExtensions = ['.ts', '.js', '.json', '.ps1', '.cmd', '.md', '.yaml', '.yml'];
    const ignoredDirs = new Set(['node_modules', '.agent', 'logs', 'dist', '.git', '.vscode']);

    const violations: string[] = [];

    function scanDir(dir: string) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (!ignoredDirs.has(entry.name)) {
            scanDir(path.join(dir, entry.name));
          }
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          // Skip the test file itself and STEP16 spec which cites the rule
          if (entry.name === 'path-hygiene.test.ts' || entry.name === 'STEP16.md') {
            continue;
          }
          if (scannedExtensions.includes(ext)) {
            const filePath = path.join(dir, entry.name);
            const content = fs.readFileSync(filePath, 'utf-8');
            if (forbiddenPattern.test(content)) {
              violations.push(path.relative(repoRoot, filePath));
            }
          }
        }
      }
    }

    scanDir(repoRoot);
    expect(violations, `Found forbidden pattern 'LENOVO' in: ${violations.join(', ')}`).toEqual([]);
  });

  it('contains zero hardcoded user paths ("C:\\Users\\") in repo files', () => {
    const forbiddenPattern = /C:[/\\]Users[/\\]/i;
    const scannedExtensions = ['.ts', '.js', '.json', '.ps1', '.cmd', '.md', '.yaml', '.yml'];
    const ignoredDirs = new Set(['node_modules', '.agent', 'logs', 'dist', '.git', '.vscode']);

    const violations: string[] = [];

    function scanDir(dir: string) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (!ignoredDirs.has(entry.name)) {
            scanDir(path.join(dir, entry.name));
          }
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (entry.name === 'path-hygiene.test.ts' || entry.name === 'STEP16.md') {
            continue;
          }
          if (scannedExtensions.includes(ext)) {
            const filePath = path.join(dir, entry.name);
            const content = fs.readFileSync(filePath, 'utf-8');
            if (forbiddenPattern.test(content)) {
              violations.push(path.relative(repoRoot, filePath));
            }
          }
        }
      }
    }

    scanDir(repoRoot);
    expect(violations, `Found forbidden pattern 'C:\\Users\\' in: ${violations.join(', ')}`).toEqual([]);
  });

  it('fails fast in install.ps1 if install path is inside OneDrive', () => {
    const installScript = path.resolve(__dirname, 'install.ps1');
    let exitCode = 0;
    let stdout = '';
    try {
      stdout = execSync(
        `powershell -ExecutionPolicy Bypass -File "${installScript}" -InstallDir "C:\\Mock\\OneDrive\\nirman" -SkipPrerequisites`,
        { encoding: 'utf-8', stdio: 'pipe' },
      );
    } catch (err: any) {
      exitCode = err.status ?? 1;
      stdout = (err.stdout?.toString() || '') + (err.stderr?.toString() || '');
    }

    expect(exitCode).toBe(1);
    expect(stdout).toMatch(/OneDrive/i);
    expect(stdout).toMatch(/Path Hygiene Error/i);
  });

  it('fails fast in start.ps1 if install path is inside OneDrive', () => {
    const startScript = path.resolve(__dirname, 'start.ps1');
    let exitCode = 0;
    let stdout = '';
    try {
      stdout = execSync(
        `powershell -ExecutionPolicy Bypass -File "${startScript}" -InstallDir "C:\\Mock\\OneDrive\\nirman"`,
        { encoding: 'utf-8', stdio: 'pipe' },
      );
    } catch (err: any) {
      exitCode = err.status ?? 1;
      stdout = (err.stdout?.toString() || '') + (err.stderr?.toString() || '');
    }

    expect(exitCode).toBe(1);
    expect(stdout).toMatch(/OneDrive/i);
    expect(stdout).toMatch(/Path Hygiene Error/i);
  });
});
