import type { Editor, Content } from '@tiptap/core';
import type { Transaction } from '@tiptap/pm/state';
import { toast } from '../store/useToast';

export interface HeldPosition {
  get: () => number;
  set: (at: number) => void;
  caretHere: () => boolean;
  insert: (content: Content, opts?: { keep?: boolean }) => boolean;
  release: () => void;
}

export function holdPosition(editor: Editor, at: number = editor.state.selection.from): HeldPosition {
  let pos = at;
  let ownInsert = false;
  let caret = true;
  const onTransaction = ({ transaction }: { transaction: Transaction }) => {
    if (transaction.docChanged) pos = transaction.mapping.mapResult(pos, ownInsert ? 1 : -1).pos;
    if (!ownInsert && (transaction.selectionSet || transaction.docChanged)) caret = transaction.selection.from === pos;
  };
  editor.on('transaction', onTransaction);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    editor.off('transaction', onTransaction);
  };
  const clamp = () => Math.max(0, Math.min(pos, editor.state.doc.content.size));
  return {
    get: clamp,
    set: (at: number) => {
      pos = at;
    },
    caretHere: () => caret,
    release,
    insert(content, opts) {
      if (editor.isDestroyed) {
        release();
        toast('The page reloaded before that could be added. Please try again.', 'error');
        return false;
      }
      const chain = caret ? editor.chain().focus() : editor.chain();
      ownInsert = true;
      let ok = false;
      try {
        ok = chain.insertContentAt(clamp(), content).run();
      } finally {
        ownInsert = false;
      }
      if (!opts?.keep) release();
      return ok;
    },
  };
}
