import { Trash2, GripVertical, ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { ImageUploader } from '@/components/ImageUploader';
import { type Scenario, type UploadedImage, scenarioCode } from '@/types';
import { cn } from '@/lib/utils';

interface Props {
  scenario: Scenario;
  index: number;
  sessionId: string;
  onChange: (s: Scenario) => void;
  onRemove: () => void;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: () => void;
  isDragging: boolean;
}

const BDD_PLACEHOLDER = `Dado que o usuário está na tela de login
Quando ele informar credenciais válidas
Então o sistema deve redirecioná-lo ao dashboard
E exibir mensagem de boas-vindas`;

export function ScenarioCard({
  scenario,
  index,
  sessionId,
  onChange,
  onRemove,
  onDragStart,
  onDragOver,
  onDrop,
  isDragging,
}: Props) {
  const [expanded, setExpanded] = useState(true);

  const update = <K extends keyof Scenario>(key: K, value: Scenario[K]) =>
    onChange({ ...scenario, [key]: value });

  const handleImages = (images: UploadedImage[]) => update('images', images);

  const ctId = scenarioCode(index);
  const number = `1.1.${index + 1}`;
  const charCount = scenario.bdd?.length ?? 0;

  return (
    <div
      id={`scenario-${scenario.id}`}
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={cn('scenario-card', isDragging && 'dragging')}
    >
      <div className="scenario-card-header" onClick={() => setExpanded((e) => !e)}>
        <span
          className="scenario-drag"
          onClick={(e) => e.stopPropagation()}
          title="Arraste para reordenar"
        >
          <GripVertical size={16} />
        </span>
        {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <span className="scenario-id-badge">{ctId}</span>
        <span className="scenario-num-badge">{number}</span>
        <span className="scenario-title-text">
          {scenario.title || <em style={{ color: 'var(--text-secondary)' }}>Sem título</em>}
        </span>
        {scenario.images.length > 0 && (
          <span className="scenario-img-count">{scenario.images.length} img</span>
        )}
        <button
          type="button"
          className="icon-button danger"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label="Remover cenário"
        >
          <Trash2 size={16} />
        </button>
      </div>

      {expanded && (
        <div className="scenario-body">
          <div className="form-group">
            <label htmlFor={`title-${scenario.id}`}>Título do Cenário</label>
            <input
              id={`title-${scenario.id}`}
              placeholder="Ex: Acesso bem-sucedido à tela"
              value={scenario.title}
              onChange={(e) => update('title', e.target.value)}
            />
          </div>

          <div className="form-group">
            <div className="label-row">
              <label htmlFor={`bdd-${scenario.id}`}>
                Critério BDD (Dado / Quando / Então / E)
              </label>
              <span className="label-hint">{charCount} caracteres</span>
            </div>
            <textarea
              id={`bdd-${scenario.id}`}
              rows={8}
              placeholder={BDD_PLACEHOLDER}
              value={scenario.bdd}
              onChange={(e) => update('bdd', e.target.value)}
              className="mono"
            />
            <span className="label-hint">
              Escreva o critério completo em formato BDD. Quebras de linha são preservadas no PDF.
            </span>
          </div>

          <div className="form-group">
            <label>Evidências (descrição)</label>
            <input
              placeholder="Comportamento observado, telas, etc."
              value={scenario.evidence}
              onChange={(e) => update('evidence', e.target.value)}
            />
          </div>

          <div className="form-group">
            <label>Imagens anexadas</label>
            <ImageUploader sessionId={sessionId} images={scenario.images} onChange={handleImages} />
          </div>
        </div>
      )}
    </div>
  );
}
