import { useEffect, useState } from 'react';
import {
  Download,
  FileText,
  FileType,
  History,
  RefreshCw,
  Trash2,
  AlertCircle,
  Pencil,
  Loader2,
  Cloud,
  CloudOff,
  Clock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { listDocuments, deleteDocument, resolveAssetUrl, getDocumentProject } from '@/lib/api';
import {
  listEvidenceProjects,
  deleteEvidenceProject,
  loadEvidenceProject
} from '@/lib/evidenceProjects';
import { supabaseEnabled } from '@/lib/supabase';
import { useToast } from '@/hooks/useToast';
import { formatBytes, formatDate, getErrorMessage } from '@/lib/utils';
import type { GeneratedDoc, Project } from '@/types';

interface HistoryListProps {
  onOpenProject?: (project: Project, id?: string | null, draftId?: string | null) => void;
}

interface EditingProjectItem {
  id: string;
  evidenceId: string | null;
  projectName: string;
  sprintName: string;
  updatedAt: string;
  project: Project | null;
  isRemote: boolean;
  isLocalOnly: boolean;
}

export function HistoryList({ onOpenProject }: HistoryListProps = {}) {
  const [activeTab, setActiveTab] = useState<'compiled' | 'editing'>('compiled');
  
  // State for Compiled Documents
  const [compiledDocs, setCompiledDocs] = useState<GeneratedDoc[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [openingDocId, setOpeningDocId] = useState<string | null>(null);

  // State for Editing Projects (Drafts)
  const [editingProjects, setEditingProjects] = useState<EditingProjectItem[]>([]);
  const [loadingEditing, setLoadingEditing] = useState(false);
  const [openingEditingId, setOpeningEditingId] = useState<string | null>(null);

  const { toast } = useToast();

  const loadDocs = async () => {
    setLoadingDocs(true);
    try {
      const { items } = await listDocuments();
      setCompiledDocs(items);
    } catch (err) {
      toast({
        variant: 'error',
        title: 'Erro ao carregar histórico',
        description: getErrorMessage(err),
      });
    } finally {
      setLoadingDocs(false);
    }
  };

  const loadEditingProjects = async () => {
    setLoadingEditing(true);
    try {
      // 1. Carrega rascunhos locais
      const localJson = localStorage.getItem('qa-evidences-local-drafts');
      let localDrafts: any[] = [];
      if (localJson) {
        try {
          localDrafts = JSON.parse(localJson);
        } catch {}
      }

      // 2. Carrega rascunhos do Supabase se ativo
      let remoteList: any[] = [];
      const hasSupabase = supabaseEnabled();
      if (hasSupabase) {
        try {
          remoteList = await listEvidenceProjects();
        } catch (e) {
          console.warn('[HistoryList] Falha ao carregar rascunhos do Supabase:', e);
        }
      }

      // 3. Combina rascunhos locais e remotos
      const combined: EditingProjectItem[] = [];
      const seenIds = new Set<string>();

      localDrafts.forEach((draft) => {
        const isRemote = remoteList.some((r) => r.id === draft.id || r.id === draft.evidenceId);
        combined.push({
          id: draft.id,
          evidenceId: draft.evidenceId || null,
          projectName: draft.projectName || 'Sem nome',
          sprintName: draft.sprintName || '',
          updatedAt: draft.updatedAt || new Date().toISOString(),
          project: draft.project,
          isRemote,
          isLocalOnly: !draft.evidenceId,
        });
        if (draft.evidenceId) seenIds.add(draft.evidenceId);
        seenIds.add(draft.id);
      });

      remoteList.forEach((remote) => {
        if (!seenIds.has(remote.id)) {
          combined.push({
            id: remote.id,
            evidenceId: remote.id,
            projectName: remote.project_name || 'Sem nome',
            sprintName: remote.sprint_name || '',
            updatedAt: remote.updated_at || new Date().toISOString(),
            project: null,
            isRemote: true,
            isLocalOnly: false,
          });
        }
      });

      // Ordena por updatedAt decrescente
      combined.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      setEditingProjects(combined);
    } catch (err) {
      toast({
        variant: 'error',
        title: 'Erro ao carregar rascunhos',
        description: getErrorMessage(err),
      });
    } finally {
      setLoadingEditing(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'compiled') {
      loadDocs();
    } else {
      loadEditingProjects();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const handleDeleteDoc = async (id: string) => {
    if (!confirm('Remover este documento?')) return;
    try {
      await deleteDocument(id);
      setCompiledDocs((prev) => prev.filter((d) => d.id !== id));
      toast({ variant: 'success', title: 'Documento removido' });
    } catch (err) {
      toast({
        variant: 'error',
        title: 'Erro ao deletar documento',
        description: getErrorMessage(err),
      });
    }
  };

  const handleDeleteEditingProject = async (item: EditingProjectItem) => {
    if (!confirm(`Excluir o rascunho de "${item.projectName}"? Esta ação não pode ser desfeita.`)) return;
    
    try {
      // 1. Deleta do Supabase se remoto
      if (item.evidenceId) {
        await deleteEvidenceProject(item.evidenceId);
      }

      // 2. Deleta do localStorage
      const localJson = localStorage.getItem('qa-evidences-local-drafts');
      if (localJson) {
        try {
          const drafts = JSON.parse(localJson);
          const updatedDrafts = drafts.filter((d: any) => d.id !== item.id && d.evidenceId !== item.evidenceId);
          localStorage.setItem('qa-evidences-local-drafts', JSON.stringify(updatedDrafts));
        } catch {}
      }

      // 3. Se o rascunho excluído for o que está aberto atualmente no editor, removemos do STORAGE_KEY
      const activeProjId = localStorage.getItem('qa-evidences-project-id');
      const activeDraftId = localStorage.getItem('qa-evidences-draft-id');
      if (item.id === activeDraftId || (item.evidenceId && item.evidenceId === activeProjId)) {
        localStorage.removeItem('qa-evidences-project-id');
        localStorage.removeItem('qa-evidences-draft-id');
        localStorage.removeItem('qa-evidences-project');
      }

      setEditingProjects((prev) => prev.filter((p) => p.id !== item.id));
      toast({ variant: 'success', title: 'Rascunho excluído com sucesso' });
    } catch (err) {
      toast({
        variant: 'error',
        title: 'Erro ao excluir rascunho',
        description: getErrorMessage(err),
      });
    }
  };

  const handleOpenDoc = async (doc: GeneratedDoc) => {
    if (!onOpenProject) return;
    setOpeningDocId(doc.id);
    try {
      const project = await getDocumentProject(doc.id);
      onOpenProject(project, null, null);
      toast({
        variant: 'success',
        title: 'Projeto carregado',
        description: 'Edite os cenários e clique em "Gerar Documento" para criar uma nova versão.',
      });
    } catch (err) {
      toast({
        variant: 'error',
        title: 'Não foi possível abrir',
        description: getErrorMessage(err),
      });
    } finally {
      setOpeningDocId(null);
    }
  };

  const handleOpenEditingProject = async (item: EditingProjectItem) => {
    if (!onOpenProject) return;
    setOpeningEditingId(item.id);
    try {
      let projectToLoad = item.project;
      
      // Se não temos o JSON localmente (remoto apenas), buscamos do Supabase
      if (!projectToLoad && item.evidenceId) {
        const record = await loadEvidenceProject(item.evidenceId);
        projectToLoad = record.project_json;
      }

      if (!projectToLoad) {
        throw new Error('Os dados do projeto estão indisponíveis.');
      }

      onOpenProject(projectToLoad, item.evidenceId, item.id);
      toast({
        variant: 'success',
        title: 'Rascunho carregado',
        description: 'Você pode continuar editando suas evidências agora.',
      });
    } catch (err) {
      toast({
        variant: 'error',
        title: 'Erro ao abrir rascunho',
        description: getErrorMessage(err),
      });
    } finally {
      setOpeningEditingId(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div className="page-header">
        <div className="page-title">
          <h1
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 12,
              fontSize: 28,
            }}
          >
            <History size={28} style={{ color: 'var(--primary)' }} />
            Histórico e Rascunhos
          </h1>
          <p>Gerencie seus documentos gerados e rascunhos em andamento.</p>
        </div>
        <div className="header-actions">
          <Button
            variant="secondary"
            size="sm"
            onClick={activeTab === 'compiled' ? loadDocs : loadEditingProjects}
            disabled={loadingDocs || loadingEditing}
          >
            <RefreshCw size={16} className={loadingDocs || loadingEditing ? 'spin' : ''} />
            Atualizar
          </Button>
        </div>
      </div>

      {/* Tabs Header */}
      <div
        style={{
          display: 'flex',
          gap: 24,
          borderBottom: '1px solid var(--border, #e2e8f0)',
          paddingBottom: 2,
          marginBottom: 8,
        }}
      >
        <button
          type="button"
          onClick={() => setActiveTab('compiled')}
          style={{
            background: 'none',
            border: 'none',
            padding: '12px 4px',
            fontSize: 15,
            fontWeight: 600,
            color: activeTab === 'compiled' ? 'var(--primary, #2563eb)' : 'var(--text-secondary, #64748b)',
            borderBottom: activeTab === 'compiled' ? '3px solid var(--primary, #2563eb)' : '3px solid transparent',
            cursor: 'pointer',
            transition: 'all 0.2s',
          }}
        >
          Documentos Gerados ({compiledDocs.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('editing')}
          style={{
            background: 'none',
            border: 'none',
            padding: '12px 4px',
            fontSize: 15,
            fontWeight: 600,
            color: activeTab === 'editing' ? 'var(--primary, #2563eb)' : 'var(--text-secondary, #64748b)',
            borderBottom: activeTab === 'editing' ? '3px solid var(--primary, #2563eb)' : '3px solid transparent',
            cursor: 'pointer',
            transition: 'all 0.2s',
          }}
        >
          Projetos em Edição ({editingProjects.length})
        </button>
      </div>

      {/* Compiled Documents Tab */}
      {activeTab === 'compiled' && (
        <>
          {compiledDocs.length === 0 && !loadingDocs && (
            <div className="card">
              <div className="empty-state">
                <div className="empty-state-icon">
                  <FileText size={28} />
                </div>
                <h3>Nenhum documento gerado ainda</h3>
                <p>Vá ao Editor e gere seu primeiro documento.</p>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {compiledDocs.map((doc) => (
              <div key={doc.id} className="history-item">
                <div className="history-icon">
                  <FileText size={24} />
                </div>
                <div className="history-info">
                  <h4>
                    {doc.clientName} — {doc.sprintName} (v{doc.version})
                  </h4>
                  <p>
                    {doc.projectName} · {doc.redator}
                  </p>
                  <time>{formatDate(doc.createdAt)}</time>
                  {doc.pdfError && (
                    <div
                      style={{
                        marginTop: 4,
                        fontSize: 11,
                        color: 'var(--warning)',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      <AlertCircle size={12} /> PDF não gerado: {doc.pdfError}
                    </div>
                  )}
                </div>
                <div className="history-actions">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => handleOpenDoc(doc)}
                    disabled={!doc.hasProject || !onOpenProject || openingDocId === doc.id}
                    title={
                      !doc.hasProject
                        ? 'Documento gerado antes da feature de reabertura'
                        : 'Carregar este projeto no editor para adicionar evidências ou gerar nova versão'
                    }
                  >
                    {openingDocId === doc.id ? (
                      <>
                        <Loader2 size={14} className="spin" /> Abrindo...
                      </>
                    ) : (
                      <>
                        <Pencil size={14} /> Abrir no editor
                      </>
                    )}
                  </button>
                  <a
                    className="btn btn-secondary btn-sm"
                    href={resolveAssetUrl(doc.tex)}
                    target="_blank"
                    rel="noopener noreferrer"
                    download
                  >
                    <FileType size={14} /> .tex
                  </a>
                  {doc.pdf ? (
                    <a
                      className="btn btn-primary btn-sm"
                      href={resolveAssetUrl(doc.pdf)}
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
                  <button
                    className="icon-button danger"
                    onClick={() => handleDeleteDoc(doc.id)}
                    aria-label="Remover"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Editing Projects Tab */}
      {activeTab === 'editing' && (
        <>
          {editingProjects.length === 0 && !loadingEditing && (
            <div className="card">
              <div className="empty-state">
                <div className="empty-state-icon">
                  <Clock size={28} />
                </div>
                <h3>Nenhum projeto em edição</h3>
                <p>Projetos que você edita são auto-salvos em progresso aqui.</p>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {editingProjects.map((item) => (
              <div key={item.id} className="history-item">
                <div className="history-icon" style={{ backgroundColor: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6' }}>
                  <Clock size={24} />
                </div>
                <div className="history-info">
                  <h4 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {item.projectName}
                    {item.sprintName && (
                      <span style={{ fontSize: 13, opacity: 0.85, fontWeight: 500 }}>
                        · Sprint {item.sprintName}
                      </span>
                    )}
                    {item.isRemote ? (
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          fontSize: 10,
                          padding: '2px 6px',
                          borderRadius: 999,
                          border: '1px solid var(--accent, #1e9e22)',
                          color: 'var(--accent, #1e9e22)',
                          backgroundColor: 'transparent',
                          fontWeight: 600,
                        }}
                        title="Salvo na nuvem (Supabase). Sincronizado em tempo real."
                      >
                        <Cloud size={10} /> Nuvem
                      </span>
                    ) : (
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          fontSize: 10,
                          padding: '2px 6px',
                          borderRadius: 999,
                          border: '1px solid var(--warning, #d97706)',
                          color: 'var(--warning, #d97706)',
                          backgroundColor: 'transparent',
                          fontWeight: 600,
                        }}
                        title="Salvo apenas localmente nesta máquina."
                      >
                        <CloudOff size={10} /> Local
                      </span>
                    )}
                  </h4>
                  <p style={{ fontSize: 13, color: 'var(--text-secondary, #64748b)', marginTop: 2 }}>
                    {item.project?.scenarios?.length || 0} cenário(s) cadastrado(s)
                  </p>
                  <time style={{ fontSize: 11, color: 'var(--text-secondary, #64748b)', marginTop: 4, display: 'block' }}>
                    Última alteração: {formatDate(item.updatedAt)}
                  </time>
                </div>
                <div className="history-actions">
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => handleOpenEditingProject(item)}
                    disabled={openingEditingId === item.id}
                  >
                    {openingEditingId === item.id ? (
                      <>
                        <Loader2 size={14} className="spin" /> Carregando...
                      </>
                    ) : (
                      <>
                        <Pencil size={14} /> Abrir no editor
                      </>
                    )}
                  </button>
                  <button
                    className="icon-button danger"
                    onClick={() => handleDeleteEditingProject(item)}
                    aria-label="Excluir rascunho"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
