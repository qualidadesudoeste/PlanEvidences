import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Sparkles, Loader2, FileType, Download, AlertCircle, Save, Search } from 'lucide-react';
import { Sidebar } from '@/components/Sidebar';
import { ProjectForm } from '@/components/ProjectForm';
import { ScenarioCard } from '@/components/ScenarioCard';
import { HistoryList } from '@/components/HistoryList';
import { RightPanel } from '@/components/RightPanel';
import { ImportFromQAModal } from '@/components/ImportFromQAModal';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ThemeProvider } from '@/hooks/useTheme';
import { ToastsProvider, useToast } from '@/hooks/useToast';
import { generateDocument, resolveAssetUrl } from '@/lib/api';
import { agruparCenariosPorCard, tituloCardParaExibicao } from '@/lib/utils';
import type { GeneratedDoc, Project, Scenario } from '@/types';

const STORAGE_KEY = 'qa-evidences-project';
const SESSION_KEY = 'qa-evidences-session';

const emptyProject: Project = {
  qaPlanId: null,
  projectName: '',
  sprintName: '',
  version: '1.0',
  redator: '',
  clientName: '',
  sprintObjective: '',
  testScope: '',
  scenarios: [],
};

function newScenario(): Scenario {
  return {
    id: crypto.randomUUID(),
    title: '',
    bdd: '',
    evidence: '',
    images: [],
  };
}

function migrateScenario(s: any): Scenario {
  const cardMeta = {
    cardCodigo: s?.cardCodigo ?? null,
    cardResumo: s?.cardResumo ?? null,
    cardCaminho: s?.cardCaminho ?? null,
    caseId: s?.caseId ?? null,
  };
  if (typeof s?.bdd === 'string') return { ...newScenario(), ...s, ...cardMeta };
  const parts: string[] = [];
  if (s?.given) parts.push(`Dado que ${s.given}`);
  if (s?.when) parts.push(`Quando ${s.when}`);
  if (s?.then) parts.push(`Então ${s.then}`);
  if (s?.and) parts.push(`E ${s.and}`);
  return {
    id: s?.id || crypto.randomUUID(),
    title: s?.title || '',
    bdd: parts.join('\n'),
    evidence: s?.evidence || '',
    images: Array.isArray(s?.images) ? s.images : [],
    ...cardMeta,
  };
}

