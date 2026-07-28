import test from 'node:test';
import assert from 'node:assert/strict';
import {
  authenticationObservationState,
  authenticationSucceeded,
  ensureAllowedNavigation,
  ensureObservationOrigin,
  isLoginSubmission,
  isMcpRequestTimeout,
  loginCredentialTargets,
  loginSubmissionAction,
  navigateWithRecovery,
  normalizeBrowserToolArguments,
  redactSecrets,
  safeHistoryArguments,
  substituteSecrets,
  validateSecretPlacement,
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
