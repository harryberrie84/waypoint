import { useEffect, useState } from 'react';
import { Plus, Trophy, X, Shuffle } from 'lucide-react';
import { useData } from '../store/useData';
import { emptyBracket, buildBracket, pickWinner, champion, standings, type BracketData } from '../lib/bracket';

// BracketTab: a single-elimination tournament. Page-scoped, read-only until
// `pages.bracket` is confirmed present (the Currency/Sheet deal).
//
// The shape is derived from the entrant list plus a match->winner map, so it can
// never disagree with itself; changing an early result recomputes everything
// downstream and drops the picks that are no longer reachable.

export function BracketTab({ pageId, editable }: { pageId: string; editable: boolean }) {
  const page = useData((s) => s.pages[pageId]);
  const setPageBracket = useData((s) => s.setPageBracket);
  const fieldExists = useData((s) => s.pageBracketFieldExists);

  const [stored, setStored] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    void fieldExists(pageId).then((ok) => { if (live) setStored(ok); });
    return () => { live = false; };
  }, [fieldExists, pageId]);

  const data: BracketData = page?.bracket ?? emptyBracket();
  const canEdit = editable && stored === true;
  const [entry, setEntry] = useState('');

  const save = (next: BracketData) => setPageBracket(pageId, next);
  const rounds = buildBracket(data);
  const winner = champion(data);
  const table = standings(data);

  const addEntrant = () => {
    const name = entry.trim();
    if (!name || data.entrants.includes(name)) return;
    save({ ...data, entrants: [...data.entrants, name] });
    setEntry('');
  };

  if (!page) return null;

  const roundName = (i: number) => {
    const fromEnd = rounds.length - 1 - i;
    if (fromEnd === 0) return 'Final';
    if (fromEnd === 1) return 'Semis';
    if (fromEnd === 2) return 'Quarters';
    return `Round ${i + 1}`;
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-paper-line px-3 py-2 dark:border-coal-line">
        <input
          value={data.title ?? ''}
          disabled={!canEdit}
          onChange={(e) => save({ ...data, title: e.target.value })}
          placeholder="tournament name"
          className="min-w-0 flex-1 bg-transparent text-sm font-medium text-ink outline-none placeholder:text-ink-faint/60 dark:text-coal-text"
        />
        {winner && (
          <span className="flex items-center gap-1 rounded-full bg-clay/10 px-2 py-0.5 text-xs font-semibold text-clay">
            <Trophy className="h-3.5 w-3.5" /> {winner}
          </span>
        )}
        {canEdit && data.entrants.length > 1 && (
          <button
            type="button"
            onClick={() => save({ ...data, results: {} })}
            title="clear every result, keep the entrants"
            className="flex items-center gap-1 rounded-md border border-paper-line px-2 py-1 text-xs text-ink-soft hover:bg-paper-panel dark:border-coal-line dark:text-coal-soft dark:hover:bg-coal-line"
          >
            <Shuffle className="h-3.5 w-3.5" /> Reset results
          </button>
        )}
      </div>

      {stored === false && (
        <p className="border-b border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-900/20 dark:text-amber-200">
          This bracket is read-only. Ask whoever runs this Waypoint to finish the setup, then it will save and sync.
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {canEdit && (
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            <input
              value={entry}
              onChange={(e) => setEntry(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addEntrant()}
              placeholder="add an entrant"
              className="w-44 rounded-md border border-paper-line bg-paper px-2 py-1 text-sm text-ink outline-none dark:border-coal-line dark:bg-coal dark:text-coal-text"
            />
            <button type="button" onClick={addEntrant} className="rounded-md border border-paper-line p-1.5 text-ink-soft hover:bg-paper-panel dark:border-coal-line dark:text-coal-soft dark:hover:bg-coal-line">
              <Plus className="h-3.5 w-3.5" />
            </button>
            {data.entrants.map((name) => (
              <span key={name} className="flex items-center gap-1 rounded-full border border-paper-line px-2 py-0.5 text-xs text-ink-soft dark:border-coal-line dark:text-coal-soft">
                {name}
                <button type="button" onClick={() => save({ ...data, entrants: data.entrants.filter((n) => n !== name), results: {} })} className="text-ink-faint hover:text-red-500">
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        {!rounds.length ? (
          <p className="py-8 text-center text-sm text-ink-faint dark:text-coal-soft">add at least two entrants to draw a bracket</p>
        ) : (
          <div className="flex gap-4 overflow-x-auto pb-2">
            {rounds.map((round, ri) => (
              <div key={ri} className="flex min-w-[11rem] flex-col justify-around gap-2">
                <p className="text-[11px] font-medium uppercase tracking-wide text-ink-faint dark:text-coal-soft">{roundName(ri)}</p>
                {round.map((m) => (
                  <div key={m.id} className="overflow-hidden rounded-lg border border-paper-line dark:border-coal-line">
                    {([m.a, m.b] as const).map((name, side) => {
                      const won = !!name && m.winner === name;
                      const lost = !!m.winner && !!name && m.winner !== name;
                      return (
                        <button
                          key={side}
                          type="button"
                          disabled={!canEdit || !name || m.bye}
                          onClick={() => name && save(pickWinner(data, m.id, name))}
                          className={[
                            'flex w-full items-center justify-between px-2 py-1.5 text-left text-xs',
                            side === 0 ? 'border-b border-paper-line dark:border-coal-line' : '',
                            won ? 'bg-clay/10 font-semibold text-ink dark:text-coal-text' : lost ? 'text-ink-faint line-through dark:text-coal-soft' : 'text-ink-soft dark:text-coal-soft',
                            name && !m.bye && canEdit ? 'hover:bg-paper-panel dark:hover:bg-coal-line' : '',
                          ].join(' ')}
                        >
                          <span className="min-w-0 truncate">{name ?? <span className="italic opacity-60">waiting</span>}</span>
                          {won && <Trophy className="h-3 w-3 shrink-0 text-clay" />}
                        </button>
                      );
                    })}
                    {m.bye && <p className="bg-paper-panel px-2 py-0.5 text-[10px] text-ink-faint dark:bg-coal-line dark:text-coal-soft">bye</p>}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {table.length > 0 && (
          <div className="mt-4">
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-ink-faint dark:text-coal-soft">standings</p>
            <div className="flex flex-wrap gap-1.5">
              {table.map((s) => (
                <span
                  key={s.name}
                  className={`rounded-full px-2 py-0.5 text-xs ${s.out ? 'bg-paper-panel text-ink-faint line-through dark:bg-coal-line dark:text-coal-soft' : 'bg-clay/10 text-ink dark:text-coal-text'}`}
                >
                  {s.name} <span className="tabular-nums opacity-60">{s.reached}</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
