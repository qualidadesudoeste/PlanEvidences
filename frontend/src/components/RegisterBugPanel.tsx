import { useEffect, useState } from 'react';
import { Bug, Clipboard, Copy, Loader2, RefreshCw, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/useToast';
import {
  copyText,
  correctiveCardToMarkdown,
  generateCorrectiveCard,
} from '@/lib/correctiveCards';
import { getErrorMessage } from '@/lib/utils';
import type { CorrectiveCardContext, CorrectiveCardDraft } from '@/types';

interface Props {
  open: boolean;
  context: CorrectiveCardContext;
  onClose: () => void;
}

export function RegisterBugModal({ open, context, onClose }: Props) {
  const { toast } = useToast();
  const [hu, setHu] = useState(context.hu);
  const [screenPath, setScreenPath] = useState(context.screenPath);
  const [screenUrl, setScreenUrl] = useState(context.screenUrl || '');
  const [errorDescription, setErrorDescription] = useState('');
  const [card, setCard] = useState<CorrectiveCardDraft | null>(null);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !generating) onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [open, generating, onClose]);

  const generate = async () => {
    if (errorDescription.trim().length < 10) {
      toast({
        variant: 'error',
        title: 'Descreva melhor o problema',
        description: 'Informe ao menos 10 caracteres sobre o comportamento encontrado.',
      });
      return;
    }

    setGenerating(true);
    try {
      const generated = await generateCorrectiveCard({
        ...context,
        hu: hu.trim(),
        screenPath: screenPath.trim(),
        screenUrl: screenUrl.trim(),
        errorDescription: errorDescription.trim(),
      });
      setCard(generated);
      toast({ variant: 'success', title: 'Card de corretiva gerado' });
    } catch (error) {
      toast({
        variant: 'error',
        title: 'Falha ao gerar o card',
        description: getErrorMessage(error),
      });
    } finally {
      setGenerating(false);
    }
  };

  const copy = async (text: string, label: string) => {
    try {
      await copyText(text);
      toast({ variant: 'success', title: `${label} copiado` });
    } catch (error) {
      toast({ variant: 'error', title: 'Falha ao copiar', description: getErrorMessage(error) });
    }
  };

  if (!open) return null;

  return (
    <div className="corrective-modal-overlay" onMouseDown={() => !generating && onClose()}>
      <section
        className="corrective-modal card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="corrective-modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="corrective-modal-header">
          <div>
            <h2 id="corrective-modal-title">
              <Bug size={22} /> Criar corretiva
            </h2>
            <p>
              {context.sigCardCode && <strong>Card #{context.sigCardCode}</strong>}
              {context.sigCardCode && context.scenarioCode && ' • '}
              {context.scenarioCode && <strong>{context.scenarioCode}</strong>}
              {context.scenarioTitle && ` — ${context.scenarioTitle}`}
            </p>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            disabled={generating}
            aria-label="Fechar criação de corretiva"
          >
            <X size={20} />
          </button>
        </header>

        <div className="corrective-modal-body">
          <section>
            <p className="corrective-modal-intro">
              A corretiva ficará associada ao card de melhoria e ao cenário em execução. Descreva o
              defeito observado para a IA padronizar o card.
            </p>
            <div className="form-grid">
              <div className="form-group">
                <label htmlFor="bug-hu">HU referenciada no card</label>
                <input
                  id="bug-hu"
                  value={hu}
                  onChange={(event) => setHu(event.target.value)}
                  placeholder="Ex: HU.206"
                  disabled={generating}
                />
              </div>
              <div className="form-group">
                <label htmlFor="bug-screen-path">Caminho</label>
                <input
                  id="bug-screen-path"
                  value={screenPath}
                  onChange={(event) => setScreenPath(event.target.value)}
                  placeholder="Ex: Menu > Relatório de Atendimento"
                  disabled={generating}
                />
              </div>
              <div className="form-group full">
                <label htmlFor="bug-screen-url">URL da tela (opcional)</label>
                <input
                  id="bug-screen-url"
                  type="url"
                  value={screenUrl}
                  onChange={(event) => setScreenUrl(event.target.value)}
                  placeholder="Ex: https://sistema.exemplo.local/caminho-da-tela"
                  disabled={generating}
                />
                <span className="label-hint">Cole a URL do sistema testado; a IA não inventará esse endereço.</span>
              </div>
              <div className="form-group full">
                <label htmlFor="bug-description">Descrição do erro</label>
                <textarea
                  id="bug-description"
                  rows={6}
                  value={errorDescription}
                  onChange={(event) => setErrorDescription(event.target.value)}
                  placeholder="Descreva o que aconteceu durante a execução deste cenário."
                  disabled={generating}
                  autoFocus
                />
                <span className="label-hint">A descrição original é preservada ao gerar novamente.</span>
              </div>
            </div>
            <div className="corrective-modal-primary-action">
              <Button onClick={generate} disabled={generating}>
                {generating ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}
                {generating ? 'Gerando card...' : 'Gerar Card'}
              </Button>
            </div>
          </section>

          {card && (
            <section className="corrective-preview" aria-live="polite">
              <div className="corrective-preview-heading">
                <div>
                  <h3>Prévia da corretiva</h3>
                  <p>Revise e edite o conteúdo antes de copiar.</p>
                </div>
                <RefreshCw size={18} />
              </div>

              <div className="form-group">
                <label htmlFor="bug-card-title">Título</label>
                <textarea
                  id="bug-card-title"
                  rows={2}
                  value={card.title}
                  onChange={(event) => setCard({ ...card, title: event.target.value })}
                />
              </div>
              <div className="form-group">
                <label htmlFor="bug-card-description">Descrição do Problema</label>
                <textarea
                  id="bug-card-description"
                  rows={5}
                  value={card.problemDescription}
                  onChange={(event) => setCard({ ...card, problemDescription: event.target.value })}
                />
              </div>
              <div className="form-group">
                <label htmlFor="bug-card-steps">Passos para Reproduzir</label>
                <textarea
                  id="bug-card-steps"
                  rows={6}
                  value={card.reproductionSteps.join('\n')}
                  onChange={(event) =>
                    setCard({ ...card, reproductionSteps: event.target.value.split(/\r?\n/) })
                  }
                />
                <span className="label-hint">Um passo por linha; a numeração é aplicada ao copiar.</span>
              </div>
              <div className="form-group">
                <label htmlFor="bug-card-current">Resultado Atual</label>
                <textarea
                  id="bug-card-current"
                  rows={4}
                  value={card.currentResult}
                  onChange={(event) => setCard({ ...card, currentResult: event.target.value })}
                />
              </div>
              <div className="form-group">
                <label htmlFor="bug-card-expected">Resultado Esperado</label>
                <textarea
                  id="bug-card-expected"
                  rows={4}
                  value={card.expectedResult}
                  onChange={(event) => setCard({ ...card, expectedResult: event.target.value })}
                />
              </div>

              <div className="corrective-preview-actions">
                <Button onClick={() => copy(correctiveCardToMarkdown(card, { screenPath, screenUrl }), 'Conteúdo')}>
                  <Clipboard size={16} /> Copiar Conteúdo
                </Button>
                <Button variant="secondary" onClick={() => copy(card.title, 'Título')}>
                  <Copy size={16} /> Copiar Título
                </Button>
                <Button variant="secondary" onClick={generate} disabled={generating}>
                  {generating ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
                  Gerar Novamente
                </Button>
              </div>
            </section>
          )}
        </div>
      </section>
    </div>
  );
}
