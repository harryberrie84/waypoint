import { useMemo, useRef, useState } from 'react';
import { Paperclip, FileText, File as FileIcon, Eye, Image as ImageIcon, Music, Upload, Loader2, PlayCircle, Trash2, Search, X } from 'lucide-react';
import { useData } from '../store/useData';
import { useWorkspaceTables } from '../hooks/useScoped';
import { collectMedia, pageTables, type MediaItem } from '../lib/tripViews';
import { formatBytes, compressImageToFile, MAX_UPLOAD_BYTES } from '../lib/image';
import { uploadsApi } from '../lib/api';
import { uid } from '../lib/id';
import type { PageFile } from '../types';
import { toast } from '../store/useToast';
import { confirmAsk } from '../store/useConfirm';
import { useWorkspace } from '../store/useWorkspace';
import { isUploadUrl } from '../lib/uploadRefs';
import { MediaPreview, isVideoMedia } from './MediaPreview';
import { LockedBodyStrip } from './LockedBody';
import { isEnvelope } from '../lib/crypto';
import { UploadModal } from './UploadModal';

// FilesTab, every attachment on THIS page in one place: image + file blocks in
// the body, the cover, and attachment cells of the page's tables. Passport scans,
// tickets, the ryokan PDF, all downloadable from here. You can also add files
// straight from here (not only by dropping them into the notes body).

type Filter = 'all' | 'images' | 'video' | 'audio' | 'files';

// A playable video (a non-image, non-audio media item the browser can play inline).
function isVideoItem(m: MediaItem): boolean {
  return !m.isImage && !m.isAudio && isVideoMedia(m);
}

