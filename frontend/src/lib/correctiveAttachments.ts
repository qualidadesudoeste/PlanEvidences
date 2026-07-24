import type { CorrectiveAttachment } from '@/types';

interface UploadResponse {
  ok?: boolean;
  error?: string;
  attachments?: CorrectiveAttachment[];
}

async function readResponse(response: Response): Promise<UploadResponse> {
  const raw = await response.text();
  try {
    return raw ? (JSON.parse(raw) as UploadResponse) : {};
  } catch {
    return {};
  }
}

export async function uploadCorrectiveAttachments(
  files: File[],
  requestId: string
): Promise<CorrectiveAttachment[]> {
  const form = new FormData();
  form.append('requestId', requestId);
  files.forEach((file) => form.append('files', file));
  const response = await fetch('/api/corrective-attachments', {
    method: 'POST',
    credentials: 'include',
    body: form,
  }).catch(() => {
    throw new Error('Não foi possível enviar os prints para o PlanEvidences.');
  });
  const data = await readResponse(response);
  if (response.status === 401) {
    window.dispatchEvent(new Event('planevidences:unauthorized'));
  }
  if (!response.ok || !data.attachments) {
    throw new Error(data.error || 'Não foi possível armazenar os prints do erro.');
  }
  return data.attachments;
}

export async function deleteCorrectiveAttachment(
  requestId: string,
  attachment: CorrectiveAttachment
): Promise<void> {
  const response = await fetch(
    `/api/corrective-attachments/${encodeURIComponent(requestId)}/${encodeURIComponent(
      attachment.filename
    )}`,
    { method: 'DELETE', credentials: 'include' }
  );
  if (response.status === 401) {
    window.dispatchEvent(new Event('planevidences:unauthorized'));
  }
  if (!response.ok) {
    const data = await readResponse(response);
    throw new Error(data.error || 'Não foi possível remover o print.');
  }
}

