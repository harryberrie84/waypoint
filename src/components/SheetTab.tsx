import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, BarChart3, LineChart, PieChart, X, Sigma, Table2 } from 'lucide-react';
import { useData } from '../store/useData';
import { uid } from '../lib/id';
import {
  colName, parseRef, refName, evaluateSheet, emptySheet, isFormula,
  chartPoints, chartScale, pieSlices, MAX_ROWS, MAX_COLS,
  type SheetData, type SheetChart, type CellResult,
} from '../lib/sheet';
import { formatNumber } from '../lib/formula';

// SheetTab, a real grid on a page: A1 references, formulas through the one
// expression engine, and charts you drop on top of a range.
//
// It is page-scoped like every other tab (it reads and writes only this page's
// `sheet` field) and it is READ-ONLY until the column is confirmed present, the
// deal the Currency tab established: PocketBase drops an unknown field instead of
// rejecting the write, so writing anyway would build a spreadsheet that lives in
// one browser and appears in no backup.

const CELL_W = 104;
const CELL_H = 28;
const HEAD_W = 44;

type Sel = { row: number; col: number };

const cellText = (r: CellResult | undefined): string => {
  if (!r) return '';
  if (r.error) return r.error;
  return typeof r.value === 'number' ? formatNumber(r.value) : String(r.value);
};

