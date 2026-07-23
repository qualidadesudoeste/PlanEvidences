import type { Project, GeneratedDoc, UploadedImage } from '@/types';

const API_ORIGIN = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const API_BASE = `${API_ORIGIN}/api`;

export function resolveAssetUrl(p: string | null | undefined): string {
  if (!p) return '';
  if (/^https?:\/\//i.test(p)) return p;
  return `${API_ORIGIN}${p}`;
}

async function handle<T>(res: Response): Promise<T> {
  if (res.status === 401) {
    window.dispatchEvent(new Event('planevidences:unauthorized'));
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Erro ${res.status}`);
  }
  return res.json();
}

export async function uploadImages(
  files: File[],
  sessionId: string,
  onProgress?: (pct: number) => void
): Promise<{ files: UploadedImage[] }> {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append('sessionId', sessionId);
    files.forEach((f) => fd.append('files', f));

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}/upload`);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status === 401) {
        window.dispatchEvent(new Event('planevidences:unauthorized'));
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch (e) {
          reject(e);
        }
      } else {
        reject(new Error(xhr.responseText || 'Erro no upload'));
      }
    };
    xhr.onerror = () => reject(new Error('Falha de rede no upload'));
    xhr.send(fd);
  });
}

export async function deleteUpload(sessionId: string, filename: string): Promise<void> {
  const res = await fetch(`${API_BASE}/upload/${encodeURIComponent(sessionId)}/${encodeURIComponent(filename)}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!res.ok) await handle<never>(res);
}

export async function generateDocument(project: Project): Promise<GeneratedDoc> {
  const res = await fetch(`${API_BASE}/documents/generate`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(project),
  });
  return handle<GeneratedDoc>(res);
}

export async function listDocuments(): Promise<{ items: GeneratedDoc[] }> {
  const res = await fetch(`${API_BASE}/documents`, { credentials: 'include' });
  return handle<{ items: GeneratedDoc[] }>(res);
}

export async function deleteDocument(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/documents/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!res.ok) await handle<never>(res);
}

export async function getDocumentProject(id: string): Promise<Project> {
  const res = await fetch(`${API_BASE}/documents/${encodeURIComponent(id)}/project`, {
    credentials: 'include',
  });
  const data = await handle<{ project: Project }>(res);
  return data.project;
}
