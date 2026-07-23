const DEFAULT_SIG_API_URL = 'https://sigv3.sudoesteinformatica.com.br/sig_v3';
const DEFAULT_SIG_WEB_URL = 'https://sigv3.sudoesteinformatica.com.br';
const CORRECTIVE_ACTIVITY_NAME = 'Retrabalho / Correção de erros';

const lookupsCaches = new Map();
const publicationRequests = new Map();

export class SigIntegrationError extends Error {
  constructor(message, { status = 502, code = 'SIG_INTEGRATION_ERROR' } = {}) {
    super(message);
    this.name = 'SigIntegrationError';
    this.status = status;
    this.code = code;
  }
}

function config() {
  return {
    apiUrl: (process.env.SIG_API_URL || DEFAULT_SIG_API_URL).replace(/\/+$/, ''),
    webUrl: (process.env.SIG_WEB_URL || DEFAULT_SIG_WEB_URL).replace(/\/+$/, ''),
    timeoutMs: Math.max(5_000, Number(process.env.SIG_TIMEOUT_MS) || 60_000),
    lookupsCacheMs: Math.max(30_000, Number(process.env.SIG_LOOKUPS_CACHE_MS) || 300_000),
    activityId: process.env.SIG_CORRECTIVE_ACTIVITY_ID
      ? Number(process.env.SIG_CORRECTIVE_ACTIVITY_ID)
      : null,
  };
}

function parseJson(text) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

export function tokenExpiration(token) {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payload.padEnd(Math.ceil(payload.length / 4) * 4, '=');
    const parsed = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
    return parsed.exp ? Number(parsed.exp) * 1000 : Date.now() + 5 * 60_000;
  } catch {
    return Date.now() + 5 * 60_000;
  }
}

function tokenClaims(token) {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payload.padEnd(Math.ceil(payload.length / 4) * 4, '=');
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
  } catch {
    return {};
  }
}

function userFromToken(token) {
  const claims = tokenClaims(token);
  const groups = Array.isArray(claims.groups)
    ? claims.groups.map((group) =>
        typeof group === 'string'
          ? group
          : String(group?.name || group?.nome || group?.description || '').trim()
      ).filter(Boolean)
    : [];
  return {
    name: String(claims.name || claims.nome || claims.username || 'Usuário SIG'),
    username: String(claims.username || claims.user_name || ''),
    userId: String(claims.userId || claims.user_id || claims.sub || ''),
    pesCod: claims.pesCod === undefined || claims.pesCod === null
      ? null
      : String(claims.pesCod),
    groups,
    isAdmin: Boolean(claims.isAdmin),
  };
}

function cookiePairFromResponse(response) {
  const values =
    typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers.get('set-cookie')];
  const raw = values.find(Boolean);
  if (!raw) return '';
  return String(raw).split(';', 1)[0].trim();
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new SigIntegrationError(
        'O SIG demorou para responder. Tente publicar novamente em alguns instantes.',
        { status: 504, code: 'SIG_TIMEOUT' }
      );
    }
    throw new SigIntegrationError(
      'Não foi possível conectar ao SIG. Verifique a rede do servidor e tente novamente.',
      { status: 502, code: 'SIG_UNAVAILABLE' }
    );
  } finally {
    clearTimeout(timer);
  }
}

function accessTokenFromResponse(data) {
  return data.access_token || data.token || data.accessToken || '';
}

export async function authenticateSigUser(usernameValue, passwordValue) {
  const username = String(usernameValue || '').trim();
  const password = String(passwordValue || '');
  if (!username || !password) {
    throw new SigIntegrationError('Informe o usuário e a senha do SIG.', {
      status: 400,
      code: 'SIG_CREDENTIALS_REQUIRED',
    });
  }

  const { apiUrl, timeoutMs } = config();
  const response = await fetchWithTimeout(
    `${apiUrl}/login`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    },
    timeoutMs
  );
  const data = parseJson(await response.text());
  if (!response.ok) {
    const message =
      response.status === 401
        ? 'Usuário ou senha do SIG inválidos.'
        : response.status === 403
          ? 'Seu usuário não pertence a um grupo autorizado no SIG.'
          : 'Não foi possível entrar no SIG. Tente novamente em alguns instantes.';
    throw new SigIntegrationError(message, {
      status: response.status === 401 || response.status === 403 ? response.status : 502,
      code: 'SIG_AUTH_FAILED',
    });
  }

  const accessToken = accessTokenFromResponse(data);
  if (!accessToken) {
    throw new SigIntegrationError('O SIG não retornou um token de acesso válido.', {
      status: 502,
      code: 'SIG_INVALID_AUTH_RESPONSE',
    });
  }
  return {
    accessToken,
    accessTokenExpiresAt: tokenExpiration(accessToken),
    refreshCookie: cookiePairFromResponse(response),
    user: userFromToken(accessToken),
  };
}