function getSessionId(): string {
  let id = localStorage.getItem(SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

function AppInner() {
  const { toast } = useToast();
  const sessionId = useMemo(getSessionId, []);
  const [project, setProject] = useState<Project>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        const scenarios = Array.isArray(parsed.scenarios) ? parsed.scenarios.map(migrateScenario) : [];
        return { ...emptyProject, ...parsed, scenarios };
      }
    } catch {
      /* ignore */
    }
    return emptyProject;
  });

  const [lastSavedProject, setLastSavedProject] = useState<Project>(() => {
    try {
      const saved = localStorage.getItem('qa-evidences-last-saved');
      if (saved) {
        const parsed = JSON.parse(saved);
        const scenarios = Array.isArray(parsed.scenarios) ? parsed.scenarios.map(migrateScenario) : [];
        return { ...emptyProject, ...parsed, scenarios };
      }
    } catch {
      /* ignore */
    }
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        const scenarios = Array.isArray(parsed.scenarios) ? parsed.scenarios.map(migrateScenario) : [];
        return { ...emptyProject, ...parsed, scenarios };
      }
    } catch {
      /* ignore */
    }
    return emptyProject;
  });

  const [view, setView] = useState<'editor' | 'history'>('editor');
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState(0);
  const [lastDoc, setLastDoc] = useState<GeneratedDoc | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [qaImportOpen, setQaImportOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
    }, 500);
    return () => clearTimeout(t);
  }, [project]);

  useEffect(() => {
    localStorage.setItem('qa-evidences-last-saved', JSON.stringify(lastSavedProject));
  }, [lastSavedProject]);

  const isDirty = useMemo(() => {
    return JSON.stringify(project) !== JSON.stringify(lastSavedProject);
  }, [project, lastSavedProject]);

  const matchScenario = useCallback((sc: Scenario, idx: number, term: string): boolean => {
    if (!term.trim()) return true;
    const cleanTerm = term.toLowerCase().trim();
    const ctCode = `ct-${String(idx + 1).padStart(3, '0')}`;
    if (ctCode.includes(cleanTerm)) return true;
    if (sc.title && sc.title.toLowerCase().includes(cleanTerm)) return true;
    if (sc.bdd && sc.bdd.toLowerCase().includes(cleanTerm)) return true;
    if (sc.cardCodigo && sc.cardCodigo.toLowerCase().includes(cleanTerm)) return true;
    if (sc.cardResumo && sc.cardResumo.toLowerCase().includes(cleanTerm)) return true;
    const formattedCard = `card #${sc.cardCodigo}`.toLowerCase();
    if (formattedCard.includes(cleanTerm)) return true;
    return false;
  }, []);

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && searchQuery.trim()) {
      const cleanTerm = searchQuery.toLowerCase().trim();
      const matchIdx = project.scenarios.findIndex((s, idx) => {
        const ctCode = `ct-${String(idx + 1).padStart(3, '0')}`;
        if (ctCode.includes(cleanTerm)) return true;
        if (s.title && s.title.toLowerCase().includes(cleanTerm)) return true;
        if (s.bdd && s.bdd.toLowerCase().includes(cleanTerm)) return true;
        if (s.cardCodigo && s.cardCodigo.toLowerCase().includes(cleanTerm)) return true;
        if (s.cardResumo && s.cardResumo.toLowerCase().includes(cleanTerm)) return true;
        const formattedCard = `card #${s.cardCodigo}`.toLowerCase();
        if (formattedCard.includes(cleanTerm)) return true;
        return false;
      });

      if (matchIdx !== -1) {
        const matchId = project.scenarios[matchIdx].id;
        const el = document.getElementById(`scenario-${matchId}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          el.style.transition = 'box-shadow 0.4s, transform 0.4s';
          el.style.boxShadow = '0 0 0 4px rgba(30, 158, 34, 0.35)';
          el.style.transform = 'scale(1.01)';
          setTimeout(() => {
            el.style.boxShadow = '';
            el.style.transform = '';
          }, 1400);
          toast({
            variant: 'info',
            title: 'Cenário localizado',
            description: `Rolado até CT-${String(matchIdx + 1).padStart(3, '0')}`,
          });
        }
      } else {
        toast({
          variant: 'warning',
          title: 'Nenhum resultado',
          description: 'Nenhum cenário corresponde à busca.',
        });
      }
    }
  };

  const handleSavePlan = async (): Promise<boolean> => {
    if (!project.qaPlanId) {
      toast({
        variant: 'error',
        title: 'Não é possível salvar',
        description: 'Este projeto foi criado manualmente e não está associado a um plano do QA Assistant.',
      });
      return false;
    }

    setSaving(true);
    try {
      const { salvarPlanoQA } = await import('@/lib/supabase');
      await salvarPlanoQA(project.qaPlanId, project.scenarios);
      setLastSavedProject(project);
      toast({
        variant: 'success',
        title: 'Alterações salvas!',
        description: 'Os cenários e evidências foram atualizados no Supabase.',
      });
      return true;
    } catch (e) {
      toast({
        variant: 'error',
        title: 'Erro ao salvar plano',
        description: e instanceof Error ? e.message : 'Falha desconhecida',
      });
      return false;
    } finally {
      setSaving(false);
    }
  };

  const checkUnsavedChanges = async (actionLabel: string): Promise<boolean> => {
    if (!isDirty) return true;

    if (project.qaPlanId) {
      const saveFirst = window.confirm(
        `Você possui alterações não salvas no plano "${project.projectName || 'Sem nome'}". Deseja SALVAR estas alterações no Supabase antes de ${actionLabel}?`
      );
      if (saveFirst) {
        const success = await handleSavePlan();
        return success;
      }
      return window.confirm(`Atenção: Suas alterações serão PERDIDAS. Deseja continuar mesmo assim?`);
    } else {
      const exportFirst = window.confirm(
        `Você possui alterações não salvas. Deseja exportar o projeto como arquivo JSON antes de ${actionLabel}?`
      );
      if (exportFirst) {
        exportJson();
        return true;
      }
      return window.confirm(`Atenção: Suas alterações serão PERDIDAS. Deseja continuar mesmo assim?`);
    }
  };

  const updateScenario = useCallback((id: string, updated: Scenario) => {
    setProject((p) => ({
      ...p,
      scenarios: p.scenarios.map((s) => (s.id === id ? updated : s)),
    }));
  }, []);

  const addScenario = () => {
    const s = newScenario();
    setProject((p) => ({ ...p, scenarios: [...p.scenarios, s] }));
    setTimeout(() => {
      document.getElementById(`scenario-${s.id}`)?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  };

  const removeScenario = (id: string) => {
    if (!confirm('Remover este cenário?')) return;
    setProject((p) => ({ ...p, scenarios: p.scenarios.filter((s) => s.id !== id) }));
  };

  const reorderScenario = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    setProject((p) => {
      const arr = [...p.scenarios];
      const fromIdx = arr.findIndex((s) => s.id === fromId);
      const toIdx = arr.findIndex((s) => s.id === toId);
      if (fromIdx < 0 || toIdx < 0) return p;
      const [moved] = arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, moved);
      return { ...p, scenarios: arr };
    });
  };

  const validate = (): string | null => {
    if (!project.projectName.trim()) return 'Informe o Nome do Projeto.';
    if (!project.sprintName.trim()) return 'Informe o Nome da Sprint.';
    if (!project.version.trim()) return 'Informe a Versão.';
    if (!project.redator.trim()) return 'Informe o Nome do Redator.';
    if (!project.clientName.trim()) return 'Informe o Nome do Cliente.';
    if (project.scenarios.length === 0) return 'Adicione ao menos um cenário de teste.';
    return null;
  };

  const handleGenerate = async () => {
    const err = validate();
    if (err) {
      toast({ variant: 'error', title: 'Dados incompletos', description: err });
      return;
    }
    setGenerating(true);
    setLastDoc(null);
    setProgress(10);
    const tick = setInterval(() => setProgress((p) => Math.min(p + 8, 88)), 300);
    try {
      const doc = await generateDocument(project);
      clearInterval(tick);
      setProgress(100);
      setLastDoc(doc);
      if (doc.pdf) {
        toast({
          variant: 'success',
          title: 'Documento gerado!',
          description: 'PDF e .tex disponíveis para download.',
        });
      } else {
        toast({
          variant: 'warning',
          title: '.tex gerado — PDF indisponível',
          description: doc.pdfError || 'LaTeX não encontrado no sistema.',
        });
      }
    } catch (e) {
      clearInterval(tick);
      toast({
        variant: 'error',
        title: 'Erro ao gerar documento',
        description: e instanceof Error ? e.message : 'Falha desconhecida',
      });
    } finally {
      setGenerating(false);
      setTimeout(() => setProgress(0), 1200);
    }
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `projeto-${project.sprintName || 'qa'}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast({ variant: 'success', title: 'Projeto exportado' });
  };

  const importJson = async () => {
    const ok = await checkUnsavedChanges('importar outro projeto');
    if (ok) {
      fileInputRef.current?.click();
    }
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        const scenarios = Array.isArray(data.scenarios) ? data.scenarios.map(migrateScenario) : [];
        const newProj = { ...emptyProject, ...data, scenarios };
        setProject(newProj);
        setLastSavedProject(newProj);
        toast({ variant: 'success', title: 'Projeto importado' });
      } catch {
        toast({ variant: 'error', title: 'JSON inválido' });
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const clearProject = async () => {
    const ok = await checkUnsavedChanges('limpar o projeto');
    if (!ok) return;
    setProject(emptyProject);
    setLastSavedProject(emptyProject);
    setLastDoc(null);
    toast({ variant: 'info', title: 'Projeto limpo' });
  };

  const handleImportFromQA = async (
    scenarios: Scenario[],
    meta: { id: string; projeto: string; sprint: string; tela: string | null }
  ) => {
    const ok = await checkUnsavedChanges('importar este plano');
    if (!ok) return false;

    const newProj = {
      ...emptyProject,
      qaPlanId: meta.id,
      projectName: meta.projeto,
      sprintName: meta.sprint,
      scenarios,
    };
    setProject(newProj);
    setLastSavedProject(newProj);
    toast({
      variant: 'success',
      title: 'Plano importado do QA Assistant',
      description: `${scenarios.length} cenário(s) carregados.`,
    });
    return true;
  };

  // Chamado pelo HistoryList quando o usuário clica "Abrir no editor". Carrega
  // o project_json salvo e troca para a aba Editor. A geração subsequente cria
  // um novo documento (novo ID), preservando o original no histórico.
  const handleOpenFromHistory = async (loaded: Project) => {
    const ok = await checkUnsavedChanges('abrir este histórico');
    if (!ok) return;

    const scenarios = Array.isArray(loaded.scenarios) ? loaded.scenarios.map(migrateScenario) : [];
    const newProj = { ...emptyProject, ...loaded, scenarios };
    setProject(newProj);
    setLastSavedProject(newProj);
    setLastDoc(null);
    setView('editor');
  };

  return (
    <div className="planevidences-app">
      <Sidebar
        view={view}
        onChangeView={setView}
        onExport={exportJson}
        onImport={importJson}
        onImportFromQA={() => setQaImportOpen(true)}
        onClear={clearProject}
        scenarioCount={project.scenarios.length}
        redator={project.redator}
        clientName={project.clientName}
      />

      <ImportFromQAModal
        open={qaImportOpen}
        onClose={() => setQaImportOpen(false)}
        onImport={handleImportFromQA}
      />

      <input
        ref={fileInputRef}
        type="file"
        accept="application/json"
        className="hidden"
        onChange={handleImportFile}
      />

      <main className="main-content">
        {view === 'editor' ? (
          <>
            <div className="content-left">
              <header className="page-header">
                <div className="page-title">
                  <h1>Gerador de Evidências</h1>
                  <p>Preencha os dados, adicione cenários e gere a documentação automaticamente.</p>
                </div>
                 <div className="header-actions">
                  <Button variant="secondary" onClick={addScenario}>
                    <Plus size={16} /> Novo Cenário
                  </Button>
                  {project.qaPlanId && (
                    <Button
                      variant={isDirty ? 'primary' : 'secondary'}
                      onClick={handleSavePlan}
                      disabled={saving}
                      style={{ position: 'relative' }}
                    >
                      {saving ? (
                        <>
                          <Loader2 size={16} className="spin" /> Salvando...
                        </>
                      ) : (
                        <>
                          <Save size={16} /> Salvar Plano
                          {isDirty && (
                            <span
                              style={{
                                position: 'absolute',
                                top: -2,
                                right: -2,
                                width: 8,
                                height: 8,
                                borderRadius: '50%',
                                backgroundColor: 'var(--danger, #ef4444)',
                                border: '1px solid var(--card-bg, #fff)',
                              }}
                            />
                          )}
                        </>
                      )}
                    </Button>
                  )}
                  <Button onClick={handleGenerate} disabled={generating}>
                    {generating ? (
                      <>
                        <Loader2 size={16} className="spin" /> Gerando...
                      </>
                    ) : (
                      <>
                        <Sparkles size={16} /> Gerar Documento
                      </>
                    )}
                  </Button>
                </div>
              </header>

              {generating && (
                <div className="card" style={{ padding: 20 }}>
                  <p style={{ fontWeight: 600, marginBottom: 10 }}>Processando documento...</p>
                  <Progress value={progress} />
                  <p
                    style={{
                      fontSize: 12,
                      color: 'var(--text-secondary)',
                      marginTop: 8,
                    }}
                  >
                    Gerando LaTeX e compilando PDF. Pode levar alguns segundos.
                  </p>
                </div>
              )}

              {lastDoc && (
                <div className="result-card">
                  <div className="result-icon">
                    <Sparkles size={22} />
                  </div>
                  <div className="result-info">
                    <h4>Documento pronto!</h4>
                    <p>{lastDoc.baseName}</p>
                    {lastDoc.pdfError && (
                      <span className="result-warning">
                        <AlertCircle size={12} /> {lastDoc.pdfError}
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <a
                      className="btn btn-secondary btn-sm"
                      href={resolveAssetUrl(lastDoc.tex)}
                      target="_blank"
                      rel="noopener noreferrer"
                      download
                    >
                      <FileType size={14} /> .tex
                    </a>
                    {lastDoc.pdf ? (
                      <a
                        className="btn btn-primary btn-sm"
                        href={resolveAssetUrl(lastDoc.pdf)}
                        target="_blank"
                        rel="noopener noreferrer"
                        download
                      >
                        <Download size={14} /> PDF
                      </a>
                    ) : (
                      <button className="btn btn-primary btn-sm" disabled>
                        <Download size={14} /> PDF
                      </button>
                    )}
                  </div>
                </div>
              )}

              <ProjectForm project={project} onChange={setProject} />

              <section style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: 12,
                  }}
                >
                  <div>
                    <h2 style={{ fontSize: 22, fontWeight: 700 }}>Cenários de Teste</h2>
                    <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                      {project.scenarios.length} cenário(s) cadastrado(s) — arraste para reordenar.
                    </p>
                  </div>
                  <Button onClick={addScenario}>
                    <Plus size={16} /> Adicionar Novo Cenário
                  </Button>
                </div>

                {project.scenarios.length > 0 && (
                  <div style={{ position: 'relative', width: '100%' }}>
                    <Search
                      size={16}
                      style={{
                        position: 'absolute',
                        left: 12,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        color: 'var(--text-secondary)',
                      }}
                    />
                    <input
                      type="text"
                      placeholder="Buscar por título, CT, BDD ou Card (ex: Card #23494)... [Pressione Enter para ir até o cenário]"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={handleSearchKeyDown}
                      className="input"
                      style={{ paddingLeft: 36, paddingRight: searchQuery ? 80 : 12, width: '100%', height: 40 }}
                    />
                    {searchQuery && (
                      <button
                        onClick={() => setSearchQuery('')}
                        style={{
                          position: 'absolute',
                          right: 12,
                          top: '50%',
                          transform: 'translateY(-50%)',
                          background: 'none',
                          border: 'none',
                          color: 'var(--text-secondary)',
                          cursor: 'pointer',
                          fontWeight: 500,
                          fontSize: 13,
                        }}
                      >
                        Limpar
                      </button>
                    )}
                  </div>
                )}

                {project.scenarios.length === 0 ? (
                  <div className="card">
                    <div className="empty-state">
                      <div className="empty-state-icon">
                        <Plus size={24} />
                      </div>
                      <h3>Nenhum cenário ainda</h3>
                      <p>Clique no botão acima para começar.</p>
                      <Button variant="secondary" onClick={addScenario}>
                        <Plus size={16} /> Adicionar primeiro cenário
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
                    {(() => {
                      const indiceGlobal = new Map(project.scenarios.map((s, i) => [s.id, i]));
                      return agruparCenariosPorCard(project.scenarios).map((g) => {
                        const titulo = tituloCardParaExibicao(g.codigo, g.resumo);
                        const temCard = !!g.codigo;
                        const groupScenarios = g.scenarios;
                        const hasMatchingScenario = groupScenarios.some((s) =>
                          matchScenario(s, indiceGlobal.get(s.id) ?? 0, searchQuery)
                        );

                        return (
                          <div
                            key={g.codigo || 'sem-card'}
                            className="card-group"
                            style={{
                              opacity: searchQuery && !hasMatchingScenario ? 0.4 : 1,
                              transition: 'opacity 0.3s',
                            }}
                          >
                            {temCard && (
                              <div className="card-group-header">
                                <h3>{titulo}</h3>
                                {g.caminho && (
                                  <p className="card-group-path">
                                    <strong>Caminho:</strong> {g.caminho}
                                  </p>
                                )}
                                <span className="card-group-count">
                                  {g.scenarios.length} cenário{g.scenarios.length !== 1 ? 's' : ''}
                                </span>
                              </div>
                            )}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                              {g.scenarios.map((s) => {
                                const idx = indiceGlobal.get(s.id) ?? 0;
                                const isMatched = matchScenario(s, idx, searchQuery);
                                return (
                                  <div
                                    key={s.id}
                                    style={{
                                      opacity: searchQuery && !isMatched ? 0.35 : 1,
                                      transition: 'opacity 0.3s',
                                    }}
                                  >
                                    <ScenarioCard
                                      scenario={s}
                                      index={idx}
                                      sessionId={sessionId}
                                      onChange={(u) => updateScenario(s.id, u)}
                                      onRemove={() => removeScenario(s.id)}
                                      onDragStart={() => setDraggingId(s.id)}
                                      onDragOver={(e) => e.preventDefault()}
                                      onDrop={() => {
                                        if (draggingId) reorderScenario(draggingId, s.id);
                                        setDraggingId(null);
                                      }}
                                      isDragging={draggingId === s.id}
                                    />
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      });
                    })()}
                  </div>
                )}
              </section>
            </div>

            <RightPanel
              scenarios={project.scenarios}
              lastDoc={lastDoc}
              searchQuery={searchQuery}
              onChangeSearchQuery={setSearchQuery}
            />
          </>
        ) : (
          <div className="content-left">
            <HistoryList onOpenProject={handleOpenFromHistory} />
          </div>
        )}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <ToastsProvider>
        <AppInner />
      </ToastsProvider>
    </ThemeProvider>
  );
}