export function SheetTab({ pageId, editable }: { pageId: string; editable: boolean }) {
  const page = useData((s) => s.pages[pageId]);
  const setPageSheet = useData((s) => s.setPageSheet);
  const fieldExists = useData((s) => s.pageSheetFieldExists);

  const [stored, setStored] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    void fieldExists(pageId).then((ok) => { if (live) setStored(ok); });
    return () => { live = false; };
  }, [fieldExists, pageId]);

  const data: SheetData = page?.sheet ?? emptySheet();
  const canEdit = editable && stored === true;

  const [sel, setSel] = useState<Sel>({ row: 0, col: 0 });
  const [draft, setDraft] = useState<string | null>(null); // the cell being typed into
  const [bar, setBar] = useState(''); // the formula bar's own draft
  const inputRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: string; dx: number; dy: number } | null>(null);

  const results = useMemo(() => evaluateSheet(data), [data]);
  const selRef = refName(sel.row, sel.col);
  const selRaw = data.cells[selRef] ?? '';

  useEffect(() => { setBar(selRaw); }, [selRef, selRaw]);

  const commit = (next: Partial<SheetData>) => setPageSheet(pageId, { ...data, ...next });

  const writeCell = (ref: string, raw: string) => {
    const cells = { ...data.cells };
    if (raw.trim() === '') delete cells[ref];
    else cells[ref] = raw;
    // Typing past the edge grows the sheet rather than refusing the keystroke.
    const at = parseRef(ref);
    const rows = Math.min(MAX_ROWS, Math.max(data.rows, (at?.row ?? 0) + 1));
    const cols = Math.min(MAX_COLS, Math.max(data.cols, (at?.col ?? 0) + 1));
    commit({ cells, rows, cols });
  };

  const move = (dr: number, dc: number) => {
    setDraft(null);
    setSel((s) => ({
      row: Math.max(0, Math.min(MAX_ROWS - 1, s.row + dr)),
      col: Math.max(0, Math.min(MAX_COLS - 1, s.col + dc)),
    }));
  };

  const startEdit = (seed?: string) => {
    if (!canEdit) return;
    setDraft(seed ?? selRaw);
    requestAnimationFrame(() => inputRef.current?.select());
  };

  const commitDraft = (moveBy: { dr: number; dc: number } | null) => {
    if (draft !== null) writeCell(selRef, draft);
    setDraft(null);
    if (moveBy) move(moveBy.dr, moveBy.dc);
  };

  // Grid keyboard. Inert while the formula bar or a chart field owns the caret,
  // so typing a formula never also walks the selection.
  const onGridKey = (e: React.KeyboardEvent) => {
    if (draft !== null) {
      if (e.key === 'Enter') { e.preventDefault(); commitDraft({ dr: 1, dc: 0 }); }
      else if (e.key === 'Tab') { e.preventDefault(); commitDraft({ dr: 0, dc: e.shiftKey ? -1 : 1 }); }
      else if (e.key === 'Escape') { e.preventDefault(); setDraft(null); }
      return;
    }
    if (e.key === 'ArrowUp') { e.preventDefault(); move(-1, 0); }
    else if (e.key === 'ArrowDown' || e.key === 'Enter') { e.preventDefault(); move(1, 0); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); move(0, -1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); move(0, 1); }
    else if (e.key === 'Tab') { e.preventDefault(); move(0, e.shiftKey ? -1 : 1); }
    else if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); if (canEdit) writeCell(selRef, ''); }
    else if (e.key === 'F2') { e.preventDefault(); startEdit(); }
    else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) { e.preventDefault(); startEdit(e.key); }
  };

  // --- charts ---------------------------------------------------------------

  const addChart = (kind: SheetChart['kind']) => {
    if (!canEdit) return;
    // Bind to the selected column's filled run, so "add a chart" does something
    // immediately instead of opening an empty one you then have to configure.
    const col = colName(sel.col);
    const filled: number[] = [];
    for (let r = 0; r < data.rows; r++) if (data.cells[`${col}${r + 1}`] !== undefined) filled.push(r + 1);
    const range = filled.length ? `${col}${filled[0]}:${col}${filled[filled.length - 1]}` : `${col}1:${col}5`;
    const labelCol = sel.col > 0 ? colName(sel.col - 1) : '';
    const labels = labelCol && filled.length ? `${labelCol}${filled[0]}:${labelCol}${filled[filled.length - 1]}` : undefined;
    const chart: SheetChart = {
      id: uid('ch_'), kind, range, labels, title: '',
      x: 40 + (data.charts?.length ?? 0) * 24, y: 40 + (data.charts?.length ?? 0) * 24, w: 320, h: 220,
    };
    commit({ charts: [...(data.charts ?? []), chart] });
  };

  const patchChart = (id: string, patch: Partial<SheetChart>) =>
    commit({ charts: (data.charts ?? []).map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  const dropChart = (id: string) => commit({ charts: (data.charts ?? []).filter((c) => c.id !== id) });

  const onChartMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const box = gridRef.current?.getBoundingClientRect();
    if (!box) return;
    patchChart(d.id, {
      x: Math.max(0, e.clientX - box.left - d.dx + (gridRef.current?.scrollLeft ?? 0)),
      y: Math.max(0, e.clientY - box.top - d.dy + (gridRef.current?.scrollTop ?? 0)),
    });
  };

  if (!page) return null;

  const rows = Math.max(data.rows, 1);
  const cols = Math.max(data.cols, 1);

  return (
    <div className="flex h-full flex-col">
      {/* toolbar + formula bar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-paper-line px-3 py-2 dark:border-coal-line">
        <span className="flex h-7 min-w-[3.5rem] items-center justify-center rounded-md border border-paper-line px-2 font-mono text-xs text-ink-soft dark:border-coal-line dark:text-coal-soft">
          {selRef}
        </span>
        <div className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-paper-line px-2 dark:border-coal-line">
          <Sigma className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
          <input
            value={bar}
            disabled={!canEdit}
            onChange={(e) => setBar(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { writeCell(selRef, bar); move(1, 0); gridRef.current?.focus(); }
              if (e.key === 'Escape') { setBar(selRaw); gridRef.current?.focus(); }
            }}
            placeholder={canEdit ? '=SUM(A1:A9)' : 'read only'}
            className="min-w-0 flex-1 bg-transparent font-mono text-xs text-ink outline-none placeholder:text-ink-faint/60 disabled:opacity-60 dark:text-coal-text"
          />
        </div>
        {canEdit && (
          <div className="flex items-center gap-1">
            {([['bar', BarChart3], ['line', LineChart], ['pie', PieChart]] as const).map(([kind, Icon]) => (
              <button
                key={kind}
                type="button"
                onClick={() => addChart(kind)}
                title={`add a ${kind} chart from the selected column`}
                className="rounded-md border border-paper-line p-1.5 text-ink-soft hover:bg-paper-panel hover:text-clay dark:border-coal-line dark:text-coal-soft dark:hover:bg-coal-line"
              >
                <Icon className="h-3.5 w-3.5" />
              </button>
            ))}
            <button
              type="button"
              onClick={() => commit({ rows: Math.min(MAX_ROWS, rows + 10), cols: Math.min(MAX_COLS, cols + 2) })}
              title="more rows and columns"
              className="rounded-md border border-paper-line p-1.5 text-ink-soft hover:bg-paper-panel dark:border-coal-line dark:text-coal-soft dark:hover:bg-coal-line"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {stored === false && (
        <p className="border-b border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-900/20 dark:text-amber-200">
          This sheet is read-only. Ask whoever runs this Waypoint to finish the setup, then it will save and sync.
        </p>
      )}

      <div
        ref={gridRef}
        tabIndex={0}
        onKeyDown={onGridKey}
        onPointerMove={onChartMove}
        onPointerUp={() => { dragRef.current = null; }}
        className="relative flex-1 overflow-auto outline-none"
      >
        <table className="border-separate" style={{ borderSpacing: 0 }}>
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-20 border-b border-r border-paper-line bg-paper-panel dark:border-coal-line dark:bg-coal-panel" style={{ width: HEAD_W, minWidth: HEAD_W, height: CELL_H }} />
              {Array.from({ length: cols }, (_, c) => (
                <th
                  key={c}
                  className={`sticky top-0 z-10 border-b border-r border-paper-line bg-paper-panel text-[11px] font-medium dark:border-coal-line dark:bg-coal-panel ${c === sel.col ? 'text-clay' : 'text-ink-faint dark:text-coal-soft'}`}
                  style={{ width: data.widths?.[colName(c)] ?? CELL_W, minWidth: data.widths?.[colName(c)] ?? CELL_W, height: CELL_H }}
                >
                  {colName(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }, (_, r) => (
              <tr key={r}>
                <th
                  className={`sticky left-0 z-10 border-b border-r border-paper-line bg-paper-panel text-[11px] font-medium dark:border-coal-line dark:bg-coal-panel ${r === sel.row ? 'text-clay' : 'text-ink-faint dark:text-coal-soft'}`}
                  style={{ width: HEAD_W, minWidth: HEAD_W, height: CELL_H }}
                >
                  {r + 1}
                </th>
                {Array.from({ length: cols }, (_, c) => {
                  const ref = refName(r, c);
                  const here = r === sel.row && c === sel.col;
                  const res = results[ref];
                  const numeric = res && !res.error && typeof res.value === 'number';
                  return (
                    <td
                      key={c}
                      onPointerDown={() => { setDraft(null); setSel({ row: r, col: c }); gridRef.current?.focus(); }}
                      onDoubleClick={() => { setSel({ row: r, col: c }); startEdit(); }}
                      className={[
                        'relative border-b border-r border-paper-line px-1.5 text-xs dark:border-coal-line',
                        here ? 'z-10 outline outline-2 -outline-offset-2 outline-clay' : '',
                        res?.error ? 'text-red-500' : 'text-ink dark:text-coal-text',
                        numeric ? 'text-right tabular-nums' : 'text-left',
                        isFormula(data.cells[ref]) && !res?.error ? 'bg-clay/[0.04]' : '',
                      ].join(' ')}
                      style={{ width: data.widths?.[colName(c)] ?? CELL_W, height: CELL_H }}
                      title={isFormula(data.cells[ref]) ? data.cells[ref] : undefined}
                    >
                      {here && draft !== null ? (
                        <input
                          ref={inputRef}
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onBlur={() => commitDraft(null)}
                          autoFocus
                          className="absolute inset-0 h-full w-full bg-paper px-1.5 font-mono text-xs text-ink outline-none dark:bg-coal-panel dark:text-coal-text"
                        />
                      ) : (
                        <span className="block truncate">{cellText(res)}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>

        {/* charts float over the grid */}
        {(data.charts ?? []).map((chart) => (
          <ChartCard
            key={chart.id}
            chart={chart}
            points={chartPoints(chart, results)}
            editable={canEdit}
            onGrab={(e) => {
              if (!canEdit) return;
              const box = gridRef.current!.getBoundingClientRect();
              dragRef.current = {
                id: chart.id,
                dx: e.clientX - box.left - chart.x + (gridRef.current?.scrollLeft ?? 0),
                dy: e.clientY - box.top - chart.y + (gridRef.current?.scrollTop ?? 0),
              };
            }}
            onChange={(patch) => patchChart(chart.id, patch)}
            onDelete={() => dropChart(chart.id)}
          />
        ))}
      </div>
    </div>
  );
}

