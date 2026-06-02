import { useState } from 'react';
import { ClipboardList, ShieldAlert, BookOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CasesView } from './CasesView';
import { CoverageView } from './CoverageView';
import { HeuristicsView } from './HeuristicsView';
import type { CategoriaAplicavel, CoberturaResumo, RiscoIdentificado } from '@/lib/qa/heuristics';
import type { QAAnaliseResult } from '@/types';
import type { ExecucaoRow, ExecucaoStatus } from '@/lib/qa/execucao';

interface Props {
  analise: QAAnaliseResult;
  riscos: RiscoIdentificado[];
  cobertura: CoberturaResumo;
  categorias: CategoriaAplicavel[];
  progressoKey?: string;
  execucoes?: Map<string, ExecucaoRow>;
  interactive?: boolean;
  onMarkStatus?: (caso: { caseId: string; titulo: string; tipo?: string }, status: ExecucaoStatus) => void;
  onVerHistorico?: (caso: { caseId: string; titulo: string }) => void;
}

type Tab = 'casos' | 'cobertura' | 'heuristicas';

const TABS: Array<{ id: Tab; label: string; icon: typeof ClipboardList }> = [
  { id: 'casos', label: 'Casos de Teste', icon: ClipboardList },
  { id: 'cobertura', label: 'Cobertura e Riscos', icon: ShieldAlert },
  { id: 'heuristicas', label: 'Heurísticas', icon: BookOpen },
];

export function ResultsTabs({
  analise,
  riscos,
  cobertura,
  categorias,
  progressoKey,
  execucoes,
  interactive,
  onMarkStatus,
  onVerHistorico,
}: Props) {
  const [tab, setTab] = useState<Tab>('casos');
  const totalCasos = analise.cards.reduce((acc, c) => acc + c.casos.length, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <nav
        role="tablist"
        style={{
          display: 'flex',
          gap: 4,
          padding: 4,
          background: 'rgba(0,0,0,0.04)',
          borderRadius: 10,
          alignSelf: 'flex-start',
          flexWrap: 'wrap',
        }}
      >
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          let count: number | null = null;
          if (t.id === 'casos') count = totalCasos;
          else if (t.id === 'cobertura') count = riscos.length;
          else if (t.id === 'heuristicas') count = categorias.length;

          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.id)}
              className={cn('menu-item', active && 'active')}
              style={{
                background: active ? 'var(--card-bg)' : 'transparent',
                border: active ? '1px solid var(--border)' : '1px solid transparent',
                borderRadius: 8,
                padding: '6px 12px',
                fontSize: 13,
                fontWeight: active ? 700 : 500,
                color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                width: 'auto',
              }}
            >
              <Icon size={14} />
              {t.label}
              {count !== null && count > 0 && (
                <span
                  style={{
                    fontSize: 10,
                    padding: '1px 6px',
                    background: active ? 'var(--accent, #1e9e22)' : 'rgba(0,0,0,0.1)',
                    color: active ? '#fff' : 'var(--text-secondary)',
                    borderRadius: 999,
                    fontWeight: 700,
                  }}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div role="tabpanel">
        {tab === 'casos' && (
          <CasesView
            analise={analise}
            execucoes={execucoes}
            interactive={interactive}
            onMarkStatus={onMarkStatus}
            onVerHistorico={onVerHistorico}
          />
        )}
        {tab === 'cobertura' && (
          <CoverageView analise={analise} riscos={riscos} cobertura={cobertura} />
        )}
        {tab === 'heuristicas' && (
          <HeuristicsView categorias={categorias} progressoKey={progressoKey} />
        )}
      </div>
    </div>
  );
}
