import { create } from 'zustand';
import { pb } from '../lib/pocketbase';
import type { RecordModel } from 'pocketbase';
import {
  workspacesApi, workspaceMembersApi, workspaceInvitesApi, usersApi,
  type Member,
} from '../lib/api';
import {
  toWorkspace as toWorkspaceRecord,
  toWorkspaceMember as toMemberRecord,
  toWorkspaceInvite as toInviteRecord,
} from '../lib/api';
import type { Workspace, WorkspaceMember, WorkspaceInvite, WorkspaceRole, NumberStyle } from '../types';
import { roleInWorkspace, classifyWorkspaces, pendingInvitesFor } from '../lib/workspace';
import { beginWrite, endWrite, keepPendingFields } from '../lib/proseSync';
import { useData } from './useData';

// ---------------------------------------------------------------------------
// Workspace store (feature 4)
// ---------------------------------------------------------------------------
// The tier above pages. Holds every workspace/membership/invite the rules let
// the signed-in user see, plus which workspace is active. The page data store
// (useData) reads `activeWorkspaceId` + `defaultWorkspaceId` to scope the tree;
// create paths stamp the active workspace onto new records.
//
// Graceful pre-migration: when the three collections don't exist yet (or no
// workspace has been created), `workspacesApi.list()` throws/empties and we
// synthesize a single local default workspace so the whole app keeps working
// exactly as before, existing pages (empty `workspace`) resolve into it. Once
// the backend is applied, real workspaces take over and `usingDefault` flips off.

const DEFAULT_ID = '__default__';
const ACTIVE_KEY = 'waypoint:activeWorkspace';
const TABLETOP_KEY = (id: string) => `waypoint:ws:tabletop:${id}`;
const ENCRYPTED_KEY = (id: string) => `waypoint:ws:encrypted:${id}`;

function readTabletopMirror(id: string): boolean {
  try { return localStorage.getItem(TABLETOP_KEY(id)) === '1'; } catch { return false; }
}
function writeTabletopMirror(id: string, value: boolean) {
  try { localStorage.setItem(TABLETOP_KEY(id), value ? '1' : '0'); } catch { /* ignore */ }
}
function readEncryptedMirror(id: string): boolean {
  try { return localStorage.getItem(ENCRYPTED_KEY(id)) === '1'; } catch { return false; }
}
function writeEncryptedMirror(id: string, value: boolean) {
  try { localStorage.setItem(ENCRYPTED_KEY(id), value ? '1' : '0'); } catch { /* ignore */ }
}
const NUMBERSTYLE_KEY = (id: string) => `waypoint:ws:numstyle:${id}`;
function readNumberStyleMirror(id: string): NumberStyle {
  try { return localStorage.getItem(NUMBERSTYLE_KEY(id)) === 'standard' ? 'standard' : 'swedish'; } catch { return 'swedish'; }
}
function writeNumberStyleMirror(id: string, value: NumberStyle) {
  try { localStorage.setItem(NUMBERSTYLE_KEY(id), value); } catch { /* ignore */ }
}

// Same graceful dance the page store does for cover/map/etc.: when a workspace
// arrives without an optional field (column not added yet, so the echo wipes it),
// restore from the localStorage mirror; when the server carries a value it wins
// and refreshes the mirror. Covers both `tabletop` and `encrypted`.
function withLocalFlags(ws: Workspace): Workspace {
  const out = { ...ws };
  if (typeof ws.tabletop === 'boolean') writeTabletopMirror(ws.id, ws.tabletop);
  else out.tabletop = readTabletopMirror(ws.id);
  if (typeof ws.encrypted === 'boolean') writeEncryptedMirror(ws.id, ws.encrypted);
  else out.encrypted = readEncryptedMirror(ws.id);
  if (ws.numberStyle) writeNumberStyleMirror(ws.id, ws.numberStyle);
  else out.numberStyle = readNumberStyleMirror(ws.id);
  return out;
}

