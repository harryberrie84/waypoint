import { useEffect, useRef, useState } from 'react';
import { SmilePlus } from 'lucide-react';
import { useData } from '../store/useData';
import { useAuth } from '../store/useAuth';
import { usersApi, type Member } from '../lib/api';
import { reactionEntries, REACTION_PALETTE } from '../lib/reactions';
import { Popover } from './Popover';

// RowReactions, emoji votes on a row, shown as toggleable chips with counts.
// Used full-width with a picker in RowDetail, and compact on board/gallery cards.
// `detail` also loads the member roster so a chip can name who reacted; cards
// skip that fetch (one per card would be wasteful) and just show counts.

export function RowReactions({ rowId, variant }: { rowId: string; variant: 'detail' | 'card' }) {
  const reactions = useData((s) => s.rows[rowId]?.reactions ?? null);
  const toggleReaction = useData((s) => s.toggleReaction);
  const me = useAuth((s) => s.user);
  const [members, setMembers] = useState<Member[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (variant !== 'detail') return;
    usersApi.listMembers().then(setMembers).catch(() => setMembers([]));
  }, [variant]);

  const entries = reactionEntries(reactions);
  const myId = me?.id ?? '';
  const nameOf = (id: string) => (id === myId ? 'You' : members.find((m) => m.id === id)?.name ?? 'Someone');
  const tip = (ids: string[]) =>
    variant === 'detail' && members.length ? ids.map(nameOf).join(', ') : `${ids.length}`;

  const toggle = (emoji: string) => myId && toggleReaction(rowId, emoji, myId);

  if (variant === 'card') {
    if (entries.length === 0) return null;
    return (
      <div className="flex flex-wrap gap-1 px-1 pt-1">
        {entries.map((e) => {
          const mine = e.ids.includes(myId);
          return (
            <button
              key={e.emoji}
              type="button"
              onClick={() => toggle(e.emoji)}
              title={tip(e.ids)}
              className={[
                'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] leading-none transition-colors',
                mine
                  ? 'border-clay/40 bg-clay-wash text-clay dark:border-clay/40 dark:bg-clay/20 dark:text-clay-soft'
                  : 'border-paper-line bg-paper-panel text-ink-soft hover:border-clay/30 dark:border-coal-line dark:bg-coal-line dark:text-coal-soft',
              ].join(' ')}
            >
              <span>{e.emoji}</span>
              <span className="font-medium">{e.count}</span>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {entries.map((e) => {
        const mine = e.ids.includes(myId);
        return (
          <button
            key={e.emoji}
            type="button"
            onClick={() => toggle(e.emoji)}
            title={tip(e.ids)}
            className={[
              'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors',
              mine
                ? 'border-clay/40 bg-clay-wash text-clay dark:border-clay/40 dark:bg-clay/20 dark:text-clay-soft'
                : 'border-paper-line bg-paper-panel text-ink-soft hover:border-clay/30 dark:border-coal-line dark:bg-coal-line dark:text-coal-soft',
            ].join(' ')}
          >
            <span className="text-sm leading-none">{e.emoji}</span>
            <span className="font-medium tabular-nums">{e.count}</span>
          </button>
        );
      })}
      <button
        ref={pickRef}
        type="button"
        onClick={() => setPickerOpen((o) => !o)}
        title="Add a reaction"
        className="inline-flex items-center gap-1 rounded-full border border-dashed border-paper-line px-2 py-0.5 text-xs text-ink-faint hover:border-clay hover:text-clay dark:border-coal-line dark:text-coal-soft"
      >
        <SmilePlus className="h-3.5 w-3.5" />
        {entries.length === 0 && <span>React</span>}
      </button>
      <Popover open={pickerOpen} onClose={() => setPickerOpen(false)} anchorRef={pickRef} width={188}>
        <div className="flex flex-wrap gap-1 p-1">
          {REACTION_PALETTE.map((emoji) => {
            const mine = (reactions?.[emoji] ?? []).includes(myId);
            return (
              <button
                key={emoji}
                type="button"
                onClick={() => {
                  toggle(emoji);
                  setPickerOpen(false);
                }}
                className={[
                  'flex h-8 w-8 items-center justify-center rounded-md text-lg transition-colors',
                  mine ? 'bg-clay-wash dark:bg-clay/20' : 'hover:bg-paper-panel dark:hover:bg-coal-line',
                ].join(' ')}
              >
                {emoji}
              </button>
            );
          })}
        </div>
      </Popover>
    </div>
  );
}
