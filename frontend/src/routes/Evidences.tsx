import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  Plus,
  Sparkles,
  Loader2,
  FileType,
  Download,
  AlertCircle,
  Save,
  Search,
  Share2,
  Check,
  CloudOff,
  ArrowUp,
} from 'lucide-react';
import { Sidebar } from '@/components/Sidebar';
import { ProjectForm } from '@/components/ProjectForm';
import { ScenarioCard } from '@/components/ScenarioCard';
import { HistoryList } from '@/components/HistoryList';
import { RightPanel } from '@/components/RightPanel';
import { ImportFromQAModal } from '@/components/ImportFromQAModal';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/useToast';
import { generateDocument, resolveAssetUrl } from '@/lib/api';
import { salvarPlanoQA } from '@/lib/supabase';
import {
  loadEvidenceProject,
  subscribeEvidenceProject,
  upsertEvidenceProject,
} from '@/lib/evidenceProjects';
import { agruparCenariosPorCard, tituloCardParaExibicao, getErrorMessage } from '@/lib/utils';
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

interface IncomingFromQA {
  fromQA: true;
  scenarios: Scenario[];
  meta: { projeto: string; sprint: string };
}

// Badge no header mostrando estado de sincronização com Supabase.
// 4 estados: Salvando | Não-sincronizado (dirty) | Sincronizado | Apenas-local (sem id ainda).
function SyncStatus({
  autoSaving,
  isDirty,
  lastSyncAt,
  evidenceId,
}: {
  autoSaving: boolean;
  isDirty: boolean;
  lastSyncAt: Date | null;
  evidenceId: string | null;
}) {
  let icon: JSX.Element;
  let label: string;
  let color: string;

  if (autoSaving) {
    icon = <Loader2 size={12} className="spin" />;
    label = 'Salvando...';
    color = 'var(--text-secondary)';
  } else if (!evidenceId) {
    icon = <CloudOff size={12} />;
    label = 'Apenas local';
    color = 'var(--warning, #d97706)';
  } else if (isDirty) {
    icon = <AlertCircle size={12} />;
    label = 'Alterações não salvas';
    color = 'var(--warning, #d97706)';
  } else {
    icon = <Check size={12} />;
    label = lastSyncAt ? `Sincronizado ${lastSyncAt.toLocaleTimeString('pt-BR')}` : 'Sincronizado';
    color = 'var(--accent, #1e9e22)';
  }

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 12,
        fontWeight: 600,
        color,
        padding: '4px 10px',
        borderRadius: 999,
        border: `1px solid ${color}`,
        background: 'transparent',
        whiteSpace: 'nowrap',
      }}
      title={
        evidenceId
          ? 'Auto-save no Supabase a cada 3s. Outros QAs com a mesma URL veem suas mudanças em tempo real.'
          : 'Projeto ainda não foi salvo no Supabase. Clique em "Salvar e compartilhar" pra gerar uma URL.'
      }
    >
      {icon}
      {label}
    </span>
  );
}

