import { create } from 'zustand';
import { workspaceKeysApi, workspaceMembersApi } from '../lib/api';
import { useVault } from './useVault';
import { useWorkspace } from './useWorkspace';
import { useAuth } from './useAuth';
import { useData } from './useData';
import { generateContentKey, wrapContentKeyFor, unwrapContentKeyWith, encryptContent, decryptContent, isEnvelope } from '../lib/crypto';
import { splitCells, ENC_KEY } from '../lib/cellCrypto';
import { seeKey } from '../lib/keyTrust';
import { extractPlainText } from '../lib/search';
import { extractPageLinks } from '../lib/pageLinks';
import { extractTableIds } from '../lib/doc';
import type { Page, CellValue } from '../types';

// ---------------------------------------------------------------------------
// Workspace keys, shared-workspace content encryption.
// ---------------------------------------------------------------------------
// Each workspace has one symmetric content key, wrapped to every member's public
// key in `workspace_keys`. So a locked page in a SHARED workspace is readable by
// all its members (each unwraps the same key with their own private key), while
// the server only ever holds ciphertext and a non-member can't recover the key.
// In a solo (private) workspace the key is wrapped only to the owner, a true
// private locker.
//
// Bootstrap: the first member to need the key mints it and wraps it to herself.
// Grant: any member who holds the key wraps it to co-members who've published a
// public key but don't have a row yet (eventually consistent, best-effort).
//
// Falls back to the per-user master key for legacy/default-workspace pages, and
// `decryptForPage` tries the workspace key then the master key, so existing
// plaintext and any earlier per-user locks both keep working.

interface WorkspaceKeysState {
  keys: Record<string, CryptoKey>; // workspaceId -> content key, cached in memory
  searchBodies: Record<string, string>; // pageId -> decrypted plain text, for search
  searchLinks: Record<string, string[]>; // pageId -> page ids it links to (for backlinks)
  // pageId -> table ids embedded in its decrypted body. Only the orphan-table GC
  // reads this: without it an encrypted page looks like it references nothing, and a
  // table it embeds looks deletable.
  searchTables: Record<string, string[]>;
  ensure: (workspaceId: string) => Promise<CryptoKey | null>;
  encryptForPage: (page: Page, value: unknown) => Promise<string | null>;
  encryptForWorkspace: (workspaceId: string, value: unknown) => Promise<string | null>;
  decryptForPage: (page: Page, envelope: string) => Promise<unknown>;
  decryptForWorkspace: (workspaceId: string, envelope: string) => Promise<unknown>;
  // Decrypt any encrypted page titles currently in the data store into plaintext
  // (titles are encrypted by default in an encrypted workspace). No-ops when none
  // are encrypted, so it's cheap to call on every data/vault change.
  decryptTitles: () => Promise<void>;
  // For a realtime page echo: if its (envelope) title is one we already decrypted,
  // return the plaintext so the title doesn't flash "Locked"; else null.
  keepDecryptedTitle: (pageId: string, title: string) => string | null;
  // For a realtime row echo: true if this cells envelope is the one we already
  // decrypted (keep the in-memory cells), false if it changed (re-decrypt it).
  sameCellsEnvelope: (rowId: string, cellsEnc: string) => boolean;
  // Record the envelope WE just persisted for a row, so its own echo is
  // recognised as ours. AES-GCM draws a fresh IV every time, so a write always
  // produces a new envelope: without this, our own echo looks like a remote edit,
  // the decrypted cells are replaced by the blob, and setCell (which refuses a row
  // holding cellsEnc) silently drops the next edit until decryptCells catches up.
  noteCellsEnvelope: (rowId: string, cellsEnc: string) => void;
  // The row BODY twin of the two above (kanban card pop-outs / "open as page").
  sameRowBodyEnvelope: (rowId: string, contentEnc: string) => boolean;
  noteRowBodyEnvelope: (rowId: string, contentEnc: string) => void;
  // Decrypt encrypted row bodies in the store into plain TipTap docs, so every
  // reader (the row drawer, the card thumbnail, backup, kanban export) sees a doc
  // and not an opaque string. Mirrors decryptCells; no-op when nothing is encrypted.
  decryptRowBodies: () => Promise<void>;
  // Decrypt any encrypted table-row cells in the store into plaintext objects.
  decryptCells: () => Promise<void>;
  // Decrypt encrypted page bodies into plain text for the search index (the store
  // itself keeps the envelope; the editor decrypts per-page on its own).
  decryptBodies: () => Promise<void>;
  // Encrypt the page bodies already sitting in plaintext in a workspace, so old
  // content stops living unencrypted in the DB. Returns how many were converted.
  migrateWorkspace: (workspaceId: string) => Promise<number>;
  // The inverse: decrypt everything in a workspace back to plaintext (used after
  // the owner turns encryption off). Returns how many items were converted.
  decryptWorkspace: (workspaceId: string) => Promise<number>;
  // Re-run the grant pass (wrap the workspace key to any member who lacks a row and
  // whose key is trusted). Used after "verify & trust" so a member whose key just
  // became trusted gets access without waiting for the next natural ensure.
  regrantMembers: (workspaceId: string) => Promise<void>;
  clear: () => void;
}

