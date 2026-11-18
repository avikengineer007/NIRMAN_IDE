import {
  countTokens,
  estimateMessagesTokens,
  type ChatMessage,
} from '@nirman/model';
import type {
  ContextAssemblyInput,
  ContextAssemblyResult,
  ContextAssemblyStats,
  ContextManagerConfig,
} from './types.js';

export const DEFAULT_BASE_SYSTEM_PROMPT = `You are NIRMAN, an autonomous agentic software engineering assistant.
You plan, build, and verify software inside a sandboxed environment.
Follow these rules:
1. Use write_file or edit_file to create or modify code.
2. Read files with read_file when you need to inspect existing code.
3. Keep code clean, modular, and verified.
4. Conclude without calling more tools once files for the current task are written so verification can run.`;

export class ContextManager {
  private readonly tokenBudget: number;
  private readonly reserveCompletionTokens: number;
  private readonly maxRecentTurns: number;
  private readonly baseSystemPrompt: string;
  private specMarkdown: string;

  constructor(config?: ContextManagerConfig) {
    this.tokenBudget = config?.tokenBudget ?? 16_384;
    this.reserveCompletionTokens = config?.reserveCompletionTokens ?? 1024;
    this.maxRecentTurns = config?.maxRecentTurns ?? 6;
    this.baseSystemPrompt = config?.systemPrompt ?? DEFAULT_BASE_SYSTEM_PROMPT;
    this.specMarkdown = config?.specMarkdown ?? '';
  }

  /**
   * Updates the project specification (SPEC.md) markdown.
   */
  setSpec(specMarkdown: string): void {
    this.specMarkdown = specMarkdown;
  }

  /**
   * Generates or updates a concise rolling summary from older conversation messages.
   */
  createRollingSummary(olderMessages: readonly ChatMessage[], existingSummary = ''): string {
    if (olderMessages.length === 0) {
      return existingSummary;
    }

    const bulletPoints: string[] = [];
    if (existingSummary.trim()) {
      bulletPoints.push(existingSummary.trim());
    }

    for (const msg of olderMessages) {
      if (msg.role === 'assistant') {
        if (msg.tool_calls && msg.tool_calls.length > 0) {
          const toolNames = msg.tool_calls.map((tc) => tc.function.name).join(', ');
          bulletPoints.push(`Assistant invoked tools: ${toolNames}`);
        } else if (msg.content) {
          const snippet = msg.content.trim().split('\n')[0]?.slice(0, 80) ?? '';
          bulletPoints.push(`Assistant: "${snippet}"`);
        }
      } else if (msg.role === 'tool') {
        const snippet = (msg.content ?? '').trim().split('\n')[0]?.slice(0, 80) ?? '';
        bulletPoints.push(`Tool ${msg.name ?? 'result'}: ${snippet}`);
      } else if (msg.role === 'user') {
        const snippet = msg.content?.trim().split('\n')[0]?.slice(0, 80) ?? '';
        bulletPoints.push(`User request: "${snippet}"`);
      }
    }

    // Keep summary bounded to the last 8 key points
    const latestPoints = bulletPoints.slice(-8);
    return `Summary of prior turns:\n${latestPoints.map((p) => `- ${p}`).join('\n')}`;
  }

