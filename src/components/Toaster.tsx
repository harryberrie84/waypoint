import { AlertTriangle, X } from 'lucide-react';
import { useToast } from '../store/useToast';

// Stacks above the undo snackbar (which sits at bottom-5). Same coal-card look
// so notices read as one family.
export function Toaster() {
  const toasts = useToast((s) => s.toasts);
  const dismiss = useToast((s) => s.dismiss);
  if (!toasts.length) return null;

  return (
    <div className="pointer-events-none fixed bottom-20 left-1/2 z-[1300] flex w-full max-w-sm -translate-x-1/2 flex-col-reverse items-center gap-2 px-4">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="toast-in pointer-events-auto flex max-w-full items-center gap-2.5 rounded-lg border border-paper-line bg-coal px-3.5 py-2.5 text-sm text-white shadow-2xl dark:border-coal-line"
        >
          {t.kind === 'error' && <AlertTriangle className="h-4 w-4 shrink-0 text-clay-soft" />}
          <span className="min-w-0 flex-1">{t.message}</span>
          {t.action && (
            <button
              type="button"
              onClick={() => {
                t.action?.run();
                dismiss(t.id);
              }}
              className="flex shrink-0 flex-col items-center rounded-md bg-clay/90 px-3 py-1 leading-tight text-white hover:bg-clay"
            >
              <span className="text-xs font-semibold">{t.action.label}</span>
              {t.action.hint && <span className="text-[9px] font-normal text-white/75">{t.action.hint}</span>}
            </button>
          )}
          <button
            type="button"
            onClick={() => dismiss(t.id)}
            className="shrink-0 rounded p-0.5 text-white/60 hover:bg-white/15 hover:text-white"
            title="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
