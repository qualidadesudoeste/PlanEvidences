import { getSupabase } from '@/lib/supabase';

export type ExecucaoStatus = 'nao_executado' | 'passou' | 'falhou';

export interface ExecucaoRow {
  id: string;
  plan_id: string;
  case_id: string;
  titulo: string | null;
  tipo: string | null;
  origem: string | null;
  status: ExecucaoStatus;
  fail_count: number;
  updated_at: string;
}

export interface FalhaRow {
  observacao: string | null;
  created_at: string;
}

export async function carregarExecucoes(planId: string): Promise<ExecucaoRow[]> {
  const supa = getSupabase();
  if (!supa) return [];
  const { data, error } = await supa
    .from('test_case_executions')
    .select('*')
    .eq('plan_id', planId);
  if (error) throw error;
  return (data || []) as ExecucaoRow[];
}

export async function salvarExecucao({
  planId,
  caseId,
  status,
  titulo,
  tipo,
  origem,
}: {
  planId: string;
  caseId: string;
  status: ExecucaoStatus;
  titulo?: string | null;
  tipo?: string | null;
  origem?: string | null;
}): Promise<ExecucaoRow> {
  const supa = getSupabase();
  if (!supa) throw new Error('Supabase não configurado.');
  const { data, error } = await supa
    .from('test_case_executions')
    .upsert(
      { plan_id: planId, case_id: caseId, status, titulo, tipo, origem },
      { onConflict: 'plan_id,case_id' }
    )
    .select()
    .single();
  if (error) throw error;
  return data as ExecucaoRow;
}

export async function registrarFalha({
  planId,
  caseId,
  observacao,
}: {
  planId: string;
  caseId: string;
  observacao?: string | null;
}): Promise<{ failCount: number }> {
  const supa = getSupabase();
  if (!supa) throw new Error('Supabase não configurado.');

  // Increment fail_count: read atual → +1 → update status/contagem → registra histórico
  const { data: atual } = await supa
    .from('test_case_executions')
    .select('fail_count')
    .eq('plan_id', planId)
    .eq('case_id', caseId)
    .maybeSingle();

  const novoCount = ((atual as { fail_count?: number } | null)?.fail_count || 0) + 1;

  const { error: e1 } = await supa
    .from('test_case_executions')
    .update({ status: 'falhou', fail_count: novoCount })
    .eq('plan_id', planId)
    .eq('case_id', caseId);
  if (e1) throw e1;

  const { error: e2 } = await supa
    .from('test_case_fail_history')
    .insert({ plan_id: planId, case_id: caseId, observacao: observacao || null });
  if (e2) throw e2;

  return { failCount: novoCount };
}

export async function historicoFalhas({
  planId,
  caseId,
}: {
  planId: string;
  caseId: string;
}): Promise<FalhaRow[]> {
  const supa = getSupabase();
  if (!supa) return [];
  const { data, error } = await supa
    .from('test_case_fail_history')
    .select('observacao, created_at')
    .eq('plan_id', planId)
    .eq('case_id', caseId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []) as FalhaRow[];
}
