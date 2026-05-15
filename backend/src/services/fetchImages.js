import path from 'node:path';
import { writeFile, mkdir } from 'node:fs/promises';
import { nanoid } from 'nanoid';
import { keyFromUrl, getObjectBuffer } from '../storage.js';

/**
 * Para cada cenário, baixa as imagens do R2 (ou de URL pública) para um
 * diretório local e retorna a mesma estrutura de cenários, com cada imagem
 * agora apontando para um caminho local relativo a `workDir`.
 *
 * O latex.js usa `img.path` joined com `uploadsDir` para gerar `\includegraphics{...}`.
 * Então definimos `img.path` como o filename local e passamos workDir como uploadsDir.
 */
export async function downloadImagesToDir(scenarios, workDir) {
  const imgDir = path.join(workDir, 'img');
  await mkdir(imgDir, { recursive: true });

  return Promise.all(
    scenarios.map(async (sc) => {
      const images = await Promise.all(
        (sc.images || []).map(async (img) => {
          if (!img?.url) return null;
          const ext = (path.extname(img.filename || img.url) || '.jpg').toLowerCase();
          const localName = `${nanoid(8)}${ext}`;
          const localPath = path.join('img', localName);
          const buf = await fetchImage(img);
          await writeFile(path.join(imgDir, localName), buf);
          return { ...img, path: localPath };
        })
      );
      return { ...sc, images: images.filter(Boolean) };
    })
  );
}

async function fetchImage(img) {
  const key = keyFromUrl(img.url) || img.key;
  if (key) {
    return getObjectBuffer(key);
  }
  const res = await fetch(img.url);
  if (!res.ok) throw new Error(`Falha ao baixar imagem: ${img.url} (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}
