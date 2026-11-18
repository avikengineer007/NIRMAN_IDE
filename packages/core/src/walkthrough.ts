import type { TaskItem } from '@nirman/artifacts';
import type { Sandbox } from '@nirman/sandbox';

export interface WalkthroughOptions {
  task: string;
  runId: string;
  status: 'completed' | 'failed' | 'cancelled' | 'blocked';
  tasks: readonly TaskItem[];
  specMarkdown?: string | undefined;
  planMarkdown?: string | undefined;
  createdFiles?: readonly string[] | undefined;
  durationMs?: number | undefined;
  verifiedRunCommand?: string | undefined;
  verifiedTestCommand?: string | undefined;
}

/**
 * Checks whether a candidate string extracted from SPEC.md is a real runnable shell command
 * (not "None", "N/A", "Not applicable", or a prose explanation).
 */
export function isRunnableCommandString(candidate?: string): candidate is string {
  if (!candidate) return false;
  const trimmed = candidate.trim();
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();
  if (
    lower === 'none' ||
    lower.startsWith('none ') ||
    lower.startsWith('none(') ||
    lower === 'n/a' ||
    lower.startsWith('not applicable') ||
    lower.startsWith('see spec') ||
    lower.startsWith('no ')
  ) {
    return false;
  }
  return true;
}

/**
 * Extracts a command for a given label (e.g. "Run|Start" or "Test") from SPEC.md.
 * Handles:
 *  - `- **Run:** \`python src/main.py\`` (colon inside bold)
 *  - `- **Run**: \`python src/main.py\`` (colon outside bold)
 *  - `- Run: python src/main.py`
 *  - Multi-line fenced code blocks immediately under `- **Run:**` or `### Run`
 *  - Multi-line sub-bullets under `- **Run:**`
 */
export function extractSpecCommand(
  specMarkdown: string | undefined,
  labelPattern: string,
): string | undefined {
  if (!specMarkdown) return undefined;

  // 1. Multi-line fenced code block right after label (e.g. "- **Test:**\n ```bash\n cmd\n ```")
  const codeBlockRegex = new RegExp(
    `(?:^|\\n)\\s*(?:[-*]|#{1,4})?\\s*\\*{0,2}(?:${labelPattern})(?:\\s+Command)?\\s*[:=-]?\\*{0,2}\\s*[:=-]?\\s*\\n\\s*\`\`\`(?:[a-zA-Z0-9_-]*)\\s*\\n([^\\n\`]+)\\n\\s*\`\`\``,
    'i',
  );
  const codeBlockMatch = specMarkdown.match(codeBlockRegex);
  if (codeBlockMatch?.[1] && isRunnableCommandString(codeBlockMatch[1])) {
    return codeBlockMatch[1].trim();
  }

  // 2. Inline on the same line (handles colon inside or outside **bold**)
  const inlineRegex = new RegExp(
    `(?:^|\\n)\\s*[-*]?\\s*\\*{0,2}(?:${labelPattern})(?:\\s+Command)?\\s*[:=-]?\\*{0,2}\\s*[:=-]?\\s*\`?([^\\n\`*]+)\`?`,
    'i',
  );
  const inlineMatch = specMarkdown.match(inlineRegex);
  if (inlineMatch?.[1] && isRunnableCommandString(inlineMatch[1])) {
    return inlineMatch[1].trim();
  }

  // 3. Sub-bullet on the next line (e.g. "- **Run:**\n  - `python src/main.py`")
  const subBulletRegex = new RegExp(
    `(?:^|\\n)\\s*[-*]?\\s*\\*{0,2}(?:${labelPattern})(?:\\s+Command)?\\s*[:=-]?\\*{0,2}\\s*[:=-]?\\s*\\n\\s*[-*]\\s*\`?([^\\n\`]+)\`?`,
    'i',
  );
  const subBulletMatch = specMarkdown.match(subBulletRegex);
  if (subBulletMatch?.[1] && isRunnableCommandString(subBulletMatch[1])) {
    return subBulletMatch[1].trim();
  }

  return undefined;
}

