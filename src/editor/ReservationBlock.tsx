import { useEffect, useRef, useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { Ticket, Plane, Train, Hotel, Car, MapPin, Plus, Trash2, Clock, Copy, Check, Link2 } from 'lucide-react';
import { AddToCalendarButton } from '../components/AddToCalendarButton';

// reservationBlock, a list of trip bookings (flights, stays, trains, tickets) with
// confirmation numbers, times and a live countdown to the next one, so what is
// coming up and its code are always to hand. Items ride the block attrs, so they
// sync to everyone. Styled like the other trip cards.

type ResKind = 'flight' | 'hotel' | 'train' | 'ticket' | 'car' | 'other';

interface Reservation {
  id: string;
  kind: ResKind;
  text: string; // the title, kept in `text` so search finds it
  code: string; // confirmation / booking number
  when: string; // ISO datetime, '' if none
  note: string; // seat, address, terminal, etc.
}

const KINDS: { id: ResKind; label: string; Icon: typeof Ticket }[] = [
  { id: 'flight', label: 'Flight', Icon: Plane },
  { id: 'hotel', label: 'Stay', Icon: Hotel },
  { id: 'train', label: 'Train', Icon: Train },
  { id: 'ticket', label: 'Ticket', Icon: Ticket },
  { id: 'car', label: 'Car', Icon: Car },
  { id: 'other', label: 'Other', Icon: MapPin },
];
const kindOf = (k: ResKind) => KINDS.find((x) => x.id === k) ?? KINDS[3];

function newId(): string {
  return Math.random().toString(36).slice(2, 9);
}
function readItems(attrs: Record<string, unknown>): Reservation[] {
  const raw = attrs.items;
  return Array.isArray(raw) ? (raw as Reservation[]) : [];
}

function fmtWhen(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const hasTime = iso.length > 10;
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', ...(hasTime ? { hour: '2-digit', minute: '2-digit' } : {}) });
}
function countdown(iso: string, now: number): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '';
  const ms = t - now;
  if (ms < 0) return 'past';
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `in ${Math.max(mins, 0)}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `in ${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `in ${days} day${days === 1 ? '' : 's'}`;
}
// `when` is stored as 'YYYY-MM-DD' for a FULL-DAY booking, or 'YYYY-MM-DDTHH:mm' once
// a time is added. Splitting the picker into a date + an optional time (instead of one
// datetime-local, which saves NOTHING until both halves are set, the reason a date
// "didn't save") lets the date persist on its own and treats a missing time as all-day.
function datePart(iso: string): string {
  return iso && iso.length >= 10 ? iso.slice(0, 10) : '';
}
function timePart(iso: string): string {
  return iso && iso.length >= 16 ? iso.slice(11, 16) : '';
}
function combineWhen(date: string, time: string): string {
  if (!date) return '';
  return time ? `${date}T${time}` : date; // date only -> full day
}

function ReservationView({ node, updateAttributes, editor, getPos }: NodeViewProps) {
  const editable = editor.isEditable;
  const items = readItems(node.attrs);
  const single = !!node.attrs.single; // one-booking mode: cap to a single card, no add
  const title = (node.attrs.title as string) || (single ? 'Reservation' : 'Reservations');
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [linkOpen, setLinkOpen] = useState<string | null>(null); // which line's "fill from" menu is open
  const [now, setNow] = useState(() => Date.now());

  // Keep the countdown fresh without hammering: tick once a minute while mounted.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Every mutation reads the LIVE items straight off the current editor doc (via the
  // node's position), NOT the React `node` prop, which only refreshes on the next
  // render. Editing several fields of one booking in quick succession used to clobber
  // each other (the classic symptom: set a date, type another field, and the date
  // reverts). ProseMirror applies each updateAttributes synchronously, so reading the
  // doc here always sees the previous write.
  const liveItems = (): Reservation[] => {
    try {
      const pos = typeof getPos === 'function' ? getPos() : null;
      if (typeof pos === 'number') {
        const n = editor.state.doc.nodeAt(pos);
        if (n && n.type.name === 'reservationBlock') return readItems(n.attrs);
      }
    } catch {
      /* fall back to the prop below */
    }
    return readItems(node.attrs);
  };
  const write = (next: Reservation[]) => updateAttributes({ items: next });
  const patch = (id: string, p: Partial<Reservation>) => write(liveItems().map((it) => (it.id === id ? { ...it, ...p } : it)));
  const add = () => write([...liveItems(), { id: newId(), kind: 'flight', text: '', code: '', when: '', note: '' }]);
  const remove = (id: string) => write(liveItems().filter((it) => it.id !== id));

  // Other reservations already on this page (any /reservation or /reservations widget
  // but this one), so a new line can be FILLED from an existing booking instead of
  // retyped. Read live from the doc, skipping this widget and blank entries.
  const linkSources = (): { label: string; sub: string; item: Reservation }[] => {
    const out: { label: string; sub: string; item: Reservation }[] = [];
    const selfPos = typeof getPos === 'function' ? getPos() : null;
    try {
      editor.state.doc.descendants((n, pos) => {
        if (n.type.name !== 'reservationBlock') return true;
        if (pos === selfPos) return false;
        const wTitle = (n.attrs.title as string) || 'Reservations';
        for (const it of readItems(n.attrs)) {
          if (!it.text && !it.when && !it.code && !it.note) continue;
          out.push({ label: it.text || kindOf(it.kind).label, sub: [wTitle, it.when ? fmtWhen(it.when) : ''].filter(Boolean).join(' · '), item: it });
        }
        return false; // atom: no children to walk
      });
    } catch {
      /* a doc mid-transaction: just offer nothing this open */
    }
    return out;
  };
  const fillFrom = (id: string, src: Reservation) => {
    patch(id, { kind: src.kind, text: src.text, code: src.code, when: src.when, note: src.note });
    setLinkOpen(null);
  };
  // Date and time set independently, each recombining against the LIVE other half so
  // one can't wipe the other. A date with no time stays a full-day booking.
  const liveItem = (id: string) => liveItems().find((x) => x.id === id);
  const setWhenDate = (id: string, date: string) => patch(id, { when: combineWhen(date, timePart(liveItem(id)?.when ?? '')) });
  const setWhenTime = (id: string, time: string) => patch(id, { when: combineWhen(datePart(liveItem(id)?.when ?? ''), time) });

  // Seed + auto-edit. Runs once, but is keyed on `editable` so a card that first
  // mounted in the read-only "connecting" preview still seeds the moment editing is
  // possible (the old empty-deps version skipped it forever and left a blank card).
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !editable) return;
    seeded.current = true;
    if (items.length === 0) add(); // legacy inserts carried no items
    // Open straight into edit mode when the booking(s) are still blank, so a freshly
    // inserted card is ready to fill without a click.
    if (items.every((it) => !it.text && !it.when && !it.code && !it.note)) setEditing(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editable]);

  // Sort upcoming first (dated ascending), undated last; the header counts down to
  // the soonest still-future one.
  const sorted = [...items].sort((a, b) => {
    if (a.when && b.when) return a.when < b.when ? -1 : a.when > b.when ? 1 : 0;
    if (a.when) return -1;
    if (b.when) return 1;
    return 0;
  });
  const next = sorted.find((it) => it.when && new Date(it.when).getTime() >= now);

  const copyCode = (it: Reservation) => {
    if (!it.code) return;
    void navigator.clipboard?.writeText(it.code);
    setCopied(it.id);
    setTimeout(() => setCopied(null), 1200);
  };

  return (
    <NodeViewWrapper className="my-3" contentEditable={false}>
      <div className="overflow-hidden rounded-xl border border-paper-line bg-gradient-to-br from-clay-wash/50 to-paper-panel/40 dark:border-coal-line dark:from-clay/10 dark:to-coal/40">
        <div className="flex items-center gap-2 px-3 pt-3">
          <Ticket className="h-4 w-4 shrink-0 text-clay" />
          {editing && editable ? (
            <input value={title} onChange={(e) => updateAttributes({ title: e.target.value })} className="min-w-0 flex-1 rounded-lg border border-paper-line bg-paper px-2 py-1 text-sm font-semibold text-ink outline-none dark:border-coal-line dark:bg-coal-panel dark:text-coal-text" />
          ) : (
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink dark:text-coal-text">{title}</span>
          )}
          {next && (
            <span className="flex shrink-0 items-center gap-1 rounded-full bg-clay/10 px-2 py-0.5 text-[11px] font-medium text-clay">
              <Clock className="h-3 w-3" /> {next.text || kindOf(next.kind).label} {countdown(next.when, now)}
            </span>
          )}
          {editable && (
            <button type="button" onClick={() => setEditing((e) => !e)} className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-ink-soft hover:bg-paper-panel dark:text-coal-soft dark:hover:bg-coal-line">
              {editing ? 'Done' : 'Edit'}
            </button>
          )}
        </div>

        <div className="space-y-1.5 p-3">
          {/* Single mode shows just the one booking; otherwise sort for display, but keep
              input order while editing so a card can't jump mid-edit. */}
          {(single ? items.slice(0, 1) : editing ? items : sorted).map((it) => {
            const { Icon, label } = kindOf(it.kind);
            const past = !!it.when && new Date(it.when).getTime() < now;
            return editing && editable ? (
              <div key={it.id} className="space-y-1 rounded-lg border border-paper-line bg-paper/70 p-2 dark:border-coal-line dark:bg-coal-panel/50">
                <div className="flex items-center gap-1.5">
                  <select value={it.kind} onChange={(e) => patch(it.id, { kind: e.target.value as ResKind })} className="shrink-0 rounded border border-paper-line bg-paper px-1 py-1 text-[11px] text-ink-soft outline-none dark:border-coal-line dark:bg-coal dark:text-coal-soft">
                    {KINDS.map((k) => (<option key={k.id} value={k.id}>{k.label}</option>))}
                  </select>
                  <input value={it.text} onChange={(e) => patch(it.id, { text: e.target.value })} placeholder="e.g. ANA NH106 Tokyo → Fukuoka" className="min-w-0 flex-1 rounded border border-paper-line bg-paper px-2 py-1 text-sm text-ink outline-none dark:border-coal-line dark:bg-coal dark:text-coal-text" />
                  <div className="relative shrink-0">
                    <button type="button" onClick={() => setLinkOpen((o) => (o === it.id ? null : it.id))} title="Fill this line from an existing reservation on the page" className={['rounded p-1', linkOpen === it.id ? 'text-clay' : 'text-ink-faint hover:text-clay'].join(' ')}><Link2 className="h-3.5 w-3.5" /></button>
                    {linkOpen === it.id && (
                      <div className="absolute right-0 top-full z-40 mt-1 max-h-56 w-60 overflow-y-auto rounded-lg border border-paper-line bg-paper p-1 shadow-xl dark:border-coal-line dark:bg-coal-panel">
                        {(() => {
                          const sources = linkSources();
                          if (sources.length === 0) return <p className="px-2 py-1.5 text-[11px] text-ink-faint dark:text-coal-soft">No other reservations on this page yet. Add a /reservation card to link from.</p>;
                          return sources.map((s, i) => (
                            <button key={i} type="button" onClick={() => fillFrom(it.id, s.item)} className="block w-full rounded px-2 py-1 text-left hover:bg-clay/10">
                              <span className="block truncate text-[12px] font-medium text-ink dark:text-coal-text">{s.label}</span>
                              {s.sub && <span className="block truncate text-[10px] text-ink-faint dark:text-coal-soft">{s.sub}</span>}
                            </button>
                          ));
                        })()}
                      </div>
                    )}
                  </div>
                  <button type="button" onClick={() => remove(it.id)} title="Remove" className="shrink-0 rounded p-1 text-ink-faint hover:text-rose-500"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <input value={it.code} onChange={(e) => patch(it.id, { code: e.target.value })} placeholder="Confirmation #" className="min-w-0 flex-1 rounded border border-paper-line bg-paper px-2 py-1 text-[11px] text-ink outline-none dark:border-coal-line dark:bg-coal dark:text-coal-text" />
                  <input type="date" value={datePart(it.when)} onChange={(e) => setWhenDate(it.id, e.target.value)} title="Date" className="shrink-0 rounded border border-paper-line bg-paper px-1.5 py-1 text-[11px] text-ink-soft outline-none dark:border-coal-line dark:bg-coal dark:text-coal-soft" />
                  {/* Time is optional but nudged: it goes RED while missing, and a
                      date with no time is treated (and exported) as a full-day booking. */}
                  <input
                    type="time"
                    value={timePart(it.when)}
                    onChange={(e) => setWhenTime(it.id, e.target.value)}
                    title={timePart(it.when) ? 'Time' : 'No time yet: this stays a full-day booking. Add a time if you have one.'}
                    className={['shrink-0 rounded border bg-paper px-1.5 py-1 text-[11px] outline-none dark:bg-coal', timePart(it.when) ? 'border-paper-line text-ink-soft dark:border-coal-line dark:text-coal-soft' : 'border-rose-400 text-rose-500 ring-1 ring-rose-300 dark:border-rose-500 dark:text-rose-400 dark:ring-rose-500/40'].join(' ')}
                  />
                  {datePart(it.when) && !timePart(it.when) && <span className="shrink-0 text-[10px] font-medium text-rose-500 dark:text-rose-400">full day</span>}
                </div>
                <input value={it.note} onChange={(e) => patch(it.id, { note: e.target.value })} placeholder="Seat, address, terminal…" className="w-full rounded border border-paper-line bg-paper px-2 py-1 text-[11px] text-ink-soft outline-none dark:border-coal-line dark:bg-coal dark:text-coal-soft" />
              </div>
            ) : (
              <div key={it.id} className={['flex items-start gap-2 rounded-lg px-1 py-1', past ? 'opacity-55' : ''].join(' ')}>
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-clay/10 text-clay"><Icon className="h-4 w-4" /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="min-w-0 truncate text-sm font-medium text-ink dark:text-coal-text">{it.text || label}</span>
                    {it.when && <span className="shrink-0 text-[11px] text-ink-faint dark:text-coal-soft">{fmtWhen(it.when)}{timePart(it.when) ? '' : ' · all day'}</span>}
                    {it.text && it.when && (
                      <AddToCalendarButton
                        compact
                        align="right"
                        className="ml-auto shrink-0"
                        events={{
                          title: it.text,
                          startIso: it.when,
                          location: it.note || undefined,
                          description: it.code ? `Confirmation ${it.code}${it.note ? ` · ${it.note}` : ''}` : it.note || undefined,
                          uid: it.id,
                        }}
                      />
                    )}
                  </div>
                  {(it.code || it.note) && (
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                      {it.code && (
                        <button type="button" onClick={() => copyCode(it)} title="Copy confirmation number" className="flex items-center gap-1 rounded bg-paper-panel px-1.5 py-0.5 font-mono text-[10px] text-ink-soft hover:text-clay dark:bg-coal-line dark:text-coal-soft">
                          {copied === it.id ? <Check className="h-2.5 w-2.5" /> : <Copy className="h-2.5 w-2.5" />} {it.code}
                        </button>
                      )}
                      {it.note && <span className="truncate text-[11px] text-ink-faint dark:text-coal-soft">{it.note}</span>}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {editing && editable && !single && (
            <button type="button" onClick={add} className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-paper-line py-1.5 text-sm text-ink-faint hover:border-clay hover:text-clay dark:border-coal-line">
              <Plus className="h-4 w-4" /> Add a reservation
            </button>
          )}
          {!editing && items.length === 0 && <p className="py-1 text-center text-xs text-ink-faint dark:text-coal-soft">no reservations yet</p>}
        </div>
      </div>
    </NodeViewWrapper>
  );
}

export const ReservationBlock = Node.create({
  name: 'reservationBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      title: { default: 'Reservations' },
      // /reservation (singular): one booking card, no list/add. A real boolean
      // round-trip, so an HTML copy-paste can't read the string "false" as truthy.
      single: {
        default: false,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-single') === 'true',
        renderHTML: (attrs: { single?: boolean }) => ({ 'data-single': attrs.single ? 'true' : 'false' }),
      },
      items: {
        default: [],
        parseHTML: (el: HTMLElement) => {
          try {
            return JSON.parse(el.getAttribute('data-items') || '[]');
          } catch {
            return [];
          }
        },
        renderHTML: (attrs: { items?: Reservation[] }) => ({ 'data-items': JSON.stringify(attrs.items || []) }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-reservations]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-reservations': '' })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ReservationView);
  },
});
