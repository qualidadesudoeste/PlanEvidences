import { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { CategoriaAplicavel } from '@/lib/qa/heuristics';

interface Props {
  categorias: CategoriaAplicavel[];
  /** Chave usada pra persistir progresso (geralmente o hash da HU). Sem ela, progresso fica em memória. */
  progressoKey?: string;
}

type Progresso = Record<string, boolean>;

function loadProgresso(key: string | undefined): Progresso {
  if (!key) return {};
  try {
    const raw = localStorage.getItem(`qa-suite-progresso-${key}`);
    return raw ? (JSON.parse(raw) as Progresso) : {};
  } catch {
    return {};
  }
}

function saveProgresso(key: string | undefined, prog: Progresso): void {
  if (!key) return;
  localStorage.setItem(`qa-suite-progresso-${key}`, JSON.stringify(prog));
}

export function HeuristicsView({ categorias, progressoKey }: Props) {
  const [progresso, setProgresso] = useState<Progresso>(() => loadProgresso(progressoKey));

  useEffect(() => {
    setProgresso(loadProgresso(progressoKey));
  }, [progressoKey]);

  useEffect(() => {
    saveProgresso(progressoKey, progresso);
  }, [progresso, progressoKey]);

  const toggle = (id: string) => {
    setProgresso((p) => ({ ...p, [id]: !p[id] }));
  };

  const reset = () => {
    if (!confirm('Resetar progresso da suíte de heurísticas?')) return;
    setProgresso({});
  };

  if (categorias.length === 0) {
    return (
      <div className="card" style={{ padding: 24, textAlign: 'center' }}>
        <p style={{ color: 'var(--text-secondary)' }}>
          Nenhuma categoria de heurística se aplica a esta HU.
        </p>
      </div>
    );
  }

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700 }}>Heurísticas aplicáveis</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
            {categorias.length} categoria(s) detectadas pelas keywords da HU. Use como checklist
            complementar aos casos gerados pela IA.
          </p>
        </div>
        <Button variant="secondary" onClick={reset}>
          <RotateCcw size={14} /> Resetar progresso
        </Button>
      </header>

      {categorias.map((cat) => {
        const totalChecked = cat.testes.filter((_, idx) => progresso[`${cat.id}-${idx}`]).length;
        const pct = (totalChecked / cat.testes.length) * 100;

        return (
          <div key={cat.id} className="card" style={{ padding: 16 }}>
            <header style={{ marginBottom: 8 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  flexWrap: 'wrap',
                  gap: 8,
                }}
              >
                <h3 style={{ fontSize: 15, fontWeight: 700 }}>
                  {cat.icone} {cat.categoria}
                </h3>
                <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                  {totalChecked}/{cat.testes.length} ({Math.round(pct)}%)
                </span>
              </div>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
                {cat.motivo}
              </p>
              <div
                style={{
                  marginTop: 6,
                  height: 4,
                  background: 'rgba(0,0,0,0.08)',
                  borderRadius: 2,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${pct}%`,
                    height: '100%',
                    background: 'var(--accent, #1e9e22)',
                    transition: 'width 0.2s',
                  }}
                />
              </div>
            </header>

            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {cat.testes.map((t, idx) => {
                const key = `${cat.id}-${idx}`;
                const checked = !!progresso[key];
                return (
                  <li key={key} style={{ padding: '4px 0' }}>
                    <label
                      style={{
                        display: 'flex',
                        gap: 8,
                        alignItems: 'flex-start',
                        cursor: 'pointer',
                        fontSize: 13,
                        opacity: checked ? 0.55 : 1,
                        textDecoration: checked ? 'line-through' : 'none',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(key)}
                        style={{ marginTop: 2, flexShrink: 0 }}
                      />
                      <span>{t}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </section>
  );
}
