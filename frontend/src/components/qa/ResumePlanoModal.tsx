import { useEffect, useState } from 'react';
import { X, Search, Loader2, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { listarPlanosQA, supabaseEnabled, type QATestPlan } from '@/lib/supabase';

interface Props {
  open: boolean;
  onClose: () => void;
  onPick: (planId: string) => void | Promise<void>;
}

export function ResumePlanoModal({ open, onClose, onPick }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [planos, setPlanos] = useState<QATestPlan[]>([]);
  const [filtroProjeto, setFiltroProjeto] = useState('');
  const [filtroSprint, setFiltroSprint] = useState('');
  const [pickingId, setPickingId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (!supabaseEnabled()) {
      setError('Supabase não configurado.');
      return;
    }
    setError(null);
    setLoading(true);
    listarPlanosQA()
      .then(setPlanos)
      .catch((err) => setError(err.message || 'Erro ao buscar planos'))
      .finally(() => setLoading(false));
  }, [open]);

  if (!open) return null;

  const filtrados = planos.filter((p) => {
    if (filtroProjeto && !p.projeto.toLowerCase().includes(filtroProjeto.toLowerCase())) return false;
    if (filtroSprint && !p.sprint.toLowerCase().includes(filtroSprint.toLowerCase())) return false;
    return true;
  });

  const handlePick = async (p: QATestPlan) => {
    setPickingId(p.id);
    try {
      await onPick(p.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar plano');
    } finally {
      setPickingId(null);
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
          padding: 0,
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
            <h3 style={{ fontSize: 18, fontWeight: 700 }}>Retomar plano salvo</h3>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              Escolha um plano para abrir aqui no Gerador (HU, cards e casos voltam ao estado salvo).
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-secondary)',
            }}
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

          {!loading && !error && filtrados.length === 0 && (
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
            </div>
          )}

          {!loading && filtrados.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {filtrados.map((p) => (
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
                  }}
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
                  <Button size="sm" onClick={() => handlePick(p)} disabled={pickingId === p.id}>
                    {pickingId === p.id ? (
                      <>
                        <Loader2 size={14} className="spin" /> Carregando...
                      </>
                    ) : (
                      'Retomar'
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
