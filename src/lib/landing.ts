// ---------------------------------------------------------------------------
// landing, two navigation prefs:
//  - lastPage: the page you were on, so a refresh (even a hard ctrl+shift+r,
//    which does NOT clear localStorage) returns you there. Device/session-local
//    by nature, so it stays in localStorage.
//  - the per-workspace "home" page you land on when you switch into a workspace.
//    This is a per-USER preference: it follows you across YOUR devices but is
//    private to you (never shared with other members). It lives in a `prefs` JSON
//    field on your own users record, mirrored to localStorage so it still works
//    per-device before that field exists on the server, or when signed out.
// ---------------------------------------------------------------------------

import { pb } from './pocketbase';

const LAST_KEY = 'waypoint:lastPage';

export function loadLastPage(): string | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(LAST_KEY) : null;
  } catch {
    return null;
  }
}

export function saveLastPage(pageId: string | null): void {
  try {
    if (typeof localStorage === 'undefined') return;
    // Keep the last real page even when you drop to Home (activePageId null), so a
    // refresh from anywhere returns to a page; the Home sentinel handles Home.
    if (pageId) localStorage.setItem(LAST_KEY, pageId);
  } catch {
    /* private mode / quota, navigation just won't persist */
  }
}

// Fired whenever a workspace's home page changes (from the sidebar house icon,
// the settings picker, or an account sync), so every view re-reads the value.
export const LANDING_EVENT = 'waypoint:landing-changed';

interface UserPrefs {
  landing?: Record<string, string>; // workspaceId -> pageId
}

function serverPrefs(): UserPrefs {
  const p = (pb.authStore.record as { prefs?: unknown } | null)?.prefs;
  return p && typeof p === 'object' && !Array.isArray(p) ? (p as UserPrefs) : {};
}

function localKey(ws: string): string {
  return `waypoint:landing:${ws}`;
}
function loadLocalLanding(ws: string): string | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(localKey(ws)) : null;
  } catch {
    return null;
  }
}
function saveLocalLanding(ws: string, pageId: string | null): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (pageId) localStorage.setItem(localKey(ws), pageId);
    else localStorage.removeItem(localKey(ws));
  } catch {
    /* ignore */
  }
}

export function loadLanding(ws: string | null | undefined): string | null {
  if (!ws) return null;
  // The synced per-user value wins; the local mirror is the fallback (offline,
  // or before the server `prefs` field is added).
  return serverPrefs().landing?.[ws] ?? loadLocalLanding(ws);
}

export function saveLanding(ws: string | null | undefined, pageId: string | null): void {
  if (!ws) return;
  saveLocalLanding(ws, pageId); // device fallback + pre-field persistence

  const rec = pb.authStore.record as ({ id?: string; prefs?: UserPrefs } | null);
  if (rec) {
    const prefs = serverPrefs();
    const landing = { ...(prefs.landing ?? {}) };
    if (pageId) landing[ws] = pageId;
    else delete landing[ws];
    const next: UserPrefs = { ...prefs, landing };
    // Optimistically update the cached auth record so loadLanding() reflects it
    // immediately, then persist to this user's own record (syncs their devices).
    // PocketBase silently drops the field if `prefs` isn't in the schema yet, so
    // this is safe to ship before the field is added (the local mirror covers it).
    rec.prefs = next;
    if (rec.id) {
      void pb.collection('users').update(rec.id, { prefs: next }).catch((err) => console.error('[landing] save failed', err));
    }
  }

  try {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(LANDING_EVENT, { detail: ws }));
  } catch {
    /* ignore */
  }
}
