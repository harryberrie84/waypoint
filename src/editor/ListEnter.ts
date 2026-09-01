import { Extension } from '@tiptap/core';

// Standard list behaviour, made explicit so nothing else can swallow it: Enter
// inside a bullet / numbered / checklist item splits into a new item of the same
// kind, and splitListItem lifts you out of the list when the item is empty (so an
// empty item plus Enter ends the list). Outside a list this returns false and the
// normal Enter (a paragraph break, or Shift-Enter for a soft break) runs. High
// priority so it wins the keymap.
export const ListEnter = Extension.create({
  name: 'listEnter',
  priority: 1000,

  addKeyboardShortcuts() {
    return {
      Enter: () => {
        // A checklist item is a taskItem; a bullet/numbered item is a listItem.
        if (this.editor.isActive('taskItem')) return this.editor.commands.splitListItem('taskItem');
        if (this.editor.isActive('listItem')) return this.editor.commands.splitListItem('listItem');
        return false;
      },
    };
  },
});
