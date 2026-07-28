import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPersistentResponseRequest,
  parsePersistentToolResponse,
} from './openaiAutomationAgent.js';

const tools = [
  {
    name: 'browser_click',
    description: 'Clica em um elemento.',
    inputSchema: {
      type: 'object',
      properties: { target: { type: 'string' } },
      required: ['target'],
    },
  },
];

test('inicia uma sessão visual com snapshot e screenshot', () => {
  const request = buildPersistentResponseRequest({
    model: 'gpt-test',
    systemPrompt: 'Você é um agente de QA.',
    userPrompt: 'Snapshot atual',
    tools,
    image: { mimeType: 'image/jpeg', data: 'YWJj' },
  });

  assert.equal(request.model, 'gpt-test');
  assert.equal(request.input[0].role, 'user');
  assert.equal(request.input[0].content[0].type, 'input_text');
  assert.equal(request.input[0].content[1].type, 'input_image');
  assert.equal(request.input[0].content[1].image_url, 'data:image/jpeg;base64,YWJj');
  assert.equal(request.tools[0].name, 'browser_click');
});

test('continua a mesma sessão devolvendo o resultado da ferramenta anterior', () => {
  const request = buildPersistentResponseRequest({
    systemPrompt: 'Agente',
    userPrompt: 'A página agora exibe o menu principal.',
    tools,
    previousResponseId: 'resp_123',
    previousCallId: 'call_123',
  });

  assert.equal(request.previous_response_id, 'resp_123');
  assert.deepEqual(request.input[0], {
    type: 'function_call_output',
    call_id: 'call_123',
    output: 'A página agora exibe o menu principal.',
  });
});

test('extrai a chamada de ferramenta da Responses API', () => {
  assert.deepEqual(
    parsePersistentToolResponse({
      id: 'resp_456',
      output: [
        {
          type: 'function_call',
          call_id: 'call_456',
          name: 'browser_click',
          arguments: '{"target":"e12"}',
        },
      ],
    }),
    {
      responseId: 'resp_456',
      callId: 'call_456',
      name: 'browser_click',
      arguments: { target: 'e12' },
      usage: undefined,
    }
  );
});
