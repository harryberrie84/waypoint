import { useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { useData } from '../store/useData';
import type { Column, TableData, TableRow } from '../types';
import { titleColumn, cellText, type ViewConfig } from '../lib/tableQuery';
import { buildEdges, clampStarts, cycleNodes } from '../lib/deps';
import { avatarColor } from '../lib/avatar';

// TimelineView, a Gantt-style horizontal view. Each entry is a bar from its
// "From" date to its "To" date (single day if no To). Drag a bar to move it,
// or drag its edges to resize; click to open the entry. An optional self-relation
// column draws "blocked by" arrows between bars, with optional start clamping.

const DAY_W = 26; // px per day
const NAME_W = 168; // px for the sticky name column
const ROW_TRACK_H = 34; // px, a row's track height (bars live inside this)
const ROW_H = ROW_TRACK_H + 1; // vertical pitch: track + the 1px row border
const BAR_CENTER_Y = 15; // bar `top-1` (4px) + half its 22px height, overlay anchor
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const EMPTY_SET: Set<string> = new Set();
const EMPTY_MAP: Map<string, number> = new Map();

function toDayIndex(isoLike: string): number {
  const [y, m, d] = isoLike.slice(0, 10).split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}
function idxToIso(n: number): string {
  const dt = new Date(n * 86400000);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}
function dayParts(n: number): { y: number; m: number; d: number; wd: number } {
  const dt = new Date(n * 86400000);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth(), d: dt.getUTCDate(), wd: dt.getUTCDay() };
}

