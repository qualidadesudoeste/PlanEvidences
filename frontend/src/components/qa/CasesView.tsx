import { Check, X, AlertOctagon, History } from 'lucide-react';
import type { QAAnaliseResult, QACase, QACriticidade } from '@/types';
import type { ExecucaoStatus, ExecucaoRow } from '@/lib/qa/execucao';

interface Props {
  analise: QAAnaliseResult;
  /**
   * Mapa caseId → execução salva no Supabase. Sem isso, status fica oculto
   * (caso de plano não-salvo).
   */
  execucoes?: Map<string, ExecucaoRow>;
  /** Habilita ações de status quando o plano foi salvo. */
  interactive?: boolean;
  onMarkStatus?: (caso: { caseId: string; titulo: string; tipo?: string }, status: ExecucaoStatus) => void;
  onVerHistorico?: (caso: { caseId: string; titulo: string }) => void;
}

const PRIORIDADE_LABELS: Record<QACriticidade, { label: string; color: string; bg: string }> = {
  alta: { label: 'ALTA', color: '#dc2626', bg: 'rgba(220,38,38,0.12)' },
  media: { label: 'MÉDIA', color: '#d97706', bg: 'rgba(217,119,6,0.12)' },
  baixa: { label: 'BAIXA', color: '#0891b2', bg: 'rgba(8,145,178,0.12)' },
};

const STATUS_META: Record<ExecucaoStatus, { label: string; color: string; bg: string; icon: typeof Check | null }> = {
  nao_executado: {
    label: 'Não executado',
    color: 'var(--text-secondary)',
    bg: 'rgba(0,0,0,0.05)',
    icon: null,
  },
  passou: { label: 'Passou', color: '#0e9f6e', bg: 'rgba(14,159,110,0.12)', icon: Check },
  falhou: { label: 'Falhou', color: '#dc2626', bg: 'rgba(220,38,38,0.12)', icon: AlertOctagon },
};

function PrioridadeBadge({ p }: { p?: QACriticidade }) {
  const meta = (p && PRIORIDADE_LABELS[p]) || PRIORIDADE_LABELS.media;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '2px 8px',
        borderRadius: 999,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 0.5,
        color: meta.color,
        background: meta.bg,
      }}
    >
      {meta.label}
    </span>
  );
}

function StatusBadge({ status, failCount }: { status: ExecucaoStatus; failCount?: number }) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 8px',
        borderRadius: 999,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 0.3,
        color: meta.color,
        background: meta.bg,
      }}
    >
      {Icon && <Icon size={10} />}
      {meta.label}
      {status === 'falhou' && typeof failCount === 'number' && failCount > 0 && (
        <span>· {failCount}</span>
      )}
    </span>
  );
}