  /**
   * Assembles each model call:
   * System prompt, SPEC.md, current task, retrieved snippets, recent turns, and rolling summary.
   * Enforces a hard token budget and logs what was included and what was dropped.
   */
  assemble(input: ContextAssemblyInput): ContextAssemblyResult {
    const dropped: string[] = [];
    const effectiveBudget = Math.max(500, this.tokenBudget - this.reserveCompletionTokens);

    // 1. Core Framing: Base System Prompt + Task Instructions
    const taskHeader = `Current Task to Implement:
Task ID: ${input.task.id}
Title: ${input.task.title}
${input.task.description ? `Description: ${input.task.description}` : ''}`;

    let basePromptTokens = countTokens(this.baseSystemPrompt);
    let taskTokens = countTokens(taskHeader);

    // 2. SPEC.md Allocation
    let specText = '';
    let specTokens = 0;
    if (this.specMarkdown.trim()) {
      const fullSpecText = `Project Specification (SPEC.md):\n${this.specMarkdown.trim()}`;
      const fullSpecTokens = countTokens(fullSpecText);

      // Check if full spec fits comfortably (leave room for task + snippets + turns)
      const maxSpecBudget = Math.floor(effectiveBudget * 0.35);
      if (fullSpecTokens <= maxSpecBudget) {
        specText = fullSpecText;
        specTokens = fullSpecTokens;
      } else {
        // Truncate spec lines to fit within maxSpecBudget
        const lines = fullSpecText.split('\n');
        const truncatedLines: string[] = [];
        let acc = 0;
        for (const line of lines) {
          const lTokens = countTokens(line);
          if (acc + lTokens > maxSpecBudget) break;
          truncatedLines.push(line);
          acc += lTokens;
        }
        specText = `${truncatedLines.join('\n')}\n... [SPEC.md truncated to fit context budget]`;
        specTokens = countTokens(specText);
        dropped.push(
          `Truncated SPEC.md from ${fullSpecTokens} to ${specTokens} tokens to respect budget limit`,
        );
      }
    }

    // 3. Conversation Turns & Rolling Summary
    const allTurns = input.conversationTurns ?? [];
    let recentTurns: ChatMessage[];
    let updatedRollingSummary = input.rollingSummary ?? '';
    let rollingSummaryText = '';
    let rollingSummaryTokens = 0;

    if (allTurns.length > this.maxRecentTurns) {
      const splitIdx = allTurns.length - this.maxRecentTurns;
      const older = allTurns.slice(0, splitIdx);
      recentTurns = allTurns.slice(splitIdx);

      updatedRollingSummary = this.createRollingSummary(older, input.rollingSummary);
      rollingSummaryText = `Context Handoff / ${updatedRollingSummary}`;
      rollingSummaryTokens = countTokens(rollingSummaryText);
      dropped.push(
        `Compressed ${older.length} older conversation turn(s) into rolling summary (${rollingSummaryTokens} tokens)`,
      );
    } else {
      recentTurns = [...allTurns];
      if (input.rollingSummary?.trim()) {
        rollingSummaryText = input.rollingSummary.trim();
        rollingSummaryTokens = countTokens(rollingSummaryText);
      }
    }

    // 4. Retrieved Snippets Allocation
    const candidateSnippets = input.retrievedSnippets ?? [];
    const includedSnippets: string[] = [];
    let snippetsTokens = 0;
    let droppedSnippetsCount = 0;
    let droppedSnippetsTokens = 0;

    // Remaining tokens available for snippets + recent turns
    const systemAndSpecTokens = basePromptTokens + taskTokens + specTokens + rollingSummaryTokens;
    const remainingBudgetForDynamic = effectiveBudget - systemAndSpecTokens;

    // Allocate roughly 50% of dynamic budget to snippets, 50% to turns
    const maxSnippetBudget = Math.max(200, Math.floor(remainingBudgetForDynamic * 0.6));

    for (const snip of candidateSnippets) {
      const snippetBlock = `### File: ${snip.filePath} (lines ${snip.startLine}-${snip.endLine}) [${snip.reason}]
\`\`\`
${snip.content}
\`\`\``;
      const snipTokens = countTokens(snippetBlock);

      if (snippetsTokens + snipTokens <= maxSnippetBudget) {
        includedSnippets.push(snippetBlock);
        snippetsTokens += snipTokens;
      } else {
        droppedSnippetsCount++;
        droppedSnippetsTokens += snipTokens;
      }
    }

    if (droppedSnippetsCount > 0) {
      dropped.push(
        `Dropped ${droppedSnippetsCount} retrieved snippet(s) (${droppedSnippetsTokens} tokens) due to budget limit`,
      );
    }

    // 5. Recent Turns Budgeting
    const includedTurns: ChatMessage[] = [];
    let recentTurnsTokens = 0;
    let droppedTurnsCount = 0;

    // Pack recent turns backwards (newest first) to ensure the latest messages fit
    const remainingForTurns = effectiveBudget - (systemAndSpecTokens + snippetsTokens);

    for (let i = recentTurns.length - 1; i >= 0; i--) {
      const turn = recentTurns[i]!;
      const turnTokens = countTokens(turn.content ?? '') + (turn.tool_calls ? 20 : 5);

      if (recentTurnsTokens + turnTokens <= remainingForTurns) {
        includedTurns.unshift(turn);
        recentTurnsTokens += turnTokens;
      } else {
        droppedTurnsCount++;
      }
    }

    if (droppedTurnsCount > 0) {
      dropped.push(
        `Dropped ${droppedTurnsCount} oldest turn(s) from recent window to fit hard budget`,
      );
    }

    // 6. Build Assembled System Prompt
    const systemPromptSections: string[] = [this.baseSystemPrompt];

    if (specText) {
      systemPromptSections.push(specText);
    }

    if (rollingSummaryText) {
      systemPromptSections.push(rollingSummaryText);
    }

    if (includedSnippets.length > 0) {
      systemPromptSections.push(
        `Relevant Repository Snippets (${includedSnippets.length} included):\n${includedSnippets.join('\n\n')}`,
      );
    }

    systemPromptSections.push(taskHeader);

    const fullSystemPromptContent = systemPromptSections.join('\n\n');

    // 7. Assemble Chat Messages
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: fullSystemPromptContent,
      },
      ...includedTurns,
    ];

    // If a specific user instruction was supplied and there are no recent user turns, add it
    if (input.userInstruction) {
      messages.push({
        role: 'user',
        content: input.userInstruction,
      });
    } else if (messages.length === 1) {
      messages.push({
        role: 'user',
        content: `Please implement task "${input.task.title}". Create or update the required files.`,
      });
    }

    // 8. Total Token Count and Verification
    let totalTokens = estimateMessagesTokens(messages);

    // If by any chance totalTokens exceeds tokenBudget, shed snippets or turns until strictly <= tokenBudget
    if (totalTokens > this.tokenBudget && includedSnippets.length > 0) {
      while (totalTokens > this.tokenBudget && includedSnippets.length > 0) {
        includedSnippets.pop();
        dropped.push(`Evicted snippet due to hard token budget overflow`);
        const newSystemContent = [
          this.baseSystemPrompt,
          ...(specText ? [specText] : []),
          ...(rollingSummaryText ? [rollingSummaryText] : []),
          ...(includedSnippets.length > 0
            ? [`Relevant Repository Snippets (${includedSnippets.length} included):\n${includedSnippets.join('\n\n')}`]
            : []),
          taskHeader,
        ].join('\n\n');
        messages[0] = { role: 'system', content: newSystemContent };
        totalTokens = estimateMessagesTokens(messages);
      }
    }

    basePromptTokens = countTokens(this.baseSystemPrompt);
    taskTokens = countTokens(taskHeader);

    const stats: ContextAssemblyStats = {
      tokenBudget: this.tokenBudget,
      totalTokens,
      included: {
        systemPromptTokens: basePromptTokens,
        specTokens,
        taskTokens,
        snippetsTokens,
        rollingSummaryTokens,
        recentTurnsTokens,
        snippetsCount: includedSnippets.length,
        recentTurnsCount: includedTurns.length,
      },
      dropped,
    };

    return {
      messages,
      stats,
      ...(updatedRollingSummary ? { updatedRollingSummary } : {}),
    };
  }
}