export default function Evidences() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const { id: routeId } = useParams<{ id?: string }>();
  const sessionId = useMemo(getSessionId, []);
  const incomingHandledRef = useRef(false);
  // Bandeira que indica "estado vindo do servidor — não dispare auto-save".
  // Evita loop: hydrate → setProject → auto-save → save no servidor → realtime
  // → setProject → … Cobrimos tanto o load inicial quanto updates via Realtime.
  const isHydratingRef = useRef(false);
  // ID da row em evidence_projects (null = projeto local não salvo ainda).
  const [evidenceId, setEvidenceId] = useState<string | null>(() => {
    return routeId || localStorage.getItem('qa-evidences-project-id') || null;
  });
  const [draftId, setDraftId] = useState<string>(() => {
    let id = localStorage.getItem('qa-evidences-draft-id');
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem('qa-evidences-draft-id', id);
    }
    return id;
  });
  const deletedScenariosRef = useRef<{ scenario: Scenario; index: number }[]>([]);

  const [autoSaving, setAutoSaving] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);
  const [loadingShared, setLoadingShared] = useState(false);
  // Salva-as-server-version: usado pra ignorar eventos Realtime do nosso próprio save.
  const lastSavedAtRef = useRef<string | null>(null);
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
  const [showBackToTop, setShowBackToTop] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sincroniza ID na URL e no localStorage
  useEffect(() => {
    if (evidenceId) {
      localStorage.setItem('qa-evidences-project-id', evidenceId);
      if (!routeId) {
        navigate(`/evidences/${evidenceId}`, { replace: true });
      }
    } else {
      localStorage.removeItem('qa-evidences-project-id');
      if (routeId) {
        navigate('/evidences', { replace: true });
      }
    }
  }, [evidenceId, routeId, navigate]);

  // Persistência automática do rascunho em edição
  useEffect(() => {
    const t = setTimeout(() => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(project));

      // Atualiza a lista histórica de rascunhos locais/remotos em progresso
      try {
        const id = evidenceId || draftId;
        const draftsJson = localStorage.getItem('qa-evidences-local-drafts');
        let drafts: any[] = [];
        if (draftsJson) {
          drafts = JSON.parse(draftsJson);
        }
        drafts = drafts.filter((d) => d.id !== id);
        drafts.unshift({
          id,
          projectName: project.projectName || 'Sem nome',
          sprintName: project.sprintName || '',
          updatedAt: new Date().toISOString(),
          project,
          evidenceId: evidenceId || null,
        });
        if (drafts.length > 20) {
          drafts = drafts.slice(0, 20);
        }
        localStorage.setItem('qa-evidences-local-drafts', JSON.stringify(drafts));
      } catch (e) {
        console.error('[Evidences] Falha ao atualizar histórico de rascunhos:', e);
      }
    }, 500);
    return () => clearTimeout(t);
  }, [project, evidenceId, draftId]);

  useEffect(() => {
    localStorage.setItem('qa-evidences-last-saved', JSON.stringify(lastSavedProject));
  }, [lastSavedProject]);

  useEffect(() => {
    const handleScroll = () => {
      setShowBackToTop(window.scrollY > 300);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Recebe cenários do Gerador de Casos (rota /qa). O ref evita que HMR/re-render
  // dispare a importação duas vezes, e o navigate(replace) limpa o state pra o
  // refresh da página não re-importar.
  useEffect(() => {
    const state = location.state as IncomingFromQA | null;
    if (!state?.fromQA || incomingHandledRef.current) return;
    incomingHandledRef.current = true;

    handleImportFromQA(state.scenarios, {
      id: '',
      projeto: state.meta.projeto,
      sprint: state.meta.sprint,
      tela: null,
    });

    navigate(location.pathname, { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  // Carrega um projeto compartilhado quando a URL tem /evidences/:id.
  // Marca isHydratingRef pra o auto-save não disparar imediatamente após o load.
  useEffect(() => {
    if (!routeId) return;
    setLoadingShared(true);
    isHydratingRef.current = true;
    loadEvidenceProject(routeId)
      .then((record) => {
        const restored = {
          ...emptyProject,
          ...record.project_json,
          scenarios: Array.isArray(record.project_json?.scenarios)
            ? record.project_json.scenarios.map(migrateScenario)
            : [],
        };
        setProject(restored);
        setLastSavedProject(restored);
        setEvidenceId(record.id);
        setLastSyncAt(new Date(record.updated_at));
        lastSavedAtRef.current = record.updated_at;
        toast({
          variant: 'info',
          title: 'Projeto compartilhado carregado',
          description: `${record.project_name} — última alteração ${new Date(record.updated_at).toLocaleString('pt-BR')}`,
        });
      })
      .catch((err) => {
        toast({
          variant: 'error',
          title: 'Falha ao carregar projeto compartilhado',
          description: getErrorMessage(err),
        });
      })
      .finally(() => {
        setLoadingShared(false);
        // Solta o flag no próximo tick — depois do setProject ter rodado
        setTimeout(() => {
          isHydratingRef.current = false;
        }, 0);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeId]);

  const isDirty = useMemo(() => {
    return JSON.stringify(project) !== JSON.stringify(lastSavedProject);
  }, [project, lastSavedProject]);

  // Auto-save no Supabase com debounce de 3s. Cria a row na primeira gravação
  // (updateia a URL pra /evidences/:id) ou atualiza a existente.
  // Pula quando estamos hidratando do servidor (load inicial ou Realtime update).
  const handleAutoSave = useCallback(async () => {
    if (isHydratingRef.current) return;
    setAutoSaving(true);
    try {
      const result = await upsertEvidenceProject({ id: evidenceId, project });
      lastSavedAtRef.current = result.updated_at;
      setLastSyncAt(new Date(result.updated_at));
      setLastSavedProject(project);
      if (!evidenceId) {
        // Primeira gravação: muda URL pra refletir o id (sem reload)
        setEvidenceId(result.id);
        navigate(`/evidences/${result.id}`, { replace: true });
      }
    } catch (e) {
      toast({
        variant: 'error',
        title: 'Falha ao salvar',
        description: getErrorMessage(e),
      });
    } finally {
      setAutoSaving(false);
    }
  }, [evidenceId, project, navigate, toast]);

  useEffect(() => {
    if (isHydratingRef.current) return;
    if (!isDirty) return;
    const handle = setTimeout(() => {
      void handleAutoSave();
    }, 3000);
    return () => clearTimeout(handle);
  }, [project, isDirty, handleAutoSave]);

  // Realtime: quando outro QA salvar este projeto, recebe o novo estado e
  // sobrescreve o local (toast informa quem mexeu). Ignora events do próprio
  // save comparando updated_at com o que acabamos de gravar.
  useEffect(() => {
    if (!evidenceId) return;
    const unsubscribe = subscribeEvidenceProject(evidenceId, (incoming) => {
      if (lastSavedAtRef.current === incoming.updated_at) return; // nosso próprio save
      isHydratingRef.current = true;
      const restored = {
        ...emptyProject,
        ...incoming.project_json,
        scenarios: Array.isArray(incoming.project_json?.scenarios)
          ? incoming.project_json.scenarios.map(migrateScenario)
          : [],
      };
      setProject(restored);
      setLastSavedProject(restored);
      lastSavedAtRef.current = incoming.updated_at;
      setLastSyncAt(new Date(incoming.updated_at));
      setTimeout(() => {
        isHydratingRef.current = false;
      }, 0);
      toast({
        variant: 'info',
        title: 'Atualizado por outro QA',
        description: `Sincronizado às ${new Date(incoming.updated_at).toLocaleTimeString('pt-BR')}`,
      });
    });
    return unsubscribe;
  }, [evidenceId, toast]);

  const handleManualSave = async () => {
    await handleAutoSave();
    if (!isHydratingRef.current) {
      toast({ variant: 'success', title: 'Salvo' });
    }
  };

  const handleShare = async () => {
    if (!evidenceId) {
      // Força um save imediato pra criar o id
      await handleAutoSave();
      if (!evidenceId) return; // se mesmo assim falhou, sai
    }
    const id = evidenceId || lastSavedAtRef.current; // fallback
    const url = `${window.location.origin}/evidences/${id || ''}`;
    try {
      await navigator.clipboard.writeText(url);
      toast({
        variant: 'success',
        title: 'Link copiado',
        description: 'Cole no Slack/Teams pra outros QAs editarem em tempo real.',
      });
    } catch {
      toast({
        variant: 'info',
        title: 'URL pronta — copie manualmente',
        description: url,
      });
    }
  };

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
    let supabaseOk = false;
    try {
      await salvarPlanoQA(project.qaPlanId, project.scenarios);
      supabaseOk = true;
      setLastSavedProject(project);

      const doc = await generateDocument(project);
      setLastDoc(doc);

      toast({
        variant: 'success',
        title: 'Plano salvo e gerado!',
        description: 'Alterações salvas no Supabase e documento registrado no Histórico com sucesso.',
      });
      return true;
    } catch (e) {
      if (supabaseOk) {
        toast({
          variant: 'warning',
          title: 'Salvo no Supabase, mas falhou no Histórico',
          description: getErrorMessage(e),
        });
        return true;
      } else {
        toast({
          variant: 'error',
          title: 'Erro ao salvar plano',
          description: getErrorMessage(e),
        });
        return false;
      }
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

  const undoDelete = useCallback(() => {
    const lastDeleted = deletedScenariosRef.current.pop();
    if (!lastDeleted) return;

    setProject((p) => {
      const arr = [...p.scenarios];
      arr.splice(lastDeleted.index, 0, lastDeleted.scenario);
      return { ...p, scenarios: arr };
    });

    toast({
      variant: 'success',
      title: 'Cenário restaurado',
      description: `O cenário "${lastDeleted.scenario.title || 'Sem título'}" foi recuperado com sucesso.`,
    });
  }, [toast]);

  // Listener para Ctrl+Z para desfazer remoção
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        const activeEl = document.activeElement;
        if (
          activeEl &&
          (activeEl.tagName === 'INPUT' ||
            activeEl.tagName === 'TEXTAREA' ||
            activeEl.getAttribute('contenteditable') === 'true')
        ) {
          return;
        }
        if (deletedScenariosRef.current.length > 0) {
          e.preventDefault();
          undoDelete();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undoDelete]);

  const addScenario = () => {
    const s = newScenario();
    setProject((p) => ({ ...p, scenarios: [...p.scenarios, s] }));
    setTimeout(() => {
      document.getElementById(`scenario-${s.id}`)?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  };

  const addScenarioToCard = (
    codigo: string | null,
    resumo: string | null,
    caminho: string | null,
    lastScenarioId: string
  ) => {
    const s = {
      ...newScenario(),
      cardCodigo: codigo,
      cardResumo: resumo,
      cardCaminho: caminho,
    };
    setProject((p) => {
      const idx = p.scenarios.findIndex((sc) => sc.id === lastScenarioId);
      if (idx === -1) {
        return { ...p, scenarios: [...p.scenarios, s] };
      }
      const newScenarios = [...p.scenarios];
      newScenarios.splice(idx + 1, 0, s);
      return { ...p, scenarios: newScenarios };
    });
    setTimeout(() => {
      document.getElementById(`scenario-${s.id}`)?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  };

  const removeScenario = (id: string) => {
    const idx = project.scenarios.findIndex((s) => s.id === id);
    if (idx === -1) return;
    const scenario = project.scenarios[idx];

    // Salva na pilha de remoções
    deletedScenariosRef.current.push({ scenario, index: idx });

    // Remove do projeto
    setProject((p) => ({ ...p, scenarios: p.scenarios.filter((s) => s.id !== id) }));

    // Mostra Toast com botão de Desfazer
    toast({
      variant: 'info',
      title: 'Cenário removido',
      description: `O cenário "${scenario.title || 'Sem título'}" foi removido.`,
      action: (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => undoDelete()}
          style={{
            height: 28,
            fontSize: 12,
            padding: '0 10px',
            backgroundColor: 'var(--card-bg, #ffffff)',
            borderColor: 'var(--border, #e2e8f0)',
            color: 'var(--text-primary, #0f172a)',
            fontWeight: 600
          }}
        >
          Desfazer
        </Button>
      )
    });
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
        description: getErrorMessage(e),
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
    setEvidenceId(null);
    localStorage.removeItem('qa-evidences-project-id');
    const newDraftId = crypto.randomUUID();
    setDraftId(newDraftId);
    localStorage.setItem('qa-evidences-draft-id', newDraftId);
    navigate('/evidences', { replace: true });
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
    
    // Novo plano importado do QA vira um rascunho separado
    setEvidenceId(null);
    localStorage.removeItem('qa-evidences-project-id');
    const newDraftId = crypto.randomUUID();
    setDraftId(newDraftId);
    localStorage.setItem('qa-evidences-draft-id', newDraftId);
    navigate('/evidences', { replace: true });

    toast({
      variant: 'success',
      title: 'Plano importado do QA Assistant',
      description: `${scenarios.length} cenário(s) carregados.`,
    });
    return true;
  };

  const handleOpenFromHistory = async (loaded: Project, id: string | null = null, draftIdParam: string | null = null) => {
    const ok = await checkUnsavedChanges('abrir este histórico');
    if (!ok) return;

    const scenarios = Array.isArray(loaded.scenarios) ? loaded.scenarios.map(migrateScenario) : [];
    const newProj = { ...emptyProject, ...loaded, scenarios };
    setProject(newProj);
    setLastSavedProject(newProj);
    
    setEvidenceId(id);
    if (id) {
      localStorage.setItem('qa-evidences-project-id', id);
      navigate(`/evidences/${id}`, { replace: true });
    } else {
      localStorage.removeItem('qa-evidences-project-id');
      navigate('/evidences', { replace: true });
    }

    const targetDraftId = draftIdParam || id || crypto.randomUUID();
    setDraftId(targetDraftId);
    localStorage.setItem('qa-evidences-draft-id', targetDraftId);

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
                  <SyncStatus
                    autoSaving={autoSaving}
                    isDirty={isDirty}
                    lastSyncAt={lastSyncAt}
                    evidenceId={evidenceId}
                  />
                  <Button variant="secondary" onClick={addScenario}>
                    <Plus size={16} /> Novo Cenário
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={handleManualSave}
                    disabled={autoSaving || (!isDirty && !!evidenceId)}
                    title={evidenceId ? 'Forçar salvamento agora' : 'Criar projeto compartilhável e salvar'}
                  >
                    {autoSaving ? <Loader2 size={16} className="spin" /> : <Save size={16} />}
                    {evidenceId ? 'Salvar' : 'Salvar e compartilhar'}
                  </Button>
                  {evidenceId && (
                    <Button variant="secondary" onClick={handleShare} title="Copiar URL pra outro QA editar junto">
                      <Share2 size={16} /> Compartilhar
                    </Button>
                  )}
                  {project.qaPlanId && (
                    <Button
                      variant="secondary"
                      onClick={handleSavePlan}
                      disabled={saving}
                      title="Atualizar também o plano original no QA Assistant (mantém o /qa em sincronia)"
                    >
                      {saving ? <Loader2 size={16} className="spin" /> : <Save size={16} />}
                      Sync QA Plan
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

              {loadingShared && (
                <div
                  className="card"
                  style={{
                    padding: 14,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    fontSize: 13,
                    color: 'var(--text-secondary)',
                  }}
                >
                  <Loader2 size={16} className="spin" /> Carregando projeto compartilhado...
                </div>
              )}

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
                              <div className="card-group-header" style={{
                                display: 'flex',
                                flexDirection: 'row',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                gap: 16
                              }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}>
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
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => addScenarioToCard(g.codigo, g.resumo, g.caminho, groupScenarios[groupScenarios.length - 1].id)}
                                  style={{
                                    height: 32,
                                    fontSize: 12,
                                    gap: 4,
                                    padding: '0 12px',
                                    whiteSpace: 'nowrap'
                                  }}
                                  title="Adicionar caso de teste para este card/HU"
                                >
                                  <Plus size={14} /> Novo Cenário
                                </Button>
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

      <button
        onClick={scrollToTop}
        className={`back-to-top ${showBackToTop ? 'visible' : ''}`}
        title="Voltar ao topo"
      >
        <ArrowUp size={22} />
      </button>
    </div>
  );
}
