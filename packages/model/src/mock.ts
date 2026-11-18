import type {
  ChatCompletionChunk,
  ChatCompletionResult,
  ChatMessage,
  ChatOptions,
  ModelClient,
  ModelConfig,
  NativeToolCall,
  ParsedToolCall,
  ToolDefinition,
} from './types.js';
import { countTokens } from './tokens.js';
import { parseFallbackToolCall, formatToolsFallbackPrompt, buildRepairPrompt } from './fallback.js';

export interface RecordedResponse {
  readonly content?: string | null;
  readonly toolCalls?: readonly NativeToolCall[];
  readonly chunks?: readonly ChatCompletionChunk[];
}

export interface MockInteraction {
  readonly match?: (messages: readonly ChatMessage[]) => boolean;
  readonly response: string | RecordedResponse;
}

export interface RecordedCall {
  readonly messages: readonly ChatMessage[];
  readonly tools?: readonly ToolDefinition[];
  readonly options?: ChatOptions;
}

/**
 * Mock Model Client for deterministic, zero-network tests.
 */
export class MockModelClient implements ModelClient {
  readonly config: ModelConfig;
  private readonly interactions: MockInteraction[] = [];
  public readonly recordedCalls: RecordedCall[] = [];

  constructor(interactions: readonly MockInteraction[] = [], config: Partial<ModelConfig> = {}) {
    this.interactions = [...interactions];
    this.config = {
      baseUrl: config.baseUrl ?? 'http://mock.local/v1',
      model: config.model ?? 'mock-model',
      toolMode: config.toolMode ?? 'native',
      temperature: config.temperature ?? 0,
      timeoutMs: config.timeoutMs ?? 5000,
      contextWindowLimit: config.contextWindowLimit ?? 32_768,
      ...(config.apiKey ? { apiKey: config.apiKey } : {}),
    };
  }

  addInteraction(interaction: MockInteraction): void {
    this.interactions.push(interaction);
  }

  private findNextResponse(messages: readonly ChatMessage[]): string | RecordedResponse {
    const idx = this.interactions.findIndex((inter) => {
      if (!inter.match) {
        return true;
      }
      return inter.match(messages);
    });

    if (idx === -1) {
      throw new Error(
        `MockModelClient: No recorded interaction matched the given ${messages.length} messages. Last message: "${messages[messages.length - 1]?.content ?? ''}"`,
      );
    }

    const matched = this.interactions[idx];
    if (!matched) {
      throw new Error('MockModelClient: Unexpected undefined interaction');
    }
    this.interactions.splice(idx, 1);
    return matched.response;
  }

  async chat(
    messages: readonly ChatMessage[],
    options?: ChatOptions,
  ): Promise<ChatCompletionResult> {
    await Promise.resolve();
    this.recordedCalls.push({ messages: [...messages], ...(options ? { options } : {}) });
    const raw = this.findNextResponse(messages);

    if (typeof raw === 'string') {
      const completionTokens = countTokens(raw);
      return {
        message: { role: 'assistant', content: raw },
        parsedToolCalls: [],
        rawText: raw,
        finishReason: 'stop',
        usage: {
          promptTokens: 10,
          completionTokens,
          totalTokens: 10 + completionTokens,
        },
      };
    }

    const nativeCalls = raw.toolCalls ? [...raw.toolCalls] : undefined;
    const content = raw.content ?? null;
    const parsed: ParsedToolCall[] = [];

    if (nativeCalls) {
      for (const call of nativeCalls) {
        let args: Record<string, unknown>;
        try {
          args = JSON.parse(call.function.arguments) as Record<string, unknown>;
        } catch {
          args = {};
        }
        parsed.push({
          id: call.id,
          name: call.function.name,
          arguments: args,
          rawArguments: call.function.arguments,
        });
      }
    }

    const rawText = content ?? '';
    const completionTokens = countTokens(rawText);

    return {
      message: {
        role: 'assistant',
        content,
        ...(nativeCalls ? { tool_calls: nativeCalls } : {}),
      },
      parsedToolCalls: parsed,
      rawText,
      finishReason: parsed.length > 0 ? 'tool_calls' : 'stop',
      usage: {
        promptTokens: 10,
        completionTokens,
        totalTokens: 10 + completionTokens,
      },
    };
  }

