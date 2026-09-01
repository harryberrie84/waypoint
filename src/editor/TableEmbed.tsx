import { useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { Search, Table2 } from 'lucide-react';
import { TableView, type EmbedViewControls } from '../components/TableView';
import { confirmDeleteRange } from './confirmDelete';
import type { ViewConfig } from '../lib/tableQuery';
import { useWorkspaceTables } from '../hooks/useScoped';
import { useAutoFocus } from './useAutoFocus';

// Pick an existing table to embed (a reference / linked view). Lists the
// workspace's real tables (form-backed plumbing excluded), searchable.
function TablePicker({ onPick }: { onPick: (id: string) => void }) {
  const searchRef = useAutoFocus<HTMLInputElement>();
  const tables = useWorkspaceTables().filter((t) => !t.formKey);
  const [q, setQ] = useState('');
  const matches = tables
    .filter((t) => (t.name || 'Untitled').toLowerCase().includes(q.trim().toLowerCase()))
    .slice(0, 40);

  return (
    <NodeViewWrapper className="my-4" contentEditable={false}>
      <div className="rounded-xl border border-paper-line bg-paper-panel/40 p-3 dark:border-coal-line dark:bg-coal/30">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-ink-faint dark:text-coal-soft">
          <Table2 className="h-3.5 w-3.5 text-clay" /> Show another table here (its own filters, same rows)
        </div>
        <div className="mb-1.5 flex items-center gap-1.5 rounded-md border border-paper-line bg-paper px-2 py-1 dark:border-coal-line dark:bg-coal-panel">
          <Search className="h-3.5 w-3.5 shrink-0 text-ink-faint dark:text-coal-soft" />
          <input
            ref={searchRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find a table to show…"
            className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none dark:text-coal-text"
          />
        </div>
        <div className="max-h-56 overflow-y-auto">
          {matches.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onPick(t.id)}
              className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-paper-panel dark:hover:bg-coal-line"
            >
              <span className="min-w-0 flex-1 truncate text-ink dark:text-coal-text">{t.name || 'Untitled'}</span>
              <span className="shrink-0 text-[11px] text-ink-faint dark:text-coal-soft">{t.columns.length} cols</span>
            </button>
          ))}
          {matches.length === 0 && <p className="px-2 py-2 text-xs text-ink-faint dark:text-coal-soft">No tables yet. Make one with /table.</p>}
        </div>
      </div>
    </NodeViewWrapper>
  );
}

// ---------------------------------------------------------------------------
// tableEmbed, block atom embedding a relational table by id. Rows live in the
// store / on the server, so the same table can be embedded on multiple pages and
// stays in sync. Each embed optionally carries its OWN ViewConfig in `viewConfig`
// (a "linked view"): same rows, independent filters / sort / view type. That
// config lives in the node attrs, which are part of the page content JSON and so
// already sync, no schema change needed. A null `viewConfig` shares the table's
// own view (tables.views), the original behaviour.
// ---------------------------------------------------------------------------

function TableEmbedView({ node, updateAttributes, editor, getPos }: NodeViewProps) {
  const tableId = node.attrs.tableId as string;
  const viewConfig = (node.attrs.viewConfig as ViewConfig | null) ?? null;

  // No table chosen yet (a /linked table reference): show the picker. Keep the
  // viewConfig the slash command seeded, so the chosen table is a linked view with
  // its own filters rather than touching the source.
  if (!tableId) {
    if (!editor.isEditable) return <NodeViewWrapper className="my-4" contentEditable={false} />;
    return <TablePicker onPick={(id) => updateAttributes({ tableId: id })} />;
  }

  const embed: EmbedViewControls = {
    viewConfig,
    editable: editor.isEditable,
    setViewConfig: (cfg) => updateAttributes({ viewConfig: cfg }),
    duplicateLinked: (cfg) => {
      const pos = typeof getPos === 'function' ? getPos() : null;
      if (pos == null) return;
      // Insert a sibling embed of the same table right after this one, seeded
      // with its own (independent) copy of the current view.
      editor
        .chain()
        .focus()
        .insertContentAt(pos + node.nodeSize, { type: 'tableEmbed', attrs: { tableId, viewConfig: cfg } })
        .run();
    },
    deleteEmbed: () => {
      const pos = typeof getPos === 'function' ? getPos() : null;
      if (pos == null) return;
      // Asks first (shows the table name + id), then removes just this embed
      // node; the table's rows are separate records and are kept, and it's one
      // editor transaction so Undo restores the embed.
      confirmDeleteRange(editor, pos, pos + node.nodeSize, [{ type: 'tableEmbed', tableId }]);
    },
  };

  return (
    <NodeViewWrapper className="my-4" contentEditable={false}>
      <TableView tableId={tableId} embed={embed} />
    </NodeViewWrapper>
  );
}

export const TableEmbed = Node.create({
  name: 'tableEmbed',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      tableId: { default: '' },
      // Per-instance view config for a linked view; null = share tables.views.
      viewConfig: {
        default: null,
        parseHTML: (el) => {
          const raw = el.getAttribute('data-view-config');
          if (!raw) return null;
          try {
            return JSON.parse(raw);
          } catch {
            return null;
          }
        },
        renderHTML: (attrs) =>
          attrs.viewConfig ? { 'data-view-config': JSON.stringify(attrs.viewConfig) } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-table-embed]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-table-embed': '', 'data-table-id': HTMLAttributes.tableId })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(TableEmbedView);
  },
});
