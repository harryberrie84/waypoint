import { Fragment, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { LayoutGrid, Table2, Plus, Trash2, ImagePlus, X, Download } from 'lucide-react';
import { processImageFile } from '../lib/image';
import { uploadsApi } from '../lib/api';
import { toast } from '../store/useToast';
import { defaultTiers, buildTierRows, tierForRating, ratingForInsert, TIER_PALETTE, type TierDef, type TierItem, type TierListData, type TierRow } from '../lib/tierList';
import { layoutTierImage, tierImageFilename } from '../lib/tierImage';

// tierListBlock, a rank-things-into-tiers widget (also available as a page tab
// via TierListTab). Two views toggled in the header: Tiers (coloured bands, drag
// items between them, add items straight in, each item a card with image + name +
// score) and a Ratings table (set name/image/score). A tier owns a score range;
// an item's score picks its tier and its left-to-right order (highest first).
// Items with no score live in the Unranked pool at the bottom. Dragging an item
// into a tier gives it a score that lands it where you dropped it. All state is
// in the value (title/mode/tiers/items), so it rides the page's normal sync.

// One drag at a time, module-scoped (the calendar view uses the same handoff).
let dragId: string | null = null;

function newId(): string {
  return Math.random().toString(36).slice(2, 9);
}

function readTiers(attrs: Record<string, unknown>): TierDef[] {
  const raw = attrs.tiers;
  return Array.isArray(raw) && raw.length ? (raw as TierDef[]) : defaultTiers();
}
function readItems(attrs: Record<string, unknown>): TierItem[] {
  const raw = attrs.items;
  return Array.isArray(raw) ? (raw as TierItem[]) : [];
}

// Image cell used in the Ratings table.
function ImageCell({ image, editable, onUpload, onClear }: { image: string; editable: boolean; onUpload: (f: File | undefined) => void; onClear: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="relative h-10 w-10">
      {image ? (
        <img src={image} alt="" className="h-10 w-10 rounded object-cover" />
      ) : (
        <div className="flex h-10 w-10 items-center justify-center rounded border border-dashed border-paper-line text-ink-faint dark:border-coal-line dark:text-coal-soft">
          <ImagePlus className="h-4 w-4" />
        </div>
      )}
      {editable && (
        <>
          <button type="button" onClick={() => ref.current?.click()} className="absolute inset-0 rounded opacity-0 hover:bg-ink/25 hover:opacity-100" title="Upload an image" />
          <input ref={ref} type="file" accept="image/*" className="hidden" onChange={(e) => { onUpload(e.target.files?.[0]); e.target.value = ''; }} />
          {image && (
            <button type="button" onClick={onClear} className="absolute -right-1 -top-1 rounded-full bg-ink p-0.5 text-white dark:bg-coal-text dark:text-coal" title="Remove image">
              <X className="h-2.5 w-2.5" />
            </button>
          )}
        </>
      )}
    </div>
  );
}

// A card in a tier band: draggable by its image, with inline name + image editing
// so a whole tier list can be built without leaving the Tiers view.
// A thin insertion line shown between cards during a drag, previewing where the
// item will land when you let go.
function DropLine({ big }: { big: boolean }) {
  return <span className={['w-[3px] shrink-0 self-stretch rounded bg-clay', big ? 'min-h-[5rem]' : 'min-h-[3.5rem]'].join(' ')} />;
}

function ItemChip({ item, big, editable, dim, onGrab, onRename, onUpload, onRemove }: {
  item: TierItem;
  big: boolean;
  editable: boolean;
  dim: boolean;
  onGrab: (e: ReactPointerEvent) => void;
  onRename: (t: string) => void;
  onUpload: (f: File | undefined) => void;
  onRemove: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const size = big ? 'h-20 w-20' : 'h-14 w-14';
  const wrap = big ? 'w-20' : 'w-14';
  return (
    <div
      data-item={item.id}
      className={['group relative flex flex-col items-center', wrap, dim ? 'pointer-events-none opacity-40' : ''].join(' ')}
      title={`${item.text || 'Untitled'}${item.rating != null ? ` · ${Math.round(item.rating)}` : ''}`}
    >
      <div
        className={['relative overflow-hidden rounded-md border border-paper-line bg-paper-panel dark:border-coal-line dark:bg-coal', size, editable ? 'cursor-grab select-none active:cursor-grabbing' : ''].join(' ')}
        onPointerDown={editable ? onGrab : undefined}
      >
        {item.image ? (
          <img src={item.image} alt="" className="h-full w-full object-cover" draggable={false} />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-sm font-semibold text-ink-faint dark:text-coal-soft">{(item.text || '?').slice(0, 2)}</div>
        )}
        {editable && (
          <>
            <button type="button" onClick={() => ref.current?.click()} className="absolute inset-x-0 bottom-0 flex h-4 items-center justify-center bg-ink/40 text-white opacity-0 group-hover:opacity-100" title="Upload image"><ImagePlus className="h-2.5 w-2.5" /></button>
            <input ref={ref} type="file" accept="image/*" className="hidden" onChange={(e) => { onUpload(e.target.files?.[0]); e.target.value = ''; }} />
          </>
        )}
      </div>
      {editable ? (
        <input value={item.text} onChange={(e) => onRename(e.target.value)} placeholder="name" className={['mt-0.5 w-full rounded bg-transparent text-center text-ink-soft outline-none placeholder:text-ink-faint dark:text-coal-soft', big ? 'text-xs' : 'text-[10px]'].join(' ')} />
      ) : (
        <span className={['mt-0.5 w-full truncate text-center text-ink-soft dark:text-coal-soft', big ? 'text-xs' : 'text-[10px]'].join(' ')}>{item.text}</span>
      )}
      {item.rating != null && <span className="absolute -right-1 -top-1 rounded-full bg-ink px-1 text-[9px] font-semibold text-white dark:bg-coal-text dark:text-coal">{Math.round(item.rating)}</span>}
      {editable && <button type="button" onClick={onRemove} className="absolute -left-1 -top-1 rounded-full bg-ink p-0.5 text-white opacity-0 group-hover:opacity-100 dark:bg-coal-text dark:text-coal" title="Remove item"><X className="h-2.5 w-2.5" /></button>}
    </div>
  );
}

function TierEditor({ tier, onChange, onRemove, onClose }: { tier: TierDef; onChange: (p: Partial<TierDef>) => void; onRemove: () => void; onClose: () => void }) {
  return (
    <div className="absolute left-full top-0 z-20 ml-1 w-56 rounded-lg border border-paper-line bg-paper p-2 text-ink shadow-xl dark:border-coal-line dark:bg-coal-panel dark:text-coal-text" onMouseDown={(e) => e.stopPropagation()}>
      <div className="mb-1.5 flex items-center gap-1.5">
        <input value={tier.label} onChange={(e) => onChange({ label: e.target.value })} className="w-12 rounded border border-paper-line bg-paper px-1 py-0.5 text-center text-sm font-bold outline-none focus:border-clay dark:border-coal-line dark:bg-coal" />
        <span className="text-xs text-ink-faint dark:text-coal-soft">tier label</span>
        <button type="button" onClick={onClose} className="ml-auto rounded p-0.5 text-ink-faint hover:text-clay"><X className="h-3.5 w-3.5" /></button>
      </div>
      <div className="mb-2 flex flex-wrap items-center gap-1">
        {TIER_PALETTE.map((c) => (
          <button key={c} type="button" onClick={() => onChange({ color: c })} className={['h-5 w-5 rounded-full border border-black/10', tier.color === c ? 'ring-2 ring-clay ring-offset-1 dark:ring-offset-coal-panel' : ''].join(' ')} style={{ backgroundColor: c }} title={c} />
        ))}
        <input type="color" value={tier.color} onChange={(e) => onChange({ color: e.target.value })} className="h-5 w-6 cursor-pointer rounded border-0 bg-transparent p-0" title="Custom colour" />
      </div>
      <div className="flex items-center gap-1 text-xs text-ink-soft dark:text-coal-soft">
        <span>score</span>
        <input type="number" value={tier.min} onChange={(e) => onChange({ min: Number(e.target.value) })} className="w-14 rounded border border-paper-line bg-paper px-1 py-0.5 outline-none focus:border-clay dark:border-coal-line dark:bg-coal" />
        <span>to</span>
        <input type="number" value={tier.max} onChange={(e) => onChange({ max: Number(e.target.value) })} className="w-14 rounded border border-paper-line bg-paper px-1 py-0.5 outline-none focus:border-clay dark:border-coal-line dark:bg-coal" />
      </div>
      <button type="button" onClick={onRemove} className="mt-2 flex items-center gap-1 text-xs text-rose-500 hover:text-rose-600"><Trash2 className="h-3 w-3" /> remove tier</button>
    </div>
  );
}

/** Load an image for the canvas, or null if it cannot be drawn. Uploads may live
 *  on another origin, and a tainted canvas throws on toBlob, so a picture that
 *  will not load anonymously is skipped and drawn as its initials instead. A
 *  half-rendered export beats a failed one. */
function loadForCanvas(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    if (!src.startsWith('data:')) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Draw the whole list to a PNG and hand it to the browser as a download.
 *  Always light-themed: the file leaves the app and lands in a chat window. */
async function exportTierPng(title: string, rows: TierRow[]) {
  const layout = layoutTierImage(rows);
  const scale = 2; // retina-ish, so the text is not mushy when it is reshared
  const canvas = document.createElement('canvas');
  canvas.width = layout.width * scale;
  canvas.height = layout.height * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    toast('This browser cannot draw the image.', 'error');
    return;
  }
  ctx.scale(scale, scale);

  ctx.fillStyle = '#faf8f5';
  ctx.fillRect(0, 0, layout.width, layout.height);

  ctx.fillStyle = '#1c1a17';
  ctx.font = '600 26px ui-sans-serif, system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(title || 'Tier list', 20, layout.headerHeight / 2);

  // Every picture up front: drawImage is synchronous, so they have to be decoded
  // before the first band is painted or the export races the network.
  const sources = new Map<string, HTMLImageElement | null>();
  const all = layout.bands.flatMap((b) => b.cards.map((c) => c.image)).filter(Boolean);
  await Promise.all([...new Set(all)].map(async (src) => sources.set(src, await loadForCanvas(src))));

  for (const band of layout.bands) {
    ctx.fillStyle = band.color;
    ctx.fillRect(0, band.y, layout.labelWidth, band.height);
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 30px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(band.label, layout.labelWidth / 2, band.y + band.height / 2, layout.labelWidth - 12);

    ctx.fillStyle = '#f1ede7';
    ctx.fillRect(layout.labelWidth, band.y, layout.width - layout.labelWidth, band.height);

    for (const card of band.cards) {
      const img = sources.get(card.image) ?? null;
      ctx.save();
      roundRect(ctx, card.x, card.y, card.size, card.size, 8);
      ctx.clip();
      if (img) {
        // cover-fit, matching the on-screen object-cover
        const r = Math.max(card.size / img.width, card.size / img.height);
        const w = img.width * r;
        const h = img.height * r;
        ctx.drawImage(img, card.x + (card.size - w) / 2, card.y + (card.size - h) / 2, w, h);
      } else {
        ctx.fillStyle = '#e3ddd4';
        ctx.fillRect(card.x, card.y, card.size, card.size);
        ctx.fillStyle = '#8a8377';
        ctx.font = '600 30px ui-sans-serif, system-ui, sans-serif';
        ctx.fillText((card.text || '?').slice(0, 2), card.x + card.size / 2, card.y + card.size / 2);
      }
      ctx.restore();

      ctx.fillStyle = '#3a352e';
      ctx.font = '400 13px ui-sans-serif, system-ui, sans-serif';
      ctx.fillText(card.text || '', card.x + card.size / 2, card.y + card.size + 11, card.size);
    }
  }

  ctx.textAlign = 'left';
  ctx.fillStyle = '#8a8377';
  ctx.font = '400 12px ui-sans-serif, system-ui, sans-serif';
  ctx.fillText('Waypoint', 20, layout.height - 18);

  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
  if (!blob) {
    toast('Could not save the image. An upload on another domain may have blocked it.', 'error');
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = tierImageFilename(title, new Date().toISOString());
  a.click();
  URL.revokeObjectURL(url);
}

// The shared tier-list UI. `bare` drops the card chrome (for the full-page tab);
// `big` scales the cards/labels up (for the tab).
export function TierListEditor({
  value,
  readLive,
  onChange,
  editable,
  bare = false,
  big = false,
}: {
  value: TierListData;
  /** The value as it is RIGHT NOW, for writes. See the note on `liveValue` below. */
  readLive?: () => TierListData;
  onChange: (patch: Partial<TierListData>) => void;
  editable: boolean;
  bare?: boolean;
  big?: boolean;
}) {
  const title = value.title || '';
  const mode = value.mode === 'table' ? 'table' : 'tiers';
  const tiers = value.tiers?.length ? value.tiers : defaultTiers();
  const items = value.items ?? [];
  const [editTier, setEditTier] = useState<string | null>(null);
  // Where a dragged item would land: which band, and before which card (null =
  // the end of that band). Drives both the drop-line preview and the drop.
  const [dropAt, setDropAt] = useState<{ tier: string; before: string | null } | null>(null);
  const dropAtRef = useRef<{ tier: string; before: string | null } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  // If the block unmounts mid-drag (page switch, block deleted), tear the drag's
  // window listeners down instead of leaking a stale closure until the next pointerup.
  const dragTeardownRef = useRef<(() => void) | null>(null);
  useEffect(() => () => dragTeardownRef.current?.(), []);
  const applyDropAt = (v: { tier: string; before: string | null } | null) => { dropAtRef.current = v; setDropAt(v); };
  const clearDrag = () => { applyDropAt(null); dragId = null; };

  // Touch-friendly drag. HTML5 drag-and-drop never fires on a finger, so cards move
  // on Pointer Events (mouse + touch + pen). On touch we require a short HOLD before
  // the drag arms, so a normal swipe still scrolls the page; a mouse drags at once.
  // The grabbed card goes pointer-events-none so elementFromPoint sees the band/card
  // under the finger, and while armed we preventDefault touchmove to stop scrolling.
  const startDrag = (itemId: string, e: ReactPointerEvent) => {
    if ((e.target as HTMLElement).closest('button, input, label')) return; // let the controls work
    const touch = e.pointerType === 'touch';
    const sx = e.clientX;
    const sy = e.clientY;
    let armed = false;
    let holdTimer = 0;
    const preventScroll = (ev: TouchEvent) => ev.preventDefault();
    const teardown = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      document.removeEventListener('touchmove', preventScroll);
      if (holdTimer) clearTimeout(holdTimer);
      dragTeardownRef.current = null;
    };
    const arm = () => {
      armed = true;
      dragId = itemId;
      setDragging(itemId);
      if (touch) document.addEventListener('touchmove', preventScroll, { passive: false });
    };
    const move = (ev: PointerEvent) => {
      if (!armed) {
        // Moved before the hold completed: it's a scroll, let it go.
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) > 10) { teardown(); }
        return;
      }
      const el = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
      const band = el?.closest('[data-tier]');
      if (!band) return;
      const tier = band.getAttribute('data-tier') || 'pool';
      const cardId = el?.closest('[data-item]')?.getAttribute('data-item') || null;
      applyDropAt({ tier, before: cardId && cardId !== itemId ? cardId : null });
    };
    const finish = () => {
      const at = dropAtRef.current;
      if (armed && dragId && at) {
        const tier = at.tier === 'pool' ? null : tiers.find((t) => t.id === at.tier) ?? null;
        placeItem(dragId, tier, at.before ?? undefined);
      }
      if (armed) { clearDrag(); setDragging(null); }
    };
    const up = () => { teardown(); finish(); };
    const cancel = () => { teardown(); if (armed) { clearDrag(); setDragging(null); } };
    dragTeardownRef.current = teardown;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    if (touch) {
      holdTimer = window.setTimeout(arm, 260);
    } else {
      e.preventDefault();
      arm();
    }
  };

  // Every mutation resolves its base from the LIVE value at write time, never from
  // the `value` this render closed over. `value` is the list as of the last render,
  // and an image upload finishes hundreds of milliseconds later, by which time the
  // list has usually moved on (the add that preceded it, a collaborator's edit, a
  // sync echo). Writing a full items array built on the older snapshot puts that
  // snapshot back, which is exactly "the picture appears and then goes again, and
  // is only there after a refresh": the write that removed it was ours. Same
  // landmine the reservation and compare widgets already carry.
  const liveValue = (): TierListData => readLive?.() ?? value;
  const liveTiers = (): TierDef[] => {
    const t = liveValue().tiers;
    return t?.length ? t : defaultTiers();
  };
  const liveItems = (): TierItem[] => liveValue().items ?? [];
  const write = (patch: Partial<TierListData>) => onChange(patch);
  const setTiers = (fn: (cur: TierDef[]) => TierDef[]) => write({ tiers: fn(liveTiers()) });
  const setItems = (fn: (cur: TierItem[]) => TierItem[]) => write({ items: fn(liveItems()) });
  const patchTier = (id: string, p: Partial<TierDef>) => setTiers((cur) => cur.map((t) => (t.id === id ? { ...t, ...p } : t)));
  const patchItem = (id: string, p: Partial<TierItem>) => setItems((cur) => cur.map((it) => (it.id === id ? { ...it, ...p } : it)));
  const removeItem = (id: string) => setItems((cur) => cur.filter((it) => it.id !== id));
  const addTier = () => setTiers((cur) => [...cur, { id: newId(), label: 'New', color: TIER_PALETTE[cur.length % TIER_PALETTE.length], min: 0, max: 0 }]);
  const removeTier = (id: string) => setTiers((cur) => cur.filter((t) => t.id !== id));
  // Add a blank item into a tier (a mid-range score) or the pool (no score).
  const addItemTo = (tier: TierDef | null) => {
    const rating = tier ? (Math.min(tier.min, tier.max) + Math.max(tier.min, tier.max)) / 2 : null;
    setItems((cur) => [...cur, { id: newId(), text: '', image: '', rating }]);
  };

  // Upload first, inline only as a fallback. This was the one image path in the app
  // that skipped the upload and always embedded a data URL, and a tier list is by
  // nature a wall of pictures: three or four of them pushed the JSON past the 2 MB
  // field cap, the server rejected the save, and the picture you had just added sat
  // there until an echo replaced it with the last copy that fit. An uploaded url is
  // a hundred bytes, so the list stops outgrowing its own field.
  const uploadImage = async (id: string, file: File | undefined) => {
    if (!file) return;
    try {
      patchItem(id, { image: (await uploadsApi.upload(file)) ?? (await processImageFile(file)) });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'could not add that image', 'error');
    }
  };

  // Move the dragged item into `tier` (or the pool), before `beforeId` if given.
  const placeItem = (itemId: string, tier: TierDef | null, beforeId?: string) => {
    if (!tier) {
      patchItem(itemId, { rating: null });
      return;
    }
    const others = liveItems().filter((i) => i.id !== itemId);
    const sorted = buildTierRows(liveTiers(), others).find((r) => r.tier?.id === tier.id)?.items ?? [];
    const foundIdx = beforeId ? sorted.findIndex((i) => i.id === beforeId) : -1;
    const insertIdx = foundIdx >= 0 ? foundIdx : sorted.length;
    patchItem(itemId, { rating: ratingForInsert(tier, sorted, insertIdx) });
  };

  const rows = buildTierRows(tiers, items, editable);

  const tabBtn = (m: 'tiers' | 'table', Icon: typeof LayoutGrid, label: string) => (
    <button type="button" onClick={() => write({ mode: m })} className={['flex items-center gap-1 rounded px-2 py-0.5', mode === m ? 'bg-clay text-white' : 'text-ink-soft hover:text-ink dark:text-coal-soft dark:hover:text-coal-text'].join(' ')}>
      <Icon className="h-3 w-3" /> {label}
    </button>
  );

  const labelW = big ? 'w-20' : 'w-16';
  const bandMin = big ? 'min-h-[92px]' : 'min-h-[68px]';

  return (
    <div className={['overflow-hidden bg-paper dark:bg-coal-panel', bare ? '' : 'rounded-xl border border-paper-line shadow-sm dark:border-coal-line'].join(' ')}>
      <div className="flex items-center gap-2 border-b border-paper-line px-3 py-2 dark:border-coal-line">
        <LayoutGrid className="h-4 w-4 shrink-0 text-clay" />
        {editable ? (
          <input value={title} onChange={(e) => write({ title: e.target.value })} placeholder="Tier list" className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-ink outline-none placeholder:text-ink-faint dark:text-coal-text" />
        ) : (
          <span className="min-w-0 flex-1 text-sm font-semibold text-ink dark:text-coal-text">{title || 'Tier list'}</span>
        )}
        {/* Saving the picture is not an edit, so read-only viewers get it too. */}
        <button
          type="button"
          onClick={() => void exportTierPng(title, buildTierRows(tiers, items))}
          className="flex shrink-0 items-center gap-1 rounded-md border border-paper-line px-2 py-1 text-xs font-medium text-ink-soft hover:border-clay/50 hover:text-clay dark:border-coal-line dark:text-coal-soft"
          title="Save this tier list as a PNG"
        >
          <Download className="h-3 w-3" /> Image
        </button>
        {editable && (
          <div className="flex shrink-0 items-center gap-0.5 rounded-md border border-paper-line p-0.5 text-xs dark:border-coal-line">
            {tabBtn('tiers', LayoutGrid, 'Tiers')}
            {tabBtn('table', Table2, 'Ratings')}
          </div>
        )}
      </div>

      {mode === 'tiers' ? (
        <div className="flex flex-col gap-px bg-paper-line dark:bg-coal-line">
          {rows.map((row) => {
            const dropId = row.tier?.id ?? 'pool';
            return (
              <div
                key={dropId}
                data-tier={dropId}
                className={[bandMin, 'flex items-stretch bg-paper dark:bg-coal-panel', dropAt?.tier === dropId ? 'ring-2 ring-inset ring-clay/60' : ''].join(' ')}
              >
                <div className={['relative flex shrink-0 items-center justify-center p-1', labelW].join(' ')} style={{ backgroundColor: row.tier?.color ?? undefined }}>
                  {row.tier ? (
                    <button type="button" disabled={!editable} onClick={() => setEditTier(editTier === row.tier!.id ? null : row.tier!.id)} className={['font-bold text-white drop-shadow disabled:cursor-default', big ? 'text-2xl' : 'text-lg'].join(' ')} title={editable ? 'Edit tier colour, label and score range' : undefined}>
                      {row.tier.label || '?'}
                    </button>
                  ) : (
                    <span className="text-center text-[10px] font-semibold uppercase tracking-wide text-ink-faint dark:text-coal-soft">Unranked</span>
                  )}
                  {editable && row.tier && editTier === row.tier.id && (
                    <TierEditor tier={row.tier} onChange={(p) => patchTier(row.tier!.id, p)} onRemove={() => { removeTier(row.tier!.id); setEditTier(null); }} onClose={() => setEditTier(null)} />
                  )}
                </div>
                <div className="flex flex-1 flex-wrap content-center items-center gap-2 p-2">
                  {row.items.map((it) => (
                    <Fragment key={it.id}>
                      {editable && dropAt?.tier === dropId && dropAt.before === it.id && dragId !== it.id && <DropLine big={big} />}
                      <ItemChip
                        item={it}
                        big={big}
                        editable={editable}
                        dim={dragging === it.id}
                        onGrab={(e) => startDrag(it.id, e)}
                        onRename={(t) => patchItem(it.id, { text: t })}
                        onUpload={(f) => void uploadImage(it.id, f)}
                        onRemove={() => removeItem(it.id)}
                      />
                    </Fragment>
                  ))}
                  {editable && dropAt?.tier === dropId && dropAt.before === null && <DropLine big={big} />}
                  {editable && (
                    <button type="button" onClick={() => addItemTo(row.tier)} className={['flex items-center justify-center rounded-md border border-dashed border-paper-line text-ink-faint hover:border-clay hover:text-clay dark:border-coal-line dark:text-coal-soft', big ? 'h-20 w-20' : 'h-14 w-14'].join(' ')} title="Add an item here">
                      <Plus className="h-4 w-4" />
                    </button>
                  )}
                  {row.items.length === 0 && !editable && <span className="px-1 text-xs text-ink-faint dark:text-coal-soft">·</span>}
                </div>
              </div>
            );
          })}
          {editable && (
            <div className="flex items-center gap-3 bg-paper px-3 py-1.5 dark:bg-coal-panel">
              <button type="button" onClick={addTier} className="text-xs text-ink-faint hover:text-clay dark:text-coal-soft">+ tier</button>
              <span className="text-[11px] text-ink-faint dark:text-coal-soft">drag items between tiers, or use the Ratings tab to score them</span>
            </div>
          )}
        </div>
      ) : (
        <div className="p-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-ink-faint dark:text-coal-soft">
                <th className="px-2 py-1 font-medium">Image</th>
                <th className="px-2 py-1 font-medium">Name</th>
                <th className="px-2 py-1 font-medium">Rating</th>
                <th className="px-2 py-1 font-medium">Tier</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const t = tierForRating(tiers, it.rating);
                return (
                  <tr key={it.id} className="border-t border-paper-line dark:border-coal-line">
                    <td className="px-2 py-1"><ImageCell image={it.image} editable={editable} onUpload={(f) => void uploadImage(it.id, f)} onClear={() => patchItem(it.id, { image: '' })} /></td>
                    <td className="px-2 py-1">
                      {editable ? (
                        <input value={it.text} onChange={(e) => patchItem(it.id, { text: e.target.value })} placeholder="name" className="w-full bg-transparent text-ink outline-none placeholder:text-ink-faint dark:text-coal-text" />
                      ) : (
                        <span className="text-ink dark:text-coal-text">{it.text}</span>
                      )}
                    </td>
                    <td className="px-2 py-1">
                      {editable ? (
                        <input type="number" value={it.rating ?? ''} placeholder="score" onChange={(e) => patchItem(it.id, { rating: e.target.value === '' ? null : Number(e.target.value) })} className="w-16 rounded border border-paper-line bg-paper px-1 py-0.5 text-ink outline-none focus:border-clay dark:border-coal-line dark:bg-coal dark:text-coal-text" />
                      ) : (
                        <span className="text-ink dark:text-coal-text">{it.rating ?? ''}</span>
                      )}
                    </td>
                    <td className="px-2 py-1">
                      <span className="rounded px-1.5 py-0.5 text-xs font-semibold text-white" style={{ backgroundColor: t?.color ?? '#8a94a6' }}>{t?.label ?? '?'}</span>
                    </td>
                    <td className="px-2 py-1 text-right">
                      {editable && <button type="button" onClick={() => removeItem(it.id)} className="text-ink-faint hover:text-rose-500"><Trash2 className="h-3.5 w-3.5" /></button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {editable && (
            <button type="button" onClick={() => addItemTo(null)} className="mt-1 flex items-center gap-1 px-2 py-1 text-xs text-ink-faint hover:text-clay dark:text-coal-soft"><Plus className="h-3.5 w-3.5" /> Add item</button>
          )}
          {items.length === 0 && <p className="px-2 py-2 text-xs text-ink-faint dark:text-coal-soft">Add items, give each a score, then switch to Tiers.</p>}
        </div>
      )}
    </div>
  );
}

function readValue(attrs: Record<string, unknown>): TierListData {
  return {
    title: (attrs.title as string) || '',
    mode: (attrs.mode as string) === 'table' ? 'table' : 'tiers',
    tiers: readTiers(attrs),
    items: readItems(attrs),
  };
}

// The editor widget: a thin node-view wrapper over the shared TierListEditor.
function TierListView({ node, updateAttributes, editor, getPos }: NodeViewProps) {
  const value: TierListData = readValue(node.attrs);
  // The attrs as they are NOW, read off the current doc through the node's
  // position. The React `node` prop is the doc as of this render, so a write built
  // on it after an await (an image upload) restores the pre-upload list.
  // ProseMirror applies each updateAttributes synchronously, so reading here always
  // sees the previous write.
  const liveValue = (): TierListData => {
    try {
      const pos = typeof getPos === 'function' ? getPos() : null;
      if (typeof pos === 'number') {
        const n = editor.state.doc.nodeAt(pos);
        if (n && n.type.name === 'tierListBlock') return readValue(n.attrs);
      }
    } catch {
      /* fall back to the prop */
    }
    return value;
  };
  return (
    <NodeViewWrapper className="my-4" contentEditable={false}>
      <TierListEditor value={value} readLive={liveValue} onChange={(patch) => updateAttributes(patch)} editable={editor.isEditable} />
    </NodeViewWrapper>
  );
}

const jsonAttr = (name: string) => (el: HTMLElement) => {
  try {
    return JSON.parse(el.getAttribute(name) || '[]');
  } catch {
    return [];
  }
};

export const TierListBlock = Node.create({
  name: 'tierListBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      title: { default: '' },
      mode: { default: 'tiers' },
      tiers: {
        default: [],
        parseHTML: jsonAttr('data-tiers'),
        renderHTML: (attrs: { tiers?: TierDef[] }) => ({ 'data-tiers': JSON.stringify(attrs.tiers || []) }),
      },
      items: {
        default: [],
        parseHTML: jsonAttr('data-items'),
        renderHTML: (attrs: { items?: TierItem[] }) => ({ 'data-items': JSON.stringify(attrs.items || []) }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-tierlist]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-tierlist': '' })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(TierListView);
  },
});