export async function refreshSigUserSession(refreshCookie) {
  if (!refreshCookie) {
    throw new SigIntegrationError('Sua sessão do SIG expirou. Entre novamente.', {
      status: 401,
      code: 'SIG_SESSION_EXPIRED',
    });
  }
  const { apiUrl, timeoutMs } = config();
  const response = await fetchWithTimeout(
    `${apiUrl}/refresh-token`,
    {
      method: 'POST',
      headers: {
        Cookie: refreshCookie,
        'Content-Type': 'application/json',
      },
    },
    timeoutMs
  );
  const data = parseJson(await response.text());
  const accessToken = accessTokenFromResponse(data);
  if (!response.ok || !accessToken) {
    throw new SigIntegrationError('Sua sessão do SIG expirou. Entre novamente.', {
      status: 401,
      code: 'SIG_SESSION_EXPIRED',
    });
  }
  return {
    accessToken,
    accessTokenExpiresAt: tokenExpiration(accessToken),
    refreshCookie: cookiePairFromResponse(response) || refreshCookie,
    user: userFromToken(accessToken),
  };
}

export async function logoutSigUser(refreshCookie) {
  if (!refreshCookie) return;
  const { apiUrl, timeoutMs } = config();
  try {
    await fetchWithTimeout(
      `${apiUrl}/logout`,
      { method: 'POST', headers: { Cookie: refreshCookie } },
      timeoutMs
    );
  } catch {
    // A sessão local será encerrada mesmo que o SIG esteja indisponível.
  }
}

