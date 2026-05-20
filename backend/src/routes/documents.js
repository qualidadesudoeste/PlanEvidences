import { Router } from 'express';
import path from 'node:path';
import os from 'node:os';
import { mkdir, writeFile, readFile, rm, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { nanoid } from 'nanoid';
import { buildLatex } from '../services/latex.js';
import { compilePdf } from '../services/compile.js';
import { putObject, deleteObject, keyFromUrl } from '../storage.js';
import { pool, rowToDoc } from '../db.js';
import { downloadImagesToDir } from '../services/fetchImages.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = path.resolve(__dirname, '../../templates');
const TEMPLATE_ASSETS = ['capa.png', 'cabecalho.png'];

const router = Router();

router.post('/generate', async (req, res, next) => {
  try {
    const project = req.body;
    if (!project || !project.projectName) {
      return res.status(400).json({ error: 'Dados do projeto ausentes.' });
    }

    const docId = `${Date.now()}-${nanoid(6)}`;
    const safeBase = sanitizeFilename(
      `Evidências de Teste - ${project.projectName || 'Projeto'} - ${project.clientName || 'Cliente'} - ${project.sprintName || 'Sprint'}`
    );

    const workDir = path.join(os.tmpdir(), 'planevidences', docId);
    await mkdir(workDir, { recursive: true });

    try {
      await Promise.all(
        TEMPLATE_ASSETS.map((name) =>
          copyFile(path.join(TEMPLATE_DIR, name), path.join(workDir, name)).catch(
            (err) => {
              console.warn(`[latex] template asset ${name} indisponível: ${err.message}`);
            }
          )
        )
      );

      const localScenarios = await downloadImagesToDir(project.scenarios || [], workDir);
      const tex = buildLatex({ ...project, scenarios: localScenarios }, { uploadsDir: workDir });

      const texPath = path.join(workDir, `${safeBase}.tex`);
      await writeFile(texPath, tex, 'utf-8');

      const pdfResult = await compilePdf(texPath, workDir).catch((err) => ({
        ok: false,
        error: err.message,
      }));

      const texKey = `documents/${docId}/${safeBase}.tex`;
      const texUrl = await putObject(texKey, await readFile(texPath), 'application/x-tex');

      let pdfUrl = null;
      let pdfKey = null;
      if (pdfResult.ok) {
        const pdfBuf = await readFile(pdfResult.pdfPath);
        pdfKey = `documents/${docId}/${safeBase}.pdf`;
        pdfUrl = await putObject(pdfKey, pdfBuf, 'application/pdf');
      }

      const createdAt = new Date();
      await pool.query(
        `INSERT INTO documents
          (id, project_name, client_name, sprint_name, version, redator, base_name, tex_url, tex_key, pdf_url, pdf_key, pdf_error, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          docId,
          project.projectName,
          project.clientName,
          project.sprintName,
          project.version,
          project.redator,
          safeBase,
          texUrl,
          texKey,
          pdfUrl,
          pdfKey,
          pdfResult.ok ? null : pdfResult.error || 'pdflatex não encontrado',
          createdAt,
        ]
      );

      res.json({
        id: docId,
        createdAt: createdAt.toISOString(),
        projectName: project.projectName,
        clientName: project.clientName,
        sprintName: project.sprintName,
        version: project.version,
        redator: project.redator,
        tex: texUrl,
        pdf: pdfUrl,
        pdfError: pdfResult.ok ? null : pdfResult.error || 'pdflatex não encontrado',
        baseName: safeBase,
      });
    } finally {
      rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  } catch (err) {
    next(err);
  }
});

router.get('/', async (_req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT * FROM documents ORDER BY created_at DESC LIMIT 200'
    );
    res.json({ items: result.rows.map(rowToDoc) });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const id = req.params.id;
    const result = await pool.query('SELECT tex_key, pdf_key FROM documents WHERE id = $1', [id]);
    const row = result.rows[0];

    if (row) {
      await Promise.all([
        deleteObject(row.tex_key).catch(() => {}),
        row.pdf_key ? deleteObject(row.pdf_key).catch(() => {}) : Promise.resolve(),
      ]);
      await pool.query('DELETE FROM documents WHERE id = $1', [id]);
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Mantém acentos, espaços e hífens; remove apenas o que é inválido
// em nomes de arquivo (Windows/POSIX) ou caracteres de controle.
function sanitizeFilename(name) {
  return (
    String(name)
      .replace(/[\x00-\x1f\x7f]/g, '')
      .replace(/[\/\\:*?"<>|]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 150) || 'documento'
  );
}

export default router;
