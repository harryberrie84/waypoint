import { useMemo, useRef, useState } from 'react';
import { Camera, Upload, Loader2, ArrowDownUp, Pencil, CalendarDays, Check, Trash2 } from 'lucide-react';
import { useData } from '../store/useData';
import { processImageFile, compressImageToFile, oversizeMessage, MAX_UPLOAD_BYTES } from '../lib/image';
import { uploadKey } from '../lib/uploadRefs';
import { uploadsApi } from '../lib/api';
import { photoDateFromFile, loadPhotoMeta } from '../lib/photoMeta';
import { collectMedia } from '../lib/tripViews';
import { toast } from '../store/useToast';
import { confirmAsk } from '../store/useConfirm';
import { MediaPreview } from './MediaPreview';
import type { MediaItem } from '../lib/tripViews';
import type { PagePhoto } from '../types';

// PhotosTab, a travel gallery backed by the dedicated `pages.photos` field, NOT the
// page body, so photos NEVER render in the Notes editor but still show here (and in
// the Files tab) and persist via the simple field-sync (no Yjs, no reseed race).
// Albums + the capture date live on each photo record.

const ALL = '__all__';
const UNFILED = '__unfiled__';

function newId(): string {
  return Math.random().toString(36).slice(2, 9);
}
function dateInputValue(iso: string | undefined): string {
  return iso && iso.length >= 10 ? iso.slice(0, 10) : '';
}
function shortDate(iso: string | undefined): string {
  if (!iso) return 'No date';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'No date';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
function toMediaItem(p: PagePhoto): MediaItem {
  return { key: p.id, name: p.alt || 'Photo', url: p.url, mime: '', size: 0, isImage: true, isAudio: false, source: 'Photos' };
}

// Rank existing albums against a typed query so "fuku" surfaces "Fukuoka" (and any
// soft matches), best first. Only existing albums, a new one is made by typing a name.
function albumScore(album: string, q: string): number {
  if (album === q) return 100;
  if (album.startsWith(q)) return 80;
  if (album.includes(q)) return 60;
  let i = 0; // subsequence: all query chars appear in order (catches typos)
  for (const ch of album) { if (ch === q[i]) i++; if (i === q.length) break; }
  return i === q.length ? 30 : 0;
}
function matchAlbums(albums: string[], q: string): string[] {
  const query = q.trim().toLowerCase();
  if (!query) return albums;
  return albums
    .map((a) => ({ a, s: albumScore(a.toLowerCase(), query) }))
    .filter((x) => x.s > 0)
    .sort((x, y) => y.s - x.s || x.a.localeCompare(y.a))
    .map((x) => x.a);
}

function PhotoEditor({ photo, albums, onPatch }: { photo: PagePhoto; albums: string[]; onPatch: (p: Partial<PagePhoto>) => void }) {
  const [album, setAlbum] = useState(photo.album ?? '');
  const [open, setOpen] = useState(false);
  const matches = matchAlbums(albums, album).filter((a) => a.toLowerCase() !== album.trim().toLowerCase()).slice(0, 6);
  const commit = () => {
    const v = album.trim() || undefined;
    if (v !== photo.album) onPatch({ album: v });
  };
  const inputCls = 'w-full rounded-md border border-paper-line bg-paper px-2 py-1 text-[11px] text-ink outline-none dark:border-coal-line dark:bg-coal dark:text-coal-text';
  return (
    <div className="space-y-1 border-t border-paper-line px-2 py-2 dark:border-coal-line">
      <input type="date" value={dateInputValue(photo.date)} onChange={(e) => onPatch({ date: e.target.value ? `${e.target.value}T12:00:00` : undefined })} className={inputCls} />
      <div className="relative">
        <input
          value={album}
          placeholder="Album (type to search, e.g. Fuku…)"
          onChange={(e) => { setAlbum(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => { setOpen(false); commit(); }}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
          className={inputCls}
        />
        {open && matches.length > 0 && (
          <div className="absolute left-0 right-0 z-20 mt-0.5 overflow-hidden rounded-md border border-paper-line bg-paper shadow-lg dark:border-coal-line dark:bg-coal-panel">
            {matches.map((a) => (
              <button
                key={a}
                type="button"
                // mousedown fires before the input's blur, so the pick registers
                onMouseDown={(e) => { e.preventDefault(); setAlbum(a); onPatch({ album: a }); setOpen(false); }}
                className="block w-full px-2 py-1 text-left text-[11px] text-ink hover:bg-clay/10 dark:text-coal-text"
              >
                {a}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface Section {
  key: string;
  label: string;
  items: PagePhoto[];
}

export function PhotosTab({ pageId, editable = false, body }: { pageId: string; editable?: boolean; body?: object | null }) {
  const stored = useData((s) => s.pages[pageId]);
  // Encrypted pages keep an envelope in the store; PageView passes the decrypted body.
  const page = useMemo(() => (stored && body ? { ...stored, content: body } : stored), [stored, body]);
  const setPagePhotos = useData((s) => s.setPagePhotos);
  const persistPagePhotos = useData((s) => s.persistPagePhotos);
  const detachManyFromPage = useData((s) => s.detachManyFromPage);
  const photos = useMemo(() => page?.photos ?? [], [page?.photos]);

  const [album, setAlbum] = useState<string>(ALL);
  const [newestFirst, setNewestFirst] = useState(false);
  const [preview, setPreview] = useState<MediaItem | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const albums = useMemo(() => [...new Set(photos.map((p) => p.album).filter((a): a is string => !!a))].sort((a, b) => a.localeCompare(b)), [photos]);
  const hasUnfiled = photos.some((p) => !p.album);

  const write = (next: PagePhoto[]) => setPagePhotos(pageId, next);
  const patch = (id: string, p: Partial<PagePhoto>) => write(photos.map((ph) => (ph.id === id ? { ...ph, ...p } : ph)));
  const remove = (id: string) => write(photos.filter((ph) => ph.id !== id));

  // Images that older uploads left in the page BODY (they still show in Notes/Files
  // but not in this gallery, which now reads pages.photos). Offer a one-click import
  // so nothing has to be re-uploaded; their old date/album come along from photoMeta.
  const bodyImages = useMemo(
    () => collectMedia(page, [], {}).filter((m) => m.isImage && (m.source === 'Page body' || m.source === 'Gallery')),
    [page],
  );
  // Keyed by upload id, not by url. A gallery entry and its body copy are stored
  // at different times, so on any install reached by more than one host (a
  // staging clone of live, a LAN ip vs the domain) the strings stop matching and
  // this offers to re-import photos that are already in the gallery.
  const galleryKeys = useMemo(() => new Set(photos.map((p) => uploadKey(p.url))), [photos]);
  const importable = useMemo(() => bodyImages.filter((m) => !galleryKeys.has(uploadKey(m.url))), [bodyImages, galleryKeys]);
  const stillInNotes = useMemo(() => bodyImages.filter((m) => galleryKeys.has(uploadKey(m.url))), [bodyImages, galleryKeys]);

  const doImport = (removeAfter: boolean) => {
    if (!importable.length) return;
    const meta = loadPhotoMeta(pageId);
    const urls = importable.map((m) => m.url);
    const added: PagePhoto[] = importable.map((m) => ({
      id: newId(),
      url: m.url,
      alt: m.name && m.name !== 'Image' ? m.name : undefined,
      date: meta[m.url]?.date,
      album: meta[m.url]?.album,
    }));
    if (!removeAfter) {
      write([...photos, ...added]);
      toast(`Imported ${added.length} photo${added.length > 1 ? 's' : ''} to the gallery`);
      return;
    }
    // Moving means DELETING the images from the notes body, so the gallery has to be
    // safely on the server first. It used to fire both at once: an optimistic,
    // debounced gallery write and an immediate body rewrite. If the gallery write
    // lost (no `photos` field on the collection, which is the case on any install
    // where the reconciler has not run, or simply a failed request) the images were
    // stripped from the body while the gallery lived only in this browser, so every
    // other device saw them nowhere. Persist, verify, and only then remove.
    void (async () => {
      const saved = await persistPagePhotos(pageId, [...photos, ...added]);
      if (!saved) {
        toast('Could not save the gallery, so nothing was removed from Notes. Your photos are untouched.', 'error');
        return;
      }
      const n = await detachManyFromPage(pageId, urls);
      toast(`Imported ${added.length}${n ? `, removed ${n} from Notes` : ''}`);
    })();
  };
  const confirmMove = () =>
    confirmAsk({
      title: 'Move photos into the gallery?',
      message: `${importable.length} photo${importable.length > 1 ? 's' : ''} from this page's notes will be added to your gallery and removed from the Notes body. Nothing is deleted, they live in the gallery (and the Files tab) instead.`,
      confirmLabel: 'Move',
      destructive: false,
      onConfirm: () => doImport(true),
    });
  const confirmRemoveFromNotes = () =>
    confirmAsk({
      title: 'Remove from Notes?',
      message: `${stillInNotes.length} gallery photo${stillInNotes.length > 1 ? 's' : ''} also appear in the Notes body. Remove them from Notes? They stay in your gallery and the Files tab.`,
      confirmLabel: 'Remove from Notes',
      destructive: false,
      onConfirm: () => void detachManyFromPage(pageId, stillInNotes.map((m) => m.url)).then((n) => { if (n) toast(`Removed ${n} from Notes`); }),
    });

  const importBanner = !editable ? null : importable.length > 0 ? (
    <div className="mb-4 rounded-xl border border-clay/40 bg-clay-wash px-3 py-2.5 dark:bg-clay/10">
      <p className="text-xs text-ink dark:text-coal-text">
        <span className="font-semibold">{importable.length} photo{importable.length > 1 ? 's' : ''}</span> from this page&apos;s notes {importable.length > 1 ? 'are' : 'is'} not in your gallery yet.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" onClick={confirmMove} className="rounded-lg bg-clay px-3 py-1 text-xs font-semibold text-white hover:bg-clay/90">Move into gallery</button>
        <button type="button" onClick={() => doImport(false)} className="rounded-lg border border-paper-line px-3 py-1 text-xs font-medium text-ink-soft hover:border-clay dark:border-coal-line dark:text-coal-soft">Just copy (keep in Notes)</button>
      </div>
      <p className="mt-1.5 text-[10px] text-ink-faint dark:text-coal-soft">Move lifts them out of the Notes body; copy leaves them in both. Old dates and albums come along.</p>
    </div>
  ) : stillInNotes.length > 0 ? (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-paper-line bg-paper-panel/40 px-3 py-2 dark:border-coal-line dark:bg-coal-line/20">
      <p className="text-xs text-ink-soft dark:text-coal-soft">{stillInNotes.length} gallery photo{stillInNotes.length > 1 ? 's' : ''} also show in Notes.</p>
      <button type="button" onClick={confirmRemoveFromNotes} className="rounded-lg border border-paper-line px-2.5 py-1 text-[11px] font-medium text-ink-soft hover:border-clay dark:border-coal-line dark:text-coal-soft">Remove from Notes</button>
    </div>
  ) : null;

  const sections = useMemo<Section[]>(() => {
    const dir = newestFirst ? -1 : 1;
    const byDate = (arr: PagePhoto[]) =>
      [...arr].sort((a, b) => {
        const da = a.date; const db = b.date;
        if (da && db) return da < db ? -dir : da > db ? dir : 0;
        if (da) return -1; if (db) return 1; return 0;
      });
    if (album === ALL) {
      const secs: Section[] = [];
      for (const a of albums) {
        const items = byDate(photos.filter((p) => p.album === a));
        if (items.length) secs.push({ key: a, label: a, items });
      }
      const unfiled = byDate(photos.filter((p) => !p.album));
      if (unfiled.length) secs.push({ key: UNFILED, label: albums.length ? 'Unfiled' : 'All photos', items: unfiled });
      return secs;
    }
    const items = byDate(photos.filter((p) => (album === UNFILED ? !p.album : p.album === album)));
    return [{ key: album, label: album === UNFILED ? 'Unfiled' : album, items }];
  }, [photos, albums, album, newestFirst]);

  const onPick = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const images = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (!images.length) return;
    const intoAlbum = album !== ALL && album !== UNFILED ? album : undefined;
    setProgress({ done: 0, total: images.length });
    try {
      const added: PagePhoto[] = [];
      for (const file of images) {
        const date = await photoDateFromFile(file);
        const source = file.size > MAX_UPLOAD_BYTES ? await compressImageToFile(file).catch(() => file) : file;
        const url = (await uploadsApi.upload(source)) ?? (await processImageFile(file).catch(() => null));
        if (url) added.push({ id: newId(), url, alt: file.name, date, album: intoAlbum });
        else toast(oversizeMessage(file.name, file.size) ?? `Could not add ${file.name}.`, 'error');
        setProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
      }
      if (added.length) {
        write([...photos, ...added]);
        toast(`Added ${added.length} photo${added.length > 1 ? 's' : ''}${intoAlbum ? ` to ${intoAlbum}` : ''}`);
      }
    } finally {
      setProgress(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const addUI = editable ? (
    <>
      <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => void onPick(e.target.files)} />
      <button type="button" disabled={progress != null} onClick={() => fileRef.current?.click()} className="flex items-center gap-1.5 rounded-lg bg-clay px-3 py-1.5 text-xs font-semibold text-white hover:bg-clay/90 disabled:opacity-60">
        {progress ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
        {progress ? `Adding ${progress.done}/${progress.total}…` : 'Add photos'}
      </button>
    </>
  ) : null;

  if (photos.length === 0) {
    return (
      <div className="mx-auto h-full max-w-5xl overflow-y-auto px-3 py-4 sm:px-6">
        {importBanner}
        <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-clay-wash text-clay dark:bg-clay/15">
            <Camera className="h-5 w-5" />
          </div>
          <p className="text-sm font-medium text-ink dark:text-coal-text">No photos yet.</p>
          <p className="max-w-xs text-xs text-ink-faint dark:text-coal-soft">
            Add your trip pics here. They sort by the day each was taken and file into albums like Osaka or Tokyo. Photos
            live here and in the Files tab, they never clutter your notes.
          </p>
          {addUI && <div className="mt-2">{addUI}</div>}
        </div>
      </div>
    );
  }

  const chips: { id: string; label: string }[] = [
    { id: ALL, label: `All ${photos.length}` },
    ...albums.map((a) => ({ id: a, label: a })),
    ...(hasUnfiled ? [{ id: UNFILED, label: 'Unfiled' }] : []),
  ];

  return (
    <div className="mx-auto h-full max-w-5xl overflow-y-auto px-3 py-4 sm:px-6">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Camera className="h-4 w-4 shrink-0 text-clay" />
        <h2 className="text-base font-bold tracking-tight text-ink dark:text-coal-text">Photos</h2>
        <span className="text-[11px] text-ink-faint dark:text-coal-soft">{photos.length}</span>
        {addUI}
        <button type="button" onClick={() => setNewestFirst((n) => !n)} className="ml-auto flex items-center gap-1 rounded-full border border-paper-line px-2.5 py-1 text-[11px] text-ink-soft hover:border-clay dark:border-coal-line dark:text-coal-soft" title="Toggle sort order">
          <ArrowDownUp className="h-3 w-3" /> {newestFirst ? 'Newest' : 'Oldest'} first
        </button>
      </div>

      {importBanner}

      {(albums.length > 0 || hasUnfiled) && (
        <div className="mb-4 flex items-center gap-1.5 overflow-x-auto pb-1">
          {chips.map((c) => (
            <button key={c.id} type="button" onClick={() => setAlbum(c.id)} className={['shrink-0 rounded-full border px-3 py-1 text-[11px] font-medium', album === c.id ? 'border-clay bg-clay text-white' : 'border-paper-line text-ink-soft hover:border-clay dark:border-coal-line dark:text-coal-soft'].join(' ')}>
              {c.label}
            </button>
          ))}
        </div>
      )}

      <div className="space-y-6 pb-6">
        {sections.map((sec) => (
          <section key={sec.key}>
            {album === ALL && albums.length > 0 && (
              <div className="mb-2 flex items-baseline gap-2">
                <h3 className="text-sm font-semibold text-ink dark:text-coal-text">{sec.label}</h3>
                <span className="text-[11px] text-ink-faint dark:text-coal-soft">{sec.items.length}</span>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {sec.items.map((p) => {
                const isEditing = editingId === p.id;
                return (
                  <div key={p.id} className="group relative overflow-hidden rounded-xl bg-paper ring-1 ring-paper-line transition-shadow hover:shadow-md dark:bg-coal-panel dark:ring-coal-line">
                    <button type="button" onClick={() => setPreview(toMediaItem(p))} title={`Preview ${p.alt || 'photo'}`} className="relative block aspect-square w-full overflow-hidden">
                      <img src={p.url} alt={p.alt || ''} loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" />
                    </button>
                    {editable && (
                      <div className="absolute right-1.5 top-1.5 flex gap-1 opacity-90 sm:opacity-0 sm:group-hover:opacity-100">
                        <button type="button" onClick={() => setEditingId((u) => (u === p.id ? null : p.id))} className="flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm transition hover:bg-black/70" title="Edit date and album">
                          {isEditing ? <Check className="h-3 w-3" /> : <Pencil className="h-3 w-3" />}
                        </button>
                        <button type="button" onClick={() => remove(p.id)} className="flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm transition hover:bg-rose-600" title="Remove photo">
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    )}
                    {isEditing && editable ? (
                      <PhotoEditor photo={p} albums={albums} onPatch={(patchObj) => patch(p.id, patchObj)} />
                    ) : (
                      <div className="flex items-center justify-between gap-1 px-2 py-1.5">
                        <span className="flex min-w-0 items-center gap-1 text-[11px] text-ink-soft dark:text-coal-soft">
                          <CalendarDays className="h-3 w-3 shrink-0 opacity-70" />
                          <span className="truncate">{shortDate(p.date)}</span>
                        </span>
                        {p.album && album === ALL && <span className="shrink-0 truncate text-[10px] font-medium text-clay">{p.album}</span>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <MediaPreview item={preview} onClose={() => setPreview(null)} />
    </div>
  );
}
