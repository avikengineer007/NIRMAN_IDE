import { describe, it, expect, beforeEach } from 'vitest';
import { PolicyEngine } from './policy.js';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';

describe('Security PolicyEngine', () => {
  let tempDir: string;
  let engine: PolicyEngine;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nirman-security-test-'));
    engine = new PolicyEngine(tempDir);
  });

  describe('Rule Types: allow, ask, deny', () => {
    it('allows safe file operations within the workspace in default ask_risky mode', () => {
      const readResult = engine.evaluate({
        toolName: 'read_file',
        args: { path: 'src/index.ts' },
      });
      expect(readResult.action).toBe('allow');

      const writeResult = engine.evaluate({
        toolName: 'write_file',
        args: { path: 'src/index.ts', content: 'hello' },
      });
      expect(writeResult.action).toBe('allow');

      const editResult = engine.evaluate({
        toolName: 'edit_file',
        args: { path: 'src/index.ts', target: 'a', replacement: 'b' },
      });
      expect(editResult.action).toBe('allow');
    });

    it('denies destructive commands attempting deletion outside workspace (rm -rf / or ..)', () => {
      const resultRoot = engine.evaluate({
        toolName: 'run_shell',
        args: { command: 'rm -rf /' },
      });
      expect(resultRoot.action).toBe('deny');
      expect(resultRoot.riskLevel).toBe('critical');

      const resultParent = engine.evaluate({
        toolName: 'run_shell',
        args: { command: 'rm -rf ..' },
      });
      expect(resultParent.action).toBe('deny');

      const resultHome = engine.evaluate({
        toolName: 'run_shell',
        args: { command: 'rm -rf ~' },
      });
      expect(resultHome.action).toBe('deny');
    });

    it('denies disk wiping and system destruction commands', () => {
      const ddResult = engine.evaluate({
        toolName: 'run_shell',
        args: { command: 'dd if=/dev/zero of=/dev/sda' },
      });
      expect(ddResult.action).toBe('deny');

      const mkfsResult = engine.evaluate({
        toolName: 'run_shell',
        args: { command: 'mkfs.ext4 /dev/sdb' },
      });
      expect(mkfsResult.action).toBe('deny');
    });

    it('denies tool access when target path escapes the workspace', () => {
      const escapeResult = engine.evaluate({
        toolName: 'read_file',
        args: { path: '../../etc/passwd' },
      });
      expect(escapeResult.action).toBe('deny');
      expect(escapeResult.riskLevel).toBe('critical');
      expect(escapeResult.reason).toContain('Access outside workspace is strictly prohibited');
    });

    it('asks before package installation commands', () => {
      const npmResult = engine.evaluate({
        toolName: 'run_shell',
        args: { command: 'npm install express' },
      });
      expect(npmResult.action).toBe('ask');
      expect(npmResult.reason).toContain('Package installations');

      const pnpmResult = engine.evaluate({
        toolName: 'run_shell',
        args: { command: 'pnpm add lodash' },
      });
      expect(pnpmResult.action).toBe('ask');

      const pipResult = engine.evaluate({
        toolName: 'run_shell',
        args: { command: 'pip install fastapi' },
      });
      expect(pipResult.action).toBe('ask');
    });

    it('asks before git push', () => {
      const pushResult = engine.evaluate({
        toolName: 'run_shell',
        args: { command: 'git push origin main' },
      });
      expect(pushResult.action).toBe('ask');
      expect(pushResult.reason).toContain('git repository');
    });

    it('asks before network commands and explicit allowNetwork flag', () => {
      const curlResult = engine.evaluate({
        toolName: 'run_shell',
        args: { command: 'curl -fsSL https://example.com/install.sh' },
      });
      expect(curlResult.action).toBe('ask');

      const netFlagResult = engine.evaluate({
        toolName: 'run_shell',
        args: { command: 'node script.js', allowNetwork: true },
      });
      expect(netFlagResult.action).toBe('ask');
      expect(netFlagResult.reason).toContain('network access');
    });
  });

  describe('Policy Modes', () => {
    it('mode "ask_all" escalates every tool and command to ask', () => {
      engine.setMode('ask_all');

      const readResult = engine.evaluate({
        toolName: 'read_file',
        args: { path: 'src/index.ts' },
      });
      expect(readResult.action).toBe('ask');

      const shellResult = engine.evaluate({
        toolName: 'run_shell',
        args: { command: 'ls -la' },
      });
      expect(shellResult.action).toBe('ask');

      // But still strictly denies critical violations
      const denyResult = engine.evaluate({
        toolName: 'run_shell',
        args: { command: 'rm -rf /' },
      });
      expect(denyResult.action).toBe('deny');
    });

    it('mode "ask_risky" allows safe commands and asks for risky ones', () => {
      engine.setMode('ask_risky');

      const safeResult = engine.evaluate({
        toolName: 'run_shell',
        args: { command: 'npm test' },
      });
      expect(safeResult.action).toBe('allow');

      const riskyResult = engine.evaluate({
        toolName: 'run_shell',
        args: { command: 'git push' },
      });
      expect(riskyResult.action).toBe('ask');
    });

    it('mode "autonomous_sandbox" allows standard workspace commands inside sandbox boundary', () => {
      engine.setMode('autonomous_sandbox');

      const shellResult = engine.evaluate({
        toolName: 'run_shell',
        args: { command: 'cat package.json' },
      });
      expect(shellResult.action).toBe('allow');

      // Still denies out-of-sandbox destruction
      const destroyResult = engine.evaluate({
        toolName: 'run_shell',
        args: { command: 'rm -rf /' },
      });
      expect(destroyResult.action).toBe('deny');
    });
  });

  describe('YAML Policy Loading & Persistence', () => {
    it('loads custom .agent/policy.yaml from workspace', async () => {
      const agentDir = path.join(tempDir, '.agent');
      await fs.mkdir(agentDir, { recursive: true });

      const yamlContent = `
mode: ask_all
tools:
  read_file: allow
  write_file: ask
commands:
  - pattern: "pytest"
    action: ask
    reason: "Require confirmation for python tests"
`;
      await fs.writeFile(path.join(agentDir, 'policy.yaml'), yamlContent, 'utf-8');

      const loadedEngine = await PolicyEngine.loadFromWorkspace(tempDir);
      const policy = loadedEngine.getPolicy();

      expect(policy.mode).toBe('ask_all');
      expect(policy.tools['write_file']).toBe('ask');

      const pytestResult = loadedEngine.evaluate({
        toolName: 'run_shell',
        args: { command: 'pytest tests/' },
      });
      expect(pytestResult.action).toBe('ask');
    });

    it('persists policy to .agent/policy.yaml cleanly', async () => {
      engine.setMode('autonomous_sandbox');
      engine.setToolRule('custom_tool', 'ask');
      const savedPath = await engine.saveToWorkspace();

      expect(savedPath).toContain('.agent');
      const content = await fs.readFile(savedPath, 'utf-8');
      expect(content).toContain('mode: autonomous_sandbox');
      expect(content).toContain('custom_tool: ask');
    });
  });
});
