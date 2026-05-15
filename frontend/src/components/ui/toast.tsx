import * as React from 'react';
import * as ToastPrimitive from '@radix-ui/react-toast';
import { X, CheckCircle2, AlertTriangle, Info } from 'lucide-react';
import { cn } from '@/lib/utils';

export const ToastProvider = ToastPrimitive.Provider;

export const ToastViewport = React.forwardRef<
  React.ElementRef<typeof ToastPrimitive.Viewport>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Viewport>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Viewport
    ref={ref}
    className={cn(className)}
    style={{
      position: 'fixed',
      right: 24,
      bottom: 24,
      display: 'flex',
      flexDirection: 'column-reverse',
      gap: 12,
      zIndex: 9999,
      maxWidth: 360,
      ...((props as any).style || {}),
    }}
    {...props}
  />
));
ToastViewport.displayName = ToastPrimitive.Viewport.displayName;

type Variant = 'default' | 'success' | 'error' | 'info' | 'warning';

export interface ToastItem {
  id: string;
  title: string;
  description?: string;
  variant?: Variant;
}

const variantClass: Record<Variant, string> = {
  default: '',
  success: '',
  error: 'toast-error',
  info: 'toast-info',
  warning: 'toast-warning',
};

const variantIcon: Record<Variant, React.ReactNode> = {
  default: <Info size={20} style={{ color: 'var(--primary)' }} />,
  success: <CheckCircle2 size={20} style={{ color: 'var(--success)' }} />,
  error: <AlertTriangle size={20} style={{ color: 'var(--danger)' }} />,
  info: <Info size={20} style={{ color: 'var(--primary)' }} />,
  warning: <AlertTriangle size={20} style={{ color: 'var(--warning)' }} />,
};

export function ToastRoot({ toast, onClose }: { toast: ToastItem; onClose: () => void }) {
  const variant = toast.variant ?? 'default';
  return (
    <ToastPrimitive.Root
      onOpenChange={(open) => !open && onClose()}
      className={cn('toast', variantClass[variant])}
    >
      <span className="toast-icon">{variantIcon[variant]}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <ToastPrimitive.Title className="toast-title">{toast.title}</ToastPrimitive.Title>
        {toast.description && (
          <ToastPrimitive.Description className="toast-message">
            {toast.description}
          </ToastPrimitive.Description>
        )}
      </div>
      <ToastPrimitive.Close className="toast-close" aria-label="Fechar">
        <X size={16} />
      </ToastPrimitive.Close>
    </ToastPrimitive.Root>
  );
}
