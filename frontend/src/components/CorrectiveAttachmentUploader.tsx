import { useCallback, useEffect, useRef, useState } from 'react';
import { ClipboardPaste, ImagePlus, Loader2, Trash2 } from 'lucide-react';
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

const MAX_SIZE = 20 * 1024 * 1024;

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
      const images = incoming.filter((file) => /^image\/(png|jpe?g)$/i.test(file.type));
      const oversized = images.filter((file) => file.size > MAX_SIZE);
      const availableSlots = Math.max(0, 10 - attachments.length);
      if (availableSlots === 0) {
        toast({
          variant: 'error',
          title: 'Limite de prints atingido',
          description: 'Cada corretiva pode enviar no máximo 10 prints.',
        });
        return;
      }
      if (images.length !== incoming.length) {
        toast({
          variant: 'error',
          title: 'Formato não suportado',
          description: 'Os prints devem estar em PNG, JPG ou JPEG.',
        });
      }
      if (oversized.length > 0) {
        toast({
          variant: 'error',
          title: 'Print muito grande',
          description: 'O SIG aceita no máximo 20 MB por arquivo.',
        });
      }
      const valid = images.filter((file) => file.size <= MAX_SIZE).slice(0, availableSlots);
      if (images.length - oversized.length > availableSlots) {
        toast({
          variant: 'error',
          title: 'Alguns prints não foram adicionados',
          description: 'Cada corretiva pode enviar no máximo 10 prints.',
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
          title: uploaded.length === 1 ? 'Print adicionado' : `${uploaded.length} prints adicionados`,
        });
      } catch (error) {
        toast({
          variant: 'error',
          title: 'Falha ao adicionar os prints',
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
      const files = Array.from(event.clipboardData?.files || []).filter((file) =>
        file.type.startsWith('image/')
      );
      if (files.length === 0) return;
      event.preventDefault();
      const named = files.map(
        (file, index) => {
          const extension = file.type === 'image/jpeg' ? 'jpg' : 'png';
          return new File(
            [file],
            `print-colado-${new Date().toISOString().replace(/[:.]/g, '-')}-${index + 1}.${extension}`,
            { type: file.type || 'image/png' }
          );
        }
      );
      void sendFiles(named);
    };
    window.addEventListener('paste', paste);
    return () => window.removeEventListener('paste', paste);
  }, [disabled, sendFiles]);

  const remove = async (attachment: CorrectiveAttachment) => {
    try {
      await deleteCorrectiveAttachment(requestId, attachment);
      onChange(attachments.filter((item) => item.id !== attachment.id));
    } catch (error) {
      toast({
        variant: 'error',
        title: 'Falha ao remover o print',
        description: getErrorMessage(error),
      });
    }
  };

  return (
    <section className="corrective-attachments">
      <div className="corrective-attachments-heading">
        <div>
          <strong>Prints do erro</strong>
          <span>Exclusivos da corretiva; não serão incluídos no documento de evidências.</span>
        </div>
        {attachments.length > 0 && (
          <span className="corrective-attachments-count">
            {attachments.length} {attachments.length === 1 ? 'print' : 'prints'}
          </span>
        )}
      </div>

      <div className="corrective-attachments-grid">
        {attachments.map((attachment) => (
          <article className="corrective-attachment-card" key={attachment.id}>
            <img src={resolveAssetUrl(attachment.url)} alt={attachment.originalName} />
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
            <strong>{uploading ? 'Enviando...' : 'Adicionar prints'}</strong>
            <span>Selecione ou arraste aqui</span>
            <small>
              <ClipboardPaste size={13} /> Você também pode colar com Ctrl+V
            </small>
          </button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg"
        multiple
        hidden
        onChange={(event) => void sendFiles(Array.from(event.target.files || []))}
      />
    </section>
  );
}
