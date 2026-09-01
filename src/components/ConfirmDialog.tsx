import { useEffect, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useConfirm } from '../store/useConfirm';

// The app's own confirm modal, shown when something calls useConfirm.ask(...).
// Styled like the other dialogs (VaultPanel et al). Cancel is focused by default
// and Esc cancels, so a reflexive keypress never confirms a destructive action;
// the user has to actually click (or Tab to) the confirm button.
export function ConfirmDialog() {
  const request = useConfirm((s) => s.request);
  const resolve = useConfirm((s) => s.resolve);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!request) return;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        resolve(false);
      }
    };
    // Capture so Esc closes the dialog before any editor/global handler sees it.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [request, resolve]);

  if (!request) return null;
  const destructive = request.destructive !== false;

  return (
    <div
      className="fixed inset-0 z-[1400] flex items-center justify-center bg-coal/40 p-4 backdrop-blur-sm"
      onMouseDown={() => resolve(false)}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-paper-line bg-paper p-5 shadow-2xl dark:border-coal-line dark:bg-coal-panel"
        onMouseDown={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
      >
        <div className="mb-2 flex items-center gap-2">
          <AlertTriangle className={['h-5 w-5 shrink-0', destructive ? 'text-red-500' : 'text-clay'].join(' ')} />
          <span className="flex-1 font-display text-lg font-semibold text-ink dark:text-coal-text">{request.title}</span>
        </div>
        <div className="mb-4 text-sm leading-relaxed text-ink-soft dark:text-coal-soft">{request.message}</div>
        <div className="flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={() => resolve(false)}
            className="rounded-md border border-paper-line px-3 py-1.5 text-sm font-medium text-ink-soft hover:bg-paper-panel dark:border-coal-line dark:text-coal-soft dark:hover:bg-coal-line"
          >
            {request.cancelLabel ?? 'Cancel'}
          </button>
          <button
            type="button"
            onClick={() => resolve(true)}
            className={[
              'rounded-md px-3 py-1.5 text-sm font-semibold text-white',
              destructive ? 'bg-red-500 hover:bg-red-600' : 'bg-clay hover:bg-clay/90',
            ].join(' ')}
          >
            {request.confirmLabel ?? 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}
