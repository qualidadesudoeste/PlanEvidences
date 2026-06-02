import { useEffect, useState } from 'react';
import { X, Eye, EyeOff, Trash2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AI_MODELS,
  KEY_HINTS,
  PROVIDER_LABELS,
  carregarConfigIA,
  limparConfigIA,
  modeloPadrao,
  salvarConfigIA,
} from '@/lib/qa/aiConfig';
import { testarKey } from '@/lib/qa/aiClient';
import { useToast } from '@/hooks/useToast';
import type { QAAIConfig, QAProvider, QAServerStatus } from '@/types';

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: (config: QAAIConfig | null) => void;
  serverStatus: QAServerStatus | null;
}

export function AISettingsModal({ open, onClose, onSaved, serverStatus }: Props) {
  const { toast } = useToast();
  const [provider, setProvider] = useState<QAProvider>('gemini');
  const [model, setModel] = useState<string>(modeloPadrao('gemini'));
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (!open) return;
    const cfg = carregarConfigIA();
    if (cfg) {
      setProvider(cfg.provider);
      setModel(cfg.model || modeloPadrao(cfg.provider));
      setApiKey(cfg.apiKey || '');
    } else {
      setProvider('gemini');
      setModel(modeloPadrao('gemini'));
      setApiKey('');
    }
  }, [open]);

  if (!open) return null;

  const handleSave = () => {
    if (!apiKey.trim()) {
      toast({ variant: 'error', title: 'Informe a API key' });
      return;
    }
    const cfg: QAAIConfig = { provider, model, apiKey: apiKey.trim() };
    salvarConfigIA(cfg);
    onSaved(cfg);
    toast({ variant: 'success', title: 'Configuração salva' });
    onClose();
  };

  const handleTest = async () => {
    if (!apiKey.trim()) {
      toast({ variant: 'error', title: 'Informe a API key' });
      return;
    }
    setTesting(true);
    try {
      await testarKey({ provider, model, apiKey: apiKey.trim() });
      toast({ variant: 'success', title: 'Conexão OK', description: `${PROVIDER_LABELS[provider]} respondeu.` });
    } catch (e) {
      toast({
        variant: 'error',
        title: 'Falha no teste',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setTesting(false);
    }
  };

  const handleClear = () => {
    if (!confirm('Limpar a configuração de IA salva neste navegador?')) return;
    limparConfigIA();
    setApiKey('');
    onSaved(null);
    toast({ variant: 'info', title: 'Configuração limpa' });
  };

  const hint = KEY_HINTS[provider];
  const serverHasThisProvider = serverStatus?.providers?.[provider];

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
        style={{ width: '100%', maxWidth: 560, padding: 0, overflow: 'hidden' }}
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
          <h3 style={{ fontSize: 18, fontWeight: 700 }}>Configurações de IA</h3>
          <button
            type="button"
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}
            aria-label="Fechar"
          >
            <X size={20} />
          </button>
        </div>

        <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {serverStatus?.serverConfigured && (
            <div
              style={{
                padding: 12,
                background: 'rgba(30,158,34,0.1)',
                border: '1px solid rgba(30,158,34,0.3)',
                borderRadius: 8,
                fontSize: 13,
                color: 'var(--text-primary)',
              }}
            >
              <strong>Servidor configurado:</strong> a app vai usar a key do servidor (
              {serverStatus.defaultProvider}) por padrão. Você pode sobrescrever salvando uma key
              abaixo.
            </div>
          )}

          <div
            style={{
              padding: 12,
              background: 'rgba(59,130,246,0.08)',
              border: '1px solid rgba(59,130,246,0.25)',
              borderRadius: 8,
              fontSize: 12,
              color: 'var(--text-secondary)',
            }}
          >
            Sua chave fica apenas no localStorage do navegador e é enviada ao backend só pra ser
            repassada ao provedor escolhido. Nunca é compartilhada.
          </div>

          <div className="form-group">
            <label htmlFor="qa-ai-provider">Provedor de IA</label>
            <select
              id="qa-ai-provider"
              className="input"
              value={provider}
              onChange={(e) => {
                const p = e.target.value as QAProvider;
                setProvider(p);
                setModel(modeloPadrao(p));
              }}
            >
              <option value="gemini">Google Gemini (tier gratuito)</option>
              <option value="anthropic">Anthropic Claude</option>
              <option value="openai">OpenAI GPT</option>
            </select>
            {serverHasThisProvider && (
              <small className="hint" style={{ color: 'var(--accent, #1e9e22)' }}>
                ✓ Servidor já tem key para {PROVIDER_LABELS[provider]}
              </small>
            )}
          </div>

          <div className="form-group">
            <label htmlFor="qa-ai-model">Modelo</label>
            <select
              id="qa-ai-model"
              className="input"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            >
              {AI_MODELS[provider].map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="qa-ai-key">API Key</label>
            <div style={{ position: 'relative' }}>
              <input
                id="qa-ai-key"
                type={showKey ? 'text' : 'password'}
                className="input"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-ant-..., sk-..., AIza..."
                style={{ paddingRight: 38 }}
              />
              <button
                type="button"
                onClick={() => setShowKey((s) => !s)}
                style={{
                  position: 'absolute',
                  right: 8,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--text-secondary)',
                  padding: 4,
                }}
                aria-label={showKey ? 'Esconder key' : 'Mostrar key'}
              >
                {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <small className="hint">
              Obtenha em{' '}
              <a href={hint.url} target="_blank" rel="noopener noreferrer">
                {hint.label}
              </a>
            </small>
          </div>

          <div
            style={{
              display: 'flex',
              gap: 8,
              justifyContent: 'flex-end',
              flexWrap: 'wrap',
              paddingTop: 6,
            }}
          >
            <Button variant="secondary" onClick={handleClear}>
              <Trash2 size={14} /> Limpar
            </Button>
            <Button variant="secondary" onClick={handleTest} disabled={testing}>
              {testing ? (
                <>
                  <Loader2 size={14} className="spin" /> Testando...
                </>
              ) : (
                <>Testar conexão</>
              )}
            </Button>
            <Button onClick={handleSave}>Salvar</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