function me(): { id: string; name: string; email: string } {
  const r = pb.authStore.record;
  return {
    id: r?.id ?? '',
    name: (r?.name as string) || (r?.email as string) || 'You',
    email: (r?.email as string) ?? '',
  };
}

function syntheticDefault(): { ws: Workspace; member: WorkspaceMember } {
  const u = me();
  return {
    ws: { id: DEFAULT_ID, name: 'Workspace', icon: '🗺️', owner: u.id, created: '', updated: '' },
    member: { id: `${DEFAULT_ID}:${u.id}`, workspace: DEFAULT_ID, user: u.id, userName: u.name, role: 'admin', created: '' },
  };
}

interface WorkspaceState {
  workspaces: Workspace[];
  members: WorkspaceMember[]; // every membership the rules expose (all my workspaces' rosters)
  invites: WorkspaceInvite[];
  roster: Member[]; // the active workspace's members as {id,name,email}, for useMembers
  activeWorkspaceId: string | null;
  defaultWorkspaceId: string; // bucket for records with an empty `workspace`
  usingDefault: boolean; // true → pre-migration synthesized default
  ready: boolean;

  hydrateWorkspaces: () => Promise<void>;
  subscribeWorkspaces: () => Promise<void>;
  unsubscribeWorkspaces: () => Promise<void>;
  teardownWorkspaces: () => void;

  setActiveWorkspace: (id: string) => void;
  myRole: (workspaceId?: string) => WorkspaceRole | 'none';
  classify: () => { private: Workspace[]; shared: Workspace[] };
  tabletopEnabled: (workspaceId?: string) => boolean;
  setWorkspaceTabletop: (enabled: boolean) => Promise<void>;
  encryptedEnabled: (workspaceId?: string) => boolean;
  setWorkspaceEncrypted: (enabled: boolean, workspaceId?: string) => Promise<void>;
  numberStyle: (workspaceId?: string) => NumberStyle;
  setWorkspaceNumberStyle: (style: NumberStyle) => Promise<void>;

  createWorkspace: (name: string, icon?: string, activate?: boolean) => Promise<string | null>;
  renameWorkspace: (id: string, name: string) => Promise<void>;
  setWorkspaceIcon: (id: string, icon: string) => Promise<void>;
  deleteWorkspace: (workspaceId: string) => Promise<boolean>;
  claimMyInvites: () => Promise<string[]>;
  invite: (email: string, role: WorkspaceRole) => Promise<boolean>;
  cancelInvite: (inviteId: string) => Promise<void>;
  removeMember: (memberId: string) => Promise<void>;
  setMemberRole: (memberId: string, role: WorkspaceRole) => Promise<void>;
}

// Resolve the active workspace's roster into {id,name,email}. Pre-migration there
// are no membership rows, so fall back to the global users list (the only place
// names live yet); once real, source purely from memberships (no global roster).
async function buildRoster(members: WorkspaceMember[], activeId: string | null, usingDefault: boolean): Promise<Member[]> {
  if (usingDefault) {
    try {
      return await usersApi.listMembers();
    } catch {
      const u = me();
      return u.id ? [{ id: u.id, name: u.name, email: u.email }] : [];
    }
  }
  if (!activeId) return [];
  const seen = new Map<string, Member>();
  for (const m of members) {
    if (m.workspace === activeId && !seen.has(m.user)) seen.set(m.user, { id: m.user, name: m.userName, email: '' });
  }
  return [...seen.values()];
}

