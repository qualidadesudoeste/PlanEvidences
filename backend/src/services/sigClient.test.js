import test from 'node:test';
import assert from 'node:assert/strict';
import {
  authenticateSigUser,
  buildCorrectivePayload,
  buildSigDescriptionHtml,
  publishCorrectiveCard,
  refreshSigUserSession,
  resolveCorrectiveLookups,
} from './sigClient.js';

const lookups = {
  casos: [
    {
      id: 113684,
      nome: '#113684 - Card de melhoria',
      projetoId: 438,
      versaoId: 20440,
    },
  ],
  projetos: [{ id: 438, nome: 'Migração Codecon - IA' }],
  sprints: [{ id: 20440, nome: 'Cálculo', projetoId: 438 }],
  atividades: [{ id: 10, nome: 'Retrabalho / Correção de erros', pfEstimado: 0 }],
};

const card = {
  title: '[HU 68] - Pedidos de Cálculo: Painel não distribui o pedido',
  problemDescription: 'O sistema aceita <script>alert(1)</script> como conteúdo.',
  reproductionSteps: ['Acessar o painel', 'Selecionar o pedido'],
  currentResult: 'O pedido permanece sem responsável.',
  expectedResult: 'O pedido deve ser distribuído para um responsável.',
};

const context = {
  sigCardCode: '113684',
  screenPath: 'Pedidos de Cálculo > Triagem',
  screenUrl: 'https://sistema.exemplo.local/triagem?grupo=1&tipo=qa',
};

test('resolve projeto, sprint, atividade e card de origem pelo próprio card do SIG', () => {
  const resolved = resolveCorrectiveLookups(lookups, '#113684');
  assert.equal(resolved.originCard.id, 113684);
  assert.equal(resolved.project.id, 438);
  assert.equal(resolved.sprint.id, 20440);
  assert.equal(resolved.activity.id, 10);
});

test('gera descrição HTML segura e estruturada para o editor rico do SIG', () => {
  const html = buildSigDescriptionHtml(card, context);
  assert.match(html, /<h3>Descrição do Problema<\/h3>/);
  assert.match(html, /<ol><li>Acessar o painel<\/li><li>Selecionar o pedido<\/li><\/ol>/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /grupo=1&amp;tipo=qa/);
});

test('fixa as regras obrigatórias e herda projeto e sprint do card de melhoria', () => {
  const resolved = resolveCorrectiveLookups(lookups, '113684', 10);
  const payload = buildCorrectivePayload(card, context, resolved);
  assert.equal(payload.CAS_CAT, 1);
  assert.equal(payload.CAS_ORIGEM_CORRETIVA, 'T');
  assert.equal(payload.CAS_TEMPO_MAX, 0);
  assert.equal(payload.CAA_COD, 10);
  assert.equal(payload.COD_CASO_ORIGEM_ERRO, 113684);
  assert.equal(payload.COD_PROJETO, 438);
  assert.equal(payload.CAS_COD_VERSAO, 20440);
  assert.equal(payload.CAS_STATUS, 1);
  assert.equal(payload.CAS_PRIO, 2);
});

test('autentica o usuário no SIG e expõe somente o perfil, token e cookie temporários', async () => {
  const originalFetch = global.fetch;
  const tokenPayload = Buffer.from(
    JSON.stringify({
      exp: Math.floor(Date.now() / 1000) + 3600,
      name: 'QA Teste',
      username: 'qa.teste',
      userId: 42,
      groups: ['ANALISTAS QA'],
    })
  ).toString('base64url');
  const fakeToken = `header.${tokenPayload}.signature`;

  global.fetch = async (_url, options = {}) => {
    assert.deepEqual(JSON.parse(options.body), {
      username: 'qa.teste',
      password: 'senha-temporaria',
    });
    return new Response(JSON.stringify({ access_token: fakeToken }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': 'sig_refresh=refresh-value; Path=/; HttpOnly; SameSite=Lax',
      },
    });
  };

  try {
    const session = await authenticateSigUser('qa.teste', 'senha-temporaria');
    assert.equal(session.accessToken, fakeToken);
    assert.equal(session.refreshCookie, 'sig_refresh=refresh-value');
    assert.equal(session.user.name, 'QA Teste');
    assert.equal(session.user.username, 'qa.teste');
    assert.equal(session.user.userId, '42');
    assert.deepEqual(session.user.groups, ['ANALISTAS QA']);
    assert.equal('password' in session, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test('renova o token usando somente o cookie de atualização do SIG', async () => {
  const originalFetch = global.fetch;
  const tokenPayload = Buffer.from(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600, username: 'qa.teste' })
  ).toString('base64url');
  const fakeToken = `header.${tokenPayload}.signature`;
  global.fetch = async (url, options = {}) => {
    assert.match(String(url), /\/refresh-token$/);
    assert.equal(options.headers.Cookie, 'sig_refresh=old-value');
    return new Response(JSON.stringify({ access_token: fakeToken }), {
      status: 200,
      headers: { 'Set-Cookie': 'sig_refresh=new-value; Path=/; HttpOnly' },
    });
  };
  try {
    const refreshed = await refreshSigUserSession('sig_refresh=old-value');
    assert.equal(refreshed.refreshCookie, 'sig_refresh=new-value');
    assert.equal(refreshed.accessToken, fakeToken);
  } finally {
    global.fetch = originalFetch;
  }
});

test('publica com o token do usuário conectado sem depender de nomes de projeto ou sprint', async () => {
  const originalFetch = global.fetch;
  const originalEnv = {
    activityId: process.env.SIG_CORRECTIVE_ACTIVITY_ID,
  };
  const requests = [];
  const tokenPayload = Buffer.from(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })
  ).toString('base64url');
  const fakeToken = `header.${tokenPayload}.signature`;

  delete process.env.SIG_CORRECTIVE_ACTIVITY_ID;

  global.fetch = async (url, options = {}) => {
    requests.push({
      url: String(url),
      method: options.method || 'GET',
      body: options.body,
      authorization: options.headers?.Authorization,
    });
    if (String(url).endsWith('/cases/lookups')) {
      return new Response(JSON.stringify(lookups), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (String(url).endsWith('/cases') && options.method === 'POST') {
      return new Response(JSON.stringify({ id: 120001 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ error: 'Unexpected request' }), { status: 500 });
  };

  try {
    const publication = await publishCorrectiveCard(
      card,
      context,
      'test-publication-113684',
      fakeToken,
      'test-user-42'
    );
    assert.equal(publication.externalId, '120001');
    assert.equal(publication.originCardId, '113684');
    assert.equal(publication.project.id, '438');
    assert.equal(publication.sprint.id, '20440');
    assert.equal(publication.activity.id, '10');

    const createRequest = requests.find(
      (request) => request.url.endsWith('/cases') && request.method === 'POST'
    );
    assert.ok(createRequest);
    assert.equal(createRequest.authorization, `Bearer ${fakeToken}`);
    const sentPayload = JSON.parse(createRequest.body);
    assert.equal(sentPayload.COD_PROJETO, 438);
    assert.equal(sentPayload.CAS_COD_VERSAO, 20440);
    assert.equal(sentPayload.COD_CASO_ORIGEM_ERRO, 113684);
  } finally {
    global.fetch = originalFetch;
    if (originalEnv.activityId === undefined) delete process.env.SIG_CORRECTIVE_ACTIVITY_ID;
    else process.env.SIG_CORRECTIVE_ACTIVITY_ID = originalEnv.activityId;
  }
});
