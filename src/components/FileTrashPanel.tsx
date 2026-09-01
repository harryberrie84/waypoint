import { useCallback, useEffect, useState } from 'react';
import { Trash2, Loader2, RefreshCw, HardDrive, AlertTriangle } from 'lucide-react';
import { useData } from '../store/useData';
import { useWorkspace } from '../store/useWorkspace';
import { useAuth } from '../store/useAuth';
import { listWorkspaceUploads, fileTrashApi, type StoredUpload, type TrashedFile } from '../lib/api';
import { referencesToUrl } from '../lib/uploadRefs';
import { toast } from '../store/useToast';
import { confirmAsk } from '../store/useConfirm';

// Workspace file storage, admin only. Two things live here that have nowhere
// else to go: files a member removed from a page (queued in file_trash, since a
// member cannot delete the blob), and ORPHANS, files still on disk that no page
// references any more. Removing a file from a page never deleted it, so orphans
// accumulate silently; this is where they become visible and clearable.
//
// Workspace-scoped by the server rules, not by this component: the list and
// delete rules both require membership of the owning workspace, so another
// workspace's files are not merely hidden here, they are unreachable.

interface Orphan extends StoredUpload {
  /** Where the file is still used. Empty means safe to delete. */
  usedBy: string[];
}

export function FileTrashPanel() {
  const activeId = useWorkspace((s) => s.activeWorkspaceId);
  const myRole = useWorkspace((s) => s.myRole);
  const workspaces = useWorkspace((s) => s.workspaces);
  const meId = useAuth((s) => s.user?.id) ?? '';
  // Owner counts as well as admin. myRole reads workspace_members.role, which is
  // blank on memberships created before roles were stamped, so gating on 'admin'
  // alone hid this panel from the person who owns the workspace, and hid it
  // SILENTLY by rendering nothing.
  const isOwner = workspaces.find((w) => w.id === activeId)?.owner === meId;
  const isAdmin = myRole() === 'admin' || isOwner;
  const pages = useData((s) => s.pages);
  const tables = useData((s) => s.tables);
  const rows = useData((s) => s.rows);
  // Every delete here goes through the store's purge, which re-sweeps and REFUSES
  // while any page is unreadable. This panel used to call the raw delete, so the
  // "could not be read" banner below was advice rather than a guard, and a file
  // living inside a locked page could be deleted from the listing.
  const purgeUpload = useData((s) => s.purgeUpload);

  const [orphans, setOrphans] = useState<Orphan[]>([]);
  const [queued, setQueued] = useState<TrashedFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  // "The server refused the listing" and "this workspace has no files" look the
  // same as an empty list, and reading one as the other sends you hunting in the
  // wrong place entirely.
  const [failed, setFailed] = useState(false);
  /** Pages whose body could not be read, so their file use is unknown. */
  const [locked, setLocked] = useState(0);

  const load = useCallback(async () => {
    if (!activeId || !isAdmin) return;
    setLoading(true);
    try {
      const [files, trash] = await Promise.all([
        listWorkspaceUploads(activeId),
        fileTrashApi.listPending(activeId),
      ]);
      setFailed(files === null);
      // Work out what is genuinely unused, against everything the store holds.
      const pageList = Object.values(pages);
      const tableList = Object.values(tables);
      const rowList = Object.values(rows);
      setOrphans(
        (files ?? []).map((f) => {
          const refs = referencesToUrl(pageList, tableList, rowList, f.url, workspaces);
          return {
            ...f,
            // Only an actual use blocks a delete. A locked page is counted once
            // for the banner below, never per file.
            usedBy: [...new Set(refs.filter((r) => r.kind !== 'locked').map((r) => r.label))],
          };
        }),
      );
      setLocked(
        new Set(
          // A url no stored file can equal, so the sweep reports only its 'locked'
          // refs (the pages it could not read) and no real uses.
          referencesToUrl(pageList, tableList, rowList, 'never-matches')
            .filter((r) => r.kind === 'locked')
            .map((r) => r.label),
        ).size,
      );
      setQueued(trash);
    } finally {
      setLoading(false);
    }
  }, [activeId, isAdmin, pages, tables, rows, workspaces]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!isAdmin) return null;

  const unused = orphans.filter((o) => o.usedBy.length === 0);
  const inUse = orphans.filter((o) => o.usedBy.length > 0);

  const removeOne = (o: Orphan, trashId?: string) => {
    confirmAsk({
      title: 'Delete this file?',
      message: `"${o.name}" is deleted from the server for good. This cannot be undone.`,
      confirmLabel: 'Delete',
      destructive: true,
      onConfirm: () => {
        void (async () => {
          setBusy(o.id);
          const res = await purgeUpload(o.url);
          if (res.ok) {
            if (trashId) await fileTrashApi.remove(trashId).catch(() => {});
            toast('Deleted from the server');
          } else {
            toast(`Kept: ${res.blockedBy.slice(0, 2).join(', ')}`, 'error');
          }
          setBusy(null);
          await load();
        })();
      },
    });
  };

  const purgeAllUnused = () => {
    if (!unused.length) return;
    confirmAsk({
      title: `Delete ${unused.length} unused file${unused.length === 1 ? '' : 's'}?`,
      message: 'These are not referenced by any page, table or gallery in this workspace. They are deleted from the server for good.',
      confirmLabel: 'Delete all',
      destructive: true,
      onConfirm: () => {
        void (async () => {
          setBusy('all');
          let done = 0;
          let kept = 0;
          for (const o of unused) {
            // One at a time through the same guard as a single delete, so a file
            // this listing thinks is unused but the sweep still finds in use is
            // skipped rather than taken out with the batch.
            const res = await purgeUpload(o.url);
            if (res.ok) done++;
            else kept++;
          }
          setBusy(null);
          toast(
            done ? `Deleted ${done} file${done === 1 ? '' : 's'}${kept ? `, kept ${kept} still in use` : ''}` : 'Nothing could be deleted',
            done ? 'info' : 'error',
          );
          await load();
        })();
      },
    });
  };

  const row = (o: Orphan, trashId?: string) => (
    <div key={o.id} className="flex items-center gap-2 border-b border-paper-line/60 py-2 last:border-0 dark:border-coal-line/60">
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-ink dark:text-coal-text">{o.name}</p>
        <p className="text-[11px] text-ink-faint dark:text-coal-soft">
          {o.usedBy.length ? `still used by ${o.usedBy.slice(0, 2).join(', ')}` : 'not used anywhere'}
        </p>
      </div>
      <a href={o.url} target="_blank" rel="noreferrer" className="rounded px-1.5 py-0.5 text-[11px] text-ink-faint hover:text-clay dark:text-coal-soft">
        open
      </a>
      <button
        type="button"
        disabled={busy !== null || o.usedBy.length > 0 || locked > 0}
        title={o.usedBy.length ? 'Still used on a page' : locked > 0 ? 'Unlock your vault first: some pages could not be read' : 'Delete from the server'}
        onClick={() => removeOne(o, trashId)}
        className="rounded p-1 text-ink-faint hover:text-red-500 disabled:opacity-30 dark:text-coal-soft"
      >
        {busy === o.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
      </button>
    </div>
  );

  return (
    <div className="rounded-xl border border-paper-line p-3 dark:border-coal-line">
      <div className="mb-2 flex items-center gap-2">
        <HardDrive className="h-4 w-4 text-clay" />
        <h3 className="text-sm font-semibold text-ink dark:text-coal-text">Workspace files</h3>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="ml-auto flex items-center gap-1 rounded-lg border border-paper-line px-2 py-0.5 text-[11px] text-ink-soft hover:border-clay disabled:opacity-50 dark:border-coal-line dark:text-coal-soft"
        >
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} refresh
        </button>
      </div>
      <p className="mb-3 text-[11px] text-ink-faint dark:text-coal-soft">
        Removing a file from a page never deleted it. Anything left here is still on the server, taking up space,
        until you clear it. Only admins of this workspace can see or delete these.
      </p>

      {queued.length > 0 && (
        <div className="mb-3">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-ink-soft dark:text-coal-soft">
            <AlertTriangle className="h-3.5 w-3.5 text-clay" /> Sent to trash by someone ({queued.length})
          </div>
          {queued.map((t) => {
            const match = orphans.find((o) => o.url === t.url);
            return match ? (
              row(match, t.id)
            ) : (
              <div key={t.id} className="flex items-center gap-2 border-b border-paper-line/60 py-2 last:border-0 dark:border-coal-line/60">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-ink dark:text-coal-text">{t.name}</p>
                  <p className="text-[11px] text-ink-faint dark:text-coal-soft">removed by {t.removedByName}, already gone from storage</p>
                </div>
                <button
                  type="button"
                  onClick={() => void fileTrashApi.remove(t.id).then(load)}
                  className="rounded px-1.5 py-0.5 text-[11px] text-ink-faint hover:text-clay dark:text-coal-soft"
                >
                  dismiss
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="mb-1 flex items-center gap-2 text-[11px] font-medium text-ink-soft dark:text-coal-soft">
        Not used anywhere ({unused.length})
        {unused.length > 0 && (
          <button
            type="button"
            onClick={purgeAllUnused}
            disabled={busy !== null || locked > 0}
            title={locked > 0 ? 'Unlock your vault first: some pages could not be read, so their file use is unknown' : undefined}
            className="ml-auto rounded-lg border border-red-500/60 px-2 py-0.5 text-[11px] font-medium text-red-600 hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400"
          >
            {busy === 'all' ? 'Deleting…' : 'Delete all unused'}
          </button>
        )}
      </div>
      {locked > 0 && (
        <p className="mb-2 rounded-lg bg-amber-500/10 px-2 py-1.5 text-[11px] text-ink dark:text-coal-text">
          {locked} page{locked === 1 ? '' : 's'} could not be read (locked vault), so their file use is unknown.
          Unlock to check them before deleting anything you are unsure about.
        </p>
      )}
      {failed ? (
        <p className="py-2 text-[11px] text-red-600 dark:text-red-400">
          The server would not list this workspace&apos;s files. That is a permissions answer, not an empty
          workspace: the uploads list rule has not been applied yet.
        </p>
      ) : orphans.length === 0 ? (
        <p className="py-2 text-[11px] text-ink-faint dark:text-coal-soft">
          No stored files are attributed to this workspace. Files uploaded before file ownership existed carry no
          workspace until they are attributed, and files belonging to another workspace are listed there, not here.
        </p>
      ) : unused.length === 0 ? (
        <p className="py-2 text-[11px] text-ink-faint dark:text-coal-soft">Nothing orphaned. Every stored file is in use.</p>
      ) : (
        unused.map((o) => row(o))
      )}

      {inUse.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-[11px] text-ink-faint dark:text-coal-soft">
            In use ({inUse.length})
          </summary>
          {inUse.map((o) => row(o))}
        </details>
      )}

    </div>
  );
}
