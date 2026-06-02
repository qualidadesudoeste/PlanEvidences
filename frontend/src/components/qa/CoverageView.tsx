import type { QAAnaliseResult } from '@/types';
import type { CoberturaResumo, RiscoIdentificado } from '@/lib/qa/heuristics';

interface Props {
  analise: QAAnaliseResult;
  riscos: RiscoIdentificado[];
  cobertura: CoberturaResumo;
}

const NIVEL_COLORS: Record<string, { color: string; bg: string }> = {
  alto: { color: '#dc2626', bg: 'rgba(220,38,38,0.1)' },
  medio: { color: '#d97706', bg: 'rgba(217,119,6,0.1)' },
  baixo: { color: '#0891b2', bg: 'rgba(8,145,178,0.1)' },
};

export function CoverageView({ analise, riscos, cobertura }: Props) {
  const a = analise.analiseGlobal;
  const temAnaliseIA =
    a && (a.ambiguidades?.length || a.gapsIdentificados?.length || a.recomendacoes?.length);

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <header>
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>Cobertura e riscos</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
          Análise da IA + riscos detectados pelas heurísticas de testes.
        </p>
      </header>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: 10,
        }}
      >
        <Stat label="Categorias aplicáveis" value={cobertura.categoriasAplicaveis} />
        <Stat label="Testes da suíte" value={cobertura.totalTestesSuite} />
        <Stat label="Casos gerados" value={cobertura.casosGerados} />
        <Stat label="Tipos cobertos" value={cobertura.tiposCobertos.length} />
      </div>

      {temAnaliseIA && (
        <div className="card" style={{ padding: 18, background: 'rgba(59,130,246,0.06)' }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>🔎 Análise da IA</h3>
          {a!.qualidade && (
            <p style={{ fontSize: 13 }}>
              <strong>Qualidade da HU:</strong> {a!.qualidade.toUpperCase()}
            </p>
          )}
          {a!.ambiguidades && a!.ambiguidades.length > 0 && (
            <SectionList titulo="Ambiguidades" items={a!.ambiguidades} />
          )}
          {a!.gapsIdentificados && a!.gapsIdentificados.length > 0 && (
            <SectionList titulo="Perguntas para o PO" items={a!.gapsIdentificados} />
          )}
          {a!.recomendacoes && a!.recomendacoes.length > 0 && (
            <SectionList titulo="Recomendações" items={a!.recomendacoes} />
          )}
        </div>
      )}

      <div className="card" style={{ padding: 18 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>⚠️ Riscos identificados</h3>
        {riscos.length === 0 ? (
          <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
            Nenhum risco crítico identificado automaticamente.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {riscos.map((r, i) => {
              const meta = NIVEL_COLORS[r.nivel] || NIVEL_COLORS.medio;
              return (
                <div
                  key={i}
                  style={{
                    border: '1px solid var(--border)',
                    borderLeft: `4px solid ${meta.color}`,
                    background: meta.bg,
                    borderRadius: 8,
                    padding: 12,
                  }}
                >
                  <span
                    style={{
                      display: 'inline-block',
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: 0.5,
                      color: meta.color,
                      marginBottom: 4,
                    }}
                  >
                    {r.nivel.toUpperCase()}
                  </span>
                  <p style={{ fontSize: 13, margin: 0 }}>{r.descricao}</p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div
      className="card"
      style={{
        padding: 14,
        textAlign: 'center',
        background: 'var(--card-bg)',
      }}
    >
      <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--accent, #1e9e22)', lineHeight: 1 }}>
        {value}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>{label}</div>
    </div>
  );
}

function SectionList({ titulo, items }: { titulo: string; items: string[] }) {
  return (
    <div style={{ marginTop: 8 }}>
      <p style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>{titulo}</p>
      <ul style={{ margin: '0 0 0 18px', fontSize: 13 }}>
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </div>
  );
}
