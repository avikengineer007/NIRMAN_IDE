/** Default maximum output size for tool execution results (16KB) */
export const DEFAULT_MAX_OUTPUT_BYTES = 16_384;

export interface TruncationResult {
  text: string;
  truncated: boolean;
  originalBytes: number;
  returnedBytes: number;
}

/**
 * Enforces output size limits on tool outputs, appending a clear truncation notice.
 */
export function truncateOutput(
  content: string,
  maxBytes: number = DEFAULT_MAX_OUTPUT_BYTES,
): TruncationResult {
  const byteLength = Buffer.byteLength(content, 'utf-8');

  if (byteLength <= maxBytes) {
    return {
      text: content,
      truncated: false,
      originalBytes: byteLength,
      returnedBytes: byteLength,
    };
  }

  // Slice text down to fit within maxBytes allowing room for the notice
  const targetBytes = Math.max(100, maxBytes - 200);
  let sliced = content.slice(0, targetBytes);

  // Try to cut at the last newline boundary for clean output
  const lastNewline = sliced.lastIndexOf('\n');
  if (lastNewline > targetBytes / 2) {
    sliced = sliced.slice(0, lastNewline);
  }

  const notice = `\n\n[TRUNCATED: Output exceeded ${maxBytes} bytes limit. Showing first ${Buffer.byteLength(sliced, 'utf-8')} of ${byteLength} bytes. Use line ranges or specific queries to narrow results.]`;

  const finalText = `${sliced}${notice}`;

  return {
    text: finalText,
    truncated: true,
    originalBytes: byteLength,
    returnedBytes: Buffer.byteLength(finalText, 'utf-8'),
  };
}
