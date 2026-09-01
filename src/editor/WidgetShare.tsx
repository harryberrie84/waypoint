import { useEffect, useRef, useState } from 'react';
import { Share2, Copy, RefreshCw, Trash2 } from 'lucide-react';
import { useData } from '../store/useData';
import { useWorkspace } from '../store/useWorkspace';
import { toast } from '../store/useToast';

// A "share a read-only public link" control for a widget (recipe, setlist, quiz).
// Publishes a separate PUBLIC copy of just this widget (via publishShared) that
// anyone with the link can view without an account, while the rest of the
// workspace stays private. The share id/token live on the widget's own attrs so
// the link persists and can be updated or revoked. This is a public plaintext
// copy (the server and any link-holder can read it), exactly like the recipe
// share it generalises, NOT end-to-end encryption.

interface Props {
  attrs: Record<string, unknown>;
  updateAttributes: (a: Record<string, unknown>) => void;
  docOf: () => object; // a doc containing just this widget node, the thing to publish
  title: string;
  label: string; // the noun used in the copy, e.g. "setlist"
}

export function WidgetShare({ attrs, updateAttributes, docOf, title, label }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const publishShared = useData((s) => s.publishShared);
  const updateShared = useData((s) => s.updateShared);
  const unpublishShared = useData((s) => s.unpublishShared);
  const workspaceId = useWorkspace((s) => s.activeWorkspaceId ?? '');

  const token = (attrs.shareToken as string) || '';
  const shareId = (attrs.shareId as string) || '';
  const link = token ? `${window.location.origin}${window.location.pathname}?share=${token}` : '';

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && e.target instanceof globalThis.Node && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const create = async () => {
    setBusy(true);
    const res = await publishShared(workspaceId, title || label, docOf());
    setBusy(false);
    if (res) {
      updateAttributes({ shareId: res.pageId, shareToken: res.token });
      toast(`Read-only ${label} link is ready`);
    } else {
      toast('Could not create the link', 'error');
    }
  };
  const refresh = async () => {
    if (!shareId) return;
    await updateShared(shareId, title || label, docOf());
    toast('Updated the shared copy');
  };
  const stop = async () => {
    if (shareId) await unpublishShared(shareId);
    updateAttributes({ shareId: '', shareToken: '' });
    setOpen(false);
    toast('Sharing stopped');
  };
  const copy = () => void navigator.clipboard?.writeText(link).then(() => toast('Link copied'));

  return (
    <div ref={ref} className="relative shrink-0" contentEditable={false}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Share a read-only link"
        className={`rounded-md p-1.5 hover:bg-paper-panel dark:hover:bg-coal-line ${token ? 'text-clay' : 'text-ink-faint hover:text-clay'}`}
      >
        <Share2 className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 w-72 rounded-lg border border-paper-line bg-paper p-3 shadow-xl dark:border-coal-line dark:bg-coal-panel">
          {token ? (
            <>
              <div className="mb-2 text-xs text-ink-soft dark:text-coal-soft">
                Anyone with this link can view this {label}, read-only. No account, nothing else of yours is shown.
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  readOnly
                  value={link}
                  onFocus={(e) => e.currentTarget.select()}
                  className="min-w-0 flex-1 rounded border border-paper-line bg-paper-panel px-2 py-1 text-xs text-ink-soft outline-none dark:border-coal-line dark:bg-coal dark:text-coal-soft"
                />
                <button type="button" onClick={copy} className="shrink-0 rounded bg-clay px-2 py-1 text-xs font-medium text-white hover:bg-clay/90" title="Copy link">
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="mt-2 flex items-center gap-2 text-xs">
                <button type="button" onClick={() => void refresh()} className="flex items-center gap-1 text-ink-soft hover:text-clay dark:text-coal-soft">
                  <RefreshCw className="h-3 w-3" /> Update shared copy
                </button>
                <button type="button" onClick={() => void stop()} className="ml-auto flex items-center gap-1 text-ink-faint hover:text-rose-500">
                  <Trash2 className="h-3 w-3" /> Stop sharing
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="mb-2 text-xs text-ink-soft dark:text-coal-soft">
                Create a read-only link to show this {label} to anyone. It is a separate public copy; the rest of your workspace stays private.
              </div>
              <button
                type="button"
                onClick={() => void create()}
                disabled={busy}
                className="flex w-full items-center justify-center gap-1.5 rounded-md bg-clay px-3 py-1.5 text-xs font-medium text-white hover:bg-clay/90 disabled:opacity-50"
              >
                <Share2 className="h-3.5 w-3.5" /> {busy ? 'Creating…' : 'Create a read-only link'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
