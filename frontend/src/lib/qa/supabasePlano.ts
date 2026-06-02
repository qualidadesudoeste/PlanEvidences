import { getSupabase } from '@/lib/supabase';
import type { QAAnaliseResult, QACard, QACriticidade, QATipoSistema } from '@/types';
import type { Scenario } from '@/types';

// Hash estável leve (djb2) — só serve pra deduplicar plano por (projeto+sprint+hu).
export function huHash(hu: string): string {
  let h = 5381;
  const s = (hu || '').trim();
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return 'h' + (h >>> 0).toString(16);
}

export interface PlanoQAPayload {
  projeto: string;
  sprint: string;
  tela: string | null;
  hu: string;
  tipoSistema: QATipoSistema;
  criticidade: QACriticidade;
  analise: QAAnaliseResult;
  cards: QACard[];
  scenariosBdd: Scenario[];
}

export interface PlanoQARecord {
  id: string;
  projeto: string;
  sprint: string;
  tela: string | null;
  hu: string;
  tipo_sistema: string | null;
  criticidade: string | null;
  updated_at: string;
  resultado_json: PlanoQAResultado;
}

export interface PlanoQAResultado {
  analise?: QAAnaliseResult;
  cards?: QACard[];
  scenarios_bdd?: Scenario[];
  // mantém compat com gravações antigas
  [key: string]: unknown;
}

// Grava o plano (insert ou update por projeto+sprint+hu_hash). Retorna o id do plano.
export async function upsertPlanoQA(payload: PlanoQAPayload): Promise<string> {
  const supa = getSupabase();
  if (!supa) throw new Error('Supabase não configurado (VITE_SUPABASE_URL/KEY).');

  const resultado: PlanoQAResultado = {
    analise: payload.analise,
    cards: payload.cards,
    scenarios_bdd: payload.scenariosBdd,
  };

  const { data, error } = await supa
    .from('test_plans')
    .upsert(
      {
        projeto: payload.projeto,
        sprint: payload.sprint,
        tela: payload.tela,
        hu: payload.hu,
        hu_hash: huHash(payload.hu),
        tipo_sistema: payload.tipoSistema,
        criticidade: payload.criticidade,
        resultado_json: resultado,
      },
      { onConflict: 'projeto,sprint,hu_hash' }
    )
    .select('id')
    .single();

  if (error) throw error;
  return (data as { id: string }).id;
}

export async function carregarPlanoCompleto(planId: string): Promise<PlanoQARecord> {
  const supa = getSupabase();
  if (!supa) throw new Error('Supabase não configurado.');
  const { data, error } = await supa.from('test_plans').select('*').eq('id', planId).single();
  if (error) throw error;
  return data as PlanoQARecord;
}

// Deriva o "nome curto" do plano (rótulo na listagem) a partir de cards/HU.
export function derivarTela(cards: QACard[], projeto: string, sprint: string): string {
  if (cards.length > 1) return `Plano — ${cards.length} cards`;
  const primeiro = cards[0];
  if (primeiro?.resumo) return primeiro.resumo;
  return `${projeto} / Sprint ${sprint}`;
}
