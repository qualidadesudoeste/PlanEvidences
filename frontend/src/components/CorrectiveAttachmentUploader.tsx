import { useCallback, useEffect, useRef, useState } from 'react';
import { ClipboardPaste, Film, ImagePlus, Loader2, Trash2 } from 'lucide-react';
import type { CorrectiveAttachment } from '@/types';
import {
  deleteCorrectiveAttachment,
  uploadCorrectiveAttachments,
} from '@/lib/correctiveAttachments';
import { resolveAssetUrl } from '@/lib/api';
import { useToast } from '@/hooks/useToast';
import { getErrorMessage } from '@/lib/utils';

interface Props {
  requestId: string;
  attachments: CorrectiveAttachment[];
  onChange: (attachments: CorrectiveAttachment[]) => void;
  onUploadingChange?: (uploading: boolean) => void;
  disabled?: boolean;
}

const MAX_IMAGE_SIZE = 20 * 1024 * 1024;   // 20 MB
const MAX_VIDEO_SIZE = 200 * 1024 * 1024;  // 200 MB
const MAX_ATTACHMENTS = 10;

function isVideoMime(type: string) {
  return /^video\/mp4$/i.test(type);
}

function isImageMime(type: string) {
  return /^image\/(png|jpe?g)$/i.test(type);
}

function AttachmentPreview({ attachment }: { attachment: CorrectiveAttachment }) {
  const url = resolveAssetUrl(attachment.url);
  const isVideo = isVideoMime(attachment.mimeType);

  if (isVideo) {
    return (
      <div style={{ position: 'relative', width: '100%', aspectRatio: '16/9', background: '#000', borderRadius: 4, overflow: 'hidden' }}>
        <video
          src={url}
          preload="metadata"
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        />
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.35)', pointerEvents: 'none',
        }}>
          <Film size={28} color="#fff" />
        </div>
      </div>
    );
  }

  return <img src={url} alt={attachment.originalName} />;
}