function pickActive(workspaces: Workspace[], members: WorkspaceMember[], userId: string): string {
  let stored: string | null = null;
  try { stored = localStorage.getItem(ACTIVE_KEY); } catch { stored = null; }
  const amMember = (id: string) => members.some((m) => m.workspace === id && m.user === userId);
  if (stored && workspaces.some((w) => w.id === stored) && amMember(stored)) return stored;
  const { private: priv, shared } = classifyWorkspaces(workspaces, members, userId);
  return priv[0]?.id ?? shared[0]?.id ?? workspaces[0]?.id ?? DEFAULT_ID;
}

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  workspaces: [],
  members: [],
  invites: [],
  roster: [],
  activeWorkspaceId: null,
  defaultWorkspaceId: DEFAULT_ID,
  usingDefault: true,
  ready: false,

  hydrateWorkspaces: async () => {
    const u = me();
    try {
      const [raw, members, invites] = await Promise.all([
        workspacesApi.list(),
        workspaceMembersApi.list().catch(() => [] as WorkspaceMember[]),
        workspaceInvitesApi.list().catch(() => [] as WorkspaceInvite[]),
      ]);
      // A brand-new account: the collections answered, they are simply empty.
      // Make a REAL workspace here rather than falling through to the synthetic
      // default below. The synthetic one leaves usingDefault true, which makes
      // activeWsForWrite() return '', so every page this account creates is
      // written with workspace = "" and is then invisible to every rule that
      // scopes by membership. The symptom is a first-run install that can create
      // a page and then cannot edit it, with collab stuck connecting forever.
      //
      // If the create throws (collections genuinely missing, a pre-migration
      // install) it lands in the catch below and the synthetic default still
      // covers it, which is the case that branch was written for.
      let rows = raw;
      let seats = members;
      if (!rows.length) {
        const seeded = await workspacesApi.create('Workspace', '🗺️');
        const seat = await workspaceMembersApi.create(seeded.id, u.id, u.name, 'admin');
        rows = [seeded];
        seats = [seat];
      }
      // Keep an in-flight rename/icon edit against this refetch (same guard the
      // pages/tables echoes use), so a resync mid-edit can't revert it.
      const curWs = get().workspaces;
      const workspaces = rows.map((r) => {
        const w = withLocalFlags(r);
        return keepPendingFields(curWs.find((x) => x.id === w.id), w, ['name', 'icon']);
      });

      const active = pickActive(workspaces, seats, u.id);
      // The default bucket (for legacy empty-workspace records) is the user's
      // first private workspace, else the active one.
      const { private: priv } = classifyWorkspaces(workspaces, seats, u.id);
      const defaultWorkspaceId = priv[0]?.id ?? active;
      const roster = await buildRoster(seats, active, false);
      set({ workspaces, members: seats, invites, roster, activeWorkspaceId: active, defaultWorkspaceId, usingDefault: false, ready: true });
    } catch {
      // Pre-migration (collections missing or empty): synthesize a default so
      // the app runs unchanged. Names still resolve via the global users list.
      const { ws, member } = syntheticDefault();
      const roster = await buildRoster([member], DEFAULT_ID, true);
      set({
        workspaces: [withLocalFlags(ws)], members: [member], invites: [], roster,
        activeWorkspaceId: DEFAULT_ID, defaultWorkspaceId: DEFAULT_ID, usingDefault: true, ready: true,
      });
    }
  },

  subscribeWorkspaces: async () => {
    if (get().usingDefault) return; // nothing server-side to subscribe to yet
    const refreshRoster = async () => {
      const { members, activeWorkspaceId, usingDefault } = get();
      set({ roster: await buildRoster(members, activeWorkspaceId, usingDefault) });
    };
    const upsert = <T extends { id: string }>(list: T[], rec: T, action: string) =>
      action === 'delete' ? list.filter((x) => x.id !== rec.id) : [...list.filter((x) => x.id !== rec.id), rec];
    try {
      await pb.collection('workspaces').subscribe('*', (e) => {
        const { action, record } = e as { action: string; record: RecordModel };
        set((s) => {
          // Hold an in-flight name/icon edit against a stale echo.
          const incoming = keepPendingFields(
            s.workspaces.find((w) => w.id === record.id),
            withLocalFlags(toWorkspaceRecord(record)),
            ['name', 'icon'],
          );
          return { workspaces: upsert(s.workspaces, incoming, action) };
        });
      });
      await pb.collection('workspace_members').subscribe('*', (e) => {
        const { action, record } = e as { action: string; record: RecordModel };
        set((s) => ({ members: upsert(s.members, toMemberRecord(record), action) }));
        void refreshRoster();
      });
      await pb.collection('workspace_invites').subscribe('*', (e) => {
        const { action, record } = e as { action: string; record: RecordModel };
        set((s) => ({ invites: upsert(s.invites, toInviteRecord(record), action) }));
      });
    } catch {
      // collections not present, stay on the synthesized default
    }
  },

  unsubscribeWorkspaces: async () => {
    try {
      await pb.collection('workspaces').unsubscribe('*');
      await pb.collection('workspace_members').unsubscribe('*');
      await pb.collection('workspace_invites').unsubscribe('*');
    } catch {
      // ignore
    }
  },

  teardownWorkspaces: () => {
    set({ workspaces: [], members: [], invites: [], roster: [], activeWorkspaceId: null, defaultWorkspaceId: DEFAULT_ID, usingDefault: true, ready: false });
  },

  setActiveWorkspace: (id) => {
    try { localStorage.setItem(ACTIVE_KEY, id); } catch { /* ignore */ }
    set({ activeWorkspaceId: id });
    const { members, usingDefault } = get();
    void buildRoster(members, id, usingDefault).then((roster) => set({ roster }));
  },

  myRole: (workspaceId) => {
    const id = workspaceId ?? get().activeWorkspaceId;
    if (!id) return 'none';
    if (get().usingDefault) return 'admin'; // you own your local default
    return roleInWorkspace(get().members, id, me().id);
  },

  classify: () => classifyWorkspaces(get().workspaces, get().members, me().id),

  // Whether the active (or given) workspace shows the tabletop/D&D tools. Reads
  // the workspace's flag, already filled from the mirror by withLocalFlags,
  // and falls back to the raw mirror if the workspace isn't loaded yet.
  tabletopEnabled: (workspaceId) => {
    const id = workspaceId ?? get().activeWorkspaceId;
    if (!id) return false;
    const ws = get().workspaces.find((w) => w.id === id);
    return ws?.tabletop ?? readTabletopMirror(id);
  },

  // Admin-only toggle. Optimistic + mirrored, then persisted; the synthesized
  // default workspace has no server record, so for it the mirror is the whole
  // story.
  setWorkspaceTabletop: async (enabled) => {
    const id = get().activeWorkspaceId;
    if (!id || get().myRole(id) !== 'admin') return;
    writeTabletopMirror(id, enabled);
    set((s) => ({ workspaces: s.workspaces.map((w) => (w.id === id ? { ...w, tabletop: enabled } : w)) }));
    if (get().usingDefault || id === DEFAULT_ID) return;
    try {
      await workspacesApi.update(id, { tabletop: enabled });
    } catch (err) {
      console.error('[workspace] setWorkspaceTabletop failed', err);
    }
  },

  // Rename a workspace (admins only). Optimistic, then persisted; the synthesized
  // local default has no server record, so we just keep the in-memory name.
  renameWorkspace: async (id, name) => {
    const trimmed = name.trim();
    if (!id || !trimmed || get().myRole(id) !== 'admin') return;
    set((s) => ({ workspaces: s.workspaces.map((w) => (w.id === id ? { ...w, name: trimmed } : w)) }));
    if (get().usingDefault || id === DEFAULT_ID) return;
    const seq = beginWrite(id, 'name');
    try {
      await workspacesApi.update(id, { name: trimmed });
    } catch (err) {
      console.error('[workspace] renameWorkspace failed', err);
    } finally {
      endWrite(id, 'name', seq);
    }
  },

  setWorkspaceIcon: async (id, icon) => {
    if (!id || get().myRole(id) !== 'admin') return;
    set((s) => ({ workspaces: s.workspaces.map((w) => (w.id === id ? { ...w, icon } : w)) }));
    if (get().usingDefault || id === DEFAULT_ID) return;
    const seq = beginWrite(id, 'icon');
    try {
      await workspacesApi.update(id, { icon });
    } catch (err) {
      console.error('[workspace] setWorkspaceIcon failed', err);
    } finally {
      endWrite(id, 'icon', seq);
    }
  },

  // Whether new/edited page content in this workspace is encrypted by default.
  encryptedEnabled: (workspaceId) => {
    const id = workspaceId ?? get().activeWorkspaceId;
    if (!id) return false;
    const ws = get().workspaces.find((w) => w.id === id);
    return ws?.encrypted ?? readEncryptedMirror(id);
  },

  // Defaults to the active workspace; pass an explicit id to set the flag on
  // another one (e.g. "turn into workspace" mirroring the source's encryption onto
  // the freshly created target before it re-encrypts the moved content).
  setWorkspaceEncrypted: async (enabled, workspaceId) => {
    const id = workspaceId ?? get().activeWorkspaceId;
    if (!id || get().myRole(id) !== 'admin') return;
    writeEncryptedMirror(id, enabled);
    set((s) => ({ workspaces: s.workspaces.map((w) => (w.id === id ? { ...w, encrypted: enabled } : w)) }));
    if (get().usingDefault || id === DEFAULT_ID) return;
    try {
      await workspacesApi.update(id, { encrypted: enabled });
    } catch (err) {
      console.error('[workspace] setWorkspaceEncrypted failed', err);
    }
  },

  // The decimal style for typing/parsing numbers here. Defaults to 'swedish'.
  numberStyle: (workspaceId) => {
    const id = workspaceId ?? get().activeWorkspaceId;
    if (!id) return 'swedish';
    const ws = get().workspaces.find((w) => w.id === id);
    return ws?.numberStyle ?? readNumberStyleMirror(id);
  },

  setWorkspaceNumberStyle: async (style) => {
    const id = get().activeWorkspaceId;
    if (!id || get().myRole(id) !== 'admin') return;
    writeNumberStyleMirror(id, style);
    set((s) => ({ workspaces: s.workspaces.map((w) => (w.id === id ? { ...w, numberStyle: style } : w)) }));
    if (get().usingDefault || id === DEFAULT_ID) return;
    try {
      await workspacesApi.update(id, { numberStyle: style });
    } catch (err) {
      console.error('[workspace] setWorkspaceNumberStyle failed', err);
    }
  },

  createWorkspace: async (name, icon, activate = true) => {
    const u = me();
    try {
      const ws = await workspacesApi.create(name, icon);
      // Seat the creator as the first admin.
      const member = await workspaceMembersApi.create(ws.id, u.id, u.name, 'admin');
      // Dedupe by id when adding, the realtime echo of this same row can land
      // first, and a plain spread would then list the member (and you) twice.
      set((s) => ({
        workspaces: [...s.workspaces.filter((w) => w.id !== ws.id), ws],
        members: [...s.members.filter((m) => m.id !== member.id), member],
        usingDefault: false,
      }));
      // "turn into workspace" creates the target without switching to it, so the
      // move can populate it first and land the user there at the very end.
      if (activate) get().setActiveWorkspace(ws.id);
      return ws.id;
    } catch (err) {
      console.error('[workspace] createWorkspace failed', err);
      return null;
    }
  },

  // Delete a workspace you own (the server rule is owner-only). Removes it for
  // everyone; its pages/tables become inaccessible (scoped by membership) rather
  // than deleted, so nothing is silently purged. Optimistic with rollback.
  deleteWorkspace: async (workspaceId) => {
    if (!workspaceId || workspaceId === DEFAULT_ID || get().usingDefault) return false;
    const ws = get().workspaces.find((w) => w.id === workspaceId);
    if (!ws || ws.owner !== me().id) return false;

    const snap = { workspaces: get().workspaces, members: get().members, invites: get().invites, active: get().activeWorkspaceId };
    const remaining = snap.workspaces.filter((w) => w.id !== workspaceId);
    set({
      workspaces: remaining,
      members: get().members.filter((m) => m.workspace !== workspaceId),
      invites: get().invites.filter((i) => i.workspace !== workspaceId),
    });
    if (get().activeWorkspaceId === workspaceId) get().setActiveWorkspace(remaining[0]?.id ?? DEFAULT_ID);

    try {
      // Cascade BEFORE deleting the workspace, while its id is still stamped on
      // the records, PB nulls the workspace field on delete (no DB cascade), so
      // leftover pages/members would otherwise orphan into the default bucket and
      // reappear on reload. Delete contents, then memberships/invites, then it.
      await useData.getState().purgeWorkspace(workspaceId);
      const memberIds = snap.members.filter((m) => m.workspace === workspaceId).map((m) => m.id);
      const inviteIds = snap.invites.filter((i) => i.workspace === workspaceId).map((i) => i.id);
      await Promise.allSettled([
        ...memberIds.map((id) => workspaceMembersApi.remove(id)),
        ...inviteIds.map((id) => workspaceInvitesApi.remove(id)),
      ]);
      await workspacesApi.remove(workspaceId);
      return true;
    } catch (err) {
      console.error('[workspace] deleteWorkspace failed', err);
      set({ workspaces: snap.workspaces, members: snap.members, invites: snap.invites });
      get().setActiveWorkspace(snap.active ?? DEFAULT_ID);
      return false;
    }
  },

  // Turn pending invites addressed to this account into real memberships, then
  // tidy the invite away. This runs in the browser right after sign-in so it
  // doesn't hang on a server hook firing, the membership shows up regardless.
  // The PocketBase rules are the real gate: workspace_members create only
  // succeeds when a matching pending invite exists (see pocketbase/schema.json).
  // Returns the workspace ids it claimed, so the caller can re-hydrate and land
  // the user there.
  claimMyInvites: async () => {
    const u = me();
    if (!u.id || !u.email) return [];
    let invites: WorkspaceInvite[] = [];
    try {
      invites = await workspaceInvitesApi.list();
    } catch {
      return []; // collections missing or nothing visible, nothing to claim
    }
    const mine = pendingInvitesFor(u.email, invites);
    const targets: string[] = [];
    for (const inv of mine) {
      try {
        await workspaceMembersApi.create(inv.workspace, u.id, u.name, inv.role);
      } catch (err) {
        // A unique-index hit means we're already a member (harmless, e.g. the
        // server hook beat us to it). A 403 means the workspace_members create
        // rule wasn't relaxed for invitees; that's the one to surface.
        console.error('[workspace] claim failed for invite ' + inv.id, err);
      }
      if (!targets.includes(inv.workspace)) targets.push(inv.workspace);
      try {
        await workspaceInvitesApi.remove(inv.id); // clear the pending invite
      } catch {
        /* leave it; a stale pending row is cosmetic */
      }
    }
    return targets;
  },

  invite: async (email, role) => {
    const id = get().activeWorkspaceId;
    if (!id || id === DEFAULT_ID) return false;
    try {
      const inv = await workspaceInvitesApi.create(id, email, role);
      set((s) => ({ invites: [inv, ...s.invites.filter((i) => i.id !== inv.id)] }));
      return true;
    } catch (err) {
      console.error('[workspace] invite failed', err);
      return false;
    }
  },

  cancelInvite: async (inviteId) => {
    set((s) => ({ invites: s.invites.filter((i) => i.id !== inviteId) }));
    try {
      await workspaceInvitesApi.remove(inviteId);
    } catch (err) {
      console.error('[workspace] cancelInvite failed', err);
    }
  },

  removeMember: async (memberId) => {
    set((s) => ({ members: s.members.filter((m) => m.id !== memberId) }));
    const { members, activeWorkspaceId, usingDefault } = get();
    set({ roster: await buildRoster(members, activeWorkspaceId, usingDefault) });
    try {
      await workspaceMembersApi.remove(memberId);
    } catch (err) {
      console.error('[workspace] removeMember failed', err);
    }
  },

  setMemberRole: async (memberId, role) => {
    set((s) => ({ members: s.members.map((m) => (m.id === memberId ? { ...m, role } : m)) }));
    try {
      await workspaceMembersApi.setRole(memberId, role);
    } catch (err) {
      console.error('[workspace] setMemberRole failed', err);
    }
  },
}));
