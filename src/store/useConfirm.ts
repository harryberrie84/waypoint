import { create } from 'zustand';
import type { ReactNode } from 'react';
// (kept separate from useToast to avoid a cycle)

// A single in-app confirm dialog (replaces window.confirm for destructive
// actions, so the prompt is the app's own styled modal, not a browser popup).
// One request at a time; `ask` opens it, the ConfirmDialog component calls
// `resolve`, and a confirmed request runs its onConfirm.

export interface ConfirmRequest {
  title: string;
  message: ReactNode;
  confirmLabel?: string; // default "Delete"
  cancelLabel?: string; // default "Cancel"
  destructive?: boolean; // red confirm button; default true
  onConfirm: () => void;
}

interface ConfirmStore {
  request: ConfirmRequest | null;
  ask: (r: ConfirmRequest) => void;
  resolve: (ok: boolean) => void;
}

export const useConfirm = create<ConfirmStore>((set, get) => ({
  request: null,
  ask: (r) => set({ request: r }),
  resolve: (ok) => {
    const r = get().request;
    set({ request: null });
    if (ok && r) r.onConfirm();
  },
}));

// Imperative entry for non-React callers (editor extensions, store actions).
export const confirmAsk = (r: ConfirmRequest) => useConfirm.getState().ask(r);
