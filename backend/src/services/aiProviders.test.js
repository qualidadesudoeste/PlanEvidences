import test from 'node:test';
import assert from 'node:assert/strict';
import { callProviderTool } from './aiProviders.js';

const tools = [
  {
    name: 'browser_click',
    description: 'Clica em um elemento presente no snapshot.',
    inputSchema: {
      type: 'object',
      properties: {
        element: { type: 'string' },
        ref: { type: 'string' },
      },
      required: ['element', 'ref'],
    },
  },
];

async function withMockedFetch(handler, callback) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = handler;
  try {
    return await callback();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('OpenAI escolhe uma ferramenta registrada por function calling nativo', async () => {
  let requestBody;
  const result = await withMockedFetch(
    async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    type: 'function',
                    function: {
                      name: 'browser_click',
                      arguments: '{"element":"Entrar","ref":"e7"}',
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    },
    () =>
      callProviderTool({
        provider: 'openai',
        apiKey: 'test-key',
        model: 'gpt-test',
        systemPrompt: 'system',
        userPrompt: 'user',
        tools,
      })
  );

  assert.equal(requestBody.tool_choice, 'required');
  assert.equal(requestBody.parallel_tool_calls, false);
  assert.equal(requestBody.tools[0].function.name, 'browser_click');
  assert.deepEqual(result, {
    name: 'browser_click',
    arguments: { element: 'Entrar', ref: 'e7' },
    usage: undefined,
  });
});

test('Anthropic escolhe exatamente uma ferramenta registrada', async () => {
  let requestBody;
  const result = await withMockedFetch(
    async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return new Response(
        JSON.stringify({
          content: [
            {
              type: 'tool_use',
              id: 'tool-1',
              name: 'browser_click',
              input: { element: 'Entrar', ref: 'e7' },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    },
    () =>
      callProviderTool({
        provider: 'anthropic',
        apiKey: 'test-key',
        model: 'claude-test',
        systemPrompt: 'system',
        userPrompt: 'user',
        tools,
      })
  );

  assert.deepEqual(requestBody.tool_choice, {
    type: 'any',
    disable_parallel_tool_use: true,
  });
  assert.equal(requestBody.tools[0].name, 'browser_click');
  assert.equal(result.name, 'browser_click');
  assert.deepEqual(result.arguments, { element: 'Entrar', ref: 'e7' });
});

test('Gemini limita a resposta às funções declaradas', async () => {
  let requestBody;
  const result = await withMockedFetch(
    async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    functionCall: {
                      name: 'browser_click',
                      args: { element: 'Entrar', ref: 'e7' },
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    },
    () =>
      callProviderTool({
        provider: 'gemini',
        apiKey: 'AIza-test-key',
        model: 'gemini-test',
        systemPrompt: 'system',
        userPrompt: 'user',
        tools,
      })
  );

  assert.equal(requestBody.toolConfig.functionCallingConfig.mode, 'ANY');
  assert.deepEqual(requestBody.toolConfig.functionCallingConfig.allowedFunctionNames, [
    'browser_click',
  ]);
  assert.equal(requestBody.tools[0].functionDeclarations[0].name, 'browser_click');
  assert.equal(result.name, 'browser_click');
  assert.deepEqual(result.arguments, { element: 'Entrar', ref: 'e7' });
});
