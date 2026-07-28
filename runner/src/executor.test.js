import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import {
  actionMayTriggerProcessing,
  authenticationObservationState,
  authenticationSucceeded,
  captureScenarioEvidence,
  captureVisualFrame,
  ensureAllowedNavigation,
  ensureObservationOrigin,
  hasLoadingIndicator,
  isLoginSubmission,
  isMcpRequestTimeout,
  loginCredentialTargets,
  loginSubmissionAction,
  navigateWithRecovery,
  normalizeBrowserToolArguments,
  redactSecrets,
  safeHistoryArguments,
  scenarioStartUrl,
  serverRequest,
  substituteSecrets,
  validateSecretPlacement,
  waitForAuthenticationResponse,
  waitForUiSettled,
} from './executor.js';

const secrets = { username: 'usuario.teste', password: 'test-passphrase-123' };

test('substitui os marcadores somente no runner e remove credenciais do texto enviado', () => {
  const argumentsWithMarkers = {
    fields: [
      { name: 'Usuário', value: '{{USERNAME}}' },
      { name: 'Senha', value: '{{PASSWORD}}' },
    ],
  };
  const actual = substituteSecrets(argumentsWithMarkers, secrets);
  assert.equal(actual.fields[0].value, secrets.username);
  assert.equal(actual.fields[1].value, secrets.password);

  const safe = redactSecrets(
    `Usuário ${secrets.username}; senha ${secrets.password}`,
    secrets
  );
  assert.equal(safe.includes(secrets.username), false);
  assert.equal(safe.includes(secrets.password), false);
});

test('permite credenciais somente uma vez em campos reconhecidos do login', () => {
  const observation = '### Page\n- Page URL: https://cliente.local/login';
  const usage = { username: false, password: false };
  const allowed = validateSecretPlacement({
    tool: 'browser_fill_form',
    args: {
      fields: [
        { name: 'Usuário', element: 'Campo usuário', value: '{{USERNAME}}' },
        { name: 'Senha', element: 'Campo senha', value: '{{PASSWORD}}' },
      ],
    },
    observation,
    loginUrl: 'https://cliente.local/login',
    usage,
  });
  assert.deepEqual(allowed, { usesUsername: true, usesPassword: true });
  assert.throws(
    () =>
      validateSecretPlacement({
        tool: 'browser_type',
        args: { element: 'Observação', text: '{{PASSWORD}}' },
        observation,
        loginUrl: 'https://cliente.local/login',
        usage: { username: false, password: false },
      }),
    /não parece ser de senha/
  );
  assert.throws(
    () =>
      validateSecretPlacement({
        tool: 'browser_type',
        args: { element: 'Senha', text: '{{PASSWORD}}' },
        observation,
        loginUrl: 'https://cliente.local/login',
        usage: { username: false, password: true },
      }),
    /não pode ser reutilizada/
  );
});

test('protege valores digitados no histórico e bloqueia navegação fora da origem', () => {
  assert.deepEqual(safeHistoryArguments({ text: 'dado sensível', value: '123' }), {
    text: '[texto protegido]',
    value: '[valor protegido]',
  });
  assert.doesNotThrow(() =>
    ensureAllowedNavigation(
      'browser_navigate',
      { url: 'https://cliente.local/cadastro' },
      ['https://cliente.local']
    )
  );
  assert.throws(
    () =>
      ensureAllowedNavigation(
        'browser_navigate',
        { url: 'https://externo.example/' },
        ['https://cliente.local']
      ),
    /origem não autorizada/
  );
  assert.throws(
    () =>
      ensureObservationOrigin(
        '### Page\n- Page URL: https://externo.example/phishing',
        ['https://cliente.local']
      ),
    /saiu das origens autorizadas/
  );
});