// Which pages/rows had encrypted titles/cells in the DB. The on-load decrypt
// passes record this so a later "decrypt workspace" can re-save them as plaintext
// even after they've been decrypted in memory (which clears the envelope).
const encTitlePages = new Set<string>();
// pageId -> the title envelope we decrypted and its plaintext, so a realtime echo
// that carries the same envelope can keep the decrypted title instead of flashing
// "Locked" until the next decrypt pass. A different envelope (a rename) misses the
// cache and shows through, so renames still land.
const titleCache = new Map<string, { env: string; plain: string }>();
// rowId -> the cells envelope we last decrypted, so a realtime echo carrying the
// same envelope keeps the decrypted cells, but a new envelope (an edit on another
// device) is let through and re-decrypted.
const cellEnvCache = new Map<string, string>();
// rowId -> the body envelope we last decrypted, same contract as cellEnvCache.
const rowBodyEnvCache = new Map<string, string>();
const encCellRows = new Set<string>();
// pageId -> the content envelope we last decrypted for search, to skip unchanged.
const bodyEnvCache = new Map<string, string>();
// Stampede guards for ensure(): one in-flight resolve per workspace, publish my
// public key at most once, and a short back-off after a failure so a churning
// store (e.g. a running automation) can't hammer the key API.
const ensuring = new Map<string, Promise<CryptoKey | null>>();
const published = new Set<string>();
const ensureFailedAt = new Map<string, number>();

// Push my public key onto my membership row (once) so others can grant me.
async function publishMyPublicKey(workspaceId: string): Promise<void> {
  const me = useAuth.getState().user?.id;
  const pub = useVault.getState().publicKey;
  if (!me || !pub) return;
  const mine = useWorkspace.getState().members.find((m) => m.workspace === workspaceId && m.user === me);
  if (mine && mine.publicKey !== pub) {
    try {
      await workspaceMembersApi.setPublicKey(mine.id, pub);
    } catch {
      /* field may not exist yet; granting just won't reach this member */
    }
  }
}

