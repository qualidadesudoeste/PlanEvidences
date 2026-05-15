import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import { nanoid } from 'nanoid';
import sharp from 'sharp';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { UPLOADS_DIR } from '../server.js';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /^image\/(png|jpe?g)$/i.test(file.mimetype);
    cb(ok ? null : new Error('Formato inválido. Aceitos: PNG, JPG, JPEG.'), ok);
  },
});

router.post('/', upload.array('files', 20), async (req, res, next) => {
  try {
    const sessionId = req.body.sessionId || 'default';
    const sessionDir = path.join(UPLOADS_DIR, sessionId);
    await mkdir(sessionDir, { recursive: true });

    const results = await Promise.all(
      (req.files ?? []).map(async (file) => {
        const id = nanoid(10);
        const ext = (path.extname(file.originalname) || '.png').toLowerCase();
        const filename = `${id}${ext}`;
        const filepath = path.join(sessionDir, filename);

        const compressed = await sharp(file.buffer)
          .rotate()
          .resize({ width: 1600, withoutEnlargement: true })
          .jpeg({ quality: 82, mozjpeg: true })
          .toBuffer();

        await writeFile(filepath, compressed);

        return {
          id,
          originalName: file.originalname,
          filename,
          path: `${sessionId}/${filename}`,
          url: `/uploads/${sessionId}/${filename}`,
          size: compressed.length,
        };
      })
    );

    res.json({ files: results });
  } catch (err) {
    next(err);
  }
});

router.delete('/:sessionId/:filename', async (req, res, next) => {
  try {
    const { sessionId, filename } = req.params;
    const safe = path.basename(filename);
    const filepath = path.join(UPLOADS_DIR, sessionId, safe);
    await unlink(filepath).catch(() => {});
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
