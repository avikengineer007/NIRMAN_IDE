import { describe, expect, it } from 'vitest';
import { parseSseStream } from './sse.js';

describe('SSE Stream Parser', () => {
  it('parses text chunks and terminates on [DONE]', async () => {
    const sseLines = [
      'data: {"id":"c1","choices":[{"delta":{"content":"Hello "},"finish_reason":null}]}\n\n',
      'data: {"id":"c1","choices":[{"delta":{"content":"world!"},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ];

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        for (const line of sseLines) {
          controller.enqueue(encoder.encode(line));
        }
        controller.close();
      },
    });

    const chunks = [];
    for await (const chunk of parseSseStream(stream)) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.delta.content).toBe('Hello ');
    expect(chunks[1]?.delta.content).toBe('world!');
    expect(chunks[1]?.finish_reason).toBe('stop');
  });

  it('handles multi-chunk fragmented SSE packets', async () => {
    const part1 = 'data: {"id":"c2","choices":';
    const part2 = '[{"delta":{"content":"Fragmented"}}]}\n\n';
    const part3 = 'data: [DONE]\n\n';

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode(part1));
        controller.enqueue(encoder.encode(part2));
        controller.enqueue(encoder.encode(part3));
        controller.close();
      },
    });

    const chunks = [];
    for await (const chunk of parseSseStream(stream)) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.delta.content).toBe('Fragmented');
  });
});
