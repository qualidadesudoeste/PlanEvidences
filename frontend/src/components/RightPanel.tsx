import { ListChecks, Image as ImageIcon, FileText, Clock, Search } from 'lucide-react';
import { type Scenario, scenarioCode } from '@/types';
import { agruparCenariosPorCard, formatDate, tituloCardParaExibicao } from '@/lib/utils';
import type { GeneratedDoc } from '@/types';

interface Props {
  scenarios: Scenario[];
  lastDoc: GeneratedDoc | null;
  searchQuery: string;
  onChangeSearchQuery: (q: string) => void;
}

export function RightPanel({ scenarios, lastDoc, searchQuery, onChangeSearchQuery }: Props) {
  const totalImages = scenarios.reduce((s, sc) => s + sc.images.length, 0);
  const totalChars = scenarios.reduce((s, sc) => s + (sc.bdd?.length || 0), 0);

  const scrollToScenario = (id: string) => {
    const el = document.getElementById(`scenario-${id}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      el.style.transition = 'box-shadow 0.4s, transform 0.4s';
      el.style.boxShadow = '0 0 0 4px rgba(30, 158, 34, 0.35)';
      el.style.transform = 'scale(1.01)';
      setTimeout(() => {
        el.style.boxShadow = '';
        el.style.transform = '';
      }, 1400);
    }
  };

  return (
    <aside className="content-right">
      <div className="side-panel">
        <h3 className="side-panel-title">Cenários</h3>

        {scenarios.length > 0 && (
          <div style={{ position: 'relative', marginBottom: 12 }}>
            <Search
              size={13}
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
              placeholder="Buscar cenários..."
              value={searchQuery}
              onChange={(e) => onChangeSearchQuery(e.target.value)}
              className="input"
              style={{
                paddingLeft: 28,
                paddingRight: searchQuery ? 24 : 10,
                height: 32,
                fontSize: 12,
                borderRadius: 6,
                width: '100%',
              }}
            />
            {searchQuery && (
              <button
                onClick={() => onChangeSearchQuery('')}
                style={{
                  position: 'absolute',
                  right: 8,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontSize: 11,
                }}
              >
                ✕
              </button>
            )}
          </div>
        )}

        {scenarios.length === 0 ? (
          <p className="scenario-empty">Nenhum cenário cadastrado.</p>
        ) : (
          <div className="scenario-list">
            {(() => {
              const cleanTerm = searchQuery.toLowerCase().trim();

              const matchScenario = (sc: Scenario, idx: number): boolean => {
                if (!cleanTerm) return true;
                const ctCode = `ct-${String(idx + 1).padStart(3, '0')}`;
                if (ctCode.includes(cleanTerm)) return true;
                if (sc.title && sc.title.toLowerCase().includes(cleanTerm)) return true;
                if (sc.bdd && sc.bdd.toLowerCase().includes(cleanTerm)) return true;
                if (sc.cardCodigo && sc.cardCodigo.toLowerCase().includes(cleanTerm)) return true;
                if (sc.cardResumo && sc.cardResumo.toLowerCase().includes(cleanTerm)) return true;
                const formattedCard = `card #${sc.cardCodigo}`.toLowerCase();
                if (formattedCard.includes(cleanTerm)) return true;
                return false;
              };

              const indiceGlobal = new Map(scenarios.map((s, i) => [s.id, i]));
              const filteredScenarios = scenarios.filter((s) => matchScenario(s, indiceGlobal.get(s.id) ?? 0));

              if (filteredScenarios.length === 0) {
                return <p className="scenario-empty">Nenhum cenário correspondente.</p>;
              }

              return agruparCenariosPorCard(filteredScenarios).map((g) => (
                <div key={g.codigo || 'sem-card'} className="scenario-nav-group">
                  {g.codigo && (
                    <div className="scenario-nav-group-title">
                      {tituloCardParaExibicao(g.codigo, g.resumo)}
                    </div>
                  )}
                  {g.scenarios.map((s) => {
                    const idx = indiceGlobal.get(s.id) ?? 0;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        className="scenario-item"
                        onClick={() => scrollToScenario(s.id)}
                      >
                        <div className="scenario-id">{scenarioCode(idx)}</div>
                        <div className="scenario-name">
                          {s.title || <em style={{ color: 'var(--text-secondary)' }}>Sem título</em>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ));
            })()}
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
