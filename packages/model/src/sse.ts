import type { ChatCompletionChunk, ChatRole } from './types.js';

interface RawOpenAIChoice {
  index?: number;
  delta?: {
    role?: ChatRole;
    content?: string | null;
    tool_calls?: Array<{
      index: number;
      id?: string;
      type?: 'function';
      function?: {
        name?: string;
        arguments?: string;
      };
    }>;
  };
  finish_reason?: string | null;
}

interface RawOpenAIStreamChunk {
  id?: string;
  choices?: RawOpenAIChoice[];
}

/**
 * Parses an SSE (Server-Sent Events) ReadableStream into typed ChatCompletionChunk objects.
 */
export async function* parseSseStream(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<ChatCompletionChunk, void, unknown> {
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      // Keep whatever is after the last newline in the buffer
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) {
          continue; // comment or empty heartbeat
        }

        if (trimmed.startsWith('data:')) {
          const dataPayload = trimmed.slice(5).trim();
          if (dataPayload === '[DONE]') {
            return;
          }

          try {
            const parsed = JSON.parse(dataPayload) as RawOpenAIStreamChunk;
            const choice = parsed.choices?.[0];
            if (!choice || !choice.delta) {
              continue;
            }

            const delta: ChatCompletionChunk['delta'] = {
              ...(choice.delta.role ? { role: choice.delta.role } : {}),
              content: choice.delta.content ?? null,
              ...(choice.delta.tool_calls ? { tool_calls: choice.delta.tool_calls } : {}),
            };

            const chunk: ChatCompletionChunk = {
              id: parsed.id ?? `chunk_${Date.now()}`,
              delta,
              ...(choice.finish_reason !== undefined
                ? { finish_reason: choice.finish_reason }
                : {}),
            };

            yield chunk;
          } catch {
            // Ignore malformed JSON in SSE line
          }
        }
      }
    }

    // Flush any remaining line
    if (buffer.trim().startsWith('data:')) {
      const dataPayload = buffer.trim().slice(5).trim();
      if (dataPayload !== '[DONE]') {
        try {
          const parsed = JSON.parse(dataPayload) as RawOpenAIStreamChunk;
          const choice = parsed.choices?.[0];
          if (choice?.delta) {
            const delta: ChatCompletionChunk['delta'] = {
              ...(choice.delta.role ? { role: choice.delta.role } : {}),
              content: choice.delta.content ?? null,
              ...(choice.delta.tool_calls ? { tool_calls: choice.delta.tool_calls } : {}),
            };
            yield {
              id: parsed.id ?? `chunk_${Date.now()}`,
              delta,
              ...(choice.finish_reason !== undefined
                ? { finish_reason: choice.finish_reason }
                : {}),
            };
          }
        } catch {
          // Ignore
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
