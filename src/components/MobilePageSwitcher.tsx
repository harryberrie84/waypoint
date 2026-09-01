import { useEffect, useState } from 'react';
import { useData } from '../store/useData';
import { useWorkspacePages } from '../hooks/useScoped';
import { displayTitle } from '../lib/crypto';
import { PageIcon } from './PageIcon';

// MobilePageSwitcher, a phone-only bottom strip of the pages you've been on lately,
// so you can hop between the two or three you actually use on a trip (itinerary,
// budget, map) with one thumb tap instead of opening the sidebar drawer each time.
// Desktop navigates from the always-visible sidebar, so this is md:hidden. Recents
// are per-device (localStorage) and scoped to the active workspace, and the current
// page is dropped (you're already on it).

const KEY = 'waypoint:recents';

function loadRecents(): string[] {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function MobilePageSwitcher() {
  const activePageId = useData((s) => s.activePageId);
  const setActivePage = useData((s) => s.setActivePage);
  const pages = useWorkspacePages(); // scoped to the active workspace
  const [recents, setRecents] = useState<string[]>(loadRecents);

  // Push the page you just opened onto the front of the recents list (deduped,
  // capped). Reads the store directly so the effect only fires on a real navigation.
  useEffect(() => {
    if (!activePageId) return;
    const p = useData.getState().pages[activePageId];
    if (!p || p.trashed) return;
    setRecents((prev) => {
      const next = [activePageId, ...prev.filter((id) => id !== activePageId)].slice(0, 10);
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* private mode / quota: recents just stay in memory this session */
      }
      return next;
    });
  }, [activePageId]);

  const chips = recents
    .filter((id) => id !== activePageId && pages[id] && !pages[id].trashed)
    .map((id) => pages[id])
    .slice(0, 6);

  if (chips.length === 0) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-[90] flex items-center gap-1.5 overflow-x-auto border-t border-paper-line bg-paper/95 px-2 py-1.5 pb-safe pr-16 backdrop-blur md:hidden dark:border-coal-line dark:bg-coal-panel/95">
      {chips.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => setActivePage(p.id)}
          className="flex shrink-0 items-center gap-1.5 rounded-full border border-paper-line bg-paper px-2.5 py-1 text-xs text-ink dark:border-coal-line dark:bg-coal dark:text-coal-text"
        >
          <span className="flex items-center">
            <PageIcon icon={p.icon} size="h-3.5 w-3.5" />
          </span>
          <span className="max-w-[7rem] truncate">{displayTitle(p.title) || 'Untitled'}</span>
        </button>
      ))}
    </div>
  );
}