  async *streamChat(
    messages: readonly ChatMessage[],
    options?: ChatOptions,
  ): AsyncIterable<ChatCompletionChunk> {
    await Promise.resolve();
    this.recordedCalls.push({ messages: [...messages], ...(options ? { options } : {}) });
    const raw = this.findNextResponse(messages);

    if (typeof raw === 'string') {
      yield {
        id: 'chunk_1',
        delta: { role: 'assistant', content: raw },
        finish_reason: 'stop',
      };
      return;
    }

    if (raw.chunks && raw.chunks.length > 0) {
      for (const chunk of raw.chunks) {
        yield chunk;
      }
      return;
    }

    yield {
      id: 'chunk_1',
      delta: {
        role: 'assistant',
        content: raw.content ?? null,
        ...(raw.toolCalls
          ? {
              tool_calls: raw.toolCalls.map((tc, i) => ({
                index: i,
                id: tc.id,
                type: 'function',
                function: tc.function,
              })),
            }
          : {}),
      },
      finish_reason: raw.toolCalls && raw.toolCalls.length > 0 ? 'tool_calls' : 'stop',
    };
  }

  async chatWithTools(
    messages: readonly ChatMessage[],
    tools: readonly ToolDefinition[],
    options?: ChatOptions,
  ): Promise<ChatCompletionResult> {
    if (this.config.toolMode === 'fallback') {
      return this.chatWithToolsFallback(messages, tools, options);
    }

    this.recordedCalls.push({
      messages: [...messages],
      tools: [...tools],
      ...(options ? { options } : {}),
    });

    return this.chat(messages, options);
  }

  private async chatWithToolsFallback(
    messages: readonly ChatMessage[],
    tools: readonly ToolDefinition[],
    options?: ChatOptions,
  ): Promise<ChatCompletionResult> {
    // Inject fallback instructions
    const promptInstructions = formatToolsFallbackPrompt(tools);
    const augmentedMessages: ChatMessage[] = [];

    const firstMsg = messages[0];
    if (firstMsg && firstMsg.role === 'system') {
      augmentedMessages.push({
        role: 'system',
        content: `${firstMsg.content ?? ''}\n\n${promptInstructions}`,
      });
      augmentedMessages.push(...messages.slice(1));
    } else {
      augmentedMessages.push({ role: 'system', content: promptInstructions });
      augmentedMessages.push(...messages);
    }

    // Attempt 1
    const result1 = await this.chat(augmentedMessages, options);
    const parsed1 = parseFallbackToolCall(result1.rawText, tools);

    if (parsed1.type === 'tool_call') {
      return {
        ...result1,
        parsedToolCalls: [parsed1.call],
      };
    }

    if (parsed1.type === 'text') {
      return {
        ...result1,
        parsedToolCalls: [],
      };
    }

    // Validation failed: retry ONCE with repair message
    const repairPrompt = buildRepairPrompt(parsed1.error, parsed1.rawSnippet);
    const retryMessages: ChatMessage[] = [
      ...augmentedMessages,
      { role: 'assistant', content: result1.rawText },
      { role: 'user', content: repairPrompt },
    ];

    const result2 = await this.chat(retryMessages, options);
    const parsed2 = parseFallbackToolCall(result2.rawText, tools);

    if (parsed2.type === 'tool_call') {
      return {
        ...result2,
        parsedToolCalls: [parsed2.call],
      };
    }

    if (parsed2.type === 'text') {
      return {
        ...result2,
        parsedToolCalls: [],
      };
    }

    throw new Error(
      `Tool call repair retry failed validation: ${parsed2.error}. Model output: ${result2.rawText}`,
    );
  }
}
