import { useWorkspace } from '../store/useWorkspace';
import type { Member } from '../lib/api';

// ---------------------------------------------------------------------------
// useMembers, the roster for everything that resolves user ids to names: person
// cells, the comment @-picker, share/assignment UI, mindmap person nodes.
//
// Feature 4 re-roots this to the *active workspace*: the source is now
// workspace_members (via the workspace store), not the global `users` list, so
// you can only mention/tag people in your workspace, and there's no global
// directory leak. Pre-migration the store falls back to the old global list so
// names keep resolving until the backend is applied. The signature is unchanged
// on purpose, so every existing call site re-roots for free.
// ---------------------------------------------------------------------------

export function useMembers(): Member[] {
  return useWorkspace((s) => s.roster);
}

/** Explicit variant where a caller knows the workspace it cares about. Today the
 *  store keeps a single active roster; this returns it when the id matches and
 *  otherwise an empty list (a stale id from another workspace resolves to no
 *  members, so its mentions render as plain text, never a cross-workspace link). */
export function useWorkspaceMembers(workspaceId: string | null): Member[] {
  return useWorkspace((s) => (workspaceId && workspaceId === s.activeWorkspaceId ? s.roster : []));
}
