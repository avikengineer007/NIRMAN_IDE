import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalSandbox } from '@nirman/sandbox';
import { createDefaultToolRegistry, ToolRegistry } from './registry.js';
import { readFileTool } from './tools/read-file.js';
import { writeFileTool } from './tools/write-file.js';
import { editFileTool } from './tools/edit-file.js';
import { listDirTool } from './tools/list-dir.js';
import { searchTool } from './tools/search.js';
import { runShellTool } from './tools/run-shell.js';

describe('Tools & Registry', () => {
  let tempDir: string;
  let sandbox: LocalSandbox;
  let registry: ToolRegistry;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nirman-tools-test-'));
    sandbox = new LocalSandbox({ workspaceRoot: tempDir, timeoutMs: 2000 });
    registry = createDefaultToolRegistry();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('read_file', () => {
    it('reads entire file', async () => {
      await sandbox.writeFile('test.txt', 'Line 1\nLine 2\nLine 3');
      const res = await readFileTool.execute({ path: 'test.txt' }, { sandbox });

      expect(res.success).toBe(true);
      expect(res.output).toBe('Line 1\nLine 2\nLine 3');
    });

    it('reads a specific line range', async () => {
      await sandbox.writeFile('range.txt', '1\n2\n3\n4\n5');
      const res = await readFileTool.execute(
        { path: 'range.txt', startLine: 2, endLine: 4 },
        { sandbox },
      );

      expect(res.success).toBe(true);
      expect(res.output).toBe('2\n3\n4');
    });

    it('returns error if file does not exist', async () => {
      const res = await readFileTool.execute({ path: 'nonexistent.txt' }, { sandbox });
      expect(res.success).toBe(false);
      expect(res.error).toContain('File not found');
    });

    it('fails on path-escape attempt', async () => {
      const res = await readFileTool.execute({ path: '../escape.txt' }, { sandbox });
      expect(res.success).toBe(false);
      expect(res.error).toContain('Access denied');
    });
  });

  describe('write_file', () => {
    it('writes content and creates parent directories', async () => {
      const res = await writeFileTool.execute(
        { path: 'src/nested/app.ts', content: 'console.log("hello");' },
        { sandbox },
      );

      expect(res.success).toBe(true);
      expect(await sandbox.readFile('src/nested/app.ts')).toBe('console.log("hello");');
    });

    it('respects overwrite: false', async () => {
      await sandbox.writeFile('locked.txt', 'original');
      const res = await writeFileTool.execute(
        { path: 'locked.txt', content: 'new', overwrite: false },
        { sandbox },
      );

      expect(res.success).toBe(false);
      expect(res.error).toContain('File already exists');
      expect(await sandbox.readFile('locked.txt')).toBe('original');
    });

    it('fails on path-escape attempt', async () => {
      const res = await writeFileTool.execute(
        { path: '../../evil.sh', content: 'rm -rf /' },
        { sandbox },
      );
      expect(res.success).toBe(false);
      expect(res.error).toContain('Access denied');
    });
  });

  describe('edit_file', () => {
    it('replaces exact unique match', async () => {
      await sandbox.writeFile('file.txt', 'const a = 1;\nconst b = 2;\n');
      const res = await editFileTool.execute(
        { path: 'file.txt', target: 'const b = 2;', replacement: 'const b = 42;' },
        { sandbox },
      );

      expect(res.success).toBe(true);
      expect(await sandbox.readFile('file.txt')).toBe('const a = 1;\nconst b = 42;\n');
    });

    it('fails when target string is not found', async () => {
      await sandbox.writeFile('file.txt', 'hello world');
      const res = await editFileTool.execute(
        { path: 'file.txt', target: 'missing string', replacement: 'replacement' },
        { sandbox },
      );

      expect(res.success).toBe(false);
      expect(res.error).toContain('Target string not found');
    });

    it('rejects ambiguous matches when target appears multiple times', async () => {
      await sandbox.writeFile(
        'code.ts',
        'function test() { return 1; }\nfunction test() { return 1; }\n',
      );
      const res = await editFileTool.execute(
        { path: 'code.ts', target: 'return 1;', replacement: 'return 2;' },
        { sandbox },
      );

      expect(res.success).toBe(false);
      expect(res.error).toContain('Ambiguous match: target string occurs 2 times');
      // Verify content was untouched
      expect(await sandbox.readFile('code.ts')).toBe(
        'function test() { return 1; }\nfunction test() { return 1; }\n',
      );
    });
  });

  describe('list_dir', () => {
    it('lists directory entries sorting directories first', async () => {
      await sandbox.writeFile('b_file.txt', 'b');
      await sandbox.writeFile('a_dir/subfile.txt', 'sub');

      const res = await listDirTool.execute({ path: '.' }, { sandbox });
      expect(res.success).toBe(true);
      expect(res.output).toContain('[DIR]  a_dir');
      expect(res.output).toContain('[FILE] b_file.txt');
    });
  });

  describe('search', () => {
    it('performs ripgrep-style search across workspace files', async () => {
      await sandbox.writeFile('src/a.ts', 'const TARGET = 100;\nconst OTHER = 50;');
      await sandbox.writeFile('src/b.ts', 'const NOT_HERE = 1;');

      const res = await searchTool.execute({ query: 'TARGET' }, { sandbox });
      expect(res.success).toBe(true);
      expect(res.output).toContain('src/a.ts:1: const TARGET = 100;');
      expect(res.output).not.toContain('src/b.ts');
    });

    it('supports regex search', async () => {
      await sandbox.writeFile('src/version.ts', 'export const VERSION = "1.2.3";');

      const res = await searchTool.execute(
        { query: 'VERSION = "[0-9.]+"', regex: true },
        { sandbox },
      );
      expect(res.success).toBe(true);
      expect(res.output).toContain('export const VERSION = "1.2.3"');
    });
  });

  describe('run_shell', () => {
    it('executes shell command in sandbox and captures output', async () => {
      const isWin = process.platform === 'win32';
      const cmd = isWin ? 'Write-Output "NIRMAN_SHELL_TEST"' : 'echo "NIRMAN_SHELL_TEST"';

      const res = await runShellTool.execute({ command: cmd }, { sandbox });
      expect(res.success).toBe(true);
      expect(res.output).toContain('NIRMAN_SHELL_TEST');
    });

    it('kills process on shell timeout', async () => {
      const isWin = process.platform === 'win32';
      const sleepCmd = isWin ? 'Start-Sleep -Milliseconds 1500' : 'sleep 1.5';

      const res = await runShellTool.execute({ command: sleepCmd, timeoutMs: 300 }, { sandbox });
      expect(res.success).toBe(false);
      expect(res.error).toContain('timed out');
      expect(res.output).toContain('[STATUS: Process timed out and was killed]');
    });
  });

  describe('ToolRegistry', () => {
    it('validates tool arguments against JSON schema before execution', async () => {
      // Missing required 'path' parameter
      const res = await registry.execute('read_file', {}, { sandbox });
      expect(res.success).toBe(false);
      expect(res.error).toContain('Missing required argument "path"');
    });

    it('returns error for unknown tool name', async () => {
      const res = await registry.execute('unknown_tool', {}, { sandbox });
      expect(res.success).toBe(false);
      expect(res.error).toContain('Unknown tool: "unknown_tool"');
    });
  });
});