// --- chart card -------------------------------------------------------------

function ChartCard({ chart, points, editable, onGrab, onChange, onDelete }: {
  chart: SheetChart;
  points: { label: string; value: number }[];
  editable: boolean;
  onGrab: (e: React.PointerEvent) => void;
  onChange: (patch: Partial<SheetChart>) => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="absolute rounded-lg border border-paper-line bg-paper shadow-md dark:border-coal-line dark:bg-coal-panel"
      style={{ left: chart.x, top: chart.y, width: chart.w, height: chart.h }}
    >
      <div
        onPointerDown={onGrab}
        className={`flex items-center gap-1.5 rounded-t-lg border-b border-paper-line px-2 py-1 dark:border-coal-line ${editable ? 'cursor-grab active:cursor-grabbing' : ''}`}
      >
        <Table2 className="h-3 w-3 shrink-0 text-clay" />
        <input
          value={chart.title ?? ''}
          disabled={!editable}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder={chart.range}
          className="min-w-0 flex-1 bg-transparent text-[11px] font-medium text-ink outline-none placeholder:text-ink-faint/70 dark:text-coal-text"
        />
        {editable && (
          <>
            <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={() => setOpen((o) => !o)} className="rounded p-0.5 text-[10px] text-ink-faint hover:bg-paper-panel dark:hover:bg-coal-line">
              range
            </button>
            <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={onDelete} className="rounded p-0.5 text-ink-faint hover:bg-paper-panel hover:text-red-500 dark:hover:bg-coal-line">
              <X className="h-3 w-3" />
            </button>
          </>
        )}
      </div>
      {open && editable && (
        <div className="flex items-center gap-1 border-b border-paper-line px-2 py-1 dark:border-coal-line" onPointerDown={(e) => e.stopPropagation()}>
          <input value={chart.range} onChange={(e) => onChange({ range: e.target.value.toUpperCase() })} placeholder="B1:B9" className="w-20 rounded border border-paper-line bg-paper px-1 font-mono text-[10px] text-ink outline-none dark:border-coal-line dark:bg-coal dark:text-coal-text" />
          <input value={chart.labels ?? ''} onChange={(e) => onChange({ labels: e.target.value.toUpperCase() })} placeholder="A1:A9" className="w-20 rounded border border-paper-line bg-paper px-1 font-mono text-[10px] text-ink outline-none dark:border-coal-line dark:bg-coal dark:text-coal-text" />
          <select value={chart.kind} onChange={(e) => onChange({ kind: e.target.value as SheetChart['kind'] })} className="rounded border border-paper-line bg-paper px-1 text-[10px] text-ink outline-none dark:border-coal-line dark:bg-coal dark:text-coal-text">
            <option value="bar">bar</option>
            <option value="line">line</option>
            <option value="pie">pie</option>
          </select>
        </div>
      )}
      <div className="p-2" style={{ height: chart.h - (open && editable ? 56 : 28) }}>
        {points.length === 0 ? (
          <p className="flex h-full items-center justify-center text-center text-[11px] text-ink-faint dark:text-coal-soft">nothing numeric in {chart.range}</p>
        ) : (
          <ChartBody kind={chart.kind} points={points} />
        )}
      </div>
    </div>
  );
}

