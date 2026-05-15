import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';

const ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const ACCESS_KEY = process.env.R2_ACCESS_KEY_ID;
const SECRET_KEY = process.env.R2_SECRET_ACCESS_KEY;
const BUCKET = process.env.R2_BUCKET;
const PUBLIC_URL = (process.env.R2_PUBLIC_URL || '').replace(/\/$/, '');

if (!ACCOUNT_ID || !ACCESS_KEY || !SECRET_KEY || !BUCKET || !PUBLIC_URL) {
  console.warn(
    '[storage] R2 não totalmente configurado. Faltam vars: ' +
      [
        !ACCOUNT_ID && 'R2_ACCOUNT_ID',
        !ACCESS_KEY && 'R2_ACCESS_KEY_ID',
        !SECRET_KEY && 'R2_SECRET_ACCESS_KEY',
        !BUCKET && 'R2_BUCKET',
        !PUBLIC_URL && 'R2_PUBLIC_URL',
      ]
        .filter(Boolean)
        .join(', ')
  );
}

export const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: ACCESS_KEY,
    secretAccessKey: SECRET_KEY,
  },
});

export const BUCKET_NAME = BUCKET;

export function publicUrl(key) {
  return `${PUBLIC_URL}/${key}`;
}

export function keyFromUrl(url) {
  if (!url || !PUBLIC_URL) return null;
  if (url.startsWith(`${PUBLIC_URL}/`)) return url.slice(PUBLIC_URL.length + 1);
  return null;
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
