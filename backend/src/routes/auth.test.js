import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import authRouter from './auth.js';
import { requireAuth } from '../services/authSessions.js';

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
}

function close(server) {
  return new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
}

test('login do SIG libera a API e logout encerra a sessão local', async () => {
  const originalSigApiUrl = process.env.SIG_API_URL;
  const tokenPayload = Buffer.from(
    JSON.stringify({
      exp: Math.floor(Date.now() / 1000) + 3600,
      name: 'QA Integração',
      username: 'qa.integracao',
      userId: 77,
      groups: ['ANALISTAS QA'],
    })
  ).toString('base64url');
  const fakeToken = `header.${tokenPayload}.signature`;

  const fakeSig = http.createServer((req, res) => {
    if (req.url === '/login' && req.method === 'POST') {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Set-Cookie': 'sig_refresh=fake-refresh; Path=/; HttpOnly',
      });
      res.end(JSON.stringify({ access_token: fakeToken }));
      return;
    }
    if (req.url === '/logout' && req.method === 'POST') {
      res.writeHead(204);
      res.end();
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await listen(fakeSig);
  const fakeSigAddress = fakeSig.address();
  process.env.SIG_API_URL = `http://127.0.0.1:${fakeSigAddress.port}`;

  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);
  app.use('/api', requireAuth);
  app.get('/api/protected', (req, res) => {
    res.json({ username: req.authSession.user.username });
  });
  const appServer = http.createServer(app);
  await listen(appServer);
  const appAddress = appServer.address();
  const baseUrl = `http://127.0.0.1:${appAddress.port}`;

  try {
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'qa.integracao', password: 'temporaria' }),
    });
    assert.equal(login.status, 200);
    const loginBody = await login.json();
    assert.equal(loginBody.user.username, 'qa.integracao');
    const cookie = login.headers.get('set-cookie').split(';', 1)[0];
    assert.match(cookie, /^planevidences_session=/);
    assert.doesNotMatch(cookie, /temporaria/);

    const protectedResponse = await fetch(`${baseUrl}/api/protected`, {
      headers: { Cookie: cookie },
    });
    assert.equal(protectedResponse.status, 200);
    assert.equal((await protectedResponse.json()).username, 'qa.integracao');

    const logout = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    assert.equal(logout.status, 200);

    const afterLogout = await fetch(`${baseUrl}/api/protected`, {
      headers: { Cookie: cookie },
    });
    assert.equal(afterLogout.status, 401);
  } finally {
    await close(appServer);
    await close(fakeSig);
    if (originalSigApiUrl === undefined) delete process.env.SIG_API_URL;
    else process.env.SIG_API_URL = originalSigApiUrl;
  }
});
