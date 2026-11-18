import type { ChatMessage, ContextWindowAnalysis } from './types.js';

/** Default context window size for typical quantized 7B-8B local models */
export const DEFAULT_CONTEXT_WINDOW_LIMIT = 32_768;

/**
 * Approximate token count for text.
 * Uses a heuristic of ~3.8 characters per token, with adjustments for whitespace and symbols.
 */
export function countTokens(text: string): number {
  if (!text || text.length === 0) {
    return 0;
  }

  // Count words and punctuation clusters for a refined estimate
  const words = text.trim().split(/\s+/).filter(Boolean);
  const charBased = Math.ceil(text.length / 3.8);
  const wordBased = Math.ceil(words.length * 1.3);

  // Take the weighted average between char-based and word-based estimation
  const estimate = Math.round((charBased * 2 + wordBased) / 3);
  return Math.max(1, estimate);
}

/**
 * Estimate tokens for a single chat message including formatting overhead.
 */
export function estimateMessageTokens(message: ChatMessage): number {
  let count = 4; // Base per-message framing overhead (role, markers)

  if (message.content) {
    count += countTokens(message.content);
  }

  if (message.name) {
    count += countTokens(message.name);
  }

  if (message.tool_calls && message.tool_calls.length > 0) {
    for (const toolCall of message.tool_calls) {
      count += 4; // Tool call overhead
      count += countTokens(toolCall.function.name);
      count += countTokens(toolCall.function.arguments);
    }
  }

  return count;
}

/**
 * Estimate total tokens across a list of chat messages.
 */
export function estimateMessagesTokens(messages: readonly ChatMessage[]): number {
  if (messages.length === 0) {
    return 0;
  }

  let total = 3; // Initial priming overhead
  for (const msg of messages) {
    total += estimateMessageTokens(msg);
  }
  return total;
}

/**
 * Analyzes how much of the context window is used and flags near-limit warnings.
 */
export function analyzeContextWindow(
  messages: readonly ChatMessage[],
  contextLimit: number = DEFAULT_CONTEXT_WINDOW_LIMIT,
): ContextWindowAnalysis {
  const safeLimit = Math.max(1, contextLimit);
  const usedTokens = estimateMessagesTokens(messages);
  const remainingTokens = Math.max(0, safeLimit - usedTokens);
  const percentUsed = Math.min(100, Math.round((usedTokens / safeLimit) * 1000) / 10);

  return {
    usedTokens,
    contextLimit: safeLimit,
    remainingTokens,
    percentUsed,
    isNearLimit: percentUsed >= 80,
    isExceeded: usedTokens > safeLimit,
  };
}
