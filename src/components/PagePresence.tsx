import { useState } from 'react';
import { CornerUpRight } from 'lucide-react';
import type { PresenceRecord } from '../types';
import { initials, avatarColor } from '../lib/avatar';

// PagePresence, the little cluster of collaborator avatars shown beside a page in
// the sidebar so you can see who's on it. Google-Docs style: up to two avatars,
// then a "+N" chip; hover the cluster for the full list of names (and who's
// editing). Each avatar carries a native name tooltip too. Editing shows a clay
// ring + pulse; viewing is a plain chip.

function Dot({ p, size }: { p: PresenceRecord; size: string }) {
  return (
    <span
      title={`${p.userName}${p.mode === 'editing' ? ' (editing)' : ''}`}
      className={[
        size,
        'relative flex items-center justify-center rounded-full border border-paper text-[8px] font-semibold text-white dark:border-coal-panel',
        p.mode === 'editing' ? 'ring-2 ring-clay' : '',
      ].join(' ')}
      style={{ backgroundColor: avatarColor(p.user) }}
    >
      {initials(p.userName)}
      {p.mode === 'editing' && <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 animate-pulse rounded-full bg-clay ring-1 ring-paper dark:ring-coal-panel" />}
    </span>
  );
}

export function PagePresence({ people, onJump }: { people: PresenceRecord[]; onJump?: (p: PresenceRecord) => void }) {
  const [open, setOpen] = useState(false);
  if (people.length === 0) return null;
  // Editors first so they're the ones that show when space is tight.
  const sorted = [...people].sort((a, b) => (a.mode === b.mode ? 0 : a.mode === 'editing' ? -1 : 1));
  const shown = sorted.slice(0, 2);
  const extra = sorted.length - shown.length;

  return (
    <span
      className="relative flex shrink-0 items-center"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span className="flex items-center -space-x-1.5">
        {shown.map((p) => (
          <Dot key={p.user} p={p} size="h-4 w-4" />
        ))}
        {extra > 0 && (
          <span className="flex h-4 w-4 items-center justify-center rounded-full border border-paper bg-ink-faint text-[8px] font-semibold text-white dark:border-coal-panel dark:bg-coal-soft">
            +{extra}
          </span>
        )}
      </span>
      {open && (
        <span className="absolute right-0 top-full z-50 mt-1 w-max max-w-[14rem] rounded-lg border border-paper-line bg-paper p-1.5 text-left shadow-xl dark:border-coal-line dark:bg-coal-panel">
          <span className="mb-1 block px-1 text-[10px] font-semibold uppercase tracking-wide text-ink-faint dark:text-coal-soft">
            {sorted.length === 1 ? 'here now' : `${sorted.length} here now`}
          </span>
          {sorted.map((p) =>
            onJump ? (
              <button
                key={p.user}
                type="button"
                onClick={() => onJump(p)}
                title={`Jump to ${p.userName}`}
                className="group/row flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-xs text-ink hover:bg-paper-panel dark:text-coal-text dark:hover:bg-coal-line"
              >
                <Dot p={p} size="h-4 w-4" />
                <span className="min-w-0 flex-1 truncate">{p.userName}</span>
                {p.mode === 'editing' && <span className="shrink-0 text-[10px] font-medium text-clay">editing</span>}
                <CornerUpRight className="h-3 w-3 shrink-0 text-ink-faint opacity-0 group-hover/row:opacity-100 dark:text-coal-soft" />
              </button>
            ) : (
              <span key={p.user} className="flex items-center gap-1.5 rounded px-1 py-0.5 text-xs text-ink dark:text-coal-text">
                <Dot p={p} size="h-4 w-4" />
                <span className="min-w-0 flex-1 truncate">{p.userName}</span>
                {p.mode === 'editing' && <span className="shrink-0 text-[10px] font-medium text-clay">editing</span>}
              </span>
            ),
          )}
        </span>
      )}
    </span>
  );
}
