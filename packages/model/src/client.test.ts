import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockModelClient } from './mock.js';
import { OpenAICompatibleClient } from './client.js';
import type { ToolDefinition } from './types.js';

describe('Model Clients', () => {
  const tools: ToolDefinition[] = [
    {
      name: 'read_file',
      description: 'Read file contents',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
        },
        required: ['path'],
      },
    },
  ];

  describe('MockModelClient', () => {
    it('replays non-streaming plain text response', async () => {
      const mock = new MockModelClient([
        {
          response: 'Hello from mock!',
        },
      ]);

      const result = await mock.chat([{ role: 'user', content: 'Hi' }]);
      expect(result.message.content).toBe('Hello from mock!');
      expect(result.finishReason).toBe('stop');
      expect(result.parsedToolCalls).toHaveLength(0);
      expect(mock.recordedCalls).toHaveLength(1);
    });

    it('replays streaming chunks', async () => {
      const mock = new MockModelClient([
        {
          response: {
            chunks: [
              { id: '1', delta: { content: 'chunk 1 ' }, finish_reason: null },
              { id: '2', delta: { content: 'chunk 2' }, finish_reason: 'stop' },
            ],
          },
        },
      ]);

      const chunks = [];
      for await (const chunk of mock.streamChat([{ role: 'user', content: 'Stream this' }])) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(2);
      expect(chunks[0]?.delta.content).toBe('chunk 1 ');
      expect(chunks[1]?.delta.content).toBe('chunk 2');
    });

    it('replays native tool calls', async () => {
      const mock = new MockModelClient(
        [
          {
            response: {
              content: null,
              toolCalls: [
                {
                  id: 'call_123',
                  type: 'function',
                  function: {
                    name: 'read_file',
                    arguments: '{"path": "package.json"}',
                  },
                },
              ],
            },
          },
        ],
        { toolMode: 'native' },
      );

      const result = await mock.chatWithTools(
        [{ role: 'user', content: 'Read package.json' }],
        tools,
      );

      expect(result.parsedToolCalls).toHaveLength(1);
      expect(result.parsedToolCalls[0]?.id).toBe('call_123');
      expect(result.parsedToolCalls[0]?.name).toBe('read_file');
      expect(result.parsedToolCalls[0]?.arguments).toEqual({ path: 'package.json' });
    });

    it('handles fallback mode with immediate valid JSON', async () => {
      const mock = new MockModelClient(
        [
          {
            response: '```json\n{"tool": "read_file", "arguments": {"path": "src/types.ts"}}\n```',
          },
        ],
        { toolMode: 'fallback' },
      );

      const result = await mock.chatWithTools(
        [{ role: 'user', content: 'Read src/types.ts' }],
        tools,
      );

      expect(result.parsedToolCalls).toHaveLength(1);
      expect(result.parsedToolCalls[0]?.name).toBe('read_file');
      expect(result.parsedToolCalls[0]?.arguments['path']).toBe('src/types.ts');
      // Only 1 call needed
      expect(mock.recordedCalls).toHaveLength(1);
    });

    it('handles fallback mode: invalid attempt 1 is repaired and succeeds on attempt 2', async () => {
      const mock = new MockModelClient(
        [
          // Attempt 1: missing required 'path'
          {
            response: '```json\n{"tool": "read_file", "arguments": {}}\n```',
          },
          // Attempt 2 (repair): valid tool call
          {
            response: '```json\n{"tool": "read_file", "arguments": {"path": "repaired.txt"}}\n```',
          },
        ],
        { toolMode: 'fallback' },
      );

      const result = await mock.chatWithTools(
        [{ role: 'user', content: 'Read repaired file' }],
        tools,
      );

      expect(result.parsedToolCalls).toHaveLength(1);
      expect(result.parsedToolCalls[0]?.arguments['path']).toBe('repaired.txt');
      // Should have performed 2 calls: initial and repair retry
      expect(mock.recordedCalls).toHaveLength(2);
      // The second call must contain the repair error prompt
      const secondCallMsgs = mock.recordedCalls[1]?.messages ?? [];
      const repairMsg = secondCallMsgs[secondCallMsgs.length - 1];
      expect(repairMsg?.role).toBe('user');
      expect(repairMsg?.content).toContain('[TOOL CALL VALIDATION ERROR]');
      expect(repairMsg?.content).toContain('Missing required argument "path"');
    });

    it('throws error when repair attempt fails twice', async () => {
      const mock = new MockModelClient(
        [
          { response: '```json\n{"tool": "invalid1"}\n```' },
          { response: '```json\n{"tool": "invalid2"}\n```' },
        ],
        { toolMode: 'fallback' },
      );

      await expect(
        mock.chatWithTools([{ role: 'user', content: 'Call invalid tool' }], tools),
      ).rejects.toThrow('Tool call repair retry failed validation');
    });
  });

  describe('OpenAICompatibleClient', () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
      vi.restoreAllMocks();
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('sends native tool call request and parses OpenAI response', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: null,
                  tool_calls: [
                    {
                      id: 'call_abc',
                      type: 'function',
                      function: {
                        name: 'read_file',
                        arguments: '{"path": "README.md"}',
                      },
                    },
                  ],
                },
                finish_reason: 'tool_calls',
              },
            ],
            usage: {
              prompt_tokens: 25,
              completion_tokens: 15,
              total_tokens: 40,
            },
          }),
      });

      const client = new OpenAICompatibleClient({
        baseUrl: 'http://localhost:11434/v1',
        model: 'qwen2.5-coder',
        toolMode: 'native',
      });

      const result = await client.chatWithTools([{ role: 'user', content: 'Read README' }], tools);

      expect(result.parsedToolCalls).toHaveLength(1);
      expect(result.parsedToolCalls[0]?.name).toBe('read_file');
      expect(result.parsedToolCalls[0]?.arguments).toEqual({ path: 'README.md' });
      expect(result.usage?.totalTokens).toBe(40);
    });

    it('retries with repair message on fallback mode when initial call fails validation', async () => {
      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                choices: [
                  {
                    message: {
                      role: 'assistant',
                      content: '```json\n{"tool": "read_file", "arguments": {}}\n```',
                    },
                  },
                ],
              }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              choices: [
                {
                  message: {
                    role: 'assistant',
                    content:
                      '```json\n{"tool": "read_file", "arguments": {"path": "fixed.ts"}}\n```',
                  },
                },
              ],
            }),
        });
      });

      const client = new OpenAICompatibleClient({
        baseUrl: 'http://localhost:11434/v1',
        model: 'llama3',
        toolMode: 'fallback',
      });

      const result = await client.chatWithTools([{ role: 'user', content: 'Read code' }], tools);
      expect(callCount).toBe(2);
      expect(result.parsedToolCalls).toHaveLength(1);
      expect(result.parsedToolCalls[0]?.arguments['path']).toBe('fixed.ts');
    });

    it('throws on HTTP error response', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: () => Promise.resolve('Model out of memory'),
      });

      const client = new OpenAICompatibleClient({
        baseUrl: 'http://localhost:11434/v1',
        model: 'test-model',
      });

      await expect(client.chat([{ role: 'user', content: 'test' }])).rejects.toThrow(
        'Model server error HTTP 500',
      );
    });
  });
});