function CasoCard({
  caso,
  index,
  cardCodigo,
  execucao,
  interactive,
  onMarkStatus,
  onVerHistorico,
}: {
  caso: QACase;
  index: number;
  cardCodigo: string | null;
  execucao?: ExecucaoRow;
  interactive: boolean;
  onMarkStatus?: Props['onMarkStatus'];
  onVerHistorico?: Props['onVerHistorico'];
}) {
  const codigo = caso.id || `CT${String(index + 1).padStart(3, '0')}`;
  const compositeId = cardCodigo ? `${cardCodigo}-${codigo}` : codigo;
  const status: ExecucaoStatus = execucao?.status || 'nao_executado';

  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderLeft: `4px solid ${
          status === 'passou' ? '#0e9f6e' : status === 'falhou' ? '#dc2626' : 'transparent'
        }`,
        borderRadius: 10,
        padding: 14,
        background: 'var(--card-bg)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <code
            style={{
              fontSize: 11,
              padding: '2px 6px',
              borderRadius: 4,
              background: 'var(--bg-secondary, rgba(0,0,0,0.05))',
              fontFamily: 'monospace',
              fontWeight: 700,
            }}
          >
            {codigo}
          </code>
          <strong style={{ fontSize: 14 }}>{caso.titulo}</strong>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <PrioridadeBadge p={caso.prioridade} />
          {caso.tipo && (
            <span
              style={{
                fontSize: 10,
                padding: '2px 8px',
                borderRadius: 999,
                background: 'rgba(0,0,0,0.06)',
                color: 'var(--text-secondary)',
                fontWeight: 600,
              }}
            >
              {caso.tipo}
            </span>
          )}
          {execucao && <StatusBadge status={status} failCount={execucao.fail_count} />}
        </div>
      </div>

      {caso.preCondicoes && caso.preCondicoes.length > 0 && (
        <div>
          <small style={{ fontWeight: 700, color: 'var(--text-secondary)' }}>Pré-condições</small>
          <ul style={{ margin: '4px 0 0 18px', fontSize: 13, color: 'var(--text-primary)' }}>
            {caso.preCondicoes.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      {caso.passos && caso.passos.length > 0 && (
        <div>
          <small style={{ fontWeight: 700, color: 'var(--text-secondary)' }}>Passos</small>
          <ol style={{ margin: '4px 0 0 18px', fontSize: 13, color: 'var(--text-primary)' }}>
            {caso.passos.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ol>
        </div>
      )}

      {caso.resultadoEsperado && (
        <div>
          <small style={{ fontWeight: 700, color: 'var(--text-secondary)' }}>
            Resultado esperado
          </small>
          <p style={{ margin: '4px 0 0 0', fontSize: 13, color: 'var(--text-primary)' }}>
            {caso.resultadoEsperado}
          </p>
        </div>
      )}

      {caso.dadosTeste && caso.dadosTeste.toUpperCase() !== 'N/A' && (
        <div>
          <small style={{ fontWeight: 700, color: 'var(--text-secondary)' }}>Dados de teste</small>
          <p
            style={{
              margin: '4px 0 0 0',
              fontSize: 13,
              fontFamily: 'monospace',
              color: 'var(--text-primary)',
            }}
          >
            {caso.dadosTeste}
          </p>
        </div>
      )}

      {interactive && (
        <div
          style={{
            display: 'flex',
            gap: 6,
            paddingTop: 6,
            borderTop: '1px solid var(--border)',
            marginTop: 4,
            flexWrap: 'wrap',
          }}
        >
          <button
            type="button"
            onClick={() =>
              onMarkStatus?.(
                { caseId: compositeId, titulo: caso.titulo, tipo: caso.tipo },
                status === 'passou' ? 'nao_executado' : 'passou'
              )
            }
            style={{
              border: '1px solid var(--border)',
              background: status === 'passou' ? 'rgba(14,159,110,0.15)' : 'transparent',
              color: status === 'passou' ? '#0e9f6e' : 'var(--text-primary)',
              padding: '4px 10px',
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <Check size={12} /> Passou
          </button>
          <button
            type="button"
            onClick={() =>
              onMarkStatus?.(
                { caseId: compositeId, titulo: caso.titulo, tipo: caso.tipo },
                'falhou'
              )
            }
            style={{
              border: '1px solid var(--border)',
              background: status === 'falhou' ? 'rgba(220,38,38,0.15)' : 'transparent',
              color: status === 'falhou' ? '#dc2626' : 'var(--text-primary)',
              padding: '4px 10px',
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <X size={12} /> Falhou
          </button>
          {execucao?.fail_count != null && execucao.fail_count > 0 && onVerHistorico && (
            <button
              type="button"
              onClick={() => onVerHistorico({ caseId: compositeId, titulo: caso.titulo })}
              style={{
                border: '1px solid var(--border)',
                background: 'transparent',
                color: 'var(--text-primary)',
                padding: '4px 10px',
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <History size={12} /> Histórico ({execucao.fail_count})
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function CasesView({ analise, execucoes, interactive = false, onMarkStatus, onVerHistorico }: Props) {
  const total = analise.cards.reduce((acc, c) => acc + (c.casos?.length || 0), 0);
  if (total === 0) {
    return (
      <div className="card" style={{ padding: 24, textAlign: 'center' }}>
        <p style={{ color: 'var(--text-secondary)' }}>
          A análise voltou sem casos. Verifique a HU enviada ou tente outro provedor.
        </p>
      </div>
    );
  }

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <header
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}
      >
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700 }}>Casos de teste gerados</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
            {total} caso(s) em {analise.cards.length} card(s).
            {!interactive && ' Salve o plano para habilitar status de execução (passou/falhou).'}
          </p>
        </div>
      </header>

      {analise.cards.map((card) => (
        <div key={card.codigo || card.resumo} className="card-group">
          {card.codigo && (
            <div className="card-group-header">
              <h3>
                Card #{card.codigo} — {card.resumo}
              </h3>
              {card.caminho && (
                <p className="card-group-path">
                  <strong>Caminho:</strong> {card.caminho}
                </p>
              )}
              <span className="card-group-count">
                {card.casos.length} caso{card.casos.length !== 1 ? 's' : ''}
              </span>
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {card.casos.map((c, i) => {
              const codigo = c.id || `CT${String(i + 1).padStart(3, '0')}`;
              const compositeId = card.codigo ? `${card.codigo}-${codigo}` : codigo;
              const execucao = execucoes?.get(compositeId);
              return (
                <CasoCard
                  key={codigo + '-' + i}
                  caso={c}
                  index={i}
                  cardCodigo={card.codigo}
                  execucao={execucao}
                  interactive={interactive}
                  onMarkStatus={onMarkStatus}
                  onVerHistorico={onVerHistorico}
                />
              );
            })}
          </div>
        </div>
      ))}
    </section>
  );
}
