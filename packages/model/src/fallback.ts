import { validateSchema } from './schema.js';
import type { ParsedToolCall, ToolDefinition } from './types.js';

export type FallbackParseResult =
  | { type: 'tool_call'; call: ParsedToolCall }
  | { type: 'text'; text: string }
  | { type: 'error'; error: string; rawSnippet?: string };

/**
 * Builds the system instructions for tool calling in fallback mode.
 */
export function formatToolsFallbackPrompt(tools: readonly ToolDefinition[]): string {
  const toolDescriptions = tools.map((tool) => {
    return `### Tool: ${tool.name}
Description: ${tool.description}
Parameters JSON Schema:
${JSON.stringify(tool.parameters, null, 2)}`;
  });

  return `## Available Tools
You have access to the following tools:

${toolDescriptions.join('\n\n')}

## Tool Calling Instructions
When you need to call a tool, you MUST respond with a single JSON object in the following format:
\`\`\`json
{
  "tool": "<tool_name>",
  "arguments": {
    <tool_arguments>
  }
}
\`\`\`
Do not include any other text before or after the JSON code block when calling a tool.
If no tool call is needed, reply normally with plain text.`;
}

/**
 * Extracts a candidate JSON substring from model output.
 */
function extractJsonCandidate(text: string): string | null {
  const trimmed = text.trim();

  // Try markdown fenced blocks first
  const fencedMatch = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(trimmed);
  if (fencedMatch && fencedMatch[1]) {
    const candidate = fencedMatch[1].trim();
    if (candidate.endsWith('}')) {
      return candidate;
    }
  }

  // Look for outer braces containing "tool" or "name" (handles nested ``` inside JSON string values)
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const candidate = trimmed.slice(firstBrace, lastBrace + 1);
    if (candidate.includes('"tool"') || candidate.includes('"name"')) {
      return candidate;
    }
  }

  return null;
}

/**
 * Parses and validates tool call output in fallback mode.
 */
export function parseFallbackToolCall(
  text: string,
  tools: readonly ToolDefinition[],
): FallbackParseResult {
  const jsonCandidate = extractJsonCandidate(text);
  if (!jsonCandidate) {
    return { type: 'text', text };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonCandidate);
  } catch (err) {
    // Try sanitizing invalid escape sequences commonly emitted by LLMs (e.g. \s, \d, \w, \')
    try {
      const sanitized = jsonCandidate.replace(/\\([^"\\/bfnrtu]|u(?![\da-fA-F]{4}))/g, '\\\\$1');
      parsed = JSON.parse(sanitized);
    } catch {
      return {
        type: 'error',
        error: `Malformed JSON tool call: ${err instanceof Error ? err.message : String(err)}`,
        rawSnippet: jsonCandidate,
      };
    }
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {
      type: 'error',
      error: 'Tool call output must be a JSON object with "tool" and "arguments" fields',
      rawSnippet: jsonCandidate,
    };
  }

  const record = parsed as Record<string, unknown>;
  const toolName = typeof record['tool'] === 'string' ? record['tool'] : record['name'];

  if (typeof toolName !== 'string' || !toolName) {
    return {
      type: 'error',
      error: 'Missing or invalid "tool" name in tool call JSON',
      rawSnippet: jsonCandidate,
    };
  }

  const matchingTool = tools.find((t) => t.name === toolName);
  if (!matchingTool) {
    const available = tools.map((t) => t.name).join(', ');
    return {
      type: 'error',
      error: `Unknown tool "${toolName}". Available tools: ${available}`,
      rawSnippet: jsonCandidate,
    };
  }

  const rawArgs =
    record['arguments'] !== undefined ? record['arguments'] : (record['parameters'] ?? {});

  if (typeof rawArgs !== 'object' || rawArgs === null || Array.isArray(rawArgs)) {
    return {
      type: 'error',
      error: `Tool "${toolName}" arguments must be a JSON object`,
      rawSnippet: jsonCandidate,
    };
  }

  const validation = validateSchema(rawArgs, matchingTool.parameters);
  if (!validation.valid) {
    return {
      type: 'error',
      error: `Tool "${toolName}" argument schema validation failed: ${validation.errors.join('; ')}`,
      rawSnippet: jsonCandidate,
    };
  }

  const callId = `call_fallback_${Math.random().toString(36).slice(2, 10)}`;

  return {
    type: 'tool_call',
    call: {
      id: callId,
      name: toolName,
      arguments: rawArgs as Record<string, unknown>,
      rawArguments: JSON.stringify(rawArgs),
    },
  };
}

/**
 * Builds the repair prompt to retry invalid tool calls.
 */
export function buildRepairPrompt(error: string, rawSnippet?: string): string {
  let prompt = `[TOOL CALL VALIDATION ERROR]
Your previous response attempted to call a tool, but it failed validation:
${error}`;

  if (rawSnippet) {
    prompt += `\n\nYour previous invalid output was:\n${rawSnippet}`;
  }

  prompt += `\n\nPlease correct the error and respond strictly with the valid JSON object inside \`\`\`json ... \`\`\`.`;
  return prompt;
}
