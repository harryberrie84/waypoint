import { useEffect, useRef, useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { CalendarClock, Pencil, Trash2, Plus, ImagePlus, X } from 'lucide-react';
import { DateCalendar } from '../components/DateCalendar';
import { EmojiPicker } from '../components/EmojiPicker';
import { publishRef, clearRef } from '../lib/refRegistry';
import { uploadsApi } from '../lib/api';
import { processImageFile } from '../lib/image';

// countdownBlock, big "X days until <thing>" counters. Holds several at once, each
// with its own label, emoji and date, so one block can track every milestone. An
// optional cover photo turns a counter into a hero card for the trip.

interface CountItem {
  id: string;
  label: string;
  date: string;
  emoji: string;
  cover?: string; // optional hero image (data URL / upload URL)
}

function newId(): string {
  return Math.random().toString(36).slice(2, 9);
}

function toDayIndex(isoLike: string): number {
  const [y, m, d] = isoLike.slice(0, 10).split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

export function daysUntil(dateIso: string, now: Date): number {
  if (!dateIso) return 0;
  const today = Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86400000);
  return toDayIndex(dateIso) - today;
}

export function countdownText(days: number): { big: string; small: string } {
  if (days === 0) return { big: 'Today!', small: 'the big day is here' };
  if (days > 0) return { big: `${days.toLocaleString()}`, small: days === 1 ? 'day to go' : 'days to go' };
  const a = Math.abs(days);
  return { big: `${a.toLocaleString()}`, small: a === 1 ? 'day ago' : 'days ago' };
}

// Read the item list, migrating the old single label/date/emoji shape forward.
function readItems(attrs: Record<string, unknown>): CountItem[] {
  const raw = attrs.items;
  if (Array.isArray(raw) && raw.length) return raw as CountItem[];
  if (attrs.date) {
    return [{ id: 'legacy', label: (attrs.label as string) || '', date: attrs.date as string, emoji: (attrs.emoji as string) || '🗓️' }];
  }
  return [];
}

function CountdownView({ node, updateAttributes, editor }: NodeViewProps) {
  const editable = editor.isEditable;
  const items = readItems(node.attrs);
  const [now, setNow] = useState(() => new Date());
  const [editingId, setEditingId] = useState<string | null>(() => items.find((it) => !it.date)?.id ?? null);
  const [iconOpen, setIconOpen] = useState(false);
  // Close the icon picker when switching which counter is being edited.
  useEffect(() => setIconOpen(false), [editingId]);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60 * 1000); // refresh each minute
    return () => clearInterval(t);
  }, []);

  // Publish each counter's days-to-go so a table formula can read it with
  // countdown("label"). Clear the labels when the block goes away.
  const labelsRef = useRef<string[]>([]);
  useEffect(() => {
    const labels: string[] = [];
    for (const it of items) {
      if (it.label && it.date) {
        publishRef('countdown:', it.label, daysUntil(it.date, now));
        labels.push(it.label);
      }
    }
    labelsRef.current = labels;
  }, [items, now]);
  useEffect(
    () => () => {
      for (const l of labelsRef.current) clearRef('countdown:', l);
    },
    [],
  );

  // Writing items also clears the legacy single attrs so a migrated block doesn't
  // resurrect its old counter alongside the list.
  const write = (next: CountItem[]) => updateAttributes({ items: next, label: '', date: '', emoji: '' });
  const patch = (id: string, p: Partial<CountItem>) => write(items.map((it) => (it.id === id ? { ...it, ...p } : it)));
  const remove = (id: string) => {
    write(items.filter((it) => it.id !== id));
    setEditingId(null);
  };
  const add = () => {
    const it: CountItem = { id: newId(), label: '', date: '', emoji: '🗓️' };
    write([...items, it]);
    setEditingId(it.id);
  };
  const pickCover = async (id: string, file: File) => {
    try {
      const url = (await uploadsApi.upload(file)) ?? (await processImageFile(file));
      if (url) patch(id, { cover: url });
    } catch {
      /* not a usable image */
    }
  };

  // A freshly inserted block seeds one editable counter so /countdown opens ready.
  const seeded = useRef(false);
  useEffect(() => {
    if (!seeded.current && editable && items.length === 0) {
      seeded.current = true;
      add();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <NodeViewWrapper className="my-3" contentEditable={false}>
      <div className="space-y-2">
        {items.map((it) =>
          editingId === it.id && editable ? (
            <div key={it.id} className="rounded-xl border border-paper-line bg-paper-panel/50 p-3 dark:border-coal-line dark:bg-coal/40">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-ink-faint dark:text-coal-soft">
                <CalendarClock className="h-3.5 w-3.5 text-clay" /> Countdown
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative shrink-0" contentEditable={false}>
                  <button
                    type="button"
                    onClick={() => setIconOpen((o) => !o)}
                    title="Choose an icon"
                    className="flex h-9 w-12 items-center justify-center rounded-lg border border-paper-line bg-paper text-xl leading-none hover:border-clay dark:border-coal-line dark:bg-coal-panel"
                  >
                    {it.emoji || '🗓️'}
                  </button>
                  {iconOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setIconOpen(false)} />
                      <div className="absolute left-0 top-11 z-50 rounded-lg border border-paper-line bg-paper p-2 shadow-xl dark:border-coal-line dark:bg-coal-panel">
                        <EmojiPicker
                          onSelect={(e) => {
                            patch(it.id, { emoji: e });
                            setIconOpen(false);
                          }}
                        />
                      </div>
                    </>
                  )}
                </div>
                <input
                  value={it.label}
                  onChange={(e) => patch(it.id, { label: e.target.value })}
                  placeholder="What are you counting to?"
                  className="min-w-0 flex-1 rounded-lg border border-paper-line bg-paper px-2 py-1.5 text-sm text-ink outline-none dark:border-coal-line dark:bg-coal-panel dark:text-coal-text"
                />
                <button
                  type="button"
                  onClick={() => remove(it.id)}
                  className="rounded-md p-1.5 text-ink-faint hover:bg-paper-panel hover:text-rose-500 dark:hover:bg-coal-line"
                  title="Remove this countdown"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-2 inline-block rounded-lg border border-paper-line dark:border-coal-line">
                <DateCalendar
                  value={it.date}
                  withTime={false}
                  onChange={(iso) => patch(it.id, { date: iso || '' })}
                  onClose={() => setEditingId(null)}
                />
              </div>
              <div className="mt-2 flex items-center gap-2">
                <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-paper-line px-2.5 py-1.5 text-xs font-medium text-ink-soft hover:border-clay hover:text-clay dark:border-coal-line dark:text-coal-soft">
                  <ImagePlus className="h-3.5 w-3.5" /> {it.cover ? 'Change photo' : 'Add cover photo'}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void pickCover(it.id, f);
                    }}
                  />
                </label>
                {it.cover && (
                  <button type="button" onClick={() => patch(it.id, { cover: '' })} className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-ink-faint hover:text-rose-500">
                    <X className="h-3.5 w-3.5" /> Remove
                  </button>
                )}
              </div>
              <div>
                <button
                  type="button"
                  onClick={() => setEditingId(null)}
                  disabled={!it.date}
                  className="rounded-lg bg-clay px-3 py-1.5 text-sm font-medium text-white hover:bg-clay/90 disabled:opacity-50"
                >
                  Done
                </button>
              </div>
            </div>
          ) : it.cover ? (
            // Hero card: the counter over a full-bleed cover photo with a scrim
            // so the white text stays readable on any image.
            <div key={it.id} className="relative flex min-h-[9rem] items-end overflow-hidden rounded-xl border border-paper-line bg-cover bg-center p-4 dark:border-coal-line" style={{ backgroundImage: `url(${it.cover})` }}>
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/25 to-black/10" />
              <div className="relative flex items-center gap-3">
                {it.emoji && <div className="text-4xl leading-none drop-shadow">{it.emoji}</div>}
                <div className="min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-5xl font-bold tabular-nums tracking-tight text-white drop-shadow">{countdownText(daysUntil(it.date, now)).big}</span>
                    <span className="text-sm text-white/80">{countdownText(daysUntil(it.date, now)).small}</span>
                  </div>
                  {it.label && <div className="mt-0.5 truncate text-sm font-medium text-white/95 drop-shadow">{it.label}</div>}
                </div>
              </div>
              {editable && (
                <button type="button" onClick={() => setEditingId(it.id)} className="absolute right-2 top-2 rounded-md bg-black/30 p-1 text-white/90 hover:bg-black/50" title="Edit">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ) : (
            <div
              key={it.id}
              className="relative flex items-center gap-4 overflow-hidden rounded-xl border border-paper-line bg-gradient-to-br from-clay-wash/70 to-paper-panel/40 p-4 dark:border-coal-line dark:from-clay/10 dark:to-coal/40"
            >
              {it.emoji && <div className="text-4xl leading-none">{it.emoji}</div>}
              <div className="min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-4xl font-bold tabular-nums tracking-tight text-clay">{countdownText(daysUntil(it.date, now)).big}</span>
                  <span className="text-sm text-ink-soft dark:text-coal-soft">{countdownText(daysUntil(it.date, now)).small}</span>
                </div>
                {it.label && <div className="mt-0.5 truncate text-sm font-medium text-ink dark:text-coal-text">{it.label}</div>}
              </div>
              {editable && (
                <button
                  type="button"
                  onClick={() => setEditingId(it.id)}
                  className="absolute right-2 top-2 rounded-md p-1 text-ink-faint hover:bg-paper-panel hover:text-clay dark:hover:bg-coal-line"
                  title="Edit"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ),
        )}
        {editable && (
          <button
            type="button"
            onClick={add}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-paper-line py-2 text-sm text-ink-faint hover:border-clay hover:text-clay dark:border-coal-line"
          >
            <Plus className="h-4 w-4" /> Add a countdown
          </button>
        )}
      </div>
    </NodeViewWrapper>
  );
}

export const CountdownBlock = Node.create({
  name: 'countdownBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      items: {
        default: [],
        parseHTML: (el: HTMLElement) => {
          try {
            return JSON.parse(el.getAttribute('data-items') || '[]');
          } catch {
            return [];
          }
        },
        renderHTML: (attrs: { items?: CountItem[] }) => ({ 'data-items': JSON.stringify(attrs.items || []) }),
      },
      // Legacy single-countdown attributes, kept so old blocks still parse.
      label: { default: '' },
      date: { default: '' },
      emoji: { default: '🗓️' },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-countdown]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-countdown': '' })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(CountdownView);
  },
});
