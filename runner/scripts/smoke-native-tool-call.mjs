import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { rm } from 'node:fs/promises';
import { decideAutomationAction } from '../../backend/src/services/automationAgent.js';
import { McpBrowser } from '../src/mcpBrowser.js';

const outputDir = path.join(os.tmpdir(), `planevidences-native-tools-${Date.now()}`);
const browser = new McpBrowser({
  outputDir,
  allowedOrigins: ['https://sistema-cliente.local'],
  headless: true,
});

try {
  await browser.start();
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
    tools: browser.agentTools(),
  });
  assert.equal(decision.type, 'tool');
  assert.equal(browser.hasTool(decision.tool), true);
  console.log(`Schemas reais do Playwright MCP aprovados: ${decision.tool}.`);
} finally {
  await browser.close();
  await rm(outputDir, { recursive: true, force: true });
}
