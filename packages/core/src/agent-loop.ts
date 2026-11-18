import path from 'node:path';
import { estimateMessagesTokens, type ChatMessage, type NativeToolCall } from '@nirman/model';
import { LocalSandbox } from '@nirman/sandbox';
import { createDefaultToolRegistry } from '@nirman/tools';
import {
  ArtifactStore,
  createClarificationRequestedEvent,
  createErrorEvent,
  createModelMessageEvent,
  createPlanApprovedEvent,
  createPlanCreatedEvent,
  createPlanRevisionRequestedEvent,
  createRunFinishedEvent,
  createRunStartedEvent,
  createTaskRetryEvent,
  createTaskStatusChangedEvent,
  createToolCallEvent,
  createToolResultEvent,
  createVerificationFinishedEvent,
  createVerificationStartedEvent,
  createWalkthroughCreatedEvent,
  type AgentEvent,
  type TaskItem,
} from '@nirman/artifacts';
import {
  PolicyEngine,
  AuditLogger,
  EncryptedSecretsStore,
  TaintTracker,
  wrapUntrustedContent,
} from '@nirman/security';
import { BrowserVerifier, DevServerManager } from '@nirman/browser';
import { Planner, parsePlanTasks, type PlanGenerationResult } from './planner.js';
import { extractVerificationCommands, parseRelevantError, runVerification } from './verifier.js';
import { captureRunDiff, captureTaskDiff, initGitRepo } from './git.js';
import {
  ensureRunnablePythonScripts,
  generateWalkthrough,
  verifyWalkthroughCommands,
} from './walkthrough.js';
import { ContextManager } from './context/context-manager.js';
import type { RetrievedSnippet } from './index/types.js';
import type { AgentLoopOptions, AgentLoopResult } from './types.js';

export const DEFAULT_SYSTEM_PROMPT = `You are NIRMAN, an autonomous agentic coding assistant.
You plan, build, and verify software projects inside a sandboxed environment.
You have access to tools for reading, writing, editing files, searching, and running shell commands.
Follow these principles:
1. Focus strictly on implementing the requested task using tools to write and edit files.
2. CRITICAL FOR PYTHON / CLI PROGRAMS: Every main application script (e.g. calculator.py, main.py, app.py) MUST include an interactive or runnable \`if __name__ == "__main__":\` entry point at the bottom (with clear user prompts or output) so that running \`python <file>.py\` in the terminal immediately works! NEVER remove the \`if __name__ == "__main__":\` block when creating unit tests (because \`if __name__ == "__main__":\` does not run when imported by unittest).
3. When the files for the current task are written or tests pass with exit code 0, conclude your response immediately WITHOUT calling any more tools so verification can finish.
`;

/**
 * Executes the bounded agent loop with planning, user approval, deterministic verification,
 * capped retry fix attempts, git diff tracking, and walkthrough generation.
 */
