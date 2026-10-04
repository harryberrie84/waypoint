import { Extension } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';

// Shared-editing undo keeps an emptied paragraph rather than deleting it, so
// undoing everything on a page and then redoing it brings the text back BELOW a
// blank line, with the caret left in that blank line. The next thing typed then
// lands above the text it was meant to follow.
//
// When the page was blank right before the redo, the leading empty paragraph the
// redo leaves behind is that leftover: nothing written can be in it. It is removed
// outside the history (so later redo steps survive). Either way the caret goes to
// the end of what came back.

const isBlank = (doc: PMNode): boolean =>
  doc.childCount === 1 && doc.firstChild!.type.name === 'paragraph' && doc.firstChild!.content.size === 0;

export const RedoTidy = Extension.create({
  name: 'redoTidy',
  priority: 1100,

  addKeyboardShortcuts() {
    const redo = () => {
      const editor = this.editor;
      const before = editor.state.doc;
      const wasBlank = isBlank(before);
      if (!editor.commands.redo()) return false;
      const { doc } = editor.state;
      const first = doc.firstChild;
      if (wasBlank && doc.childCount >= 2 && first && first.type.name === 'paragraph' && first.content.size === 0) {
        const tr = editor.state.tr.delete(0, first.nodeSize).setMeta('addToHistory', false);
        tr.setSelection(TextSelection.atEnd(tr.doc));
        editor.view.dispatch(tr);
        return true;
      }
      // Shared-editing redo puts the caret back where the change started, so the
      // next keys landed in front of the text that just came back. Put it at the
      // end of what came back, as a plain editor does. Selection only: no history.
      // The end is measured from where the change starts: matching from the back
      // alone stops early when the old and new text happen to end alike.
      const start = doc.content.findDiffStart(before.content);
      if (start == null) return true;
      const end = doc.content.findDiffEnd(before.content);
      const pos = Math.min(Math.max(start, end?.a ?? start, start + doc.content.size - before.content.size), doc.content.size);
      const tr = editor.state.tr.setSelection(TextSelection.near(doc.resolve(pos), -1));
      editor.view.dispatch(tr.setMeta('addToHistory', false));
      return true;
    };
    return { 'Mod-Shift-z': redo, 'Mod-y': redo, 'Mod-Shift-Z': redo };
  },
});
