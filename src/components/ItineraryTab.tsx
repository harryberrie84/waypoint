import { useMemo } from 'react';
import { CalendarRange, Clock, Table2, Check, Plus } from 'lucide-react';
import { useData } from '../store/useData';
import { useWorkspaceTables } from '../hooks/useScoped';
import { useMembers } from '../hooks/useMembers';
import { collectEvents, eventsByDay, pageTables } from '../lib/tripViews';
import { PagePresence } from './PagePresence';
import { LockedBodyStrip } from './LockedBody';
import { DayAddMenu } from './DayAddMenu';
import { useDayAdd } from '../hooks/useDayAdd';
import { isEnvelope } from '../lib/crypto';
import type { PresenceRecord } from '../types';

// ItineraryTab, this page's dated rows as a day-by-day agenda. Every row with a
// date in a table embedded on this page (or its kanban board) lands on its day,
// in order, numbered Day 1..N. Click one to open the row.

const WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function dayParts(iso: string): { weekday: string; label: string; date: Date } {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return { weekday: WEEK[date.getUTCDay()], label: `${MONTHS[m - 1]} ${d}`, date };
}

function todayIso(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

export function ItineraryTab({ pageId, presence, body }: { pageId: string; presence?: Map<string, PresenceRecord[]>; body?: object | null }) {
  const stored = useData((s) => s.pages[pageId]);
  // An encrypted page keeps an enc:v1: envelope in the store, so deriving its
  // tables from it finds none. PageView passes the decrypted body.
  const page = useMemo(() => (stored && body ? { ...stored, content: body } : stored), [stored, body]);
  const allTables = useWorkspaceTables();
  const rows = useData((s) => s.rows);
  const members = useMembers();
  const openRow = useData((s) => s.openRow);

  const tables = useMemo(() => pageTables(page, allTables), [page, allTables]);
  const days = useMemo(() => eventsByDay(collectEvents(tables, rows, members)), [tables, rows, members]);
  const today = todayIso();
  const unreadable = isEnvelope(stored?.content) && !body;

  // Adding an item to a day, shared with the Calendar tab.
  const { targets, day: addDay, setDay: setAddDay, anchor: addAnchor, create, start } = useDayAdd(tables);

  if (days.length === 0) {
    return (
      <div className="mx-auto h-full max-w-2xl px-3 py-4 sm:px-6">
        {/* A strip, not a takeover, to match the Calendar tab: an unreadable body
            costs you the items, not the tab. */}
        {unreadable && <LockedBodyStrip what="dated items" />}
        <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-clay-wash text-clay dark:bg-clay/15">
            <CalendarRange className="h-5 w-5" />
          </div>
          <p className="text-sm text-ink-soft dark:text-coal-soft">No dates yet.</p>
          <p className="max-w-xs text-xs text-ink-faint dark:text-coal-soft">
            Add a table to this page and give a row a <span className="font-medium">Date</span> or <span className="font-medium">Date &amp; time</span>, and it appears here on its day.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto h-full max-w-2xl overflow-y-auto px-3 py-4 sm:px-6">
      {unreadable && <LockedBodyStrip what="dated items" />}
      <div className="space-y-4">
        {days.map(({ day, events }, i) => {
          const { weekday, label } = dayParts(day);
          const isToday = day === today;
          const isPast = day < today;
          return (
            <div key={day} className="flex gap-3">
              {/* day rail */}
              <div className="flex w-14 shrink-0 flex-col items-center">
                <div
                  className={[
                    'flex h-14 w-14 flex-col items-center justify-center rounded-xl border text-center',
                    isToday ? 'border-clay bg-clay text-white' : isPast ? 'border-paper-line bg-paper-panel/60 text-ink-faint dark:border-coal-line dark:bg-coal-line/50 dark:text-coal-soft' : 'border-paper-line bg-paper dark:border-coal-line dark:bg-coal-panel',
                  ].join(' ')}
                >
                  <span className="text-[10px] font-medium uppercase tracking-wide opacity-80">Day {i + 1}</span>
                  <span className="text-lg font-bold leading-none">{label.split(' ')[1]}</span>
                  <span className="text-[10px] opacity-80">{label.split(' ')[0]}</span>
                </div>
              </div>
              {/* events */}
              <div className="min-w-0 flex-1 space-y-1.5 border-l border-paper-line pl-3 dark:border-coal-line">
                <div className="group/day flex items-center gap-2">
                  <span className="text-sm font-semibold text-ink dark:text-coal-text">{weekday}</span>
                  {isToday && <span className="rounded-full bg-clay/15 px-1.5 py-0.5 text-[10px] font-semibold text-clay">today</span>}
                  {targets.length > 0 && (
                    <button
                      type="button"
                      onClick={(e) => start(day, e.currentTarget)}
                      className="ml-auto shrink-0 rounded p-0.5 text-ink-faint opacity-0 hover:bg-clay/15 hover:text-clay focus:opacity-100 group-hover/day:opacity-100"
                      title={targets.length === 1 ? `Add to ${targets[0].table.name || 'this table'}` : 'Add an item on this day'}
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                {events.map((e) => {
                  const here = presence?.get(e.rowId);
                  const occupied = here && here.length > 0;
                  return (
                    <button
                      key={e.key}
                      type="button"
                      onClick={() => openRow(e.rowId)}
                      className={['flex w-full items-center gap-2 rounded-lg border bg-paper px-2.5 py-2 text-left transition-colors dark:bg-coal-panel', occupied ? 'border-clay ring-1 ring-clay/40' : 'border-paper-line hover:border-clay/60 dark:border-coal-line'].join(' ')}
                    >
                      {e.timeLabel ? (
                        <span className="flex shrink-0 items-center gap-1 font-mono text-xs tabular-nums text-clay">
                          <Clock className="h-3 w-3" /> {e.timeLabel}
                        </span>
                      ) : (
                        <span className="w-2 shrink-0" />
                      )}
                      <span className={['min-w-0 flex-1 truncate text-sm', e.done ? 'text-ink-faint line-through dark:text-coal-soft' : 'text-ink dark:text-coal-text'].join(' ')}>
                        {e.title}
                      </span>
                      {occupied && <PagePresence people={here} />}
                      {e.done && <Check className="h-3.5 w-3.5 shrink-0 text-clay" />}
                      <span className="flex shrink-0 items-center gap-1 rounded bg-paper-panel px-1.5 py-0.5 text-[10px] text-ink-faint dark:bg-coal-line dark:text-coal-soft">
                        <Table2 className="h-2.5 w-2.5" /> {e.fieldName}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <DayAddMenu
        day={addDay}
        targets={targets}
        anchor={addAnchor}
        onClose={() => setAddDay(null)}
        onPick={(d, t, c, wt) => void create(d, t, c, wt)}
      />
    </div>
  );
}
