import { AlertCircle, CheckCircle2, Info, TriangleAlert, X } from 'lucide-react';

export type ToastTone = 'success' | 'error' | 'warning' | 'info';

export interface AppToastProps {
  message: string;
  onClose: () => void;
  tone?: ToastTone;
}

const toneKeywords = {
  error: [
    'error',
    'no se pudo',
    'fallo',
    'fallida',
    'fallido',
    'invalida',
    'invalido',
    'incorrecto',
    'rechazado',
    'expirada',
    'expirado',
    'vencio'
  ],
  warning: [
    'advertencia',
    'pendiente',
    'sin conexion',
    'revision',
    'requiere',
    'guardado para',
    'catalogo guardado'
  ],
  success: [
    'exito',
    'correctamente',
    'confirmada',
    'confirmado',
    'completada',
    'completado',
    'actualizada',
    'actualizado',
    'sincronizada',
    'sincronizado',
    'registrada',
    'registrado',
    'guardada',
    'guardado'
  ]
} as const;

function normalizeMessage(message: string): string {
  return message
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function includesKeyword(message: string, keywords: readonly string[]): boolean {
  return keywords.some((keyword) => message.includes(keyword));
}

function getToastTone(message: string): ToastTone {
  const normalizedMessage = normalizeMessage(message);

  if (includesKeyword(normalizedMessage, toneKeywords.error)) return 'error';
  if (includesKeyword(normalizedMessage, toneKeywords.warning)) return 'warning';
  if (includesKeyword(normalizedMessage, toneKeywords.success)) return 'success';
  return 'info';
}

export function AppToast({ message, onClose, tone: explicitTone }: AppToastProps) {
  const tone = explicitTone ?? getToastTone(message);
  const role = tone === 'error' ? 'alert' : 'status';
  const Icon =
    tone === 'success'
      ? CheckCircle2
      : tone === 'error'
        ? AlertCircle
        : tone === 'warning'
          ? TriangleAlert
          : Info;

  return (
    <aside
      className={`app-toast app-toast--${tone}`}
      role={role}
      aria-live={tone === 'error' ? 'assertive' : 'polite'}
      aria-atomic="true"
    >
      <span className="app-toast__icon" aria-hidden="true">
        <Icon size={20} strokeWidth={2.25} />
      </span>
      <p className="app-toast__message">{message}</p>
      <button type="button" className="app-toast__close" onClick={onClose} aria-label="Cerrar notificacion">
        <X size={18} aria-hidden="true" />
      </button>
    </aside>
  );
}