export const useWorkspaceKeys = create<WorkspaceKeysState>((set, get) => ({
  keys: {},
  searchBodies: {},
  searchLinks: {},
  searchTables: {},

  ensure: async (workspaceId) => {
    if (!workspaceId) return null;
    const cached = get().keys[workspaceId];
    if (cached) return cached;
    // Share one in-flight resolution across concurrent callers (the three decrypt
    // passes fan out per item) instead of each starting its own key dance.
    const inflight = ensuring.get(workspaceId);
    if (inflight) return inflight;
    // Briefly back off after a failure so repeated data changes don't re-hammer.
    const failedAt = ensureFailedAt.get(workspaceId);
    if (failedAt && Date.now() - failedAt < 5000) return null;

    const run = (async (): Promise<CryptoKey | null> => {
      const vault = useVault.getState();
      const me = useAuth.getState().user?.id;
      if (vault.status !== 'unlocked' || !vault.privateKey || !vault.publicKey || !me) return null;

      try {
        // Publish my public key once per session, not on every ensure, a missing
        // publicKey field would otherwise loop forever via member echoes.
        if (!published.has(workspaceId)) {
          await publishMyPublicKey(workspaceId);
          published.add(workspaceId);
        }
        const rows = await workspaceKeysApi.listForWorkspace(workspaceId);
        const mine = rows.find((r) => r.user === me);

        let key: CryptoKey;
        if (mine) {
          key = await unwrapContentKeyWith(mine.wrappedKey, vault.privateKey);
        } else if (rows.length === 0) {
          // First in: mint the workspace key and wrap it to myself.
          key = await generateContentKey();
          await workspaceKeysApi.create(workspaceId, me, await wrapContentKeyFor(key, vault.publicKey));
        } else {
          // A key exists but no one has granted me yet, can't read until they do.
          ensureFailedAt.set(workspaceId, Date.now());
          return null;
        }

        set((s) => ({ keys: { ...s.keys, [workspaceId]: key } }));
        ensureFailedAt.delete(workspaceId);
        void grantToMembers(workspaceId, key, rows, me);
        return key;
      } catch (err) {
        console.error('[wskeys] ensure failed', err);
        ensureFailedAt.set(workspaceId, Date.now());
        return null;
      }
    })();
    ensuring.set(workspaceId, run);
    try {
      return await run;
    } finally {
      ensuring.delete(workspaceId);
    }
  },

  encryptForPage: async (page, value) => get().encryptForWorkspace(page.workspace ?? '', value),

  encryptForWorkspace: async (workspaceId, value) => {
    if (workspaceId) {
      const key = await get().ensure(workspaceId);
      if (key) return encryptContent(key, value);
    }
    // Legacy / default-workspace page: per-user master key.
    return useVault.getState().encrypt(value);
  },

  decryptForPage: async (page, envelope) => get().decryptForWorkspace(page.workspace ?? '', envelope),

  decryptForWorkspace: async (workspaceId, envelope) => {
    if (workspaceId) {
      try {
        const key = await get().ensure(workspaceId);
        if (key) return await decryptContent(key, envelope);
      } catch {
        /* fall through to the master key for older per-user locks */
      }
    }
    return useVault.getState().decrypt(envelope);
  },

  migrateWorkspace: async (workspaceId) => {
    const key = await get().ensure(workspaceId);
    if (!key) return 0;
    const data = useData.getState();
    const targets = Object.values(data.pages).filter((p) => (p.workspace ?? '') === workspaceId && !p.trashed);
    let count = 0;
    for (const p of targets) {
      let touched = false;
      try {
        // Body: encrypt the plaintext content.
        if (p.content && !isEnvelope(p.content)) {
          data.setPageContent(p.id, await encryptContent(key, p.content));
          // Scrub the plaintext Yjs artifacts (snapshot + relay rows) so the now-
          // encrypted page doesn't leave server-readable content behind; it re-seeds
          // encrypted from the new content on next open.
          data.resetPageCollab(p.id);
          touched = true;
        }
        // Title: re-save through renamePage, which encrypts it for the workspace
        // and keeps the in-memory title plaintext for display.
        if (p.title && !isEnvelope(p.title)) {
          data.renamePage(p.id, p.title);
          touched = true;
        }
      } catch (err) {
        console.error('[wskeys] migrate page failed', err);
      }
      if (touched) count++;
    }

    // Table rows: encrypt the secret cells of every plaintext row in this
    // workspace, leaving reminder/person fields plaintext so the cron keeps working.
    const targetRows = Object.values(data.rows).filter(
      (r) => (r.workspace ?? '') === workspaceId && !r.cellsEnc && r.cells && Object.keys(r.cells).length > 0,
    );
    for (const r of targetRows) {
      try {
        const { operational, secret } = splitCells(r.cells, data.tables[r.table]?.columns ?? []);
        if (Object.keys(secret).length === 0) continue;
        data.migrateRowCells(r.id, { ...operational, [ENC_KEY]: await encryptContent(key, secret) });
        count++;
      } catch (err) {
        console.error('[wskeys] migrate row failed', err);
      }
    }

    // Row bodies (the kanban card pop-out / "open as page" doc). These used to stay
    // plaintext forever, so a card body was readable in the DB even in an encrypted
    // workspace. Persist the envelope directly rather than through setRowContent,
    // which deliberately refuses to touch a row it is re-encrypting.
    //
    // Gated by the same switch as the per-edit write, and for a stronger reason: this
    // converts EVERY card body in the workspace in one pass. A client older than 0.176
    // would then see the whole board as empty cards and could save that emptiness
    // over them, and row bodies have no version history to recover from. Off until
    // localStorage 'waypoint:encryptrowbodies' is '1'.
    const bodiesEnabled = (() => {
      try {
        return localStorage.getItem('waypoint:encryptrowbodies') === '1';
      } catch {
        return false;
      }
    })();
    const targetBodies = !bodiesEnabled
      ? []
      : Object.values(data.rows).filter(
          (r) => (r.workspace ?? '') === workspaceId && !r.contentEnc && r.content && typeof r.content === 'object',
        );
    for (const r of targetBodies) {
      try {
        const env = await encryptContent(key, r.content as object);
        get().noteRowBodyEnvelope(r.id, env);
        data.migrateRowContent(r.id, env);
        count++;
      } catch (err) {
        console.error('[wskeys] migrate row body failed', err);
      }
    }
    return count;
  },

  decryptTitles: async () => {
    if (useVault.getState().status !== 'unlocked') return;
    const targets = Object.values(useData.getState().pages).filter((p) => !p.trashed && isEnvelope(p.title));
    if (!targets.length) return;
    const updates: Record<string, string> = {};
    for (const p of targets) {
      try {
        const env = p.title;
        const plain = await get().decryptForPage(p, env);
        if (typeof plain === 'string') {
          updates[p.id] = plain;
          encTitlePages.add(p.id);
          titleCache.set(p.id, { env, plain });
        }
      } catch {
        /* leave the envelope so displayTitle shows "Locked" and a later pass retries */
      }
    }
    if (Object.keys(updates).length) useData.getState().applyTitleDecryptions(updates);
  },

  keepDecryptedTitle: (pageId, title) => {
    if (!isEnvelope(title)) return null; // already plaintext, nothing to keep
    const cached = titleCache.get(pageId);
    return cached && cached.env === title ? cached.plain : null;
  },

  sameCellsEnvelope: (rowId, cellsEnc) => cellEnvCache.get(rowId) === cellsEnc,

  noteCellsEnvelope: (rowId, cellsEnc) => {
    if (cellsEnc) cellEnvCache.set(rowId, cellsEnc);
  },

  sameRowBodyEnvelope: (rowId, contentEnc) => rowBodyEnvCache.get(rowId) === contentEnc,

  noteRowBodyEnvelope: (rowId, contentEnc) => {
    if (contentEnc) rowBodyEnvCache.set(rowId, contentEnc);
  },

  decryptRowBodies: async () => {
    if (useVault.getState().status !== 'unlocked') return;
    const targets = Object.values(useData.getState().rows).filter((r) => r.contentEnc);
    if (!targets.length) return;
    const updates: Record<string, object> = {};
    for (const r of targets) {
      try {
        const env = r.contentEnc as string;
        const plain = await get().decryptForWorkspace(r.workspace ?? '', env);
        if (plain && typeof plain === 'object') {
          updates[r.id] = plain as object;
          rowBodyEnvCache.set(r.id, env);
        }
      } catch {
        /* leave encrypted; a later pass retries once the key is available */
      }
    }
    if (Object.keys(updates).length) useData.getState().applyRowContentDecryptions(updates);
  },

  decryptCells: async () => {
    if (useVault.getState().status !== 'unlocked') return;
    const targets = Object.values(useData.getState().rows).filter((r) => r.cellsEnc);
    if (!targets.length) return;
    const updates: Record<string, Record<string, CellValue>> = {};
    for (const r of targets) {
      try {
        const env = r.cellsEnc as string;
        const secret = await get().decryptForWorkspace(r.workspace ?? '', env);
        if (secret && typeof secret === 'object') {
          // Merge the decrypted secret back over the plaintext operational cells
          // (reminder/person fields). Legacy whole-row blobs have r.cells = {}.
          updates[r.id] = { ...r.cells, ...(secret as Record<string, CellValue>) };
          encCellRows.add(r.id);
          cellEnvCache.set(r.id, env);
        }
      } catch {
        /* leave encrypted; a later pass retries once the key is available */
      }
    }
    if (Object.keys(updates).length) useData.getState().applyCellDecryptions(updates);
  },

  decryptBodies: async () => {
    if (useVault.getState().status !== 'unlocked') return;
    const targets = Object.values(useData.getState().pages).filter(
      (p) => !p.trashed && isEnvelope(p.content) && bodyEnvCache.get(p.id) !== p.content,
    );
    if (!targets.length) return;
    const updates: Record<string, string> = {};
    const linkUpdates: Record<string, string[]> = {};
    const tableUpdates: Record<string, string[]> = {};
    for (const p of targets) {
      try {
        const plain = await get().decryptForWorkspace(p.workspace ?? '', p.content as string);
        updates[p.id] = extractPlainText(plain).replace(/\s+/g, ' ').trim();
        linkUpdates[p.id] = extractPageLinks(plain);
        // The embedded table ids, recorded here because this is the one place that
        // holds an encrypted page's doc in the clear. Without it the orphan-table GC
        // cannot see what an encrypted page references and has to assume the worst.
        tableUpdates[p.id] = extractTableIds(plain);
        bodyEnvCache.set(p.id, p.content as string);
      } catch {
        /* skip; retried on the next pass once the key is available */
      }
    }
    if (Object.keys(updates).length) {
      set((s) => ({
        searchBodies: { ...s.searchBodies, ...updates },
        searchLinks: { ...s.searchLinks, ...linkUpdates },
        searchTables: { ...s.searchTables, ...tableUpdates },
      }));
    }
  },

  // Decrypt everything in a workspace back to plaintext (toggle encryption off,
  // then run this). Re-saves through the normal write paths, which now persist
  // plaintext because the workspace is no longer encrypted.
  regrantMembers: async (workspaceId) => {
    const key = await get().ensure(workspaceId);
    const me = useAuth.getState().user?.id;
    if (!key || !me) return;
    try {
      const rows = await workspaceKeysApi.listForWorkspace(workspaceId);
      await grantToMembers(workspaceId, key, rows, me);
    } catch (err) {
      console.error('[wskeys] regrant failed', err);
    }
  },

  decryptWorkspace: async (workspaceId) => {
    const data = useData.getState();
    let count = 0;

    for (const p of Object.values(data.pages)) {
      if ((p.workspace ?? '') !== workspaceId || p.trashed) continue;
      let touched = false;
      // Content: the store holds the envelope, so isEnvelope is reliable. Only
      // write back a real decrypt; a null would wipe the page (setPageContent also
      // refuses null, this just avoids the wasted write and miscount).
      if (isEnvelope(p.content)) {
        try {
          const d = await get().decryptForWorkspace(workspaceId, p.content);
          if (d != null) {
            data.setPageContent(p.id, d);
            // Drop the encrypted Yjs artifacts so the now-plaintext page re-seeds
            // cleanly instead of carrying an encrypted shared doc it no longer needs.
            data.resetPageCollab(p.id);
            touched = true;
          }
        } catch {
          /* skip */
        }
      }
      // Title: decrypt the envelope, or re-save a known-encrypted plaintext title.
      if (isEnvelope(p.title)) {
        try {
          const t = await get().decryptForWorkspace(workspaceId, p.title);
          if (typeof t === 'string') {
            data.renamePage(p.id, t);
            touched = true;
          }
        } catch {
          /* skip */
        }
        encTitlePages.delete(p.id);
      } else if (encTitlePages.has(p.id)) {
        data.renamePage(p.id, p.title); // in-memory plaintext; re-save (encryption is off now)
        encTitlePages.delete(p.id);
        touched = true;
      }
      if (touched) count++;
    }

    for (const r of Object.values(data.rows)) {
      if ((r.workspace ?? '') !== workspaceId) continue;
      if (r.cellsEnc) {
        try {
          const secret = await get().decryptForWorkspace(workspaceId, r.cellsEnc);
          // Only merge a real decrypt; null/non-object would drop the secret cells
          // (cellsEnc cleared with nothing put back). Keep the envelope on failure.
          if (secret && typeof secret === 'object') {
            data.migrateRowCells(r.id, { ...r.cells, ...(secret as Record<string, CellValue>) });
            encCellRows.delete(r.id);
            count++;
          }
        } catch {
          /* skip */
        }
      } else if (encCellRows.has(r.id)) {
        data.migrateRowCells(r.id, r.cells); // in-memory plaintext; re-save as plaintext
        encCellRows.delete(r.id);
        count++;
      }
      // Row body: put the doc back in the clear. An envelope we cannot open is left
      // alone rather than cleared, the same rule the cells above follow.
      if (r.contentEnc) {
        try {
          const d = await get().decryptForWorkspace(workspaceId, r.contentEnc);
          if (d && typeof d === 'object') {
            data.applyRowContentDecryptions({ [r.id]: d as object });
            data.migrateRowContent(r.id, d as object);
            rowBodyEnvCache.delete(r.id);
            count++;
          }
        } catch {
          /* skip */
        }
      } else if (rowBodyEnvCache.has(r.id) && r.content) {
        data.migrateRowContent(r.id, r.content); // re-save in the clear
        rowBodyEnvCache.delete(r.id);
        count++;
      }
    }

    return count;
  },

  clear: () => {
    encTitlePages.clear();
    encCellRows.clear();
    titleCache.clear();
    cellEnvCache.clear();
    rowBodyEnvCache.clear();
    bodyEnvCache.clear();
    ensuring.clear();
    published.clear();
    ensureFailedAt.clear();
    set({ keys: {}, searchBodies: {}, searchLinks: {}, searchTables: {} });
  },
}));

