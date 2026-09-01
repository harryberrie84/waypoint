import { useEffect, useRef, useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Globe, Maximize2, Minimize2, ChevronLeft, ChevronRight } from 'lucide-react';
import { spansDay, formatDateTime } from '../lib/tableQuery';
import { monthMatrix, dayIndex, type SharedModel, type SharedRow } from '../lib/sharedTable';

// sharedTableBlock, a SELF-CONTAINED read-only view of a table: the whole view
// model (rows + the fields each view needs) is baked into the node attrs at
// publish time, so it renders every view type (grid/board/gallery/calendar/
// timeline/schedule/map/route) on the account-less public page. Fullscreen fills
// the window. Styled like the recipe/map share cards.

const EMPTY: SharedModel = { title: 'Table', viewType: 'grid', columns: [], rows: [] };
function readModel(attrs: Record<string, unknown>): SharedModel {
  const m = attrs.model;
  return m && typeof m === 'object' ? (m as SharedModel) : EMPTY;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function pinSvg(color: string): string {
  return `<svg width="26" height="34" viewBox="0 0 26 34" xmlns="http://www.w3.org/2000/svg"><path d="M13 0C5.8 0 0 5.8 0 13c0 9.2 13 21 13 21s13-11.8 13-21C26 5.8 20.2 0 13 0z" fill="${color}"/><circle cx="13" cy="13" r="5" fill="#fff"/></svg>`;
}

function GridTable({ model }: { model: SharedModel }) {
  return (
    <div className="max-h-full overflow-auto">
      <table className="w-full text-left text-sm">
        <thead className="sticky top-0 bg-paper-panel/80 text-[11px] uppercase tracking-wide text-ink-faint backdrop-blur dark:bg-coal-line/60 dark:text-coal-soft">
          <tr>
            {model.columns.map((h, i) => (
              <th key={i} className="whitespace-nowrap px-3 py-1.5 font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {model.rows.map((r, ri) => (
            <tr key={ri} className="border-t border-paper-line dark:border-coal-line">
              {model.columns.map((_, ci) => (
                <td key={ci} className="px-3 py-1.5 align-top text-ink dark:text-coal-text">{r.cells[ci] ?? ''}</td>
              ))}
            </tr>
          ))}
          {model.rows.length === 0 && (
            <tr><td colSpan={Math.max(1, model.columns.length)} className="px-3 py-4 text-center text-xs text-ink-faint dark:text-coal-soft">No rows.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// Card fields: the non-title, non-empty cells as "Column: value" (a few).
function fields(model: SharedModel, r: SharedRow, max = 4) {
  const out: { name: string; value: string }[] = [];
  for (let i = 1; i < model.columns.length && out.length < max; i++) {
    if (r.cells[i]) out.push({ name: model.columns[i], value: r.cells[i] });
  }
  return out;
}

function Cards({ model, rows }: { model: SharedModel; rows: SharedRow[] }) {
  return (
    <div className="grid gap-2 p-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(13rem, 1fr))' }}>
      {rows.map((r, i) => (
        <div key={i} className="rounded-lg border border-paper-line bg-paper-panel/40 p-2.5 dark:border-coal-line dark:bg-coal/30">
          <div className="mb-1 truncate text-sm font-medium text-ink dark:text-coal-text">{r.title}</div>
          {fields(model, r).map((f, j) => (
            <div key={j} className="truncate text-[11px] text-ink-soft dark:text-coal-soft">
              <span className="text-ink-faint dark:text-coal-soft">{f.name}: </span>{f.value}
            </div>
          ))}
        </div>
      ))}
      {rows.length === 0 && <div className="col-span-full px-1 py-4 text-center text-xs text-ink-faint dark:text-coal-soft">No cards.</div>}
    </div>
  );
}

function BoardView({ model }: { model: SharedModel }) {
  const groups = model.groups ?? [];
  if (groups.length === 0) return <Cards model={model} rows={model.rows} />;
  return (
    <div className="flex gap-3 overflow-x-auto p-3">
      {groups.map((g) => {
        const cards = model.rows.filter((r) => (r.groupKeys ?? ['']).includes(g.key));
        return (
          <div key={g.key || 'none'} className="flex w-60 shrink-0 flex-col rounded-xl border border-paper-line bg-paper-panel/40 p-2 dark:border-coal-line dark:bg-coal/30">
            <div className="mb-2 flex items-center gap-1.5 px-1">
              {g.color && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: g.color }} />}
              <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink dark:text-coal-text">{g.label}</span>
              <span className="text-[11px] text-ink-faint dark:text-coal-soft">{cards.length}</span>
            </div>
            <div className="flex flex-col gap-2">
              {cards.map((r, i) => (
                <div key={i} className="rounded-lg border border-paper-line bg-paper p-2 dark:border-coal-line dark:bg-coal-panel">
                  <div className="truncate text-sm text-ink dark:text-coal-text">{r.title}</div>
                  {fields(model, r, 2).map((f, j) => (
                    <div key={j} className="truncate text-[11px] text-ink-faint dark:text-coal-soft">{f.value}</div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CalendarView({ model }: { model: SharedModel }) {
  const dated = model.rows.filter((r) => r.date);
  const defaultYm = (dated.map((r) => r.date as string).sort()[0] ?? new Date().toISOString()).slice(0, 7);
  const [ym, setYm] = useState(defaultYm);
  const [y, m] = ym.split('-').map(Number);
  const weeks = monthMatrix(y, m - 1);
  const step = (delta: number) => {
    const nm = new Date(Date.UTC(y, m - 1 + delta, 1));
    setYm(`${nm.getUTCFullYear()}-${String(nm.getUTCMonth() + 1).padStart(2, '0')}`);
  };
  const eventsOn = (day: string) => model.rows.filter((r) => r.date && spansDay(r.date, r.endDate ?? null, day));
  return (
    <div className="flex h-full flex-col p-3">
      <div className="mb-2 flex items-center gap-2">
        <button type="button" onClick={() => step(-1)} className="rounded p-1 text-ink-faint hover:bg-paper-panel dark:hover:bg-coal-line"><ChevronLeft className="h-4 w-4" /></button>
        <span className="text-sm font-medium text-ink dark:text-coal-text">{MONTHS[m - 1]} {y}</span>
        <button type="button" onClick={() => step(1)} className="rounded p-1 text-ink-faint hover:bg-paper-panel dark:hover:bg-coal-line"><ChevronRight className="h-4 w-4" /></button>
      </div>
      <div className="grid grid-cols-7 gap-px text-[10px] uppercase text-ink-faint dark:text-coal-soft">
        {DOW.map((d) => <div key={d} className="px-1 pb-1">{d}</div>)}
      </div>
      <div className="grid flex-1 grid-cols-7 gap-px overflow-auto rounded-md bg-paper-line dark:bg-coal-line">
        {weeks.flat().map((day, i) => (
          <div key={i} className="min-h-[4.5rem] bg-paper p-1 dark:bg-coal-panel">
            {day && <div className="mb-0.5 text-[10px] text-ink-faint dark:text-coal-soft">{Number(day.slice(8))}</div>}
            {day && eventsOn(day).map((r, j) => (
              <div key={j} className="mb-0.5 truncate rounded px-1 py-[1px] text-[10px] text-white" style={{ backgroundColor: r.color || '#e05a86' }} title={r.title}>{r.title}</div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function TimelineView({ model }: { model: SharedModel }) {
  const rows = model.rows.filter((r) => r.date).sort((a, b) => (a.date! < b.date! ? -1 : 1));
  if (rows.length === 0) return <div className="px-3 py-4 text-center text-xs text-ink-faint dark:text-coal-soft">No dated rows.</div>;
  const starts = rows.map((r) => dayIndex(r.date as string));
  const ends = rows.map((r) => dayIndex((r.endDate ?? r.date) as string));
  const min = Math.min(...starts);
  const max = Math.max(...ends);
  const span = Math.max(1, max - min);
  return (
    <div className="space-y-1.5 overflow-auto p-3">
      {rows.map((r, i) => {
        const s = dayIndex(r.date as string);
        const e = dayIndex((r.endDate ?? r.date) as string);
        const left = ((s - min) / span) * 100;
        const width = Math.max(2, ((e - s + 1) / span) * 100);
        return (
          <div key={i} className="flex items-center gap-2">
            <span className="w-40 shrink-0 truncate text-xs text-ink dark:text-coal-text" title={r.title}>{r.title}</span>
            <div className="relative h-4 flex-1 rounded bg-paper-panel dark:bg-coal">
              <div className="absolute top-0 h-4 rounded" style={{ left: `${left}%`, width: `${width}%`, backgroundColor: r.color || '#e05a86' }} title={`${r.date}${r.endDate ? ' → ' + r.endDate : ''}`} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ScheduleView({ model }: { model: SharedModel }) {
  const rows = model.rows.filter((r) => r.start).sort((a, b) => (a.start! < b.start! ? -1 : 1));
  if (rows.length === 0) return <div className="px-3 py-4 text-center text-xs text-ink-faint dark:text-coal-soft">No scheduled rows.</div>;
  const byDay = new Map<string, SharedRow[]>();
  for (const r of rows) {
    const d = (r.start as string).slice(0, 10);
    byDay.set(d, [...(byDay.get(d) ?? []), r]);
  }
  return (
    <div className="space-y-3 overflow-auto p-3">
      {[...byDay.entries()].map(([day, rs]) => (
        <div key={day}>
          <div className="mb-1 text-xs font-semibold text-ink-faint dark:text-coal-soft">{formatDateTime(day + 'T00:00')}</div>
          <div className="space-y-1">
            {rs.map((r, i) => (
              <div key={i} className="flex items-baseline gap-2 rounded-md border border-paper-line px-2 py-1 dark:border-coal-line">
                <span className="shrink-0 font-mono text-xs text-clay">{formatDateTime(r.start as string).split(', ')[1] ?? ''}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-ink dark:text-coal-text">{r.title}</span>
                {r.place && <span className="shrink-0 truncate text-[11px] text-ink-faint dark:text-coal-soft">{r.place}</span>}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function MapView({ model, full }: { model: SharedModel; full: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const placed = model.rows.filter((r) => typeof r.lat === 'number' && typeof r.lon === 'number');
  // A stable key: rebuild the map only when the places, view, or fullscreen
  // change (not on every render). Re-creating on `full` reliably repaints the
  // tiles after the container resizes (invalidateSize alone left them blank).
  const key = JSON.stringify([full, model.viewType, placed.map((r) => [r.lat, r.lon])]);
  useEffect(() => {
    if (!ref.current || mapRef.current) return;
    const map = L.map(ref.current, { scrollWheelZoom: false }).setView([20, 0], 2);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
    const latlngs: L.LatLngExpression[] = [];
    for (const r of placed) {
      const icon = L.divIcon({ html: pinSvg('#e05a86'), className: 'waypoint-pin', iconSize: [26, 34], iconAnchor: [13, 34], popupAnchor: [0, -30] });
      L.marker([r.lat as number, r.lon as number], { icon }).addTo(map).bindPopup(`<strong>${(r.place || r.title).replace(/</g, '&lt;')}</strong>`);
      latlngs.push([r.lat as number, r.lon as number]);
    }
    if (model.viewType === 'route' && latlngs.length > 1) {
      L.polyline(latlngs, { color: '#e05a86', weight: 3, opacity: 0.8, dashArray: '6 6' }).addTo(map);
    }
    if (latlngs.length === 1) map.setView(latlngs[0], 12);
    else if (latlngs.length) map.fitBounds(L.latLngBounds(latlngs).pad(0.2));
    mapRef.current = map;
    const t = setTimeout(() => map.invalidateSize(), 60);
    return () => { clearTimeout(t); map.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return <div ref={ref} className="h-full w-full" style={{ background: '#aadaff' }} />;
}

function Body({ model, full }: { model: SharedModel; full: boolean }) {
  switch (model.viewType) {
    case 'gallery':
      return <Cards model={model} rows={model.rows} />;
    case 'board':
      return <BoardView model={model} />;
    case 'calendar':
      return <CalendarView model={model} />;
    case 'timeline':
      return <TimelineView model={model} />;
    case 'schedule':
      return <ScheduleView model={model} />;
    case 'map':
    case 'route':
      return <MapView model={model} full={full} />;
    default:
      return <GridTable model={model} />;
  }
}

function SharedTableView({ node }: NodeViewProps) {
  const model = readModel(node.attrs);
  const [full, setFull] = useState(false);
  const isMap = model.viewType === 'map' || model.viewType === 'route';

  return (
    <NodeViewWrapper className="my-3" contentEditable={false}>
      <div className={[
        'flex flex-col overflow-hidden rounded-xl border border-paper-line bg-paper dark:border-coal-line dark:bg-coal-panel',
        full ? 'fixed inset-0 z-[2000] my-0 rounded-none' : '',
      ].join(' ')}
      >
        <div className="flex items-center gap-2 border-b border-paper-line px-3 py-2 dark:border-coal-line">
          <Globe className="h-4 w-4 shrink-0 text-clay" />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink dark:text-coal-text">{model.title}</span>
          <span className="shrink-0 text-[11px] capitalize text-ink-faint dark:text-coal-soft">{model.viewType} · {model.rows.length}</span>
          <button type="button" onClick={() => setFull((f) => !f)} title={full ? 'Exit fullscreen' : 'Fullscreen'} className="shrink-0 rounded p-1 text-ink-faint hover:bg-paper-panel hover:text-clay dark:hover:bg-coal-line">
            {full ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>
        </div>
        <div className={full ? 'min-h-0 flex-1' : isMap ? 'h-[24rem]' : 'max-h-[26rem] overflow-auto'}>
          <Body model={model} full={full} />
        </div>
      </div>
    </NodeViewWrapper>
  );
}

export const SharedTableBlock = Node.create({
  name: 'sharedTableBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      model: {
        default: null,
        parseHTML: (el: HTMLElement) => {
          try {
            return JSON.parse(el.getAttribute('data-model') || 'null');
          } catch {
            return null;
          }
        },
        renderHTML: (attrs: { model?: SharedModel }) => ({ 'data-model': JSON.stringify(attrs.model ?? null) }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-shared-table]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-shared-table': '' })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(SharedTableView);
  },
});
