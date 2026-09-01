import { pb } from './pocketbase';
import { normalizeEmail } from './workspace';
import { isEnvelope } from './crypto';
import type {
  Page,
  TableData,
  TableRow,
  Comment,
  Column,
  CellValue,
  PresenceRecord,
  Workspace,
  WorkspaceMember,
  WorkspaceInvite,
  WorkspaceRole,
} from '../types';
import type { RecordModel } from 'pocketbase';

// ---------------------------------------------------------------------------
// API layer
// ---------------------------------------------------------------------------
// Thin, typed wrappers around PocketBase collection operations. Every function
// maps the loosely-typed PB RecordModel into our domain types and normalizes
// JSON fields (which PB returns already-parsed, but may be undefined on a fresh
// record). All calls can throw; callers (the store) catch and surface errors.

// --- Mappers ----------------------------------------------------------------

function toPage(r: RecordModel): Page {
  return {
    id: r.id,
    title: r.title ?? 'Untitled',
    icon: r.icon ?? '',
    parent: r.parent ?? '',
    order: typeof r.order === 'number' ? r.order : 0,
    content: r.content ?? null,
    owner: r.owner ?? '',
    workspace: typeof r.workspace === 'string' && r.workspace ? r.workspace : undefined,
    trashed: r.trashed === true,
    visibility: r.visibility === 'private' ? 'private' : 'workspace',
    publicToken: typeof r.publicToken === 'string' && r.publicToken ? r.publicToken : undefined,
    editors: Array.isArray(r.editors) ? (r.editors as string[]) : [],
    viewers: Array.isArray(r.viewers) ? (r.viewers as string[]) : [],
    template: r.template === true,
    cover: r.cover ?? '',
    map: r.map && typeof r.map === 'object' ? (r.map as Page['map']) : null,
    mindmap: r.mindmap && typeof r.mindmap === 'object' ? (r.mindmap as Page['mindmap']) : null,
    flow: r.flow && typeof r.flow === 'object' ? (r.flow as Page['flow']) : null,
    kanban: r.kanban && typeof r.kanban === 'object' ? (r.kanban as Page['kanban']) : null,
    tierlist: r.tierlist && typeof r.tierlist === 'object' ? (r.tierlist as Page['tierlist']) : null,
    rates: r.rates && typeof r.rates === 'object' ? (r.rates as Page['rates']) : null,
    sheet: r.sheet && typeof r.sheet === 'object' ? (r.sheet as Page['sheet']) : null,
    cards: r.cards && typeof r.cards === 'object' ? (r.cards as Page['cards']) : null,
    rota: r.rota && typeof r.rota === 'object' ? (r.rota as Page['rota']) : null,
    bracket: r.bracket && typeof r.bracket === 'object' ? (r.bracket as Page['bracket']) : null,
    photos: Array.isArray(r.photos) ? (r.photos as Page['photos']) : [],
    files: Array.isArray(r.files) ? (r.files as Page['files']) : [],
    defaultTab: typeof r.defaultTab === 'string' ? r.defaultTab : '',
    updated: r.updated,
    created: r.created,
  };
}

function toTable(r: RecordModel): TableData {
  return {
    id: r.id,
    name: r.name ?? 'Untitled table',
    columns: Array.isArray(r.columns) ? (r.columns as Column[]) : [],
    views: r.views && typeof r.views === 'object' ? (r.views as object) : null,
    automations: Array.isArray(r.automations) ? (r.automations as TableData['automations']) : null,
    formKey: typeof r.formKey === 'string' ? r.formKey : undefined,
    owner: r.owner ?? '',
    workspace: typeof r.workspace === 'string' && r.workspace ? r.workspace : undefined,
    updated: r.updated,
    created: r.created,
  };
}

