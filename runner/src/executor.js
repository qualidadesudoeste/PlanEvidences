import os from 'node:os';
import path from 'node:path';
import { readFile, rm } from 'node:fs/promises';
import { McpBrowser } from './mcpBrowser.js';

const RUNNER_VERSION = '0.2.6';
const UI_SETTLE_TIMEOUT_MS = Math.max(
  10_000,
  Math.min(180_000, Number(process.env.RUNNER_UI_SETTLE_TIMEOUT_MS) || 90_000)
);
const SERVER_REQUEST_TIMEOUT_MS = 180_000;
const SERVER_REQUEST_ATTEMPTS = 5;

function apiHeaders(token, json = false) {
  return {
    Authorization: `Bearer ${token}`,
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  };
}

export async function serverRequest(job, pathname, options = {}) {
  const isMultipart = options.body instanceof FormData;
  let lastError;
  for (let attempt = 1; attempt <= SERVER_REQUEST_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SERVER_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${job.serverUrl}${pathname}`, {
        ...options,
        headers: {
          ...apiHeaders(job.runnerToken, options.body && !isMultipart),
          ...(options.headers || {}),
        },
        signal: controller.signal,
      });
      const raw = await response.text();
      let data = {};
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        // A mensagem amigável abaixo representa a resposta inválida.
      }
      if (response.ok) return data;

      const error = new Error(
        data.error || `PlanEvidences respondeu HTTP ${response.status}.`
      );
      error.status = response.status;
      error.code = data.code || 'AUTOMATION_SERVER_RESPONSE_ERROR';
      const retryable = [408, 429, 500, 502, 503, 504].includes(response.status);
      if (!retryable || isMultipart || attempt === SERVER_REQUEST_ATTEMPTS) {
        throw error;
      }
      lastError = error;
    } catch (error) {
      const networkFailure =
        error?.name === 'AbortError' ||
        /fetch failed|network|socket|econnreset|etimedout|terminated/i.test(
          String(error?.message || '')
        );
      if (
        (!networkFailure && ![408, 429, 500, 502, 503, 504].includes(error?.status)) ||
        isMultipart ||
        attempt === SERVER_REQUEST_ATTEMPTS
      ) {
        if (networkFailure) {
          const unavailable = new Error(
            'A comunicação com o PlanEvidences ou com o serviço de IA ficou indisponível após 5 tentativas. Verifique a rede e inicie uma nova execução.'
          );
          unavailable.code = 'AUTOMATION_SERVER_UNAVAILABLE';
          unavailable.cause = error;
          throw unavailable;
        }
        throw error;
      }
      lastError = error;
    } finally {
      clearTimeout(timeout);
    }
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(8_000, 1_000 * 2 ** (attempt - 1)))
    );
  }
  throw lastError;
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

async function decide(
  job,
  scenarioId,
  observation,
  history,
  tools,
  purpose = 'scenario',
  image = null
) {
  const data = await serverRequest(
    job,
    `/api/automation-runner/runs/${job.runId}/decision`,
    {
      method: 'POST',
      body: JSON.stringify({ scenarioId, observation, history, tools, purpose, image }),
    }
  );
  return data.decision;
}

async function announceAgentMode(job, decision) {
  if (job.agentModeAnnounced || decision?.agentMode !== 'visual_persistent') return;
  job.agentModeAnnounced = true;
  await updateRun(job, {
    event: {
      level: 'success',
      message: 'Agente visual persistente conectado: contexto e visão serão mantidos durante o cenário.',
    },
  }).catch(() => {});
}

export async function captureVisualFrame(browser, outputDir) {
  if (!browser.hasTool('browser_take_screenshot')) return null;
  const filename = `agent-frame-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}.jpeg`;
  const filePath = path.join(outputDir, filename);
  try {
    await browser.call('browser_take_screenshot', {
      type: 'jpeg',
      filename,
      fullPage: false,
      scale: 'css',
    });
    const buffer = await readFile(filePath);
    if (buffer.length === 0 || buffer.length > 5 * 1024 * 1024) return null;
    return {
      mimeType: 'image/jpeg',
      data: buffer.toString('base64'),
    };
  } catch {
    return null;
  } finally {
    await rm(filePath, { force: true }).catch(() => {});
  }
}

async function currentBrowserObservation(browser, secrets, primaryResult = null) {
  const actionText = redactSecrets(await browser.readResultText(primaryResult), secrets);
  let snapshotText = '';
  if (browser.hasTool('browser_snapshot')) {
    snapshotText = redactSecrets(
      await browser.readResultText(await browser.call('browser_snapshot')),
      secrets
    );
  }
  return [actionText, snapshotText].filter(Boolean).join('\n\n').slice(-40_000);
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

export function isMcpRequestTimeout(error) {
  return /(?:MCP error\s+-32001|request timed out|timed out)/i.test(
    String(error?.message || error || '')
  );
}

export async function navigateWithRecovery({ browser, url, secrets }) {
  try {
    const result = await browser.call('browser_navigate', { url });
    return {
      observation: await currentBrowserObservation(browser, secrets, result),
      recovered: false,
    };
  } catch (error) {
    if (!isMcpRequestTimeout(error)) throw error;

    let observation = '';
    try {
      observation = await currentBrowserObservation(browser, secrets);
    } catch {
      // A mensagem amigável abaixo representa a falha de navegação original.
    }
    const currentUrl = finalUrlFromObservation(observation);
    let reachedTargetOrigin = false;
    try {
      reachedTargetOrigin =
        Boolean(currentUrl) && new URL(currentUrl).origin === new URL(url).origin;
    } catch {
      reachedTargetOrigin = false;
    }
    if (reachedTargetOrigin) {
      return { observation, recovered: true };
    }

    const navigationError = new Error(
      'A URL do sistema não respondeu em até 60 segundos. Confirme o endereço informado, a conexão com a VPN e tente novamente.'
    );
    navigationError.code = 'AUTOMATION_NAVIGATION_TIMEOUT';
    navigationError.observation = observation;
    throw navigationError;
  }
}

function normalizedObservation(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

export function loginCredentialTargets(observation) {
  const lines = String(observation || '').split(/\r?\n/);
  const usernamePattern =
    /\b(usuario|user(?:name)?|login|e-?mail|cpf|matricula|identificador)\b/;
  const passwordPattern = /\b(senha|password|passcode|pwd)\b/;
  const nearbyLabel = (lineIndex) => {
    for (let index = lineIndex; index >= Math.max(0, lineIndex - 4); index -= 1) {
      const normalizedLine = normalizedObservation(lines[index]);
      if (passwordPattern.test(normalizedLine)) return 'Senha';
      if (usernamePattern.test(normalizedLine)) return 'Usuário ou matrícula';
    }
    return '';
  };
  const fields = lines
    .map((line, lineIndex) => {
      const match = line.match(
        /(?:textbox|combobox)\b(?:\s+["']([^"'\r\n]+)["'])?[^\r\n]*?\[ref=([^\]\s]+)\]/iu
      );
      if (!match) return null;
      const name = String(match[1] || nearbyLabel(lineIndex)).trim();
      return {
        name,
        target: match[2],
        normalizedName: normalizedObservation(name),
      };
    })
    .filter(Boolean);
  const username = fields.find((field) =>
    usernamePattern.test(field.normalizedName)
  );
  const password = fields.find((field) =>
    passwordPattern.test(field.normalizedName)
  );
  if (username && password && username.target !== password.target) {
    return { username, password };
  }

  const loginContext = normalizedObservation(observation);
  if (
    fields.length === 2 &&
    /\b(entrar|acessar|login|autenticar|sign in)\b/.test(loginContext)
  ) {
    return {
      username: username || {
        ...fields[0],
        name: fields[0].name || 'Usuário ou matrícula',
        normalizedName: fields[0].normalizedName || 'usuario ou matricula',
      },
      password: password || {
        ...fields[1],
        name: fields[1].name || 'Senha',
        normalizedName: fields[1].normalizedName || 'senha',
      },
    };
  }
  return null;
}

export function normalizeBrowserToolArguments(tool, args = {}) {
  const normalized =
    args && typeof args === 'object' && !Array.isArray(args)
      ? JSON.parse(JSON.stringify(args))
      : {};
  const normalizeTarget = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    if (!value.target && value.ref) value.target = value.ref;
    delete value.ref;
  };

  normalizeTarget(normalized);
  if (tool === 'browser_fill_form' && Array.isArray(normalized.fields)) {
    for (const field of normalized.fields) {
      normalizeTarget(field);
      if (['text', 'input', 'password'].includes(String(field?.type || '').toLowerCase())) {
        field.type = 'textbox';
      }
    }
  }
  return normalized;
}

export function loginSubmissionAction(observation) {
  const buttonPattern =
    /button\s+["']([^"'\r\n]*(?:entrar|acessar|login|sign in|continuar|autenticar)[^"'\r\n]*)["'][^\r\n]*?\[ref=([^\]\s]+)\]/giu;
  const match = buttonPattern.exec(String(observation || ''));
  if (match) {
    return {
      tool: 'browser_click',
      arguments: {
        element: `Botão ${match[1]}`,
        target: match[2],
      },
      step: `Clicar em ${match[1]}`,
    };
  }
  return {
    tool: 'browser_press_key',
    arguments: { key: 'Enter' },
    step: 'Pressionar Enter para entrar',
  };
}

export function authenticationObservationState(observation) {
  const normalized = normalizedObservation(observation);
  const textboxes = [
    ...normalized.matchAll(/textbox\s+["']([^"']+)["'][^\n]*/g),
  ].map((match) => match[1]);
  const hasPasswordField =
    textboxes.some((name) => /\b(senha|password|passcode|pwd)\b/.test(name)) ||
    /\btype\s*=\s*["']?password\b/.test(normalized);
  const hasUsernameField = textboxes.some((name) =>
    /\b(usuario|user(?:name)?|login|e-?mail|cpf|matricula|identificador)\b/.test(name)
  );
  const hasLoginButton =
    /button\s+["'][^"']*\b(entrar|acessar|login|sign in|continuar)\b[^"']*["']/.test(
      normalized
    );
  const hasAdditionalChallenge =
    textboxes.some((name) =>
      /\b(codigo|token|otp|verificacao|autenticacao|mfa|captcha)\b/.test(name)
    ) ||
    /\b(captcha|autenticacao em dois fatores|two-factor|verification code)\b/.test(
      normalized
    );
  const hasLoginError =
    /\b(usuario ou senha invalido|credenciais invalidas|senha incorreta|acesso negado|login invalido|invalid credentials|incorrect password|cpf invalido|cpf deve|informe (?:um )?cpf valido|campo obrigatorio|preenchimento obrigatorio)\b/.test(
      normalized
    );
  return {
    currentUrl: finalUrlFromObservation(observation),
    hasPasswordField,
    hasUsernameField,
    hasLoginButton,
    hasAdditionalChallenge,
    hasLoginError,
    loginFormVisible: hasPasswordField && (hasUsernameField || hasLoginButton),
  };
}

export function hasLoadingIndicator(observation) {
  const normalized = normalizedObservation(observation);
  return (
    /\b(aria-busy\s*=\s*["']?true|carregando|processando|salvando|excluindo|entrando|aguarde|loading|processing|submitting)\b/.test(
      normalized
    ) ||
    /\b(?:button|progressbar)\s+["'][^"']*(?:\.\.\.|…)[^"']*["']/.test(
      normalized
    )
  );
}

function settledObservationSignature(observation) {
  return normalizedObservation(observation)
    .replace(/\[ref=[^\]]+\]/g, '[ref]')
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, '[hora]')
    .replace(/\s+/g, ' ')
    .trim();
}

export function actionMayTriggerProcessing(tool, args = {}, step = '') {
  const descriptor = `${step} ${args.element || ''} ${args.name || ''} ${args.text || ''}`;
  const processingAction =
    /\b(entrar|salvar|excluir|confirmar|enviar|pesquisar|buscar|filtrar|consultar|emitir|gerar|processar|inscrever|cadastrar|atualizar|reenviar|finalizar)\b/i.test(
      descriptor
    );
  if (tool === 'browser_click') return processingAction;
  if (
    tool === 'browser_press_key' &&
    /^(?:enter|control\+enter|meta\+enter)$/i.test(String(args.key || ''))
  ) {
    return true;
  }
  if (tool === 'browser_type' && args.submit === true) return true;
  if (['browser_select_option', 'browser_check', 'browser_uncheck'].includes(tool)) {
    return processingAction;
  }
  return false;
}

async function browserHasActiveLoadingIndicator(browser) {
  if (!browser.hasTool('browser_evaluate')) return false;
  try {
    const result = await browser.call('browser_evaluate', {
      function: `() => {
        const selectors = [
          '#nprogress',
          '.nprogress',
          'ng-progress',
          '.ng-progress-bar',
          '.ngx-progress-bar',
          '[aria-busy="true"]',
          '.loading-overlay',
          '.spinner-overlay'
        ];
        const visible = (element) => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            Number(style.opacity || 1) > 0 &&
            rect.width > 0 &&
            rect.height > 0 &&
            rect.bottom > 0 &&
            rect.right > 0 &&
            rect.top < innerHeight &&
            rect.left < innerWidth;
        };
        const indicator = selectors
          .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
          .find(visible);
        const busyButton = Array.from(document.querySelectorAll('button'))
          .filter(visible)
          .some((button) =>
            /carregando|processando|salvando|excluindo|entrando|aguarde|loading|processing|submitting/i
              .test(button.innerText || button.textContent || '')
          );
        return Boolean(indicator || busyButton);
      }`,
    });
    const text = await browser.readResultText(result);
    return /(?:### Result\s*)?\btrue\b/i.test(text);
  } catch {
    return false;
  }
}

export async function waitForUiSettled({
  browser,
  secrets,
  allowedOrigins,
  observation,
  maxWaitMs = UI_SETTLE_TIMEOUT_MS,
  pollMs = 750,
  stablePolls = 2,
}) {
  const startedAt = Date.now();
  let currentObservation = observation;
  let previousSignature = '';
  let stableCount = 0;
  let loadingSeen = hasLoadingIndicator(currentObservation);

  while (Date.now() - startedAt < maxWaitMs) {
    const signature = settledObservationSignature(currentObservation);
    const loading = hasLoadingIndicator(currentObservation);
    loadingSeen ||= loading;
    if (!loading && signature && signature === previousSignature) {
      stableCount += 1;
      if (stableCount >= stablePolls) {
        const domLoading = await browserHasActiveLoadingIndicator(browser);
        loadingSeen ||= domLoading;
        if (!domLoading) {
          return { observation: currentObservation, loadingSeen, timedOut: false };
        }
        stableCount = 0;
      }
    } else {
      stableCount = 0;
    }
    previousSignature = signature;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
    try {
      currentObservation = await currentBrowserObservation(browser, secrets);
      ensureObservationOrigin(currentObservation, allowedOrigins);
    } catch {
      // Mantém o último snapshot válido e tenta novamente até o limite.
    }
  }
  return { observation: currentObservation, loadingSeen, timedOut: true };
}

export async function waitForAuthenticationResponse({
  browser,
  secrets,
  allowedOrigins,
  observation,
  attempts = 4,
  intervalMs = 1_000,
}) {
  const settled = await waitForUiSettled({
    browser,
    secrets,
    allowedOrigins,
    observation,
    maxWaitMs: UI_SETTLE_TIMEOUT_MS,
    pollMs: Math.min(750, Math.max(1, intervalMs)),
  });
  let currentObservation = settled.observation;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const state = authenticationObservationState(currentObservation);
    if (
      !state.loginFormVisible ||
      state.hasLoginError ||
      state.hasAdditionalChallenge
    ) {
      return currentObservation;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    currentObservation = await currentBrowserObservation(browser, secrets);
    ensureObservationOrigin(currentObservation, allowedOrigins);
  }
  return currentObservation;
}

async function retryLoginWithSlowTyping({
  browser,
  job,
  secrets,
  observation,
}) {
  const targets = loginCredentialTargets(observation);
  if (!targets) return { attempted: false, observation };

  await updateRun(job, {
    event: {
      level: 'warning',
      message:
        'A tela de login permaneceu aberta. O Runner tentará novamente com digitação compatível com campos formatados.',
    },
  });
  const usernameResult = await browser.call('browser_type', {
    element: `Campo ${targets.username.name}`,
    target: targets.username.target,
    text: secrets.username,
    slowly: true,
  });
  let nextObservation = await currentBrowserObservation(
    browser,
    secrets,
    usernameResult
  );
  const refreshedTargets = loginCredentialTargets(nextObservation) || targets;
  const passwordResult = await browser.call('browser_type', {
    element: `Campo ${refreshedTargets.password.name}`,
    target: refreshedTargets.password.target,
    text: secrets.password,
    slowly: true,
  });
  nextObservation = await currentBrowserObservation(
    browser,
    secrets,
    passwordResult
  );
  const submitAction = loginSubmissionAction(nextObservation);
  const submitResult = await browser.call(
    submitAction.tool,
    submitAction.arguments
  );
  nextObservation = await currentBrowserObservation(
    browser,
    secrets,
    submitResult
  );
  nextObservation = await waitForAuthenticationResponse({
    browser,
    secrets,
    allowedOrigins: job.allowedOrigins,
    observation: nextObservation,
  });
  return { attempted: true, observation: nextObservation };
}

export function isLoginSubmission(tool, args, step = '') {
  if (
    tool === 'browser_press_key' &&
    /\benter\b/i.test(String(args?.key || args?.text || ''))
  ) {
    return true;
  }
  if (tool !== 'browser_click') return false;
  const descriptor = normalizedObservation(
    `${step} ${args?.element || ''} ${args?.name || ''} ${args?.target || ''}`
  );
  return /\b(entrar|acessar|login|sign in|continuar|autenticar)\b/.test(descriptor);
}

export function authenticationSucceeded({ observation, credentialUsage, submitted }) {
  if (!credentialUsage?.username || !credentialUsage?.password || !submitted) return false;
  const state = authenticationObservationState(observation);
  return (
    !state.hasPasswordField &&
    !state.hasAdditionalChallenge &&
    !state.hasLoginError
  );
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
  requireCredentialMarker = false,
}) {
  const serialized = JSON.stringify(args || {});
  const usesUsername = serialized.includes('{{USERNAME}}');
  const usesPassword = serialized.includes('{{PASSWORD}}');
  if (
    requireCredentialMarker &&
    ['browser_fill_form', 'browser_type'].includes(tool) &&
    !usesUsername &&
    !usesPassword
  ) {
    throw new Error(
      'A ação de preenchimento do login não incluiu os marcadores protegidos de usuário ou senha.'
    );
  }
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

export async function captureScenarioEvidence(
  browser,
  job,
  scenario,
  outputDir,
  evidenceKind = 'falha'
) {
  const evidence = [];
  const screenshotName = `${evidenceKind}-${scenario.code || scenario.id}-${Date.now()}.png`
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
      await browser.readResultText(
        await browser
          .call('browser_console_messages', { level: 'warning', all: false })
          .catch(() => null)
      ),
      secrets
    ).slice(-8_000);
  }
  if (browser.hasTool('browser_network_requests')) {
    diagnostics.network = redactSecrets(
      await browser.readResultText(
        await browser
          .call('browser_network_requests', { static: false })
          .catch(() => null)
      ),
      secrets
    ).slice(-8_000);
  }
  return diagnostics;
}

function authenticationError(message, code, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}

async function confirmAuthenticatedSession(job, observation, message) {
  job.authenticatedUrl =
    finalUrlFromObservation(observation) || job.authenticatedUrl || job.run.target.baseUrl;
  await updateRun(job, {
    event: { level: 'success', message },
  });
}

export function scenarioStartUrl(job) {
  try {
    const base = new URL(job.run.target.baseUrl);
    const login = new URL(job.run.target.loginUrl);
    const baseIsLogin =
      base.href === login.href || /(?:^|\/)(?:login|signin|autenticar)(?:\/|$)/i.test(base.pathname);
    return baseIsLogin && job.authenticatedUrl
      ? job.authenticatedUrl
      : job.run.target.baseUrl;
  } catch {
    return job.authenticatedUrl || job.run.target.baseUrl;
  }
}

async function authenticateBrowser({ browser, job, scenarioId, secrets, outputDir }) {
  const history = [];
  const credentialUsage = { username: false, password: false };
  let submitted = false;
  let repeatedActionCount = 0;
  let previousActionSignature = '';
  let lastStep = 'Abrir a tela de login';
  await updateRun(job, {
    current: {
      cardCode: '',
      scenarioId,
      scenarioCode: '',
      step: 'Autenticando no sistema testado',
    },
    event: {
      level: 'info',
      message: 'Realizando autenticação antes de iniciar os cenários.',
    },
  });

  let navigation;
  try {
    navigation = await navigateWithRecovery({
      browser,
      url: job.run.target.loginUrl,
      secrets,
    });
  } catch (error) {
    if (error.code === 'AUTOMATION_NAVIGATION_TIMEOUT') {
      throw authenticationError(
        error.message,
        'AUTOMATION_LOGIN_NAVIGATION_TIMEOUT',
        {
          observation: error.observation || '',
          lastStep,
        }
      );
    }
    throw error;
  }
  let observation = navigation.observation;
  ensureObservationOrigin(observation, job.allowedOrigins);
  if (navigation.recovered) {
    await updateRun(job, {
      event: {
        level: 'warning',
        message:
          'A abertura da página excedeu o tempo normal, mas o Runner recuperou o snapshot e continuará a autenticação.',
      },
    });
  }

  const credentialTargets = loginCredentialTargets(observation);
  const initialLoginState = authenticationObservationState(observation);
  if (!credentialTargets && !initialLoginState.loginFormVisible) {
    await confirmAuthenticatedSession(
      job,
      observation,
      'Nenhum formulário de login detectado após a navegação. O sistema parece ser de acesso público — autenticação ignorada.'
    );
    return;
  }
  if (credentialTargets) {
    try {
      lastStep = `Preencher ${credentialTargets.username.name}`;
      await updateRun(job, {
        current: {
          cardCode: '',
          scenarioId,
          scenarioCode: '',
          step: `Login: ${lastStep}`,
        },
        event: { level: 'info', message: `Login — ${lastStep}` },
      });
      const usernameResult = await browser.call('browser_type', {
        element: `Campo ${credentialTargets.username.name}`,
        target: credentialTargets.username.target,
        text: secrets.username,
      });
      credentialUsage.username = true;
      observation = await currentBrowserObservation(browser, secrets, usernameResult);
      ensureObservationOrigin(observation, job.allowedOrigins);

      const refreshedTargets = loginCredentialTargets(observation) || credentialTargets;
      lastStep = `Preencher ${refreshedTargets.password.name} e entrar`;
      await updateRun(job, {
        current: {
          cardCode: '',
          scenarioId,
          scenarioCode: '',
          step: `Login: ${lastStep}`,
        },
        event: { level: 'info', message: `Login — ${lastStep}` },
      });
      const passwordResult = await browser.call('browser_type', {
        element: `Campo ${refreshedTargets.password.name}`,
        target: refreshedTargets.password.target,
        text: secrets.password,
        submit: true,
      });
      credentialUsage.password = true;
      submitted = true;
      observation = await currentBrowserObservation(browser, secrets, passwordResult);
      ensureObservationOrigin(observation, job.allowedOrigins);
      observation = await waitForAuthenticationResponse({
        browser,
        secrets,
        allowedOrigins: job.allowedOrigins,
        observation,
      });

      let loginState = authenticationObservationState(observation);
      const submitAction = loginSubmissionAction(observation);
      if (
        loginState.loginFormVisible &&
        !loginState.hasLoginError &&
        !loginState.hasAdditionalChallenge &&
        submitAction.tool === 'browser_click'
      ) {
        lastStep = submitAction.step;
        await updateRun(job, {
          current: {
            cardCode: '',
            scenarioId,
            scenarioCode: '',
            step: `Login: ${lastStep}`,
          },
          event: { level: 'info', message: `Login — ${lastStep}` },
        });
        const submitResult = await browser.call(
          submitAction.tool,
          submitAction.arguments
        );
        observation = await currentBrowserObservation(browser, secrets, submitResult);
        ensureObservationOrigin(observation, job.allowedOrigins);
        observation = await waitForAuthenticationResponse({
          browser,
          secrets,
          allowedOrigins: job.allowedOrigins,
          observation,
        });
        loginState = authenticationObservationState(observation);
      }

      if (
        loginState.loginFormVisible &&
        !loginState.hasAdditionalChallenge &&
        !loginState.hasLoginError
      ) {
        const retry = await retryLoginWithSlowTyping({
          browser,
          job,
          secrets,
          observation,
        });
        observation = retry.observation;
        loginState = authenticationObservationState(observation);
      }

      if (loginState.hasAdditionalChallenge) {
        throw authenticationError(
          'O sistema solicitou captcha, código de verificação ou autenticação adicional. Essa etapa precisa ser concluída pelo QA.',
          'AUTOMATION_LOGIN_ADDITIONAL_CHALLENGE',
          { observation, lastStep }
        );
      }
      if (loginState.hasLoginError) {
        throw authenticationError(
          'O sistema recusou as credenciais informadas. Confirme o usuário e a senha do ambiente testado.',
          'AUTOMATION_LOGIN_REJECTED',
          { observation, lastStep }
        );
      }
      if (authenticationSucceeded({ observation, credentialUsage, submitted })) {
        await confirmAuthenticatedSession(
          job,
          observation,
          'Autenticação confirmada pelo desaparecimento do formulário de login.'
        );
        return;
      }
      throw authenticationError(
        'O formulário de login permaneceu aberto depois do preenchimento e do envio. Confirme as credenciais ou verifique se a tela exige uma etapa adicional.',
        'AUTOMATION_LOGIN_NO_PROGRESS',
        { observation, lastStep }
      );
    } catch (error) {
      if (String(error.code || '').startsWith('AUTOMATION_LOGIN_')) throw error;
      const safeToolError = redactSecrets(error.message, secrets);
      throw authenticationError(
        `O Runner encontrou os campos de login, mas não conseguiu preenchê-los. Detalhe técnico: ${safeToolError}`,
        'AUTOMATION_LOGIN_TOOL_FAILED',
        { observation, lastStep }
      );
    }
  }

  for (let stepNumber = 1; stepNumber <= 15; stepNumber += 1) {
    const state = await currentRun(job);
    if (state.cancelRequested) throw new Error('Execução cancelada durante a autenticação.');

    // O frame visual só é enviado antes da digitação das credenciais. Depois
    // disso o Runner usa DOM redigido até confirmar que saiu da tela de login.
    const visualFrame =
      !credentialUsage.username && !credentialUsage.password
        ? await captureVisualFrame(browser, outputDir)
        : null;
    const decision = await decide(
      job,
      scenarioId,
      observation,
      history,
      browser.agentTools(),
      'login',
      visualFrame
    );
    await announceAgentMode(job, decision);
    if (decision.type === 'complete') {
      if (decision.status === 'passed') {
        const loginState = authenticationObservationState(observation);
        if (loginState.loginFormVisible) {
          history.push({
            step: `${stepNumber}.verification`,
            error:
              'A IA tentou concluir a autenticação, mas o formulário de login continua visível.',
          });
          continue;
        }
        await confirmAuthenticatedSession(
          job,
          observation,
          'Autenticação concluída com sucesso.'
        );
        return;
      }
      let loginState = authenticationObservationState(observation);
      if (
        credentialUsage.username &&
        credentialUsage.password &&
        submitted &&
        loginState.loginFormVisible &&
        !loginState.hasAdditionalChallenge &&
        !loginState.hasLoginError
      ) {
        const retry = await retryLoginWithSlowTyping({
          browser,
          job,
          secrets,
          observation,
        });
        if (retry.attempted) {
          observation = retry.observation;
          loginState = authenticationObservationState(observation);
          if (authenticationSucceeded({ observation, credentialUsage, submitted })) {
            await confirmAuthenticatedSession(
              job,
              observation,
              'Autenticação confirmada após a tentativa compatível.'
            );
            return;
          }
          if (loginState.hasLoginError) {
            throw authenticationError(
              'O sistema rejeitou os dados informados ou exibiu uma validação no formulário. Confirme se o usuário deve ser um CPF válido e verifique a senha.',
              'AUTOMATION_LOGIN_REJECTED',
              { observation, lastStep }
            );
          }
        }
      }
      throw authenticationError(
        decision.actualResult ||
          decision.summary ||
          'Não foi possível autenticar no sistema testado.',
        'AUTOMATION_LOGIN_BLOCKED',
        { observation, lastStep: decision.lastStep || lastStep }
      );
    }

    lastStep = decision.step || decision.tool;
    const normalizedArgs = normalizeBrowserToolArguments(
      decision.tool,
      decision.arguments
    );
    const protectedArgs = safeHistoryArguments(normalizedArgs);
    const actionSignature = JSON.stringify({
      tool: decision.tool,
      arguments: protectedArgs,
    });
    repeatedActionCount =
      actionSignature === previousActionSignature ? repeatedActionCount + 1 : 0;
    previousActionSignature = actionSignature;
    if (repeatedActionCount >= 2) {
      throw authenticationError(
        `A autenticação não avançou após repetir a ação "${lastStep}". Verifique se a tela exige captcha, código adicional ou uma forma diferente de acesso.`,
        'AUTOMATION_LOGIN_NO_PROGRESS',
        { observation, lastStep }
      );
    }

    await updateRun(job, {
      current: {
        cardCode: '',
        scenarioId,
        scenarioCode: '',
        step: `Login: ${lastStep}`,
      },
      event: {
        level: 'info',
        message: `Login — ${lastStep}`,
      },
    });
    ensureAllowedNavigation(decision.tool, normalizedArgs, job.allowedOrigins);
    const secretPlacement = validateSecretPlacement({
      tool: decision.tool,
      args: normalizedArgs,
      observation,
      loginUrl: job.run.target.loginUrl,
      usage: credentialUsage,
      requireCredentialMarker: true,
    });
    const actualArgs = substituteSecrets(normalizedArgs, secrets);
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
    const submittedByDecision = isLoginSubmission(
      decision.tool,
      normalizedArgs,
      lastStep
    );
    if (submittedByDecision) submitted = true;
    observation = await currentBrowserObservation(browser, secrets, toolResult);
    ensureObservationOrigin(observation, job.allowedOrigins);
    if (submittedByDecision) {
      observation = await waitForAuthenticationResponse({
        browser,
        secrets,
        allowedOrigins: job.allowedOrigins,
        observation,
      });
    }
    history.push({
      step: stepNumber,
      tool: decision.tool,
      arguments: protectedArgs,
      result: observation.slice(-4_000),
    });

    let loginState = authenticationObservationState(observation);
    if (
      credentialUsage.username &&
      credentialUsage.password &&
      !submitted &&
      loginState.loginFormVisible
    ) {
      const submitAction = loginSubmissionAction(observation);
      lastStep = submitAction.step;
      await updateRun(job, {
        current: {
          cardCode: '',
          scenarioId,
          scenarioCode: '',
          step: `Login: ${lastStep}`,
        },
        event: {
          level: 'info',
          message: `Login — ${lastStep}`,
        },
      });
      const submitResult = await browser.call(
        submitAction.tool,
        submitAction.arguments
      );
      submitted = true;
      observation = await currentBrowserObservation(browser, secrets, submitResult);
      ensureObservationOrigin(observation, job.allowedOrigins);
      observation = await waitForAuthenticationResponse({
        browser,
        secrets,
        allowedOrigins: job.allowedOrigins,
        observation,
      });
      history.push({
        step: `${stepNumber}.submit`,
        tool: submitAction.tool,
        arguments: safeHistoryArguments(submitAction.arguments),
        result: observation.slice(-4_000),
      });
      loginState = authenticationObservationState(observation);
    }
    if (submitted && loginState.hasAdditionalChallenge) {
      throw authenticationError(
        'O sistema solicitou captcha, código de verificação ou autenticação adicional. Essa etapa precisa ser concluída pelo QA.',
        'AUTOMATION_LOGIN_ADDITIONAL_CHALLENGE',
        { observation, lastStep }
      );
    }
    if (submitted && loginState.hasLoginError) {
      throw authenticationError(
        'O sistema recusou as credenciais informadas. Confirme o usuário e a senha do ambiente testado.',
        'AUTOMATION_LOGIN_REJECTED',
        { observation, lastStep }
      );
    }
    if (authenticationSucceeded({ observation, credentialUsage, submitted })) {
      await confirmAuthenticatedSession(
        job,
        observation,
        'Autenticação confirmada pelo desaparecimento do formulário de login.'
      );
      return;
    }
  }
  throw authenticationError(
    `A autenticação não foi confirmada após 15 ações. Última ação: ${lastStep}.`,
    'AUTOMATION_LOGIN_LIMIT',
    { observation, lastStep }
  );
}

async function runScenario({ browser, job, card, scenario, secrets, outputDir, maxSteps }) {
  const startedAt = new Date().toISOString();
  const history = [];
  const failedActions = new Map();
  let observation = '';
  let lastStep = 'Abrir o sistema';
  // A autenticação é feita uma única vez antes do lote. Credenciais não podem
  // ser reutilizadas durante a navegação funcional dos cenários.
  const credentialUsage = { username: true, password: true };

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
    let navigation = await navigateWithRecovery({
      browser,
      url: scenarioStartUrl(job),
      secrets,
    });
    observation = navigation.observation;
    ensureObservationOrigin(observation, job.allowedOrigins);
    if (authenticationObservationState(observation).loginFormVisible) {
      await updateRun(job, {
        event: {
          level: 'warning',
          message:
            'A sessão não estava disponível ao iniciar o cenário. O Runner tentará autenticar novamente uma única vez.',
        },
      });
      await authenticateBrowser({
        browser,
        job,
        scenarioId: scenario.id,
        secrets,
        outputDir,
      });
      navigation = await navigateWithRecovery({
        browser,
        url: scenarioStartUrl(job),
        secrets,
      });
      observation = navigation.observation;
      ensureObservationOrigin(observation, job.allowedOrigins);
      if (authenticationObservationState(observation).loginFormVisible) {
        throw authenticationError(
          'A autenticação foi executada, mas o sistema voltou para a tela de login ao abrir a funcionalidade. O lote foi interrompido para evitar bloquear todos os cenários.',
          'AUTOMATION_LOGIN_SESSION_NOT_AVAILABLE',
          { observation, lastStep: 'Validar a sessão antes do cenário' }
        );
      }
    }

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

      const visualFrame = await captureVisualFrame(browser, outputDir);
      const decision = await decide(
        job,
        scenario.id,
        observation,
        history,
        browser.agentTools(),
        'scenario',
        visualFrame
      );
      await announceAgentMode(job, decision);
      if (decision.type === 'complete') {
        const shouldCollectFailureDetails = decision.status !== 'passed';
        const evidence = await captureScenarioEvidence(
          browser,
          job,
          scenario,
          outputDir,
          decision.status === 'passed' ? 'aprovado' : 'falha'
        );
        const diagnostics = shouldCollectFailureDetails
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
      const normalizedArgs = normalizeBrowserToolArguments(
        decision.tool,
        decision.arguments
      );
      await updateRun(job, {
        current: {
          cardCode: card.code,
          scenarioId: scenario.id,
          scenarioCode: scenario.code,
          step: lastStep,
        },
      });
      ensureAllowedNavigation(decision.tool, normalizedArgs, job.allowedOrigins);
      const secretPlacement = validateSecretPlacement({
        tool: decision.tool,
        args: normalizedArgs,
        observation,
        loginUrl: job.run.target.loginUrl,
        usage: credentialUsage,
      });
      const protectedArgs = safeHistoryArguments(normalizedArgs);
      const actionSignature = JSON.stringify({
        tool: decision.tool,
        arguments: protectedArgs,
      });
      const actualArgs = substituteSecrets(normalizedArgs, secrets);
      let toolResult;
      try {
        toolResult = await browser.call(decision.tool, actualArgs);
      } catch (toolError) {
        const safeToolError = redactSecrets(toolError.message, secrets);
        const failureCount = (failedActions.get(actionSignature) || 0) + 1;
        failedActions.set(actionSignature, failureCount);
        history.push({
          step: stepNumber,
          tool: decision.tool,
          arguments: protectedArgs,
          error: safeToolError.slice(0, 1_000),
        });
        if (failureCount >= 2) {
          throw new Error(
            `A ação "${lastStep}" falhou repetidamente. Detalhe técnico: ${safeToolError}`
          );
        }
        // Ref stale: busca snapshot fresco para o agente ter refs válidos na próxima decisão
        if (/does not match any elements/i.test(safeToolError)) {
          try {
            const freshSnapshot = await currentBrowserObservation(browser, secrets);
            observation = `A ferramenta falhou: ${safeToolError}\n\nSnapshot atualizado — use apenas referências listadas abaixo:\n${freshSnapshot}`;
          } catch {
            observation = `A ferramenta falhou: ${safeToolError}\n\n${observation}`;
          }
        } else {
          observation = `A ferramenta falhou: ${safeToolError}\n\n${observation}`;
        }
        continue;
      }
      failedActions.delete(actionSignature);
      if (secretPlacement.usesUsername) credentialUsage.username = true;
      if (secretPlacement.usesPassword) credentialUsage.password = true;
      observation = await currentBrowserObservation(browser, secrets, toolResult);
      ensureObservationOrigin(observation, job.allowedOrigins);
      if (actionMayTriggerProcessing(decision.tool, normalizedArgs, lastStep)) {
        const settled = await waitForUiSettled({
          browser,
          secrets,
          allowedOrigins: job.allowedOrigins,
          observation,
        });
        observation = settled.observation;
        if (settled.loadingSeen) {
          await updateRun(job, {
            event: {
              level: settled.timedOut ? 'warning' : 'info',
              message: settled.timedOut
                ? `O indicador de processamento permaneceu ativo após "${lastStep}". O agente continuará com o último estado disponível.`
                : `Processamento concluído após "${lastStep}".`,
            },
          });
        }
      }
      history.push({
        step: stepNumber,
        tool: decision.tool,
        arguments: protectedArgs,
        result: observation.slice(-4_000),
      });
    }

    const evidence = await captureScenarioEvidence(browser, job, scenario, outputDir);
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
    const evidence = await captureScenarioEvidence(browser, job, scenario, outputDir);
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
      stopBatch: String(error.code || '').startsWith('AUTOMATION_LOGIN_'),
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
    agentModeAnnounced: false,
    authenticatedUrl: '',
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
  const firstCard = initial.cards.find((card) => card.scenarios.length > 0);
  const firstScenario = firstCard?.scenarios[0];

  try {
    onLocalUpdate({ status: 'starting', message: 'Iniciando Playwright MCP...' });
    try {
      await browser.start();
    } catch (error) {
      if (isMcpRequestTimeout(error)) {
        throw new Error(
          'O Playwright MCP demorou além do limite para iniciar. Feche outros navegadores automatizados e tente novamente.'
        );
      }
      throw error;
    }
    if (browser.hasTool('browser_start_tracing')) {
      await browser.call('browser_start_tracing').catch(() => {});
    }
    const maxSteps = Math.max(10, Math.min(60, Number(process.env.RUNNER_MAX_STEPS) || 35));
    let cancelled = false;
    let batchInterrupted = '';
    if (!firstScenario) throw new Error('O lote não possui cenários para execução.');
    onLocalUpdate({ status: 'starting', message: 'Autenticando no sistema...' });
    await authenticateBrowser({
      browser,
      job,
      scenarioId: firstScenario.id,
      secrets,
      outputDir,
    });

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
        if (result.stopBatch) {
          batchInterrupted = result.summary;
          break;
        }
      }
      if (cancelled || batchInterrupted) break;
    }

    if (browser.hasTool('browser_stop_tracing')) {
      await browser.call('browser_stop_tracing').catch(() => {});
    }
    await updateRun(job, {
      status: cancelled ? 'cancelled' : batchInterrupted ? 'failed' : 'completed',
      event: {
        level: cancelled || batchInterrupted ? 'warning' : 'success',
        message: cancelled
          ? 'Execução cancelada.'
          : batchInterrupted
            ? 'Lote interrompido porque a sessão autenticada não está disponível.'
            : 'Lote automatizado concluído.',
      },
    });
    onLocalUpdate({
      status: cancelled ? 'cancelled' : batchInterrupted ? 'failed' : 'completed',
      error: batchInterrupted || undefined,
    });
  } catch (error) {
    const safeError = redactSecrets(error.message, secrets);
    if (String(error.code || '').startsWith('AUTOMATION_LOGIN_') && firstCard && firstScenario) {
      const evidence = await captureScenarioEvidence(
        browser,
        job,
        firstScenario,
        outputDir
      ).catch(() => []);
      const diagnostics = await collectFailureDiagnostics(browser, secrets).catch(() => ({
        console: '',
        network: '',
      }));
      await updateRun(job, {
        result: {
          cardCode: firstCard.code,
          scenarioId: firstScenario.id,
          scenarioCode: firstScenario.code,
          title: firstScenario.title,
          status: 'blocked',
          summary: safeError,
          lastStep: error.lastStep || 'Autenticação no sistema testado',
          actualResult: 'O Runner não conseguiu confirmar uma sessão autenticada.',
          expectedResult: 'O sistema deveria permitir o acesso com a conta informada.',
          finalUrl: finalUrlFromObservation(error.observation || ''),
          evidence,
          diagnostics,
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
        },
        event: {
          level: 'error',
          message: `Autenticação interrompida: ${safeError}`,
        },
      }).catch(() => {});
    }
    await updateRun(job, {
      status: 'failed',
      event: { level: 'error', message: `Runner interrompido: ${safeError}` },
    }).catch(() => {});
    onLocalUpdate({ status: 'failed', error: safeError });
    throw error;
  } finally {
    secrets = null;
    await browser.close();
    await rm(outputDir, { recursive: true, force: true }).catch(() => {});
  }
}
