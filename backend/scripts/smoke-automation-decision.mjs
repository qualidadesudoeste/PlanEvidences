import assert from 'node:assert/strict';
import { decideAutomationAction } from '../src/services/automationAgent.js';

const decision = await decideAutomationAction({
  run: {
    target: {
      baseUrl: 'https://sistema-cliente.local/',
      loginUrl: 'https://sistema-cliente.local/login',
    },
  },
  scenario: {
    id: 'smoke-login',
    code: 'CT-001',
    title: 'Acessar o sistema',
    bdd: 'Dado que o usuário possui acesso\nQuando realiza login\nEntão a tela inicial é exibida',
    cardCode: '123456',
    cardTitle: 'HU.1 - Login',
    path: 'Login',
  },
  purpose: 'login',
  observation: `### Page
- Page URL: https://sistema-cliente.local/login
- textbox "Usuário" [ref=e4]
- textbox "Senha" [ref=e6]
- button "Entrar" [ref=e7]`,
  history: [],
  tools: [
    {
      name: 'browser_fill_form',
      description: 'Preenche vários campos de um formulário.',
      inputSchema: {
        type: 'object',
        properties: {
          fields: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                type: { type: 'string', enum: ['textbox', 'checkbox', 'radio', 'combobox', 'slider'] },
                ref: { type: 'string' },
                value: { type: 'string' },
              },
              required: ['name', 'type', 'ref', 'value'],
            },
          },
        },
        required: ['fields'],
      },
    },
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
  ],
});

assert.equal(decision.type, 'tool');
assert.ok(
  ['browser_fill_form', 'browser_click'].includes(decision.tool),
  `Ferramenta inesperada: ${decision.tool}`
);
console.log(`Tool calling nativo aprovado: ${decision.tool}.`);