export function CorrectiveAttachmentUploader({
  requestId,
  attachments,
  onChange,
  onUploadingChange,
  disabled = false,
}: Props) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);

  const sendFiles = useCallback(
    async (incoming: File[]) => {
      if (disabled || uploading || incoming.length === 0) return;

      const images = incoming.filter((f) => isImageMime(f.type));
      const videos = incoming.filter((f) => isVideoMime(f.type));
      const unsupported = incoming.filter((f) => !isImageMime(f.type) && !isVideoMime(f.type));

      if (unsupported.length > 0) {
        toast({
          variant: 'error',
          title: 'Formato não suportado',
          description: 'Os anexos devem ser PNG, JPG, JPEG ou MP4.',
        });
      }

      const oversizedImages = images.filter((f) => f.size > MAX_IMAGE_SIZE);
      const oversizedVideos = videos.filter((f) => f.size > MAX_VIDEO_SIZE);

      if (oversizedImages.length > 0) {
        toast({ variant: 'error', title: 'Imagem muito grande', description: 'O tamanho máximo por imagem é 20 MB.' });
      }
      if (oversizedVideos.length > 0) {
        toast({ variant: 'error', title: 'Vídeo muito grande', description: 'O tamanho máximo por vídeo é 200 MB.' });
      }

      const availableSlots = Math.max(0, MAX_ATTACHMENTS - attachments.length);
      if (availableSlots === 0) {
        toast({
          variant: 'error',
          title: 'Limite de anexos atingido',
          description: `Cada corretiva pode ter no máximo ${MAX_ATTACHMENTS} anexos.`,
        });
        return;
      }

      const valid = [
        ...images.filter((f) => f.size <= MAX_IMAGE_SIZE),
        ...videos.filter((f) => f.size <= MAX_VIDEO_SIZE),
      ].slice(0, availableSlots);

      if (valid.length < images.filter((f) => f.size <= MAX_IMAGE_SIZE).length + videos.filter((f) => f.size <= MAX_VIDEO_SIZE).length) {
        toast({
          variant: 'warning',
          title: 'Alguns anexos não foram adicionados',
          description: `Limite de ${MAX_ATTACHMENTS} anexos por corretiva.`,
        });
      }

      if (valid.length === 0) return;

      setUploading(true);
      onUploadingChange?.(true);
      try {
        const uploaded = await uploadCorrectiveAttachments(valid, requestId);
        onChange([...attachments, ...uploaded]);
        toast({
          variant: 'success',
          title: uploaded.length === 1 ? 'Anexo adicionado' : `${uploaded.length} anexos adicionados`,
        });
      } catch (error) {
        toast({
          variant: 'error',
          title: 'Falha ao adicionar os anexos',
          description: getErrorMessage(error),
        });
      } finally {
        setUploading(false);
        onUploadingChange?.(false);
        if (inputRef.current) inputRef.current.value = '';
      }
    },
    [attachments, disabled, onChange, onUploadingChange, requestId, toast, uploading]
  );

  useEffect(() => {
    if (disabled) return;
    const paste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files || []).filter((f) =>
        isImageMime(f.type) || isVideoMime(f.type)
      );
      if (files.length === 0) return;
      event.preventDefault();
      const named = files.map((file, index) => {
        if (isVideoMime(file.type)) {
          return new File([file], `video-colado-${new Date().toISOString().replace(/[:.]/g, '-')}-${index + 1}.mp4`, { type: 'video/mp4' });
        }
        const extension = file.type === 'image/jpeg' ? 'jpg' : 'png';
        return new File([file], `print-colado-${new Date().toISOString().replace(/[:.]/g, '-')}-${index + 1}.${extension}`, { type: file.type || 'image/png' });
      });
      void sendFiles(named);
    };
    window.addEventListener('paste', paste);
    return () => window.removeEventListener('paste', paste);
  }, [disabled, sendFiles]);

  const remove = async (attachment: CorrectiveAttachment) => {
    try {
      if (!attachment.key.startsWith('automation/')) {
        await deleteCorrectiveAttachment(requestId, attachment);
      }
      onChange(attachments.filter((item) => item.id !== attachment.id));
    } catch (error) {
      toast({
        variant: 'error',
        title: 'Falha ao remover o anexo',
        description: getErrorMessage(error),
      });
    }
  };

  const imageCount = attachments.filter((a) => !isVideoMime(a.mimeType)).length;
  const videoCount = attachments.filter((a) => isVideoMime(a.mimeType)).length;

  const countLabel = (() => {
    const parts: string[] = [];
    if (imageCount > 0) parts.push(`${imageCount} ${imageCount === 1 ? 'print' : 'prints'}`);
    if (videoCount > 0) parts.push(`${videoCount} ${videoCount === 1 ? 'vídeo' : 'vídeos'}`);
    return parts.join(' · ');
  })();

  return (
    <section className="corrective-attachments">
      <div className="corrective-attachments-heading">
        <div>
          <strong>Prints e vídeos do erro</strong>
          <span>Exclusivos da corretiva; não serão incluídos no documento de evidências.</span>
        </div>
        {attachments.length > 0 && (
          <span className="corrective-attachments-count">{countLabel}</span>
        )}
      </div>

      <div className="corrective-attachments-grid">
        {attachments.map((attachment) => (
          <article className="corrective-attachment-card" key={attachment.id}>
            <AttachmentPreview attachment={attachment} />
            <span title={attachment.originalName}>{attachment.originalName}</span>
            {!disabled && (
              <button
                type="button"
                onClick={() => void remove(attachment)}
                aria-label={`Remover ${attachment.originalName}`}
              >
                <Trash2 size={15} />
              </button>
            )}
          </article>
        ))}

        {!disabled && (
          <button
            type="button"
            className={`corrective-attachment-drop${dragging ? ' is-dragging' : ''}`}
            onClick={() => inputRef.current?.click()}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              void sendFiles(Array.from(event.dataTransfer.files));
            }}
            disabled={uploading}
          >
            {uploading ? <Loader2 size={24} className="spin" /> : <ImagePlus size={24} />}
            <strong>{uploading ? 'Enviando...' : 'Adicionar prints ou vídeos'}</strong>
            <span>Selecione ou arraste aqui</span>
            <small>PNG, JPG ou MP4 · Imagens até 20 MB · Vídeos até 200 MB</small>
            <small>
              <ClipboardPaste size={13} /> Você também pode colar com Ctrl+V
            </small>
          </button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,video/mp4"
        multiple
        hidden
        onChange={(event) => void sendFiles(Array.from(event.target.files || []))}
      />
    </section>
  );
}
