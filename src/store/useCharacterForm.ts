import { create } from 'zustand';

// The /character slash command can't render a modal from inside ProseMirror, so
// it flips this flag and the form (mounted at the app root) opens. Same trick as
// the toast store: a tiny store plus an imperative entry point for non-React
// callers.

interface CharacterFormStore {
  open: boolean;
  openForm: () => void;
  close: () => void;
}

export const useCharacterForm = create<CharacterFormStore>((set) => ({
  open: false,
  openForm: () => set({ open: true }),
  close: () => set({ open: false }),
}));

export const openCharacterForm = () => useCharacterForm.getState().openForm();
