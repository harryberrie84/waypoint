import { Lock } from 'lucide-react';
import { useVault } from '../store/useVault';

// Shown by a page tab when this page's body is still an `enc:v1:` envelope, i.e.
// we could not read what the page holds.
//
// Why this exists: every one of these tabs derives from the page body (which
// tables are embedded, which images, which reservations). Handed an envelope,
// each helper returns EMPTY rather than throwing, so the tab renders a perfectly
// tidy calendar with no events, or a file list with no files, and nothing on
// screen points at encryption. That is precisely how six tabs looked broken for
// weeks, and how a locked vault reads as "the calendar is gone". A blank surface
// must say which of the two it is.

export function LockedBody({ what }: { what: string }) {
  const status = useVault((s) => s.status);
  const openVault = useVault((s) => s.openPanel);
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <Lock className="h-5 w-5 text-clay" />
      <p className="text-sm text-ink dark:text-coal-text">This page is encrypted, so its {what} can't be read yet.</p>
      {status === 'unlocked' ? (
        <p className="max-w-sm text-xs text-ink-faint dark:text-coal-soft">
          Your vault is open, so this should fill in a moment. If it stays empty, reload the page.
        </p>
      ) : (
        <button
          type="button"
          onClick={openVault}
          className="rounded-md bg-clay px-3 py-1.5 text-xs font-medium text-white hover:bg-clay/90"
        >
          Unlock the vault
        </button>
      )}
    </div>
  );
}

/** The same message as a strip above content that DOES render (the Files and
 *  Photos tabs still list `pages.photos`, which is a plain field), so a partial
 *  view never passes itself off as the whole picture. */
export function LockedBodyStrip({ what }: { what: string }) {
  const status = useVault((s) => s.status);
  const openVault = useVault((s) => s.openPanel);
  return (
    <div className="mb-3 flex items-center gap-2 rounded-lg border border-clay/30 bg-clay-wash/40 px-3 py-2 text-xs text-ink dark:border-clay/30 dark:bg-clay/10 dark:text-coal-text">
      <Lock className="h-3.5 w-3.5 shrink-0 text-clay" />
      <span className="min-w-0 flex-1">This page is encrypted, so {what} in its notes aren't listed here yet.</span>
      {status !== 'unlocked' && (
        <button type="button" onClick={openVault} className="shrink-0 font-medium text-clay hover:underline">
          Unlock
        </button>
      )}
    </div>
  );
}
