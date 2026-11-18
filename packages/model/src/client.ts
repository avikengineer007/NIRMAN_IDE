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
import { countTokens, estimateMessagesTokens } from './tokens.js';
import { validateSchema } from './schema.js';
import { formatToolsFallbackPrompt, parseFallbackToolCall, buildRepairPrompt } from './fallback.js';
import { parseSseStream } from './sse.js';

interface RawOpenAIResponse {
  id?: string;
  choices?: Array<{
    index?: number;
    message?: {
      role?: string;
      content?: string | null;
      tool_calls?: NativeToolCall[];
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

/**
 * Production OpenAI-compatible chat client.
 * Connects to local llama.cpp / Ollama / vLLM / OpenAI endpoints.
 */
export class OpenAICompatibleClient implements ModelClient {
  readonly config: ModelConfig;
  private readonly baseUrl: string;

  constructor(config: ModelConfig) {
    this.config = {
      baseUrl: config.baseUrl,
      model: config.model,
      toolMode: config.toolMode ?? 'native',
      temperature: config.temperature ?? 0.2,
      timeoutMs: config.timeoutMs ?? 60_000,
      contextWindowLimit: config.contextWindowLimit ?? 32_768,
      ...(config.apiKey ? { apiKey: config.apiKey } : {}),
    };
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
  }

  private createAbortSignal(options?: ChatOptions): AbortSignal {
    const timeoutMs = options?.timeoutMs ?? this.config.timeoutMs ?? 60_000;
    const timeoutSignal = AbortSignal.timeout(timeoutMs);

    if (options?.signal) {
      return AbortSignal.any([timeoutSignal, options.signal]);
    }
    return timeoutSignal;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }
    return headers;
  }

  /**
   * Standard non-streaming chat completion request.
   */
  async chat(
    messages: readonly ChatMessage[],
    options?: ChatOptions,
  ): Promise<ChatCompletionResult> {
    const signal = this.createAbortSignal(options);
    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: [...messages],
      temperature: options?.temperature ?? this.config.temperature ?? 0.2,
      stream: false,
    };

    const url = `${this.baseUrl}/chat/completions`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      throw new Error(`Failed to connect to model server at ${url}: ${(err as Error).message}`, {
        cause: err,
      });
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(
        `Model server error HTTP ${response.status} (${response.statusText}): ${errText}`,
      );
    }

    const data = (await response.json()) as RawOpenAIResponse;
    const choice = data.choices?.[0];
    if (!choice || !choice.message) {
      throw new Error('Model server returned empty choices');
    }

    const rawContent = choice.message.content ?? '';
    const nativeToolCalls = choice.message.tool_calls;
    const parsedCalls: ParsedToolCall[] = [];

    if (nativeToolCalls) {
      for (const call of nativeToolCalls) {
        let args: Record<string, unknown>;
        try {
          args = JSON.parse(call.function.arguments) as Record<string, unknown>;
        } catch {
          args = {};
        }
        parsedCalls.push({
          id: call.id,
          name: call.function.name,
          arguments: args,
          rawArguments: call.function.arguments,
        });
      }
    }

    const promptTokens = data.usage?.prompt_tokens ?? estimateMessagesTokens(messages);
    const completionTokens = data.usage?.completion_tokens ?? countTokens(rawContent);

    return {
      message: {
        role: 'assistant',
        content: choice.message.content ?? null,
        ...(nativeToolCalls ? { tool_calls: nativeToolCalls } : {}),
      },
      parsedToolCalls: parsedCalls,
      rawText: rawContent,
      finishReason: choice.finish_reason ?? null,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: data.usage?.total_tokens ?? promptTokens + completionTokens,
      },
    };
  }

  /**
   * Stream chat responses via Server-Sent Events.
   */
  async *streamChat(
    messages: readonly ChatMessage[],
    options?: ChatOptions,
  ): AsyncIterable<ChatCompletionChunk> {
    const signal = this.createAbortSignal(options);
    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: [...messages],
      temperature: options?.temperature ?? this.config.temperature ?? 0.2,
      stream: true,
    };

    const url = `${this.baseUrl}/chat/completions`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      throw new Error(
        `Failed to connect to model server stream at ${url}: ${(err as Error).message}`,
        { cause: err },
      );
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(
        `Model server stream HTTP ${response.status} (${response.statusText}): ${errText}`,
      );
    }

    if (!response.body) {
      throw new Error('Model server returned null stream body');
    }

    yield* parseSseStream(response.body);
  }

  /**
   * Chat with tool calling support.
   * If `toolMode === 'fallback'`, uses structured JSON prompt instructions and one-shot repair retry.
   */
  async chatWithTools(
    messages: readonly ChatMessage[],
    tools: readonly ToolDefinition[],
    options?: ChatOptions,
  ): Promise<ChatCompletionResult> {
    if (this.config.toolMode === 'fallback') {
      return this.chatWithToolsFallback(messages, tools, options);
    }

    return this.chatWithToolsNative(messages, tools, options);
  }

  private async chatWithToolsNative(
    messages: readonly ChatMessage[],
    tools: readonly ToolDefinition[],
    options?: ChatOptions,
  ): Promise<ChatCompletionResult> {
    const signal = this.createAbortSignal(options);
    const formattedTools = tools.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));

    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: [...messages],
      temperature: options?.temperature ?? this.config.temperature ?? 0.2,
      tools: formattedTools,
      stream: false,
    };

    const url = `${this.baseUrl}/chat/completions`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      throw new Error(`Failed to connect to model server at ${url}: ${(err as Error).message}`, {
        cause: err,
      });
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(
        `Model server error HTTP ${response.status} (${response.statusText}): ${errText}`,
      );
    }

    const data = (await response.json()) as RawOpenAIResponse;
    const choice = data.choices?.[0];
    if (!choice || !choice.message) {
      throw new Error('Model server returned empty choices');
    }

    const rawContent = choice.message.content ?? '';
    const nativeToolCalls = choice.message.tool_calls;
    const parsedCalls: ParsedToolCall[] = [];

    if (nativeToolCalls) {
      for (const call of nativeToolCalls) {
        let args: Record<string, unknown>;
        try {
          args = JSON.parse(call.function.arguments) as Record<string, unknown>;
        } catch {
          args = {};
        }

        // Validate arguments against tool schema
        const toolDef = tools.find((t) => t.name === call.function.name);
        if (toolDef) {
          const val = validateSchema(args, toolDef.parameters);
          if (!val.valid) {
            // Note: Schema warning can be stored on parsed call or handled
          }
        }

        parsedCalls.push({
          id: call.id,
          name: call.function.name,
          arguments: args,
          rawArguments: call.function.arguments,
        });
      }
    }

    // Auto-detect JSON tool calls emitted in text content by local models
    if (parsedCalls.length === 0 && rawContent) {
      const fallbackCheck = parseFallbackToolCall(rawContent, tools);
      if (fallbackCheck.type === 'tool_call') {
        parsedCalls.push(fallbackCheck.call);
      }
    }

    const promptTokens = data.usage?.prompt_tokens ?? estimateMessagesTokens(messages);
    const completionTokens = data.usage?.completion_tokens ?? countTokens(rawContent);

    return {
      message: {
        role: 'assistant',
        content: choice.message.content ?? null,
        ...(nativeToolCalls ? { tool_calls: nativeToolCalls } : {}),
      },
      parsedToolCalls: parsedCalls,
      rawText: rawContent,
      finishReason: choice.finish_reason ?? null,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: data.usage?.total_tokens ?? promptTokens + completionTokens,
      },
    };
  }

  private async chatWithToolsFallback(
    messages: readonly ChatMessage[],
    tools: readonly ToolDefinition[],
    options?: ChatOptions,
  ): Promise<ChatCompletionResult> {
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

    // Step 1: Initial call
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

    // Step 2: Retry once with repair message
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
      `Tool call fallback repair retry failed validation: ${parsed2.error}. Output: ${result2.rawText}`,
    );
  }
}
