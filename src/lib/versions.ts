import { versionsApi } from './api';

// Page backups: take a snapshot of a page's content now and then while it is being
// edited (throttled, so a burst of typing makes one backup, not hundreds), and keep
// the history bounded (a cap per page, and a few days). Best-effort; a failure
// never blocks editing.

const SNAPSHOT_INTERVAL = 4 * 60 * 1000; // at most one snapshot per 4 minutes of editing
const KEEP = 20; // newest N kept per page
const MAX_AGE_DAYS = 7;

const lastSnap = new Map<string, number>();

export function maybeSnapshot(pageId: string, workspace: string, content: unknown): void {
  if (!pageId || content == null) return;
  const now = Date.now();
  if (now - (lastSnap.get(pageId) ?? 0) < SNAPSHOT_INTERVAL) return;
  lastSnap.set(pageId, now);
  void versionsApi
    .create(pageId, workspace, content)
    .then(() => prune(pageId))
    .catch(() => {
      /* collection missing or offline; snapshots are optional */
    });
}

// Never prune a page down to nothing. The age rule used to apply on its own, so a
// page nobody had touched for a week kept ZERO snapshots, and the safety net
// disappeared for precisely the pages most likely to be clobbered without anyone
// noticing (the ones nobody is looking at). The newest few now survive any age.
const ALWAYS_KEEP = 3;

async function prune(pageId: string): Promise<void> {
  try {
    const list = await versionsApi.listForPage(pageId); // newest first
    const cutoff = Date.now() - MAX_AGE_DAYS * 86400000;
    const stale = list.filter(
      (v, i) => i >= KEEP || (i >= ALWAYS_KEEP && new Date(v.created).getTime() < cutoff),
    );
    for (const v of stale) await versionsApi.remove(v.id);
  } catch {
    /* ignore */
  }
}
