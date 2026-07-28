import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { readFile, rm } from 'node:fs/promises';
import { McpBrowser } from '../src/mcpBrowser.js';

const port = 43222;
const origin = `http://127.0.0.1:${port}`;
const outputDir = path.join(os.tmpdir(), `planevidences-screenshot-${Date.now()}`);
const sockets = new Set();

const server = http.createServer((req, res) => {
  if (req.url === '/font.woff2') return;
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`
    <style>
      @font-face { font-family: FontePendente; src: url('/font.woff2'); }
      body { font-family: FontePendente, sans-serif; }
    </style>
    <h1>Captura sem aguardar fonte externa</h1>
  `);
});
server.on('connection', (socket) => {
  sockets.add(socket);
  socket.on('close', () => sockets.delete(socket));
});

await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
const browser = new McpBrowser({
  outputDir,
  allowedOrigins: [origin],
  headless: true,
});

try {
  await browser.start();
  await browser.call('browser_navigate', { url: origin });
  await browser.call('browser_take_screenshot', {
    type: 'png',
    filename: 'fontes-pendentes.png',
    fullPage: true,
    scale: 'css',
  });
  const screenshot = await readFile(path.join(outputDir, 'fontes-pendentes.png'));
  assert.ok(screenshot.length > 100);
  console.log('Smoke screenshot aprovado: captura concluída sem aguardar fontes externas.');
} finally {
  await browser.close();
  for (const socket of sockets) socket.destroy();
  await new Promise((resolve) => server.close(resolve));
  await rm(outputDir, { recursive: true, force: true });
}
