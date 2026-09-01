import { Trash2, Maximize2, ListChecks } from 'lucide-react';
import { useData } from '../store/useData';
import type { Column, TableRow } from '../types';
import { Cell, buildScope, PersonChip, checklistProgress } from './TableCell';
import { RowReactions } from './RowReactions';
import { useMembers } from '../hooks/useMembers';
import { titleColumn, cellText, rowIcon } from '../lib/tableQuery';
import { isImageIcon } from '../lib/pageIcon';

// Find the first image block's src anywhere in a row's page content.
function firstImageSrc(content: unknown): string {
  let found = '';
  const walk = (n: unknown) => {
    if (found || !n || typeof n !== 'object') return;
    const node = n as { type?: string; attrs?: Record<string, unknown>; content?: unknown[] };
    if (node.type === 'image' && typeof node.attrs?.src === 'string' && node.attrs.src) {
      found = node.attrs.src as string;
      return;
    }
    if (Array.isArray(node.content)) node.content.forEach(walk);
  };
  walk(content);
  return found;
}

// RowCard, a record shown as a card (board + gallery). The title column is
// fully editable; the remaining fields render as compact labelled chips.

export function RowCard({
  tableId,
  columns,
  row,
  excludeColumnId,
  draggable,
  onDragStart,
}: {
  tableId: string;
  columns: Column[];
  row: TableRow;
  excludeColumnId?: string;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
}) {
  const deleteRow = useData((s) => s.deleteRow);
  const openRow = useData((s) => s.openRow);
  const members = useMembers();
  const title = titleColumn(columns);
  const scope = buildScope(columns, row.cells);
  const meta = columns.filter((c) => c.id !== title?.id && c.id !== excludeColumnId);
  const photo = firstImageSrc((row as TableRow & { content?: unknown }).content);

  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      className={[
        'group/card overflow-hidden rounded-lg border border-paper-line bg-paper shadow-sm dark:border-coal-line dark:bg-coal-panel',
        draggable ? 'cursor-grab active:cursor-grabbing' : '',
      ].join(' ')}
    >
      {photo && (
        <button type="button" onClick={() => openRow(row.id)} className="block h-28 w-full overflow-hidden">
          <img src={photo} alt="" className="h-28 w-full object-cover" />
        </button>
      )}
      <div className="p-2">
      {/* items-center, not items-start: the title cell is a 38px-high row that
          centres its own controls (the open-link and add-link icons), so pinning
          these two to the top left them sitting a few pixels above that line and
          the card's controls read as three different heights. The icon's old
          mt-* nudges were compensating for the same thing and go with it. */}
      <div className="mb-1 flex items-center gap-1">
        {rowIcon(row) &&
          (isImageIcon(rowIcon(row)) ? (
            <img src={rowIcon(row)} alt="" className="ml-1 h-4 w-4 shrink-0 rounded object-contain" />
          ) : (
            <span className="ml-1 shrink-0 text-base leading-none">{rowIcon(row)}</span>
          ))}
        <div className="min-w-0 flex-1">
          {title ? (
            <Cell tableId={tableId} rowId={row.id} column={title} value={row.cells[title.id] ?? null} scope={scope} />
          ) : (
            <span className="px-2 text-xs text-ink-faint">Untitled</span>
          )}
        </div>
        <button
          type="button"
          onClick={() => openRow(row.id)}
          className="invisible shrink-0 rounded p-1 text-ink-faint hover:bg-paper-panel hover:text-clay group-hover/card:visible dark:hover:bg-coal-line"
          title="Open as page"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => deleteRow(row.id)}
          className="invisible shrink-0 rounded p-1 text-ink-faint hover:bg-paper-panel hover:text-red-500 group-hover/card:visible dark:hover:bg-coal-line"
          title="Delete"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex flex-wrap gap-1 px-1">
        {meta.map((col) => {
          if (col.type === 'select') {
            const opt = (col.options ?? []).find((o) => o.id === row.cells[col.id]);
            if (!opt) return null;
            return (
              <span
                key={col.id}
                className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium text-white"
                style={{ backgroundColor: opt.color }}
              >
                {opt.label}
              </span>
            );
          }
          if (col.type === 'person') {
            const ids = Array.isArray(row.cells[col.id]) ? (row.cells[col.id] as string[]) : [];
            if (ids.length === 0) return null;
            return ids.map((id) => (
              <PersonChip key={`${col.id}:${id}`} id={id} name={members.find((m) => m.id === id)?.name ?? 'Unknown'} />
            ));
          }
          if (col.type === 'multiselect') {
            // Labels render as a coloured dot + name (the board "type" tags).
            const ids = Array.isArray(row.cells[col.id]) ? (row.cells[col.id] as string[]) : [];
            if (ids.length === 0) return null;
            return ids.map((id) => {
              const opt = (col.options ?? []).find((o) => o.id === id);
              if (!opt) return null;
              return (
                <span
                  key={`${col.id}:${id}`}
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium"
                  style={{ backgroundColor: `${opt.color}22`, color: opt.color }}
                >
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: opt.color }} />
                  {opt.label}
                </span>
              );
            });
          }
          if (col.type === 'checklist') {
            const { done, total } = checklistProgress(row.cells[col.id] ?? null);
            if (!total) return null;
            return (
              <span
                key={col.id}
                className="inline-flex items-center gap-1 rounded bg-paper-panel px-1.5 py-0.5 text-[10px] text-ink-soft dark:bg-coal-line dark:text-coal-soft"
              >
                <ListChecks className="h-3 w-3" /> {done}/{total}
              </span>
            );
          }
          const text = cellText(row.cells[col.id] ?? null, col);
          if (!text) return null;
          return (
            <span
              key={col.id}
              className="inline-flex items-center gap-1 rounded bg-paper-panel px-1.5 py-0.5 text-[10px] text-ink-soft dark:bg-coal-line dark:text-coal-soft"
            >
              <span className="text-ink-faint dark:text-coal-soft/70">{col.name}</span>
              {text}
            </span>
          );
        })}
      </div>

      <RowReactions rowId={row.id} variant="card" />
      </div>
    </div>
  );
}
