import { Router } from 'express';
import {
  authenticateSigUser,
  logoutSigUser,
  SigIntegrationError,
} from '../services/sigClient.js';
import {
  clearAuthCookie,
  clearLoginFailures,
  createAuthSession,
  destroyAuthSession,
  loginRateLimit,
  rawAuthSession,
  recordLoginFailure,
  setAuthCookie,
  validAuthSession,
} from '../services/authSessions.js';

const router = Router();

router.post('/login', async (req, res, next) => {
  const rateLimit = loginRateLimit(req);
  if (!rateLimit.allowed) {
    res.set('Retry-After', String(rateLimit.retryAfterSeconds));
    return res.status(429).json({
      ok: false,
      code: 'LOGIN_RATE_LIMIT',
      error: 'Muitas tentativas de login. Aguarde alguns minutos e tente novamente.',
    });
  }

  try {
    const { username, password } = req.body || {};
    const sigSession = await authenticateSigUser(username, password);
    clearLoginFailures(rateLimit.key);
    const previous = rawAuthSession(req);
    if (previous) destroyAuthSession(previous.id);
    const session = createAuthSession(sigSession);
    setAuthCookie(res, session.id);
    return res.json({ ok: true, user: session.user });
  } catch (error) {
    if (error instanceof SigIntegrationError && error.code === 'SIG_AUTH_FAILED') {
      recordLoginFailure(rateLimit.key);
    }
    return next(error);
  }
});

router.get('/session', async (req, res, next) => {
  try {
    const session = await validAuthSession(req);
    if (!session) {
      clearAuthCookie(res);
      return res.status(401).json({
        ok: false,
        code: 'AUTH_REQUIRED',
        error: 'Entre com seu usuário do SIG.',
      });
    }
    return res.json({ ok: true, user: session.user });
  } catch (error) {
    return next(error);
  }
});

router.post('/logout', async (req, res) => {
  const session = rawAuthSession(req);
  if (session) {
    destroyAuthSession(session.id);
    await logoutSigUser(session.refreshCookie);
  }
  clearAuthCookie(res);
  return res.json({ ok: true });
});

export default router;