async function sigRequest(accessToken, path, { method = 'GET', body } = {}) {
  const { apiUrl, timeoutMs } = config();
  const response = await fetchWithTimeout(
    `${apiUrl}${path}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    timeoutMs
  );
  const data = parseJson(await response.text());
  if (!response.ok) {
    const externalMessage = String(data.error || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 300);
    const message =
      response.status === 403
        ? 'Seu usuário não tem permissão para realizar esta operação no SIG.'
        : response.status === 401
          ? 'Sua sessão do SIG expirou. Entre novamente.'
          : externalMessage
            ? `O SIG recusou a operação: ${externalMessage}`
            : `O SIG recusou a operação (HTTP ${response.status}).`;
    throw new SigIntegrationError(message, {
      status: response.status >= 400 && response.status < 500 ? response.status : 502,
      code: response.status === 401 ? 'SIG_SESSION_EXPIRED' : `SIG_HTTP_${response.status}`,
    });
  }
  return data;
}

async function loadLookups(accessToken, cacheKey) {
  const cached = lookupsCaches.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const lookups = await sigRequest(accessToken, '/cases/lookups');
  if (
    !Array.isArray(lookups?.casos) ||
    !Array.isArray(lookups?.projetos) ||
    !Array.isArray(lookups?.sprints) ||
    !Array.isArray(lookups?.atividades)
  ) {
    throw new SigIntegrationError('O SIG retornou os cadastros auxiliares em formato inválido.', {
      status: 502,
      code: 'SIG_INVALID_LOOKUPS',
    });
  }
  lookupsCaches.set(cacheKey, {
    value: lookups,
    expiresAt: Date.now() + config().lookupsCacheMs,
  });
  return lookups;
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{Mn}+/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizeOriginCardCode(value) {
  const normalized = String(value || '').trim().replace(/^#/, '');
  if (!/^\d+$/.test(normalized)) {
    throw new SigIntegrationError(
      'O cenário não possui um código de card SIG válido para ser usado como RF de origem.',
      { status: 400, code: 'SIG_INVALID_ORIGIN_CARD' }
    );
  }
  return Number(normalized);
}

export function resolveCorrectiveLookups(lookups, sigCardCode, configuredActivityId = null) {
  const originCardId = normalizeOriginCardCode(sigCardCode);
  const originCard = lookups.casos.find((item) => Number(item.id) === originCardId);
  if (!originCard) {
    throw new SigIntegrationError(
      `O card de melhoria #${originCardId} não foi encontrado no SIG ou não está acessível para seu usuário.`,
      { status: 404, code: 'SIG_ORIGIN_CARD_NOT_FOUND' }
    );
  }
  if (!originCard.projetoId || !originCard.versaoId) {
    throw new SigIntegrationError(
      `O card de melhoria #${originCardId} não está associado simultaneamente a um projeto e a uma sprint no SIG.`,
      { status: 422, code: 'SIG_ORIGIN_WITHOUT_SPRINT' }
    );
  }

  const project = lookups.projetos.find((item) => Number(item.id) === Number(originCard.projetoId));
  const sprint = lookups.sprints.find((item) => Number(item.id) === Number(originCard.versaoId));
  if (!project || !sprint || Number(sprint.projetoId) !== Number(project.id)) {
    throw new SigIntegrationError(
      `Não foi possível confirmar o projeto e a sprint do card de melhoria #${originCardId}.`,
      { status: 422, code: 'SIG_ORIGIN_CONTEXT_INVALID' }
    );
  }

  const expectedActivity = normalizeText(CORRECTIVE_ACTIVITY_NAME);
  const activity = configuredActivityId
    ? lookups.atividades.find((item) => Number(item.id) === Number(configuredActivityId))
    : lookups.atividades.find((item) => normalizeText(item.nome) === expectedActivity);
  if (!activity) {
    throw new SigIntegrationError(
      `A atividade "${CORRECTIVE_ACTIVITY_NAME}" não foi encontrada no SIG.`,
      { status: 422, code: 'SIG_ACTIVITY_NOT_FOUND' }
    );
  }
  if (normalizeText(activity.nome) !== expectedActivity) {
    throw new SigIntegrationError(
      `A atividade configurada no SIG não corresponde a "${CORRECTIVE_ACTIVITY_NAME}".`,
      { status: 422, code: 'SIG_ACTIVITY_MISMATCH' }
    );
  }

  return { originCard, project, sprint, activity };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function textToParagraphs(value) {
  return String(value || '')
    .trim()
    .split(/\n{2,}/)
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function safeHttpUrl(value) {
  try {
    const parsed = new URL(String(value || '').trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : '';
  } catch {
    return '';
  }
}

export function buildSigDescriptionHtml(card, context) {
  const screenPath = String(context.screenPath || '').trim() || 'Não informado';
  const screenUrl = safeHttpUrl(context.screenUrl);
  const steps = Array.isArray(card.reproductionSteps)
    ? card.reproductionSteps.map((step) => String(step).trim()).filter(Boolean)
    : [];

  return [
    `<p><strong>Tela:</strong> ${escapeHtml(screenPath)}</p>`,
    screenUrl
      ? `<p><strong>URL:</strong> <a href="${escapeHtml(screenUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(screenUrl)}</a></p>`
      : '<p><strong>URL:</strong> Não informada</p>',
    '<h3>Descrição do Problema</h3>',
    textToParagraphs(card.problemDescription),
    '<h3>Passos para Reproduzir</h3>',
    `<ol>${steps.map((step) => `<li>${escapeHtml(step)}</li>`).join('')}</ol>`,
    '<h3>Resultado Atual</h3>',
    textToParagraphs(card.currentResult),
    '<h3>Resultado Esperado</h3>',
    textToParagraphs(card.expectedResult),
  ].join('');
}

export function buildCorrectivePayload(card, context, resolved) {
  return {
    CAS_RESUMO: String(card.title || '').trim(),
    CAS_DESCRICAO: buildSigDescriptionHtml(card, context),
    CAS_PASSOS_REPR: '',
    CAS_OBSERVACAO: '',
    CAS_INF_ADD: '',
    CAS_CAT: 1,
    CAS_PRIO: 2,
    CAS_STATUS: 1,
    CAS_PRIO_ORDEM: 0,
    CAS_COD_VERSAO: Number(resolved.sprint.id),
    COD_PROJETO: Number(resolved.project.id),
    COD_EPICO: null,
    CAS_STORY_POINT: null,
    CAS_COMPLEXIDADE: null,
    CAS_TEMPO_MAX: 0,
    CAS_INICIO_PREVISTO: null,
    CAS_TIPO_REQUISITO: null,
    CAS_N_RF: '',
    CAS_NUMERO_OS: '',
    COD_CASO_DEP: null,
    COD_CASO_ORIGEM_ERRO: Number(resolved.originCard.id),
    CAS_ORIGEM_CORRETIVA: 'T',
    CAS_FLAG_AUTORIZADO_DIR: 'N',
    CAS_DATA_AUTORIZACAO: null,
    FLAG_TESTA: 'N',
    FLAG_ATRIBU: 'N',
    CAS_URGENTE: 'N',
    CAS_PF_LOCAL: null,
    CAS_PF_ESTIMADA: null,
    CAS_PF_DEFLATOR: null,
    CAS_TIPO_CONTAGEM: null,
    CAS_PF_REAL: null,
    CAS_PF_APLICACAO: null,
    CAS_DIFERENCA_PERCENT: null,
    CAA_COD: Number(resolved.activity.id),
    IUC_COD: null,
    CAS_PERCENT_CONCLUSAO: 0,
    CAS_FUN_RESP: null,
  };
}

function validateCard(card) {
  if (!card || !String(card.title || '').trim()) {
    throw new SigIntegrationError('Revise o título da corretiva antes de publicar.', {
      status: 400,
      code: 'SIG_CARD_TITLE_REQUIRED',
    });
  }
  if (!String(card.problemDescription || '').trim()) {
    throw new SigIntegrationError('Revise a descrição da corretiva antes de publicar.', {
      status: 400,
      code: 'SIG_CARD_DESCRIPTION_REQUIRED',
    });
  }
  if (!Array.isArray(card.reproductionSteps) || card.reproductionSteps.every((step) => !String(step).trim())) {
    throw new SigIntegrationError('Informe ao menos um passo para reproduzir antes de publicar.', {
      status: 400,
      code: 'SIG_CARD_STEPS_REQUIRED',
    });
  }
  if (!String(card.currentResult || '').trim() || !String(card.expectedResult || '').trim()) {
    throw new SigIntegrationError('Revise os resultados atual e esperado antes de publicar.', {
      status: 400,
      code: 'SIG_CARD_RESULTS_REQUIRED',
    });
  }
}

async function doPublishCorrectiveCard(card, context, accessToken, userCacheKey) {
  validateCard(card);
  const lookups = await loadLookups(accessToken, userCacheKey);
  const resolved = resolveCorrectiveLookups(
    lookups,
    context.sigCardCode,
    config().activityId
  );
  const payload = buildCorrectivePayload(card, context, resolved);
  const created = await sigRequest(accessToken, '/cases', { method: 'POST', body: payload });
  const externalId = Number(created?.id);
  if (!externalId) {
    throw new SigIntegrationError(
      'O SIG recebeu a corretiva, mas não retornou o código do card criado. Verifique o Kanban antes de tentar novamente.',
      { status: 502, code: 'SIG_INVALID_CREATE_RESPONSE' }
    );
  }

  const { webUrl } = config();
  return {
    externalId: String(externalId),
    url: `${webUrl}/projects/${resolved.project.id}/sprints/${resolved.sprint.id}/requisitos/${externalId}`,
    originCardId: String(resolved.originCard.id),
    project: { id: String(resolved.project.id), name: resolved.project.nome },
    sprint: { id: String(resolved.sprint.id), name: resolved.sprint.nome },
    activity: { id: String(resolved.activity.id), name: resolved.activity.nome },
  };
}

export async function publishCorrectiveCard(
  card,
  context,
  requestId,
  accessToken,
  userCacheKey
) {
  const key = String(requestId || '').trim();
  if (!/^[a-zA-Z0-9._:-]{8,120}$/.test(key)) {
    throw new SigIntegrationError('Identificador da publicação inválido. Reabra a corretiva e tente novamente.', {
      status: 400,
      code: 'SIG_INVALID_REQUEST_ID',
    });
  }

  if (!accessToken) {
    throw new SigIntegrationError('Sua sessão do SIG expirou. Entre novamente.', {
      status: 401,
      code: 'SIG_SESSION_EXPIRED',
    });
  }
  const scopedKey = `${String(userCacheKey || 'user')}:${key}`;
  if (publicationRequests.has(scopedKey)) return publicationRequests.get(scopedKey);
  const publication = doPublishCorrectiveCard(
    card,
    context,
    accessToken,
    String(userCacheKey || 'user')
  );
  publicationRequests.set(scopedKey, publication);
  try {
    const result = await publication;
    setTimeout(() => publicationRequests.delete(scopedKey), 60 * 60_000).unref?.();
    return result;
  } catch (error) {
    publicationRequests.delete(scopedKey);
    throw error;
  }
}
