import type { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabase } from '@/lib/supabase';
import type { Project } from '@/types';

export interface EvidenceProjectRecord {
  id: string;
  project_name: string;
  sprint_name: string | null;
  project_json: Project;
  created_at: string;
  updated_at: string;
}

export interface EvidenceProjectListItem {
  id: string;
  project_name: string;
  sprint_name: string | null;
  updated_at: string;
}

export interface UpsertResult {
  id: string;
  updated_at: string;
}

export async function loadEvidenceProject(id: string): Promise<EvidenceProjectRecord> {
  const supa = getSupabase();
  if (!supa) throw new Error('Supabase não configurado.');
  const { data, error } = await supa.from('evidence_projects').select('*').eq('id', id).single();
  if (error) throw error;
  return data as EvidenceProjectRecord;
}

export async function listEvidenceProjects(): Promise<EvidenceProjectListItem[]> {
  const supa = getSupabase();
  if (!supa) return [];
  const { data, error } = await supa
    .from('evidence_projects')
    .select('id, project_name, sprint_name, updated_at')
    .order('updated_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data || []) as EvidenceProjectListItem[];
}

/**
 * Cria (quando id é null) ou atualiza um projeto. Retorna o id + updated_at
 * canônicos pra o caller atualizar URL/estado de sincronização.
 */
export async function upsertEvidenceProject(opts: {
  id: string | null;
  project: Project;
}): Promise<UpsertResult> {
  const supa = getSupabase();
  if (!supa) throw new Error('Supabase não configurado.');

  const payload = {
    project_name: opts.project.projectName || 'Sem nome',
    sprint_name: opts.project.sprintName || null,
    project_json: opts.project,
  };

  if (opts.id) {
    const { data, error } = await supa
      .from('evidence_projects')
      .update(payload)
      .eq('id', opts.id)
      .select('id, updated_at')
      .single();
    if (error) throw error;
    return data as UpsertResult;
  } else {
    const { data, error } = await supa
      .from('evidence_projects')
      .insert(payload)
      .select('id, updated_at')
      .single();
    if (error) throw error;
    return data as UpsertResult;
  }
}

export async function deleteEvidenceProject(id: string): Promise<void> {
  const supa = getSupabase();
  if (!supa) throw new Error('Supabase não configurado.');
  const { error } = await supa.from('evidence_projects').delete().eq('id', id);
  if (error) throw error;
}

/**
 * Inscreve em updates da row específica via Supabase Realtime. Callback recebe
 * o record atualizado. Retorna função pra cancelar a inscrição.
 */
export function subscribeEvidenceProject(
  id: string,
  onUpdate: (record: EvidenceProjectRecord) => void
): () => void {
  const supa = getSupabase();
  if (!supa) return () => {};

  const channel: RealtimeChannel = supa
    .channel(`evidence-project-${id}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'evidence_projects',
        filter: `id=eq.${id}`,
      },
      (payload) => {
        if (payload.new) onUpdate(payload.new as EvidenceProjectRecord);
      }
    )
    .subscribe();

  return () => {
    supa.removeChannel(channel);
  };
}
