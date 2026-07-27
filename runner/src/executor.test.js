import test from 'node:test';
import assert from 'node:assert/strict';
import {
  authenticationObservationState,
  authenticationSucceeded,
  ensureAllowedNavigation,
  ensureObservationOrigin,
  isLoginSubmission,
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