const SLICE_COLORS = ['rgb(var(--clay))', 'rgb(var(--ochre))', 'rgb(110 190 130)', 'rgb(110 170 240)', 'rgb(170 140 240)', 'rgb(230 170 90)'];

function ChartBody({ kind, points }: { kind: SheetChart['kind']; points: { label: string; value: number }[] }) {
  if (kind === 'pie') {
    const slices = pieSlices(points);
    // Hand-built arcs: a pie is four lines of trigonometry and does not justify
    // a charting dependency (see the no-new-dependency rule).
    const pt = (turn: number) => {
      const a = (turn - 0.25) * Math.PI * 2;
      return `${50 + 42 * Math.cos(a)} ${50 + 42 * Math.sin(a)}`;
    };
    return (
      <svg viewBox="0 0 100 100" className="h-full w-full">
        {slices.map((s, i) => {
          if (s.to - s.from >= 0.999) return <circle key={s.label + i} cx="50" cy="50" r="42" fill={SLICE_COLORS[i % SLICE_COLORS.length]} />;
          const large = s.to - s.from > 0.5 ? 1 : 0;
          return (
            <path key={s.label + i} d={`M 50 50 L ${pt(s.from)} A 42 42 0 ${large} 1 ${pt(s.to)} Z`} fill={SLICE_COLORS[i % SLICE_COLORS.length]}>
              <title>{`${s.label}: ${formatNumber(s.value)}`}</title>
            </path>
          );
        })}
      </svg>
    );
  }

  const { min, span } = chartScale(points);
  const y = (v: number) => 100 - ((v - min) / span) * 100;
  const step = points.length > 1 ? 100 / (points.length - 1) : 0;
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
      <line x1="0" y1={y(0)} x2="100" y2={y(0)} stroke="rgb(var(--ink-faint))" strokeWidth="0.4" opacity="0.5" />
      {kind === 'bar'
        ? points.map((p, i) => {
            const w = 100 / points.length;
            const top = Math.min(y(p.value), y(0));
            return (
              <rect key={p.label + i} x={i * w + w * 0.15} y={top} width={w * 0.7} height={Math.max(0.5, Math.abs(y(p.value) - y(0)))} fill="rgb(var(--clay))">
                <title>{`${p.label}: ${formatNumber(p.value)}`}</title>
              </rect>
            );
          })
        : (
          <polyline
            fill="none"
            stroke="rgb(var(--clay))"
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
            points={points.map((p, i) => `${i * step},${y(p.value)}`).join(' ')}
          />
        )}
    </svg>
  );
}
