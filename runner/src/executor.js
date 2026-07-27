import os from 'node:os';
import path from 'node:path';
import { readFile, rm } from 'node:fs/promises';
import { McpBrowser, resultText } from './mcpBrowser.js';

const RUNNER_VERSION = '0.1.0';

function apiHeaders(token, json = false) {
  return {
    Authorization: `Bearer ${token}`,
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  };
}

async function serverRequest(job, pathname, options = {}) {
  const response = await fetch(`${job.serverUrl}${pathname}`, {
    ...options,
    headers: {
      ...apiHeaders(job.runnerToken, options.body && !(options.body instanceof FormData)),
      ...(options.headers || {}),
    },
  });
  const raw = await response.text();
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    // Mensagem amigável abaixo.
  }
  if (!response.ok) {
    throw new Error(data.error || `PlanEvidences respondeu HTTP ${response.status}.`);
  }
  return data;
}

async function updateRun(job, update) {
  return serverRequest(job, `/api/automation-runner/runs/${job.runId}`, {
    method: 'PATCH',
    body: JSON.stringify(update),
  });
}

async function currentRun(job) {
  const data = await serverRequest(
    job,
    `/api/automation-runner/runs/${job.runId}`
  );
  return data.run;
}

async function decide(job, scenarioId, observation, history, tools) {
  const data = await serverRequest(
    job,
    `/api/automation-runner/runs/${job.runId}/decision`,
    {
      method: 'POST',
      body: JSON.stringify({ scenarioId, observation, history, tools }),
    }
  );
  return data.decision;
}

export function substituteSecrets(value, secrets) {
  if (typeof value === 'string') {
    if (value === '{{USERNAME}}') return secrets.username;
    if (value === '{{PASSWORD}}') return secrets.password;
    return value
      .replaceAll('{{USERNAME}}', secrets.username)
      .replaceAll('{{PASSWORD}}', secrets.password);
  }
  if (Array.isArray(value)) return value.map((item) => substituteSecrets(item, secrets));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, substituteSecrets(item, secrets)])
    );
  }
  return value;
}

export function redactSecrets(value, secrets) {
  let text = String(value || '');
  for (const secret of [secrets?.password, secrets?.username]) {
    if (!secret) continue;
    text = text.split(String(secret)).join('[credencial protegida]');
  }
  return text;
}

export function safeHistoryArguments(value) {
  const serialized = JSON.stringify(value)
    .replaceAll(/"value":"[^"]*"/g, '"value":"[valor protegido]"')
    .replaceAll(/"text":"[^"]*"/g, '"text":"[texto protegido]"');
  try {
    return JSON.parse(serialized);
  } catch {
    return {};
  }
}

export function ensureAllowedNavigation(tool, args, allowedOrigins) {
  if (tool !== 'browser_navigate' || !args?.url) return;
  const origin = new URL(args.url).origin;
  if (!allowedOrigins.includes(origin)) {
    throw new Error(`A IA tentou navegar para uma origem não autorizada: ${origin}`);
  }
}

