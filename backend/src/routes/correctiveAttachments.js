import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import { nanoid } from 'nanoid';
import sharp from 'sharp';
import { deleteObject, putObject } from '../storage.js';
import {
  correctiveAttachmentPrefix,
  safeAttachmentName,
  validateCorrectiveRequestId,
} from '../services/correctiveAttachmentPaths.js';

const router = Router();
const MAX_ATTACHMENT_SIZE = 20 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ATTACHMENT_SIZE, files: 10 },
  fileFilter: (_req, file, cb) => {
    const accepted = /^image\/(png|jpe?g)$/i.test(file.mimetype);
    cb(
      accepted
        ? null
        : new Error('Formato inválido. Os prints da corretiva devem ser PNG, JPG ou JPEG.'),
      accepted
    );
  },
});

function userStorageKey(req) {
  return req.authSession.user.userId || req.authSession.id;
}

async function processImage(file) {
  const originalExtension = path.extname(file.originalname).toLowerCase();
  const png = file.mimetype.toLowerCase() === 'image/png' || originalExtension === '.png';
  if (png) {
    return {
      buffer: await sharp(file.buffer)
        .rotate()
        .resize({ width: 1920, withoutEnlargement: true })
        .png({ compressionLevel: 8 })
        .toBuffer(),
      extension: '.png',
      contentType: 'image/png',
    };
  }
  return {
    buffer: await sharp(file.buffer)
      .rotate()
      .resize({ width: 1920, withoutEnlargement: true })
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer(),
    extension: '.jpg',
    contentType: 'image/jpeg',
  };
}

router.post('/', upload.array('files', 10), async (req, res, next) => {
  try {
    const requestId = validateCorrectiveRequestId(req.body.requestId);
    if (!requestId) {
      return res.status(400).json({
        ok: false,
        error: 'Identificador da corretiva inválido. Feche a janela e tente novamente.',
      });
    }
    const files = req.files || [];
    if (files.length === 0) {
      return res.status(400).json({ ok: false, error: 'Selecione ao menos um print do erro.' });
    }

    const prefix = correctiveAttachmentPrefix(userStorageKey(req), requestId);
    const attachments = await Promise.all(
      files.map(async (file) => {
        const processed = await processImage(file);
        const id = nanoid(12);
        const filename = `${id}${processed.extension}`;
        const key = `${prefix}${filename}`;
        const url = await putObject(
          key,
          processed.buffer,
          processed.contentType
        );
        return {
          id,
          originalName: safeAttachmentName(file.originalname, `print-${id}${processed.extension}`),
          filename,
          key,
          url,
          size: processed.buffer.length,
          mimeType: processed.contentType,
        };
      })
    );
    return res.status(201).json({ ok: true, attachments });
  } catch (error) {
    return next(error);
  }
});

router.delete('/:requestId/:filename', async (req, res, next) => {
  try {
    const requestId = validateCorrectiveRequestId(req.params.requestId);
    if (!requestId) {
      return res.status(400).json({ ok: false, error: 'Identificador da corretiva inválido.' });
    }
    const filename = path.basename(req.params.filename);
    if (!/^[a-zA-Z0-9_-]{6,80}\.(png|jpe?g)$/i.test(filename)) {
      return res.status(400).json({ ok: false, error: 'Nome do anexo inválido.' });
    }
    const key = `${correctiveAttachmentPrefix(userStorageKey(req), requestId)}${filename}`;
    await deleteObject(key);
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

export default router;