export async function* runAgentLoop(
  options: AgentLoopOptions,
): AsyncGenerator<AgentEvent, AgentLoopResult, unknown> {
  const startTime = Date.now();
  const workspaceRoot = options.workspaceRoot;
  const store = options.artifacts ?? new ArtifactStore(workspaceRoot);
  const sandbox = options.sandbox ?? new LocalSandbox({ workspaceRoot });
  const tools = options.tools ?? createDefaultToolRegistry();

  const maxSteps = options.maxSteps ?? 50;
  const maxTimeMs = options.maxTimeMs ?? 120_000;
  const maxTokens = options.maxTokens ?? 32_000;
  const maxRetriesPerTask = options.maxRetriesPerTask ?? 3;
  const verificationTimeoutMs = options.verificationTimeoutMs ?? 30_000;

  // Security services
  const policyEngine =
    options.policyEngine ?? (await PolicyEngine.loadFromWorkspace(workspaceRoot));
  const auditLogger =
    options.auditLogger ?? new AuditLogger(path.join(workspaceRoot, '.agent', 'audit.jsonl'));
  const secretsStore =
    options.secretsStore ??
    new EncryptedSecretsStore({ storagePath: path.join(workspaceRoot, '.agent', 'secrets.enc') });
  const taintTracker = options.taintTracker ?? new TaintTracker();

  // 1. Initialize run artifacts
  await store.init(options.task);
  await initGitRepo(sandbox);

  const startEvent = createRunStartedEvent(store.runId, options.task);
  await store.appendEvent(startEvent);
  options.onEvent?.(startEvent);
  yield startEvent;

  let activeTasks: TaskItem[] = [];
  let planMarkdown = '';
  let specMarkdown = '';

  if (options.skipPlanning) {
    try {
      specMarkdown = await store.readSpec();
    } catch {
      specMarkdown = '';
    }
    try {
      planMarkdown = await store.readPlan();
      activeTasks = parsePlanTasks(planMarkdown);
    } catch {
      planMarkdown = '';
    }
  }

  // 2. Planning Phase (unless explicitly skipped)
  if (!options.skipPlanning) {
    const planner = options.planner ?? new Planner();

    // 2a. Ask clarifying questions (at most 3, only if essential and not skipped)
    let answers: Record<string, string> = {};
    if (!options.skipClarifications) {
      const questions = await planner.generateClarifications(options.task, options.modelClient);
      if (questions.length > 0) {
        const clarifyEvent = createClarificationRequestedEvent(store.runId, questions);
        await store.appendEvent(clarifyEvent);
        options.onEvent?.(clarifyEvent);
        yield clarifyEvent;

        if (options.onClarification) {
          answers = await options.onClarification(questions);
        }
      }
    }

    // 2b. Generate plan.md and SPEC.md
    let planResult: PlanGenerationResult = await planner.generatePlan(
      options.task,
      answers,
      options.modelClient,
    );
    planMarkdown = planResult.planMarkdown;
    specMarkdown = planResult.specMarkdown;
    activeTasks = [...planResult.tasks];

    await store.writePlan(planMarkdown);
    await store.writeSpec(specMarkdown);
    await store.updateTasks({ status: 'waiting_approval', tasks: activeTasks });

    const planCreatedEvent = createPlanCreatedEvent(
      store.runId,
      store.planPath,
      store.specPath,
      activeTasks,
    );
    await store.appendEvent(planCreatedEvent);
    options.onEvent?.(planCreatedEvent);
    yield planCreatedEvent;

    // 2c. Pause for approval
    while (true) {
      const decision = options.onApproval
        ? await options.onApproval(store.planPath, store.specPath, activeTasks)
        : { action: 'approve' as const };

      if (decision.action === 'approve') {
        const approvedEvent = createPlanApprovedEvent(store.runId);
        await store.appendEvent(approvedEvent);
        options.onEvent?.(approvedEvent);
        yield approvedEvent;

        await store.updateTasks({ status: 'running' });
        break;
      }

      if (decision.action === 'reject') {
        const reason = decision.reason ?? 'Plan rejected by user';
        const durationMs = Date.now() - startTime;
        const finishEvent = createRunFinishedEvent(
          store.runId,
          'cancelled',
          0,
          durationMs,
          reason,
        );
        await store.appendEvent(finishEvent);
        options.onEvent?.(finishEvent);
        yield finishEvent;

        await store.updateTasks({
          status: 'cancelled',
          reason,
          completedAt: new Date().toISOString(),
        });

        return {
          runId: store.runId,
          status: 'cancelled',
          totalSteps: 0,
          durationMs,
          reason,
          messages: [],
          artifacts: store,
          tasks: activeTasks,
        };
      }

      if (decision.action === 'edited') {
        let editedContent = decision.editedPlan;
        if (!editedContent) {
          editedContent = await store.readPlan();
        } else {
          await store.writePlan(editedContent);
        }
        planMarkdown = editedContent;
        activeTasks = parsePlanTasks(editedContent);
        await store.updateTasks({ tasks: activeTasks });

        const editedEvent = createPlanCreatedEvent(
          store.runId,
          store.planPath,
          store.specPath,
          activeTasks,
        );
        await store.appendEvent(editedEvent);
        options.onEvent?.(editedEvent);
        yield editedEvent;
      }

      if (decision.action === 'feedback') {
        const feedbackEvent = createPlanRevisionRequestedEvent(store.runId, decision.feedback);
        await store.appendEvent(feedbackEvent);
        options.onEvent?.(feedbackEvent);
        yield feedbackEvent;

        planResult = await planner.revisePlan(
          options.task,
          planMarkdown,
          specMarkdown,
          decision.feedback,
          options.modelClient,
        );
        planMarkdown = planResult.planMarkdown;
        specMarkdown = planResult.specMarkdown;
        activeTasks = [...planResult.tasks];

        await store.writePlan(planMarkdown);
        await store.writeSpec(specMarkdown);
        await store.updateTasks({ tasks: activeTasks });

        const revisedEvent = createPlanCreatedEvent(
          store.runId,
          store.planPath,
          store.specPath,
          activeTasks,
        );
        await store.appendEvent(revisedEvent);
        options.onEvent?.(revisedEvent);
        yield revisedEvent;
      }
    }
  }

  // Fallback if no tasks generated
  if (activeTasks.length === 0) {
    activeTasks = [
      {
        id: 'step-1',
        title: options.task,
        status: 'pending',
      },
    ];
    await store.updateTasks({ tasks: activeTasks });
  }

  // 3. Execution Phase
  let totalSteps = 0;
  let finalStatus: 'completed' | 'failed' | 'cancelled' | 'blocked' = 'completed';
  let finishReason: string | undefined;
  let loopError: string | undefined;
  const executionMessages: ChatMessage[] = [];

  try {
    for (const task of activeTasks) {
      // Check execution limits before starting a task
      if (totalSteps >= maxSteps) {
        finishReason = `Max steps limit (${maxSteps}) reached`;
        finalStatus = 'failed';
        break;
      }
      if (Date.now() - startTime >= maxTimeMs) {
        finishReason = `Max execution time (${maxTimeMs}ms) exceeded`;
        finalStatus = 'failed';
        break;
      }

      // Mark task in progress
      task.status = 'in_progress';
      task.retries = 0;
      await store.updateTaskStatus(task.id, 'in_progress', { retries: 0 });
      const taskStartEvt = createTaskStatusChangedEvent(store.runId, task.id, 'in_progress');
      await store.appendEvent(taskStartEvt);
      options.onEvent?.(taskStartEvt);
      yield taskStartEvt;

      // Extract verification commands from SPEC.md or task
      let verifyCommands = extractVerificationCommands(
        specMarkdown,
        task.title,
        task.description ?? '',
      );

      // If any command references a specific file that does not exist yet (e.g. node test/test.js)
      // and there are pending tasks remaining in the plan that create that file,
      // skip that command for intermediate tasks so intermediate steps aren't prematurely blocked
      const remainingTasks = activeTasks.filter(
        (t) => t.id !== task.id && t.status === 'pending',
      );
      if (remainingTasks.length > 0) {
        const filteredCommands: string[] = [];
        for (const cmd of verifyCommands) {
          const match = cmd.match(/^(?:node|python|sh|bash)\s+([^\s]+)/i);
          if (match && match[1]) {
            const targetFile = match[1];
            const fileExists = await sandbox.exists(targetFile);
            if (!fileExists) {
              continue;
            }
          }
          filteredCommands.push(cmd);
        }
        verifyCommands = filteredCommands;
      }

      // Context Manager assembly with budget enforcement and snippet retrieval
      const contextManager =
        options.contextManager ??
        new ContextManager({
          tokenBudget: maxTokens,
          systemPrompt: options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
          specMarkdown,
        });

      let retrievedSnippets: RetrievedSnippet[] = [];
      if (options.repoIndex) {
        try {
          retrievedSnippets = await options.repoIndex.retrieve(
            `${task.title} ${task.description ?? ''}`,
            { maxTokens: Math.floor(maxTokens * 0.25) },
          );
        } catch {
          retrievedSnippets = [];
        }
      }

      const initialAssembly = contextManager.assemble({
        task,
        retrievedSnippets,
        userInstruction: `Please implement task "${task.title}". Create or update the required files.`,
      });

      const taskMessages: ChatMessage[] = initialAssembly.messages;

      let taskFinished = false;

      // Task Fix Loop (capped retries)
      while (!taskFinished) {
        let attemptTurnCount = 0;
        let lastToolCallsSignature = '';
        const seenWriteOrListSignatures = new Set<string>();
        const writtenFilesInStep = new Set<string>();

        // Model Turn Loop (runs tools until model stops calling tools)
        while (true) {
          if (totalSteps >= maxSteps) {
            finishReason = `Max steps limit (${maxSteps}) reached`;
            finalStatus = 'failed';
            break;
          }
          if (Date.now() - startTime >= maxTimeMs) {
            finishReason = `Max execution time (${maxTimeMs}ms) exceeded`;
            finalStatus = 'failed';
            break;
          }
          const currentTokens = estimateMessagesTokens(taskMessages);
          if (currentTokens >= maxTokens) {
            finishReason = `Max tokens limit (${maxTokens}) exceeded (current estimate: ${currentTokens})`;
            finalStatus = 'failed';
            break;
          }

          totalSteps++;
          await store.updateTasks({ stepsCount: totalSteps });

          const response = await options.modelClient.chatWithTools(
            taskMessages,
            tools.getDefinitions(),
          );

          if (response.message.content) {
            const msgEvent = createModelMessageEvent(
              store.runId,
              'assistant',
              response.message.content,
            );
            await store.appendEvent(msgEvent);
            options.onEvent?.(msgEvent);
            yield msgEvent;
          }

          if (response.parsedToolCalls.length > 0) {
            const currentSignature = response.parsedToolCalls
              .map((tc) => `${tc.name}:${tc.rawArguments ?? JSON.stringify(tc.arguments)}`)
              .join('|');

            if (
              currentSignature === lastToolCallsSignature ||
              seenWriteOrListSignatures.has(currentSignature)
            ) {
              // Duplicate identical tool calls; break turn loop to trigger verification
              break;
            }
            lastToolCallsSignature = currentSignature;
            if (
              response.parsedToolCalls.every(
                (tc) =>
                  tc.name === 'write_file' || tc.name === 'edit_file' || tc.name === 'list_dir',
              )
            ) {
              seenWriteOrListSignatures.add(currentSignature);
            }

            attemptTurnCount++;
            if (attemptTurnCount > 6) {
              // Cap tool calls per attempt to prevent runaway turn loops
              break;
            }

            const nativeCalls: NativeToolCall[] = response.parsedToolCalls.map((tc) => ({
              id: tc.id,
              type: 'function',
              function: {
                name: tc.name,
                arguments: tc.rawArguments ?? JSON.stringify(tc.arguments),
              },
            }));

            taskMessages.push({
              role: 'assistant',
              content: response.message.content,
              tool_calls: nativeCalls,
            });

            for (const toolCall of response.parsedToolCalls) {
              // 1. Expand secrets in command strings if present
              let effectiveArgs = toolCall.arguments;
              if (toolCall.name === 'run_shell' && typeof effectiveArgs['command'] === 'string') {
                try {
                  const expandedCmd = await secretsStore.expandSecrets(effectiveArgs['command']);
                  effectiveArgs = { ...effectiveArgs, command: expandedCmd };
                } catch (err) {
                  // If referenced secret is missing, pass failure directly
                  const errMsg = err instanceof Error ? err.message : String(err);
                  const failEvent = createToolResultEvent(
                    store.runId,
                    toolCall.id,
                    toolCall.name,
                    false,
                    '',
                    errMsg,
                    false,
                  );
                  await store.appendEvent(failEvent);
                  options.onEvent?.(failEvent);
                  yield failEvent;

                  taskMessages.push({
                    role: 'tool',
                    name: toolCall.name,
                    tool_call_id: toolCall.id,
                    content: `Secret Expansion Error: ${errMsg}`,
                  });
                  continue;
                }
              }

              // 2. Evaluate against Security Policy
              const isTainted = taintTracker.isTainted();
              const taintSource = taintTracker.getTaintSource();
              const policyEval = policyEngine.evaluate({
                toolName: toolCall.name,
                args: effectiveArgs,
                workspaceRoot,
                isTainted,
                taintSource,
              });

              // Log evaluation to append-only, hash-chained audit log
              await auditLogger.log({
                id: `eval-${toolCall.id}`,
                timestamp: new Date().toISOString(),
                eventType: 'policy_eval',
                action: policyEval.action,
                tool: toolCall.name,
                params: secretsStore.redactObject(toolCall.arguments),
                tainted: isTainted,
              });

              // 3. Handle DENY decision
              if (policyEval.action === 'deny') {
                const callEvent = createToolCallEvent(
                  store.runId,
                  toolCall.id,
                  toolCall.name,
                  secretsStore.redactObject(toolCall.arguments),
                );
                await store.appendEvent(callEvent);
                options.onEvent?.(callEvent);
                yield callEvent;

                const deniedMsg = `Tool execution denied by security policy: ${policyEval.reason}`;
                const resultEvent = createToolResultEvent(
                  store.runId,
                  toolCall.id,
                  toolCall.name,
                  false,
                  '',
                  deniedMsg,
                  false,
                );
                await store.appendEvent(resultEvent);
                options.onEvent?.(resultEvent);
                yield resultEvent;

                taskMessages.push({
                  role: 'tool',
                  name: toolCall.name,
                  tool_call_id: toolCall.id,
                  content: `Security Policy Error: ${deniedMsg}`,
                });
                continue;
              }

              // 4. Handle ASK decision (Approval Gate)
              let userApproved = true;
              if (policyEval.action === 'ask') {
                if (options.onToolApproval) {
                  userApproved = await options.onToolApproval(
                    toolCall.name,
                    secretsStore.redactObject(toolCall.arguments),
                    policyEval.reason,
                  );
                }

                await auditLogger.log({
                  id: `appr-${toolCall.id}`,
                  timestamp: new Date().toISOString(),
                  eventType: 'approval',
                  action: 'ask',
                  tool: toolCall.name,
                  params: secretsStore.redactObject(toolCall.arguments),
                  userApproval: userApproved ? 'approved' : 'rejected',
                  tainted: isTainted,
                });

                if (!userApproved) {
                  const callEvent = createToolCallEvent(
                    store.runId,
                    toolCall.id,
                    toolCall.name,
                    secretsStore.redactObject(toolCall.arguments),
                  );
                  await store.appendEvent(callEvent);
                  options.onEvent?.(callEvent);
                  yield callEvent;

                  const rejectedMsg = `Tool execution was rejected by user approval gate.`;
                  const resultEvent = createToolResultEvent(
                    store.runId,
                    toolCall.id,
                    toolCall.name,
                    false,
                    '',
                    rejectedMsg,
                    false,
                  );
                  await store.appendEvent(resultEvent);
                  options.onEvent?.(resultEvent);
                  yield resultEvent;

                  taskMessages.push({
                    role: 'tool',
                    name: toolCall.name,
                    tool_call_id: toolCall.id,
                    content: `User Approval Gate: ${rejectedMsg}`,
                  });
                  continue;
                }
              }

              // 5. Emit Tool Call Event (redacting secrets)
              const safeCallArgs = secretsStore.redactObject(toolCall.arguments);
              const callEvent = createToolCallEvent(
                store.runId,
                toolCall.id,
                toolCall.name,
                safeCallArgs,
              );
              await store.appendEvent(callEvent);
              options.onEvent?.(callEvent);
              yield callEvent;

              // 6. Execute Tool in Sandbox (upgrade top-level list_dir "." to recursive so model sees src/ files)
              const execArgs =
                toolCall.name === 'list_dir' &&
                (effectiveArgs['path'] === '.' || !effectiveArgs['path'])
                  ? { ...effectiveArgs, recursive: true }
                  : effectiveArgs;
              const toolResult = await tools.execute(toolCall.name, execArgs, {
                sandbox,
              });

              // Redact secrets and wrap untrusted content if reading external file/data
              let output = toolResult.output;
              if (toolCall.name === 'read_file' && toolResult.success) {
                const filePath = (toolCall.arguments['path'] as string) ?? 'file';
                output = wrapUntrustedContent(output, filePath);
                taintTracker.markTainted(filePath);
              }
              output = secretsStore.redactSecrets(output);

              // 7. Log execution in audit log
              await auditLogger.log({
                id: `call-${toolCall.id}`,
                timestamp: new Date().toISOString(),
                eventType: 'tool_call',
                action: policyEval.action,
                tool: toolCall.name,
                params: safeCallArgs,
                result: secretsStore.redactObject(toolResult),
                tainted: isTainted,
              });

              const resultEvent = createToolResultEvent(
                store.runId,
                toolCall.id,
                toolCall.name,
                toolResult.success,
                output,
                toolResult.error ? secretsStore.redactSecrets(toolResult.error) : undefined,
                toolResult.truncated,
              );
              await store.appendEvent(resultEvent);
              options.onEvent?.(resultEvent);
              yield resultEvent;

              // If write_file or edit_file succeeded, track written files and remind model not to rewrite the same file
              if (
                (toolCall.name === 'write_file' || toolCall.name === 'edit_file') &&
                toolResult.success &&
                typeof effectiveArgs['path'] === 'string'
              ) {
                writtenFilesInStep.add(effectiveArgs['path']);
                output += `\n[Workspace files written in this step: ${Array.from(writtenFilesInStep).join(', ')}. Do NOT call write_file on the same file again. Once all required files for this step are created, reply with a brief summary message and call NO more tools.]`;
              }

              // If run_shell executed a test command and succeeded, guide the local model to conclude the step instead of looping
              if (
                toolCall.name === 'run_shell' &&
                toolResult.success &&
                typeof effectiveArgs['command'] === 'string' &&
                /\b(unittest|pytest|test)\b/i.test(effectiveArgs['command'])
              ) {
                output +=
                  '\n[SYSTEM NOTE: Test command succeeded with exit code 0 (OK). Do NOT rewrite files or re-run tests — reply with a brief final summary message and call NO more tools.]';
              }

              taskMessages.push({
                role: 'tool',
                name: toolCall.name,
                tool_call_id: toolCall.id,
                content: toolResult.success
                  ? output
                  : `Tool Error: ${toolResult.error ? secretsStore.redactSecrets(toolResult.error) : 'Unknown error'}`,
              });
            }

            taintTracker.advanceTurn();
          } else {
            // Model concluded turn without calling tools
            taskMessages.push({
              role: 'assistant',
              content: response.message.content,
            });
            break;
          }
        }

        if (finalStatus === 'failed') {
          break;
        }

        // Run Deterministic Verification
        const verifyCmdStr = verifyCommands.join(' && ') || '(workspace-verification)';
        const verifyStartEvt = createVerificationStartedEvent(store.runId, task.id, verifyCmdStr);
        await store.appendEvent(verifyStartEvt);
        options.onEvent?.(verifyStartEvt);
        yield verifyStartEvt;

        const verifyRes = await runVerification(verifyCommands, sandbox, verificationTimeoutMs);

        if (verifyRes.success) {
          const verifyFinEvt = createVerificationFinishedEvent(
            store.runId,
            task.id,
            verifyCmdStr,
            true,
            verifyRes.output,
          );
          await store.appendEvent(verifyFinEvt);
          options.onEvent?.(verifyFinEvt);
          yield verifyFinEvt;

          // Capture task git diff and commit
          const taskPatch = await captureTaskDiff(sandbox, task.id, task.title);
          const taskDiffPath = await store.writeTaskDiff(task.id, taskPatch);
          task.status = 'completed';
          task.diffPath = taskDiffPath;
          await store.updateTaskStatus(task.id, 'completed', {
            diffPath: taskDiffPath,
            retries: task.retries,
          });

          const taskSuccessEvt = createTaskStatusChangedEvent(store.runId, task.id, 'completed');
          await store.appendEvent(taskSuccessEvt);
          options.onEvent?.(taskSuccessEvt);
          yield taskSuccessEvt;

          taskFinished = true;
        } else {
          // Verification failed! Parse relevant error
          const relevantError = parseRelevantError(verifyRes.output, verifyRes.error);
          const verifyFinEvt = createVerificationFinishedEvent(
            store.runId,
            task.id,
            verifyCmdStr,
            false,
            verifyRes.output,
            relevantError,
          );
          await store.appendEvent(verifyFinEvt);
          options.onEvent?.(verifyFinEvt);
          yield verifyFinEvt;

          const currentRetries: number = (task.retries ?? 0) + 1;
          task.retries = currentRetries;

          if (currentRetries <= maxRetriesPerTask) {
            const retryEvt = createTaskRetryEvent(
              store.runId,
              task.id,
              currentRetries,
              maxRetriesPerTask,
              relevantError,
            );
            await store.appendEvent(retryEvt);
            options.onEvent?.(retryEvt);
            yield retryEvt;

            // Feed ONLY relevant error into the model's small context window
            taskMessages.push({
              role: 'user',
              content: `Verification command failed: "${verifyRes.command}"\nError:\n${relevantError}\nPlease analyze this error, inspect files if needed, and fix the code.`,
            });
          } else {
            // Retries exhausted! Mark blocked
            task.status = 'blocked';
            task.error = relevantError;
            await store.updateTaskStatus(task.id, 'blocked', {
              error: relevantError,
              retries: currentRetries,
            });

            const blockedEvt = createTaskStatusChangedEvent(
              store.runId,
              task.id,
              'blocked',
              `Exhausted ${maxRetriesPerTask} retries. Error: ${relevantError.slice(0, 100)}`,
            );
            await store.appendEvent(blockedEvt);
            options.onEvent?.(blockedEvt);
            yield blockedEvt;

            // Capture partial task diff
            const taskPatch = await captureTaskDiff(sandbox, task.id, task.title);
            await store.writeTaskDiff(task.id, taskPatch);

            finalStatus = 'blocked';
            finishReason = `Task ${task.id} blocked: ${relevantError.slice(0, 100)}`;
            taskFinished = true;
            break;
          }
        }
      }

      executionMessages.push(...taskMessages);

      if (finalStatus === 'blocked' || finalStatus === 'failed') {
        break;
      }
    }
  } catch (err) {
    loopError = (err as Error).message;
    finalStatus = 'failed';
    finishReason = loopError;

    const errEvent = createErrorEvent(store.runId, loopError);
    await store.appendEvent(errEvent);
    options.onEvent?.(errEvent);
    yield errEvent;
  }

  // 4. Collect recursive workspace files and ensure standalone Python scripts have runnable __main__ entry points
  const finalEntries = await sandbox.listDir('.', { recursive: true });
  const allWorkspaceFiles = finalEntries
    .filter((e) => e.type === 'file')
    .map((e) => e.path.replace(/\\/g, '/'))
    .filter(
      (f) =>
        !f.startsWith('.git') &&
        !f.startsWith('.agent') &&
        !f.startsWith('node_modules') &&
        !f.includes('__pycache__') &&
        !f.endsWith('.pyc'),
    );

  if (finalStatus === 'completed') {
    await ensureRunnablePythonScripts(sandbox, allWorkspaceFiles);
  }

  // 4a. Capture Cumulative Run Diff
  const runDiff = await captureRunDiff(sandbox);
  const runDiffPath = await store.writeRunDiff(runDiff);

  // 4b. Browser Verification Phase (for web projects with dev server or HTML apps)
  if (
    options.enableBrowserVerification &&
    finalStatus === 'completed'
  ) {
    const serverConfig = DevServerManager.extractServerConfig(specMarkdown);
    if (serverConfig) {
      const serverManager = new DevServerManager();
      try {
        await serverManager.startServer({
          command: serverConfig.command,
          url: serverConfig.url,
          cwd: workspaceRoot,
          timeoutMs: 15_000,
        });

        const verifier = options.browserVerifier ?? new BrowserVerifier();
        const screenshotsDir = path.join(workspaceRoot, '.agent', 'runs', store.runId, 'screenshots');
        const reportPath = path.join(workspaceRoot, '.agent', 'runs', store.runId, 'browser-verification.md');

        const checklist = BrowserVerifier.deriveDefaultWebChecklist(serverConfig.url);
        await verifier.executeChecklist(checklist, {
          runId: store.runId,
          screenshotsDir,
          reportPath,
          url: serverConfig.url,
        });

        await verifier.close();
      } catch {
        // Log or handle browser verification errors
      } finally {
        await serverManager.stopServer();
      }
    }
  }

  // 5. Verify Walkthrough Commands & Save Final Walkthrough
  const verifiedCmds = await verifyWalkthroughCommands(sandbox, specMarkdown, allWorkspaceFiles);

  const walkthroughContent = generateWalkthrough({
    task: options.task,
    runId: store.runId,
    status: finalStatus,
    tasks: activeTasks,
    specMarkdown,
    planMarkdown,
    createdFiles: allWorkspaceFiles,
    durationMs: Date.now() - startTime,
    verifiedRunCommand: verifiedCmds.verifiedRunCommand,
    verifiedTestCommand: verifiedCmds.verifiedTestCommand,
  });

  const walkthroughPath = await store.writeWalkthrough(walkthroughContent);
  const walkthroughEvt = createWalkthroughCreatedEvent(store.runId, walkthroughPath);
  await store.appendEvent(walkthroughEvt);
  options.onEvent?.(walkthroughEvt);
  yield walkthroughEvt;

  // 6. Finish Event & Final Tasks update
  const durationMs = Date.now() - startTime;
  const finishEvent = createRunFinishedEvent(
    store.runId,
    finalStatus,
    totalSteps,
    durationMs,
    finishReason,
  );
  await store.appendEvent(finishEvent);
  options.onEvent?.(finishEvent);
  yield finishEvent;

  await store.updateTasks({
    status: finalStatus,
    stepsCount: totalSteps,
    completedAt: new Date().toISOString(),
    diffPath: runDiffPath,
    walkthroughPath,
    ...(finishReason ? { reason: finishReason } : {}),
    ...(loopError ? { error: loopError } : {}),
  });

  return {
    runId: store.runId,
    status: finalStatus,
    totalSteps,
    durationMs,
    ...(finishReason ? { reason: finishReason } : {}),
    ...(loopError ? { error: loopError } : {}),
    messages: executionMessages,
    artifacts: store,
    tasks: activeTasks,
    diffPath: runDiffPath,
    walkthroughPath,
  };
}
