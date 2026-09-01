import type { Editor } from '@tiptap/core';
import type { ReactNode } from 'react';
import { useToast } from '../store/useToast';
import { confirmAsk } from '../store/useConfirm';
import { useData } from '../store/useData';
import { undoHint } from '../lib/platform';

// Shared confirm-before-delete for widget blocks, used by the keyboard
// DeleteGuard, the table embed's right-click "Delete table", and the editor's
// SelectionMenu "Delete". Removing a widget only takes it off the page (a
// table's rows are separate records and are kept), and it's a single editor
// transaction, so Undo fully restores it.

export interface WidgetRef {
  type: string; // node type name, e.g. "tableEmbed", "setlistBlock"
  tableId?: string; // for tableEmbed: the embedded table id
}

/** "table embed", "setlist", ... from a node type name. */
function label(type: string): string {
  return type
    .replace(/Block$/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase();
}

function tableName(tableId: string | undefined): string {
  return (tableId && useData.getState().tables[tableId]?.name) || 'Untitled';
}

/** Emphasised phrase naming what will be deleted. A single table embed shows the
 *  table name in bold and its id as a small monospace chip. */
function widgetPhrase(widgets: WidgetRef[]): ReactNode {
  const strong = 'font-semibold text-ink dark:text-coal-text';
  if (widgets.length === 1) {
    const w = widgets[0];
    if (w.type === 'tableEmbed') {
      if (!w.tableId) return <>this empty table embed</>;
      return (
        <>
          the table <strong className={strong}>“{tableName(w.tableId)}”</strong>{' '}
          <span className="whitespace-nowrap rounded bg-paper-panel px-1 py-0.5 font-mono text-[11px] text-ink-soft dark:bg-coal-line dark:text-coal-soft">{w.tableId}</span>
        </>
      );
    }
    return <>this <strong className={strong}>{label(w.type)}</strong></>;
  }
  const kinds = [...new Set(widgets.map((w) => label(w.type)))];
  return <>these <strong className={strong}>{widgets.length}</strong> blocks ({kinds.slice(0, 3).join(', ')})</>;
}

/** After a confirmed delete, a toast names what went with an Undo button. The
 *  toast retires itself the moment the user undoes from the KEYBOARD, so its
 *  button can never fire a SECOND undo (which would revert an unrelated edit).
 *  The Undo action itself is one-shot for the same reason. */
function offerUndo(editor: Editor, widgets: WidgetRef[]) {
  const first = widgets[0];
  const what =
    widgets.length !== 1
      ? `${widgets.length} blocks`
      : first.type === 'tableEmbed'
        ? `The table “${tableName(first.tableId)}”`
        : `A ${label(first.type)}`;
  setTimeout(() => {
    let used = false;
    let id = 0;
    const cleanup = () => window.removeEventListener('keydown', onKey, true);
    const onKey = (e: KeyboardEvent) => {
      // A keyboard undo reverses the delete itself; drop our toast so its button
      // can't undo again. We do NOT preventDefault, the native undo still runs.
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z') {
        used = true;
        useToast.getState().dismiss(id);
        cleanup();
      }
    };
    id = useToast.getState().push(`${what} just got deleted.`, 'info', {
      label: 'Undo',
      hint: undoHint(),
      run: () => {
        if (!used && !editor.isDestroyed) {
          used = true;
          editor.commands.undo();
        }
        cleanup();
      },
    });
    window.addEventListener('keydown', onKey, true);
    // Backstop: drop the listener after the toast's own lifetime.
    setTimeout(cleanup, 9000);
  }, 0);
}

/** Ask (in the app's modal) before deleting the [from,to) range that holds the
 *  given widgets; delete + offer Undo on confirm. */
export function confirmDeleteRange(editor: Editor, from: number, to: number, widgets: WidgetRef[]) {
  confirmAsk({
    title: 'Delete this?',
    message: (
      <>
        <span>Delete {widgetPhrase(widgets)}?</span>
        <span className="mt-2.5 block text-xs leading-relaxed text-ink-faint dark:text-coal-soft">
          You can undo right after: tap <span className="font-medium text-ink-soft dark:text-coal-soft">Undo</span> on the pop-up, or press{' '}
          <kbd className="rounded border border-paper-line px-1 py-0.5 font-mono text-[11px] text-ink-soft dark:border-coal-line dark:text-coal-soft">{undoHint()}</kbd>.
        </span>
      </>
    ),
    confirmLabel: 'Delete',
    destructive: true,
    onConfirm: () => {
      if (editor.isDestroyed) return;
      editor.chain().focus().deleteRange({ from, to }).run();
      offerUndo(editor, widgets);
    },
  });
}
