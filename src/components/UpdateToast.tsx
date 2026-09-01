import { useEffect, useState } from 'react';
import { X } from 'lucide-react';

// A refresh symbol (two arrows around a circle) with a hollow up arrow inside it,
// hand-drawn as SVG geometry so it reads as "an update to pull down" rather than a
// generic sparkle.
function UpdateIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {/* two arrows curving around a circle */}
      <path d="M20.5 12a8.5 8.5 0 0 0-8.5-8.5 9.2 9.2 0 0 0-6.4 2.6L3 8.5" />
      <path d="M3 3.8v4.7h4.7" />
      <path d="M3.5 12a8.5 8.5 0 0 0 8.5 8.5 9.2 9.2 0 0 0 6.4-2.6L21 15.5" />
      <path d="M21 20.2v-4.7h-4.7" />
      {/* hollow up arrow in the centre */}
      <path d="M12 15.3V9.2" />
      <path d="m9.7 11.5 2.3-2.4 2.3 2.4" />
    </svg>
  );
}

// "A new version is available" prompt. Each build stamps a unique id into the app
// (__BUILD_ID__) and into /version.json (see vite.config.ts). This polls that file
// and, when it sees a newer id than the one it was built with, offers a refresh,
// so shipping a new build never means telling people to hard-refresh, they just
// get a gentle nudge and choose when to reload.

const CURRENT_BUILD = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : '';
const POLL_MS = 5 * 60 * 1000;

async function fetchLatestBuild(): Promise<string | null> {
  try {
    // Cache-busted + no-store so we always read what the server has now; the
    // service worker only caches /assets, so this passes straight to the network.
    const res = await fetch(`/version.json?_=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as { build?: unknown };
    return typeof data.build === 'string' ? data.build : null;
  } catch {
    return null;
  }
}

export function UpdateToast() {
  const [newBuild, setNewBuild] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);

  useEffect(() => {
    // Only meaningful for the deployed build (dev has no version.json and reloads
    // itself on change).
    if (!import.meta.env.PROD || !CURRENT_BUILD) return;
    let alive = true;
    const check = async () => {
      const latest = await fetchLatestBuild();
      if (alive && latest && latest !== CURRENT_BUILD) setNewBuild(latest);
    };
    void check();
    const timer = setInterval(check, POLL_MS);
    // Also check the moment the tab comes back or the network returns, so a build
    // shipped while the tab was idle surfaces promptly. `focus` matters as much as
    // `visibilitychange`: switching from a terminal back to an already-visible
    // browser window never hides the tab, so visibilitychange does not fire and
    // the prompt would wait out the full poll. That is the deploy-then-alt-tab
    // loop, which is exactly when you want to be told.
    const onWake = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('focus', onWake);
    window.addEventListener('online', onWake);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('focus', onWake);
      window.removeEventListener('online', onWake);
    };
  }, []);

  if (!newBuild || newBuild === dismissed) return null;

  return (
    // Bottom-centred and width-capped so it reads well on a phone; lifted above the
    // capture button (bottom-right) on mobile, dropped to the normal offset on md+.
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[1400] flex justify-center px-3 md:bottom-6">
      <div className="pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-xl border border-paper-line bg-paper px-4 py-3 shadow-xl dark:border-coal-line dark:bg-coal-panel">
        <UpdateIcon className="h-5 w-5 shrink-0 text-clay" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-ink dark:text-coal-text">New version available</div>
          <div className="text-[11px] leading-tight text-ink-faint dark:text-coal-soft">Refresh to get the latest.</div>
        </div>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="shrink-0 rounded-lg bg-clay px-3.5 py-2 text-xs font-semibold text-white hover:bg-clay/90"
        >
          Refresh
        </button>
        <button
          type="button"
          onClick={() => setDismissed(newBuild)}
          title="Dismiss"
          aria-label="Dismiss"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-faint hover:bg-paper-panel hover:text-ink dark:text-coal-soft dark:hover:bg-coal-line"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
