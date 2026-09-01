import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { Link2 } from 'lucide-react';
import { useData } from '../store/useData';
import { shortId } from '../lib/id';

// ---------------------------------------------------------------------------
// rowRef, inline atom referencing a specific table row by id.
// ---------------------------------------------------------------------------
// Resolves its label live from the data store, so when any client edits the
// referenced row's first text cell (and the change arrives via SSE), every
// chip referencing that row updates everywhere, the cross-page sync magic.

function RowRefView({ node }: NodeViewProps) {
  const tableId = node.attrs.tableId as string;
  const rowId = node.attrs.rowId as string;

  const table = useData((s) => s.tables[tableId]);
  const row = useData((s) => s.rows[rowId]);

  let label = 'Missing reference';
  let resolved = false;

  if (table && row) {
    resolved = true;
    const textCol = table.columns.find((c) => c.type === 'text');
    const raw =
      (textCol && (row.cells[textCol.id] as string)) ||
      (Object.values(row.cells).find((v) => v !== null && v !== '') as string) ||
      '';
    label = raw ? String(raw) : `Row ${shortId(rowId)}`;
  }

  return (
    <NodeViewWrapper as="span" className="inline-block align-baseline">
      <span
        contentEditable={false}
        title={resolved ? `${table?.name} · ${shortId(rowId)}` : 'This reference no longer exists'}
        className={[
          'mx-[1px] inline-flex items-center gap-1 rounded px-1.5 py-[1px] text-[0.92em] font-medium',
          resolved
            ? 'bg-clay-wash text-clay dark:bg-clay/25 dark:text-clay-soft'
            : 'bg-red-100 text-red-700 line-through dark:bg-red-900/40 dark:text-red-300',
        ].join(' ')}
      >
        <Link2 className="h-3 w-3 shrink-0" />
        <span className="max-w-[16rem] truncate">{label}</span>
      </span>
    </NodeViewWrapper>
  );
}

export const RowRef = Node.create({
  name: 'rowRef',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      tableId: { default: '' },
      rowId: { default: '' },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-row-ref]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-row-ref': '',
        'data-table-id': HTMLAttributes.tableId,
        'data-row-id': HTMLAttributes.rowId,
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(RowRefView);
  },
});
