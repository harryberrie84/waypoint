import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { yDocToProsemirrorJSON } from 'y-prosemirror';
import { IndexeddbPersistence } from 'y-indexeddb';
import { pb } from './pocketbase';
import { isEnvelope } from './crypto';
import { isEmptyDoc } from './doc';
import { compactCount } from './collabCompact';
import { uid } from './id';
import { useWorkspaceKeys } from '../store/useWorkspaceKeys';

// True when the shared doc holds no real content: no nodes, or only blank
// paragraphs. Used to decide seeding. A bare `fragment.length === 0` missed a doc
// that was persisted with an empty paragraph, so it declared "already seeded",
// showed a blank page, and then the blank overwrote the page's saved content.
// Reading it as ProseMirror JSON and reusing isEmptyDoc catches that.
function ydocIsEmpty(doc: Y.Doc): boolean {
  try {
    const json = yDocToProsemirrorJSON(doc, 'default') as { content?: unknown[] };
    return isEmptyDoc({ type: 'doc', content: json.content ?? [] });
  } catch {
    return doc.getXmlFragment('default').length === 0;
  }
}

// Real-time co-editing for a page, encrypted or not. A Yjs document is the shared
// source of truth; this provider keeps it in sync between everyone on the page:
//   - incremental edits are relayed as rows in the `yupdates` collection, which
//     others receive over realtime and apply;
//   - a debounced snapshot is saved to pages.ydoc so someone joining later syncs
//     from one blob instead of replaying every edit.
// On an encrypted page every relayed update and the snapshot are encrypted with
// the workspace key first, so the server never reads them; on a plaintext page
// they travel as raw base64, the same trust level the page's own body already
// has. The read path decides per value (isEnvelope), so a page that toggles its
// lock still replays its older rows. The decoded page JSON is still saved
// separately (search, mirrors, public, print), derived from the same edits, so
// that stays the readable projection. If anything here fails the caller falls
// back to the plain last-write-wins editor, so collaboration never blocks typing.

const SNAPSHOT_FIELD = 'ydoc';
const FLUSH_MS = 250; // batch local edits before relaying
const SNAPSHOT_MS = 4000; // debounce snapshot writes
// Compaction: once the folded state lives in pages.ydoc, the oldest relay rows are
// redundant. Keep a healthy tail as a safety margin (anything a peer might still be
// catching up on) and prune the rest, so `connect` loads one snapshot + a short tail
// instead of replaying the whole history. Kept deliberately generous.
const COMPACT_KEEP = 100; // newest relay rows to keep after folding
const COMPACT_INTERVAL_MS = 2 * 60 * 1000; // compact at most this often per session
const COMPACT_MAX_DELETE = 500; // cap per run (PB page size); a big backlog drains over runs
const RELAY_WAIT_MS = 4000; // how long connect() waits on the relay before going local-only

// Local-first IndexedDB persistence is on by default; a kill switch disables it if
// it ever misbehaves, matching waypoint:nocollab.
function localPersistEnabled(): boolean {
  try {
    return localStorage.getItem('waypoint:nolocal') !== '1';
  } catch {
    return false;
  }
}