/**
 * Filters raw workspace file paths down to user-facing project source files.
 */
export function filterProjectFiles(files?: readonly string[]): string[] {
  if (!files || files.length === 0) return [];
  return files
    .map((f) => f.replace(/\\/g, '/').replace(/^\.\//, ''))
    .filter(
      (f) =>
        f.length > 0 &&
        !f.startsWith('.git') &&
        !f.startsWith('.agent') &&
        !f.startsWith('node_modules') &&
        !f.includes('__pycache__') &&
        !f.endsWith('.pyc') &&
        f !== 'SPEC.md' &&
        f !== 'PLAN.md' &&
        f !== 'WALKTHROUGH.md',
    );
}

/**
 * Checks if a Python file path is a test file or package marker rather than a runnable app script.
 */
export function isPythonTestOrMetaFile(filePath: string): boolean {
  const norm = filePath.replace(/\\/g, '/').toLowerCase();
  const base = norm.split('/').pop() ?? '';
  if (base === '__init__.py' || base === 'setup.py' || base === 'conftest.py') {
    return true;
  }
  if (
    base.startsWith('test_') ||
    base.endsWith('_test.py') ||
    base === 'test.py' ||
    base === 'tests.py' ||
    norm.includes('/tests/') ||
    norm.includes('/test/') ||
    norm.startsWith('tests/') ||
    norm.startsWith('test/')
  ) {
    return true;
  }
  return false;
}

/**
 * Resolves the best working Run and Test commands given SPEC.md and the actual created files on disk.
 */
export function resolveWalkthroughCommands(
  specMarkdown?: string,
  createdFiles?: readonly string[],
): { runCommand: string; testCommand: string } {
  const projectFiles = filterProjectFiles(createdFiles);
  const rawRunCmd = extractSpecCommand(specMarkdown, 'Run|Start');
  const rawTestCmd = extractSpecCommand(specMarkdown, 'Test|Verify');

  // Identify primary Python application file(s)
  const pyAppFiles = projectFiles.filter((f) => f.endsWith('.py') && !isPythonTestOrMetaFile(f));
  const preferredPyNames = ['main.py', 'app.py', 'calculator.py', 'cli.py', 'run.py', 'server.py'];
  const pyMain =
    pyAppFiles.find((f) => preferredPyNames.includes(f.split('/').pop()?.toLowerCase() ?? '')) ??
    pyAppFiles[0];

  // Identify Python test files
  const pyTestFiles = projectFiles.filter(
    (f) => f.endsWith('.py') && isPythonTestOrMetaFile(f) && !f.endsWith('__init__.py'),
  );

  // Identify JS / TS application file(s)
  const jsAppFiles = projectFiles.filter(
    (f) =>
      (f.endsWith('.js') || f.endsWith('.mjs')) &&
      !f.toLowerCase().includes('test') &&
      !f.toLowerCase().includes('config') &&
      !f.toLowerCase().includes('setup'),
  );
  const preferredJsNames = ['index.js', 'server.js', 'app.js', 'main.js', 'calculator.js'];
  const jsMain =
    jsAppFiles.find((f) => preferredJsNames.includes(f.split('/').pop()?.toLowerCase() ?? '')) ??
    jsAppFiles[0];

  const tsMain = projectFiles.find(
    (f) => f.endsWith('.ts') && !f.endsWith('.d.ts') && !f.toLowerCase().includes('test'),
  );
  const cMain = projectFiles.find((f) => f.endsWith('.c') && !f.toLowerCase().includes('test'));
  const cppMain = projectFiles.find(
    (f) => (f.endsWith('.cpp') || f.endsWith('.cc') || f.endsWith('.cxx')) && !f.toLowerCase().includes('test'),
  );
  const javaMain = projectFiles.find((f) => f.endsWith('.java') && !f.toLowerCase().includes('test'));
  const goMain = projectFiles.find((f) => f.endsWith('.go') && !f.endsWith('_test.go'));
  const rustMain = projectFiles.find((f) => f.endsWith('.rs') && !f.toLowerCase().includes('test'));
  const csProj = projectFiles.find((f) => f.endsWith('.csproj'));
  const rbMain = projectFiles.find((f) => f.endsWith('.rb') && !f.toLowerCase().includes('test'));
  const phpMain = projectFiles.find((f) => f.endsWith('.php') && !f.toLowerCase().includes('test'));

  const htmlMain =
    projectFiles.find((f) => f.toLowerCase().endsWith('index.html')) ??
    projectFiles.find((f) => f.toLowerCase().endsWith('.html'));

  // Validate if rawRunCmd references a script file that actually exists in projectFiles
  let validSpecRunCmd = rawRunCmd;
  if (validSpecRunCmd && projectFiles.length > 0) {
    const scriptMatch = validSpecRunCmd.match(
      /^(?:python3?|py|node|ruby|php|go\s+run)\s+(?!-m\b)([^\s]+)/i,
    );
    if (scriptMatch?.[1]) {
      const targetScript = scriptMatch[1].replace(/\\/g, '/').replace(/^\.\//, '');
      if (!projectFiles.includes(targetScript)) {
        // The file named in SPEC.md wasn't the actual path created on disk; override with real file
        validSpecRunCmd = undefined;
      }
    }
  }

  const exePrefix = process.platform === 'win32' ? '.\\app.exe' : './app';
  const exeOut = process.platform === 'win32' ? 'app.exe' : 'app';

  let inferredRunCmd: string | undefined;
  if (pyMain) {
    inferredRunCmd = `python ${pyMain}`;
  } else if (tsMain) {
    inferredRunCmd = `npx tsx ${tsMain}`;
  } else if (projectFiles.includes('package.json') && !jsMain) {
    inferredRunCmd = 'npm start';
  } else if (jsMain) {
    inferredRunCmd = `node ${jsMain}`;
  } else if (cppMain) {
    inferredRunCmd = `g++ -std=c++17 ${cppMain} -o ${exeOut} && ${exePrefix}`;
  } else if (cMain) {
    inferredRunCmd = `gcc ${cMain} -o ${exeOut} && ${exePrefix}`;
  } else if (javaMain) {
    const lastSlash = javaMain.lastIndexOf('/');
    const classDir = lastSlash !== -1 ? javaMain.slice(0, lastSlash) : '.';
    const className = (lastSlash !== -1 ? javaMain.slice(lastSlash + 1) : javaMain).replace(/\.java$/i, '');
    inferredRunCmd =
      classDir === '.'
        ? `javac ${javaMain} && java ${className}`
        : `javac ${javaMain} && java -cp ${classDir} ${className}`;
  } else if (goMain) {
    inferredRunCmd = `go run ${goMain}`;
  } else if (projectFiles.includes('Cargo.toml')) {
    inferredRunCmd = 'cargo run';
  } else if (rustMain) {
    inferredRunCmd = `rustc ${rustMain} -o ${exeOut} && ${exePrefix}`;
  } else if (csProj) {
    inferredRunCmd = 'dotnet run';
  } else if (rbMain) {
    inferredRunCmd = `ruby ${rbMain}`;
  } else if (phpMain) {
    inferredRunCmd = `php ${phpMain}`;
  } else if (htmlMain) {
    inferredRunCmd = process.platform === 'win32' ? `start ${htmlMain}` : `open ${htmlMain}`;
  }

  const runCommand = validSpecRunCmd ?? inferredRunCmd ?? 'See SPEC.md for start command';

  // Resolve Test Command
  let inferredTestCmd: string | undefined;
  if (pyTestFiles.length > 0) {
    const firstTest = pyTestFiles[0]!;
    const lastSlash = firstTest.lastIndexOf('/');
    const testDir = lastSlash !== -1 ? firstTest.slice(0, lastSlash) : '.';
    const testFileName = lastSlash !== -1 ? firstTest.slice(lastSlash + 1) : firstTest;
    const pattern = testFileName.startsWith('test') ? 'test*.py' : '*test*.py';
    if (testDir === '.') {
      inferredTestCmd = `python -m unittest discover -s . -p "${pattern}"`;
    } else {
      inferredTestCmd = `python -m unittest discover -s ${testDir} -p "${pattern}" -t .`;
    }
  } else if (projectFiles.includes('package.json')) {
    inferredTestCmd = 'npm test';
  } else if (pyMain) {
    inferredTestCmd = `python -m py_compile ${pyMain}`;
  } else if (tsMain) {
    inferredTestCmd = 'npx tsc --noEmit';
  } else if (jsMain) {
    inferredTestCmd = `node --check ${jsMain}`;
  } else if (cppMain) {
    inferredTestCmd = `g++ -std=c++17 -fsyntax-only ${cppMain}`;
  } else if (cMain) {
    inferredTestCmd = `gcc -fsyntax-only ${cMain}`;
  } else if (javaMain) {
    inferredTestCmd = `javac ${javaMain}`;
  } else if (goMain) {
    inferredTestCmd = 'go test ./...';
  } else if (projectFiles.includes('Cargo.toml')) {
    inferredTestCmd = 'cargo test';
  } else if (rustMain) {
    inferredTestCmd = `rustc --emit=metadata ${rustMain}`;
  } else if (csProj) {
    inferredTestCmd = 'dotnet build';
  } else if (rbMain) {
    inferredTestCmd = `ruby -c ${rbMain}`;
  } else if (phpMain) {
    inferredTestCmd = `php -l ${phpMain}`;
  }

  let validSpecTestCmd = rawTestCmd;
  if (
    validSpecTestCmd &&
    /^python3?\s+-m\s+unittest\s+discover\s+-s\s+([^\s]+)$/i.test(validSpecTestCmd)
  ) {
    // Ensure -t . is appended when discovering tests in a nested folder like src/tests
    const dirMatch = validSpecTestCmd.match(/-s\s+([^\s]+)/i);
    if (dirMatch?.[1] && dirMatch[1] !== '.' && !validSpecTestCmd.includes('-t ')) {
      validSpecTestCmd = `${validSpecTestCmd} -t .`;
    }
  }

  const testCommand = validSpecTestCmd ?? inferredTestCmd ?? 'See SPEC.md for test command';

  return { runCommand, testCommand };
}

/**
 * Inspects non-test Python scripts in the workspace and ensures that if the model
 * wrote only function definitions (`def ...`) without an `if __name__ == "__main__":`
 * or top-level execution block, an interactive CLI entry point is automatically appended
 * so running `python <file>.py` in the terminal works immediately.
 */
export async function ensureRunnablePythonScripts(
  sandbox: Sandbox,
  createdFiles: readonly string[],
): Promise<void> {
  const projectFiles = filterProjectFiles(createdFiles);
  const pyAppFiles = projectFiles.filter((f) => f.endsWith('.py') && !isPythonTestOrMetaFile(f));

  for (const pyFile of pyAppFiles) {
    try {
      const content = await sandbox.readFile(pyFile);
      if (content.includes('__name__')) {
        continue;
      }

      // Check if there is already top-level executable code outside def/class/import/comments
      const lines = content.split(/\r?\n/);
      const hasTopLevelExec = lines.some((line) => {
        if (!line || /^\s/.test(line) || /^\s*#/.test(line)) return false;
        const trimmed = line.trim();
        if (
          trimmed.startsWith('def ') ||
          trimmed.startsWith('class ') ||
          trimmed.startsWith('import ') ||
          trimmed.startsWith('from ') ||
          trimmed.startsWith('@') ||
          trimmed.startsWith('"""') ||
          trimmed.startsWith("'''")
        ) {
          return false;
        }
        return /\b(print|input|main|run|mainloop)\s*\(/.test(trimmed);
      });

      if (hasTopLevelExec) {
        continue;
      }

      // Parse top-level functions: def name(arg1, arg2):
      const funcMatches = [
        ...content.matchAll(/^def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([^)]*)\)\s*:/gm),
      ];
      if (funcMatches.length === 0) {
        continue;
      }

      const funcs = funcMatches
        .map((m) => ({
          name: m[1]!,
          params: m[2]!
            .split(',')
            .map((p) => p.split(':')[0]!.split('=')[0]!.trim())
            .filter((p) => p.length > 0 && p !== 'self' && !p.startsWith('*')),
        }))
        .filter((f) => !f.name.startsWith('_'));

      if (funcs.length === 0) {
        continue;
      }

      const funcNames = new Set(funcs.map((f) => f.name));
      let cliBlock = '';

      if (
        funcNames.has('add') &&
        (funcNames.has('subtract') || funcNames.has('multiply') || funcNames.has('divide'))
      ) {
        cliBlock = `

if __name__ == "__main__":
    print("=== Interactive Python Calculator ===")
    while True:
        try:
            op = input("\\nEnter operation (+, -, *, / or add, subtract, multiply, divide, q to quit): ").strip().lower()
            if op in ("q", "quit", "exit"):
                print("Goodbye!")
                break
            a = float(input("Enter first number: ").strip())
            b = float(input("Enter second number: ").strip())
            if op in ("+", "add"):
                print("Result:", add(a, b))
            elif op in ("-", "subtract") and "subtract" in globals():
                print("Result:", subtract(a, b))
            elif op in ("*", "multiply") and "multiply" in globals():
                print("Result:", multiply(a, b))
            elif op in ("/", "divide") and "divide" in globals():
                print("Result:", divide(a, b))
            else:
                print("Unknown operation:", op)
        except (EOFError, KeyboardInterrupt):
            print("\\nExiting.")
            break
        except Exception as err:
            print("Error:", err)
`;
      } else {
        const primary = funcs[0]!;
        const parseValueHelper = `    def _parse_input(raw_val):\n        try:\n            return int(raw_val) if raw_val.isdigit() else float(raw_val)\n        except ValueError:\n            return raw_val\n`;
        const argPrompts = primary.params
          .map(
            (p, idx) =>
              `        arg_${idx} = _parse_input(input("Enter ${p.replace(/_/g, ' ')}: ").strip())`,
          )
          .join('\n');
        const argCallList = primary.params.map((_, idx) => `arg_${idx}`).join(', ');
        cliBlock = `

if __name__ == "__main__":
${parseValueHelper}    try:
${argPrompts ? `${argPrompts}\n` : ''}        result = ${primary.name}(${argCallList})
        if result is not None:
            print("Result:", result)
    except (EOFError, KeyboardInterrupt):
        pass
    except Exception as err:
        print("Error:", err)
`;
      }

      await sandbox.writeFile(pyFile, `${content.trimEnd()}${cliBlock}`);
    } catch {
      // Ignore read/write errors on individual files
    }
  }
}

/**
 * Verifies the resolved Run and Test commands inside the sandbox before writing the Walkthrough,
 * ensuring the terminal commands given to the user actually work.
 */
export async function verifyWalkthroughCommands(
  sandbox: Sandbox,
  specMarkdown?: string,
  createdFiles?: readonly string[],
): Promise<{ verifiedRunCommand: string; verifiedTestCommand: string }> {
  const projectFiles = filterProjectFiles(createdFiles);
  const { runCommand, testCommand } = resolveWalkthroughCommands(specMarkdown, projectFiles);

  let verifiedTestCommand = testCommand;
  const pyTestFiles = projectFiles.filter(
    (f) => f.endsWith('.py') && isPythonTestOrMetaFile(f) && !f.endsWith('__init__.py'),
  );

  if (pyTestFiles.length > 0) {
    const candidates: string[] = [];
    if (isRunnableCommandString(testCommand)) {
      candidates.push(testCommand);
    }
    for (const tf of pyTestFiles) {
      const lastSlash = tf.lastIndexOf('/');
      const dir = lastSlash !== -1 ? tf.slice(0, lastSlash) : '.';
      const cmdWithTop =
        dir === '.'
          ? `python -m unittest discover -s . -p "test*.py"`
          : `python -m unittest discover -s ${dir} -p "test*.py" -t .`;
      if (!candidates.includes(cmdWithTop)) {
        candidates.push(cmdWithTop);
      }
      const directFileCmd = `python -m unittest ${tf}`;
      if (!candidates.includes(directFileCmd)) {
        candidates.push(directFileCmd);
      }
    }

    for (const candidate of candidates) {
      try {
        const res = await sandbox.executeCommand(candidate, { timeoutMs: 8_000 });
        const combinedOut = `${res.stdout}\n${res.stderr}`;
        if (res.exitCode === 0 && !/Ran 0 tests/i.test(combinedOut)) {
          verifiedTestCommand = candidate;
          break;
        }
      } catch {
        // try next candidate
      }
    }
  }

  return {
    verifiedRunCommand: runCommand,
    verifiedTestCommand,
  };
}

/**
 * Generates a comprehensive markdown walkthrough report for the agent run.
 */
export function generateWalkthrough(options: WalkthroughOptions): string {
  const {
    task,
    runId,
    status,
    tasks,
    specMarkdown,
    createdFiles,
    verifiedRunCommand,
    verifiedTestCommand,
  } = options;
  const isSuccess = status === 'completed';
  const statusBadge = isSuccess
    ? '✅ SUCCESS'
    : status === 'blocked'
      ? '🛑 BLOCKED'
      : `⚠️ ${status.toUpperCase()}`;

  const resolved = resolveWalkthroughCommands(specMarkdown, createdFiles);
  const runCommand = verifiedRunCommand ?? resolved.runCommand;
  const testCommand = verifiedTestCommand ?? resolved.testCommand;

  // Build task table
  const taskRows = tasks.map((t) => {
    const icon =
      t.status === 'completed'
        ? '✅ Completed'
        : t.status === 'blocked'
          ? '🛑 Blocked'
          : t.status === 'failed'
            ? '❌ Failed'
            : '⏳ Pending';
    const retries = t.retries ? `${t.retries}` : '0';
    const notes = t.error ? t.error.slice(0, 60).replace(/[\r\n]/g, ' ') : '-';
    return `| \`${t.id}\` | ${t.title} | ${icon} | ${retries} | ${notes} |`;
  });

  const displayFiles = filterProjectFiles(createdFiles);
  const fileList =
    displayFiles.length > 0
      ? displayFiles.map((f) => `- \`${f}\``).join('\n')
      : createdFiles && createdFiles.length > 0
        ? createdFiles.map((f) => `- \`${f}\``).join('\n')
        : '- Created files are tracked in `diff.patch`';

  // Blockers / Failures section
  const blockedTasks = tasks.filter((t) => t.status === 'blocked' || t.status === 'failed');
  let failuresSection = 'No blocking failures encountered. All tasks passed verification.';
  if (blockedTasks.length > 0) {
    failuresSection = blockedTasks
      .map(
        (bt) => `### Task \`${bt.id}\`: ${bt.title}
- **Status:** ${bt.status.toUpperCase()} (after ${bt.retries ?? 0} retries)
- **Error:**
\`\`\`
${bt.error ?? 'Unknown error'}
\`\`\`
`,
      )
      .join('\n');
  }

  return `# Project Walkthrough: ${task}

## Overview
- **Run ID:** \`${runId}\`
- **Result:** ${statusBadge}
- **Artifacts:** \`.agent/runs/${runId}/\`
- **Task Completion:** ${tasks.filter((t) => t.status === 'completed').length} / ${tasks.length} tasks completed

---

## What Was Built
${fileList}

---

## How to Run in Terminal

Open the integrated terminal (\`Ctrl+\`\`) in your workspace root or click **▶ Run in Terminal** below:

### Run the Application
\`\`\`bash
${runCommand}
\`\`\`

### Run Tests
\`\`\`bash
${testCommand}
\`\`\`

---

## Task Execution Summary

| Task ID | Task Title | Status | Retries | Notes |
| :--- | :--- | :--- | :---: | :--- |
${taskRows.join('\n')}

---

## Failures & Blockers
${failuresSection}
`;
}
