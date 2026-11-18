import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalSandbox } from '@nirman/sandbox';
import { extractVerificationCommands, parseRelevantError, runVerification } from './verifier.js';

describe('Verifier', () => {
  let tempDir: string;
  let sandbox: LocalSandbox;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nirman-verifier-test-'));
    sandbox = new LocalSandbox({ workspaceRoot: tempDir });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('extractVerificationCommands', () => {
    it('extracts test and build commands from SPEC.md', () => {
      const spec = `
# Project Spec
- Stack: Node.js, TypeScript
## Commands
- Build: npm run build
- Test: npm test
- Run: npm start
`;
      const cmds = extractVerificationCommands(spec);
      expect(cmds).toContain('npm run build');
      expect(cmds).toContain('npm test');
    });

    it('extracts commands from task title or description', () => {
      const cmds = extractVerificationCommands('', 'Run test with: python -m pytest tests/');
      expect(cmds).toContain('python -m pytest tests/');
    });
  });

  describe('parseRelevantError', () => {
    it('extracts Python traceback error cleanly', () => {
      const raw = `
Some non-error header info
Traceback (most recent call last):
  File "test.py", line 12, in <module>
    assert result == 42
AssertionError: Expected 42 but got 0
Some non-error footer info
`;
      const parsed = parseRelevantError(raw);
      expect(parsed).toContain('AssertionError: Expected 42 but got 0');
      expect(parsed).toContain('Traceback');
    });

    it('extracts TypeScript error cleanly and truncates', () => {
      const raw =
        'src/index.ts(10,5): error TS2322: Type "string" is not assignable to type "number".\n'.repeat(
          60,
        );
      const parsed = parseRelevantError(raw);
      expect(parsed).toContain('error TS2322');
      expect(parsed.length).toBeLessThanOrEqual(2100);
    });
  });

  describe('runVerification', () => {
    it('succeeds when command exits with 0', async () => {
      await sandbox.writeFile('test.txt', 'hello');
      const res = await runVerification(['node -e "process.exit(0)"'], sandbox);
      expect(res.success).toBe(true);
    });

    it('fails when command exits with non-zero exit code', async () => {
      const res = await runVerification(
        ['node -e "console.error(\'failed!\'); process.exit(1)"'],
        sandbox,
      );
      expect(res.success).toBe(false);
      expect(res.error).toContain('failed!');
    });

    it('falls back to workspace check if commands are empty', async () => {
      const emptyRes = await runVerification([], sandbox);
      expect(emptyRes.success).toBe(false);

      await sandbox.writeFile('app.js', 'console.log("ok");');
      const populatedRes = await runVerification([], sandbox);
      expect(populatedRes.success).toBe(true);
    });
  });
});
