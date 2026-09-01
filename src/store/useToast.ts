import { create } from 'zustand';

// Transient notices (a bad file drop, a "too large" error) that used to fire a
// native window.alert. Errors linger a little longer so they're readable, and
// a toast can carry one ACTION (label + a small keyboard hint + a handler),
// e.g. "Undo" after a widget block was deleted; those linger longest so the
// button is actually reachable.

export type ToastKind = 'info' | 'error';
export interface ToastAction {
  label: string;
  hint?: string; // small text under the label, e.g. "ctrl+z"
  run: () => void;
}
export interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
  action?: ToastAction;
}

interface ToastStore {
  toasts: Toast[];
  push: (message: string, kind?: ToastKind, action?: ToastAction) => number; // returns the toast id
  dismiss: (id: number) => void;
}

let seq = 0;

export const useToast = create<ToastStore>((set) => ({
  toasts: [],
  push: (message, kind = 'info', action) => {
    const id = ++seq;
    set((s) => ({ toasts: [...s.toasts, { id, message, kind, action }] }));
    setTimeout(
      () => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
      action ? 8000 : kind === 'error' ? 5000 : 3500,
    );
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

// Imperative entry points for the non-React callers (file drops, async catches,
// editor extensions). Both return the toast id so the caller can dismiss it.
export const toast = (message: string, kind?: ToastKind) => useToast.getState().push(message, kind);
export const toastWithAction = (message: string, action: ToastAction) => useToast.getState().push(message, 'info', action);
