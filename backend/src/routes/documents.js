import { Router } from 'express';
import path from 'node:path';
import { mkdir, writeFile, readdir, stat, readFile, rm } from 'node:fs/promises';
import { nanoid } from 'nanoid';
import { buildLatex } from '../services/latex.js';
import { compilePdf } from '../services/compile.js';
import { GENERATED_DIR, UPLOADS_DIR } from '../server.js';

const router = Router();

router.post('/generate', async (req, res, next) => {
  try {
    const project = req.body;
    if (!project || !project.projectName) {
      return res.status(400).json({ error: 'Dados do projeto ausentes.' });
    }

    const docId = `${Date.now()}-${nanoid(6)}`;
    const docDir = path.join(GENERATED_DIR, docId);
    await mkdir(docDir, { recursive: true });

    const safeBase = sanitizeFilename(
      `${project.clientName || 'cliente'}_${project.sprintName || 'sprint'}_v${project.version || '1.0'}`
    );

    const tex = buildLatex(project, { uploadsDir: UPLOADS_DIR });
    const texPath = path.join(docDir, `${safeBase}.tex`);
    await writeFile(texPath, tex, 'utf-8');

    const pdfResult = await compilePdf(texPath, docDir).catch((err) => ({
      ok: false,
      error: err.message,
    }));

    const meta = {
      id: docId,
      createdAt: new Date().toISOString(),
      projectName: project.projectName,
      clientName: project.clientName,
      sprintName: project.sprintName,
      version: project.version,
      redator: project.redator,
      tex: `/generated/${docId}/${safeBase}.tex`,
      pdf: pdfResult.ok ? `/generated/${docId}/${safeBase}.pdf` : null,
      pdfError: pdfResult.ok ? null : pdfResult.error || 'pdflatex não encontrado',
      baseName: safeBase,
    };
    await writeFile(path.join(docDir, 'meta.json'), JSON.stringify(meta, null, 2));

    res.json(meta);
  } catch (err) {
    next(err);
  }
});

router.get('/', async (_req, res, next) => {
  try {
    const entries = await readdir(GENERATED_DIR).catch(() => []);
    const items = [];
    for (const entry of entries) {
      const metaPath = path.join(GENERATED_DIR, entry, 'meta.json');
      try {
        const content = await readFile(metaPath, 'utf-8');
        items.push(JSON.parse(content));
      } catch {
        /* skip */
      }
    }
    items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const id = path.basename(req.params.id);
    const dir = path.join(GENERATED_DIR, id);
    await rm(dir, { recursive: true, force: true });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

function sanitizeFilename(name) {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9_\-.]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 80) || 'documento';
}

export default router;