export function TimelineView({
  tableId,
  table,
  rows,
  view,
}: {
  tableId: string;
  table: TableData;
  rows: TableRow[];
  view: ViewConfig;
}) {
  const addRow = useData((s) => s.addRow);
  const openRow = useData((s) => s.openRow);
  const setCell = useData((s) => s.setCell);
  const startCol: Column | undefined = table.columns.find((c) => c.id === view.dateColumnId && c.type === 'date');
  const endCol: Column | undefined = table.columns.find((c) => c.id === view.endDateColumnId && c.type === 'date');
  const colorCol: Column | undefined = table.columns.find((c) => c.id === view.colorColumnId && c.type === 'person');
  const title = titleColumn(table.columns);

  if (!startCol) {
    return (
      <div className="p-6 text-center text-sm text-ink-faint dark:text-coal-soft">
        Pick a <span className="font-medium">From</span> date column for the timeline (top-left of the toolbar).
        <br />
        Add a Date column in the Grid view first if you don&rsquo;t have one.
      </div>
    );
  }

  const startOf = (r: TableRow): string | null => {
    const v = r.cells[startCol.id];
    return typeof v === 'string' && v ? v : null;
  };
  const endOf = (r: TableRow): string | null => {
    if (!endCol) return null;
    const v = r.cells[endCol.id];
    return typeof v === 'string' && v ? v : null;
  };

  // Compute the visible day range from the data, padded by 2 days each side.
  const today = Math.floor(Date.now() / 86400000);
  let lo = Infinity;
  let hi = -Infinity;
  const placed: { row: TableRow; start: number; end: number }[] = [];
  for (const r of rows) {
    const s = startOf(r);
    if (!s) continue;
    const sd = toDayIndex(s);
    const e = endOf(r);
    const ed = e ? toDayIndex(e) : sd;
    const a = Math.min(sd, ed);
    const b = Math.max(sd, ed);
    placed.push({ row: r, start: a, end: b });
    lo = Math.min(lo, a);
    hi = Math.max(hi, b);
  }
  if (!isFinite(lo)) {
    lo = today;
    hi = today + 13;
  }
  lo -= 2;
  hi += 2;
  const totalDays = hi - lo + 1;
  const trackWidth = totalDays * DAY_W;

  const days = Array.from({ length: totalDays }, (_, i) => lo + i);

  // Dependencies (optional): a self-relation column whose cells list predecessor
  // row ids. Arrows are drawn between placed bars; enforcement clamps a dragged
  // successor's start to its predecessors' ends.
  const dependsColId = view.dependsOnColumnId;
  const edges = dependsColId ? buildEdges(rows, dependsColId) : [];
  const cyclic = edges.length ? cycleNodes(edges) : EMPTY_SET;
  const floors =
    view.enforceDependencies && edges.length
      ? clampStarts(placed.map((p) => ({ rowId: p.row.id, start: p.start, end: p.end })), edges)
      : EMPTY_MAP;

  // Bar geometry per row, in the overlay's coordinate space (x from track start).
  const barGeo = new Map<string, { leftX: number; rightX: number; y: number }>();
  placed.forEach((p, i) => {
    const leftX = (p.start - lo) * DAY_W;
    const rightX = leftX + Math.max((p.end - p.start + 1) * DAY_W, DAY_W);
    barGeo.set(p.row.id, { leftX, rightX, y: i * ROW_H + BAR_CENTER_Y });
  });

  const barColorOf = (row: TableRow): string | undefined => {
    if (!colorCol) return undefined;
    const ids = Array.isArray(row.cells[colorCol.id]) ? (row.cells[colorCol.id] as string[]) : [];
    return ids[0] ? avatarColor(ids[0]) : undefined;
  };

  const addNew = () => {
    void addRow(tableId).then((id) => id && openRow(id));
  };

  return (
    <div className="p-3">
      <div className="overflow-x-auto rounded-lg border border-paper-line dark:border-coal-line">
        <div style={{ width: NAME_W + trackWidth }}>
          {/* Header: month labels + day numbers */}
          <div className="flex border-b border-paper-line bg-paper-panel/60 dark:border-coal-line dark:bg-coal/40">
            <div
              className="sticky left-0 z-10 shrink-0 border-r border-paper-line bg-paper-panel/60 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-ink-faint dark:border-coal-line dark:bg-coal/60 dark:text-coal-soft"
              style={{ width: NAME_W }}
            >
              Entry
            </div>
            <div className="relative" style={{ width: trackWidth, height: 32 }}>
              {days.map((dn, i) => {
                const p = dayParts(dn);
                const isMonthStart = p.d === 1 || i === 0;
                return (
                  <div
                    key={dn}
                    className={[
                      'absolute top-0 flex h-full flex-col items-center justify-center text-[9px] text-ink-faint dark:text-coal-soft',
                      p.wd === 0 || p.wd === 6 ? 'bg-paper-line/30 dark:bg-coal-line/30' : '',
                    ].join(' ')}
                    style={{ left: i * DAY_W, width: DAY_W }}
                  >
                    {isMonthStart && (
                      <span className="absolute -top-0 left-0 whitespace-nowrap px-1 text-[9px] font-semibold text-clay">
                        {MONTHS[p.m]} {String(p.y).slice(2)}
                      </span>
                    )}
                    <span className="mt-2">{p.d}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Rows */}
          {placed.length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-ink-faint dark:text-coal-soft">
              No dated entries yet. Add one and set its From date.
            </div>
          )}
          <div className="relative">
            {/* Dependency arrows: one SVG over the whole track region, drawn under
                the bars and non-interactive so bar drag still works. */}
            {edges.length > 0 && placed.length > 0 && (
              <svg
                className="pointer-events-none absolute top-0 z-0 text-clay/45"
                style={{ left: NAME_W, width: trackWidth, height: placed.length * ROW_H }}
                width={trackWidth}
                height={placed.length * ROW_H}
              >
                <defs>
                  <marker id="dep-arrow" markerWidth="7" markerHeight="7" refX="5.5" refY="3" orient="auto">
                    <path d="M0,0 L6,3 L0,6 Z" fill="currentColor" />
                  </marker>
                </defs>
                {edges.map((e, i) => {
                  const from = barGeo.get(e.fromRowId);
                  const to = barGeo.get(e.toRowId);
                  if (!from || !to) return null; // an undated endpoint can't be anchored
                  const x1 = from.rightX;
                  const x2 = to.leftX;
                  const xMid = Math.max(x1 + 10, x2 - 10);
                  return (
                    <path
                      key={i}
                      d={`M ${x1} ${from.y} H ${xMid} V ${to.y} H ${x2}`}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.5}
                      markerEnd="url(#dep-arrow)"
                    />
                  );
                })}
              </svg>
            )}
            {placed.map(({ row, start, end }) => {
              const label = (title ? cellText(row.cells[title.id] ?? null, title) : '') || 'Untitled';
              return (
                <div key={row.id} className="flex border-b border-paper-line/60 last:border-0 dark:border-coal-line/60">
                  <div
                    className="sticky left-0 z-10 flex shrink-0 items-center truncate border-r border-paper-line bg-paper px-2 py-1.5 text-xs text-ink dark:border-coal-line dark:bg-coal-panel dark:text-coal-text"
                    style={{ width: NAME_W }}
                    title={label}
                  >
                    {label}
                  </div>
                  <div className="relative py-1.5" style={{ width: trackWidth, height: ROW_TRACK_H }}>
                    {/* today marker */}
                    {today >= lo && today <= hi && (
                      <div className="absolute top-0 z-0 h-full border-l border-clay/50" style={{ left: (today - lo) * DAY_W }} />
                    )}
                    <TimelineBar
                      label={label}
                      start={start}
                      end={end}
                      lo={lo}
                      resizable={!!endCol}
                      color={barColorOf(row)}
                      onOpen={() => openRow(row.id)}
                      onCommit={(ns, ne) => {
                        let s = ns;
                        let e2 = ne;
                        // One-directional enforcement by design: only the dragged
                        // bar moves, never its predecessors or other successors.
                        const floor = floors.get(row.id);
                        if (floor !== undefined && !cyclic.has(row.id) && s < floor) {
                          const shift = floor - s;
                          s += shift;
                          e2 += shift;
                        }
                        if (startCol) setCell(row.id, startCol.id, idxToIso(s));
                        if (endCol) setCell(row.id, endCol.id, idxToIso(e2));
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {cyclic.size > 0 && (
        <p className="mt-2 text-[11px] text-ink-faint dark:text-coal-soft">
          Circular dependency detected, those rows keep their arrows but aren&rsquo;t clamped.
        </p>
      )}

      <button
        type="button"
        onClick={addNew}
        className="mt-2 flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-ink-faint hover:bg-paper-panel hover:text-ink-soft dark:text-coal-soft dark:hover:bg-coal-line"
      >
        <Plus className="h-3.5 w-3.5" /> New entry
      </button>
    </div>
  );
}

// An interactive Gantt bar: drag the body to move, drag the edges to resize.
// Commits day deltas back to the row's date columns on release. A no-move
// release is treated as a click (opens the entry).
function TimelineBar({
  label,
  start,
  end,
  lo,
  resizable,
  color,
  onOpen,
  onCommit,
}: {
  label: string;
  start: number;
  end: number;
  lo: number;
  resizable: boolean;
  color?: string;
  onOpen: () => void;
  onCommit: (newStart: number, newEnd: number) => void;
}) {
  const [drag, setDrag] = useState<{ mode: 'move' | 'start' | 'end'; x0: number; delta: number; moved: boolean } | null>(
    null,
  );
  const dragRef = useRef(drag);
  dragRef.current = drag;

  const begin = (mode: 'move' | 'start' | 'end') => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const x0 = e.clientX;
    setDrag({ mode, x0, delta: 0, moved: false });

    const onMove = (ev: PointerEvent) => {
      const delta = Math.round((ev.clientX - x0) / DAY_W);
      const cur = dragRef.current;
      if (cur) setDrag({ ...cur, delta, moved: cur.moved || Math.abs(ev.clientX - x0) > 3 });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const cur = dragRef.current;
      setDrag(null);
      if (!cur) return;
      if (!cur.moved) {
        onOpen();
        return;
      }
      const d = cur.delta;
      if (cur.mode === 'move') onCommit(start + d, end + d);
      else if (cur.mode === 'start') onCommit(Math.min(start + d, end), end);
      else onCommit(start, Math.max(end + d, start));
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // Live geometry during a drag.
  let s = start;
  let e2 = end;
  if (drag) {
    if (drag.mode === 'move') {
      s = start + drag.delta;
      e2 = end + drag.delta;
    } else if (drag.mode === 'start') {
      s = Math.min(start + drag.delta, end);
    } else {
      e2 = Math.max(end + drag.delta, start);
    }
  }
  const left = (s - lo) * DAY_W;
  const width = Math.max((e2 - s + 1) * DAY_W, DAY_W);

  return (
    <div
      onPointerDown={begin('move')}
      className={[
        'absolute top-1 z-[1] flex h-[22px] cursor-grab items-center truncate rounded-md px-2 text-[11px] font-medium text-white shadow-sm active:cursor-grabbing',
        color ? '' : 'bg-clay hover:bg-clay/90',
      ].join(' ')}
      style={color ? { left, width, backgroundColor: color } : { left, width }}
      title={label}
    >
      {resizable && (
        <span
          onPointerDown={begin('start')}
          className="absolute left-0 top-0 h-full w-1.5 cursor-ew-resize rounded-l-md hover:bg-white/30"
        />
      )}
      <span className="truncate">{label}</span>
      {resizable && (
        <span
          onPointerDown={begin('end')}
          className="absolute right-0 top-0 h-full w-1.5 cursor-ew-resize rounded-r-md hover:bg-white/30"
        />
      )}
    </div>
  );
}
