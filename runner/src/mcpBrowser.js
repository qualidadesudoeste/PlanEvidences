import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mcpCli = path.resolve(__dirname, '..', 'node_modules', '@playwright', 'mcp', 'cli.js');

export function resultText(result) {
  return (Array.isArray(result?.content) ? result.content : [])
    .filter((item) => item?.type === 'text')
    .map((item) => item.text)
    .join('\n')
    .slice(-40_000);
}

export class McpBrowser {
  constructor({ outputDir, allowedOrigins, headless }) {
    this.outputDir = outputDir;
    this.allowedOrigins = allowedOrigins;
    this.headless = headless;
    this.client = null;
    this.transport = null;
    this.tools = [];
  }

  async start() {
    await mkdir(this.outputDir, { recursive: true });
    const args = [
      mcpCli,
      '--isolated',
      '--browser',
      'chromium',
      '--output-dir',
      this.outputDir,
      '--output-mode',
      'stdout',
      '--snapshot-mode',
      'full',
      '--image-responses',
      'omit',
      '--ignore-https-errors',
    ];
    if (this.headless) args.push('--headless');
    if (this.allowedOrigins.length > 0) {
      args.push('--allowed-origins', this.allowedOrigins.join(';'));
    }

    this.transport = new StdioClientTransport({
      command: process.execPath,
      args,
      cwd: this.outputDir,
      stderr: 'pipe',
    });
    this.transport.stderr?.on('data', (chunk) => {
      const message = String(chunk).trim();
      if (message) console.error(`[playwright-mcp] ${message}`);
    });
    this.client = new Client(
      { name: 'planevidences-automation-runner', version: '0.1.0' },
      { capabilities: {} }
    );
    await this.client.connect(this.transport);
    const listed = await this.client.listTools();
    this.tools = listed.tools || [];
    return this.tools;
  }

  hasTool(name) {
    return this.tools.some((tool) => tool.name === name);
  }

  agentTools() {
    return this.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
  }

  async readResultText(result) {
    const raw = resultText(result);
    const artifacts = [];
    const links = raw.matchAll(/\]\(\.\/([^)#]+)(?:#[^)]+)?\)/g);
    const outputRoot = `${path.resolve(this.outputDir)}${path.sep}`;
    for (const match of links) {
      const relativePath = String(match[1] || '').replaceAll('/', path.sep);
      const resolved = path.resolve(this.outputDir, relativePath);
      if (!resolved.startsWith(outputRoot)) continue;
      if (!/\.(?:ya?ml|md|log|txt)$/i.test(resolved)) continue;
      try {
        artifacts.push(await readFile(resolved, 'utf8'));
      } catch {
        // O resultado original continua disponível mesmo sem o artefato.
      }
    }
    return [raw, ...artifacts].filter(Boolean).join('\n\n').slice(-40_000);
  }

  async call(name, args = {}) {
    if (!this.client || !this.hasTool(name)) {
      throw new Error(`Ferramenta Playwright indisponível: ${name}`);
    }
    const result = await this.client.callTool(
      { name, arguments: args },
      undefined,
      { timeout: 90_000, maxTotalTimeout: 120_000 }
    );
    if (result.isError) {
      throw new Error(resultText(result) || `A ferramenta ${name} falhou.`);
    }
    return result;
  }

  async close() {
    try {
      if (this.client && this.hasTool('browser_close')) {
        await this.call('browser_close');
      }
    } catch {
      // O processo MCP será encerrado pelo transporte.
    }
    await this.transport?.close().catch(() => {});
    this.client = null;
    this.transport = null;
  }
}
