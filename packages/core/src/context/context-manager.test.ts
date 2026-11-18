import { describe, it, expect } from 'vitest';
import { ContextManager } from './context-manager.js';
import type { RetrievedSnippet } from '../index/types.js';
import type { ChatMessage } from '@nirman/model';

describe('ContextManager', () => {
  it('assembles system prompt, SPEC.md, task, snippets, and recent turns', () => {
    const cm = new ContextManager({
      tokenBudget: 4000,
      specMarkdown: '# Project Specification\nBuild commands: npm test',
    });

    const snippets: RetrievedSnippet[] = [
      {
        filePath: 'src/auth/jwt.ts',
        startLine: 1,
        endLine: 15,
        content: 'export function verifyJwt() { return true; }',
        tokenCount: 20,
        score: 0.9,
        matchedSymbols: ['verifyJwt'],
        reason: 'symbol match',
      },
    ];

    const turns: ChatMessage[] = [
      { role: 'user', content: 'Please implement user auth.' },
      { role: 'assistant', content: 'Writing auth files now.' },
    ];

    const result = cm.assemble({
      task: {
        id: 'task-1',
        title: 'Implement JWT authentication',
        description: 'Create jwt service and token verifier',
      },
      retrievedSnippets: snippets,
      conversationTurns: turns,
    });

    expect(result.messages.length).toBeGreaterThanOrEqual(3);
    const systemMsg = result.messages[0]!;
    expect(systemMsg.role).toBe('system');
    expect(systemMsg.content).toContain('Project Specification');
    expect(systemMsg.content).toContain('Implement JWT authentication');
    expect(systemMsg.content).toContain('src/auth/jwt.ts');
    expect(systemMsg.content).toContain('verifyJwt');

    expect(result.stats.totalTokens).toBeLessThanOrEqual(4000);
    expect(result.stats.included.snippetsCount).toBe(1);
    expect(result.stats.included.recentTurnsCount).toBe(2);
    expect(result.stats.dropped.length).toBe(0);
  });

  it('enforces a hard token budget and logs what was dropped', () => {
    // Tight token budget of 600 tokens
    const cm = new ContextManager({
      tokenBudget: 600,
      reserveCompletionTokens: 100,
      specMarkdown: '# Full Spec\n' + 'Some long specification details. '.repeat(100),
    });

    const snippets: RetrievedSnippet[] = [
      {
        filePath: 'src/file1.ts',
        startLine: 1,
        endLine: 50,
        content: 'const x = 1;\n'.repeat(50),
        tokenCount: 250,
        score: 0.9,
        matchedSymbols: [],
        reason: 'test',
      },
      {
        filePath: 'src/file2.ts',
        startLine: 1,
        endLine: 50,
        content: 'const y = 2;\n'.repeat(50),
        tokenCount: 250,
        score: 0.8,
        matchedSymbols: [],
        reason: 'test',
      },
    ];

    const result = cm.assemble({
      task: {
        id: 'task-1',
        title: 'Minimal task',
      },
      retrievedSnippets: snippets,
    });

    // Hard token budget must never be exceeded
    expect(result.stats.totalTokens).toBeLessThanOrEqual(600);
    expect(result.stats.dropped.length).toBeGreaterThan(0);
    expect(result.stats.dropped.some((d) => d.includes('SPEC.md') || d.includes('snippet'))).toBe(true);
  });

  it('summarizes older conversation turns into a rolling summary when turns exceed window', () => {
    const cm = new ContextManager({
      tokenBudget: 4000,
      maxRecentTurns: 4,
    });

    const turns: ChatMessage[] = [
      { role: 'user', content: 'Step 1: create package.json' },
      { role: 'assistant', content: 'Created package.json' },
      { role: 'user', content: 'Step 2: create src/index.ts' },
      { role: 'assistant', content: 'Created src/index.ts' },
      { role: 'user', content: 'Step 3: add server listening' },
      { role: 'assistant', content: 'Added server listen' },
      { role: 'user', content: 'Step 4: add routes' },
      { role: 'assistant', content: 'Added routes' },
    ];

    const result = cm.assemble({
      task: { id: 'task-5', title: 'Add tests' },
      conversationTurns: turns,
    });

    expect(result.stats.included.recentTurnsCount).toBe(4);
    expect(result.stats.dropped.some((d) => d.includes('rolling summary'))).toBe(true);
    expect(result.updatedRollingSummary).toContain('Summary of prior turns');
    expect(result.messages[0]?.content).toContain('Context Handoff');
  });
});
