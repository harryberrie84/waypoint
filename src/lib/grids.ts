import type { Page, TableData } from '../types';
import { extractTableIds } from './doc';

// grids, group the workspace's tables ("grids") by the page they're embedded on,
// with the current page's grids pulled out first, for the Custom count picker.
// Trashed pages (and off-tree shared copies) are skipped so their grids don't
// show. A grid embedded on several pages is listed once, under the first page.

export interface GridRef {
  tableId: string;
  tableName: string;
}
export interface GridGroup {
  pageId: string;
  pageTitle: string;
  grids: GridRef[];
}

export function gridsByPage(
  pages: Record<string, Page>,
  tables: Record<string, TableData>,
  workspaceId: string,
  currentPageId: string | null,
): { current: GridRef[]; others: GridGroup[] } {
  const seen = new Set<string>();
  const gridsOn = (p: Page): GridRef[] => {
    const out: GridRef[] = [];
    for (const tid of extractTableIds(p.content)) {
      if (seen.has(tid)) continue;
      const t = tables[tid];
      if (!t) continue;
      seen.add(tid);
      out.push({ tableId: tid, tableName: t.name || 'Untitled table' });
    }
    return out;
  };

  // Current page first, so its grids claim their ids before the other pages.
  const cur = currentPageId ? pages[currentPageId] : undefined;
  const current = cur && !cur.trashed ? gridsOn(cur) : [];

  const others: GridGroup[] = [];
  const rest = Object.values(pages)
    .filter((p) => p.id !== currentPageId && !p.trashed && p.parent !== '__shared__' && (p.workspace ?? '') === (workspaceId ?? ''))
    .sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  for (const p of rest) {
    const grids = gridsOn(p);
    if (grids.length) others.push({ pageId: p.id, pageTitle: p.title || 'Untitled', grids });
  }
  return { current, others };
}
