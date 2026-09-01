import { useEffect, useState } from 'react';
import { History, X, RotateCcw } from 'lucide-react';
import { versionsApi, type PageVersion } from '../lib/api';

function ago(iso: string): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
  const day = Math.floor(hr / 24);
  return `${day} day${day === 1 ? '' : 's'} ago`;
}

export function VersionHistory({
  pageId,
  open,
  onClose,
  onRestore,
}: {
  pageId: string;
  open: boolean;
  onClose: () => void;
  onRestore: (content: unknown) => void;
}) {
  const [versions, setVersions] = useState<PageVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    void versionsApi
      .listForPage(pageId)
      .then((v) => {
        if (alive) {
          setVersions(v);
          setLoading(false);
        }
      })
      .catch(() => {
        if (alive) {
          setVersions([]);
          setLoading(false);
        }
      });
    return () => {
      alive = false;
    };
  }, [open, pageId]);

  if (!open) return null;

  const restore = (v: PageVersion) => {
    if (v.content != null) onRestore(v.content);
    setConfirmId(null);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/30 pt-[12vh] backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-xl border border-paper-line bg-paper shadow-2xl dark:border-coal-line dark:bg-coal-panel"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-paper-line px-4 py-3 dark:border-coal-line">
          <History className="h-4 w-4 text-clay" />
          <span className="flex-1 text-sm font-semibold text-ink dark:text-coal-text">Version history</span>
          <button type="button" onClick={onClose} className="rounded p-1 text-ink-faint hover:bg-paper-panel dark:hover:bg-coal-line">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[55vh] overflow-y-auto p-2">
          {loading && <p className="px-3 py-6 text-center text-sm text-ink-faint dark:text-coal-soft">Loading…</p>}
          {!loading && versions.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-ink-faint dark:text-coal-soft">No backups yet. They are taken automatically as you edit.</p>
          )}
          {versions.map((v) => (
            <div key={v.id} className="flex items-center gap-2 rounded-lg px-2.5 py-2 hover:bg-paper-panel dark:hover:bg-coal-line">
              <div className="min-w-0 flex-1">
                <div className="text-sm text-ink dark:text-coal-text">{ago(v.created)}</div>
                <div className="text-[11px] text-ink-faint dark:text-coal-soft">{new Date(v.created).toLocaleString()}</div>
              </div>
              {confirmId === v.id ? (
                <>
                  <button
                    type="button"
                    onClick={() => restore(v)}
                    className="shrink-0 rounded-md bg-clay px-2 py-1 text-xs font-medium text-white hover:bg-clay-soft"
                  >
                    restore this
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
                <button
                  type="button"
                  onClick={() => setConfirmId(v.id)}
                  className="flex shrink-0 items-center gap-1 rounded-md border border-paper-line px-2 py-1 text-xs text-ink-soft hover:bg-paper hover:text-ink dark:border-coal-line dark:text-coal-soft dark:hover:bg-coal"
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Restore
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
