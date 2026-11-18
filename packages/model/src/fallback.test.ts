import { describe, expect, it } from 'vitest';
import { buildRepairPrompt, formatToolsFallbackPrompt, parseFallbackToolCall } from './fallback.js';
import type { ToolDefinition } from './types.js';

describe('fallback tool calling', () => {
  const tools: ToolDefinition[] = [
    {
      name: 'read_file',
      description: 'Read the contents of a file',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path of file' },
        },
        required: ['path'],
      },
    },
    {
      name: 'run_command',
      description: 'Run shell command',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string' },
        },
        required: ['command'],
      },
    },
  ];

  it('formats tool definitions into system prompt instructions', () => {
    const prompt = formatToolsFallbackPrompt(tools);
    expect(prompt).toContain('Available Tools');
    expect(prompt).toContain('read_file');
    expect(prompt).toContain('run_command');
    expect(prompt).toContain('"path"');
    expect(prompt).toContain('```json');
  });

  it('parses valid tool call in markdown JSON block', () => {
    const response = `Here is the requested file:
\`\`\`json
{
  "tool": "read_file",
  "arguments": {
    "path": "src/index.ts"
  }
}
\`\`\``;

    const result = parseFallbackToolCall(response, tools);
    expect(result.type).toBe('tool_call');
    if (result.type === 'tool_call') {
      expect(result.call.name).toBe('read_file');
      expect(result.call.arguments['path']).toBe('src/index.ts');
    }
  });

  it('parses raw JSON string without markdown fence', () => {
    const response = '{"tool": "run_command", "arguments": {"command": "pnpm test"}}';
    const result = parseFallbackToolCall(response, tools);
    expect(result.type).toBe('tool_call');
    if (result.type === 'tool_call') {
      expect(result.call.name).toBe('run_command');
      expect(result.call.arguments['command']).toBe('pnpm test');
    }
  });

  it('returns plain text when no tool call is attempted', () => {
    const response = 'I have analyzed the project structure and everything looks ready.';
    const result = parseFallbackToolCall(response, tools);
    expect(result.type).toBe('text');
    if (result.type === 'text') {
      expect(result.text).toBe(response);
    }
  });

  it('reports error on malformed JSON', () => {
    const response = '```json\n{ "tool": "read_file", "arguments": { "path": \n```';
    const result = parseFallbackToolCall(response, tools);
    expect(result.type).toBe('error');
    if (result.type === 'error') {
      expect(result.error).toContain('Malformed JSON');
    }
  });

  it('reports error on unknown tool name', () => {
    const response = '```json\n{ "tool": "delete_database", "arguments": {} }\n```';
    const result = parseFallbackToolCall(response, tools);
    expect(result.type).toBe('error');
    if (result.type === 'error') {
      expect(result.error).toContain('Unknown tool "delete_database"');
    }
  });

  it('reports error on schema validation failure', () => {
    const response = '```json\n{ "tool": "read_file", "arguments": { "wrongKey": 123 } }\n```';
    const result = parseFallbackToolCall(response, tools);
    expect(result.type).toBe('error');
    if (result.type === 'error') {
      expect(result.error).toContain('Missing required argument "path"');
    }
  });

  it('builds clear repair prompt containing error and raw snippet', () => {
    const repair = buildRepairPrompt('Missing required argument "path"', '{"tool": "read_file"}');
    expect(repair).toContain('[TOOL CALL VALIDATION ERROR]');
    expect(repair).toContain('Missing required argument "path"');
    expect(repair).toContain('{"tool": "read_file"}');
    expect(repair).toContain('```json ... ```');
  });
});
