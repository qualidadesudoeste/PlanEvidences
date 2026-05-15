import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import uploadRouter from './routes/upload.js';
import documentsRouter from './routes/documents.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BACKEND_DIR = path.resolve(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR || path.resolve(BACKEND_DIR, '..');

export const ROOT_DIR = DATA_DIR;
export const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(DATA_DIR, 'uploads');
export const GENERATED_DIR = process.env.GENERATED_DIR || path.join(DATA_DIR, 'generated');
export const TEMPLATES_DIR = path.join(BACKEND_DIR, '..', 'templates');

await mkdir(UPLOADS_DIR, { recursive: true });
await mkdir(GENERATED_DIR, { recursive: true });

const app = express();
const PORT = process.env.PORT || 3001;

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : true,
    credentials: false,
  })
);
app.use(express.json({ limit: '50mb' }));

app.use('/uploads', express.static(UPLOADS_DIR));
app.use('/generated', express.static(GENERATED_DIR));

app.use('/api/upload', uploadRouter);
app.use('/api/documents', documentsRouter);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use((err, _req, res, _next) => {
  console.error('[error]', err);
  res.status(500).json({ error: err.message || 'Erro interno do servidor' });
});

app.listen(PORT, () => {
  console.log(`[backend] listening on :${PORT}`);
  console.log(`[backend] data dir: ${DATA_DIR}`);
  if (allowedOrigins.length > 0) {
    console.log(`[backend] CORS allowed origins: ${allowedOrigins.join(', ')}`);
  } else {
    console.log('[backend] CORS: open (set ALLOWED_ORIGINS to restrict)');
  }
});