// Wrap the workspace key to co-members who have a published public key but no row
// yet. Best-effort: a failure for one member doesn't block the others.
//
// Trust-on-first-use gate: a member's public key comes from the untrusted server,
// so we pin the first key we see for each member and REFUSE to wrap the workspace
// key to a member whose key has since CHANGED (a substituted key looks the same as
// a legit vault reset, so a human must re-verify via "verify & trust" in Members
// first). We still pin every member on sight here so the pin is
// captured just by using the workspace, and blocking a grant is an availability
// cost, never a leak, so this errs safe.
async function grantToMembers(
  workspaceId: string,
  key: CryptoKey,
  existing: { user: string }[],
  me: string,
): Promise<void> {
  const have = new Set(existing.map((r) => r.user));
  const members = useWorkspace.getState().members.filter((m) => m.workspace === workspaceId);
  for (const m of members) {
    if (m.user === me || !m.publicKey) continue;
    const trust = seeKey(m.user, m.publicKey); // pin on first sight (even for already-granted members)
    if (have.has(m.user)) continue; // already has the key
    if (trust === 'changed') {
      console.warn('[wskeys] skipped granting to', m.user, '- public key changed since first sight; re-verify in Members');
      continue;
    }
    try {
      await workspaceKeysApi.create(workspaceId, m.user, await wrapContentKeyFor(key, m.publicKey));
    } catch {
      /* race or rule mismatch; another member's pass will catch it */
    }
  }
}
