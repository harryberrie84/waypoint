import { useMemo } from 'react';
import { Users, Table2 } from 'lucide-react';
import { useData } from '../store/useData';
import { useWorkspaceTables } from '../hooks/useScoped';
import { useMembers } from '../hooks/useMembers';
import { pageTables } from '../lib/tripViews';
import { cellText, titleColumn } from '../lib/tableQuery';
import { initials, avatarColor } from '../lib/avatar';
import { LockedBodyStrip } from './LockedBody';
import { isEnvelope } from '../lib/crypto';

// PeopleTab, everything on this page grouped by who it belongs to.
//
// Person columns already exist all over the app (assignees, who paid, who is
// coming) but they are only ever visible one table at a time. For two people
// sharing a plan the useful question is the other way round: what is MINE. This
// answers it across every table on the page at once, and shows what nobody has
// picked up, which is usually the more interesting column.
//
// Read-only rollup: it writes nothing, so it cannot disturb the data it reads.
// Page-scoped like every tab.

interface Assignment {
  rowId: string;
  tableId: string;
  tableName: string;
  columnName: string;
  label: string;
  done: boolean;
}

export function PeopleTab({ pageId, body }: { pageId: string; body?: object | null }) {
  const stored = useData((s) => s.pages[pageId]);
  const page = useMemo(() => (stored && body ? { ...stored, content: body } : stored), [stored, body]);
  const allTables = useWorkspaceTables();
  const rows = useData((s) => s.rows);
  const openRow = useData((s) => s.openRow);
  const members = useMembers();
  const tables = useMemo(() => pageTables(page, allTables), [page, allTables]);

  // Walk every person cell on the page. A row can name several people, in which
  // case it belongs to each of them: this is "what is on my plate", not a
  // partition, so counting it twice is correct.
  const { byPerson, unassigned } = useMemo(() => {
    const map = new Map<string, Assignment[]>();
    const none: Assignment[] = [];
    const all = Object.values(rows);

    for (const t of tables) {
      const people = (t.columns ?? []).filter((c) => c.type === 'person');
      if (!people.length) continue;
      const title = titleColumn(t.columns ?? []);
      // A checkbox or a done-flagged select is how a row says it is finished.
      const doneCol = (t.columns ?? []).find((c) => c.type === 'checkbox');
      const stageCol = (t.columns ?? []).find((c) => c.type === 'select' && (c.options ?? []).some((o) => o.done));

      for (const r of all.filter((x) => x.table === t.id)) {
        const isDone =
          (doneCol ? r.cells?.[doneCol.id] === true : false) ||
          (stageCol ? (stageCol.options ?? []).some((o) => o.done && o.id === r.cells?.[stageCol.id]) : false);

        for (const col of people) {
          const raw = r.cells?.[col.id];
          const ids = typeof raw === 'string' ? (raw ? [raw] : []) : Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [];
          const entry: Assignment = {
            rowId: r.id,
            tableId: t.id,
            tableName: t.name || 'Table',
            columnName: col.name,
            label: title ? cellText(r.cells?.[title.id] ?? null, title) || 'Untitled' : 'Untitled',
            done: isDone,
          };
          if (!ids.length) none.push(entry);
          else for (const id of ids) map.set(id, [...(map.get(id) ?? []), entry]);
        }
      }
    }
    return { byPerson: map, unassigned: none };
  }, [tables, rows]);

  const unreadable = isEnvelope(stored?.content) && !body;
  const withWork = members.filter((m) => (byPerson.get(m.id) ?? []).length > 0);

  const list = (items: Assignment[]) => (
    <ul className="divide-y divide-paper-line dark:divide-coal-line">
      {items.map((a, i) => (
        <li key={`${a.rowId}:${a.columnName}:${i}`}>
          <button
            type="button"
            onClick={() => openRow(a.rowId)}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-paper-panel dark:hover:bg-coal-line"
          >
            <span className={['min-w-0 flex-1 truncate', a.done ? 'text-ink-faint line-through dark:text-coal-soft' : 'text-ink dark:text-coal-text'].join(' ')}>
              {a.label}
            </span>
            <span className="flex shrink-0 items-center gap-1 text-[10px] text-ink-faint dark:text-coal-soft">
              <Table2 className="h-3 w-3" />
              {a.tableName}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );

  if (withWork.length === 0 && unassigned.length === 0) {
    return (
      <div className="mx-auto h-full max-w-2xl px-3 py-4 sm:px-6">
        {unreadable && <LockedBodyStrip what="assignments" />}
        <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-clay-wash text-clay dark:bg-clay/15">
            <Users className="h-5 w-5" />
          </div>
          <p className="text-sm text-ink-soft dark:text-coal-soft">Nothing is assigned yet.</p>
          <p className="max-w-xs text-xs text-ink-faint dark:text-coal-soft">
            Add a <span className="font-medium">Person</span> column to a table on this page and put someone in it, and
            everything they own shows up here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto h-full max-w-2xl overflow-y-auto px-3 py-4 sm:px-6">
      {unreadable && <LockedBodyStrip what="assignments" />}
      <div className="mb-3 flex items-center gap-2">
        <Users className="h-4 w-4 text-clay" />
        <h2 className="text-sm font-semibold text-ink dark:text-coal-text">People</h2>
      </div>

      <div className="space-y-3">
        {withWork.map((m) => {
          const items = byPerson.get(m.id) ?? [];
          const left = items.filter((i) => !i.done).length;
          return (
            <div key={m.id} className="overflow-hidden rounded-xl border border-paper-line dark:border-coal-line">
              <div className="flex items-center gap-2 border-b border-paper-line bg-paper-panel/60 px-3 py-1.5 dark:border-coal-line dark:bg-coal-line/40">
                <span
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[8px] font-semibold text-white"
                  style={{ backgroundColor: avatarColor(m.id) }}
                >
                  {initials(m.name)}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs font-semibold text-ink dark:text-coal-text">{m.name}</span>
                <span className="shrink-0 text-[11px] text-ink-faint dark:text-coal-soft">
                  {left} left &middot; {items.length} total
                </span>
              </div>
              {list(items)}
            </div>
          );
        })}

        {unassigned.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-dashed border-paper-line dark:border-coal-line">
            <div className="border-b border-paper-line bg-paper-panel/40 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint dark:border-coal-line dark:bg-coal-line/30 dark:text-coal-soft">
              Nobody has this ({unassigned.length})
            </div>
            {list(unassigned)}
          </div>
        )}
      </div>
    </div>
  );
}
