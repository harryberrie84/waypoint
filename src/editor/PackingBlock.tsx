import { useEffect, useRef, useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { Luggage, Plus, Trash2, Check, Sparkles, Loader2 } from 'lucide-react';
import { useData } from '../store/useData';
import { pageTables, collectEvents, tripDaySpan } from '../lib/tripViews';
import { geoOf } from '../lib/tableQuery';
import { fetchForecast } from '../lib/weather';
import { suggestPacking, type TripFacts } from '../lib/packingPlan';
import type { TableData, TableRow } from '../types';
import { useMembers } from '../hooks/useMembers';
import { initials, avatarColor } from '../lib/avatar';
import { WidgetIO } from './WidgetIO';
import { serializeChecklist, parseChecklist, PACKING_TEMPLATE } from '../lib/checklistIO';
import { toast } from '../store/useToast';

// packingBlock, a shared packing checklist with a live "X / Y packed" bar and a
// per-person filter, so you can split the bag and each see your own list. Items
// live in the block attrs, so ticking one syncs to everyone. Styled like the
// other trip cards.

interface PackItem {
  id: string;
  text: string;
  packed: boolean;
  who?: string; // member id, optional
}

function newId(): string {
  return Math.random().toString(36).slice(2, 9);
}

function readItems(attrs: Record<string, unknown>): PackItem[] {
  const raw = attrs.items;
  return Array.isArray(raw) ? (raw as PackItem[]) : [];
}

// The first place cell across the page's tables, to ask the forecast about. One
// place is enough: a packing list does not need per-city precision, it needs to
// know whether to expect rain and how cold it gets.
function firstPlace(tables: TableData[], rows: TableRow[]): { lat: number; lon: number } | null {
  for (const t of tables) {
    const cols = (t.columns ?? []).filter((c) => c.type === 'place');
    if (!cols.length) continue;
    for (const r of rows) {
      if (r.table !== t.id) continue;
      for (const c of cols) {
        const g = geoOf(r.cells?.[c.id] ?? null);
        if (g && typeof g.lat === 'number' && typeof g.lon === 'number') return { lat: g.lat, lon: g.lon };
      }
    }
  }
  return null;
}

function PackingView({ node, updateAttributes, editor }: NodeViewProps) {
  const editable = editor.isEditable;
  const items = readItems(node.attrs);
  const title = (node.attrs.title as string) || 'Packing';
  const members = useMembers();
  const [editing, setEditing] = useState(false);
  const [filter, setFilter] = useState<string>('all'); // 'all' | member id

  const write = (next: PackItem[]) => updateAttributes({ items: next });
  const patch = (id: string, p: Partial<PackItem>) => write(items.map((it) => (it.id === id ? { ...it, ...p } : it)));
  const add = () => write([...items, { id: newId(), text: '', packed: false }]);
  const remove = (id: string) => write(items.filter((it) => it.id !== id));

  const seeded = useRef(false);
  useEffect(() => {
    if (!seeded.current && editable && items.length === 0) {
      seeded.current = true;
      add();
      setEditing(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Suggest a first draft from the trip this page already describes: how many days
  // its dated rows span, what the itinerary mentions (a pool, a hike, a flight),
  // and the forecast for the first place it can find. Purely additive: it only ever
  // APPENDS items you do not already have, never ticks anything and never removes,
  // so pressing it twice is safe and it cannot touch what you wrote.
  const [suggesting, setSuggesting] = useState(false);
  const suggest = async () => {
    setSuggesting(true);
    try {
      const { pages, tables, rows, activePageId } = useData.getState();
      const page = activePageId ? pages[activePageId] : undefined;
      const pts = page ? pageTables(page, Object.values(tables)) : [];
      const events = collectEvents(pts, rows, []);
      const facts: TripFacts = {
        days: tripDaySpan(events),
        titles: events.map((e) => e.title),
        forecast: [],
      };
      const place = firstPlace(pts, Object.values(rows));
      if (place) {
        const map = await fetchForecast(place.lat, place.lon).catch(() => ({}));
        facts.forecast = Object.values(map);
      }
      const ideas = suggestPacking(facts, items.map((it) => ({ text: it.text, done: it.packed })));
      if (!ideas.length) {
        toast('Nothing to add: your list already covers what this page describes.');
        return;
      }
      write([...items.filter((it) => it.text.trim()), ...ideas.map((t) => ({ id: newId(), text: t, packed: false }))]);
      toast(`Added ${ideas.length} suggestion${ideas.length === 1 ? '' : 's'} to check over`);
    } finally {
      setSuggesting(false);
    }
  };

  // Only offer person filters for members who actually own an item.
  const owners = members.filter((m) => items.some((it) => it.who === m.id));
  const shown = filter === 'all' ? items : items.filter((it) => it.who === filter);
  const packed = shown.filter((it) => it.packed).length;
  const pct = shown.length ? Math.round((packed / shown.length) * 100) : 0;

  const memberName = (id?: string) => (id ? members.find((m) => m.id === id)?.name : undefined);
  const memberIdByName = (name?: string) => (name ? members.find((m) => m.name.toLowerCase() === name.toLowerCase())?.id : undefined);

  const exportText = () => serializeChecklist(title, items.map((it) => ({ text: it.text, done: it.packed, owner: memberName(it.who) })));
  const importText = (text: string): boolean => {
    const parsed = parseChecklist(text);
    if (parsed.items.length === 0) {
      toast('Nothing to import, check the format', 'error');
      return false;
    }
    // Resolve an @owner name back to a member id; an unknown name imports unassigned.
    updateAttributes({
      title: parsed.title || title,
      items: parsed.items.map((it) => ({ id: newId(), text: it.text, packed: it.done, who: memberIdByName(it.owner) })),
    });
    toast(`Imported ${parsed.items.length} items`);
    return true;
  };

  return (
    <NodeViewWrapper className="my-3" contentEditable={false}>
      <div className="overflow-hidden rounded-xl border border-paper-line bg-gradient-to-br from-clay-wash/50 to-paper-panel/40 dark:border-coal-line dark:from-clay/10 dark:to-coal/40">
        <div className="flex items-center gap-2 px-3 pt-3">
          <Luggage className="h-4 w-4 shrink-0 text-clay" />
          {editing && editable ? (
            <input value={title} onChange={(e) => updateAttributes({ title: e.target.value })} className="min-w-0 flex-1 rounded-lg border border-paper-line bg-paper px-2 py-1 text-sm font-semibold text-ink outline-none dark:border-coal-line dark:bg-coal-panel dark:text-coal-text" />
          ) : (
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink dark:text-coal-text">{title}</span>
          )}
          <span className="shrink-0 font-mono text-xs font-semibold tabular-nums text-ink-soft dark:text-coal-soft">{packed}/{shown.length} packed</span>
          {editable && (
            <button
              type="button"
              onClick={() => void suggest()}
              disabled={suggesting}
              className="flex shrink-0 items-center gap-1 rounded-md border border-paper-line px-1.5 py-0.5 text-[11px] text-ink-soft hover:border-clay hover:text-clay disabled:opacity-60 dark:border-coal-line dark:text-coal-soft"
              title="Suggest items from this page's dates, itinerary and forecast. Only adds, never ticks or removes."
            >
              {suggesting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              {suggesting ? 'Thinking…' : 'Suggest'}
            </button>
          )}
          {editable && (
            <button type="button" onClick={() => setEditing((e) => !e)} className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-ink-soft hover:bg-paper-panel dark:text-coal-soft dark:hover:bg-coal-line">
              {editing ? 'Done' : 'Edit'}
            </button>
          )}
        </div>

        {/* progress bar */}
        <div className="px-3 pt-2">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-paper-line dark:bg-coal-line">
            <div className="h-full rounded-full bg-clay transition-[width] duration-300" style={{ width: `${pct}%` }} />
          </div>
        </div>

        {/* person filter chips */}
        {owners.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 px-3 pt-2">
            {[{ id: 'all', name: 'Everyone' }, ...owners].map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setFilter(m.id)}
                className={['flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]', filter === m.id ? 'border-clay bg-clay text-white' : 'border-paper-line text-ink-soft hover:border-clay dark:border-coal-line dark:text-coal-soft'].join(' ')}
              >
                {m.id !== 'all' && <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full text-[7px] font-semibold text-white" style={{ backgroundColor: avatarColor(m.id) }}>{initials(m.name)}</span>}
                {m.name}
              </button>
            ))}
          </div>
        )}

        <div className="space-y-1 p-3">
          {shown.map((it) => (
            <div key={it.id} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => editable && patch(it.id, { packed: !it.packed })}
                disabled={!editable}
                className={['flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors', it.packed ? 'border-clay bg-clay text-white' : 'border-paper-line hover:border-clay dark:border-coal-line'].join(' ')}
                title={it.packed ? 'Unpack' : 'Mark packed'}
              >
                {it.packed && <Check className="h-3.5 w-3.5" />}
              </button>
              {editing && editable ? (
                <>
                  <input value={it.text} onChange={(e) => patch(it.id, { text: e.target.value })} placeholder="An item…" className="min-w-0 flex-1 rounded-lg border border-paper-line bg-paper px-2 py-1 text-sm text-ink outline-none dark:border-coal-line dark:bg-coal-panel dark:text-coal-text" />
                  <select
                    value={it.who ?? ''}
                    onChange={(e) => patch(it.id, { who: e.target.value || undefined })}
                    className="shrink-0 rounded-lg border border-paper-line bg-paper px-1.5 py-1 text-[11px] text-ink-soft outline-none dark:border-coal-line dark:bg-coal-panel dark:text-coal-soft"
                    title="Assign to"
                  >
                    <option value="">anyone</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                  <button type="button" onClick={() => remove(it.id)} title="Remove" className="shrink-0 rounded-md p-1 text-ink-faint hover:bg-paper-panel hover:text-rose-500 dark:hover:bg-coal-line">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </>
              ) : (
                <>
                  <span className={['min-w-0 flex-1 truncate text-sm', it.packed ? 'text-ink-faint line-through dark:text-coal-soft' : 'text-ink dark:text-coal-text'].join(' ')}>{it.text || 'Untitled'}</span>
                  {it.who && (
                    <span title={memberName(it.who)} className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[8px] font-semibold text-white" style={{ backgroundColor: avatarColor(it.who) }}>
                      {initials(memberName(it.who) ?? '?')}
                    </span>
                  )}
                </>
              )}
            </div>
          ))}
          {editing && editable && (
            <button type="button" onClick={add} className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-paper-line py-1.5 text-sm text-ink-faint hover:border-clay hover:text-clay dark:border-coal-line">
              <Plus className="h-4 w-4" /> Add an item
            </button>
          )}
          {!editing && shown.length === 0 && <p className="py-1 text-center text-xs text-ink-faint dark:text-coal-soft">nothing here yet</p>}
        </div>
        {editable && (
          <div className="border-t border-paper-line px-3 py-2 dark:border-coal-line">
            <WidgetIO fileName="packing.txt" templateName="packing-template.txt" templateText={PACKING_TEMPLATE} getText={exportText} onImport={importText} />
          </div>
        )}
      </div>
    </NodeViewWrapper>
  );
}

export const PackingBlock = Node.create({
  name: 'packingBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      title: { default: 'Packing' },
      items: {
        default: [],
        parseHTML: (el: HTMLElement) => {
          try {
            return JSON.parse(el.getAttribute('data-items') || '[]');
          } catch {
            return [];
          }
        },
        renderHTML: (attrs: { items?: PackItem[] }) => ({ 'data-items': JSON.stringify(attrs.items || []) }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-packing]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-packing': '' })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(PackingView);
  },
});
