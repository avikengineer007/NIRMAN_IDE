import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LocalSandbox } from '@nirman/sandbox';
import {
  ensureRunnablePythonScripts,
  generateWalkthrough,
  verifyWalkthroughCommands,
} from './walkthrough.js';

describe('generateWalkthrough', () => {
  it('generates markdown walkthrough report with tasks and commands', () => {
    const md = generateWalkthrough({
      task: 'Build a REST API',
      runId: 'run_123',
      status: 'completed',
      specMarkdown: `
# Spec
- Run: node server.js
- Test: npm test
`,
      tasks: [
        { id: 'step-1', title: 'Setup database', status: 'completed' },
        { id: 'step-2', title: 'Build endpoints', status: 'completed' },
      ],
      createdFiles: ['server.js', 'db.js'],
    });

    expect(md).toContain('# Project Walkthrough: Build a REST API');
    expect(md).toContain('`run_123`');
    expect(md).toContain('node server.js');
    expect(md).toContain('npm test');
    expect(md).toContain('`server.js`');
    expect(md).toContain('`step-1`');
    expect(md).toContain('No blocking failures encountered');
  });

  it('documents blocked tasks and error details when retries are exhausted', () => {
    const md = generateWalkthrough({
      task: 'Build faulty app',
      runId: 'run_456',
      status: 'blocked',
      tasks: [
        {
          id: 'step-1',
          title: 'Implement broken feature',
          status: 'blocked',
          retries: 3,
          error: 'AssertionError: test failed',
        },
      ],
    });

    expect(md).toContain('🛑 BLOCKED');
    expect(md).toContain('Task `step-1`: Implement broken feature');
    expect(md).toContain('AssertionError: test failed');
  });

  it('extracts bold and multi-line codeblock commands and resolves None run commands from createdFiles', () => {
    const md = generateWalkthrough({
      task: 'make a calculator in python',
      runId: 'run_calc',
      status: 'completed',
      specMarkdown: `
**Build / Test / Run Commands:**
- **Build:**
  - None
- **Test:**
  \`\`\`bash
  python -m unittest discover -s src/tests
  \`\`\`
- **Run:**
  - None (The calculator is intended to be run from the command line)
`,
      tasks: [{ id: 'step-1', title: 'Implement calculator', status: 'completed' }],
      createdFiles: ['SPEC.md', 'src/calculator.py', 'src/__init__.py', 'src/tests/test_calculator.py'],
    });

    expect(md).toContain('python src/calculator.py');
    expect(md).toContain('python -m unittest discover -s src/tests -t .');
    expect(md).toContain('- `src/calculator.py`');
    expect(md).not.toContain('See SPEC.md for start command');
  });

  it('auto-appends an interactive __main__ entry point to function-only Python scripts and verifies commands', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nirman-wt-test-'));
    try {
      const sandbox = new LocalSandbox({ workspaceRoot: tempDir });
      await sandbox.writeFile(
        'src/calculator.py',
        'def add(a, b):\n    return a + b\n\ndef subtract(a, b):\n    return a - b\n',
      );
      await sandbox.writeFile('src/__init__.py', '');
      await sandbox.writeFile(
        'src/tests/test_calculator.py',
        'import unittest\nfrom src.calculator import add, subtract\nclass TestCalc(unittest.TestCase):\n    def test_add(self):\n        self.assertEqual(add(2, 3), 5)\n',
      );

      const files = ['src/calculator.py', 'src/__init__.py', 'src/tests/test_calculator.py'];
      await ensureRunnablePythonScripts(sandbox, files);

      const updatedCalc = await sandbox.readFile('src/calculator.py');
      expect(updatedCalc).toContain('if __name__ == "__main__":');

      const verified = await verifyWalkthroughCommands(sandbox, undefined, files);
      expect(verified.verifiedRunCommand).toBe('python src/calculator.py');
      expect(verified.verifiedTestCommand).toContain('unittest');
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
