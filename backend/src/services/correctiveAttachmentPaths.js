import path from 'node:path';

export function safeStorageSegment(value, fallback = 'user') {
  const safe = String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 100);
  return safe || fallback;
}

export function validateCorrectiveRequestId(value) {
  const requestId = String(value || '').trim();
  return /^[a-zA-Z0-9._:-]{8,120}$/.test(requestId) ? requestId : '';
}

export function correctiveAttachmentPrefix(userKey, requestId) {
  return `correctives/${safeStorageSegment(userKey)}/${requestId}/`;
}

export function safeAttachmentName(value, fallback = 'evidencia.png') {
  const basename = path.basename(String(value || fallback));
  const safe = basename
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[<>:"/\\|?*]/g, '_')
    .trim()
    .slice(0, 140);
  return safe || fallback;
}

