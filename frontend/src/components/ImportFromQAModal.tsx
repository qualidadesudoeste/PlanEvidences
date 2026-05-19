import { useEffect, useState } from 'react';
import { X, Search, Loader2, FileText, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { listarPlanosQA, carregarPlanoQA, supabaseEnabled, QATestPlan } from '@/lib/supabase';
import type { Scenario } from '@/types';

interface Props {
  open: boolean;
  onClose: () => void;
  onImport: (scenarios: Scenario[], meta: { projeto: string; sprint: string; tela: string | null }) => void;
}

export function ImportFromQAModal({ open, onClose, onImport }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [planos, setPlanos] = useState<QATestPlan[]>([]);
  const [filtroProjeto, setFiltroProjeto] = useState('');
  const [filtroSprint, setFiltroSprint] = useState('');
  const [importingId, setImportingId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (!supabaseEnabled()) {
      setError('Supabase não configurado. Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no Vercel e refaça o deploy.');
      return;
    }
    setError(null);
    setLoading(true);
    listarPlanosQA()
      .then((items) => {
        setPlanos(items);
      })
      .catch((err) => setError(err.message || 'Erro ao buscar planos'))
      .finally(() => setLoading(false));
  }, [open]);

  if (!open) return null;

  const planosFiltrados = planos.filter((p) => {
    if (filtroProjeto && !p.projeto.toLowerCase().includes(filtroProjeto.toLowerCase())) return false;
    if (filtroSprint && !p.sprint.toLowerCase().includes(filtroSprint.toLowerCase())) return false;
    return true;
  });

  const handleImport = async (plano: QATestPlan) => {
    setImportingId(plano.id);
    setError(null);
    try {
      const full = await carregarPlanoQA(plano.id);
      const scenarios = full.resultado_json?.scenarios_bdd || [];
      if (scenarios.length === 0) {
        setError(
          'Este plano não tem cenários BDD. Foi gerado por uma versão antiga do QA Assistant — gere novamente lá.'
        );
        return;
      }
      const mapped: Scenario[] = scenarios.map((s) => ({
        id: s.id,
        title: s.title,
        bdd: s.bdd,
        evidence: s.evidence || '',
        images: Array.isArray(s.images) ? (s.images as Scenario['images']) : [],
      }));
      onImport(mapped, { projeto: full.projeto, sprint: full.sprint, tela: full.tela });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar plano');
    } finally {
      setImportingId(null);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        className="card"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 720,
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '18px 22px',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <div>
            <h3 style={{ fontSize: 18, fontWeight: 700 }}>📥 Importar plano do QA Assistant</h3>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              Selecione um plano gerado no QA Assistant para popular os cenários deste projeto.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}
            aria-label="Fechar"
          >
            <X size={20} />
          </button>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 10,
            padding: '14px 22px',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <div style={{ position: 'relative' }}>
            <Search
              size={14}
              style={{
                position: 'absolute',
                left: 10,
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--text-secondary)',
              }}
            />
            <input
              type="text"
              placeholder="Filtrar por projeto..."
              value={filtroProjeto}
              onChange={(e) => setFiltroProjeto(e.target.value)}
              className="input"
              style={{ paddingLeft: 32 }}
            />
          </div>
          <div style={{ position: 'relative' }}>
            <Search
              size={14}
              style={{
                position: 'absolute',
                left: 10,
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--text-secondary)',
              }}
            />
            <input
              type="text"
              placeholder="Filtrar por sprint..."
              value={filtroSprint}
              onChange={(e) => setFiltroSprint(e.target.value)}
              className="input"
              style={{ paddingLeft: 32 }}
            />
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 22px' }}>
          {loading && (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
              <Loader2 size={24} className="spin" />
            </div>
          )}

          {error && (
            <div
              style={{
                padding: 14,
                background: 'rgba(239,68,68,0.1)',
                border: '1px solid rgba(239,68,68,0.3)',
                borderRadius: 8,
                color: 'var(--danger, #ef4444)',
                fontSize: 13,
                marginBottom: 12,
              }}
            >
              {error}
            </div>
          )}

          {!loading && !error && planosFiltrados.length === 0 && (
            <div
              style={{
                textAlign: 'center',
                padding: 40,
                color: 'var(--text-secondary)',
                fontSize: 14,
              }}
            >
              <FileText size={32} style={{ opacity: 0.4, marginBottom: 10 }} />
              <p>Nenhum plano encontrado.</p>
              <a
                href="https://qa-assistant-hu.vercel.app"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: 'var(--primary, #1e9e22)',
                  fontSize: 13,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  marginTop: 8,
                }}
              >
                Abrir QA Assistant <ExternalLink size={12} />
              </a>
            </div>
          )}

          {!loading && planosFiltrados.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {planosFiltrados.map((p) => (
                <div
                  key={p.id}
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    padding: 12,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 12,
                    transition: 'border-color 0.15s',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--primary, #1e9e22)')}
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>
                      {p.tela || '(sem tela)'}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      {p.projeto} • Sprint {p.sprint}
                      {p.criticidade && <> • {p.criticidade}</>}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                      Atualizado: {new Date(p.updated_at).toLocaleString('pt-BR')}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => handleImport(p)}
                    disabled={importingId === p.id}
                  >
                    {importingId === p.id ? (
                      <>
                        <Loader2 size={14} className="spin" /> Importando...
                      </>
                    ) : (
                      'Importar'
                    )}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
