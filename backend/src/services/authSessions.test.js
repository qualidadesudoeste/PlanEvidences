import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAuthSession,
  destroyAuthSession,
  rawAuthSession,
  requireAuth,
  setAuthCookie,
  validAuthSession,
} from './authSessions.js';

function responseDouble() {
  return {
    statusCode: 200,
    body: null,
    cookieValue: '',
    cookieOptions: null,
    cookie(_name, value, options) {
      this.cookieValue = value;
      this.cookieOptions = options;
    },
    clearCookie() {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test('cria cookie HttpOnly e recupera uma sessão sem armazenar senha', async () => {
  const session = createAuthSession({
    accessToken: 'temporary-token',
    accessTokenExpiresAt: Date.now() + 10 * 60_000,
    refreshCookie: 'sig_refresh=temporary-refresh',
    user: {
      name: 'QA Teste',
      username: 'qa.teste',
      userId: '42',
      groups: ['ANALISTAS QA'],
      pesCod: null,
      isAdmin: false,
    },
  });
  const res = responseDouble();
  setAuthCookie(res, session.id);

  assert.equal(res.cookieOptions.httpOnly, true);
  assert.equal(res.cookieOptions.sameSite, 'strict');
  assert.equal('password' in session, false);

  const req = { headers: { cookie: `planevidences_session=${res.cookieValue}` } };
  assert.equal(rawAuthSession(req)?.id, session.id);
  assert.equal((await validAuthSession(req))?.user.username, 'qa.teste');
  destroyAuthSession(session.id);
});

test('middleware recusa API sem sessão autenticada', async () => {
  const req = { headers: {}, socket: {} };
  const res = responseDouble();
  let nextCalled = false;
  await requireAuth(req, res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, 'AUTH_REQUIRED');
});
