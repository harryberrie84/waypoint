import TaskItem from '@tiptap/extension-task-item';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { uid } from '../lib/id';

// TaskItem with a stable `id` attribute so flow pageCheckbox triggers can bind to
// a specific checkbox rather than its text, text is fragile (two items can share
// a label, or it gets edited under the trigger). A ProseMirror plugin stamps a
// fresh id on any taskItem missing one, which also backfills existing docs the
// first time they load (the ids then persist on the next save). Duplicated or
// pasted items that would share an id get a new one, so ids stay unique per doc.
//
// The stamping transaction is flagged addToHistory:false so the backfill isn't an
// undo step, and it's idempotent, once every item has a unique id the plugin
// returns nothing, so it can't loop or fight a remote echo.

const stampKey = new PluginKey('taskItemIdStamp');

export const TaskItemId = TaskItem.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      id: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-task-id'),
        renderHTML: (attrs: { id?: string | null }) => (attrs.id ? { 'data-task-id': attrs.id } : {}),
      },
    };
  },
  addProseMirrorPlugins() {
    const parent = this.parent?.() ?? [];
    return [
      ...parent,
      new Plugin({
        key: stampKey,
        appendTransaction: (_trs, _oldState, newState) => {
          const seen = new Set<string>();
          const fixes: { pos: number; id: string }[] = [];
          newState.doc.descendants((node, pos) => {
            if (node.type.name !== 'taskItem') return;
            const id = node.attrs.id as string | null;
            if (!id || seen.has(id)) fixes.push({ pos, id: uid('tk_') });
            else seen.add(id);
          });
          if (!fixes.length) return null;
          const tr = newState.tr;
          for (const f of fixes) {
            seen.add(f.id);
            tr.setNodeAttribute(f.pos, 'id', f.id);
          }
          tr.setMeta('addToHistory', false);
          return tr;
        },
      }),
    ];
  },
}).configure({ nested: true });
