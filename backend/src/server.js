import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import uploadRouter from './routes/upload.js';
import documentsRouter from './routes/documents.js';
import aiRouter from './routes/ai.js';
import sigRouter from './routes/sig.js';
import authRouter from './routes/auth.js';
import correctiveAttachmentsRouter from './routes/correctiveAttachments.js';
import { requireAuth } from './services/authSessions.js';
import { ensureSchema } from './db.js';

const app = express();
const PORT = process.env.PORT || 4500;

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : false,
    credentials: true,
  })
);
app.use(express.json({ limit: '50mb' }));

app.use('/api/auth', authRouter);
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api', requireAuth);
app.use('/api/upload', uploadRouter);
app.use('/api/corrective-attachments', correctiveAttachmentsRouter);
app.use('/api/documents', documentsRouter);
app.use('/api/ai-analyze', aiRouter);
app.use('/api/sig', sigRouter);

// Serve frontend build (Vite dist/) quando presente. Em dev o Vite serve por
// conta própria na 5173; em produção (Smart Sig Runner) o mesmo processo Node
// entrega frontend e API na mesma porta. Caminho: backend/src/server.js → ../../frontend/dist.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDist = path.resolve(__dirname, '..', '..', 'frontend', 'dist');
const frontendIndex = path.join(frontendDist, 'index.html');

if (existsSync(frontendIndex)) {
  app.use(express.static(frontendDist));
  // SPA fallback: qualquer rota fora de /api devolve o index.html para o React Router resolver.
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile(frontendIndex);
  });
  console.log(`[backend] servindo frontend de ${frontendDist}`);
} else {
  console.log(`[backend] frontend/dist não encontrado em ${frontendDist} — rodando só a API`);
}

app.use((err, _req, res, _next) => {
  console.error('[error]', err);
  const uploadLimitError = err.code === 'LIMIT_FILE_SIZE' || err.code === 'LIMIT_FILE_COUNT';
  const status = uploadLimitError
    ? 400
    : err.status && err.status >= 400 && err.status < 600
      ? err.status
      : 500;
  res.status(status).json({
    error:
      err.code === 'LIMIT_FILE_SIZE'
        ? 'Cada print deve ter no máximo 20 MB.'
        : err.code === 'LIMIT_FILE_COUNT'
          ? 'Envie no máximo 10 prints por vez.'
          : err.message || 'Erro interno do servidor',
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
    console.log('[backend] CORS: same-origin only');
  }
});
