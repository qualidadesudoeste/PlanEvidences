import assert from 'node:assert/strict';
import http from 'node:http';
import { executeAutomationJob } from '../src/executor.js';

const planPort = 43220;
const targetPort = 43221;
const planOrigin = `http://127.0.0.1:${planPort}`;
const targetOrigin = `http://127.0.0.1:${targetPort}`;
const runId = '11111111-2222-4333-8444-555555555555';
const runnerToken = 'runner-token-smoke-test';
let loginReceived = null;
let runStatus = 'waiting_runner';
let cancelRequested = false;
const results = [];

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function bodyText(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

const scenario = {
  id: 'scenario-login-smoke',
  code: 'CT-001',
  title: 'Acessar o painel autenticado',
  bdd: 'Dado que o usuário está autenticado\nQuando acessa o painel\nEntão o painel é exibido',
  path: 'Menu > Painel',
};

function runPayload() {
  return {
    id: runId,
    status: runStatus,
    target: {
      baseUrl: `${targetOrigin}/`,
      loginUrl: `${targetOrigin}/login`,
    },
    cards: [
      {
        code: '123456',
        title: 'HU.1 - Login sintético',
        hu: 'HU.1',
        path: 'Menu > Painel',
        scenarios: [scenario],
      },
    ],
    cancelRequested,
    results,
  };
}

const targetServer = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/home') {
    loginReceived = Object.fromEntries(new URLSearchParams(await bodyText(req)));
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Set-Cookie': 'authenticated=yes; Path=/',
    });
    res.end('<main><h1>Painel autenticado</h1><p>Bem-vindo</p></main>');
    return;
  }
  if (req.url === '/login') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
      <form method="post" action="/home">
        <label>Usuário <input name="username" autocomplete="username"></label>
        <label>Senha <input name="password" type="password" autocomplete="current-password"></label>
        <button type="submit">Entrar</button>
      </form>
    `);
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<main><h1>Painel autenticado</h1><p>Conteúdo do cenário</p></main>');
});

const planServer = http.createServer(async (req, res) => {
  if (req.headers.authorization !== `Bearer ${runnerToken}`) {
    json(res, 401, { error: 'Token inválido' });
    return;
  }
  if (req.method === 'GET') {
    json(res, 200, { ok: true, run: runPayload() });
    return;
  }
  const raw = await bodyText(req);
  const body = raw ? JSON.parse(raw) : {};
  if (req.url.endsWith('/claim')) {
    runStatus = 'running';
    json(res, 200, { ok: true, run: runPayload() });
    return;
  }
  if (req.url.endsWith('/decision')) {
    if (body.purpose === 'login') {
      const usernameRef = String(body.observation).match(
        /textbox "Usuário" \[ref=([^\]]+)\]/
      )?.[1];
      const passwordRef = String(body.observation).match(
        /textbox "Senha" \[ref=([^\]]+)\]/
      )?.[1];
      const submitRef = String(body.observation).match(
        /button "Entrar" \[ref=([^\]]+)\]/
      )?.[1];
      if (!body.history?.length) {
        json(res, 200, {
          ok: true,
          decision: {
            type: 'tool',
            tool: 'browser_fill_form',
            step: 'Preencher as credenciais',
            arguments: {
              fields: [
                {
                  name: 'Usuário',
                  element: 'Campo Usuário',
                  target: usernameRef,
                  type: 'textbox',
                  value: '{{USERNAME}}',
                },
                {
                  name: 'Senha',
                  element: 'Campo Senha',
                  target: passwordRef,
                  type: 'textbox',
                  value: '{{PASSWORD}}',
                },
              ],
            },
          },
        });
        return;
      }
      if (!loginReceived) {
        json(res, 200, {
          ok: true,
          decision: {
            type: 'tool',
            tool: 'browser_click',
            step: 'Entrar no sistema',
            arguments: { element: 'Botão Entrar', target: submitRef },
          },
        });
        return;
      }
      json(res, 200, {
        ok: true,
        decision: {
          type: 'complete',
          status: 'passed',
          summary: 'Autenticação concluída.',
          actualResult: 'Painel autenticado carregado.',
          expectedResult: 'Usuário autenticado.',
          lastStep: 'Entrar no sistema',
        },
      });
      return;
    }
    json(res, 200, {
      ok: true,
      decision: {
        type: 'complete',
        status: 'passed',
        summary: 'Painel exibido.',
        actualResult: 'Painel autenticado visível.',
        expectedResult: 'Painel deve ser exibido.',
        lastStep: 'Acessar o painel',
      },
    });
    return;
  }
  if (req.method === 'PATCH') {
    if (body.result) results.push(body.result);
    if (body.status) runStatus = body.status;
    json(res, 200, { ok: true, run: runPayload() });
    return;
  }
  json(res, 404, { error: 'Rota não encontrada' });
});

await new Promise((resolve) => targetServer.listen(targetPort, '127.0.0.1', resolve));
await new Promise((resolve) => planServer.listen(planPort, '127.0.0.1', resolve));
process.env.PLAN_EVIDENCES_URL = planOrigin;
process.env.RUNNER_HEADLESS = 'true';
process.env.RUNNER_MAX_STEPS = '10';

try {
  await executeAutomationJob({
    serverUrl: planOrigin,
    runId,
    runnerToken,
    credentials: {
      username: 'usuario-local',
      password: 'credencial-local',
    },
  });
  assert.deepEqual(loginReceived, {
    username: 'usuario-local',
    password: 'credencial-local',
  });
  assert.equal(runStatus, 'completed');
  assert.equal(results.length, 1);
  assert.equal(results[0].status, 'passed');
  console.log('Smoke login aprovado: autenticação local e cenário concluídos.');
} finally {
  await Promise.all([
    new Promise((resolve) => targetServer.close(resolve)),
    new Promise((resolve) => planServer.close(resolve)),
  ]);
}
