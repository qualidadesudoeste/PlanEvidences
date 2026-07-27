import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  CircleStop,
  ExternalLink,
  Loader2,
  MonitorCog,
  Play,
  RefreshCw,
  Square,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { resolveAssetUrl } from '@/lib/api';
import {
  cancelAutomationRun,
  createAutomationRun,
  forgetRunnerToken,
  getAutomationRun,
  openLocalRunnerStatus,
  prepareLocalRunnerWindow,
  startLocalAutomationRunner,
} from '@/lib/automation';
import { agruparCenariosPorCard, getErrorMessage, tituloCardParaExibicao } from '@/lib/utils';
import { scenarioCode, type AutomationRun, type AutomationScenarioResult, type Project } from '@/types';
import { useToast } from '@/hooks/useToast';

interface Props {
  open: boolean;
  project: Project;
  evidenceProjectId: string | null;
  onClose: () => void;
  onCreateCorrective: (result: AutomationScenarioResult, runId: string) => void;
}

const ACTIVE_RUN_KEY = 'planevidences-active-automation-run';

function huFromCard(title: string | null | undefined) {
  const match = String(title || '').match(/\bHU[\s.:-]*(\d+)\b/i);
  return match ? `HU.${match[1]}` : '';
}

function statusLabel(status: AutomationRun['status']) {
  return {
    waiting_runner: 'Aguardando Runner Local',
    running: 'Executando',
    completed: 'Concluído',
    failed: 'Falha técnica',
    cancelled: 'Cancelado',
  }[status];
}

function resultLabel(status: AutomationScenarioResult['status']) {
  return {
    passed: 'Aprovado',
    failed: 'Reprovado',
    blocked: 'Bloqueado',
    not_automatable: 'Não automatizável',
  }[status];
}

