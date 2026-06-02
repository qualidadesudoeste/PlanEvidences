import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Settings,
  Sparkles,
  Loader2,
  FlaskConical,
  ArrowRight,
  AlertCircle,
  RotateCcw,
  X,
  FolderOpen,
  FileDown,
  FileJson,
  Copy,
  Save,
} from 'lucide-react';
import { Sidebar } from '@/components/Sidebar';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { HUForm, type HUFormState } from '@/components/qa/HUForm';
import { ResultsTabs } from '@/components/qa/ResultsTabs';
import { AISettingsModal } from '@/components/qa/AISettingsModal';
import { ImportButtons } from '@/components/qa/ImportButtons';
import { ResumePlanoModal } from '@/components/qa/ResumePlanoModal';
import { FailureModal } from '@/components/qa/FailureModal';
import { useToast } from '@/hooks/useToast';
import { carregarConfigIA, PROVIDER_LABELS } from '@/lib/qa/aiConfig';
import { analisarComIA, buscarStatusServidor } from '@/lib/qa/aiClient';
import { criarCardSinteticoDeHU } from '@/lib/qa/parser';
import { analiseParaScenarios } from '@/lib/qa/toScenarios';
import { mergeSigCards, montarHUConsolidadaLimpa, type SigCard } from '@/lib/qa/sigParser';
import {
  carregarPlanoCompleto,
  derivarTela,
  huHash,
  upsertPlanoQA,
} from '@/lib/qa/supabasePlano';
import {
  carregarExecucoes,
  registrarFalha,
  salvarExecucao,
  type ExecucaoRow,
  type ExecucaoStatus,
} from '@/lib/qa/execucao';
import {
  analisarCoberturaRiscos,
  selecionarCategoriasAplicaveis,
} from '@/lib/qa/heuristics';
import {
  copiarMarkdown,
  exportarJSONBDD,
  exportarMarkdown,
  exportarTemplate,
} from '@/lib/qa/exports';
import type { QAAIConfig, QAAnaliseResult, QACard, QAServerStatus } from '@/types';

const FORM_STORAGE_KEY = 'qa-assistant-form';

const initialForm: HUFormState = {
  projeto: '',
  sprint: '',
  hu: '',
  tipoSistema: 'web',
  criticidade: 'media',
};

function carregarForm(): HUFormState {
  try {
    const raw = localStorage.getItem(FORM_STORAGE_KEY);
    if (!raw) return initialForm;
    return { ...initialForm, ...(JSON.parse(raw) as Partial<HUFormState>) };
  } catch {
    return initialForm;
  }
}