function toRow(r: RecordModel): TableRow {
  // Encrypted rows keep the operational fields (reminder/person/__notified) as
  // plaintext keys and the rest under `__enc`. Older rows may carry the whole
  // cells object as a bare `enc:v1:` string. Either way the envelope goes aside
  // (cellsEnc) and the secret fills in once the store decrypts it.
  let cellsEnc: string | undefined;
  let cells: Record<string, CellValue> = {};
  if (typeof r.cells === 'string' && isEnvelope(r.cells)) {
    cellsEnc = r.cells;
  } else if (r.cells && typeof r.cells === 'object') {
    cells = { ...(r.cells as Record<string, CellValue>) };
    const enc = (cells as Record<string, unknown>).__enc;
    if (typeof enc === 'string' && isEnvelope(enc)) {
      cellsEnc = enc;
      delete (cells as Record<string, unknown>).__enc;
    }
  }
  return {
    id: r.id,
    table: r.table ?? '',
    workspace: typeof r.workspace === 'string' && r.workspace ? r.workspace : undefined,
    parent: r.parent ?? '',
    cellsEnc,
    cells,
    // A row body in an encrypted workspace arrives as an `enc:v1:` string. It has to
    // go aside rather than be coerced to null, or the store would show an empty body
    // and the row-detail editor would save that emptiness back over the ciphertext.
    content: (r.content && typeof r.content === 'object' ? r.content : null) as object | null,
    contentEnc: typeof r.content === 'string' && isEnvelope(r.content) ? r.content : undefined,
    // `reactions` may not be in the schema yet, null when absent, restored from
    // localStorage by the store (see withLocalReactions) until the field exists.
    reactions: r.reactions && typeof r.reactions === 'object' ? (r.reactions as TableRow['reactions']) : null,
    position: typeof r.position === 'number' ? r.position : 0,
    created: r.created,
    updated: r.updated,
  };
}