test('repete comunicação transitória com o servidor sem interromper o lote', async () => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts += 1;
    if (attempts === 1) throw new TypeError('fetch failed');
    return new Response(JSON.stringify({ ok: true, run: { id: 'run-1' } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  try {
    const data = await serverRequest(
      {
        serverUrl: 'http://planevidences.local',
        runnerToken: 'token',
      },
      '/api/automation-runner/runs/run-1'
    );
    assert.equal(attempts, 2);
    assert.equal(data.run.id, 'run-1');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('captura e envia o print final de um cenário aprovado', async () => {
  const originalFetch = globalThis.fetch;
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'planevidences-approved-'));
  let screenshotName = '';
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.method, 'POST');
    return new Response(
      JSON.stringify({
        ok: true,
        evidence: {
          id: 'evidence-1',
          type: 'screenshot',
          originalName: screenshotName,
          filename: 'stored.png',
          key: 'automation/run/scenario/stored.png',
          url: '/storage/stored.png',
          size: 3,
          mimeType: 'image/png',
        },
      }),
      { status: 201, headers: { 'Content-Type': 'application/json' } }
    );
  };
  const browser = {
    call: async (tool, args) => {
      assert.equal(tool, 'browser_take_screenshot');
      screenshotName = args.filename;
      await writeFile(path.join(outputDir, screenshotName), Buffer.from('png'));
    },
  };
  try {
    const evidence = await captureScenarioEvidence(
      browser,
      {
        serverUrl: 'http://planevidences.local',
        runnerToken: 'token',
        runId: 'run-1',
      },
      { id: 'scenario-1', code: 'CT-001' },
      outputDir,
      'aprovado'
    );
    assert.match(screenshotName, /^aprovado-CT-001-/);
    assert.equal(evidence.length, 1);
    assert.equal(evidence[0].id, 'evidence-1');
  } finally {
    globalThis.fetch = originalFetch;
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('preserva a página autenticada quando a URL base informada é a própria tela de login', () => {
  assert.equal(
    scenarioStartUrl({
      run: {
        target: {
          baseUrl: 'https://cliente.local/portal/login',
          loginUrl: 'https://cliente.local/portal/login',
        },
      },
      authenticatedUrl: 'https://cliente.local/portal/inicio',
    }),
    'https://cliente.local/portal/inicio'
  );
  assert.equal(
    scenarioStartUrl({
      run: {
        target: {
          baseUrl: 'https://cliente.local/portal',
          loginUrl: 'https://cliente.local/portal/login',
        },
      },
      authenticatedUrl: 'https://cliente.local/portal/inicio',
    }),
    'https://cliente.local/portal'
  );
});

test('reconhece formulário de login e confirma a sessão após o formulário desaparecer', () => {
  const login = authenticationObservationState(`
    ### Page
    - Page URL: https://cliente.local/login
    - textbox "Usuário" [ref=e1]
    - textbox "Senha" [ref=e2]
    - button "Entrar" [ref=e3]
  `);
  assert.equal(login.loginFormVisible, true);
  assert.equal(login.hasPasswordField, true);

  assert.equal(
    authenticationSucceeded({
      observation: `
        ### Page
        - Page URL: https://cliente.local/inicio
        - heading "Bem-vindo" [ref=e10]
        - navigation "Menu principal" [ref=e11]
      `,
      credentialUsage: { username: true, password: true },
      submitted: true,
    }),
    true
  );
});

test('não confirma login com credencial recusada ou desafio adicional', () => {
  assert.equal(
    authenticationSucceeded({
      observation: `
        ### Page
        - Page URL: https://cliente.local/login
        - text "Usuário ou senha inválido"
        - textbox "Senha" [ref=e2]
      `,
      credentialUsage: { username: true, password: true },
      submitted: true,
    }),
    false
  );
  assert.equal(
    authenticationObservationState(`
      ### Page
      - Page URL: https://cliente.local/mfa
      - textbox "Código de verificação" [ref=e9]
    `).hasAdditionalChallenge,
    true
  );
  assert.equal(
    authenticationObservationState(`
      ### Page
      - text "Informe um CPF válido"
      - textbox "CPF" [ref=e1]
      - textbox "Senha" [ref=e2]
    `).hasLoginError,
    true
  );
});

test('aguarda a transição assíncrona depois de enviar o login', async () => {
  let snapshots = 0;
  const browser = {
    hasTool: (name) => name === 'browser_snapshot',
    call: async () => {
      snapshots += 1;
      return {
        content: [
          {
            type: 'text',
            text: `
              ### Page
              - Page URL: https://cliente.local/inicio
              - heading "Bem-vindo" [ref=e10]
            `,
          },
        ],
      };
    },
    readResultText: async (result) => result?.content?.[0]?.text || '',
  };
  const result = await waitForAuthenticationResponse({
    browser,
    secrets,
    allowedOrigins: ['https://cliente.local'],
    observation: `
      ### Page
      - Page URL: https://cliente.local/login
      - textbox "CPF" [ref=e1]
      - textbox "Senha" [ref=e2]
      - button "Entrar" [ref=e3]
    `,
    attempts: 2,
    intervalMs: 1,
  });
  assert.equal(snapshots, 3);
  assert.match(result, /Bem-vindo/);
});

test('reconhece barras e textos de processamento após ações assíncronas', () => {
  assert.equal(
    hasLoadingIndicator('- progressbar "Carregando" [ref=e1]'),
    true
  );
  assert.equal(
    hasLoadingIndicator('- button "Entrando..." [ref=e2]'),
    true
  );
  assert.equal(
    hasLoadingIndicator('- progressbar "Vagas preenchidas: 70%" [ref=e3]'),
    false
  );
  assert.equal(hasLoadingIndicator('- heading "Consulta concluída"'), false);
  assert.equal(actionMayTriggerProcessing('browser_click', {}, 'Clicar em Salvar'), true);
  assert.equal(
    actionMayTriggerProcessing('browser_click', {}, 'Clicar em botão Notificações'),
    false
  );
  assert.equal(
    actionMayTriggerProcessing('browser_press_key', { key: 'Enter' }, ''),
    true
  );
  assert.equal(actionMayTriggerProcessing('browser_type', { submit: false }, ''), false);
  assert.equal(
    actionMayTriggerProcessing(
      'browser_type',
      { element: 'campo Pesquisar', submit: false },
      'Digitar em campo Pesquisar'
    ),
    false
  );
});

test('só libera a próxima decisão depois que o carregamento desaparece e a tela estabiliza', async () => {
  const observations = [
    '- progressbar "Carregando" [ref=e1]\n- button "Salvando..." [ref=e2]',
    '- heading "Registro salvo" [ref=e3]',
    '- heading "Registro salvo" [ref=e4]',
    '- heading "Registro salvo" [ref=e5]',
  ];
  let index = 0;
  const browser = {
    hasTool: (name) => name === 'browser_snapshot',
    call: async () => ({
      content: [{ type: 'text', text: observations[Math.min(index++, observations.length - 1)] }],
    }),
    readResultText: async (result) => result?.content?.[0]?.text || '',
  };
  const settled = await waitForUiSettled({
    browser,
    secrets,
    allowedOrigins: ['https://cliente.local'],
    observation: observations[0],
    maxWaitMs: 1_000,
    pollMs: 1,
    stablePolls: 1,
  });
  assert.equal(settled.loadingSeen, true);
  assert.equal(settled.timedOut, false);
  assert.match(settled.observation, /Registro salvo/);
});

test('detecta a barra visual no DOM mesmo quando ela não aparece no snapshot acessível', async () => {
  let evaluations = 0;
  const browser = {
    hasTool: (name) => ['browser_snapshot', 'browser_evaluate'].includes(name),
    call: async (name) => {
      if (name === 'browser_evaluate') {
        evaluations += 1;
        return {
          content: [{ type: 'text', text: evaluations < 3 ? '### Result\ntrue' : '### Result\nfalse' }],
        };
      }
      return {
        content: [{ type: 'text', text: '- heading "Tela estável" [ref=e1]' }],
      };
    },
    readResultText: async (result) => result?.content?.[0]?.text || '',
  };
  const settled = await waitForUiSettled({
    browser,
    secrets,
    allowedOrigins: ['https://cliente.local'],
    observation: '- heading "Tela estável" [ref=e1]',
    maxWaitMs: 1_000,
    pollMs: 1,
    stablePolls: 1,
  });
  assert.equal(evaluations, 3);
  assert.equal(settled.loadingSeen, true);
  assert.equal(settled.timedOut, false);
});

test('identifica clique e Enter como envio do formulário de login', () => {
  assert.equal(
    isLoginSubmission('browser_click', { element: 'Botão Entrar', target: 'e3' }, 'Entrar'),
    true
  );
  assert.equal(isLoginSubmission('browser_press_key', { key: 'Enter' }), true);
  assert.equal(isLoginSubmission('browser_click', { element: 'Mostrar senha' }), false);
});

test('converte referências antigas do modelo para o formato atual do Playwright MCP', () => {
  assert.deepEqual(
    normalizeBrowserToolArguments('browser_fill_form', {
      fields: [
        { name: 'Usuário', type: 'text', ref: 'e10', value: '{{USERNAME}}' },
        { name: 'Senha', type: 'password', ref: 'e11', value: '{{PASSWORD}}' },
      ],
    }),
    {
      fields: [
        { name: 'Usuário', type: 'textbox', target: 'e10', value: '{{USERNAME}}' },
        { name: 'Senha', type: 'textbox', target: 'e11', value: '{{PASSWORD}}' },
      ],
    }
  );
});

test('seleciona o botão de entrada após preencher as credenciais', () => {
  assert.deepEqual(
    loginSubmissionAction(`
      - textbox "Usuário" [ref=e10]
      - textbox "Senha" [ref=e11]
      - button "Entrar no sistema" [ref=e12]
    `),
    {
      tool: 'browser_click',
      arguments: { element: 'Botão Entrar no sistema', target: 'e12' },
      step: 'Clicar em Entrar no sistema',
    }
  );
  assert.deepEqual(loginSubmissionAction('- textbox "Senha" [ref=e11]'), {
    tool: 'browser_press_key',
    arguments: { key: 'Enter' },
    step: 'Pressionar Enter para entrar',
  });
});

test('identifica diretamente os campos de usuário e senha no snapshot', () => {
  assert.deepEqual(
    loginCredentialTargets(`
      - textbox "Usuário de acesso" [ref=e20]
      - textbox "Senha" [ref=e21]
      - button "Entrar" [ref=e22]
    `),
    {
      username: {
        name: 'Usuário de acesso',
        target: 'e20',
        normalizedName: 'usuario de acesso',
      },
      password: {
        name: 'Senha',
        target: 'e21',
        normalizedName: 'senha',
      },
    }
  );
  assert.equal(
    loginCredentialTargets('- textbox "Pesquisa" [ref=e30]'),
    null
  );
});

test('identifica campos de login sem nome acessível pelos rótulos próximos', () => {
  assert.deepEqual(
    loginCredentialTargets(`
      - text: Usuário ou Matrícula
      - textbox [ref=e40]
      - text: Senha
      - textbox [ref=e41]
      - button "Entrar" [ref=e42]
    `),
    {
      username: {
        name: 'Usuário ou matrícula',
        target: 'e40',
        normalizedName: 'usuario ou matricula',
      },
      password: {
        name: 'Senha',
        target: 'e41',
        normalizedName: 'senha',
      },
    }
  );
});

test('usa a ordem dos dois campos quando a tela de login não fornece rótulos acessíveis', () => {
  const targets = loginCredentialTargets(`
    - heading "Acesse sua conta"
    - textbox [ref=e50]
    - textbox [ref=e51]
    - button "Entrar" [ref=e52]
  `);
  assert.equal(targets?.username.target, 'e50');
  assert.equal(targets?.password.target, 'e51');
});

test('recusa preenchimento genérico da IA sem marcadores protegidos durante o login', () => {
  assert.throws(
    () =>
      validateSecretPlacement({
        tool: 'browser_fill_form',
        args: {
          fields: [
            { name: 'Usuário', target: 'e1', value: '' },
            { name: 'Senha', target: 'e2', value: '' },
          ],
        },
        observation: '### Page\n- Page URL: https://cliente.local/login',
        loginUrl: 'https://cliente.local/login',
        usage: { username: false, password: false },
        requireCredentialMarker: true,
      }),
    /marcadores protegidos/
  );
});

test('recupera o snapshot quando a navegação excede o tempo mas a página abriu', async () => {
  const browser = {
    hasTool: (name) => name === 'browser_snapshot',
    call: async (name) => {
      if (name === 'browser_navigate') {
        throw new Error('MCP error -32001: Request timed out');
      }
      return {
        content: [
          {
            type: 'text',
            text: '### Page\n- Page URL: https://cliente.local/login\n- textbox "Usuário" [ref=e1]',
          },
        ],
      };
    },
    readResultText: async (result) => result?.content?.[0]?.text || '',
  };

  assert.equal(isMcpRequestTimeout(new Error('Request timed out')), true);
  const navigation = await navigateWithRecovery({
    browser,
    url: 'https://cliente.local/login',
    secrets,
  });
  assert.equal(navigation.recovered, true);
  assert.match(navigation.observation, /textbox "Usuário"/);
});

test('explica URL ou VPN quando nem o snapshot alcança o sistema', async () => {
  const browser = {
    hasTool: (name) => name === 'browser_snapshot',
    call: async (name) => {
      if (name === 'browser_navigate') {
        throw new Error('MCP error -32001: Request timed out');
      }
      return {
        content: [{ type: 'text', text: '### Page\n- Page URL: about:blank' }],
      };
    },
    readResultText: async (result) => result?.content?.[0]?.text || '',
  };

  await assert.rejects(
    navigateWithRecovery({
      browser,
      url: 'https://cliente.local/login',
      secrets,
    }),
    (error) =>
      error.code === 'AUTOMATION_NAVIGATION_TIMEOUT' &&
      /endereço informado, a conexão com a VPN/.test(error.message)
  );
});

test('captura frame visual temporário sem deixar a imagem no disco', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'planevidences-frame-'));
  const browser = {
    hasTool: (name) => name === 'browser_take_screenshot',
    call: async (_name, args) => {
      await writeFile(path.join(outputDir, args.filename), Buffer.from('imagem-jpeg'));
      return { content: [] };
    },
  };
  try {
    const frame = await captureVisualFrame(browser, outputDir);
    assert.equal(frame.mimeType, 'image/jpeg');
    assert.equal(
      Buffer.from(frame.data, 'base64').toString('utf8'),
      'imagem-jpeg'
    );
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});
