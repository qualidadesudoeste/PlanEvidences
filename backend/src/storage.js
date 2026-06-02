import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';

const ENDPOINT = process.env.STORAGE_ENDPOINT;
const REGION = process.env.STORAGE_REGION || 'us-east-1';
const ACCESS_KEY = process.env.STORAGE_ACCESS_KEY_ID;
const SECRET_KEY = process.env.STORAGE_SECRET_ACCESS_KEY;
const BUCKET = process.env.STORAGE_BUCKET;
const PUBLIC_URL = (process.env.STORAGE_PUBLIC_URL || '').replace(/\/$/, '');

function missingStorageVars() {
  return [
    !ENDPOINT && 'STORAGE_ENDPOINT',
    !ACCESS_KEY && 'STORAGE_ACCESS_KEY_ID',
    !SECRET_KEY && 'STORAGE_SECRET_ACCESS_KEY',
    !BUCKET && 'STORAGE_BUCKET',
    !PUBLIC_URL && 'STORAGE_PUBLIC_URL',
  ].filter(Boolean);
}

const _missing = missingStorageVars();
if (_missing.length > 0) {
  console.warn('[storage] Não totalmente configurado. Faltam vars: ' + _missing.join(', '));
}

// Throw uma StorageNotConfiguredError com mensagem amigável ANTES da chamada S3.
// O AWS SDK estouraria "No value provided for input HTTP label: Bucket", que é
// críptico e não diz ao operador o que fazer.
class StorageNotConfiguredError extends Error {
  constructor(missing) {
    super(
      'Storage de imagens não está configurado. Defina no backend/.env: ' +
        missing.join(', ') +
        '. Reinicie o backend depois. Veja backend/.env.example pra exemplos (Supabase Storage, R2, MinIO).'
    );
    this.name = 'StorageNotConfiguredError';
    this.code = 'STORAGE_NOT_CONFIGURED';
    this.status = 503;
    this.missing = missing;
  }
}

function assertStorageReady() {
  const missing = missingStorageVars();
  if (missing.length > 0) throw new StorageNotConfiguredError(missing);
}

export function storageReady() {
  return missingStorageVars().length === 0;
}

export const s3 = new S3Client({
  region: REGION,
  endpoint: ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: ACCESS_KEY || 'unset',
    secretAccessKey: SECRET_KEY || 'unset',
  },
});

export const BUCKET_NAME = BUCKET;

function encodeKey(key) {
  return String(key).split('/').map(encodeURIComponent).join('/');
}

export function publicUrl(key) {
  return `${PUBLIC_URL}/${encodeKey(key)}`;
}

export function keyFromUrl(url) {
  if (!url || !PUBLIC_URL) return null;
  if (!url.startsWith(`${PUBLIC_URL}/`)) return null;
  const encoded = url.slice(PUBLIC_URL.length + 1);
  try {
    return encoded.split('/').map(decodeURIComponent).join('/');
  } catch {
    return encoded;
  }
}

export async function putObject(key, body, contentType) {
  assertStorageReady();
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
  return publicUrl(key);
}

export async function deleteObject(key) {
  if (!key) return;
  assertStorageReady();
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

export async function getObjectBuffer(key) {
  assertStorageReady();
  const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const chunks = [];
  for await (const chunk of res.Body) chunks.push(chunk);
  return Buffer.concat(chunks);
}
