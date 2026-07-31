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
const MAX_IMAGE_SIZE = 20 * 1024 * 1024;   // 20 MB
const MAX_VIDEO_SIZE = 200 * 1024 * 1024;  // 200 MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_VIDEO_SIZE, files: 10 },
  fileFilter: (_req, file, cb) => {
    const isImage = /^image\/(png|jpe?g)$/i.test(file.mimetype);
    const isVideo = /^video\/mp4$/i.test(file.mimetype);
    cb(
      isImage || isVideo
        ? null
        : new Error('Formato inválido. Os anexos da corretiva devem ser PNG, JPG, JPEG ou MP4.'),
      isImage || isVideo
    );
  },
});

function userStorageKey(req) {
  return req.authSession.user.userId || req.authSession.id;
}

async function processVideo(file) {
  return {
    buffer: file.buffer,
    extension: '.mp4',
    contentType: 'video/mp4',
  };
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
    const oversized = files.find((file) => {
      const isVideo = /^video\/mp4$/i.test(file.mimetype);
      return isVideo ? file.size > MAX_VIDEO_SIZE : file.size > MAX_IMAGE_SIZE;
    });
    if (oversized) {
      const isVideo = /^video\/mp4$/i.test(oversized.mimetype);
      return res.status(400).json({
        ok: false,
        error: isVideo
          ? 'Vídeo muito grande. O tamanho máximo é 200 MB.'
          : 'Imagem muito grande. O tamanho máximo é 20 MB.',
      });
    }

    const attachments = await Promise.all(
      files.map(async (file) => {
        const isVideo = /^video\/mp4$/i.test(file.mimetype);
        const processed = isVideo ? await processVideo(file) : await processImage(file);
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
    if (!/^[a-zA-Z0-9_-]{6,80}\.(png|jpe?g|mp4)$/i.test(filename)) {
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

