import { useEffect, useState } from 'react';
import { Download, FileText, FileType, History, RefreshCw, Trash2, AlertCircle, Pencil, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { listDocuments, deleteDocument, resolveAssetUrl, getDocumentProject } from '@/lib/api';
import { useToast } from '@/hooks/useToast';
import { formatDate } from '@/lib/utils';
import type { GeneratedDoc, Project } from '@/types';

interface HistoryListProps {
  onOpenProject?: (project: Project) => void;
}

export function HistoryList({ onOpenProject }: HistoryListProps = {}) {
  const [items, setItems] = useState<GeneratedDoc[]>([]);
  const [loading, setLoading] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const { toast } = useToast();

  const load = async () => {
    setLoading(true);
    try {
      const { items } = await listDocuments();
      setItems(items);
    } catch (err) {
      toast({
        variant: 'error',
        title: 'Erro ao carregar histórico',
        description: err instanceof Error ? err.message : 'Falha desconhecida',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleDelete = async (id: string) => {
    if (!confirm('Remover este documento?')) return;
    await deleteDocument(id);
    setItems((prev) => prev.filter((d) => d.id !== id));
    toast({ variant: 'success', title: 'Documento removido' });
  };

  const handleOpen = async (doc: GeneratedDoc) => {
    if (!onOpenProject) return;
    setOpeningId(doc.id);
    try {
      const project = await getDocumentProject(doc.id);
      onOpenProject(project);
      toast({
        variant: 'success',
        title: 'Projeto carregado',
        description: 'Edite os cenários e clique em "Gerar Documento" para criar uma nova versão.',
      });
    } catch (err) {
      toast({
        variant: 'error',
        title: 'Não foi possível abrir',
        description: err instanceof Error ? err.message : 'Falha desconhecida',
      });
    } finally {
      setOpeningId(null);
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
            Histórico de Documentos
          </h1>
          <p>Documentos gerados anteriormente.</p>
        </div>
        <div className="header-actions">
          <Button variant="secondary" size="sm" onClick={load} disabled={loading}>
            <RefreshCw size={16} className={loading ? 'spin' : ''} />
            Atualizar
          </Button>
        </div>
      </div>

      {items.length === 0 && !loading && (
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
        {items.map((doc) => (
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
                onClick={() => handleOpen(doc)}
                disabled={!doc.hasProject || !onOpenProject || openingId === doc.id}
                title={
                  !doc.hasProject
                    ? 'Documento gerado antes da feature de reabertura'
                    : 'Carregar este projeto no editor para adicionar evidências ou gerar nova versão'
                }
              >
                {openingId === doc.id ? (
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
                onClick={() => handleDelete(doc.id)}
                aria-label="Remover"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
