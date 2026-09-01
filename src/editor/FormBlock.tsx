import { useRef, useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { FormInput, Plus, Copy } from 'lucide-react';
import { useData } from '../store/useData';
import { Cell, buildScope } from '../components/TableCell';
import { Popover } from '../components/Popover';
import { serializeForm } from '../lib/formBlock';
import type { ColumnType } from '../types';

// ---------------------------------------------------------------------------
// formBlock, a form is its backing table rendered as fields instead of a grid.
// The schema is the table's `columns` (read live, so adding a field ripples to
// every form of that key); a filled-out form is one `table_rows` row. Each field
// reuses the grid's <Cell> editor, so it's optimistic, debounced, and synced for
// free. Adding a field is just addColumn on the form table.
// ---------------------------------------------------------------------------

const FIELD_TYPES: { type: ColumnType; label: string }[] = [
  { type: 'text', label: 'Text' },
  { type: 'number', label: 'Number' },
  { type: 'date', label: 'Date' },
  { type: 'datetime', label: 'Date & time' },
  { type: 'select', label: 'Select' },
  { type: 'checkbox', label: 'Checkbox' },
  { type: 'person', label: 'Person' },
  { type: 'url', label: 'URL' },
  { type: 'place', label: 'Place' },
];

function FormBlockView({ node, editor, deleteNode }: NodeViewProps) {
  const tableId = node.attrs.tableId as string;
  const rowId = node.attrs.rowId as string;
  const table = useData((s) => s.tables[tableId]);
  const row = useData((s) => s.rows[rowId]);

  const [addOpen, setAddOpen] = useState(false);
  const [fieldName, setFieldName] = useState('');
  const [fieldType, setFieldType] = useState<ColumnType>('text');
  const [copied, setCopied] = useState(false);
  const addRef = useRef<HTMLButtonElement>(null);

  if (!table || !row) {
    return (
      <NodeViewWrapper className="my-3" contentEditable={false}>
        <div className="flex items-center justify-between gap-2 rounded-lg border border-dashed border-paper-line p-3 text-sm text-ink-faint dark:border-coal-line dark:text-coal-soft">
          <span>form removed, its table or row was deleted.</span>
          {editor.isEditable && (
            <button type="button" onClick={() => deleteNode()} className="rounded-md px-2 py-1 text-xs text-ink-soft hover:text-clay dark:text-coal-soft">
              detach
            </button>
          )}
        </div>
      </NodeViewWrapper>
    );
  }

  const key = table.formKey ?? 'form';
  const scope = buildScope(table.columns, row.cells);

  const addField = () => {
    const name = fieldName.trim();
    if (!name) return;
    // addColumn applies synchronously, so the new column is the last one right
    // after the call, rename it to the requested name.
    useData.getState().addColumn(tableId, fieldType);
    const cols = useData.getState().tables[tableId]?.columns ?? [];
    const created = cols[cols.length - 1];
    if (created) useData.getState().updateColumn(tableId, created.id, { name });
    setFieldName('');
    setFieldType('text');
    setAddOpen(false);
  };

  const copyAsText = () => {
    const text = serializeForm(table.columns, row.cells, key);
    void navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      },
      () => {},
    );
  };

  return (
    <NodeViewWrapper className="my-4" contentEditable={false}>
      <div className="rounded-xl border border-paper-line bg-paper-panel/30 p-3 dark:border-coal-line dark:bg-coal/30">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-ink-faint dark:text-coal-soft">
            <FormInput className="h-3.5 w-3.5 text-clay" /> {key}
          </div>
          <button
            type="button"
            onClick={copyAsText}
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-ink-faint hover:text-clay dark:text-coal-soft"
            title="Copy as text"
          >
            <Copy className="h-3.5 w-3.5" /> {copied ? 'copied' : 'copy'}
          </button>
        </div>

        <div className="space-y-2">
          {table.columns.map((col) => (
            <label key={col.id} className="block">
              <span className="mb-0.5 block text-xs font-medium text-ink-soft dark:text-coal-soft">{col.name}</span>
              <span className="block overflow-hidden rounded-lg border border-paper-line bg-paper dark:border-coal-line dark:bg-coal-panel">
                <Cell tableId={tableId} rowId={rowId} column={col} value={row.cells[col.id] ?? null} scope={scope} />
              </span>
            </label>
          ))}
        </div>

        {editor.isEditable && (
          <div className="mt-2">
            <button
              ref={addRef}
              type="button"
              onClick={() => setAddOpen((o) => !o)}
              className="flex items-center gap-1 rounded-md border border-dashed border-paper-line px-2 py-1 text-xs text-ink-faint hover:border-clay hover:text-clay dark:border-coal-line dark:text-coal-soft"
            >
              <Plus className="h-3.5 w-3.5" /> add field
            </button>
            <Popover open={addOpen} onClose={() => setAddOpen(false)} anchorRef={addRef} width={232}>
              <div className="space-y-1.5 p-1.5">
                <input
                  value={fieldName}
                  onChange={(e) => setFieldName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addField();
                    }
                  }}
                  autoFocus
                  placeholder="field name"
                  className="w-full rounded-md border border-paper-line bg-paper px-2 py-1 text-sm text-ink outline-none focus:border-clay dark:border-coal-line dark:bg-coal-panel dark:text-coal-text"
                />
                <select
                  value={fieldType}
                  onChange={(e) => setFieldType(e.target.value as ColumnType)}
                  className="w-full rounded-md border border-paper-line bg-paper px-2 py-1 text-sm text-ink outline-none dark:border-coal-line dark:bg-coal-panel dark:text-coal-text"
                >
                  {FIELD_TYPES.map((f) => (
                    <option key={f.type} value={f.type}>
                      {f.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={addField}
                  disabled={!fieldName.trim()}
                  className="w-full rounded-md bg-clay px-2 py-1 text-sm font-medium text-white hover:bg-clay/90 disabled:opacity-50"
                >
                  add
                </button>
              </div>
            </Popover>
          </div>
        )}
      </div>
    </NodeViewWrapper>
  );
}

export const FormBlock = Node.create({
  name: 'formBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      tableId: { default: '' },
      rowId: { default: '' },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-form-block]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-form-block': '', 'data-table-id': HTMLAttributes.tableId })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(FormBlockView);
  },
});
