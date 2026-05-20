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

if (!ENDPOINT || !ACCESS_KEY || !SECRET_KEY || !BUCKET || !PUBLIC_URL) {
  console.warn(
    '[storage] Não totalmente configurado. Faltam vars: ' +
      [
        !ENDPOINT && 'STORAGE_ENDPOINT',
        !ACCESS_KEY && 'STORAGE_ACCESS_KEY_ID',
        !SECRET_KEY && 'STORAGE_SECRET_ACCESS_KEY',
        !BUCKET && 'STORAGE_BUCKET',
        !PUBLIC_URL && 'STORAGE_PUBLIC_URL',
      ]
        .filter(Boolean)
        .join(', ')
  );
}

export const s3 = new S3Client({
  region: REGION,
  endpoint: ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: ACCESS_KEY,
    secretAccessKey: SECRET_KEY,
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
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

export async function getObjectBuffer(key) {
  const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const chunks = [];
  for await (const chunk of res.Body) chunks.push(chunk);
  return Buffer.concat(chunks);
}
