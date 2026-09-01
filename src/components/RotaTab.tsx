import { useEffect, useState } from 'react';
import { Plus, Check, Trash2, Undo2, Repeat } from 'lucide-react';
import { useData } from '../store/useData';
import { useMembers } from '../hooks/useMembers';
import { uid } from '../lib/id';
import { initials, avatarColor } from '../lib/avatar';
import {
  emptyRota, isoDay, rotaOrder, whoseTurn, nextDue, dueState, shareOf, markDone, undoLast, lastDone,
  type RotaData, type Chore,
} from '../lib/rota';

// RotaTab: recurring jobs that rotate between people. Page-scoped, read-only
// until `pages.rota` is confirmed present (the Currency/Sheet deal).
//
// Whose turn it is is DERIVED from the log, never stored, so covering for someone
// evens itself out instead of putting the rota permanently out of step.

const TONE: Record<string, string> = {
  overdue: 'border-red-400 bg-red-50 dark:border-red-500/40 dark:bg-red-900/20',
  today: 'border-clay bg-clay/10',
  soon: 'border-amber-300 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-900/15',
  later: 'border-paper-line dark:border-coal-line',
};

export function RotaTab({ pageId, editable }: { pageId: string; editable: boolean }) {
  const page = useData((s) => s.pages[pageId]);
  const setPageRota = useData((s) => s.setPageRota);
  const fieldExists = useData((s) => s.pageRotaFieldExists);
  const members = useMembers();

  const [stored, setStored] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    void fieldExists(pageId).then((ok) => { if (live) setStored(ok); });
    return () => { live = false; };
  }, [fieldExists, pageId]);

  const data: RotaData = page?.rota ?? emptyRota();
  const canEdit = editable && stored === true;
  const today = isoDay();
  const [openId, setOpenId] = useState<string | null>(null);

  const save = (next: RotaData) => setPageRota(pageId, next);
  const patchChore = (id: string, patch: Partial<Chore>) =>
    save({ ...data, chores: data.chores.map((c) => (c.id === id ? { ...c, ...patch } : c)) });

  const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? 'someone';

  if (!page) return null;
  const ordered = rotaOrder(data, today);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-paper-line px-3 py-2 dark:border-coal-line">
        <Repeat className="h-4 w-4 text-clay" />
        <span className="text-xs text-ink-faint dark:text-coal-soft">
          {ordered.filter((c) => dueState(c, data.log, today) === 'overdue').length} overdue ·{' '}
          {ordered.filter((c) => dueState(c, data.log, today) === 'today').length} today
        </span>
        {canEdit && (
          <button
            type="button"
            onClick={() => save({ ...data, chores: [...data.chores, { id: uid('ch_'), name: '', everyDays: 7, people: members.map((m) => m.id) }] })}
            className="ml-auto flex items-center gap-1 rounded-md border border-paper-line px-2 py-1 text-xs text-ink-soft hover:bg-paper-panel dark:border-coal-line dark:text-coal-soft dark:hover:bg-coal-line"
          >
            <Plus className="h-3.5 w-3.5" /> Add a job
          </button>
        )}
      </div>

      {stored === false && (
        <p className="border-b border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-900/20 dark:text-amber-200">
          This rota is read-only. Ask whoever runs this Waypoint to finish the setup, then it will save and sync.
        </p>
      )}

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {!ordered.length && <p className="py-8 text-center text-sm text-ink-faint dark:text-coal-soft">no jobs yet</p>}
        {ordered.map((chore) => {
          const state = dueState(chore, data.log, today);
          const turn = whoseTurn(chore, data.log);
          const last = lastDone(chore, data.log);
          const share = shareOf(chore, data.log);
          const open = openId === chore.id;
          return (
            <div key={chore.id} className={`rounded-lg border p-2 ${TONE[state]}`}>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={!canEdit || !turn}
                  onClick={() => save(markDone(data, chore.id, turn!, today))}
                  title={turn ? `mark done by ${nameOf(turn)}` : 'assign someone first'}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-paper-line text-ink-faint hover:border-clay hover:text-clay disabled:opacity-40 dark:border-coal-line"
                >
                  <Check className="h-4 w-4" />
                </button>
                <input
                  value={chore.name}
                  disabled={!canEdit}
                  onChange={(e) => patchChore(chore.id, { name: e.target.value })}
                  placeholder="what needs doing"
                  className="min-w-0 flex-1 bg-transparent text-sm font-medium text-ink outline-none placeholder:text-ink-faint/60 disabled:opacity-80 dark:text-coal-text"
                />
                {turn && (
                  <span className="flex shrink-0 items-center gap-1 text-xs text-ink-soft dark:text-coal-soft">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-semibold text-white" style={{ background: avatarColor(turn) }}>
                      {initials(nameOf(turn))}
                    </span>
                    {nameOf(turn)}
                  </span>
                )}
                <button type="button" onClick={() => setOpenId(open ? null : chore.id)} className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-ink-faint hover:bg-paper-panel dark:hover:bg-coal-line">
                  {state === 'overdue' ? 'overdue' : state === 'today' ? 'today' : `due ${nextDue(chore, data.log, today).slice(5)}`}
                </button>
              </div>

              {open && (
                <div className="mt-2 space-y-2 border-t border-paper-line/60 pt-2 dark:border-coal-line/60">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-ink-soft dark:text-coal-soft">
                    <label className="flex items-center gap-1">
                      every
                      <input
                        type="number"
                        min={1}
                        value={chore.everyDays}
                        disabled={!canEdit}
                        onChange={(e) => patchChore(chore.id, { everyDays: Math.max(1, Number(e.target.value) || 1) })}
                        className="w-14 rounded border border-paper-line bg-paper px-1 py-0.5 text-ink outline-none dark:border-coal-line dark:bg-coal dark:text-coal-text"
                      />
                      days
                    </label>
                    {last && <span>last done {last.on} by {nameOf(last.by)}</span>}
                    {canEdit && last && (
                      <button type="button" onClick={() => save(undoLast(data, chore.id))} className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-paper-panel dark:hover:bg-coal-line">
                        <Undo2 className="h-3 w-3" /> undo
                      </button>
                    )}
                    {canEdit && (
                      <button type="button" onClick={() => save({ ...data, chores: data.chores.filter((c) => c.id !== chore.id) })} className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-ink-faint hover:bg-paper-panel hover:text-red-500 dark:hover:bg-coal-line">
                        <Trash2 className="h-3 w-3" /> remove
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    {members.map((m) => {
                      const on = chore.people.includes(m.id);
                      return (
                        <button
                          key={m.id}
                          type="button"
                          disabled={!canEdit}
                          onClick={() => patchChore(chore.id, { people: on ? chore.people.filter((p) => p !== m.id) : [...chore.people, m.id] })}
                          className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${on ? 'border-clay bg-clay/10 text-ink dark:text-coal-text' : 'border-paper-line text-ink-faint dark:border-coal-line dark:text-coal-soft'}`}
                        >
                          {m.name}
                          {on && <span className="tabular-nums opacity-60">{share[m.id] ?? 0}</span>}
                        </button>
                      );
                    })}
                    {!members.length && <span className="text-[11px] text-ink-faint">invite someone from the Members panel first</span>}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
