import { useMemo, useRef, useState } from 'react';
import { Images, Upload, Loader2 } from 'lucide-react';
import { useData } from '../store/useData';
import { useWorkspaceTables } from '../hooks/useScoped';
import { collectMedia, pageTables, type MediaItem } from '../lib/tripViews';
import { uid } from '../lib/id';
import { uploadsApi } from '../lib/api';
import { compressImageToFile, MAX_UPLOAD_BYTES } from '../lib/image';
import { toast } from '../store/useToast';
import { UploadModal } from './UploadModal';
import type { PageFile } from '../types';
import { MediaPreview } from './MediaPreview';
import { LockedBodyStrip } from './LockedBody';
import { isEnvelope } from '../lib/crypto';
import { InlineCommentThread } from './InlineCommentThread';

// MoodboardTab, this page's images as a masonry wall: everything from image /
// file blocks in the body, the cover, and attachment cells in the page's tables.
// Click one to blow it up in the shared MediaPreview lightbox (same previewer the
// Files tab uses, so Esc / backdrop / download / comment all come for free). The
// dream-board for the trip.

export function MoodboardTab({ pageId, body }: { pageId: string; body?: object | null }) {
  const stored = useData((s) => s.pages[pageId]);
  // Encrypted pages keep an envelope in the store; PageView passes the decrypted body.
  const page = useMemo(() => (stored && body ? { ...stored, content: body } : stored), [stored, body]);
  const allTables = useWorkspaceTables();
  const rows = useData((s) => s.rows);
  const anchorImageThread = useData((s) => s.anchorImageThread);
  const openCommentThread = useData((s) => s.openCommentThread);
  const tables = useMemo(() => pageTables(page, allTables), [page, allTables]);
  // The wall used to read the BODY only, so a photo in the gallery or a file added
  // in the Files tab never reached it: both live in their own page fields now.
  // Everything on the page that is an image belongs on the moodboard.
  const images = useMemo(() => {
    const fromFiles = (page?.files ?? [])
      .filter((f) => (f.mime ?? '').startsWith('image/'))
      .map((f): MediaItem => ({ key: `file:${f.id}`, name: f.name || 'File', url: f.url, mime: f.mime ?? '', size: f.size ?? 0, isImage: true, isAudio: false, source: 'Files' }));
    const fromPhotos = (page?.photos ?? []).map(
      (p): MediaItem => ({ key: `photo:${p.id}`, name: p.alt || 'Photo', url: p.url, mime: '', size: 0, isImage: true, isAudio: false, source: p.album ? `Photos · ${p.album}` : 'Photos' }),
    );
    return [...fromPhotos, ...fromFiles, ...collectMedia(page, tables, rows).filter((m) => m.isImage)];
  }, [page, tables, rows]);
  // Per-image notes. A wall of pictures loses its argument fast ("why did we save
  // this one?"), so each card carries a caption. The note rides along inside the
  // photo/file record itself, which is already a JSON blob, so this needs no new
  // PocketBase field and no second thing to keep in sync.
  //
  // Only the page's OWN images (Photos, Files, and anything uploaded here) can be
  // captioned. Images pulled in from the body or from a table cell are mirrors of
  // content that already has its own place to write text, and writing a caption
  // back into them would mean editing the body from a read-only wall.
  const notes = useMemo(() => {
    const m: Record<string, string> = {};
    for (const p of page?.photos ?? []) if (p.note) m[`photo:${p.id}`] = p.note;
    for (const f of page?.files ?? []) if (f.note) m[`file:${f.id}`] = f.note;
    return m;
  }, [page]);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const persistPagePhotos = useData((s) => s.persistPagePhotos);

  const canNote = (key: string) => key.startsWith('photo:') || key.startsWith('file:');

  const saveNote = async (key: string, text: string) => {
    setEditing(null);
    const note = text.trim();
    if ((notes[key] ?? '') === note) return;
    const id = key.slice(key.indexOf(':') + 1);
    if (key.startsWith('photo:')) {
      const next = (page?.photos ?? []).map((p) => (p.id === id ? { ...p, note: note || undefined } : p));
      await persistPagePhotos(pageId, next);
    } else {
      const next = (page?.files ?? []).map((f) => (f.id === id ? { ...f, note: note || undefined } : f));
      await persistPageFiles(pageId, next);
    }
  };

  const [lightbox, setLightbox] = useState<MediaItem | null>(null);
  const [staged, setStaged] = useState<File[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const persistPageFiles = useData((s) => s.persistPageFiles);
  const pageFilesFieldExists = useData((s) => s.pageFilesFieldExists);

  // Add images straight to the moodboard. Same shape as the Files tab: upload, keep
  // the reference in pages.files, and fall back to the page body only if the server
  // does not have that field, so a reference is never left where the orphan sweep
  // cannot see it.
  const runUpload = async (picked: File[]) => {
    setStaged(null);
    setUploading(true);
    try {
      // Same ordering as the Files tab: know there is somewhere to record it before
      // uploading anything, so a missing column cannot leave a blob behind.
      if (!(await pageFilesFieldExists(pageId))) {
        console.error('[moodboard] pages.files column missing. This install predates the field: add an optional JSON field named files to the pages collection in the PocketBase dashboard. The toast stays plain: the person hitting this cannot add a column.');
        toast('Nothing was uploaded: this Waypoint is not set up to store attachments yet. Ask whoever runs it to finish the setup.', 'error');
        return;
      }
      const uploaded: PageFile[] = [];
      const failed: string[] = [];
      for (const f of picked) {
        const source = f.size > MAX_UPLOAD_BYTES ? await compressImageToFile(f).catch(() => f) : f;
        const url = await uploadsApi.upload(source);
        if (url) uploaded.push({ id: uid('pf'), url, name: f.name, mime: f.type || 'image/*', size: source.size });
        else failed.push(f.name);
      }
      if (failed.length) toast(`Could not upload ${failed.join(', ')}.`, 'error');
      if (!uploaded.length) return;
      await persistPageFiles(pageId, [...(page?.files ?? []), ...uploaded]);
      toast(`Added ${uploaded.length} image${uploaded.length > 1 ? 's' : ''}`);
    } finally {
      setUploading(false);
    }
  };

  const addUI = (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const picked = e.target.files;
          if (picked && picked.length) setStaged(Array.from(picked));
          e.target.value = '';
        }}
      />
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
        className="flex items-center gap-1 rounded-md border border-paper-line px-2 py-1 text-xs font-medium text-ink-soft hover:border-clay/50 hover:text-clay disabled:opacity-60 dark:border-coal-line dark:text-coal-soft"
      >
        {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
        {uploading ? 'Adding…' : 'Add images'}
      </button>
    </>
  );
  // A not-yet-persisted thread opened on an image with no thread yet; anchored onto
  // the image node only when its first comment lands (onFirstComment below).
  const pending = useRef<{ src: string; threadId: string } | null>(null);

  // Comment on a body image straight from the wall: reuse its thread if it has one,
  // else mint an id and open the card now, persisting it only on the first comment.
  const onComment = (m: MediaItem, anchor: { top: number; left: number }) => {
    if (!m.pageId) return;
    const id = m.threadId || uid('cmt');
    pending.current = m.threadId ? null : { src: m.url, threadId: id };
    openCommentThread(id, anchor.top, anchor.left);
  };
  const onFirstComment = (threadId: string) => {
    const p = pending.current;
    if (p && p.threadId === threadId) {
      void anchorImageThread(pageId, p.src, threadId);
      pending.current = null;
    }
  };

  // Unreadable body: a strip, matching the other tabs.
  const unreadable = isEnvelope(stored?.content) && !body;

  if (images.length === 0) {
    return (
      <div className="h-full px-3 py-4 sm:px-6">
        {unreadable && <LockedBodyStrip what="images" />}
        <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-clay-wash text-clay dark:bg-clay/15">
          <Images className="h-5 w-5" />
        </div>
        <p className="text-sm text-ink-soft dark:text-coal-soft">No images yet.</p>
        <p className="max-w-xs text-xs text-ink-faint dark:text-coal-soft">
          Add images here, or drop them into the page, set a cover, or add an <span className="font-medium">Attachment</span>
          column to a table here, and they gather into a moodboard.
        </p>
        <div className="mt-2">{addUI}</div>
        </div>
        {staged && <UploadModal files={staged} onCancel={() => setStaged(null)} onUpload={(f) => void runUpload(f)} />}
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto px-3 py-4 sm:px-6">
      {unreadable && <LockedBodyStrip what="images" />}
      <div className="mb-3 flex items-center gap-2">
        <Images className="h-4 w-4 text-clay" />
        <h2 className="text-sm font-semibold text-ink dark:text-coal-text">Moodboard</h2>
        <span className="text-[11px] text-ink-faint dark:text-coal-soft">{images.length} image{images.length === 1 ? '' : 's'}</span>
        <div className="ml-auto">{addUI}</div>
      </div>

      {/* masonry via CSS columns */}
      <div className="columns-2 gap-3 sm:columns-3 lg:columns-4 [&>*]:mb-3">
        {images.map((m) => (
          <div
            key={m.key}
            className="group relative block w-full break-inside-avoid overflow-hidden rounded-xl border border-paper-line bg-paper-panel/40 shadow-sm transition-transform duration-200 hover:z-10 hover:-translate-y-0.5 hover:shadow-lg dark:border-coal-line dark:bg-coal-line/40"
          >
            <button type="button" onClick={() => setLightbox(m)} className="relative block w-full">
              <img src={m.url} alt={m.name} loading="lazy" className="w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
              <span className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end bg-gradient-to-t from-black/70 via-black/10 to-transparent p-2 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                <span className="truncate text-[11px] font-medium text-white/95">{m.name}</span>
              </span>
            </button>

            {editing === m.key ? (
              <textarea
                autoFocus
                rows={2}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => void saveNote(m.key, draft)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') { e.preventDefault(); setEditing(null); }
                  // Enter commits: a caption is one line, not a paragraph.
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void saveNote(m.key, draft); }
                }}
                placeholder="Why this one?"
                className="w-full resize-none border-0 bg-transparent px-2 py-1.5 text-[11px] leading-snug text-ink outline-none placeholder:text-ink-faint dark:text-coal-text dark:placeholder:text-coal-soft"
              />
            ) : notes[m.key] ? (
              <button
                type="button"
                onClick={() => canNote(m.key) && (setDraft(notes[m.key]), setEditing(m.key))}
                className="block w-full px-2 pb-1.5 pt-1 text-left text-[11px] leading-snug text-ink-soft hover:text-ink dark:text-coal-soft dark:hover:text-coal-text"
              >
                {notes[m.key]}
              </button>
            ) : canNote(m.key) ? (
              <button
                type="button"
                onClick={() => { setDraft(''); setEditing(m.key); }}
                className="block w-full px-2 pb-1.5 pt-1 text-left text-[11px] leading-snug text-ink-faint opacity-0 transition-opacity group-hover:opacity-100 dark:text-coal-soft"
              >
                Add a note
              </button>
            ) : null}
          </div>
        ))}
      </div>

      {staged && <UploadModal files={staged} onCancel={() => setStaged(null)} onUpload={(f) => void runUpload(f)} />}
      <MediaPreview item={lightbox} onClose={() => setLightbox(null)} onComment={onComment} />
      {/* The comment popover, editor-less (an image thread has no text mark). Only
          image threads are opened here, so removeThreadMark on close is a no-op. */}
      <InlineCommentThread editor={null} pageId={pageId} onFirstComment={onFirstComment} />
    </div>
  );
}
