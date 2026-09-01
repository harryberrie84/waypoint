// Page-level permission logic, lifted out of the store so it is unit-testable and
// can sit next to the server rules it mirrors. Pure: a page (and ids) in, a role
// or a boolean out. The server enforces the same predicate in the `pages`
// list/view/update/delete rules (see the 1700000010 migration); this is the
// client mirror used to gate the UI.

import type { Page, PageRole } from '../types';

/**
 * The effective role `userId` has on `pageId`. Mirrors the server rules exactly:
 * the owner always wins; membership in the page's `editors` or `viewers` grants
 * that role; otherwise a 'workspace' page is editable by any member and a
 * 'private' page is 'none'.
 */
export function selectMyRole(
  pages: Record<string, Page>,
  pageId: string | null,
  userId: string | null,
): PageRole {
  if (!pageId) return 'none';
  const page = pages[pageId];
  if (!page) return 'none';
  if (userId && page.owner === userId) return 'owner';
  if (userId && page.editors.includes(userId)) return 'editor';
  if (userId && page.viewers.includes(userId)) return 'viewer';
  return page.visibility === 'private' ? 'none' : 'editor';
}

export function canEdit(role: PageRole): boolean {
  return role === 'owner' || role === 'editor';
}

export function canManageSharing(role: PageRole): boolean {
  return role === 'owner';
}
