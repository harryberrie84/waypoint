import { useEffect, useRef, useState } from 'react';
import { pb } from '../lib/pocketbase';
import { presenceApi } from '../lib/api';
import type { PresenceRecord } from '../types';
import type { RecordModel } from 'pocketbase';
import { useAuth } from '../store/useAuth';
import { encodeAwarenessUpdate, applyAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
import type { PageCollab } from '../lib/collab';
import { cursorsEnabled } from '../lib/cursors';

// How often (at most) we push our cursor. Coarse on purpose: a peer's caret
// lagging a fraction of a second is fine; NEVER let this block local typing.
const CURSOR_THROTTLE_MS = 250;

// ---------------------------------------------------------------------------
// usePresence
// ---------------------------------------------------------------------------
// Tracks who else is on the current page and whether they're editing. Each
// client maintains one presence record, refreshed by a heartbeat. Records
// whose heartbeat is older than STALE_MS are ignored (covers crashed tabs that
// never ran cleanup). Returns the list of *other* present users.

// Kept snappy so "online / editing" reflects reality quickly: a beat every ~8s.
// A record is considered gone STALE_MS after its last beat, comfortably more than
// 3 beats so a single delayed heartbeat (a throttled background tab, a wifi blip)
// doesn't make someone flicker out and back in. A visible-tab beat (below) makes
// resume near-instant.
const HEARTBEAT_MS = 8_000;
const STALE_MS = 30_000;

// Liveness is judged ENTIRELY on the receiver's clock: we stamp "last seen = now"
// whenever a record's heartbeat actually arrives here (realtime) or it's first
// returned by a fetch, and a record is live while that stamp is within STALE_MS.
// This sidesteps device clock skew completely. (The earlier skew-correction
// approach used a single global offset that got clobbered by our OWN heartbeats,
// making a peer blink out and back every ~8s.)
function fresh(lastSeen: number | undefined): boolean {
  return lastSeen !== undefined && lastSeen >= Date.now() - STALE_MS;
}

// For collapsing a user's several presence records to one: an editing record wins
// over a viewing one, then the most recently beaten.
function presenceRank(p: PresenceRecord): number {
  const t = Date.parse(p.heartbeat || p.updated || '');
  return (p.mode === 'editing' ? 1e15 : 0) + (Number.isFinite(t) ? t : 0);
}

function toPresence(r: RecordModel): PresenceRecord {
  return {
    id: r.id,
    page: r.page ?? '',
    user: r.user ?? '',
    userName: r.userName ?? 'Someone',
    mode: r.mode === 'editing' ? 'editing' : 'viewing',
    heartbeat: r.heartbeat ?? r.updated,
    updated: r.updated,
    cursor: typeof r.cursor === 'string' ? r.cursor : undefined,
    focus: typeof r.focus === 'string' ? r.focus : undefined,
  };
}

export function usePresence(
  pageId: string | null,
  editing: boolean,
  opts?: { collab?: PageCollab | null; focus?: string },
) {
  const user = useAuth((s) => s.user);
  const [others, setOthers] = useState<PresenceRecord[]>([]);
  const myRecordId = useRef<string | null>(null);
  const editingRef = useRef(editing);
  editingRef.current = editing;

  const pageRef = useRef(pageId);
  pageRef.current = pageId;

  const collab = opts?.collab ?? null;
  const collabRef = useRef<PageCollab | null>(collab);
  collabRef.current = collab;
  const focus = opts?.focus ?? '';
  const focusRef = useRef(focus);
  focusRef.current = focus;
  const cursorRef = useRef<string | undefined>(undefined); // latest encoded cursor to ride heartbeats
  const rebroadcastRef = useRef<(() => void) | null>(null); // Effect B exposes its broadcast here so a join can re-send my caret
  const hasPeersRef = useRef(false); // don't broadcast a cursor when editing alone (nobody to see it)
  hasPeersRef.current = others.length > 0;

  // Effect A: the presence RECORD (mode/heartbeat/cursor/focus), the others list,
  // and the realtime subscription (which also applies peers' cursors + prunes
  // the awareness of anyone who left). None of this touches the document.
  useEffect(() => {
    if (!pageId || !user) {
      setOthers([]);
      return;
    }
    let cancelled = false;
    let unsub: (() => void) | null = null;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const seen = new Map<string, number>(); // userId -> receiver time we last heard from them

    const refreshList = async () => {
      try {
        const list = await presenceApi.listForPage(pageId);
        if (cancelled) return;
        const now = Date.now();
        // Seed a first-sight stamp so a peer who was already here shows at once,
        // but never RE-seed (a crashed record must be allowed to go stale).
        for (const p of list) if (p.user !== user.id && !seen.has(p.user)) seen.set(p.user, now);
        const live = list.filter((p) => p.user !== user.id && fresh(seen.get(p.user)));
        // ONE entry per person: a collaborator with several tabs (or leftover
        // records the server never cleaned up) must show a single avatar, not N.
        // Keep their "most present" record: editing beats viewing, then newest beat.
        const byUser = new Map<string, PresenceRecord>();
        for (const p of live) {
          const cur = byUser.get(p.user);
          if (!cur || presenceRank(p) > presenceRank(cur)) byUser.set(p.user, p);
        }
        const present = [...byUser.values()];
        setOthers(present);
        // Drop the caret of anyone who left, so it doesn't linger.
        const aw = collabRef.current?.awareness;
        if (aw) {
          const present2 = new Set(present.map((p) => p.user));
          const drop: number[] = [];
          aw.getStates().forEach((st, clientId) => {
            const uid = (st as { user?: { id?: string } }).user?.id;
            if (clientId !== aw.clientID && uid && !present2.has(uid)) drop.push(clientId);
          });
          if (drop.length) removeAwarenessStates(aw, drop, 'remote');
        }
      } catch {
        // Non-fatal; the SSE stream will catch us up.
      }
    };

    const beat = async () => {
      try {
        const firstBeat = !myRecordId.current;
        const rec = await presenceApi.upsert(myRecordId.current, pageRef.current ?? pageId, editingRef.current ? 'editing' : 'viewing', {
          cursor: cursorRef.current,
          focus: focusRef.current,
        });
        myRecordId.current = rec.id;
        // On the first beat of a session, sweep any dead rows I left behind on a
        // previous crash/refresh (any page) so I don't show as several avatars or
        // linger on a page I've left.
        if (firstBeat) void presenceApi.pruneMyStale(rec.id);
      } catch {
        myRecordId.current = null;
      }
    };

    const applyPeerCursor = async (value: string) => {
      const cb = collabRef.current;
      if (!cb || !cursorsEnabled()) return;
      try {
        const bytes = await cb.decodeCursor(value);
        if (bytes && !cancelled) applyAwarenessUpdate(cb.awareness, bytes, 'remote');
      } catch {
        /* unreadable cursor (key not ready); ignore */
      }
    };

    // Apply a peer's cursor immediately (cheap, no fetch), but DEBOUNCE the list
    // refresh: cursor updates arrive many times a second, and a listForPage fetch
    // per event would be a storm. Joins/leaves/mode still reflect within ~1s.
    const scheduleRefresh = () => {
      if (refreshTimer) return;
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        void refreshList();
      }, 1000);
    };

    void pb
      .collection('presence')
      .subscribe('*', (e) => {
        const { action, record } = e as { action: string; record: RecordModel };
        const p = toPresence(record);
        if (p.page !== (pageRef.current ?? pageId)) return;
        // A heartbeat arrived here NOW: that's our liveness signal (receiver clock).
        if (action !== 'delete' && p.user !== user.id) seen.set(p.user, Date.now());
        else if (action === 'delete') seen.delete(p.user);
        if (action !== 'delete' && p.user !== user.id && p.cursor) void applyPeerCursor(p.cursor);
        // Someone new joined: re-send my caret so they see it right away instead
        // of only on my next move (their subscription is up a beat after create).
        if (action === 'create' && p.user !== user.id) setTimeout(() => rebroadcastRef.current?.(), 400);
        if (action === 'create' || action === 'delete') void refreshList(); // join/leave now
        else scheduleRefresh(); // mode/staleness soon
      })
      .then((fn) => {
        unsub = fn;
      })
      .catch(() => {});

    void beat();
    void refreshList();
    const interval = setInterval(() => {
      void beat();
      void refreshList();
    }, HEARTBEAT_MS);

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void beat();
        void refreshList();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);

    return () => {
      cancelled = true;
      clearInterval(interval);
      if (refreshTimer) clearTimeout(refreshTimer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      if (unsub) unsub();
      const idToRemove = myRecordId.current;
      myRecordId.current = null;
      if (idToRemove) void presenceApi.remove(idToRemove);
    };
  }, [pageId, user]);

  // Push mode / tab-focus changes promptly (don't wait for the heartbeat).
  useEffect(() => {
    if (!pageId || !user || !myRecordId.current) return;
    void presenceApi.upsert(myRecordId.current, pageId, editing ? 'editing' : 'viewing', { cursor: cursorRef.current, focus: focusRef.current }).catch(() => {});
  }, [editing, focus, pageId, user]);

  // Effect B: broadcast MY caret when the local awareness changes, throttled and
  // fully async, so it can never lag typing (it only reads the ephemeral
  // awareness and fires a network upsert; it never writes the document). Remote
  // awareness (origin 'remote') is skipped so peers aren't echoed back.
  useEffect(() => {
    if (!collab || !pageId || !user || !cursorsEnabled()) return;
    const aw = collab.awareness;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const broadcast = async (force = false) => {
      // Alone on the page? Skip the network write entirely. A peer's join forces
      // a send (force=true), so nothing is missed even before the list updates.
      if (!force && !hasPeersRef.current) return;
      try {
        const upd = encodeAwarenessUpdate(aw, [aw.clientID]);
        const enc = await collab.encodeCursor(upd);
        if (enc == null) return;
        cursorRef.current = enc;
        if (myRecordId.current) {
          await presenceApi.upsert(myRecordId.current, pageId, editingRef.current ? 'editing' : 'viewing', { cursor: enc, focus: focusRef.current });
        }
      } catch {
        /* best-effort; a dropped cursor just means a peer's caret is a beat stale */
      }
    };

    const onUpdate = (_changes: unknown, origin: unknown) => {
      if (origin === 'remote') return; // don't echo a peer's cursor back to them
      if (timer) return; // trailing throttle: at most one push per window
      timer = setTimeout(() => {
        timer = null;
        void broadcast();
      }, CURSOR_THROTTLE_MS);
    };
    aw.on('update', onUpdate);
    // Let a peer's join (Effect A) trigger an immediate re-send of my caret,
    // so an idle cursor shows up for the newcomer without waiting for a move.
    rebroadcastRef.current = () => void broadcast(true);
    return () => {
      aw.off('update', onUpdate);
      if (timer) clearTimeout(timer);
      rebroadcastRef.current = null;
    };
  }, [collab, pageId, user]);

  return others;
}

