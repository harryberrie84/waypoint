import { Plus } from 'lucide-react';
import { useData } from '../store/useData';
import type { TableData, TableRow } from '../types';
import { RowCard } from './TableCard';

// GalleryView, every record as a card in a responsive grid.

export function GalleryView({ tableId, table, rows }: { tableId: string; table: TableData; rows: TableRow[] }) {
  const addRow = useData((s) => s.addRow);

  return (
    <div className="p-3">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3 sm:grid-cols-[repeat(auto-fill,minmax(200px,1fr))]">
        {rows.map((row) => (
          <RowCard key={row.id} tableId={tableId} columns={table.columns} row={row} />
        ))}
        <button
          type="button"
          onClick={() => void addRow(tableId)}
          className="flex min-h-[72px] items-center justify-center gap-1 rounded-lg border border-dashed border-paper-line text-xs text-ink-faint hover:border-clay hover:text-clay dark:border-coal-line dark:text-coal-soft"
        >
          <Plus className="h-4 w-4" /> New card
        </button>
      </div>
    </div>
  );
}
