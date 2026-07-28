import http from 'node:http';
import { executeAutomationJob } from './executor.js';

const PORT = Number(process.env.RUNNER_PORT) || 4317;
const HOST = '127.0.0.1';
const runnerOrigin = `http://${HOST}:${PORT}`;
const configuredOrigin = new URL(
  process.env.PLAN_EVIDENCES_URL || 'http://localhost:4500'
).origin;
const localRuns = new Map();
let activeRunId = null;

function corsHeaders(req) {
  const origin = String(req.headers.origin || '');
  return origin === configuredOrigin
    ? {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Private-Network': 'true',
        Vary: 'Origin',
      }
    : {};
}

function sendJson(req, res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    ...corsHeaders(req),
  });
  res.end(JSON.stringify(body));
}

function sendHtml(res, status, html) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Content-Security-Policy':
      "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'",
  });
  res.end(html);
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function statusPage({ title, message, runId = '', isError = false }) {
  const safeRunId = /^[a-f0-9-]{36}$/i.test(runId) ? runId : '';
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light dark; font-family: Inter, system-ui, sans-serif; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f4f6fb; color: #172033; }
    main { width: min(620px, calc(100% - 40px)); padding: 28px; border: 1px solid #dfe4ee; border-radius: 20px; background: white; box-shadow: 0 20px 60px #17203320; }
    .brand { color: #159b24; font-size: 13px; font-weight: 800; text-transform: uppercase; letter-spacing: .08em; }
    h1 { margin: 8px 0 6px; font-size: 25px; }
    p { margin: 0; color: #687187; line-height: 1.55; }
    .state { margin-top: 20px; padding: 14px; border-radius: 12px; background: ${isError ? '#fff1f2' : '#effbef'}; color: ${isError ? '#b42318' : '#087a2b'}; font-weight: 700; }
    .meta { margin-top: 10px; color: #687187; font-size: 12px; }
    button { margin-top: 20px; padding: 10px 16px; border: 0; border-radius: 10px; color: white; background: #159b24; font-weight: 700; cursor: pointer; }
    @media (prefers-color-scheme: dark) {
      body { background: #11131a; color: #f5f7ff; }
      main { border-color: #2a2f3a; background: #181b24; }
      .state { background: ${isError ? '#451a1a' : '#15381c'}; color: ${isError ? '#fca5a5' : '#86efac'}; }
    }
  </style>
</head>
<body>
  <main>
    <div class="brand">PlanEvidences • Runner Local</div>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
    <div class="state" id="state">${isError ? 'Não foi possível iniciar.' : safeRunId ? 'Preparando o navegador...' : activeRunId ? 'Runner ocupado.' : 'Pronto para receber uma execução.'}</div>
    <div class="meta">${safeRunId ? `Execução ${escapeHtml(safeRunId)}` : `Origem autorizada: ${escapeHtml(configuredOrigin)}`}</div>
    <button type="button" onclick="window.close()">Fechar esta aba</button>
  </main>
  ${
    safeRunId
      ? `<script>
      const labels = { queued: 'Na fila', starting: 'Iniciando navegador', running: 'Executando', completed: 'Concluído', cancelled: 'Cancelado', failed: 'Falha técnica' };
      const state = document.getElementById('state');
      const poll = async () => {
        try {
          const response = await fetch('/runs/${safeRunId}', { cache: 'no-store' });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || 'Execução não encontrada.');
          const run = data.run;
          state.textContent = [labels[run.status] || run.status, run.cardCode, run.scenarioCode, run.message || run.error].filter(Boolean).join(' • ');
          if (['starting', 'running'].includes(run.status)) {
            setTimeout(() => window.close(), 700);
            return;
          }
          if (!['completed', 'cancelled', 'failed'].includes(run.status)) setTimeout(poll, 1000);
        } catch (error) {
          state.textContent = error.message;
        }
      };
      poll();
    </script>`
      : ''
  }
</body>
</html>`;
}

async function rawBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 256 * 1024) throw new Error('Requisição muito grande.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function requestBody(req) {
  const raw = await rawBody(req);
  if (String(req.headers['content-type'] || '').includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(raw));
  }
  return JSON.parse(raw || '{}');
}

function startRun(body) {
  if (activeRunId) {
    const error = new Error('O Runner Local já está executando outro lote.');
    error.status = 409;
    throw error;
  }
  const runId = String(body.runId || '');
  const requestedServerOrigin = (() => {
    try {
      return new URL(String(body.serverUrl || '')).origin;
    } catch {
      return '';
    }
  })();
  const credentials = body.credentials || {
    username: body.username,
    password: body.password,
  };
  if (
    !/^[a-f0-9-]{36}$/i.test(runId) ||
    !body.runnerToken ||
    !credentials?.username ||
    !credentials?.password
  ) {
    const error = new Error('Execução, token, usuário e senha são obrigatórios.');
    error.status = 400;
    throw error;
  }
  if (requestedServerOrigin !== configuredOrigin) {
    const error = new Error(`Runner configurado para ${configuredOrigin}.`);
    error.status = 403;
    throw error;
  }

  const localState = {
    id: runId,
    status: 'queued',
    message: 'Validando execução no PlanEvidences...',
    cardCode: null,
    scenarioCode: null,
    error: null,
  };
  localRuns.set(runId, localState);
  activeRunId = runId;
  executeAutomationJob({ ...body, credentials }, (update) => {
    Object.assign(localState, update);
  })
    .catch((error) => {
      localState.status = 'failed';
      localState.error = error.message;
    })
    .finally(() => {
      activeRunId = null;
    });
  return localState;
}

export const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(req));
    res.end();
    return;
  }
  const origin = String(req.headers.origin || '');
  if (origin && origin !== configuredOrigin && origin !== runnerOrigin) {
    sendJson(req, res, 403, { ok: false, error: 'Origem não autorizada no Runner Local.' });
    return;
  }

  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  if (req.method === 'GET' && url.pathname === '/') {
    sendHtml(
      res,
      200,
      statusPage({
        title: 'Runner Local disponível',
        message: activeRunId
          ? 'Existe um lote em execução neste computador.'
          : 'Volte ao PlanEvidences e selecione os cards e cenários que deseja executar.',
      })
    );
    return;
  }
  if (req.method === 'GET' && url.pathname === '/health') {
    sendJson(req, res, 200, {
      ok: true,
      name: 'PlanEvidences Runner Local',
      version: '0.2.2',
      busy: Boolean(activeRunId),
      configuredOrigin,
    });
    return;
  }

  const runMatch = url.pathname.match(/^\/runs\/([^/]+)$/);
  if (req.method === 'GET' && runMatch) {
    const run = localRuns.get(runMatch[1]);
    if (!run) {
      sendJson(req, res, 404, { ok: false, error: 'Execução não encontrada neste runner.' });
      return;
    }
    sendJson(req, res, 200, { ok: true, run });
    return;
  }

  if (req.method === 'POST' && ['/runs', '/runs/start'].includes(url.pathname)) {
    const htmlResponse = url.pathname === '/runs/start';
    try {
      const body = await requestBody(req);
      const localState = startRun(body);
      if (htmlResponse) {
        sendHtml(
          res,
          202,
          statusPage({
            title: 'Execução recebida',
            message: 'O navegador de teste será aberto neste computador. O resultado também aparece no PlanEvidences.',
            runId: localState.id,
          })
        );
      } else {
        sendJson(req, res, 202, { ok: true, run: localState });
      }
    } catch (error) {
      if (htmlResponse) {
        sendHtml(
          res,
          error.status || 400,
          statusPage({
            title: 'Runner não iniciado',
            message: error.message,
            isError: true,
          })
        );
      } else {
        sendJson(req, res, error.status || 400, { ok: false, error: error.message });
      }
    }
    return;
  }

  sendJson(req, res, 404, { ok: false, error: 'Rota não encontrada.' });
});

server.listen(PORT, HOST, () => {
  console.log(`[runner] PlanEvidences Runner Local em http://${HOST}:${PORT}`);
  console.log(`[runner] origem permitida: ${configuredOrigin}`);
  console.log(`[runner] navegador: ${String(process.env.RUNNER_HEADLESS).toLowerCase() === 'true' ? 'headless' : 'visível'}`);
});
