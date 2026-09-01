import { ChevronRight } from 'lucide-react';
import { useData, selectBreadcrumb } from '../store/useData';
import { PageIcon } from './PageIcon';

// Breadcrumb, renders the path from the workspace root to the active page.
export function Breadcrumb() {
  const pages = useData((s) => s.pages);
  const activePageId = useData((s) => s.activePageId);
  const setActivePage = useData((s) => s.setActivePage);

  const trail = selectBreadcrumb(pages, activePageId);
  if (trail.length === 0) return null;

  return (
    <div className="flex min-w-0 items-center gap-1 overflow-x-auto text-sm">
      {trail.map((p, i) => {
        const isLast = i === trail.length - 1;
        return (
          <div key={p.id} className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => setActivePage(p.id)}
              className={[
                'flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors',
                isLast
                  ? 'font-medium text-ink dark:text-coal-text'
                  : 'text-ink-faint hover:bg-paper-panel hover:text-ink-soft dark:text-coal-soft dark:hover:bg-coal-line',
              ].join(' ')}
            >
              <span className="flex items-center text-[13px] leading-none">
                <PageIcon icon={p.icon} fallback="" size="h-3.5 w-3.5" />
              </span>
              <span className="max-w-[14rem] truncate">{p.title || 'Untitled'}</span>
            </button>
            {!isLast && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-faint dark:text-coal-soft" />}
          </div>
        );
      })}
    </div>
  );
}