function expectedFromBdd(bdd) {
  const lines = String(bdd || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const thenLine = [...lines].reverse().find((line) => /^(então|entao)\b/i.test(line));
  return thenLine?.replace(/^(então|entao)\s*/i, '').trim() || lines.at(-1) || '';
}

function finalUrlFromObservation(observation) {
  const match = String(observation || '').match(/(?:Page URL|URL da página):\s*(https?:\/\/\S+)/i);
  return match?.[1] || '';
}

export function ensureObservationOrigin(observation, allowedOrigins) {
  const currentUrl = finalUrlFromObservation(observation);
  if (!currentUrl) return;
  const origin = new URL(currentUrl).origin;
  if (!allowedOrigins.includes(origin)) {
    throw new Error(`O navegador saiu das origens autorizadas e foi bloqueado em ${origin}.`);
  }
}

export function validateSecretPlacement({
  tool,
  args,
  observation,
  loginUrl,
  usage,
}) {
  const serialized = JSON.stringify(args || {});
  const usesUsername = serialized.includes('{{USERNAME}}');
  const usesPassword = serialized.includes('{{PASSWORD}}');
  if (!usesUsername && !usesPassword) return { usesUsername: false, usesPassword: false };

  if (!['browser_fill_form', 'browser_type'].includes(tool)) {
    throw new Error('Credenciais só podem ser usadas em campos do formulário de login.');
  }
  const currentUrl = finalUrlFromObservation(observation);
  if (!currentUrl || new URL(currentUrl).origin !== new URL(loginUrl).origin) {
    throw new Error('O agente tentou usar credenciais fora da origem de login autorizada.');
  }
  if (usesUsername && usage.username) {
    throw new Error('O usuário de acesso já foi preenchido e não pode ser reutilizado.');
  }
  if (usesPassword && usage.password) {
    throw new Error('A senha de acesso já foi preenchida e não pode ser reutilizada.');
  }

  const credentialFields =
    tool === 'browser_fill_form'
      ? (Array.isArray(args?.fields) ? args.fields : []).map((field) => ({
          value: String(field?.value || ''),
          descriptor: `${field?.name || ''} ${field?.element || ''}`,
        }))
      : [
          {
            value: String(args?.text || ''),
            descriptor: `${args?.element || ''} ${args?.target || ''}`,
          },
        ];
  for (const field of credentialFields) {
    if (
      field.value.includes('{{USERNAME}}') &&
      !/(usu[aá]rio|user(?:name)?|login|e-?mail|cpf|matr[ií]cula|identificador)/i.test(
        field.descriptor
      )
    ) {
      throw new Error('O marcador de usuário foi solicitado para um campo que não parece ser de login.');
    }
    if (
      field.value.includes('{{PASSWORD}}') &&
      !/(senha|password|passcode|pwd)/i.test(field.descriptor)
    ) {
      throw new Error('O marcador de senha foi solicitado para um campo que não parece ser de senha.');
    }
  }
  return { usesUsername, usesPassword };
}

async function uploadEvidence(job, scenarioId, filePath) {
  const buffer = await readFile(filePath);
  const form = new FormData();
  form.append('scenarioId', scenarioId);
  form.append('file', new Blob([buffer], { type: 'image/png' }), path.basename(filePath));
  const data = await serverRequest(
    job,
    `/api/automation-runner/runs/${job.runId}/evidence`,
    { method: 'POST', body: form }
  );
  return data.evidence;
}

async function captureFailureEvidence(browser, job, scenario, outputDir) {
  const evidence = [];
  const screenshotName = `falha-${scenario.code || scenario.id}-${Date.now()}.png`
    .replace(/[^a-zA-Z0-9._-]/g, '_');
  try {
    await browser.call('browser_take_screenshot', {
      type: 'png',
      filename: screenshotName,
      fullPage: true,
      scale: 'css',
    });
    evidence.push(
      await uploadEvidence(job, scenario.id, path.join(outputDir, screenshotName))
    );
  } catch (error) {
    await updateRun(job, {
      event: {
        level: 'warning',
        message: `Não foi possível capturar o print de ${scenario.code}: ${error.message}`,
      },
    }).catch(() => {});
  }
  return evidence;
}

async function collectFailureDiagnostics(browser, secrets) {
  const diagnostics = { console: '', network: '' };
  if (browser.hasTool('browser_console_messages')) {
    diagnostics.console = redactSecrets(
      resultText(
        await browser
          .call('browser_console_messages', { level: 'warning', all: false })
          .catch(() => null)
      ),
      secrets
    ).slice(-8_000);
  }
  if (browser.hasTool('browser_network_requests')) {
    diagnostics.network = redactSecrets(
      resultText(
        await browser
          .call('browser_network_requests', { static: false })
          .catch(() => null)
      ),
      secrets
    ).slice(-8_000);
  }
  return diagnostics;
}

async function runScenario({ browser, job, card, scenario, secrets, outputDir, maxSteps }) {
  const startedAt = new Date().toISOString();
  const history = [];
  let observation = '';
  let lastStep = 'Abrir o sistema';
  const credentialUsage = { username: false, password: false };

  await updateRun(job, {
    current: {
      cardCode: card.code,
      scenarioId: scenario.id,
      scenarioCode: scenario.code,
      step: lastStep,
    },
    event: {
      level: 'info',
      message: `Executando #${card.code} • ${scenario.code} — ${scenario.title}`,
    },
  });

  try {
    observation = redactSecrets(resultText(
      await browser.call('browser_navigate', { url: job.run.target.loginUrl })
    ), secrets);
    if (!observation && browser.hasTool('browser_snapshot')) {
      observation = redactSecrets(resultText(await browser.call('browser_snapshot')), secrets);
    }
    ensureObservationOrigin(observation, job.allowedOrigins);

    for (let stepNumber = 1; stepNumber <= maxSteps; stepNumber += 1) {
      const state = await currentRun(job);
      if (state.cancelRequested) {
        return {
          cardCode: card.code,
          scenarioId: scenario.id,
          scenarioCode: scenario.code,
          title: scenario.title,
          status: 'blocked',
          summary: 'Execução cancelada pelo QA.',
          lastStep,
          actualResult: 'O cenário foi interrompido antes da conclusão.',
          expectedResult: expectedFromBdd(scenario.bdd),
          finalUrl: finalUrlFromObservation(observation),
          evidence: [],
          startedAt,
          finishedAt: new Date().toISOString(),
        };
      }

      const decision = await decide(
        job,
        scenario.id,
        observation,
        history,
        browser.agentTools()
      );
      if (decision.type === 'complete') {
        const shouldCapture = decision.status !== 'passed';
        const evidence = shouldCapture
          ? await captureFailureEvidence(browser, job, scenario, outputDir)
          : [];
        const diagnostics = shouldCapture
          ? await collectFailureDiagnostics(browser, secrets)
          : { console: '', network: '' };
        return {
          cardCode: card.code,
          scenarioId: scenario.id,
          scenarioCode: scenario.code,
          title: scenario.title,
          status: decision.status,
          summary: decision.summary,
          lastStep: decision.lastStep || lastStep,
          actualResult: decision.actualResult,
          expectedResult: decision.expectedResult || expectedFromBdd(scenario.bdd),
          finalUrl: finalUrlFromObservation(observation),
          evidence,
          diagnostics,
          startedAt,
          finishedAt: new Date().toISOString(),
        };
      }

      lastStep = decision.step || decision.tool;
      await updateRun(job, {
        current: {
          cardCode: card.code,
          scenarioId: scenario.id,
          scenarioCode: scenario.code,
          step: lastStep,
        },
      });
      ensureAllowedNavigation(decision.tool, decision.arguments, job.allowedOrigins);
      const secretPlacement = validateSecretPlacement({
        tool: decision.tool,
        args: decision.arguments,
        observation,
        loginUrl: job.run.target.loginUrl,
        usage: credentialUsage,
      });
      const protectedArgs = safeHistoryArguments(decision.arguments);
      const actualArgs = substituteSecrets(decision.arguments, secrets);
      let toolResult;
      try {
        toolResult = await browser.call(decision.tool, actualArgs);
      } catch (toolError) {
        const safeToolError = redactSecrets(toolError.message, secrets);
        history.push({
          step: stepNumber,
          tool: decision.tool,
          arguments: protectedArgs,
          error: safeToolError.slice(0, 1_000),
        });
        observation = `A ferramenta falhou: ${safeToolError}\n\n${observation}`;
        continue;
      }
      if (secretPlacement.usesUsername) credentialUsage.username = true;
      if (secretPlacement.usesPassword) credentialUsage.password = true;
      observation = redactSecrets(resultText(toolResult), secrets);
      if (!observation && browser.hasTool('browser_snapshot')) {
        observation = redactSecrets(
          resultText(await browser.call('browser_snapshot')),
          secrets
        );
      }
      ensureObservationOrigin(observation, job.allowedOrigins);
      history.push({
        step: stepNumber,
        tool: decision.tool,
        arguments: protectedArgs,
        result: observation.slice(-4_000),
      });
    }

    const evidence = await captureFailureEvidence(browser, job, scenario, outputDir);
    const diagnostics = await collectFailureDiagnostics(browser, secrets);
    return {
      cardCode: card.code,
      scenarioId: scenario.id,
      scenarioCode: scenario.code,
      title: scenario.title,
      status: 'blocked',
      summary: 'O agente atingiu o limite de ações sem concluir o cenário.',
      lastStep,
      actualResult: 'Não foi possível determinar o resultado com segurança.',
      expectedResult: expectedFromBdd(scenario.bdd),
      finalUrl: finalUrlFromObservation(observation),
      evidence,
      diagnostics,
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  } catch (error) {
    const safeError = redactSecrets(error.message, secrets);
    const evidence = await captureFailureEvidence(browser, job, scenario, outputDir);
    const diagnostics = await collectFailureDiagnostics(browser, secrets);
    return {
      cardCode: card.code,
      scenarioId: scenario.id,
      scenarioCode: scenario.code,
      title: scenario.title,
      status: 'blocked',
      summary: `O runner não conseguiu concluir o cenário: ${safeError}`,
      lastStep,
      actualResult: 'Execução interrompida por erro técnico.',
      expectedResult: expectedFromBdd(scenario.bdd),
      finalUrl: finalUrlFromObservation(observation),
      evidence,
      diagnostics,
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  }
}

export async function executeAutomationJob(jobInput, onLocalUpdate = () => {}) {
  const serverUrl = new URL(jobInput.serverUrl).origin;
  const configuredServer = new URL(
    process.env.PLAN_EVIDENCES_URL || 'http://localhost:4500'
  ).origin;
  if (serverUrl !== configuredServer) {
    throw new Error(`Runner configurado para ${configuredServer}, não para ${serverUrl}.`);
  }

  const job = {
    serverUrl,
    runId: String(jobInput.runId || ''),
    runnerToken: String(jobInput.runnerToken || ''),
    run: null,
    allowedOrigins: [],
  };
  let secrets = {
    username: String(jobInput.credentials?.username || ''),
    password: String(jobInput.credentials?.password || ''),
  };
  if (!job.runId || !job.runnerToken || !secrets.username || !secrets.password) {
    throw new Error('Execução, token, usuário e senha são obrigatórios.');
  }

  const initial = await currentRun(job);
  job.run = initial;
  job.allowedOrigins = [
    ...new Set([new URL(initial.target.baseUrl).origin, new URL(initial.target.loginUrl).origin]),
  ];
  await serverRequest(job, `/api/automation-runner/runs/${job.runId}/claim`, {
    method: 'POST',
    body: JSON.stringify({
      name: 'Runner Local Playwright MCP',
      version: RUNNER_VERSION,
      machine: os.hostname(),
    }),
  });

  const runnerTempRoot = path.join(os.tmpdir(), 'planevidences-runner');
  const outputDir = path.join(runnerTempRoot, job.runId);
  const browser = new McpBrowser({
    outputDir,
    allowedOrigins: job.allowedOrigins,
    headless: String(process.env.RUNNER_HEADLESS || '').toLowerCase() === 'true',
  });

  try {
    onLocalUpdate({ status: 'starting', message: 'Iniciando Playwright MCP...' });
    await browser.start();
    if (browser.hasTool('browser_start_tracing')) {
      await browser.call('browser_start_tracing').catch(() => {});
    }
    const maxSteps = Math.max(10, Math.min(60, Number(process.env.RUNNER_MAX_STEPS) || 35));
    let cancelled = false;

    for (const card of initial.cards) {
      for (const scenario of card.scenarios) {
        const state = await currentRun(job);
        if (state.cancelRequested) {
          cancelled = true;
          break;
        }
        onLocalUpdate({
          status: 'running',
          cardCode: card.code,
          scenarioCode: scenario.code,
          message: scenario.title,
        });
        const result = await runScenario({
          browser,
          job,
          card,
          scenario,
          secrets,
          outputDir,
          maxSteps,
        });
        await updateRun(job, {
          result,
          event: {
            level: result.status === 'passed' ? 'success' : 'warning',
            message: `${scenario.code}: ${
              result.status === 'passed' ? 'aprovado' : result.status
            }`,
          },
        });
      }
      if (cancelled) break;
    }

    if (browser.hasTool('browser_stop_tracing')) {
      await browser.call('browser_stop_tracing').catch(() => {});
    }
    await updateRun(job, {
      status: cancelled ? 'cancelled' : 'completed',
      event: {
        level: cancelled ? 'warning' : 'success',
        message: cancelled ? 'Execução cancelada.' : 'Lote automatizado concluído.',
      },
    });
    onLocalUpdate({ status: cancelled ? 'cancelled' : 'completed' });
  } catch (error) {
    await updateRun(job, {
      status: 'failed',
      event: { level: 'error', message: `Runner interrompido: ${error.message}` },
    }).catch(() => {});
    onLocalUpdate({ status: 'failed', error: error.message });
    throw error;
  } finally {
    secrets = null;
    await browser.close();
    await rm(outputDir, { recursive: true, force: true }).catch(() => {});
  }
}
