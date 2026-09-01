import { useState } from 'react';
import { Trash2, RotateCcw, X, Check } from 'lucide-react';
import { useData, selectTrashRoots } from '../store/useData';
import { displayTitle } from '../lib/crypto';
import { PageIcon } from './PageIcon';

// TrashPanel, modal listing the roots of trashed subtrees. Restore brings a
// page (and its sub-pages) back; "Delete forever" purges permanently (with an
// inline confirm, not a browser dialog).

interface Props {
  open: boolean;
  onClose: () => void;
}

export function TrashPanel({ open, onClose }: Props) {
  const pages = useData((s) => s.pages);
  const restorePage = useData((s) => s.restorePage);
  const deletePage = useData((s) => s.deletePage);
  const emptyTrash = useData((s) => s.emptyTrash);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [autoPurge, setAutoPurge] = useState(() => localStorage.getItem('waypoint:trashAutoPurge') !== '0');

  if (!open) return null;
  const trashed = selectTrashRoots(pages);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/30 pt-[14vh] backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl border border-paper-line bg-paper shadow-2xl dark:border-coal-line dark:bg-coal-panel"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-paper-line px-4 py-3 dark:border-coal-line">
          <Trash2 className="h-4 w-4 text-ink-faint dark:text-coal-soft" />
          <span className="flex-1 text-sm font-semibold text-ink dark:text-coal-text">Trash</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-ink-faint hover:bg-paper-panel dark:hover:bg-coal-line"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[55vh] overflow-y-auto p-2">
          {trashed.length === 0 && (
            <p className="px-3 py-8 text-center text-sm text-ink-faint dark:text-coal-soft">
              Trash is empty.
            </p>
          )}
          {trashed.map((p) => (
            <div
              key={p.id}
              className="flex items-center gap-2 rounded-lg px-2.5 py-2 hover:bg-paper-panel dark:hover:bg-coal-line"
            >
              <span className="flex shrink-0 items-center text-base leading-none"><PageIcon icon={p.icon} size="h-4 w-4" /></span>
              <span className="min-w-0 flex-1 truncate text-sm text-ink dark:text-coal-text">
                {displayTitle(p.title)}
              </span>
              {confirmId === p.id ? (
                <>
                  <span className="shrink-0 text-xs text-ink-faint dark:text-coal-soft">delete forever?</span>
                  <button
                    type="button"
                    onClick={() => {
                      void deletePage(p.id);
                      setConfirmId(null);
                    }}
                    className="flex shrink-0 items-center gap-1 rounded-md bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700"
                  >
                    <Check className="h-3.5 w-3.5" /> yes
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmId(null)}
                    className="shrink-0 rounded-md border border-paper-line px-2 py-1 text-xs text-ink-soft hover:bg-paper dark:border-coal-line dark:text-coal-soft dark:hover:bg-coal"
                  >
                    cancel
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => void restorePage(p.id)}
                    className="flex shrink-0 items-center gap-1 rounded-md border border-paper-line px-2 py-1 text-xs text-ink-soft hover:bg-paper hover:text-ink dark:border-coal-line dark:text-coal-soft dark:hover:bg-coal"
                    title="Restore"
                  >
                    <RotateCcw className="h-3.5 w-3.5" /> Restore
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmId(p.id)}
                    className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/30"
                    title="Delete forever"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-paper-line px-4 py-2.5 dark:border-coal-line">
          <label className="flex items-center gap-1.5 text-xs text-ink-soft dark:text-coal-soft">
            <input
              type="checkbox"
              checked={autoPurge}
              onChange={(e) => {
                setAutoPurge(e.target.checked);
                localStorage.setItem('waypoint:trashAutoPurge', e.target.checked ? '1' : '0');
              }}
              className="accent-clay"
            />
            Auto-empty after 14 days
          </label>
          {trashed.length > 0 &&
            (confirmAll ? (
              <div className="ml-auto flex items-center gap-1.5">
                <span className="text-xs text-ink-faint dark:text-coal-soft">empty the whole trash?</span>
                <button
                  type="button"
                  onClick={() => {
                    void emptyTrash();
                    setConfirmAll(false);
                  }}
                  className="rounded-md bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700"
                >
                  yes, empty
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmAll(false)}
                  className="rounded-md border border-paper-line px-2 py-1 text-xs text-ink-soft hover:bg-paper dark:border-coal-line dark:text-coal-soft dark:hover:bg-coal"
                >
                  cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmAll(true)}
                className="ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/30"
              >
                <Trash2 className="h-3.5 w-3.5" /> Clear trash
              </button>
            ))}
        </div>
      </div>
    </div>
  );
}
