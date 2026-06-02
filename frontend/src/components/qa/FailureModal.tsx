import { useEffect, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { historicoFalhas, type FalhaRow } from '@/lib/qa/execucao';

interface Props {
  open: boolean;
  mode: 'register' | 'history';
  planId: string | null;
  caseId: string | null;
  caseTitle?: string;
  onClose: () => void;
  onConfirm?: (observacao: string) => Promise<void> | void;
}

export function FailureModal({ open, mode, planId, caseId, caseTitle, onClose, onConfirm }: Props) {
  const [observacao, setObservacao] = useState('');
  const [saving, setSaving] = useState(false);
  const [loadingHist, setLoadingHist] = useState(false);
  const [historico, setHistorico] = useState<FalhaRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setObservacao('');
      setError(null);
      return;
    }
    if (mode === 'history' && planId && caseId) {
      setLoadingHist(true);
      historicoFalhas({ planId, caseId })
        .then(setHistorico)
        .catch((err) => setError(err instanceof Error ? err.message : String(err)))
        .finally(() => setLoadingHist(false));
    }
  }, [open, mode, planId, caseId]);

  if (!open) return null;

  const handleSave = async () => {
    if (!onConfirm) return;
    setSaving(true);
    setError(null);
    try {
      await onConfirm(observacao);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const isRegister = mode === 'register';

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
        style={{ width: '100%', maxWidth: 520, padding: 0 }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            padding: '18px 22px',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <div>
            <h3 style={{ fontSize: 18, fontWeight: 700 }}>
              {isRegister ? 'Registrar falha' : 'Histórico de falhas'}
            </h3>
            {caseTitle && (
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
                {caseId} — {caseTitle}
              </p>
            )}
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

        <div style={{ padding: 22 }}>
          {error && (
            <div
              style={{
                padding: 12,
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

          {isRegister ? (
            <div className="form-group">
              <label htmlFor="falha-obs">Observação (opcional)</label>
              <textarea
                id="falha-obs"
                className="input"
                rows={5}
                value={observacao}
                onChange={(e) => setObservacao(e.target.value)}
                placeholder="Descreva o que falhou, passos para reproduzir, mensagens de erro..."
                style={{ resize: 'vertical', fontFamily: 'inherit', fontSize: 14 }}
              />
              <small className="hint">
                Cada falha é registrada no histórico do caso com data/hora.
              </small>
            </div>
          ) : loadingHist ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 30 }}>
              <Loader2 size={20} className="spin" />
            </div>
          ) : historico.length === 0 ? (
            <p style={{ color: 'var(--text-secondary)', fontSize: 13, textAlign: 'center' }}>
              Nenhuma falha registrada ainda.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 400, overflowY: 'auto' }}>
              {historico.map((h, i) => (
                <div
                  key={i}
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    padding: 10,
                  }}
                >
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>
                    {new Date(h.created_at).toLocaleString('pt-BR')}
                  </div>
                  <div style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>
                    {h.observacao || <em style={{ color: 'var(--text-secondary)' }}>(sem observação)</em>}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div
            style={{
              display: 'flex',
              gap: 8,
              justifyContent: 'flex-end',
              marginTop: 18,
              paddingTop: 14,
              borderTop: '1px solid var(--border)',
            }}
          >
            <Button variant="secondary" onClick={onClose}>
              {isRegister ? 'Cancelar' : 'Fechar'}
            </Button>
            {isRegister && (
              <Button onClick={handleSave} disabled={saving}>
                {saving ? (
                  <>
                    <Loader2 size={14} className="spin" /> Salvando...
                  </>
                ) : (
                  'Registrar falha'
                )}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