export function AutomationBatchModal({
  open,
  project,
  evidenceProjectId,
  onClose,
  onCreateCorrective,
}: Props) {
  const { toast } = useToast();
  const groups = useMemo(
    () => agruparCenariosPorCard(project.scenarios).filter((group) => Boolean(group.codigo)),
    [project.scenarios]
  );
  const scenarioIndexes = useMemo(
    () => new Map(project.scenarios.map((scenario, index) => [scenario.id, index])),
    [project.scenarios]
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [baseUrl, setBaseUrl] = useState('');
  const [loginUrl, setLoginUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [run, setRun] = useState<AutomationRun | null>(null);
  const [runnerToken, setRunnerToken] = useState('');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    const activeRunId = sessionStorage.getItem(ACTIVE_RUN_KEY);
    if (activeRunId) {
      getAutomationRun(activeRunId)
        .then((updated) => {
          setRun(updated);
          if (['completed', 'failed', 'cancelled'].includes(updated.status)) {
            forgetRunnerToken(updated.id);
          }
        })
        .catch(() => sessionStorage.removeItem(ACTIVE_RUN_KEY));
    }
  }, [open]);

  useEffect(() => {
    if (!open || !run || ['completed', 'failed', 'cancelled'].includes(run.status)) return;
    const timer = window.setInterval(() => {
      getAutomationRun(run.id)
        .then((updated) => {
          setRun(updated);
          if (['completed', 'failed', 'cancelled'].includes(updated.status)) {
            forgetRunnerToken(updated.id);
          }
        })
        .catch((pollError) => setError(getErrorMessage(pollError)));
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [open, run?.id, run?.status]);

  if (!open) return null;

  const allScenarioIds = groups.flatMap((group) => group.scenarios.map((scenario) => scenario.id));
  const selectedCount = selected.size;
  const terminal = run && ['completed', 'failed', 'cancelled'].includes(run.status);

  const toggleScenario = (scenarioId: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(scenarioId)) next.delete(scenarioId);
      else next.add(scenarioId);
      return next;
    });
  };

  const toggleCard = (scenarioIds: string[]) => {
    setSelected((current) => {
      const next = new Set(current);
      const allSelected = scenarioIds.every((id) => next.has(id));
      scenarioIds.forEach((id) => (allSelected ? next.delete(id) : next.add(id)));
      return next;
    });
  };

  const selectEverything = () => {
    setSelected((current) =>
      current.size === allScenarioIds.length ? new Set() : new Set(allScenarioIds)
    );
  };

  const selectedCards = () =>
    groups
      .map((group) => ({
        code: String(group.codigo),
        title: group.resumo || '',
        hu: huFromCard(group.resumo),
        path: group.caminho || '',
        scenarios: group.scenarios
          .filter((scenario) => selected.has(scenario.id))
          .map((scenario) => ({
            id: scenario.id,
            code: scenarioCode(scenarioIndexes.get(scenario.id) ?? 0),
            title: scenario.title,
            bdd: scenario.bdd,
            path: scenario.cardCaminho || group.caminho || '',
          })),
      }))
      .filter((card) => card.scenarios.length > 0);

  const sendToRunner = async (runId: string, token?: string) => {
    if (!username.trim() || !password) throw new Error('Informe o usuário e a senha do sistema testado.');
    startLocalAutomationRunner({
      runId,
      runnerToken: token,
      username: username.trim(),
      password,
    });
    setPassword('');
  };

  const start = async () => {
    setError('');
    if (selectedCount === 0) {
      setError('Selecione ao menos um cenário.');
      return;
    }
    if (!baseUrl.trim() || !loginUrl.trim()) {
      setError('Informe a URL do sistema e a URL de login.');
      return;
    }
    if (!username.trim() || !password) {
      setError('Informe o usuário e a senha do sistema testado.');
      return;
    }

    setStarting(true);
    const runnerWindow = prepareLocalRunnerWindow();
    if (!runnerWindow) {
      setStarting(false);
      setError('O navegador bloqueou a aba do Runner Local. Permita pop-ups e tente novamente.');
      return;
    }
    try {
      const created = await createAutomationRun({
        projectName: project.projectName,
        sprintName: project.sprintName,
        evidenceProjectId,
        qaPlanId: project.qaPlanId,
        baseUrl: baseUrl.trim(),
        loginUrl: loginUrl.trim(),
        cards: selectedCards(),
      });
      setRun(created.run);
      setRunnerToken(created.runnerToken);
      sessionStorage.setItem(ACTIVE_RUN_KEY, created.run.id);
      await sendToRunner(created.run.id, created.runnerToken);
      toast({
        variant: 'success',
        title: 'Lote preparado para o Runner Local',
        description: `${created.run.totalScenarios} cenário(s) serão executados em segundo plano.`,
      });
    } catch (startError) {
      runnerWindow.close();
      setError(getErrorMessage(startError));
    } finally {
      setStarting(false);
    }
  };

  const retryRunner = async () => {
    if (!run) return;
    const runnerWindow = prepareLocalRunnerWindow();
    if (!runnerWindow) {
      setError('O navegador bloqueou a aba do Runner Local. Permita pop-ups e tente novamente.');
      return;
    }
    setStarting(true);
    setError('');
    try {
      await sendToRunner(run.id, runnerToken);
    } catch (retryError) {
      runnerWindow.close();
      setError(getErrorMessage(retryError));
    } finally {
      setStarting(false);
    }
  };

  const cancel = async () => {
    if (!run) return;
    try {
      setRun(await cancelAutomationRun(run.id));
    } catch (cancelError) {
      setError(getErrorMessage(cancelError));
    }
  };

  const reset = () => {
    if (run) forgetRunnerToken(run.id);
    sessionStorage.removeItem(ACTIVE_RUN_KEY);
    setRun(null);
    setRunnerToken('');
    setError('');
    setSelected(new Set());
  };

  return (
    <div className="automation-modal-overlay" onMouseDown={onClose}>
      <section
        className="automation-modal card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="automation-modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="automation-modal-header">
          <div>
            <h2 id="automation-modal-title">
              <Bot size={23} /> Execução automatizada
            </h2>
            <p>
              Selecione cards e cenários para o Runner Local executar com Playwright MCP.
            </p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Fechar">
            <X size={20} />
          </button>
        </header>

        {!run ? (
          <div className="automation-modal-body">
            <section className="automation-runner-status">
              <div>
                <MonitorCog size={20} />
                <div>
                  <strong>Runner Local</strong>
                  <span>
                    Inicia automaticamente com o Windows e executa o navegador em segundo plano.
                  </span>
                </div>
              </div>
              <Button variant="secondary" size="sm" onClick={openLocalRunnerStatus}>
                <ExternalLink size={14} />
                Abrir Runner
              </Button>
            </section>

            <div className="automation-config-grid">
              <div className="form-group">
                <label htmlFor="automation-base-url">URL do sistema</label>
                <input
                  id="automation-base-url"
                  type="url"
                  value={baseUrl}
                  onChange={(event) => {
                    setBaseUrl(event.target.value);
                    if (!loginUrl) setLoginUrl(event.target.value);
                  }}
                  placeholder="https://sistema-cliente..."
                />
              </div>
              <div className="form-group">
                <label htmlFor="automation-login-url">URL de login</label>
                <input
                  id="automation-login-url"
                  type="url"
                  value={loginUrl}
                  onChange={(event) => setLoginUrl(event.target.value)}
                  placeholder="https://sistema-cliente/login"
                />
              </div>
              <div className="form-group">
                <label htmlFor="automation-username">Usuário do sistema testado</label>
                <input
                  id="automation-username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  autoComplete="username"
                />
              </div>
              <div className="form-group">
                <label htmlFor="automation-password">Senha do sistema testado</label>
                <input
                  id="automation-password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                />
                <span className="label-hint">
                  A senha vai diretamente para o Runner Local e não é enviada ao servidor ou à IA.
                </span>
              </div>
            </div>

            <section className="automation-selection">
              <div className="automation-selection-heading">
                <div>
                  <h3>Cards e cenários</h3>
                  <p>{selectedCount} de {allScenarioIds.length} cenário(s) selecionado(s)</p>
                </div>
                <Button variant="secondary" size="sm" onClick={selectEverything}>
                  {selectedCount === allScenarioIds.length ? <Square size={14} /> : <CheckCircle2 size={14} />}
                  {selectedCount === allScenarioIds.length ? 'Limpar seleção' : 'Selecionar tudo'}
                </Button>
              </div>

              <div className="automation-card-list">
                {groups.map((group) => {
                  const ids = group.scenarios.map((scenario) => scenario.id);
                  const selectedInCard = ids.filter((id) => selected.has(id)).length;
                  return (
                    <article className="automation-card-option" key={String(group.codigo)}>
                      <label className="automation-card-checkbox">
                        <input
                          type="checkbox"
                          checked={selectedInCard === ids.length}
                          ref={(element) => {
                            if (element) {
                              element.indeterminate =
                                selectedInCard > 0 && selectedInCard < ids.length;
                            }
                          }}
                          onChange={() => toggleCard(ids)}
                        />
                        <span>
                          <strong>{tituloCardParaExibicao(group.codigo, group.resumo)}</strong>
                          <small>{selectedInCard} de {ids.length} selecionado(s)</small>
                        </span>
                      </label>
                      <div className="automation-scenario-options">
                        {group.scenarios.map((scenario) => (
                          <label key={scenario.id}>
                            <input
                              type="checkbox"
                              checked={selected.has(scenario.id)}
                              onChange={() => toggleScenario(scenario.id)}
                            />
                            <span>
                              <strong>
                                {scenarioCode(scenarioIndexes.get(scenario.id) || 0)}
                              </strong>
                              {scenario.title}
                            </span>
                          </label>
                        ))}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>

            {error && <div className="automation-error"><AlertCircle size={17} /> {error}</div>}

            <footer className="automation-modal-actions">
              <Button variant="secondary" onClick={onClose}>Cancelar</Button>
              <Button onClick={() => void start()} disabled={starting || selectedCount === 0}>
                {starting ? <Loader2 size={17} className="spin" /> : <Play size={17} />}
                {starting ? 'Iniciando...' : `Executar ${selectedCount} cenário(s)`}
              </Button>
            </footer>
          </div>
        ) : (
          <div className="automation-modal-body">
            <section className={`automation-run-summary status-${run.status}`}>
              <div className="automation-run-title">
                <div>
                  {run.status === 'running' ? (
                    <Loader2 size={22} className="spin" />
                  ) : terminal ? (
                    <CheckCircle2 size={22} />
                  ) : (
                    <MonitorCog size={22} />
                  )}
                  <div>
                    <h3>{statusLabel(run.status)}</h3>
                    <p>
                      {run.completedScenarios} de {run.totalScenarios} cenário(s) concluído(s)
                    </p>
                  </div>
                </div>
                {!terminal && (
                  <Button variant="danger" size="sm" onClick={() => void cancel()}>
                    <CircleStop size={15} /> Cancelar
                  </Button>
                )}
              </div>
              <Progress
                value={
                  run.totalScenarios > 0
                    ? Math.round((run.completedScenarios / run.totalScenarios) * 100)
                    : 0
                }
              />
              {run.current && (
                <p className="automation-current-step">
                  {(run.current.cardCode || run.current.scenarioCode) && (
                    <strong>
                      {run.current.cardCode ? `#${run.current.cardCode}` : ''}
                      {run.current.cardCode && run.current.scenarioCode ? ' • ' : ''}
                      {run.current.scenarioCode}
                    </strong>
                  )}
                  {run.current.step}
                </p>
              )}
            </section>

            {run.status === 'waiting_runner' && (
              <section className="automation-waiting-runner">
                <MonitorCog size={24} />
                <div>
                  <strong>Aguardando o Runner Local</strong>
                  <p>Inicie o runner neste computador e informe novamente a senha para continuar.</p>
                  <div className="automation-reconnect-fields">
                    <div className="form-group">
                      <label htmlFor="automation-retry-username">Usuário do sistema testado</label>
                      <input
                        id="automation-retry-username"
                        value={username}
                        onChange={(event) => setUsername(event.target.value)}
                        autoComplete="username"
                      />
                    </div>
                    <div className="form-group">
                      <label htmlFor="automation-retry-password">Senha do sistema testado</label>
                      <input
                        id="automation-retry-password"
                        type="password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        autoComplete="current-password"
                      />
                    </div>
                  </div>
                </div>
                <Button onClick={() => void retryRunner()} disabled={starting}>
                  {starting ? <Loader2 size={16} className="spin" /> : <Play size={16} />}
                  Conectar e executar
                </Button>
              </section>
            )}

            {error && <div className="automation-error"><AlertCircle size={17} /> {error}</div>}

            <section className="automation-results">
              <h3>Resultados</h3>
              {run.results.length === 0 ? (
                <p className="automation-empty-results">Os resultados aparecerão conforme os cenários forem concluídos.</p>
              ) : (
                run.cards.map((card) => {
                  const results = run.results.filter((result) => result.cardCode === card.code);
                  if (results.length === 0) return null;
                  return (
                    <article className="automation-result-card" key={card.code}>
                      <header>
                        <strong>Card #{card.code} — {card.title}</strong>
                        <span>{results.length} resultado(s)</span>
                      </header>
                      {results.map((result) => (
                        <div className={`automation-result-row result-${result.status}`} key={result.scenarioId}>
                          <div className="automation-result-main">
                            <span className="automation-result-badge">{resultLabel(result.status)}</span>
                            <div>
                              <strong>{result.scenarioCode} — {result.title}</strong>
                              <p>{result.summary}</p>
                              {result.finalUrl && (
                                <a href={result.finalUrl} target="_blank" rel="noopener noreferrer">
                                  URL final <ExternalLink size={12} />
                                </a>
                              )}
                              {result.status !== 'passed' && (
                                <details className="automation-result-details">
                                  <summary>Ver detalhes da execução</summary>
                                  <dl>
                                    <div>
                                      <dt>Último passo</dt>
                                      <dd>{result.lastStep || 'Não informado'}</dd>
                                    </div>
                                    <div>
                                      <dt>Resultado atual</dt>
                                      <dd>{result.actualResult || 'Não informado'}</dd>
                                    </div>
                                    <div>
                                      <dt>Resultado esperado</dt>
                                      <dd>{result.expectedResult || 'Não informado'}</dd>
                                    </div>
                                  </dl>
                                  {result.evidence.length > 0 && (
                                    <div className="automation-result-evidence">
                                      {result.evidence.map((item) => (
                                        <a
                                          href={resolveAssetUrl(item.url)}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          key={item.id}
                                        >
                                          <img
                                            src={resolveAssetUrl(item.url)}
                                            alt={item.originalName}
                                          />
                                          <span>{item.originalName}</span>
                                        </a>
                                      ))}
                                    </div>
                                  )}
                                  {(result.diagnostics?.console || result.diagnostics?.network) && (
                                    <details className="automation-technical-details">
                                      <summary>Diagnóstico técnico</summary>
                                      {result.diagnostics.console && (
                                        <>
                                          <strong>Console</strong>
                                          <pre>{result.diagnostics.console}</pre>
                                        </>
                                      )}
                                      {result.diagnostics.network && (
                                        <>
                                          <strong>Rede</strong>
                                          <pre>{result.diagnostics.network}</pre>
                                        </>
                                      )}
                                    </details>
                                  )}
                                </details>
                              )}
                            </div>
                          </div>
                          {result.status === 'failed' && (
                            <Button
                              size="sm"
                              onClick={() => onCreateCorrective(result, run.id)}
                            >
                              Gerar corretiva
                            </Button>
                          )}
                        </div>
                      ))}
                    </article>
                  );
                })
              )}
            </section>

            <section className="automation-events">
              <h3>Atividade do runner</h3>
              <div>
                {run.events.slice(-30).map((event, index) => (
                  <p className={`event-${event.level}`} key={`${event.at}-${index}`}>
                    <time>{new Date(event.at).toLocaleTimeString()}</time>
                    {event.message}
                  </p>
                ))}
              </div>
            </section>

            <footer className="automation-modal-actions">
              {terminal && (
                <Button variant="secondary" onClick={reset}>
                  <RefreshCw size={16} /> Nova execução
                </Button>
              )}
              <Button onClick={onClose}>{terminal ? 'Fechar' : 'Continuar em segundo plano'}</Button>
            </footer>
          </div>
        )}
      </section>
    </div>
  );
}
