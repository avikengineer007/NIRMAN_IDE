/** Role of a chat message in OpenAI-compatible format */
export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

/** OpenAI function tool call */
export interface NativeToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

/** Normalized parsed tool call */
export interface ParsedToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  rawArguments?: string;
}

/** Chat message */
export interface ChatMessage {
  role: ChatRole;
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: NativeToolCall[];
}

/** Basic JSON schema property representation */
export interface JSONSchemaProperty {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
  description?: string;
  enum?: readonly (string | number | boolean)[];
  items?: JSONSchemaProperty;
  properties?: Record<string, JSONSchemaProperty>;
  required?: readonly string[];
}

/** Tool parameter schema */
export interface ToolParametersSchema {
  type: 'object';
  properties?: Record<string, JSONSchemaProperty>;
  required?: readonly string[];
  additionalProperties?: boolean;
}

/** Tool definition */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParametersSchema;
}

/** Tool execution mode */
export type ToolCallingMode = 'native' | 'fallback' | 'constrained';

/** OpenAI / llama.cpp response_format option for constrained decoding */
export type ResponseFormatOption =
  | { type: 'text' }
  | { type: 'json_object'; schema?: Record<string, unknown> }
  | {
      type: 'json_schema';
      json_schema: {
        name: string;
        strict?: boolean;
        schema: Record<string, unknown>;
      };
    };

/** Configuration for the model client */
export interface ModelConfig {
  baseUrl: string;
  apiKey?: string;
  model: string;
  temperature?: number;
  timeoutMs?: number;
  toolMode?: ToolCallingMode;
  contextWindowLimit?: number;
}

/** Chat completion streaming chunk delta */
export interface ChatCompletionChunkDelta {
  role?: ChatRole | undefined;
  content?: string | null | undefined;
  tool_calls?:
    | Array<{
        index: number;
        id?: string | undefined;
        type?: 'function' | undefined;
        function?:
          | {
              name?: string | undefined;
              arguments?: string | undefined;
            }
          | undefined;
      }>
    | undefined;
}

/** Raw chunk from OpenAI streaming SSE */
export interface ChatCompletionChunk {
  id: string;
  delta: ChatCompletionChunkDelta;
  finish_reason?: string | null | undefined;
}

/** Token usage breakdown */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/** Final result of a chat completion */
export interface ChatCompletionResult {
  message: ChatMessage;
  parsedToolCalls: ParsedToolCall[];
  rawText: string;
  finishReason: string | null;
  usage?: TokenUsage;
}

/** Analysis of context window usage */
export interface ContextWindowAnalysis {
  usedTokens: number;
  contextLimit: number;
  remainingTokens: number;
  percentUsed: number;
  isNearLimit: boolean;
  isExceeded: boolean;
}

/** Options per chat call */
export interface ChatOptions {
  temperature?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  responseFormat?: ResponseFormatOption;
  grammar?: string;
}

/** Public model client interface */
export interface ModelClient {
  readonly config: Readonly<ModelConfig>;
  chat(messages: readonly ChatMessage[], options?: ChatOptions): Promise<ChatCompletionResult>;
  streamChat(
    messages: readonly ChatMessage[],
    options?: ChatOptions,
  ): AsyncIterable<ChatCompletionChunk>;
  chatWithTools(
    messages: readonly ChatMessage[],
    tools: readonly ToolDefinition[],
    options?: ChatOptions,
  ): Promise<ChatCompletionResult>;
}
