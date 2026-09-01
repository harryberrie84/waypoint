import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, NodeSelection, type EditorState } from '@tiptap/pm/state';
import { isWidgetType } from '../lib/doc';
import { toast } from '../store/useToast';
import { confirmDeleteRange, type WidgetRef } from './confirmDelete';

// DeleteGuard: an in-app "are you sure" before a keystroke removes a widget
// block (table embed, setlist, quiz, poll, image, audio, gallery, card, ...).
// The confirm is the app's own modal (see confirmDelete.ts / ConfirmDialog),
// shared with the table embed's right-click "Delete table" so both paths ask
// the same way.
//
// The modal is async, so the guard ALWAYS blocks the native delete when the
// selection fully contains a widget, opens the dialog, and performs the deletion
// itself on confirm. Plain text and scaffolding delete with no friction. Only
// LOCAL keyboard/clipboard paths are guarded; Yjs relay and undo/redo
// transactions are never intercepted.

interface Deletion {
  widgets: WidgetRef[];
  from: number;
  to: number;
}

// Say why the keystroke did nothing, at most once every few seconds, so holding a
// key (or a fast typist) doesn't stack a column of toasts.
let lastWarn = 0;
function warnBlocked(): void {
  const now = Date.now();
  if (now - lastWarn < 4000) return;
  lastWarn = now;
  toast('This block is selected. Press Delete to remove it.');
}

/** What a Backspace/Delete/cut would remove, if the selection FULLY contains a
 *  widget block; null otherwise (plain text, empty selection, or a widget only
 *  partially overlapped, e.g. editing text inside a callout). */
function analyzeDeletion(state: EditorState): Deletion | null {
  const { selection } = state;
  if (selection instanceof NodeSelection) {
    const n = selection.node;
    if (n.isBlock && isWidgetType(n.type.name)) {
      return { widgets: [{ type: n.type.name, tableId: n.attrs.tableId as string | undefined }], from: selection.from, to: selection.to };
    }
    return null;
  }
  if (selection.empty) return null;
  const widgets: WidgetRef[] = [];
  state.doc.nodesBetween(selection.from, selection.to, (node, pos) => {
    if (pos >= selection.from && pos + node.nodeSize <= selection.to && node.isBlock && isWidgetType(node.type.name)) {
      widgets.push({ type: node.type.name, tableId: node.attrs.tableId as string | undefined });
      return false; // its children go with it; don't double-count
    }
    return true;
  });
  if (!widgets.length) return null;
  return { widgets, from: selection.from, to: selection.to };
}

export const DeleteGuard = Extension.create({
  name: 'deleteGuard',

  addKeyboardShortcuts() {
    // Return true to SWALLOW the key (we handle the delete via the modal),
    // false to let the default run (no widget in the way). Empty selection and
    // plain-text ranges return false immediately, so normal typing and normal
    // text deletion are never intercepted.
    const guard = () => {
      const d = analyzeDeletion(this.editor.state);
      if (!d) return false;
      confirmDeleteRange(this.editor, d.from, d.to, d.widgets);
      return true;
    };
    return { Backspace: guard, Delete: guard };
  },

  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: new PluginKey('deleteGuardCut'),
        props: {
          handleDOMEvents: {
            cut: (view, event) => {
              const d = analyzeDeletion(view.state);
              if (!d) return false;
              event.preventDefault();
              confirmDeleteRange(editor, d.from, d.to, d.widgets);
              return true;
            },
          },
          // Typing over a SELECTED widget replaces it. With a NodeSelection on an
          // atom block, one stray keystroke swaps a whole table embed for that
          // letter, and nothing above catches it: this is not a delete key and not
          // a cut. It is the likeliest trigger for the production table that was
          // lost, back when a content diff still fed removed embeds to the table GC,
          // so the replacement hard-deleted the table and every row.
          //
          // A keystroke is not an instruction to delete, so this does not even ask:
          // it just refuses. Removing a widget stays an explicit act, Backspace,
          // Delete or the right-click menu, each of which confirms. The toast is
          // throttled so holding a key doesn't stack them.
          // Cheap on the hot path: a normal (empty) text selection returns null
          // immediately, so ordinary typing is never touched.
          //
          // MUST NOT touch typing inside a table cell. An embed is an atom node
          // whose grid is real inputs inside a contentEditable=false node view, and
          // the page's selection is often still a NodeSelection on the embed while
          // you type in a cell. So check the editor actually owns the keyboard:
          // hasFocus() is `activeElement === view.dom`, which is false whenever
          // focus sits in a cell input (or any widget's own field), and this bails.
          handleTextInput: (view) => {
            if (!view.hasFocus()) return false;
            const d = analyzeDeletion(view.state);
            if (!d) return false;
            warnBlocked();
            return true; // swallow it, and leave the widget exactly as it was
          },
          // Same hole, same answer, for a paste landing on a selected widget. Also
          // focus-gated, so pasting into a cell is untouched.
          handlePaste: (view) => {
            if (!view.hasFocus()) return false;
            const d = analyzeDeletion(view.state);
            if (!d) return false;
            warnBlocked();
            return true;
          },
        },
      }),
    ];
  },
});
