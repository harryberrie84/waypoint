import { Popover } from './Popover';
import type { DayAddTarget } from '../hooks/useDayAdd';

// Which table a new dated row lands in, when the page has more than one table with
// a date column. Only tables on THIS page are ever listed (see useDayAdd).
export function DayAddMenu({
  day,
  targets,
  anchor,
  onClose,
  onPick,
}: {
  day: string | null;
  targets: DayAddTarget[];
  anchor: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  onPick: (dayIso: string, tableId: string, colId: string, withTime: boolean) => void;
}) {
  return (
    <Popover open={!!day} onClose={onClose} anchorRef={anchor} width={250}>
      <div className="py-1">
        <div className="px-3 pb-1 pt-1 text-[10px] font-medium uppercase tracking-wide text-ink-faint dark:text-coal-soft">
          Add {day} to
        </div>
        {targets.map(({ table, col }) => (
          <button
            key={table.id}
            type="button"
            onClick={() => day && onPick(day, table.id, col.id, col.type === 'datetime')}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-ink hover:bg-paper-panel dark:text-coal-text dark:hover:bg-coal-line"
          >
            <span className="min-w-0 flex-1 truncate">{table.name || 'Untitled table'}</span>
            <span className="shrink-0 text-[10px] text-ink-faint dark:text-coal-soft">{col.name}</span>
          </button>
        ))}
      </div>
    </Popover>
  );
}
