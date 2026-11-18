import { OpenAICompatibleClient } from '../client.js';
import { analyzeContextWindow } from '../tokens.js';
import type { ChatMessage, ToolDefinition } from '../types.js';

async function main(): Promise<void> {
  const baseUrl = process.env['LLM_BASE_URL'] || 'http://localhost:11434/v1';
  const model = process.env['LLM_MODEL'] || 'qwen2.5-coder';
  const toolMode = process.env['LLM_TOOL_MODE'] === 'fallback' ? 'fallback' : 'native';
  const apiKey = process.env['LLM_API_KEY'];

  console.log('--- NIRMAN Local Model Client Demo ---');
  console.log(`Base URL:   ${baseUrl}`);
  console.log(`Model:      ${model}`);
  console.log(`Tool Mode:  ${toolMode}`);
  console.log('--------------------------------------\n');

  const client = new OpenAICompatibleClient({
    baseUrl,
    model,
    toolMode,
    ...(apiKey ? { apiKey } : {}),
    timeoutMs: 30_000,
  });

  const testTools: ToolDefinition[] = [
    {
      name: 'get_weather',
      description: 'Get the current weather for a specified location',
      parameters: {
        type: 'object',
        properties: {
          location: { type: 'string', description: 'City name or coordinates' },
          unit: {
            type: 'string',
            enum: ['celsius', 'fahrenheit'],
            description: 'Temperature unit',
          },
        },
        required: ['location'],
      },
    },
  ];

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content:
        'You are Nirman Agent, an AI coding assistant. When the user asks for information requiring a tool, use the appropriate tool.',
    },
    {
      role: 'user',
      content: 'What is the weather currently like in Tokyo in celsius?',
    },
  ];

  const contextAnalysis = analyzeContextWindow(messages, 32_768);
  console.log('Context Window Analysis:');
  console.log(`  Used Tokens:      ${contextAnalysis.usedTokens}`);
  console.log(`  Remaining Tokens: ${contextAnalysis.remainingTokens}`);
  console.log(`  Percent Used:     ${contextAnalysis.percentUsed}%`);
  console.log(`  Near Limit:       ${contextAnalysis.isNearLimit}`);
  console.log('--------------------------------------\n');

  console.log('Sending chatWithTools request...');
  try {
    const result = await client.chatWithTools(messages, testTools);
    console.log('\n[Response Received]');
    console.log(`Finish Reason: ${result.finishReason ?? 'unknown'}`);
    if (result.message.content) {
      console.log(`Content:\n${result.message.content}`);
    }
    if (result.parsedToolCalls.length > 0) {
      console.log('\nParsed Tool Calls:');
      for (const call of result.parsedToolCalls) {
        console.log(`- Tool: ${call.name} (id: ${call.id})`);
        console.log(`  Args: ${JSON.stringify(call.arguments, null, 2)}`);
      }
    }
    if (result.usage) {
      console.log('\nToken Usage:');
      console.log(`  Prompt:     ${result.usage.promptTokens}`);
      console.log(`  Completion: ${result.usage.completionTokens}`);
      console.log(`  Total:      ${result.usage.totalTokens}`);
    }
    console.log('\nSUCCESS: Local model client responded as expected.');
  } catch (err) {
    console.error('\n[Notice / Connection Note]');
    console.error(`Could not complete request to ${baseUrl}: ${(err as Error).message}`);
    console.error('\nTo test with local Ollama or llama.cpp:');
    console.error('  1. Start Ollama: ollama serve');
    console.error('  2. Run with your model:');
    console.error('     $env:LLM_MODEL="qwen2.5-coder:7b"; node dist/scripts/demo-local.js');
  }
}

void main();
