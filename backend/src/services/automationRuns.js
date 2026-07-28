import { createHash, randomBytes, randomUUID } from 'node:crypto';

const runs = new Map();
const RUN_TTL_MS = 24 * 60 * 60_000;
const RUNNER_TOKEN_TTL_MS = 8 * 60 * 60_000;
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);
export const MINIMUM_RUNNER_VERSION = '0.1.2';

function tokenHash(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

function cleanText(value, max = 500) {
  return String(value || '').replace(/\u0000/g, '').trim().slice(0, max);
}

function versionParts(value) {
  return String(value || '')
    .split('.')
    .slice(0, 3)
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
}

export function runnerVersionSupported(version) {
  const received = versionParts(version);
  const minimum = versionParts(MINIMUM_RUNNER_VERSION);
  for (let index = 0; index < 3; index += 1) {
    if ((received[index] || 0) > (minimum[index] || 0)) return true;
    if ((received[index] || 0) < (minimum[index] || 0)) return false;
  }
  return true;
}

function validHttpUrl(value, fieldName) {
  try {
    const url = new URL(String(value || '').trim());
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
    return url.toString();
  } catch {
    const error = new Error(`${fieldName} deve ser uma URL HTTP ou HTTPS válida.`);
    error.status = 400;
    error.code = 'AUTOMATION_INVALID_URL';
    throw error;
  }
}

function normalizeCards(cards) {
  if (!Array.isArray(cards) || cards.length === 0) {
    const error = new Error('Selecione ao menos um card para a execução automatizada.');
    error.status = 400;
    error.code = 'AUTOMATION_CARDS_REQUIRED';
    throw error;
  }
  if (cards.length > 30) {
    const error = new Error('Cada lote pode conter no máximo 30 cards.');
    error.status = 400;
    throw error;
  }
  let scenarioCount = 0;
  const normalized = cards.map((card) => {
    const scenarios = Array.isArray(card.scenarios)
      ? card.scenarios
          .map((scenario) => ({
            id: cleanText(scenario.id, 120),
            code: cleanText(scenario.code, 40),
            title: cleanText(scenario.title, 300),
            bdd: cleanText(scenario.bdd, 12_000),
            path: cleanText(scenario.path || card.path, 800),
          }))
          .filter((scenario) => scenario.id && scenario.title && scenario.bdd)
      : [];
    scenarioCount += scenarios.length;
    return {
      code: cleanText(card.code, 80),
      title: cleanText(card.title, 500),
      hu: cleanText(card.hu, 80),
      path: cleanText(card.path, 800),
      scenarios,
    };
  }).filter((card) => card.code && card.scenarios.length > 0);

  if (normalized.length === 0 || scenarioCount === 0) {
    const error = new Error('Os cards selecionados não possuem cenários executáveis.');
    error.status = 400;
    error.code = 'AUTOMATION_SCENARIOS_REQUIRED';
    throw error;
  }
  if (scenarioCount > 150) {
    const error = new Error('Cada lote pode conter no máximo 150 cenários.');
    error.status = 400;
    throw error;
  }
  return normalized;
}

function publicRun(run) {
  if (!run) return null;
  const { runnerTokenHash: _runnerTokenHash, ownerUserId: _ownerUserId, ...safe } = run;
  return structuredClone(safe);
}

export function createAutomationRun(user, body = {}) {
  const ownerUserId = String(user?.userId || '').trim();
  if (!ownerUserId) {
    const error = new Error('Não foi possível identificar o usuário do SIG.');
    error.status = 401;
    throw error;
  }

  const token = randomBytes(36).toString('base64url');
  const now = Date.now();
  const cards = normalizeCards(body.cards);
  const run = {
    id: randomUUID(),
    ownerUserId,
    requestedBy: {
      userId: ownerUserId,
      username: cleanText(user.username, 150),
      name: cleanText(user.name, 200),
    },
    project: {
      name: cleanText(body.projectName, 300),
      sprint: cleanText(body.sprintName, 200),
      evidenceProjectId: cleanText(body.evidenceProjectId, 120) || null,
      qaPlanId: cleanText(body.qaPlanId, 120) || null,
    },
    target: {
      baseUrl: validHttpUrl(body.baseUrl, 'A URL do sistema'),
      loginUrl: validHttpUrl(body.loginUrl || body.baseUrl, 'A URL de login'),
    },
    cards,
    totalScenarios: cards.reduce((total, card) => total + card.scenarios.length, 0),
    completedScenarios: 0,
    status: 'waiting_runner',
    current: null,
    cancelRequested: false,
    results: [],
    events: [],
    runner: null,
    runnerTokenHash: tokenHash(token),
    runnerTokenExpiresAt: now + RUNNER_TOKEN_TTL_MS,
    createdAt: new Date(now).toISOString(),
    startedAt: null,
    finishedAt: null,
    updatedAt: new Date(now).toISOString(),
  };
  runs.set(run.id, run);
  return { run: publicRun(run), runnerToken: token };
}

export function getAutomationRunForUser(runId, userId) {
  const run = runs.get(String(runId));
  if (!run || run.ownerUserId !== String(userId)) return null;
  return publicRun(run);
}

export function requestAutomationCancellation(runId, userId) {
  const run = runs.get(String(runId));
  if (!run || run.ownerUserId !== String(userId)) return null;
  if (!TERMINAL_STATUSES.has(run.status)) {
    run.cancelRequested = true;
    run.updatedAt = new Date().toISOString();
    if (run.status === 'waiting_runner') {
      run.status = 'cancelled';
      run.finishedAt = run.updatedAt;
      run.current = null;
    }
    run.events.push({
      at: run.updatedAt,
      level: 'warning',
      message: 'Cancelamento solicitado pelo QA.',
    });
  }
  return publicRun(run);
}

export function authorizedRunnerRun(runId, token) {
  const run = runs.get(String(runId));
  if (!run || run.runnerTokenExpiresAt <= Date.now()) return null;
  return tokenHash(token) === run.runnerTokenHash ? run : null;
}

export function runnerRunPayload(run) {
  if (!run) return null;
  return {
    ...publicRun(run),
    cancelRequested: run.cancelRequested,
  };
}

export function claimAutomationRun(run, runnerInfo = {}) {
  if (TERMINAL_STATUSES.has(run.status)) return publicRun(run);
  const now = new Date().toISOString();
  const receivedVersion = cleanText(runnerInfo.version, 40) || 'desconhecida';
  if (!runnerVersionSupported(receivedVersion)) {
    const message = `Runner Local ${receivedVersion} desatualizado. Instale a versão ${MINIMUM_RUNNER_VERSION} ou superior antes de executar.`;
    if (!run.events.some((event) => event.message === message)) {
      run.events.push({ at: now, level: 'warning', message });
    }
    run.updatedAt = now;
    const error = new Error(message);
    error.status = 426;
    error.code = 'AUTOMATION_RUNNER_UPDATE_REQUIRED';
    error.detail = { receivedVersion, minimumVersion: MINIMUM_RUNNER_VERSION };
    throw error;
  }
  run.status = 'running';
  run.startedAt ||= now;
  run.updatedAt = now;
  run.runner = {
    name: cleanText(runnerInfo.name, 120) || 'Runner Local',
    version: receivedVersion,
    machine: cleanText(runnerInfo.machine, 200),
  };
  run.events.push({ at: now, level: 'info', message: 'Runner Local conectado.' });
  return publicRun(run);
}

export function updateAutomationRun(run, update = {}) {
  if (TERMINAL_STATUSES.has(run.status)) return publicRun(run);
  const now = new Date().toISOString();
  if (update.current && typeof update.current === 'object') {
    run.current = {
      cardCode: cleanText(update.current.cardCode, 80),
      scenarioId: cleanText(update.current.scenarioId, 120),
      scenarioCode: cleanText(update.current.scenarioCode, 40),
      step: cleanText(update.current.step, 500),
    };
  }
  if (update.event?.message) {
    run.events.push({
      at: now,
      level: ['info', 'success', 'warning', 'error'].includes(update.event.level)
        ? update.event.level
        : 'info',
      message: cleanText(update.event.message, 1_000),
    });
    if (run.events.length > 500) run.events.splice(0, run.events.length - 500);
  }
  if (update.result?.scenarioId) {
    const result = {
      cardCode: cleanText(update.result.cardCode, 80),
      scenarioId: cleanText(update.result.scenarioId, 120),
      scenarioCode: cleanText(update.result.scenarioCode, 40),
      title: cleanText(update.result.title, 300),
      status: ['passed', 'failed', 'blocked', 'not_automatable'].includes(update.result.status)
        ? update.result.status
        : 'blocked',
      summary: cleanText(update.result.summary, 3_000),
      lastStep: cleanText(update.result.lastStep, 1_000),
      actualResult: cleanText(update.result.actualResult, 3_000),
      expectedResult: cleanText(update.result.expectedResult, 3_000),
      finalUrl: cleanText(update.result.finalUrl, 2_000),
      evidence: Array.isArray(update.result.evidence) ? update.result.evidence.slice(0, 20) : [],
      diagnostics: {
        console: cleanText(update.result.diagnostics?.console, 8_000),
        network: cleanText(update.result.diagnostics?.network, 8_000),
      },
      startedAt: update.result.startedAt || null,
      finishedAt: update.result.finishedAt || now,
    };
    const index = run.results.findIndex((item) => item.scenarioId === result.scenarioId);
    if (index >= 0) run.results[index] = result;
    else run.results.push(result);
    run.completedScenarios = run.results.length;
  }
  if (TERMINAL_STATUSES.has(update.status)) {
    run.status = update.status;
    run.finishedAt = now;
    run.current = null;
  }
  run.updatedAt = now;
  return publicRun(run);
}

setInterval(() => {
  const cutoff = Date.now() - RUN_TTL_MS;
  for (const [id, run] of runs) {
    if (new Date(run.updatedAt).getTime() < cutoff) runs.delete(id);
  }
}, 60 * 60_000).unref?.();