function toComment(r: RecordModel): Comment {
  return {
    id: r.id,
    page: r.page ?? '',
    row: r.row ?? '',
    thread: r.thread ?? '',
    author: r.author ?? '',
    authorName: r.authorName ?? 'Someone',
    body: r.body ?? '',
    mentions: Array.isArray(r.mentions) ? (r.mentions as string[]) : [],
    created: r.created,
    updated: r.updated,
  };
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

// --- Pages ------------------------------------------------------------------

export const pagesApi = {
  async list(): Promise<Page[]> {
    const records = await pb.collection('pages').getFullList({ sort: 'order' });
    return records.map(toPage);
  },
  async create(data: Partial<Page>): Promise<Page> {
    const rec = await pb.collection('pages').create({
      title: data.title ?? 'Untitled',
      icon: data.icon ?? '📄',
      parent: data.parent ?? '',
      order: data.order ?? 0,
      content: data.content ?? null,
      owner: pb.authStore.record?.id ?? '',
      trashed: false,
      visibility: 'workspace',
      editors: [],
      viewers: [],
      template: data.template ?? false,
      cover: data.cover ?? '',
      ...(data.workspace ? { workspace: data.workspace } : {}),
      ...(data.publicToken ? { publicToken: data.publicToken } : {}),
    });
    return toPage(rec);
  },
  async update(id: string, patch: Partial<Page>): Promise<Page> {
    const rec = await pb.collection('pages').update(id, patch);
    return toPage(rec);
  },
  async remove(id: string): Promise<void> {
    await pb.collection('pages').delete(id);
  },
  // Fetch a single page by its public token, no account needed. Works once the
  // pages view/list rule allows `publicToken = @request.query.token`. Returns
  // null if the token is wrong or the rule isn't set.
  async getPublic(token: string): Promise<Page | null> {
    try {
      const rec = await pb
        .collection('pages')
        .getFirstListItem(pb.filter('publicToken = {:t}', { t: token }), { query: { token } });
      return toPage(rec);
    } catch {
      return null;
    }
  },
};

// --- Uploads (optional) -----------------------------------------------------

// Full-size files live in a dedicated `uploads` collection (one `file` field)
// instead of being base64'd into the page, so images keep their real resolution
// and the document stays small. The collection is optional: if it isn't set up,
// upload() returns null and callers fall back to the inline data-URL path.
//
// Collection to add in PocketBase: name `uploads`, a `file` field (single,
// images + pdf, generous max size), createRule `@request.auth.id != ""`, and a
// public viewRule ("" or `@request.auth.id != ""`) so the URL loads.
// The workspace new uploads are stamped with. Module state (like proseSync's)
// rather than a parameter, because upload() has ~15 call sites and every one of
// them wants the same answer: the workspace you are currently in. An unstamped
// record can never be deleted through the app (the delete rule requires a
// workspace), so stamping has to happen everywhere or not at all.
let uploadWorkspace = '';
export function setUploadWorkspace(id: string): void {
  uploadWorkspace = id || '';
}

export const uploadsApi = {
  async upload(file: File): Promise<string | null> {
    // Never store SVG as a served file. An SVG can carry script; served from our
    // own origin and opened directly it could run in that origin. Returning null
    // makes the caller inline it as a data URL instead, which renders in an <img>
    // (no script execution) and doesn't depend on how the file host sets headers.
    if (file.type === 'image/svg+xml') return null;
    try {
      const fd = new FormData();
      fd.append('file', file);
      // Ownership, so an admin can delete this file later. PocketBase drops
      // unknown fields silently, so this is a no-op until the reconciler adds
      // them, exactly like every other optional field here.
      if (uploadWorkspace) fd.append('workspace', uploadWorkspace);
      const me = pb.authStore.record?.id;
      if (me) fd.append('owner', me);
      const rec = await pb.collection('uploads').create(fd);
      const name = rec.file as string;
      if (!name) return null;
      // Build the URL directly so it doesn't depend on the SDK's getUrl/getURL name.
      return `${pb.baseURL}/api/files/${rec.collectionId}/${rec.id}/${name}`;
    } catch (err) {
      // Collection missing, rule blocked it, or the file is over the field's
      // maxSize. Callers fall back to the inline path, which has a much smaller
      // ceiling, so log the real reason rather than letting the fallback's error
      // stand in for it.
      console.error('[uploads] upload failed', file.name, file.size, err);
      return null;
    }
  },
};

export interface PageVersion {
  id: string;
  page: string;
  content: unknown; // page content as stored (object, or an envelope string for encrypted)
  created: string;
}

// Page backups. Content is JSON-encoded so both a plaintext doc and an encrypted
// envelope round-trip; the server only ever sees what the page itself stores.
export const versionsApi = {
  async create(page: string, workspace: string, content: unknown): Promise<void> {
    await pb.collection('page_versions').create({ page, workspace, content: JSON.stringify(content) });
  },
  async listForPage(page: string): Promise<PageVersion[]> {
    const recs = await pb.collection('page_versions').getFullList({ filter: `page="${page}"`, sort: '-created' });
    return recs.map((r) => {
      const rec = r as unknown as { id: string; page: string; content?: string; created: string };
      let content: unknown = null;
      try {
        content = JSON.parse(rec.content ?? 'null');
      } catch {
        /* leave null */
      }
      return { id: rec.id, page: rec.page, content, created: rec.created };
    });
  },
  async remove(id: string): Promise<void> {
    await pb.collection('page_versions').delete(id);
  },
};

// --- Tables -----------------------------------------------------------------

export const tablesApi = {
  async list(): Promise<TableData[]> {
    const records = await pb.collection('tables').getFullList({ sort: 'created' });
    return records.map(toTable);
  },
  async create(data: Partial<TableData>): Promise<TableData> {
    const rec = await pb.collection('tables').create({
      name: data.name ?? 'Untitled table',
      columns: data.columns ?? [],
      // Optional: PB silently drops it if the field isn't in the schema yet; the
      // store mirrors it to localStorage so form tables stay discoverable.
      ...(data.formKey ? { formKey: data.formKey } : {}),
      ...(data.workspace ? { workspace: data.workspace } : {}),
      owner: pb.authStore.record?.id ?? '',
    });
    return toTable(rec);
  },
  async update(id: string, patch: Partial<TableData>): Promise<TableData> {
    const rec = await pb.collection('tables').update(id, patch);
    return toTable(rec);
  },
  async remove(id: string): Promise<void> {
    await pb.collection('tables').delete(id);
  },
};

// --- Rows -------------------------------------------------------------------

// Writes accept cells as the plain object OR an `enc:v1:` envelope string (the
// whole cells object encrypted), so the JSON field can hold either form. The body
// takes the same pair, for the same reason.
type RowWrite = Partial<Omit<TableRow, 'cells' | 'content'>> & {
  cells?: Record<string, CellValue> | string;
  content?: object | string | null;
};

export const rowsApi = {
  async list(): Promise<TableRow[]> {
    const records = await pb.collection('table_rows').getFullList({ sort: 'position' });
    return records.map(toRow);
  },
  async create(data: RowWrite): Promise<TableRow> {
    const rec = await pb.collection('table_rows').create({
      table: data.table ?? '',
      ...(data.workspace ? { workspace: data.workspace } : {}),
      parent: data.parent ?? '',
      cells: data.cells ?? {},
      position: data.position ?? 0,
    });
    return toRow(rec);
  },
  async update(id: string, patch: RowWrite): Promise<TableRow> {
    const rec = await pb.collection('table_rows').update(id, patch);
    return toRow(rec);
  },
  async remove(id: string): Promise<void> {
    await pb.collection('table_rows').delete(id);
  },
};

// --- Comments ---------------------------------------------------------------

export const commentsApi = {
  async listForPage(pageId: string): Promise<Comment[]> {
    const records = await pb.collection('comments').getFullList({
      filter: pb.filter('page = {:page}', { page: pageId }),
      sort: 'created',
    });
    // Keep page-level threads separate from row threads and inline (text) threads.
    return records.map(toComment).filter((c) => !c.row && !c.thread);
  },
  async listForRow(rowId: string): Promise<Comment[]> {
    const records = await pb.collection('comments').getFullList({
      filter: pb.filter('row = {:row}', { row: rowId }),
      sort: 'created',
    });
    return records.map(toComment);
  },
  // Every inline-thread comment on a page (those with a thread id), for counts.
  async listThreadsForPage(pageId: string): Promise<Comment[]> {
    const records = await pb.collection('comments').getFullList({
      filter: pb.filter('page = {:page}', { page: pageId }),
      sort: 'created',
    });
    return records.map(toComment).filter((c) => !!c.thread);
  },
  // Comments anchored to a highlighted span (an inline thread on a page).
  async listForThread(threadId: string): Promise<Comment[]> {
    if (!threadId) return [];
    const records = await pb.collection('comments').getFullList({
      filter: pb.filter('thread = {:thread}', { thread: threadId }),
      sort: 'created',
    });
    return records.map(toComment);
  },
  async create(pageId: string, body: string, mentions: string[] = [], rowId = '', thread = ''): Promise<Comment> {
    const user = pb.authStore.record;
    const rec = await pb.collection('comments').create({
      page: pageId,
      row: rowId,
      thread,
      author: user?.id ?? '',
      authorName: (user?.name as string) || (user?.email as string) || 'Someone',
      body,
      mentions,
    });
    return toComment(rec);
  },
  // Comments anywhere in the workspace that @-mention a given user (newest first).
  async listMentioning(userId: string): Promise<Comment[]> {
    if (!userId) return [];
    const records = await pb.collection('comments').getList(1, 40, {
      filter: pb.filter('mentions ~ {:uid}', { uid: userId }),
      sort: '-created',
    });
    return records.items.map(toComment);
  },
  async remove(id: string): Promise<void> {
    await pb.collection('comments').delete(id);
  },
};

// --- Presence ---------------------------------------------------------------
// We keep a single presence record per (user, page-session). On entering a page
// the client upserts its record; a heartbeat keeps it fresh; stale records
// (older than the TTL) are treated as gone by the UI.

export const presenceApi = {
  async listForPage(pageId: string): Promise<PresenceRecord[]> {
    const records = await pb.collection('presence').getFullList({
      filter: pb.filter('page = {:page}', { page: pageId }),
    });
    return records.map(toPresence);
  },
  async upsert(
    existingId: string | null,
    pageId: string,
    mode: 'viewing' | 'editing',
    extra?: { cursor?: string; focus?: string },
  ): Promise<PresenceRecord> {
    const user = pb.authStore.record;
    const payload = {
      page: pageId,
      user: user?.id ?? '',
      userName: (user?.name as string) || (user?.email as string) || 'Someone',
      mode,
      heartbeat: new Date().toISOString(),
      // Optional; PocketBase drops these if the fields aren't in the schema yet,
      // so cursors/badges just no-op until the fields are added (graceful).
      ...(extra?.cursor !== undefined ? { cursor: extra.cursor } : {}),
      ...(extra?.focus !== undefined ? { focus: extra.focus } : {}),
    };
    const rec = existingId
      ? await pb.collection('presence').update(existingId, payload)
      : await pb.collection('presence').create(payload);
    return toPresence(rec);
  },

  // Sweep MY OWN dead presence rows on ANY page (keeping `keepId`). A hard refresh
  // or crash leaves the old session's row behind (cleanup only runs on clean
  // unmount), so they pile up: the user shows as several avatars AND lingers on
  // pages they've left ("in two places at once"). Only rows with a STALE heartbeat
  // are deleted, so a genuine second live tab (fresh heartbeat) is never touched.
  // These are my own rows, so the heartbeat is on my own clock (no cross-device
  // skew). Best-effort; the delete rule only permits own rows.
  async pruneMyStale(keepId: string): Promise<void> {
    const uid = pb.authStore.record?.id;
    if (!uid) return;
    try {
      const mine = await pb.collection('presence').getFullList<{ id: string; heartbeat?: string }>({ filter: `user="${uid}"` });
      const cutoff = Date.now() - 60_000; // clearly dead: older than a minute
      await Promise.all(
        mine
          .filter((r) => r.id !== keepId && (!r.heartbeat || Date.parse(r.heartbeat) < cutoff))
          .map((r) => pb.collection('presence').delete(r.id).catch(() => {})),
      );
    } catch {
      /* offline / racing another tab; harmless */
    }
  },
  async remove(id: string): Promise<void> {
    try {
      await pb.collection('presence').delete(id);
    } catch {
      // Best-effort cleanup; a leftover record ages out via heartbeat TTL.
    }
  },
  // All presence records across the workspace (any page), for the member roster.
  async listAll(): Promise<PresenceRecord[]> {
    const records = await pb.collection('presence').getFullList();
    return records.map(toPresence);
  },
};

// --- Members ----------------------------------------------------------------
// Lists everyone in the workspace. Requires the `users` list rule to allow it
// (e.g. `@request.auth.id != ""`). If the rule is restrictive, this returns
// only the current user (or throws), and the caller falls back to a
// presence-derived roster.

export interface Member {
  id: string;
  name: string;
  email: string;
}

export const usersApi = {
  async listMembers(): Promise<Member[]> {
    const records = await pb.collection('users').getFullList({ sort: 'created' });
    return records.map((r) => ({
      id: r.id,
      name: (r.name as string) || (r.email as string) || 'Member',
      email: (r.email as string) ?? '',
    }));
  },
};

export { toPage, toTable, toRow, toComment, toPresence };
export { toWorkspace, toWorkspaceMember, toWorkspaceInvite };

// --- User keys (end-to-end encryption) --------------------------------------
// One row per user, holding only wrapped (encrypted) copies of their master key.
// The server stores ciphertext; it never sees the key in usable form. Rules let
// each user touch only their own row. Throws (caught by the vault store) when the
// collection doesn't exist yet, encryption is simply unavailable until applied.

export interface UserKeyRecord {
  id: string;
  user: string;
  wrappedKey: string;
  pwSalt: string;
  recoveryKey: string;
  recoverySalt: string;
  iterations: number;
  publicKey: string; // ECDH public key (plaintext) for shared-workspace key wrapping
  wrappedPrivateKey: string; // ECDH private key, wrapped by the master key
}

function toUserKey(r: RecordModel): UserKeyRecord {
  return {
    id: r.id,
    user: r.user ?? '',
    wrappedKey: r.wrappedKey ?? '',
    pwSalt: r.pwSalt ?? '',
    recoveryKey: r.recoveryKey ?? '',
    recoverySalt: r.recoverySalt ?? '',
    iterations: typeof r.iterations === 'number' ? r.iterations : 0,
    publicKey: r.publicKey ?? '',
    wrappedPrivateKey: r.wrappedPrivateKey ?? '',
  };
}

export const userKeysApi = {
  async getMine(userId: string): Promise<UserKeyRecord | null> {
    if (!userId) return null;
    try {
      const rec = await pb.collection('user_keys').getFirstListItem(pb.filter('user = {:u}', { u: userId }));
      return toUserKey(rec);
    } catch {
      // No row, or the collection isn't applied yet.
      return null;
    }
  },
  async create(data: Omit<UserKeyRecord, 'id'>): Promise<UserKeyRecord> {
    const rec = await pb.collection('user_keys').create(data);
    return toUserKey(rec);
  },
  async update(id: string, patch: Partial<UserKeyRecord>): Promise<UserKeyRecord> {
    const rec = await pb.collection('user_keys').update(id, patch);
    return toUserKey(rec);
  },
};

// --- Workspaces (feature 4) -------------------------------------------------
// Three collections gate everything: `workspaces`, `workspace_members` (the
// roster + permission source), `workspace_invites` (pending email invites,
// claimed into a membership by a server hook). All list/get calls are narrowed
// by the PocketBase rules to workspaces the requester belongs to, the client
// just consumes what comes back. When the collections don't exist yet (pre-
// migration) these throw, and the store falls back to a synthesized default
// workspace so the app keeps working.

function toWorkspace(r: RecordModel): Workspace {
  return {
    id: r.id,
    name: r.name ?? 'Workspace',
    icon: r.icon ?? '',
    owner: r.owner ?? '',
    // Absent (field not in the schema yet) → undefined, so the store can restore
    // the value from its localStorage mirror; a real boolean from the server wins.
    tabletop: typeof r.tabletop === 'boolean' ? r.tabletop : undefined,
    encrypted: typeof r.encrypted === 'boolean' ? r.encrypted : undefined,
    numberStyle: r.numberStyle === 'standard' || r.numberStyle === 'swedish' ? r.numberStyle : undefined,
    created: r.created,
    updated: r.updated,
  };
}

function toWorkspaceMember(r: RecordModel): WorkspaceMember {
  return {
    id: r.id,
    workspace: r.workspace ?? '',
    user: r.user ?? '',
    userName: r.userName ?? 'Member',
    role: r.role === 'admin' || r.role === 'editor' ? r.role : 'viewer',
    publicKey: typeof r.publicKey === 'string' && r.publicKey ? r.publicKey : undefined,
    created: r.created,
  };
}

function toWorkspaceInvite(r: RecordModel): WorkspaceInvite {
  return {
    id: r.id,
    workspace: r.workspace ?? '',
    email: r.email ?? '',
    role: r.role === 'admin' || r.role === 'viewer' ? r.role : 'editor',
    invitedBy: r.invitedBy ?? '',
    status: r.status === 'accepted' ? 'accepted' : 'pending',
    created: r.created,
  };
}

export const workspacesApi = {
  async list(): Promise<Workspace[]> {
    const records = await pb.collection('workspaces').getFullList({ sort: 'created' });
    return records.map(toWorkspace);
  },
  async create(name: string, icon = '🗺️'): Promise<Workspace> {
    const rec = await pb.collection('workspaces').create({
      name: name || 'Workspace',
      icon,
      owner: pb.authStore.record?.id ?? '',
    });
    return toWorkspace(rec);
  },
  async update(id: string, patch: Partial<Workspace>): Promise<Workspace> {
    const rec = await pb.collection('workspaces').update(id, patch);
    return toWorkspace(rec);
  },
  async remove(id: string): Promise<void> {
    await pb.collection('workspaces').delete(id);
  },
};

export const workspaceMembersApi = {
  // All membership rows the requester can see, the rules limit this to
  // workspaces they belong to, so it doubles as "my workspaces' rosters".
  async list(): Promise<WorkspaceMember[]> {
    const records = await pb.collection('workspace_members').getFullList({ sort: 'created' });
    return records.map(toWorkspaceMember);
  },
  // Used by createWorkspace to seat the creator as the first admin.
  async create(workspace: string, user: string, userName: string, role: WorkspaceRole): Promise<WorkspaceMember> {
    const rec = await pb.collection('workspace_members').create({ workspace, user, userName, role });
    return toWorkspaceMember(rec);
  },
  async setRole(id: string, role: WorkspaceRole): Promise<void> {
    await pb.collection('workspace_members').update(id, { role });
  },
  // Self-publish my ECDH public key onto my membership so co-members can wrap the
  // workspace key to me. Tolerant if the field isn't in the schema yet.
  async setPublicKey(id: string, publicKey: string): Promise<void> {
    await pb.collection('workspace_members').update(id, { publicKey });
  },
  async remove(id: string): Promise<void> {
    await pb.collection('workspace_members').delete(id);
  },
};

// --- Workspace keys (shared-workspace encryption) ---------------------------
// One row per (workspace, member): the workspace's symmetric content key, wrapped
// to that member's public key. Any member can list the rows (each blob is only
// usable by its own recipient) and create rows (to bootstrap or grant). Throws
// when the collection isn't applied yet, the caller falls back to plaintext.

export interface WorkspaceKeyRecord {
  id: string;
  workspace: string;
  user: string;
  wrappedKey: string;
}

function toWorkspaceKey(r: RecordModel): WorkspaceKeyRecord {
  return { id: r.id, workspace: r.workspace ?? '', user: r.user ?? '', wrappedKey: r.wrappedKey ?? '' };
}

export const workspaceKeysApi = {
  async listForWorkspace(workspaceId: string): Promise<WorkspaceKeyRecord[]> {
    const records = await pb.collection('workspace_keys').getFullList({
      filter: pb.filter('workspace = {:w}', { w: workspaceId }),
    });
    return records.map(toWorkspaceKey);
  },
  async create(workspace: string, user: string, wrappedKey: string): Promise<WorkspaceKeyRecord> {
    const rec = await pb.collection('workspace_keys').create({ workspace, user, wrappedKey });
    return toWorkspaceKey(rec);
  },
  // Used when reverting a "turn into workspace": the created workspace's key rows
  // are dropped along with it. Best-effort (an orphan row is harmless: it references
  // a deleted workspace no one ensures against).
  async remove(id: string): Promise<void> {
    await pb.collection('workspace_keys').delete(id);
  },
};

export const workspaceInvitesApi = {
  async list(): Promise<WorkspaceInvite[]> {
    const records = await pb.collection('workspace_invites').getFullList({ sort: '-created' });
    return records.map(toWorkspaceInvite);
  },
  async create(workspace: string, email: string, role: WorkspaceRole): Promise<WorkspaceInvite> {
    const rec = await pb.collection('workspace_invites').create({
      workspace,
      // Lowercase so the claim-on-signin hook matches the registered email exactly.
      email: normalizeEmail(email),
      role,
      invitedBy: pb.authStore.record?.id ?? '',
      status: 'pending',
    });
    return toWorkspaceInvite(rec);
  },
  async remove(id: string): Promise<void> {
    await pb.collection('workspace_invites').delete(id);
  },
};

// ---- File trash -------------------------------------------------------------
// A member who removes a file cannot delete the blob (the uploads delete rule is
// scoped to the owning workspace and they may not be an admin), so the removal is
// queued here for an admin to clear. This collection doubles as the notification:
// an admin's client lists pending rows for the workspaces it administers. The
// in-app bell could not carry it, being per-tab module state that never leaves
// the device.
export interface TrashedFile {
  id: string;
  workspace: string;
  url: string;
  name: string;
  page: string;
  removedBy: string;
  removedByName: string;
  status: string;
}

function toTrashed(r: RecordModel): TrashedFile {
  return {
    id: r.id,
    workspace: (r.workspace as string) ?? '',
    url: (r.url as string) ?? '',
    name: (r.name as string) ?? '',
    page: (r.page as string) ?? '',
    removedBy: (r.removedBy as string) ?? '',
    removedByName: (r.removedByName as string) ?? '',
    status: (r.status as string) ?? 'pending',
  };
}

export const fileTrashApi = {
  async listPending(workspace: string): Promise<TrashedFile[]> {
    if (!workspace) return [];
    try {
      const rows = await pb.collection('file_trash').getFullList({
        filter: `workspace = "${workspace}" && status = "pending"`,
        sort: '-created',
      });
      return rows.map(toTrashed);
    } catch {
      return []; // collection missing: the feature degrades to nothing, as usual
    }
  },
  async add(entry: Omit<TrashedFile, 'id' | 'status'>): Promise<TrashedFile | null> {
    try {
      const rec = await pb.collection('file_trash').create({ ...entry, status: 'pending' });
      return toTrashed(rec);
    } catch (err) {
      console.error('[file_trash] queue failed', err);
      return null;
    }
  },
  async remove(id: string): Promise<void> {
    await pb.collection('file_trash').delete(id);
  },
};

/** Every uploaded file stamped with this workspace. Needs the workspace-scoped
 *  list rule; returns [] where the rule is still locked or the field is absent,
 *  so the panel degrades to empty rather than erroring. */
export interface StoredUpload {
  id: string;
  url: string;
  name: string;
  size: number;
  created: string;
}

/** null means the listing FAILED (rule refused, collection missing), which is a
 *  different thing from an empty workspace and has to be shown differently, or
 *  a permissions problem reads as "you have no files". */
export async function listWorkspaceUploads(workspace: string): Promise<StoredUpload[] | null> {
  if (!workspace) return [];
  try {
    const rows = await pb.collection('uploads').getFullList({
      filter: `workspace = "${workspace}"`,
      sort: '-created',
    });
    return rows.map((r) => {
      const file = (r.file as string) ?? '';
      return {
        id: r.id,
        url: `${pb.baseURL}/api/files/${r.collectionId}/${r.id}/${file}`,
        name: file,
        size: 0,
        created: r.created as string,
      };
    });
  } catch (err) {
    console.error('[uploads] list failed', err);
    return null;
  }
}

export async function deleteUpload(id: string): Promise<void> {
  await pb.collection('uploads').delete(id);
}
