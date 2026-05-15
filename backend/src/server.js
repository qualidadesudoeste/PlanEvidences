import express from 'express';
import cors from 'cors';
import uploadRouter from './routes/upload.js';
import documentsRouter from './routes/documents.js';
import { ensureSchema } from './db.js';

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

app.use('/api/upload', uploadRouter);
app.use('/api/documents', documentsRouter);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use((err, _req, res, _next) => {
  console.error('[error]', err);
  res.status(500).json({
    error: err.message || 'Erro interno do servidor',
    code: err.code,
    detail: err.detail,
  });
});

await ensureSchema().catch((err) => {
  console.error('[startup] ensureSchema failed:', err.message);
});

app.listen(PORT, () => {
  console.log(`[backend] listening on :${PORT}`);
  if (allowedOrigins.length > 0) {
    console.log(`[backend] CORS allowed: ${allowedOrigins.join(', ')}`);
  } else {
    console.log('[backend] CORS: open (set ALLOWED_ORIGINS to restrict)');
  }
});
