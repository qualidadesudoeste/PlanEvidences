import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Sparkles, Loader2, FileType, Download, AlertCircle } from 'lucide-react';
import { Sidebar } from '@/components/Sidebar';
import { ProjectForm } from '@/components/ProjectForm';
import { ScenarioCard } from '@/components/ScenarioCard';
import { HistoryList } from '@/components/HistoryList';
import { RightPanel } from '@/components/RightPanel';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ThemeProvider } from '@/hooks/useTheme';
import { ToastsProvider, useToast } from '@/hooks/useToast';
import { generateDocument, resolveAssetUrl } from '@/lib/api';
import type { GeneratedDoc, Project, Scenario } from '@/types';

const STORAGE_KEY = 'qa-evidences-project';
const SESSION_KEY = 'qa-evidences-session';

const emptyProject: Project = {
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
  if (typeof s?.bdd === 'string') return { ...newScenario(), ...s };
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
  const [view, setView] = useState<'editor' | 'history'>('editor');
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [lastDoc, setLastDoc] = useState<GeneratedDoc | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
    }, 500);
    return () => clearTimeout(t);
  }, [project]);

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

  const importJson = () => fileInputRef.current?.click();

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        const scenarios = Array.isArray(data.scenarios) ? data.scenarios.map(migrateScenario) : [];
        setProject({ ...emptyProject, ...data, scenarios });
        toast({ variant: 'success', title: 'Projeto importado' });
      } catch {
        toast({ variant: 'error', title: 'JSON inválido' });
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const clearProject = () => {
    if (!confirm('Deseja realmente limpar todo o projeto? Esta ação não pode ser desfeita.')) return;
    setProject(emptyProject);
    setLastDoc(null);
    toast({ variant: 'info', title: 'Projeto limpo' });
  };

  return (
    <div className="planevidences-app">
      <Sidebar
        view={view}
        onChangeView={setView}
        onExport={exportJson}
        onImport={importJson}
        onClear={clearProject}
        scenarioCount={project.scenarios.length}
        redator={project.redator}
        clientName={project.clientName}
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
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    {project.scenarios.map((s, idx) => (
                      <ScenarioCard
                        key={s.id}
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
                    ))}
                  </div>
                )}
              </section>
            </div>

            <RightPanel scenarios={project.scenarios} lastDoc={lastDoc} />
          </>
        ) : (
          <div className="content-left">
            <HistoryList />
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
