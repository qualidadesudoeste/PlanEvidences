import pg from 'pg';

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.warn('[db] DATABASE_URL não definida — endpoints de histórico vão falhar.');
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
});

pool.on('error', (err) => {
  console.error('[db] pool error:', err);
});

export async function ensureSchema() {
  if (!process.env.DATABASE_URL) return;
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
