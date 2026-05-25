import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return client;
}

export function supabaseEnabled(): boolean {
  return !!(SUPABASE_URL && SUPABASE_ANON_KEY);
}

export interface QATestPlan {
  id: string;
  projeto: string;
  sprint: string;
  tela: string | null;
  tipo_sistema: string | null;
  criticidade: string | null;
  updated_at: string;
  resultado_json?: {
    scenarios_bdd?: Array<{
      id: string;
      title: string;
      bdd: string;
      evidence: string;
      images: unknown[];
      cardCodigo?: string | null;
      cardResumo?: string | null;
      cardCaminho?: string | null;
      caseId?: string | null;
    }>;
  };
}

export async function listarPlanosQA(filtros?: {
  projeto?: string;
  sprint?: string;
}): Promise<QATestPlan[]> {
  const supa = getSupabase();
  if (!supa) throw new Error('Supabase não configurado. Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.');

  let q = supa
    .from('test_plans')
    .select('id, projeto, sprint, tela, tipo_sistema, criticidade, updated_at')
    .order('updated_at', { ascending: false })
    .limit(100);

  if (filtros?.projeto) q = q.eq('projeto', filtros.projeto);
  if (filtros?.sprint) q = q.eq('sprint', filtros.sprint);

  const { data, error } = await q;
  if (error) throw error;
  return (data || []) as QATestPlan[];
}

export async function carregarPlanoQA(id: string): Promise<QATestPlan> {
  const supa = getSupabase();
  if (!supa) throw new Error('Supabase não configurado.');

  const { data, error } = await supa
    .from('test_plans')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data as QATestPlan;
}

export async function salvarPlanoQA(id: string, scenarios: any[]): Promise<void> {
  const supa = getSupabase();
  if (!supa) throw new Error('Supabase não configurado.');

  // Primeiro buscamos o plano existente para preservar outras propriedades de resultado_json
  const { data: existing, error: getError } = await supa
    .from('test_plans')
    .select('resultado_json')
    .eq('id', id)
    .single();

  if (getError) throw getError;

  const resultado_json = {
    ...(existing?.resultado_json || {}),
    scenarios_bdd: scenarios,
  };

  const { error } = await supa
    .from('test_plans')
    .update({
      resultado_json,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) throw error;
}

