import type { Workspace, WorkspaceMember, WorkspaceInvite, WorkspaceRole } from '../types';

// ---------------------------------------------------------------------------
// Workspace, pure permission + classification logic (feature 4). No store, no
// PocketBase. The store and the invite-claiming hook call these; the load-bearing
// enforcement is the PocketBase membership rules, not this file. These functions
// are what the UI uses to decide what to *offer* and how to *group*, never the
// security boundary, which a non-member must not be able to cross even if the
// client is patched. Tested directly in scripts/tests.ts.
// ---------------------------------------------------------------------------

/** The current user's role in a workspace, or 'none' if they're not a member. */
export function roleInWorkspace(
  members: WorkspaceMember[],
  workspaceId: string,
  userId: string,
): WorkspaceRole | 'none' {
  const m = members.find((x) => x.workspace === workspaceId && x.user === userId);
  return m ? m.role : 'none';
}

export function isAdmin(role: WorkspaceRole | 'none'): boolean {
  return role === 'admin';
}

/** Admins and editors can write; viewers (and non-members) cannot. */
export function canEdit(role: WorkspaceRole | 'none'): boolean {
  return role === 'admin' || role === 'editor';
}

/** Only admins manage membership (invite / remove / change role). */
export function canInvite(role: WorkspaceRole | 'none'): boolean {
  return role === 'admin';
}

/** Distinct member count for a workspace. */
function memberCount(members: WorkspaceMember[], workspaceId: string): number {
  const users = new Set<string>();
  for (const m of members) if (m.workspace === workspaceId) users.add(m.user);
  return users.size;
}

// Split the workspaces a user belongs to into Private (just them) and Shared
// (someone else is in it too). The moment an invite is *claimed* into a second
// membership, a workspace crosses from private → shared. A pending invite alone
// doesn't move it, only a real second member does.
export function classifyWorkspaces(
  workspaces: Workspace[],
  members: WorkspaceMember[],
  userId: string,
): { private: Workspace[]; shared: Workspace[] } {
  const mine = workspaces.filter((w) => members.some((m) => m.workspace === w.id && m.user === userId));
  const priv: Workspace[] = [];
  const shared: Workspace[] = [];
  for (const w of mine) (memberCount(members, w.id) > 1 ? shared : priv).push(w);
  return { private: priv, shared };
}

/** Pending invites addressed to an email (case-insensitive), the claim-on-login
 *  path. The server hook mirrors this; the lib version is for display + tests. */
export function pendingInvitesFor(email: string, invites: WorkspaceInvite[]): WorkspaceInvite[] {
  const target = email.trim().toLowerCase();
  if (!target) return [];
  return invites.filter((i) => i.status === 'pending' && i.email.trim().toLowerCase() === target);
}

// Invites are stored lowercased so the claim-on-signin match is exact. The
// server hook compares case-insensitively too (it has legacy mixed-case rows to
// rescue), but normalizing on write keeps new invites clean. Auth emails are
// also matched case-insensitively by PocketBase, so the cases never diverge.
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

// Read an invite handoff off the auth-screen URL (`/?invite=<email>&ws=<name>`).
// The email link from invite_email.pb.js lands here; we prefill the form so the
// invitee registers/signs in with the exact address the invite was sent to,
// which is what lets the server hook claim it. `ws` is display-only.
export function readInviteFromSearch(search: string): { email: string; workspace: string } | null {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search || '');
  } catch {
    return null;
  }
  const email = (params.get('invite') || '').trim();
  if (!email || !email.includes('@')) return null;
  return { email, workspace: (params.get('ws') || '').trim() };
}

export type InviteCheck = { ok: true; email: string } | { ok: false; reason: string };

// Basic shape check + dedupe against people already in the workspace (members or
// already-pending invites). `taken` is the set of emails already present; the
// match is case-insensitive. We deliberately keep the email regex loose, PB does
// the authoritative validation; this is just to catch obvious typos before a write.
export function validateInviteEmail(raw: string, taken: Iterable<string> = []): InviteCheck {
  const email = raw.trim();
  if (!email) return { ok: false, reason: 'Enter an email address.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, reason: "That doesn't look like an email." };
  const lower = email.toLowerCase();
  for (const t of taken) {
    if (t.trim().toLowerCase() === lower) return { ok: false, reason: 'That person is already invited or a member.' };
  }
  return { ok: true, email };
}