function extLabel(mime: string, name: string): string {
  const fromName = /\.([a-z0-9]+)(\?|#|$)/i.exec(name)?.[1];
  if (fromName) return fromName.toUpperCase();
  const sub = mime.split('/')[1];
  return sub ? sub.toUpperCase().slice(0, 4) : 'FILE';
}

export function FilesTab({ pageId, editable = false, body }: { pageId: string; editable?: boolean; body?: object | null }) {
  const stored = useData((s) => s.pages[pageId]);
  // On an encrypted page the store holds the body as an enc:v1: envelope, so
  // reading page.content directly finds nothing at all. PageView already keeps a
  // decrypted copy for the editor; use that when it has one.
  const page = useMemo(() => (stored && body ? { ...stored, content: body } : stored), [stored, body]);
  const allTables = useWorkspaceTables();
  const rows = useData((s) => s.rows);
  const detachFromPage = useData((s) => s.detachFromPage);
  const setPagePhotos = useData((s) => s.setPagePhotos);
  const setPageFiles = useData((s) => s.setPageFiles);
  const persistPageFiles = useData((s) => s.persistPageFiles);
  const pageFilesFieldExists = useData((s) => s.pageFilesFieldExists);
  const purgeUpload = useData((s) => s.purgeUpload);
  const trashFile = useData((s) => s.trashFile);
  const myRole = useWorkspace((s) => s.myRole);
  const isAdmin = myRole() === 'admin';
  const tables = useMemo(() => pageTables(page, allTables), [page, allTables]);
  // Photos-tab images live in the dedicated pages.photos field (not the body), so
  // fold them in here too, they belong among this page's files.
  const media = useMemo(() => {
    const base = collectMedia(page, tables, rows);
    // Files added from this tab live in pages.files, out of the body.
    const fromFiles = (page?.files ?? []).map(
      (f): MediaItem => ({
        key: `file:${f.id}`,
        name: f.name || 'File',
        url: f.url,
        mime: f.mime ?? '',
        size: f.size ?? 0,
        isImage: (f.mime ?? '').startsWith('image/'),
        isAudio: (f.mime ?? '').startsWith('audio/'),
        source: 'Files',
      }),
    );
    const fromPhotos = (page?.photos ?? []).map(
      (p): MediaItem => ({ key: `photo:${p.id}`, name: p.alt || 'Photo', url: p.url, mime: '', size: 0, isImage: true, isAudio: false, source: p.album ? `Photos · ${p.album}` : 'Photos' }),
    );
    return [...fromFiles, ...fromPhotos, ...base];
  }, [page, tables, rows]);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [preview, setPreview] = useState<MediaItem | null>(null);
  const [uploading, setUploading] = useState(false);
  const [staged, setStaged] = useState<File[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Picking stages the files in the modal instead of uploading straight away, so
  // an oversized one is caught (and an image can be shrunk) before the wait.
  const onPick = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setStaged(Array.from(files));
    if (fileRef.current) fileRef.current.value = '';
  };

  const runUpload = async (files: File[]) => {
    setStaged(null);
    setUploading(true);
    try {
      // Files added HERE belong to the Files tab, not to your notes. They go into
      // pages.files and NEVER touch the page body. There is deliberately no body
      // fallback: that fallback existed, and it was the thing dumping uploads into
      // people's notes. If the field is missing there is nowhere to record the file,
      // so the upload is undone rather than left on disk unreferenced.
      // Settle this BEFORE uploading a single byte. Asking afterwards meant a server
      // without the column got a blob uploaded and then had nowhere to record it,
      // which is precisely how files ended up on disk referenced by nothing.
      if (!(await pageFilesFieldExists(pageId))) {
        console.error('[files] pages.files column missing. This install predates the field: add an optional JSON field named files to the pages collection in the PocketBase dashboard. The toast stays plain: the person hitting this cannot add a column.');
        toast('Nothing was uploaded: this Waypoint is not set up to store attachments yet. Ask whoever runs it to finish the setup.', 'error');
        return;
      }
      const uploaded: PageFile[] = [];
      const failed: string[] = [];
      for (const f of files) {
        const source = f.type.startsWith('image/') && f.size > MAX_UPLOAD_BYTES ? await compressImageToFile(f).catch(() => f) : f;
        const url = await uploadsApi.upload(source);
        if (url) uploaded.push({ id: uid('pf'), url, name: f.name, mime: f.type || '', size: source.size });
        else failed.push(f.name);
      }
      if (failed.length) toast(`Could not upload ${failed.join(', ')}.`, 'error');
      if (!uploaded.length) return;

      await persistPageFiles(pageId, [...(page?.files ?? []), ...uploaded]);
      toast(`Added ${uploaded.length} file${uploaded.length > 1 ? 's' : ''}`);
    } finally {
      setUploading(false);
    }
  };

  // Where a file lives decides how it comes off the page. Body and gallery blocks
  // go through detachFromPage (decrypt, prune, re-encrypt, reset collab); gallery
  // photos are a plain field write. A cover or a table attachment cell belongs to
  // its own surface, so it is not removable from here.
  const removalKind = (m: MediaItem): 'body' | 'photo' | 'file' | null => {
    if (m.key.startsWith('photo:')) return 'photo';
    if (m.key.startsWith('file:')) return 'file';
    if (m.source === 'Page body' || m.source === 'Gallery') return 'body';
    return null;
  };

  // Take the file off this page. Shared by both paths, since deleting the blob
  // only makes sense once it is no longer on the page.
  const detach = async (m: MediaItem, kind: 'body' | 'photo' | 'file'): Promise<boolean> => {
    if (kind === 'file') {
      const id = m.key.slice('file:'.length);
      setPageFiles(pageId, (page?.files ?? []).filter((f) => f.id !== id));
      return true;
    }
    if (kind === 'photo') {
      const id = m.key.slice('photo:'.length);
      await setPagePhotos(pageId, (page?.photos ?? []).filter((p) => p.id !== id));
      return true;
    }
    return detachFromPage(pageId, m.url);
  };

  const removeItem = (m: MediaItem) => {
    const kind = removalKind(m);
    if (!kind) return;
    const onServer = isUploadUrl(m.url);
    // An admin deleting a file should actually delete it. A member cannot (the
    // server rule scopes deletion to the workspace), so their removal queues in
    // the file trash for an admin to clear, and the queue is the notification.
    const canPurge = isAdmin && onServer;
    confirmAsk({
      title: canPurge ? 'Delete this file?' : 'Remove from page?',
      message: canPurge
        ? `"${m.name}" comes off this page and the uploaded file is deleted from the server. This cannot be undone, and it is refused if the file is still used anywhere else.`
        : `"${m.name}" comes off this page${kind === 'photo' ? "'s gallery" : "'s notes"}.${onServer ? ' The file goes to the workspace file trash for an admin to clear.' : ''}`,
      confirmLabel: canPurge ? 'Delete' : 'Remove',
      destructive: true,
      onConfirm: () => {
        void (async () => {
          const ok = await detach(m, kind);
          if (!ok) {
            toast('Could not remove that file', 'error');
            return;
          }
          if (!onServer) {
            toast('Removed from the page');
            return;
          }
          if (canPurge) {
            const res = await purgeUpload(m.url);
            toast(
              res.ok
                ? 'Deleted from the server'
                : `Removed from the page, but kept on the server: still used by ${res.blockedBy.slice(0, 2).join(', ')}`,
              res.ok ? 'info' : 'error',
            );
          } else {
            await trashFile(m.url, m.name, pageId);
            toast('Removed, and sent to the file trash for an admin');
          }
        })();
      },
    });
  };

  const addUI = editable ? (
    <>
      <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => onPick(e.target.files)} />
      <button
        type="button"
        disabled={uploading}
        onClick={() => fileRef.current?.click()}
        className="flex items-center gap-1.5 rounded-lg bg-clay px-2.5 py-1 text-xs font-medium text-white hover:bg-clay/90 disabled:opacity-60"
      >
        {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
        {uploading ? 'Adding…' : 'Add files'}
      </button>
    </>
  ) : null;

  // Name search on top of the kind chips. The chips only ever answered "what type",
  // which is no help on a page carrying forty tickets: you know the file is called
  // something with "hotel" in it. Matches the name AND where it came from, so
  // "photos" or the table's name narrows it too.
  const needle = query.trim().toLowerCase();
  const shown = media.filter((m) => {
    const vid = isVideoItem(m);
    const kindOk =
      filter === 'all' ? true
      : filter === 'images' ? m.isImage
      : filter === 'video' ? vid
      : filter === 'audio' ? m.isAudio
      : !m.isImage && !m.isAudio && !vid; // 'files' = docs, videos have their own chip
    if (!kindOk) return false;
    if (!needle) return true;
    return `${m.name} ${m.source}`.toLowerCase().includes(needle);
  });
  const imageCount = media.filter((m) => m.isImage).length;
  const videoCount = media.filter(isVideoItem).length;
  const audioCount = media.filter((m) => m.isAudio).length;
  const fileCount = media.length - imageCount - audioCount - videoCount;

  // The gallery (pages.photos) is a plain field and still lists while locked, so an
  // unreadable body means this view is PARTIAL, not empty. Say so rather than let a
  // half list look like the whole set.
  const bodyUnreadable = isEnvelope(stored?.content) && !body;

  if (media.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        {bodyUnreadable && <div className="w-full max-w-md"><LockedBodyStrip what="files" /></div>}
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-clay-wash text-clay dark:bg-clay/15">
          <Paperclip className="h-5 w-5" />
        </div>
        <p className="text-sm text-ink-soft dark:text-coal-soft">No files yet.</p>
        <p className="max-w-xs text-xs text-ink-faint dark:text-coal-soft">
          Add a file here, drop one onto this page, or add an <span className="font-medium">Attachment</span> column to a
          table here (passport scans, tickets, confirmations, audio), and they collect here.
        </p>
        {addUI && <div className="mt-2">{addUI}</div>}
        {/* The staging modal has to live in THIS branch too. It only existed in the
            main return, so on a page with nothing in the tab yet, picking files set
            `staged` and nothing ever rendered it: no size list, no compression, no
            upload, no error. Uploading was simply impossible on an empty page. */}
        {staged && <UploadModal files={staged} onCancel={() => setStaged(null)} onUpload={(f) => void runUpload(f)} />}
      </div>
    );
  }

  const chips: { id: Filter; label: string }[] = [
    { id: 'all', label: `All ${media.length}` },
    { id: 'images', label: `Images ${imageCount}` },
    ...(videoCount > 0 ? [{ id: 'video' as Filter, label: `Video ${videoCount}` }] : []),
    ...(audioCount > 0 ? [{ id: 'audio' as Filter, label: `Audio ${audioCount}` }] : []),
    { id: 'files', label: `Docs ${fileCount}` },
  ];

  return (
    <div className="mx-auto h-full max-w-4xl overflow-y-auto px-3 py-4 sm:px-6">
      {bodyUnreadable && <LockedBodyStrip what="files" />}
      <div className="mb-3 flex items-center gap-2">
        <Paperclip className="h-4 w-4 text-clay" />
        <h2 className="text-sm font-semibold text-ink dark:text-coal-text">Files</h2>
        {addUI}
        <div className="relative ml-auto">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint dark:text-coal-soft" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search files"
            className="w-40 rounded-md border border-paper-line bg-paper py-1 pl-7 pr-6 text-xs text-ink outline-none placeholder:text-ink-faint focus:border-clay dark:border-coal-line dark:bg-coal dark:text-coal-text sm:w-52"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 text-ink-faint hover:text-clay"
              title="Clear"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-1">
          {chips.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setFilter(c.id)}
              className={['rounded-full border px-2.5 py-0.5 text-[11px]', filter === c.id ? 'border-clay bg-clay text-white' : 'border-paper-line text-ink-soft hover:border-clay dark:border-coal-line dark:text-coal-soft'].join(' ')}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {shown.map((m) => (
          <div
            key={m.key}
            className="group relative flex flex-col overflow-hidden rounded-xl border border-paper-line bg-paper text-left transition-colors hover:border-clay/60 dark:border-coal-line dark:bg-coal-panel"
          >
            {editable && removalKind(m) && (
              // Sits above the preview button rather than inside it: a button
              // nested in a button is invalid and swallows the click.
              <button
                type="button"
                onClick={() => removeItem(m)}
                title="Remove from page"
                className="absolute right-1 top-1 z-10 rounded-full bg-black/45 p-1 text-white opacity-0 transition-opacity hover:bg-red-500 group-hover:opacity-100 focus:opacity-100"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            )}
            <button
              type="button"
              onClick={() => setPreview(m)}
              title={`Preview ${m.name}`}
              className="flex flex-col text-left"
            >
            {/* preview */}
            <div className="relative flex h-24 items-center justify-center overflow-hidden bg-paper-panel/60 dark:bg-coal-line/40">
              {m.isImage ? (
                <img src={m.url} alt={m.name} loading="lazy" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
              ) : isVideoItem(m) ? (
                <>
                  {/* preload=metadata paints the first frame as a poster; no controls
                      so the whole card stays a single click that opens the player. */}
                  <video src={m.url} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                  <span className="absolute inset-0 flex items-center justify-center bg-black/10">
                    <PlayCircle className="h-8 w-8 text-white/95 drop-shadow-lg" />
                  </span>
                </>
              ) : m.isAudio ? (
                <div className="flex flex-col items-center gap-1 text-clay">
                  <Music className="h-7 w-7" />
                  <span className="text-[10px] font-semibold tracking-wide">{extLabel(m.mime, m.name)}</span>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-1 text-ink-faint dark:text-coal-soft">
                  {/pdf/i.test(m.mime) ? <FileText className="h-7 w-7 text-clay" /> : /^image/i.test(m.mime) ? <ImageIcon className="h-7 w-7" /> : <FileIcon className="h-7 w-7" />}
                  <span className="text-[10px] font-semibold tracking-wide">{extLabel(m.mime, m.name)}</span>
                </div>
              )}
              {/* left, so it never sits under the remove button */}
              <span className="absolute left-1 top-1 rounded-full bg-black/40 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100">
                <Eye className="h-3 w-3" />
              </span>
            </div>
            {/* meta */}
            <div className="min-w-0 p-2">
              <div className="truncate text-xs font-medium text-ink dark:text-coal-text">{m.name}</div>
              <div className="mt-0.5 flex items-center gap-1 text-[10px] text-ink-faint dark:text-coal-soft">
                {m.size > 0 && <span>{formatBytes(m.size)}</span>}
                {m.size > 0 && <span>·</span>}
                <span className="truncate">{m.source}</span>
              </div>
            </div>
            </button>
          </div>
        ))}
      </div>

      {staged && <UploadModal files={staged} onCancel={() => setStaged(null)} onUpload={(f) => void runUpload(f)} />}
      <MediaPreview item={preview} onClose={() => setPreview(null)} />
    </div>
  );
}