export default function QAAssistant() {
  const { toast } = useToast();
  const navigate = useNavigate();

  const [form, setForm] = useState<HUFormState>(carregarForm);
  const [config, setConfig] = useState<QAAIConfig | null>(() => carregarConfigIA());
  const [serverStatus, setServerStatus] = useState<QAServerStatus | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [resumeOpen, setResumeOpen] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState('');
  const [analise, setAnalise] = useState<QAAnaliseResult | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [cardsImportados, setCardsImportados] = useState<SigCard[]>([]);
  const [planoId, setPlanoId] = useState<string | null>(null);
  const [execucoes, setExecucoes] = useState<Map<string, ExecucaoRow>>(new Map());
  const [failureModal, setFailureModal] = useState<{
    open: boolean;
    mode: 'register' | 'history';
    caseId: string;
    titulo: string;
    tipo?: string;
  } | null>(null);

  useEffect(() => {
    buscarStatusServidor().then(setServerStatus);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      localStorage.setItem(FORM_STORAGE_KEY, JSON.stringify(form));
    }, 400);
    return () => clearTimeout(t);
  }, [form]);

  const iaConfigurada = useMemo(() => {
    return Boolean(serverStatus?.serverConfigured || (config && config.apiKey));
  }, [serverStatus, config]);

  const iaStatusTexto = useMemo(() => {
    if (serverStatus?.serverConfigured && serverStatus.defaultProvider) {
      return `Servidor: ${PROVIDER_LABELS[serverStatus.defaultProvider]}`;
    }
    if (config?.provider) {
      return `Navegador: ${PROVIDER_LABELS[config.provider]} (${config.model})`;
    }
    return 'IA não configurada';
  }, [serverStatus, config]);

  // Cards efetivos: importados (PDF/DOCX/JSON) ou sintético da HU manual.
  // Usados pra IA, pra derivar nome de tela e pra heurística.
  const cardsEfetivos = useMemo<QACard[]>(() => {
    if (cardsImportados.length > 0) return cardsImportados;
    if (form.hu.trim().length >= 20) {
      return [criarCardSinteticoDeHU(form.hu, form.projeto, form.sprint)];
    }
    return [];
  }, [cardsImportados, form.hu, form.projeto, form.sprint]);

  const tela = useMemo(() => derivarTela(cardsEfetivos, form.projeto, form.sprint), [
    cardsEfetivos,
    form.projeto,
    form.sprint,
  ]);

  // Heurísticas: categorias aplicáveis + riscos + cobertura. Derivado puro;
  // não depende do plano estar salvo.
  const categorias = useMemo(
    () => selecionarCategoriasAplicaveis(form.hu, tela, form.tipoSistema),
    [form.hu, tela, form.tipoSistema]
  );

  const { riscos, cobertura } = useMemo(() => {
    if (!analise) {
      return {
        riscos: [],
        cobertura: {
          categoriasAplicaveis: categorias.length,
          totalTestesSuite: categorias.reduce((acc, c) => acc + c.testes.length, 0),
          casosGerados: 0,
          tiposCobertos: [],
        },
      };
    }
    return analisarCoberturaRiscos(form.hu, tela, form.tipoSistema, categorias, analise);
  }, [analise, form.hu, tela, form.tipoSistema, categorias]);

  const handleAnalyze = useCallback(async () => {
    setErro(null);

    if (!iaConfigurada) {
      toast({
        variant: 'error',
        title: 'Configure a IA primeiro',
        description: 'Clique em "Configurações de IA" e informe o provedor + API key.',
      });
      setSettingsOpen(true);
      return;
    }
    if (form.hu.trim().length < 20) {
      toast({ variant: 'error', title: 'HU muito curta (mínimo 20 caracteres)' });
      return;
    }
    if (!form.projeto.trim() || !form.sprint.trim()) {
      toast({
        variant: 'error',
        title: 'Preencha Projeto e Sprint',
        description: 'Esses dados são usados pra rastrear o plano no histórico.',
      });
      return;
    }

    setAnalyzing(true);
    setAnalise(null);
    setPlanoId(null);
    setExecucoes(new Map());
    setProgress(5);
    setProgressLabel('Preparando análise...');

    // Cards importados (JSON/PDF/DOCX) têm prioridade sobre o card sintético da HU manual.
    // Assim cada HU vira um card próprio na análise da IA, agrupado na visualização.
    const cardsParaUsar =
      cardsImportados.length > 0
        ? cardsImportados
        : [criarCardSinteticoDeHU(form.hu, form.projeto, form.sprint)];

    try {
      const { analise: resultado, falhas } = await analisarComIA({
        cards: cardsParaUsar,
        tipoSistema: form.tipoSistema,
        criticidade: form.criticidade,
        config,
        serverStatus,
        onProgress: (i, total) => {
          setProgress(Math.round((i / total) * 90) + 5);
          setProgressLabel(`IA gerando casos (${i}/${total})...`);
        },
      });

      setAnalise(resultado);
      setProgress(100);

      const totalCasos = resultado.cards.reduce((acc, c) => acc + (c.casos?.length || 0), 0);
      if (falhas.length > 0) {
        toast({
          variant: 'warning',
          title: 'Concluído com falhas',
          description: `${totalCasos} caso(s) gerados; ${falhas.length} card(s) falhou.`,
        });
      } else {
        toast({
          variant: 'success',
          title: 'Análise concluída',
          description: `${totalCasos} caso(s) de teste gerados.`,
        });
      }

      // Salva automaticamente no Supabase pra habilitar status de execução e
      // retomada futura. Falha aqui não impede o usuário de ver/exportar os casos.
      try {
        setSaving(true);
        const telaSalvar = derivarTela(cardsParaUsar, form.projeto, form.sprint);
        const id = await upsertPlanoQA({
          projeto: form.projeto,
          sprint: form.sprint,
          tela: telaSalvar,
          hu: form.hu,
          tipoSistema: form.tipoSistema,
          criticidade: form.criticidade,
          analise: resultado,
          cards: cardsParaUsar,
          scenariosBdd: analiseParaScenarios(resultado),
        });
        setPlanoId(id);
        const rows = await carregarExecucoes(id);
        setExecucoes(new Map(rows.map((r) => [r.case_id, r])));
      } catch (saveErr) {
        console.warn('[supabase save]', saveErr);
        toast({
          variant: 'warning',
          title: 'Casos prontos, mas falhou ao salvar no Supabase',
          description: saveErr instanceof Error ? saveErr.message : String(saveErr),
        });
      } finally {
        setSaving(false);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErro(msg);
      toast({ variant: 'error', title: 'Falha na análise', description: msg });
    } finally {
      setAnalyzing(false);
      setTimeout(() => {
        setProgress(0);
        setProgressLabel('');
      }, 1200);
    }
  }, [form, config, serverStatus, iaConfigurada, cardsImportados, toast]);

  // Quando o usuário importa HUs (via JSON/PDF/DOCX), acumula com o que já estava
  // pendente, auto-preenche projeto/sprint a partir do conteúdo (se vazios) e
  // preenche o textarea com a HU consolidada — mantendo o textarea como
  // representação editável do que será mandado pra IA.
  const handleImported = useCallback(
    (novos: SigCard[]) => {
      const todos = mergeSigCards(cardsImportados, novos);
      setCardsImportados(todos);

      const primeiroProjeto = todos.find((c) => c.projeto)?.projeto;
      const primeiroSprint = todos.find((c) => c.sprint)?.sprint;
      setForm((f) => ({
        ...f,
        projeto: f.projeto.trim() || primeiroProjeto || 'Documento Importado',
        sprint: f.sprint.trim() || primeiroSprint || 'S/N',
        hu: montarHUConsolidadaLimpa(todos),
      }));
    },
    [cardsImportados]
  );

  const handleRemoverImportados = () => {
    if (cardsImportados.length === 0) return;
    if (!confirm(`Remover os ${cardsImportados.length} card(s) importado(s)?`)) return;
    setCardsImportados([]);
  };

  const handleSendToEvidences = () => {
    if (!analise) return;
    const scenarios = analiseParaScenarios(analise);
    if (scenarios.length === 0) {
      toast({ variant: 'error', title: 'Nada para enviar' });
      return;
    }
    navigate('/evidences', {
      state: {
        fromQA: true,
        scenarios,
        meta: {
          projeto: form.projeto,
          sprint: form.sprint,
        },
      },
    });
  };

  const handleResetar = () => {
    if (!confirm('Limpar HU, cards importados e resultado atuais?')) return;
    setForm(initialForm);
    setAnalise(null);
    setErro(null);
    setCardsImportados([]);
    setPlanoId(null);
    setExecucoes(new Map());
    localStorage.removeItem(FORM_STORAGE_KEY);
  };

  const handleResumePlan = async (id: string) => {
    const rec = await carregarPlanoCompleto(id);
    const resultado = rec.resultado_json || {};
    const restoredAnalise = (resultado.analise as QAAnaliseResult | undefined) || null;
    const restoredCards = (resultado.cards as QACard[] | undefined) || [];

    if (!restoredAnalise) {
      toast({
        variant: 'error',
        title: 'Plano sem análise',
        description: 'Esse plano foi salvo por uma versão antiga sem o resultado da análise.',
      });
      return;
    }

    setForm({
      projeto: rec.projeto,
      sprint: rec.sprint,
      hu: rec.hu,
      tipoSistema: (rec.tipo_sistema as HUFormState['tipoSistema']) || 'web',
      criticidade: (rec.criticidade as HUFormState['criticidade']) || 'media',
    });
    setCardsImportados(restoredCards.length > 1 ? (restoredCards as SigCard[]) : []);
    setAnalise(restoredAnalise);
    setPlanoId(id);
    setErro(null);

    const rows = await carregarExecucoes(id);
    setExecucoes(new Map(rows.map((r) => [r.case_id, r])));

    toast({
      variant: 'success',
      title: 'Plano retomado',
      description: `${rec.projeto} • Sprint ${rec.sprint}`,
    });
  };

  // ----- Status / Falhas -----

  const handleMarkStatus = useCallback(
    async (
      caso: { caseId: string; titulo: string; tipo?: string },
      status: ExecucaoStatus
    ): Promise<void> => {
      if (!planoId) {
        toast({
          variant: 'error',
          title: 'Plano não salvo',
          description: 'Recarregue após o salvamento concluir.',
        });
        return;
      }
      if (status === 'falhou') {
        // Abre modal pra capturar observação antes de gravar.
        setFailureModal({
          open: true,
          mode: 'register',
          caseId: caso.caseId,
          titulo: caso.titulo,
          tipo: caso.tipo,
        });
        return;
      }
      try {
        const row = await salvarExecucao({
          planId: planoId,
          caseId: caso.caseId,
          status,
          titulo: caso.titulo,
          tipo: caso.tipo,
          origem: 'ia',
        });
        setExecucoes((prev) => {
          const next = new Map(prev);
          next.set(caso.caseId, row);
          return next;
        });
      } catch (e) {
        toast({
          variant: 'error',
          title: 'Falha ao atualizar status',
          description: e instanceof Error ? e.message : String(e),
        });
      }
    },
    [planoId, toast]
  );

  const handleConfirmFalha = async (observacao: string) => {
    if (!planoId || !failureModal) return;
    try {
      await registrarFalha({ planId: planoId, caseId: failureModal.caseId, observacao });
      // Garante que a linha de execução exista (fail_count incrementado pelo registrarFalha)
      const row = await salvarExecucao({
        planId: planoId,
        caseId: failureModal.caseId,
        status: 'falhou',
        titulo: failureModal.titulo,
        tipo: failureModal.tipo,
        origem: 'ia',
      });
      setExecucoes((prev) => {
        const next = new Map(prev);
        next.set(failureModal.caseId, row);
        return next;
      });
      toast({ variant: 'success', title: 'Falha registrada' });
    } catch (e) {
      throw e;
    }
  };

  const handleVerHistorico = (caso: { caseId: string; titulo: string }) => {
    setFailureModal({
      open: true,
      mode: 'history',
      caseId: caso.caseId,
      titulo: caso.titulo,
    });
  };

  // ----- Exports -----

  const exportOpts = analise
    ? {
        projeto: form.projeto,
        sprint: form.sprint,
        tela,
        tipoSistema: form.tipoSistema,
        criticidade: form.criticidade,
        analise,
        riscos,
      }
    : null;

  const handleExportMD = () => {
    if (!exportOpts) return;
    exportarMarkdown(exportOpts);
    toast({ variant: 'success', title: 'Markdown exportado' });
  };

  const handleExportJSONBDD = () => {
    if (!analise) return;
    const n = exportarJSONBDD({
      projeto: form.projeto,
      sprint: form.sprint,
      tela,
      analise,
    });
    toast({ variant: 'success', title: 'JSON BDD exportado', description: `${n} cenário(s).` });
  };

  const handleExportTemplate = () => {
    if (cardsImportados.length === 0) {
      toast({
        variant: 'error',
        title: 'Template SIG indisponível',
        description: 'Importe um JSON/PDF/DOCX do SIG primeiro pra gerar o template.',
      });
      return;
    }
    exportarTemplate({ projeto: form.projeto, sprint: form.sprint, cardsSig: cardsImportados });
    toast({ variant: 'success', title: 'Template SIG exportado' });
  };

  const handleCopyMD = async () => {
    if (!exportOpts) return;
    try {
      await copiarMarkdown(exportOpts);
      toast({ variant: 'success', title: 'Markdown copiado pro clipboard' });
    } catch {
      toast({ variant: 'error', title: 'Falha ao copiar' });
    }
  };

  return (
    <div className="planevidences-app">
      <Sidebar />

      <AISettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSaved={setConfig}
        serverStatus={serverStatus}
      />

      <ResumePlanoModal
        open={resumeOpen}
        onClose={() => setResumeOpen(false)}
        onPick={handleResumePlan}
      />

      <FailureModal
        open={!!failureModal?.open}
        mode={failureModal?.mode || 'register'}
        planId={planoId}
        caseId={failureModal?.caseId || null}
        caseTitle={failureModal?.titulo}
        onClose={() => setFailureModal(null)}
        onConfirm={failureModal?.mode === 'register' ? handleConfirmFalha : undefined}
      />

      <main className="main-content">
        <div className="content-left">
          <header className="page-header">
            <div className="page-title">
              <h1>Gerador de Casos de Teste</h1>
              <p>
                Cole uma História de Usuário, configure a IA e gere casos em BDD prontos pra virar
                evidências.
              </p>
            </div>
            <div className="header-actions">
              <Button variant="secondary" onClick={() => setResumeOpen(true)} disabled={analyzing}>
                <FolderOpen size={16} /> Retomar plano
              </Button>
              <ImportButtons onImported={handleImported} disabled={analyzing} />
              <Button variant="secondary" onClick={() => setSettingsOpen(true)}>
                <Settings size={16} /> Configurações de IA
              </Button>
              <Button onClick={handleAnalyze} disabled={analyzing}>
                {analyzing ? (
                  <>
                    <Loader2 size={16} className="spin" /> Analisando...
                  </>
                ) : (
                  <>
                    <FlaskConical size={16} /> Analisar HU
                  </>
                )}
              </Button>
            </div>
          </header>

          <div
            className="card"
            style={{
              padding: 14,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
              flexWrap: 'wrap',
              borderLeft: `4px solid ${
                iaConfigurada ? 'var(--accent, #1e9e22)' : 'var(--danger, #ef4444)'
              }`,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Sparkles size={16} />
              <div>
                <strong style={{ fontSize: 13 }}>Status da IA</strong>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{iaStatusTexto}</div>
              </div>
            </div>
            {!iaConfigurada && (
              <Button variant="secondary" onClick={() => setSettingsOpen(true)}>
                Configurar agora
              </Button>
            )}
          </div>

          {cardsImportados.length > 0 && (
            <div
              className="card"
              style={{
                padding: 14,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                borderLeft: '4px solid var(--accent, #1e9e22)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                  flexWrap: 'wrap',
                }}
              >
                <div>
                  <strong style={{ fontSize: 13 }}>
                    {cardsImportados.length} HU(s) importadas — prontas para análise
                  </strong>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    {cardsImportados.reduce((acc, c) => acc + (c.cenarios?.length || 0), 0)} cenário(s)
                    BDD ·{' '}
                    {cardsImportados.reduce((acc, c) => acc + (c.criterios?.length || 0), 0)} critério(s).
                    Clique em <strong>Analisar HU</strong> para gerar os casos.
                  </div>
                </div>
                <Button variant="secondary" onClick={handleRemoverImportados}>
                  <X size={14} /> Remover importados
                </Button>
              </div>
              <details style={{ fontSize: 12 }}>
                <summary style={{ cursor: 'pointer', color: 'var(--text-secondary)' }}>
                  Ver lista de cards importados
                </summary>
                <ul style={{ margin: '8px 0 0 18px', maxHeight: 200, overflowY: 'auto' }}>
                  {cardsImportados.map((c, i) => (
                    <li key={`${c.codigo || ''}-${i}`} style={{ marginBottom: 4 }}>
                      <strong>#{c.codigo || 's/cód'}</strong> — {c.resumo}
                      {c.cenarios && c.cenarios.length > 0 && (
                        <span style={{ color: 'var(--text-secondary)' }}>
                          {' '}
                          ({c.cenarios.length} cenário{c.cenarios.length !== 1 ? 's' : ''})
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            </div>
          )}

          {analyzing && (
            <div className="card" style={{ padding: 18 }}>
              <p style={{ fontWeight: 600, marginBottom: 8 }}>
                {progressLabel || 'Processando...'}
              </p>
              <Progress value={progress} />
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 6 }}>
                A análise pode levar 20–60s dependendo do provedor e tamanho da HU.
              </p>
            </div>
          )}

          {erro && !analyzing && (
            <div
              className="card"
              style={{
                padding: 16,
                borderLeft: '4px solid var(--danger, #ef4444)',
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
              }}
            >
              <AlertCircle size={18} style={{ color: 'var(--danger, #ef4444)', flexShrink: 0 }} />
              <div>
                <strong style={{ fontSize: 14 }}>Erro na análise</strong>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>{erro}</p>
              </div>
            </div>
          )}

          <HUForm value={form} onChange={setForm} disabled={analyzing} />

          {analise && (
            <>
              <div
                className="card"
                style={{
                  padding: 18,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                  background: 'rgba(30,158,34,0.06)',
                  borderLeft: '4px solid var(--accent, #1e9e22)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    flexWrap: 'wrap',
                  }}
                >
                  <div>
                    <strong style={{ fontSize: 15 }}>
                      Casos prontos pra virar evidência
                      {planoId && (
                        <span
                          style={{
                            marginLeft: 8,
                            fontSize: 11,
                            padding: '2px 8px',
                            borderRadius: 999,
                            background: 'rgba(30,158,34,0.15)',
                            color: 'var(--accent, #1e9e22)',
                            verticalAlign: 'middle',
                          }}
                        >
                          <Save size={10} style={{ verticalAlign: 'middle', marginRight: 3 }} />
                          Salvo
                        </span>
                      )}
                      {saving && !planoId && (
                        <span
                          style={{
                            marginLeft: 8,
                            fontSize: 11,
                            color: 'var(--text-secondary)',
                          }}
                        >
                          Salvando…
                        </span>
                      )}
                    </strong>
                    <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                      Envie pra o Editor de Evidências pra anexar capturas e gerar o PDF, ou exporte
                      em outros formatos.
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <Button variant="secondary" onClick={handleResetar}>
                      <RotateCcw size={14} /> Nova HU
                    </Button>
                    <Button onClick={handleSendToEvidences}>
                      Enviar para Evidências <ArrowRight size={16} />
                    </Button>
                  </div>
                </div>

                <div
                  style={{
                    display: 'flex',
                    gap: 6,
                    flexWrap: 'wrap',
                    paddingTop: 8,
                    borderTop: '1px solid var(--border)',
                  }}
                >
                  <Button variant="secondary" onClick={handleCopyMD}>
                    <Copy size={14} /> Copiar
                  </Button>
                  <Button variant="secondary" onClick={handleExportMD}>
                    <FileDown size={14} /> Exportar .md
                  </Button>
                  <Button variant="secondary" onClick={handleExportJSONBDD}>
                    <FileJson size={14} /> Exportar JSON (BDD)
                  </Button>
                  {cardsImportados.length > 0 && (
                    <Button variant="secondary" onClick={handleExportTemplate}>
                      <FileDown size={14} /> Exportar Template SIG
                    </Button>
                  )}
                </div>
              </div>

              <ResultsTabs
                analise={analise}
                riscos={riscos}
                cobertura={cobertura}
                categorias={categorias}
                progressoKey={huHash(form.hu)}
                execucoes={execucoes}
                interactive={!!planoId}
                onMarkStatus={handleMarkStatus}
                onVerHistorico={handleVerHistorico}
              />
            </>
          )}

          {!analise && !analyzing && (
            <div className="card" style={{ padding: 16, fontSize: 13, color: 'var(--text-secondary)' }}>
              Depois de gerar os casos, você poderá enviá-los direto para o{' '}
              <Link to="/evidences" style={{ color: 'var(--accent, #1e9e22)', fontWeight: 600 }}>
                Editor de Evidências
              </Link>{' '}
              — onde se anexam capturas de tela e o PDF final é compilado.
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
