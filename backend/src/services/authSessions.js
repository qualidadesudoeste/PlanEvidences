import { randomBytes } from 'node:crypto';
import { refreshSigUserSession } from './sigClient.js';

const sessions = new Map();
const failedLogins = new Map();

const COOKIE_NAME =
  String(process.env.SESSION_COOKIE_NAME || '').trim() || 'planevidences_session';
const SESSION_TTL_MS =
  Math.max(1, Number(process.env.SESSION_TTL_HOURS) || 8) * 60 * 60_000;
const LOGIN_WINDOW_MS = 15 * 60_000;
const MAX_LOGIN_FAILURES = 5;

function cookieSecure() {
  return String(process.env.SESSION_COOKIE_SECURE || '').toLowerCase() === 'true';
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: cookieSecure(),
    path: '/',
    maxAge: SESSION_TTL_MS,
  };
}

function parseCookies(header) {
  return String(header || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const separator = part.indexOf('=');
      if (separator <= 0) return cookies;
      const name = part.slice(0, separator).trim();
      const value = part.slice(separator + 1).trim();
      try {
        cookies[name] = decodeURIComponent(value);
      } catch {
        cookies[name] = value;
      }
      return cookies;
    }, {});
}

export function createAuthSession(sigSession) {
  const id = randomBytes(32).toString('base64url');
  const now = Date.now();
  const session = {
    id,
    ...sigSession,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
    lastSeenAt: now,
  };
  sessions.set(id, session);
  return session;
}

export function setAuthCookie(res, sessionId) {
  res.cookie(COOKIE_NAME, sessionId, cookieOptions());
}

export function clearAuthCookie(res) {
  const { maxAge: _maxAge, ...options } = cookieOptions();
  res.clearCookie(COOKIE_NAME, options);
}

export function destroyAuthSession(sessionId) {
  if (sessionId) sessions.delete(sessionId);
}

function sessionIdFromRequest(req) {
  return parseCookies(req.headers.cookie)[COOKIE_NAME] || '';
}

export function rawAuthSession(req) {
  const id = sessionIdFromRequest(req);
  return id ? sessions.get(id) || null : null;
}

export async function validAuthSession(req) {
  const id = sessionIdFromRequest(req);
  const session = id ? sessions.get(id) : null;
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(id);
    return null;
  }

  if (session.accessTokenExpiresAt <= Date.now() + 60_000) {
    try {
      const refreshed = await refreshSigUserSession(session.refreshCookie);
      Object.assign(session, refreshed);
    } catch {
      sessions.delete(id);
      return null;
    }
  }
  session.lastSeenAt = Date.now();
  return session;
}

export async function requireAuth(req, res, next) {
  try {
    const session = await validAuthSession(req);
    if (!session) {
      clearAuthCookie(res);
      return res.status(401).json({
        ok: false,
        code: 'AUTH_REQUIRED',
        error: 'Sua sessão expirou. Entre novamente com seu usuário do SIG.',
      });
    }
    req.authSession = session;
    return next();
  } catch (error) {
    return next(error);
  }
}

function loginKey(req) {
  return String(req.ip || req.socket?.remoteAddress || 'unknown');
}

export function loginRateLimit(req) {
  const key = loginKey(req);
  const entry = failedLogins.get(key);
  if (!entry || entry.expiresAt <= Date.now()) {
    failedLogins.delete(key);
    return { allowed: true, key };
  }
  return {
    allowed: entry.count < MAX_LOGIN_FAILURES,
    key,
    retryAfterSeconds: Math.max(1, Math.ceil((entry.expiresAt - Date.now()) / 1000)),
  };
}

export function recordLoginFailure(key) {
  const current = failedLogins.get(key);
  if (!current || current.expiresAt <= Date.now()) {
    failedLogins.set(key, { count: 1, expiresAt: Date.now() + LOGIN_WINDOW_MS });
    return;
  }
  current.count += 1;
}

export function clearLoginFailures(key) {
  failedLogins.delete(key);
}

setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(id);
  }
  for (const [key, entry] of failedLogins) {
    if (entry.expiresAt <= now) failedLogins.delete(key);
  }
}, 15 * 60_000).unref?.();

