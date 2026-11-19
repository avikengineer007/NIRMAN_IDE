import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockModelClient, OpenAICompatibleClient } from '@nirman/model';
import { LocalSandbox } from '@nirman/sandbox';
import { createDefaultToolRegistry } from '@nirman/tools';
import { ArtifactStore, type AgentEvent } from '@nirman/artifacts';
import {
  classifyVerificationFailure,
  extractStructuredCommands,
  extractVerificationCommands,
  isAllowedShellCommand,
  runVerification,
} from './verifier.js';
import { runAgentLoop } from './agent-loop.js';
import { resolveWalkthroughCommands } from './walkthrough.js';

describe('P0 Regression Suite (Built from Real Run Logs)', () => {
  let tempDir: string;
  let sandbox: LocalSandbox;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nirman-p0-reg-'));
    sandbox = new LocalSandbox({ workspaceRoot: tempDir });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('F1: rejects prose "Not applicable", "Testing Framework", and "/ Test / Run Commands:" from real SPEC logs', () => {
    // Exact SPEC.md from run wt-run-1795044506005-b5smi (04:58)
    const specB5smi = `
#### Build / Test / Run Commands
- **Build**: Not applicable (Python scripts do not require a build step)
- **Test**: \`python -m unittest discover -s src/tests -t .\`
- **Run**: \`python src/calculator.py\`
`;
    expect(extractVerificationCommands(specB5smi)).toEqual([
      'python -m unittest discover -s src/tests -t .',
    ]);

    // Exact SPEC.md from run wt-run-1795044022069-rz7su (04:50)
    const specRz7su = `
**Stack & Conventions:**
- Testing Framework: Python's built-in \`unittest\` module

**Build / Test / Run Commands:**
- **Build Command:** None
- **Test Command:** \`python -m unittest discover -s src/tests -t .\`
- **Run Command:** \`python src/calculator.py\`
`;
    expect(extractVerificationCommands(specRz7su)).toEqual([
      'python -m unittest discover -s src/tests -t .',
    ]);

    expect(isAllowedShellCommand('Not applicable (Python scripts do not require a build step)')).toBe(false);
    expect(isAllowedShellCommand('/ Test / Run Commands:')).toBe(false);
    expect(isAllowedShellCommand('ing Framework:')).toBe(false);
    expect(isAllowedShellCommand('Command:')).toBe(false);
    expect(isAllowedShellCommand('python -m unittest discover -s src/tests -t .')).toBe(true);
  });

  it('F1 + F6: parses structured nirman_commands JSON block from SPEC.md before prose', () => {
    const structuredSpec = `
## Commands
\`\`\`json
{
  "nirman_commands": {
    "build": null,
    "run": "python src/calculator.py",
    "test": "python -m unittest discover -s src/tests -t .",
    "expectedFiles": ["src/calculator.py", "src/tests/test_calculator.py"]
  }
}
\`\`\`
`;
    const parsed = extractStructuredCommands(structuredSpec);
    expect(parsed?.run).toBe('python src/calculator.py');
    expect(parsed?.test).toBe('python -m unittest discover -s src/tests -t .');
    expect(extractVerificationCommands(structuredSpec)).toEqual([
      'python -m unittest discover -s src/tests -t .',
    ]);
    expect(resolveWalkthroughCommands(structuredSpec, ['src/calculator.py']).runCommand).toBe(
      'python src/calculator.py',
    );
  });

  it('F2: deterministically creates __init__.py so python unittest discover -s src/tests -t . succeeds (run br0dn)', async () => {
    await sandbox.writeFile(
      'src/calculator.py',
      'def add(a, b):\n    return a + b\n',
    );
    await sandbox.writeFile(
      'src/tests/test_calculator.py',
      'import unittest\nfrom src.calculator import add\nclass TestCalc(unittest.TestCase):\n    def test_add(self):\n        self.assertEqual(add(2, 3), 5)\n',
    );

    // Neither src/__init__.py nor src/tests/__init__.py exists initially
    expect(await sandbox.exists('src/__init__.py')).toBe(false);
    expect(await sandbox.exists('src/tests/__init__.py')).toBe(false);

    const res = await runVerification(
      ['python -m unittest discover -s src/tests -t .'],
      sandbox,
      15_000,
    );
    expect(res.success).toBe(true);
    expect(await sandbox.exists('src/__init__.py')).toBe(true);
    expect(await sandbox.exists('src/tests/__init__.py')).toBe(true);
  });

  it('F3: rejects vacuous workspace verification when only test files exist or Python syntax is invalid (run br0dn)', async () => {
    await sandbox.writeFile('SPEC.md', '# Spec');
    await sandbox.writeFile(
      'src/tests/test_calculator.py',
      'import unittest\nclass T(unittest.TestCase):\n    pass\n',
    );

    // Step 1 asks to implement application code, but only a test file exists
    const missingAppRes = await runVerification([], sandbox, 10_000, {
      taskTitle: 'Implement application code',
    });
    expect(missingAppRes.success).toBe(false);
    expect(missingAppRes.failureClass).toBe('missing_file');

    // Now write a syntax-broken application file
    await sandbox.writeFile('src/calculator.py', 'def add(a, b\n    return a + b\n');
    const syntaxErrRes = await runVerification([], sandbox, 10_000, {
      taskTitle: 'Implement application code',
    });
    expect(syntaxErrRes.success).toBe(false);
    expect(syntaxErrRes.failureClass).toBe('syntax_error');

    // Fix syntax -> passes
    await sandbox.writeFile('src/calculator.py', 'def add(a, b):\n    return a + b\n');
    const okRes = await runVerification([], sandbox, 10_000, {
      taskTitle: 'Implement application code',
    });
    expect(okRes.success).toBe(true);
  });

  it('F4: classifies verification failures and fails fast on non-code command_not_found errors without burning retries', async () => {
    expect(
      classifyVerificationFailure(
        'Not applicable',
        '',
        "Not : The term 'Not' is not recognized as the name of a cmdlet",
      ),
    ).toBe('command_not_found');
    expect(
      classifyVerificationFailure(
        'python -m unittest',
        '',
        "ImportError: Start directory is not importable: 'src/tests'",
      ),
    ).toBe('import_error');

    const badRes = await runVerification(['Not applicable (prose)'], sandbox, 10_000);
    expect(badRes.success).toBe(false);
    expect(badRes.failureClass).toBe('command_not_found');
  });

  it('F7: reprompts once when model outputs fenced code prose without calling write_file (run 2tvz1)', async () => {
    const mockModel = new MockModelClient([
      // Turn 1: model pastes code in markdown prose instead of calling write_file
      {
        response:
          'Here is the calculator code:\n```python\ndef add(a, b):\n    return a + b\n```\n',
      },
      // Turn 2: after F7 format reminder, model invokes write_file
      {
        response: {
          content: 'Writing src/calculator.py now.',
          toolCalls: [
            {
              id: 'call_f7_1',
              type: 'function',
              function: {
                name: 'write_file',
                arguments: JSON.stringify({
                  path: 'src/calculator.py',
                  content: 'def add(a, b):\n    return a + b\n',
                }),
              },
            },
          ],
        },
      },
      // Turn 3: model finishes
      {
        response: 'Created src/calculator.py.',
      },
    ]);

    const artifacts = new ArtifactStore(tempDir, 'p0_f7_run');
    const events: AgentEvent[] = [];

    for await (const ev of runAgentLoop({
      task: 'Make a calculator in python',
      workspaceRoot: tempDir,
      modelClient: mockModel,
      sandbox,
      artifacts,
      tools: createDefaultToolRegistry(),
      skipPlanning: true,
    })) {
      events.push(ev);
    }

    expect(await sandbox.exists('src/calculator.py')).toBe(true);
    const fin = events.find((e) => e.type === 'run_finished');
    expect(fin?.type === 'run_finished' && fin.status).toBe('completed');
  }, 15_000);

  it('F6: supports constrained json_schema tool-calling mode in OpenAICompatibleClient', async () => {
    const tools = createDefaultToolRegistry().getDefinitions();
    const schema = OpenAICompatibleClient.buildConstrainedToolSchema(tools);
    expect(schema).toHaveProperty('properties.action');
    expect(schema).toHaveProperty('properties.name');

    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                role: 'assistant',
                content: JSON.stringify({
                  action: 'tool_call',
                  name: 'write_file',
                  arguments: { path: 'calc.py', content: 'print(1 + 1)\n' },
                }),
              },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 25, total_tokens: 125 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const client = new OpenAICompatibleClient({
      baseUrl: 'http://127.0.0.1:8080/v1',
      model: 'qwen2.5-coder-7b-instruct-q4_k_m',
      toolMode: 'constrained',
    });

    const result = await client.chatWithTools(
      [{ role: 'user', content: 'Write calc.py' }],
      tools,
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const reqInit = mockFetch.mock.calls[0]?.[1];
    const reqBody = JSON.parse(String(reqInit?.body)) as Record<string, unknown>;
    expect(reqBody['response_format']).toMatchObject({ type: 'json_schema' });
    expect(result.parsedToolCalls).toHaveLength(1);
    expect(result.parsedToolCalls[0]?.name).toBe('write_file');
    expect(result.parsedToolCalls[0]?.arguments).toEqual({
      path: 'calc.py',
      content: 'print(1 + 1)\n',
    });
  });

  it('Sandbox relabeling: LocalSandbox exposes honest workspace-scoped (not isolated) mode', () => {
    expect(sandbox.isolationMode).toBe('workspace-scoped (not isolated)');
  });
});
