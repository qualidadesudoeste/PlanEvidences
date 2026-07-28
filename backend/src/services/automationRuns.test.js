import test from 'node:test';
import assert from 'node:assert/strict';
import {
  authorizedRunnerRun,
  claimAutomationRun,
  createAutomationRun,
  getAutomationRunForUser,
  requestAutomationCancellation,
  runnerVersionSupported,
  updateAutomationRun,
} from './automationRuns.js';

function createBatch() {
  return createAutomationRun(
    { userId: 'qa-42', username: 'qa.teste', name: 'QA Teste' },
    {
      projectName: 'Projeto SIG',
      sprintName: 'Sprint 10',
      baseUrl: 'https://cliente.local/app',
      loginUrl: 'https://cliente.local/login',
      cards: [
        {
          code: '113684',
          title: 'HU.68 - Primeiro card',
          hu: 'HU.68',
          path: 'Menu > Cadastro',
          scenarios: [
            { id: 'scenario-1', code: 'CT-001', title: 'Salvar', bdd: 'Dado x\nEntão y' },
            { id: 'scenario-2', code: 'CT-002', title: 'Excluir', bdd: 'Dado x\nEntão z' },
          ],
        },
        {
          code: '113685',
          title: 'HU.69 - Segundo card',
          scenarios: [
            { id: 'scenario-3', code: 'CT-003', title: 'Pesquisar', bdd: 'Dado x\nEntão w' },
          ],
        },
      ],
      credentials: { username: 'não-pode', password: 'não-pode' },
    }
  );
}

test('cria um lote com vários cards sem persistir credenciais do sistema testado', () => {
  const created = createBatch();
  assert.equal(created.run.cards.length, 2);
  assert.equal(created.run.totalScenarios, 3);
  assert.equal(created.run.status, 'waiting_runner');
  assert.equal('runnerTokenHash' in created.run, false);
  assert.equal(JSON.stringify(created.run).includes('não-pode'), false);
  assert.ok(created.runnerToken.length > 30);
  assert.equal(authorizedRunnerRun(created.run.id, 'token-inválido'), null);
  assert.ok(authorizedRunnerRun(created.run.id, created.runnerToken));
});

test('isola o lote por usuário e contabiliza resultados por cenário', () => {
  const created = createBatch();
  assert.equal(getAutomationRunForUser(created.run.id, 'outro-qa'), null);
  const internal = authorizedRunnerRun(created.run.id, created.runnerToken);
  claimAutomationRun(internal, { name: 'Runner', version: '0.1.1', machine: 'QA-PC' });
  const updated = updateAutomationRun(internal, {
    result: {
      cardCode: '113684',
      scenarioId: 'scenario-1',
      scenarioCode: 'CT-001',
      title: 'Salvar',
      status: 'failed',
      summary: 'Mensagem não foi exibida.',
      actualResult: 'Salvou sem validar.',
      expectedResult: 'Deveria bloquear.',
      evidence: [],
    },
  });
  assert.equal(updated.status, 'running');
  assert.equal(updated.completedScenarios, 1);
  assert.equal(updated.results[0].status, 'failed');
  assert.deepEqual(updated.results[0].diagnostics, { console: '', network: '' });
});

test('recusa Runner antigo e mantém o lote disponível para reconexão após atualizar', () => {
  const created = createBatch();
  const internal = authorizedRunnerRun(created.run.id, created.runnerToken);
  assert.equal(runnerVersionSupported('0.1.0'), false);
  assert.equal(runnerVersionSupported('0.1.1'), true);
  assert.equal(runnerVersionSupported('0.2.0'), true);
  assert.throws(
    () => claimAutomationRun(internal, { name: 'Runner antigo', version: '0.1.0' }),
    (error) =>
      error.status === 426 &&
      error.code === 'AUTOMATION_RUNNER_UPDATE_REQUIRED' &&
      /versão 0\.1\.1 ou superior/.test(error.message)
  );
  const run = getAutomationRunForUser(created.run.id, 'qa-42');
  assert.equal(run.status, 'waiting_runner');
  assert.match(run.events.at(-1).message, /Runner Local 0\.1\.0 desatualizado/);
});

test('permite ao dono solicitar cancelamento sem expor o token do runner', () => {
  const created = createBatch();
  const cancelled = requestAutomationCancellation(created.run.id, 'qa-42');
  assert.equal(cancelled.cancelRequested, true);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal('runnerTokenHash' in cancelled, false);
});
