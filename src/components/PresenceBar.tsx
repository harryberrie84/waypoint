import type { PresenceRecord } from '../types';
import { initials, avatarColor } from '../lib/avatar';
import { jumpToPresence } from '../lib/jumpTo';

// PresenceBar, shows avatars of other users on the page and flags anyone
// actively editing, so the last-write-wins window on prose is visible. Click an
// avatar to jump to exactly where that person is (their tab / open card).

export function PresenceBar({ others }: { others: PresenceRecord[] }) {
  if (others.length === 0) return null;
  const editing = others.filter((o) => o.mode === 'editing');

  return (
    <div className="flex items-center gap-2">
      <div className="flex -space-x-2">
        {others.slice(0, 4).map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => jumpToPresence(o)}
            title={`Jump to ${o.userName}${o.mode === 'editing' ? ' (editing)' : ''}`}
            className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-paper text-[10px] font-semibold text-white transition-transform hover:z-10 hover:scale-110 dark:border-coal-panel"
            style={{ backgroundColor: avatarColor(o.user) }}
          >
            {initials(o.userName)}
          </button>
        ))}
        {others.length > 4 && (
          <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-paper bg-ink-faint text-[10px] font-semibold text-white dark:border-coal-panel">
            +{others.length - 4}
          </span>
        )}
      </div>
      {editing.length > 0 && (
        <span className="flex items-center gap-1.5 rounded-full bg-clay-wash px-2 py-0.5 text-[11px] font-medium text-clay dark:bg-clay/20 dark:text-clay-soft">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-clay" />
          {editing.length === 1 ? `${editing[0].userName} is editing` : `${editing.length} people editing`}
        </span>
      )}
    </div>
  );
}
