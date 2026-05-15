import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import { nanoid } from 'nanoid';
import sharp from 'sharp';
import { putObject, deleteObject } from '../storage.js';

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
    const sessionId = (req.body.sessionId || 'default').replace(/[^a-zA-Z0-9-_]/g, '');

    const results = await Promise.all(
      (req.files ?? []).map(async (file) => {
        const id = nanoid(10);
        const ext = (path.extname(file.originalname) || '.jpg').toLowerCase();
        const safeExt = ext === '.png' ? '.png' : '.jpg';
        const filename = `${id}${safeExt}`;
        const key = `uploads/${sessionId}/${filename}`;

        let processed;
        let contentType;
        if (safeExt === '.png') {
          processed = await sharp(file.buffer)
            .rotate()
            .resize({ width: 1600, withoutEnlargement: true })
            .png({ compressionLevel: 8 })
            .toBuffer();
          contentType = 'image/png';
        } else {
          processed = await sharp(file.buffer)
            .rotate()
            .resize({ width: 1600, withoutEnlargement: true })
            .jpeg({ quality: 82, mozjpeg: true })
            .toBuffer();
          contentType = 'image/jpeg';
        }

        const url = await putObject(key, processed, contentType);

        return {
          id,
          originalName: file.originalname,
          filename,
          key,
          url,
          size: processed.length,
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
    const sessionId = req.params.sessionId.replace(/[^a-zA-Z0-9-_]/g, '');
    const filename = path.basename(req.params.filename);
    const key = `uploads/${sessionId}/${filename}`;
    await deleteObject(key).catch(() => {});
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
