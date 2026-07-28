import { callOpenAIPersistentTool } from '../src/services/openaiAutomationAgent.js';

if (!process.env.OPENAI_API_KEY) {
  throw new Error('OPENAI_API_KEY não configurada.');
}

const options = {
  apiKey: process.env.OPENAI_API_KEY,
  model: process.env.AUTOMATION_OPENAI_MODEL || process.env.OPENAI_MODEL,
  systemPrompt:
    'Você valida integrações. Chame automation_complete com status passed e os textos curtos solicitados.',
  userPrompt: 'Finalize este smoke test informando que a sessão persistente respondeu.',
  image: {
    mimeType: 'image/png',
    data:
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  },
  tools: [
    {
      name: 'automation_complete',
      description: 'Finaliza o smoke test.',
      inputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['passed'] },
          summary: { type: 'string' },
        },
        required: ['status', 'summary'],
        additionalProperties: false,
      },
    },
  ],
};
const first = await callOpenAIPersistentTool(options);
const result = await callOpenAIPersistentTool({
  ...options,
  userPrompt: 'A ferramenta respondeu corretamente. Confirme a continuação da mesma sessão.',
  previousResponseId: first.responseId,
  previousCallId: first.callId,
});

if (result.name !== 'automation_complete' || result.arguments.status !== 'passed') {
  throw new Error(`Resposta inesperada: ${JSON.stringify(result)}`);
}

console.log(
  JSON.stringify({
    ok: true,
    responseId: result.responseId,
    tool: result.name,
    summary: result.arguments.summary,
  })
);
