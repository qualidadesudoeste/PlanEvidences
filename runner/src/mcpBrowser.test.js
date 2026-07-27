import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { McpBrowser } from './mcpBrowser.js';

test('carrega o snapshot salvo pelo Playwright MCP antes de enviá-lo ao agente', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'planevidences-mcp-test-'));
  try {
    await writeFile(
      path.join(outputDir, 'page.yml'),
      '- textbox "Usuário" [ref=e4]\n- textbox "Senha" [ref=e6]\n- button "Entrar" [ref=e7]\n',
      'utf8'
    );
    const browser = new McpBrowser({
      outputDir,
      allowedOrigins: [],
      headless: true,
    });
    const text = await browser.readResultText({
      content: [
        {
          type: 'text',
          text: '### Snapshot\n- [Snapshot](./page.yml)',
        },
      ],
    });
    assert.match(text, /textbox "Usuário" \[ref=e4\]/);
    assert.match(text, /textbox "Senha" \[ref=e6\]/);
    assert.match(text, /button "Entrar" \[ref=e7\]/);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});
