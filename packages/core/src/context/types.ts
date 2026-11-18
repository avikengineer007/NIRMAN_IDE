import type { ChatMessage } from '@nirman/model';
import type { RetrievedSnippet } from '../index/types.js';

export interface ContextManagerConfig {
  /** Hard token budget for the assembled model prompt (default: 16_384) */
  tokenBudget?: number;
  /** Tokens reserved for model response completion (default: 1024) */
  reserveCompletionTokens?: number;
  /** Maximum number of recent conversational messages to retain verbatim (default: 6) */
  maxRecentTurns?: number;
  /** Base system prompt framing instructions */
  systemPrompt?: string;
  /** Project technical specification (SPEC.md) */
  specMarkdown?: string;
}

export interface ContextAssemblyInput {
  /** Active task being implemented */
  task: {
    id: string;
    title: string;
    description?: string | undefined;
  };
  /** Retrieved relevant code snippets from repo index */
  retrievedSnippets?: readonly RetrievedSnippet[] | undefined;
  /** Full message history for this task / run */
  conversationTurns?: readonly ChatMessage[] | undefined;
  /** Existing rolling summary of earlier conversation */
  rollingSummary?: string | undefined;
  /** Custom user message or instructions for this turn */
  userInstruction?: string | undefined;
}

export interface ContextAssemblyIncludedStats {
  systemPromptTokens: number;
  specTokens: number;
  taskTokens: number;
  snippetsTokens: number;
  rollingSummaryTokens: number;
  recentTurnsTokens: number;
  snippetsCount: number;
  recentTurnsCount: number;
}

export interface ContextAssemblyStats {
  tokenBudget: number;
  totalTokens: number;
  included: ContextAssemblyIncludedStats;
  dropped: string[];
}

export interface ContextAssemblyResult {
  messages: ChatMessage[];
  stats: ContextAssemblyStats;
  updatedRollingSummary?: string | undefined;
}