// Delete a page's LOCAL IndexedDB Yjs doc, so the next connect() has no stale local
// copy and reseeds from the page's saved content. This is the THIRD place a stale
// doc hides, besides the server snapshot (pages.ydoc) and the relay log (yupdates):
// after a DIRECT content write, connect() opens local-first, and without clearing
// this the stale local doc loads, the server looks empty, and connect() pushes the
// old state back up instead of reseeding, which re-lost images added via a tab.
// Best-effort; resolves even if an open connection elsewhere blocks the delete.
export function clearLocalPageDoc(pageId: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve();
      const req = indexedDB.deleteDatabase(`wp-page-${pageId}`);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

// A page whose `content` was written OUTSIDE the editor (attachToPage, capture, lock,
// workspace move) flags itself here so the NEXT connect() discards any stale Yjs doc
// (local + server) and reseeds from that content, instead of a stale doc silently
// overwriting it. Survives a reload (localStorage), so it holds even if the page is
// rebuilt/reopened before it was ever re-seeded.
const FORCE_SEED_KEY = (pageId: string) => `waypoint:forceseed:${pageId}`;
export function markForceSeed(pageId: string): void {
  try {
    localStorage.setItem(FORCE_SEED_KEY(pageId), '1');
  } catch {
    /* private mode: the local-doc clear + server reset still run, just no cross-reload flag */
  }
}
function consumeForceSeed(pageId: string): boolean {
  try {
    const v = localStorage.getItem(FORCE_SEED_KEY(pageId));
    if (v) localStorage.removeItem(FORCE_SEED_KEY(pageId));
    return !!v;
  } catch {
    return false;
  }
}

function bytesToB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function b64ToBytes(str: string): Uint8Array {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export class PageCollab {
  readonly doc = new Y.Doc();
  // Ephemeral collaboration cursors ride here. DELIBERATELY separate from the
  // edit sync above: awareness never writes to the doc (only ProseMirror cursor
  // decorations), and it travels on its own throttled channel (presence.cursor,
  // see usePresence), so it can neither lag typing nor overwrite anyone's text.
  readonly awareness = new Awareness(this.doc);
  needsSeed = false;

  private destroyed = false;
  private unsub: (() => void) | null = null;
  private buffer: Uint8Array[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private snapTimer: ReturnType<typeof setTimeout> | null = null;
  private idb: IndexeddbPersistence | null = null; // local-first persistence (phase 1)
  private lastCompact = 0; // throttle: Date.now() of the last compaction this session
  // False when an existing snapshot could not be loaded (corrupt / key not ready /
  // unfetchable). The log may have been pruned against that snapshot, so our doc
  // could be incomplete; we then refuse to write a snapshot (which would clobber the
  // good one with partial state) or compact. A healthy session heals both later.
  private snapshotReadable = true;
  // Phase 2 (offline editing). relayConnected: the server relay is currently synced.
  // localHasContent: the IndexedDB doc already held real content at open, so it's
  // safe to edit offline (we're not editing a blank we might duplicate on sync).
  // A page is editable offline when either holds. onSync notifies the UI when
  // relayConnected flips, so the read-only preview swaps to the live editor.
  private relayConnected = false;
  localHasContent = false;
  // True when the last sync found a snapshot or relay rows on the server, i.e. the
  // page has been seeded before. Gates re-seeding: seeding from the (last-write-wins)
  // `pages.content` projection over a doc that already has history can fork the shared
  // doc and lose text, so we only ever seed a page the server has NOTHING for.
  private serverHadHistory = false;
  onSync: (() => void) | null = null;
  private onlineHandler: (() => void) | null = null;

  private pageId: string;
  private workspaceId: string;
  private encrypted: boolean;
  // A per-session tag (this tab/device), NOT the user id. We stamp it on every
  // relayed row and skip only rows carrying our own tag, so we ignore our own
  // echoes but still apply a peer's. Keying this on the user id broke same-account
  // collaboration: a second device signed into the same account looked like our
  // own edit and got dropped, so a peer's writes only showed up after a refresh
  // (connect() replays the whole log unfiltered). The user id is kept as a prefix
  // for readability/debugging; only the full tag is ever compared.
  private clientTag: string;

  constructor(pageId: string, workspaceId: string, userId: string, encrypted: boolean) {
    this.pageId = pageId;
    this.workspaceId = workspaceId;
    this.encrypted = encrypted;
    this.clientTag = `${userId}~${uid('y')}`;
  }

  // Turn a stored value (a `yupdates.data` row or a `pages.ydoc` snapshot) into
  // raw Yjs bytes, decrypting only when it's actually an envelope. Reading per
  // value (not per `this.encrypted`) means a page that switched between plaintext
  // and encrypted still replays the rows written under the old mode.
  private async decode(value: string): Promise<Uint8Array | null> {
    try {
      if (isEnvelope(value)) {
        const b64 = await useWorkspaceKeys.getState().decryptForWorkspace(this.workspaceId, value);
        return typeof b64 === 'string' && b64 ? b64ToBytes(b64) : null;
      }
      return b64ToBytes(value);
    } catch {
      return null; // unreadable (key not ready / corrupt), skip; the rest catches up
    }
  }

  // Turn raw Yjs bytes into the value to store, encrypting only on an encrypted
  // page. Returns null if encryption fails, so the caller skips the write.
  private async encode(bytes: Uint8Array): Promise<string | null> {
    const b64 = bytesToB64(bytes);
    if (!this.encrypted) return b64;
    try {
      const env = await useWorkspaceKeys.getState().encryptForWorkspace(this.workspaceId, b64);
      return env || null;
    } catch {
      return null;
    }
  }

  // Ephemeral awareness (cursor) payloads reuse the doc's encryption: on a locked
  // page a cursor is encrypted with the workspace key like every edit, so the
  // server never learns where anyone is; plaintext otherwise. Best-effort.
  encodeCursor(update: Uint8Array): Promise<string | null> {
    return this.encode(update);
  }
  decodeCursor(value: string): Promise<Uint8Array | null> {
    return this.decode(value);
  }

  /** True when the page can be edited right now: the relay is synced, or we hold
   *  the page's content locally (so offline edits merge back rather than risk
   *  duplicating server content). */
  get editableNow(): boolean {
    return this.relayConnected || this.localHasContent;
  }

  // Open the doc (local-first) and start syncing. Local persistence makes the doc
  // usable with no network; the relay sync runs best-effort and never blocks
  // readiness, so an offline page is available immediately. Never throws.
  async connect(): Promise<void> {
    // Force-seed: an out-of-editor content write flagged this page's content as
    // authoritative. Discard ANY stale Yjs state so the doc reseeds from that content
    // rather than a stale doc silently overwriting it (the recurring "images added via
    // a tab vanish on reopen/rebuild"). Clears the server snapshot + relay log,
    // drops the local IndexedDB doc, and (below) empties the loaded doc in memory in
    // case that delete was blocked by an open handle.
    // Only consume the flag when we can actually complete the reseed (online). Offline
    // we leave it set so the NEXT online open force-seeds, instead of consuming it here
    // and being unable to clear the server / reach the relay.
    const force = navigator.onLine !== false && consumeForceSeed(this.pageId);
    if (force) {
      await clearLocalPageDoc(this.pageId);
      try {
        await pb.collection('pages').update(this.pageId, { [SNAPSHOT_FIELD]: '' });
        const stale = await pb.collection('yupdates').getFullList<{ id: string }>({ filter: `page="${this.pageId}"` });
        await Promise.all(stale.map((r) => pb.collection('yupdates').delete(r.id).catch(() => {})));
      } catch {
        /* offline: the content projection still displays; a later online open reseeds */
      }
    }

    // 0) Local-first persistence. Mirror the doc into IndexedDB so it loads
    // instantly and works offline, surviving a reload. Awaited FIRST, and before
    // the update listener registers, so restored updates aren't re-relayed (the
    // catch-up in syncRelay sends what the server is missing instead).
    if (localPersistEnabled()) {
      try {
        this.idb = new IndexeddbPersistence(`wp-page-${this.pageId}`, this.doc);
        await this.idb.whenSynced;
      } catch {
        this.idb = null;
      }
    }
    // Belt-and-suspenders for a force-seed whose local delete was blocked (an open
    // handle): empty the freshly loaded doc so ydocIsEmpty holds and it reseeds from
    // content below. Done before the update listener registers, so it isn't relayed.
    if (force) {
      const frag = this.doc.getXmlFragment('default');
      if (frag.length) frag.delete(0, frag.length);
    }
    this.localHasContent = !ydocIsEmpty(this.doc);

    // Capture ongoing edits (offline or online) for relay. The server merge in
    // syncRelay applies with origin 'remote' and is skipped here.
    this.doc.on('update', this.onLocalUpdate);

    // Sync with the server, best-effort and bounded. Skip the wait entirely when the
    // browser says it's offline (the online handler will sync later), so an offline
    // page becomes ready at once.
    if (navigator.onLine !== false) {
      await Promise.race([this.syncRelay(), new Promise<void>((r) => setTimeout(r, RELAY_WAIT_MS))]);
    }

    // Seed ONLY when we reached the server AND it has never been seeded (no snapshot,
    // no relay rows). Offline we never seed (the server may hold content we haven't
    // synced). And never seed a page that already has history even if our merged doc
    // looks empty: re-seeding from the last-write-wins `pages.content` projection can
    // fork the shared doc and lose text on every peer.
    this.needsSeed = this.relayConnected && ydocIsEmpty(this.doc) && !this.serverHadHistory;

    // Re-sync when the network returns: send offline edits, receive remote ones.
    this.onlineHandler = () => void this.syncRelay();
    try {
      window.addEventListener('online', this.onlineHandler);
    } catch {
      /* no window (tests) */
    }
  }

  // Reconcile with the server: pull its state, push our local delta (offline
  // edits), and (re)subscribe for live updates. Idempotent and safe to call again
  // on reconnect. Sets relayConnected and notifies the UI. Never throws.
  private async syncRelay(): Promise<void> {
    if (this.destroyed) return;
    // Build the server's current state in a throwaway doc (snapshot + log), so we can
    // both merge it in and know its state vector for the catch-up. Destroyed on every
    // path via finally.
    const serverDoc = new Y.Doc();
    try {
      const rec = await pb.collection('pages').getOne<{ ydoc?: string }>(this.pageId, { fields: 'ydoc' });
      const snap = typeof rec.ydoc === 'string' ? rec.ydoc : '';
      if (snap) {
        const bytes = await this.decode(snap);
        if (bytes) Y.applyUpdate(serverDoc, bytes);
        // A snapshot that EXISTS but won't decode degrades the session (don't later
        // overwrite it with a partial doc). A fetch FAILURE, by contrast, is just
        // offline and must NOT touch snapshotReadable, so it's handled by the catch.
        else this.snapshotReadable = false;
      }
      const rows = await pb.collection('yupdates').getFullList<{ data?: string }>({
        filter: `page="${this.pageId}"`,
        sort: 'created',
      });
      for (const r of rows) if (r.data) { const b = await this.decode(r.data); if (b) Y.applyUpdate(serverDoc, b); }

      // The page has been seeded before if the server holds a snapshot or any relay
      // row. Even if that state merged to a doc that looks empty here, we must not
      // seed over it (that fork is the "both sides lose text" bug).
      this.serverHadHistory = !!snap || rows.length > 0 || !ydocIsEmpty(serverDoc);

      const serverSV = Y.encodeStateVector(serverDoc);
      // Merge the server's state into our doc (origin 'remote', so it isn't relayed).
      Y.applyUpdate(this.doc, Y.encodeStateAsUpdate(serverDoc), 'remote');

      // Catch-up: push whatever the server is missing (our offline edits) as one row.
      // An empty delta is ~2 bytes, so skip those.
      const delta = Y.encodeStateAsUpdate(this.doc, serverSV);
      if (delta.length > 2 && !this.destroyed) {
        const data = await this.encode(delta);
        if (data) await pb.collection('yupdates').create({ page: this.pageId, workspace: this.workspaceId, author: this.clientTag, data });
      }

      // (Re)subscribe for live updates from peers.
      if (this.unsub) {
        try {
          this.unsub();
        } catch {
          /* already gone */
        }
        this.unsub = null;
      }
      if (!this.destroyed) {
        this.unsub = await pb.collection('yupdates').subscribe(
          '*',
          (e: { action: string; record: { page?: string; author?: string; data?: string } }) => {
            if (this.destroyed || e.action !== 'create') return;
            const r = e.record;
            if (r.page !== this.pageId || r.author === this.clientTag || !r.data) return;
            void this.applyValue(r.data);
          },
          { filter: `page="${this.pageId}"` },
        );
      }
      this.relayConnected = true;
      this.onSync?.();
    } catch {
      // Offline / relay down: stay local-only. The online handler (or the next open)
      // retries; edits are safe in IndexedDB meanwhile.
      this.relayConnected = false;
    } finally {
      serverDoc.destroy();
    }
  }

  // Relay whatever is buffered right now instead of waiting out the debounce.
  // Used straight after seeding so any other client opening the same fresh page
  // sees the seed and skips its own, shrinking the double-seed window.
  flushNow() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    void this.flush();
  }

  private onLocalUpdate = (update: Uint8Array, origin: unknown) => {
    // Ignore updates we applied from a remote peer (origin 'remote'); only relay
    // genuinely local edits.
    if (origin === 'remote' || this.destroyed) return;
    this.buffer.push(update);
    if (!this.flushTimer) this.flushTimer = setTimeout(this.flush, FLUSH_MS);
    this.scheduleSnapshot();
  };

  private flush = async () => {
    this.flushTimer = null;
    if (this.destroyed || this.buffer.length === 0) return;
    const merged = Y.mergeUpdates(this.buffer);
    this.buffer = [];
    try {
      const data = await this.encode(merged);
      if (data && !this.destroyed) {
        await pb.collection('yupdates').create({ page: this.pageId, workspace: this.workspaceId, author: this.clientTag, data });
      }
    } catch {
      /* a dropped relay row is recovered by the snapshot, so swallow */
    }
  };

  private applyValue = async (value: string) => {
    const bytes = await this.decode(value);
    if (bytes && !this.destroyed) Y.applyUpdate(this.doc, bytes, 'remote');
  };

  private scheduleSnapshot() {
    if (this.snapTimer) return;
    this.snapTimer = setTimeout(this.saveSnapshot, SNAPSHOT_MS);
  }

  private saveSnapshot = async () => {
    this.snapTimer = null;
    // Skip when degraded: our doc may be missing history from a snapshot we could
    // not read, so writing (and then compacting) could destroy it. Edits still relay
    // to the log and a healthy session snapshots them later.
    if (this.destroyed || !this.snapshotReadable) return;
    // NEVER persist an empty doc as the snapshot. Overwriting the server's good
    // `pages.ydoc` with nothing, then compacting the relay rows that still held the
    // text, blanks the page for everyone who connects next: this is the "it vanished
    // on both sides" bug. A page cleared on purpose keeps its previous snapshot (the
    // relay rows still carry the clear); deleting the page is how you empty it.
    if (ydocIsEmpty(this.doc)) return;
    try {
      const state = Y.encodeStateAsUpdate(this.doc);
      const value = await this.encode(state);
      if (value && !this.destroyed) {
        await pb.collection('pages').update(this.pageId, { [SNAPSHOT_FIELD]: value });
        // The log tail is now folded into a fresh (non-empty) snapshot: prune old rows.
        void this.maybeCompact();
      }
    } catch {
      /* the next edit reschedules another snapshot */
    }
  };

  // Prune the oldest relay rows now that the snapshot we just wrote folds them in.
  // SAFETY: we only run this right after our own snapshot succeeded, and this
  // session's doc is fully synced (connect loaded the snapshot + replayed the log
  // before any local edit), so that snapshot contains every row we delete. We only
  // ever delete the OLDEST rows and keep a generous tail (COMPACT_KEEP), so a row
  // recent enough that a peer might not have it yet is never touched, and any active
  // peer's own snapshot also contains the old rows we drop. Best-effort and
  // idempotent (a peer deleting the same row is a harmless 404).
  private maybeCompact = async () => {
    if (this.destroyed) return;
    const now = Date.now();
    if (now - this.lastCompact < COMPACT_INTERVAL_MS) return;
    this.lastCompact = now; // set before awaiting so overlapping snapshots don't double-run
    try {
      // Count the rows (oldest first) without pulling them all.
      const head = await pb.collection('yupdates').getList(1, 1, { filter: `page="${this.pageId}"`, sort: 'created' });
      const drop = compactCount(head.totalItems, COMPACT_KEEP, COMPACT_MAX_DELETE);
      if (drop <= 0) return;
      const old = await pb.collection('yupdates').getList<{ id: string }>(1, drop, { filter: `page="${this.pageId}"`, sort: 'created' });
      await Promise.all(old.items.map((r) => pb.collection('yupdates').delete(r.id).catch(() => {})));
    } catch {
      /* leave the log as-is; the next snapshot retries */
    }
  };

  destroy() {
    this.destroyed = true;
    this.doc.off('update', this.onLocalUpdate);
    try {
      this.awareness.destroy();
    } catch {
      /* already gone */
    }
    if (this.onlineHandler) {
      try {
        window.removeEventListener('online', this.onlineHandler);
      } catch {
        /* no window */
      }
      this.onlineHandler = null;
    }
    // Close the IndexedDB connection but keep the persisted data (that's the point).
    if (this.idb) {
      try {
        void this.idb.destroy();
      } catch {
        /* already gone */
      }
    }
    if (this.unsub) {
      try {
        this.unsub();
      } catch {
        /* already gone */
      }
    }
    if (this.flushTimer) clearTimeout(this.flushTimer);
    if (this.snapTimer) clearTimeout(this.snapTimer);
    this.doc.destroy();
  }
}
