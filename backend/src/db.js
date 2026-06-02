import pg from 'pg';

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.warn('[db] DATABASE_URL não definida — endpoints de histórico vão pular o banco (geração de PDF segue funcionando).');
}

// Pool é null quando DATABASE_URL não está definida. Antes a gente construía o
// Pool de qualquer jeito e o pg caía no fallback pra localhost com SSL, gerando
// "The server does not support SSL connections" — erro confuso. Agora o caller
// checa `pool` e pula DB graciosamente.
export const pool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      ssl: DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
    })
  : null;

if (pool) {
  pool.on('error', (err) => {
    console.error('[db] pool error:', err);
  });
}

export async function ensureSchema() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      project_name TEXT,
      client_name TEXT,
      sprint_name TEXT,
      version TEXT,
      redator TEXT,
      base_name TEXT NOT NULL,
      tex_url TEXT NOT NULL,
      tex_key TEXT NOT NULL,
      pdf_url TEXT,
      pdf_key TEXT,
      pdf_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS documents_created_idx ON documents (created_at DESC);
    -- project_json guarda o payload completo (scenarios, evidências, imagens) pra
    -- permitir reabrir um documento do histórico no editor. ALTER idempotente:
    -- documentos antigos ficam com NULL e são tratados como "sem projeto salvo".
    ALTER TABLE documents ADD COLUMN IF NOT EXISTS project_json JSONB;
  `);
  console.log('[db] schema ready');
}

export function rowToDoc(r) {
  return {
    id: r.id,
    projectName: r.project_name,
    clientName: r.client_name,
    sprintName: r.sprint_name,
    version: r.version,
    redator: r.redator,
    baseName: r.base_name,
    tex: r.tex_url,
    pdf: r.pdf_url,
    pdfError: r.pdf_error,
    createdAt: r.created_at.toISOString(),
    hasProject: r.project_json != null,
  };
}