// ---------------------------------------------------------------------------
// useWorkspacePresence
// ---------------------------------------------------------------------------
// Everyone's live presence across ALL pages (minus yourself), grouped by page,
// so the sidebar can show "who's on this page" beside each entry. One shared
// realtime subscription; a prune tick drops records whose heartbeat went stale
// (a crashed tab) even without a delete event.

export function useWorkspacePresence(): Map<string, PresenceRecord[]> {
  const myId = useAuth((s) => s.user?.id ?? '');
  const [byPage, setByPage] = useState<Map<string, PresenceRecord[]>>(new Map());

  useEffect(() => {
    if (!myId) {
      setByPage(new Map());
      return;
    }
    let cancelled = false;
    let unsub: (() => void) | null = null;
    let lastSig = '';
    const records = new Map<string, PresenceRecord>(); // recordId -> record
    const seen = new Map<string, number>(); // recordId -> receiver time we last heard from it

    // Rank a user's records by receiver-clock recency (skew-free), editing first,
    // so we can pick the ONE that reflects where they actually are now.
    const rank = (p: PresenceRecord) => (p.mode === 'editing' ? 1e15 : 0) + (seen.get(p.id) ?? 0);

    const rebuild = () => {
      if (cancelled) return;
      // One live record per user (their freshest), so a person shows in exactly
      // ONE place, not lingering on a page they've navigated away from.
      const bestByUser = new Map<string, PresenceRecord>();
      for (const p of records.values()) {
        if (p.user === myId) continue;
        if (!fresh(seen.get(p.id))) continue;
        const cur = bestByUser.get(p.user);
        if (!cur || rank(p) > rank(cur)) bestByUser.set(p.user, p);
      }
      const map = new Map<string, PresenceRecord[]>();
      for (const p of bestByUser.values()) {
        const arr = map.get(p.page) ?? [];
        arr.push(p);
        map.set(p.page, arr);
      }
      // Only re-render when the who/where/mode actually changed, so the 4s prune
      // tick doesn't churn the whole sidebar every time.
      const sig = [...map.entries()]
        .map(([pg, arr]) => `${pg}:${arr.map((a) => a.user + a.mode).sort().join(',')}`)
        .sort()
        .join('|');
      if (sig === lastSig) return;
      lastSig = sig;
      setByPage(map);
    };

    const load = async () => {
      try {
        const all = await presenceApi.listAll();
        if (cancelled) return;
        records.clear();
        const now = Date.now();
        for (const p of all) {
          records.set(p.id, p);
          if (!seen.has(p.id)) seen.set(p.id, now); // first-sight stamp; never re-seed
        }
        rebuild();
      } catch {
        /* SSE will catch us up */
      }
    };

    void pb
      .collection('presence')
      .subscribe('*', (e) => {
        const { action, record } = e as { action: string; record: RecordModel };
        if (action === 'delete') {
          records.delete(record.id);
          seen.delete(record.id);
        } else {
          records.set(record.id, toPresence(record));
          seen.set(record.id, Date.now()); // heard from it NOW (receiver clock)
        }
        rebuild();
      })
      .then((fn) => {
        unsub = fn;
      })
      .catch(() => {});

    void load();
    const prune = setInterval(rebuild, 4_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      clearInterval(prune);
      document.removeEventListener('visibilitychange', onVisible);
      if (unsub) unsub();
    };
  }, [myId]);

  return byPage;
}
