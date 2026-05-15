import { useCallback, useRef, useState } from 'react';
import { Upload, X } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { uploadImages, deleteUpload, resolveAssetUrl } from '@/lib/api';
import { useToast } from '@/hooks/useToast';
import { cn } from '@/lib/utils';
import type { UploadedImage } from '@/types';

interface Props {
  sessionId: string;
  images: UploadedImage[];
  onChange: (images: UploadedImage[]) => void;
}

const ACCEPTED = ['image/png', 'image/jpeg', 'image/jpg'];

export function ImageUploader({ sessionId, images, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const { toast } = useToast();

  const handleFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const files = Array.from(fileList).filter((f) => ACCEPTED.includes(f.type));
      const rejected = Array.from(fileList).length - files.length;
      if (rejected > 0) {
        toast({
          variant: 'error',
          title: 'Formato inválido',
          description: `${rejected} arquivo(s) ignorado(s). Aceitos: PNG, JPG, JPEG.`,
        });
      }
      if (!files.length) return;

      setUploading(true);
      setProgress(0);
      try {
        const result = await uploadImages(files, sessionId, setProgress);
        onChange([...images, ...result.files]);
        toast({
          variant: 'success',
          title: 'Upload concluído',
          description: `${result.files.length} imagem(ns) adicionada(s).`,
        });
      } catch (err) {
        toast({
          variant: 'error',
          title: 'Falha no upload',
          description: err instanceof Error ? err.message : 'Erro desconhecido',
        });
      } finally {
        setUploading(false);
        setProgress(0);
      }
    },
    [images, onChange, sessionId, toast]
  );

  const handleRemove = async (img: UploadedImage) => {
    onChange(images.filter((i) => i.id !== img.id));
    await deleteUpload(sessionId, img.filename).catch(() => {});
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="image-grid">
        {images.map((img) => (
          <div key={img.id} className="image-card">
            <img src={resolveAssetUrl(img.url)} alt={img.originalName} loading="lazy" />
            <button
              type="button"
              className="image-remove"
              onClick={() => handleRemove(img)}
              aria-label="Remover imagem"
            >
              <X size={14} />
            </button>
            <div className="image-card-name" title={img.originalName}>
              {img.originalName}
            </div>
          </div>
        ))}

        <div
          className={cn('upload-box', isDragging && 'dragging')}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
          }}
        >
          <Upload size={22} />
          <div>Arraste ou clique</div>
          <div style={{ fontSize: 10, opacity: 0.7 }}>PNG, JPG, JPEG</div>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/jpg"
          multiple
          className="hidden"
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
        />
      </div>

      {uploading && (
        <div>
          <Progress value={progress} />
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 6 }}>
            Enviando... {progress}%
          </p>
        </div>
      )}
    </div>
  );
}
