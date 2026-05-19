import { ListChecks, Image as ImageIcon, FileText, Clock } from 'lucide-react';
import { type Scenario, scenarioCode } from '@/types';
import { formatDate } from '@/lib/utils';
import type { GeneratedDoc } from '@/types';

interface Props {
  scenarios: Scenario[];
  lastDoc: GeneratedDoc | null;
}

export function RightPanel({ scenarios, lastDoc }: Props) {
  const totalImages = scenarios.reduce((s, sc) => s + sc.images.length, 0);
  const totalChars = scenarios.reduce((s, sc) => s + (sc.bdd?.length || 0), 0);

  const scrollToScenario = (id: string) => {
    const el = document.getElementById(`scenario-${id}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      el.style.transition = 'box-shadow 0.4s';
      el.style.boxShadow = '0 0 0 4px rgba(30, 158, 34, 0.25)';
      setTimeout(() => (el.style.boxShadow = ''), 1400);
    }
  };

  return (
    <aside className="content-right">
      <div className="side-panel">
        <h3 className="side-panel-title">Cenários</h3>
        {scenarios.length === 0 ? (
          <p className="scenario-empty">Nenhum cenário cadastrado.</p>
        ) : (
          <div className="scenario-list">
            {scenarios.map((s, i) => (
              <button
                key={s.id}
                type="button"
                className="scenario-item"
                onClick={() => scrollToScenario(s.id)}
              >
                <div className="scenario-id">{scenarioCode(i)}</div>
                <div className="scenario-name">
                  {s.title || <em style={{ color: 'var(--text-secondary)' }}>Sem título</em>}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="side-panel">
        <h3 className="side-panel-title">Resumo</h3>
        <div className="summary-list">
          <div className="summary-item">
            <div className="summary-icon">
              <ListChecks size={20} />
            </div>
            <div className="summary-info">
              <h4>{scenarios.length} cenário(s)</h4>
              <span>{totalChars} caracteres no total</span>
            </div>
          </div>
          <div className="summary-item">
            <div className="summary-icon">
              <ImageIcon size={20} />
            </div>
            <div className="summary-info">
              <h4>{totalImages} evidência(s)</h4>
              <span>imagens anexadas</span>
            </div>
          </div>
          {lastDoc && (
            <div className="summary-item">
              <div className="summary-icon">
                <FileText size={20} />
              </div>
              <div className="summary-info">
                <h4>Último documento</h4>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <Clock size={12} /> {formatDate(lastDoc.createdAt)}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
