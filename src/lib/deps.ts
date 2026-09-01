import type { TableRow } from '../types';

// ---------------------------------------------------------------------------
// deps, task dependencies for the timeline, sourced from a self-relation
// column (each row's cell is a `string[]` of predecessor row ids). Pure: graph
// in, graph out, no React. The timeline draws edges and, when enforcement is on,
// uses clampStarts to keep a successor from starting before its predecessors end.
// ---------------------------------------------------------------------------

export interface Edge {
  fromRowId: string; // predecessor
  toRowId: string; // dependent
}

export interface Placed {
  rowId: string;
  start: number; // day index
  end: number; // day index (>= start)
}

/** Edges from a self-relation column: the cell on the dependent row lists its
 *  predecessors. Ids that don't resolve to a current row are dropped. */
export function buildEdges(rows: TableRow[], dependsColId: string): Edge[] {
  const ids = new Set(rows.map((r) => r.id));
  const out: Edge[] = [];
  for (const row of rows) {
    const cell = row.cells[dependsColId];
    if (!Array.isArray(cell)) continue;
    for (const predId of cell) {
      if (typeof predId === 'string' && ids.has(predId)) out.push({ fromRowId: predId, toRowId: row.id });
    }
  }
  return out;
}

/** A card's predecessors (from the self-relation depends column) that are not
 *  yet "done", i.e. whose stage cell isn't one of the done-flagged options.
 *  These are what still block it. Ids are de-duped, and predecessors that don't
 *  resolve to a current row are dropped. Empty when the card is unblocked. */
export function blockingPredecessors(
  row: TableRow,
  rows: readonly TableRow[],
  dependsColId: string,
  groupColId: string,
  doneOptionIds: ReadonlySet<string>,
): TableRow[] {
  const cell = row.cells[dependsColId];
  if (!Array.isArray(cell)) return [];
  const byId = new Map(rows.map((r) => [r.id, r] as const));
  const seen = new Set<string>();
  const out: TableRow[] = [];
  for (const predId of cell) {
    if (typeof predId !== 'string' || seen.has(predId)) continue;
    seen.add(predId);
    const pred = byId.get(predId);
    if (!pred) continue;
    const stage = pred.cells[groupColId];
    if (typeof stage === 'string' && doneOptionIds.has(stage)) continue; // already done
    out.push(pred);
  }
  return out;
}

/** Row ids that sit on a cycle. Found by repeatedly removing nodes with no
 *  remaining predecessors (Kahn's algorithm); whatever can't be removed is in a
 *  cycle. A self-edge counts. */
export function cycleNodes(edges: Edge[]): Set<string> {
  const nodes = new Set<string>();
  const out = new Map<string, string[]>();
  const indeg = new Map<string, number>();
  for (const e of edges) {
    nodes.add(e.fromRowId);
    nodes.add(e.toRowId);
    (out.get(e.fromRowId) ?? out.set(e.fromRowId, []).get(e.fromRowId)!).push(e.toRowId);
    indeg.set(e.toRowId, (indeg.get(e.toRowId) ?? 0) + 1);
    if (!indeg.has(e.fromRowId)) indeg.set(e.fromRowId, indeg.get(e.fromRowId) ?? 0);
  }
  const queue = [...nodes].filter((n) => (indeg.get(n) ?? 0) === 0);
  const removed = new Set<string>();
  while (queue.length) {
    const n = queue.shift()!;
    removed.add(n);
    for (const m of out.get(n) ?? []) {
      const d = (indeg.get(m) ?? 0) - 1;
      indeg.set(m, d);
      if (d === 0) queue.push(m);
    }
  }
  const inCycle = new Set<string>();
  for (const n of nodes) if (!removed.has(n)) inCycle.add(n);
  return inCycle;
}

export function detectCycle(edges: Edge[]): boolean {
  return cycleNodes(edges).size > 0;
}

/**
 * Earliest legal start (day index) for each row that has predecessors: the
 * latest end among its predecessors, propagated through the graph (a
 * predecessor's end is its own clamped start plus its duration). Rows with no
 * predecessors are absent, they're unconstrained, so a leftward drag stays
 * free. Pure; returns the constraint, never mutates. The in-progress guard
 * breaks cycles (a back-edge contributes nothing), so it always terminates.
 */
export function clampStarts(placed: Placed[], edges: Edge[]): Map<string, number> {
  const byId = new Map(placed.map((p) => [p.rowId, p]));
  const preds = new Map<string, string[]>();
  for (const e of edges) {
    if (!byId.has(e.fromRowId) || !byId.has(e.toRowId)) continue;
    (preds.get(e.toRowId) ?? preds.set(e.toRowId, []).get(e.toRowId)!).push(e.fromRowId);
  }
  const effEnd = new Map<string, number>();
  const floor = new Map<string, number>(); // rows with predecessors only
  const inProgress = new Set<string>();

  const resolve = (id: string): void => {
    if (effEnd.has(id) || inProgress.has(id)) return; // memoized or cycle back-edge
    const p = byId.get(id);
    if (!p) return;
    inProgress.add(id);
    const ps = preds.get(id) ?? [];
    let predFloor = -Infinity;
    for (const pred of ps) {
      resolve(pred);
      const pe = effEnd.get(pred);
      if (pe !== undefined) predFloor = Math.max(predFloor, pe);
    }
    inProgress.delete(id);
    const effStart = predFloor === -Infinity ? p.start : Math.max(p.start, predFloor);
    if (predFloor !== -Infinity) floor.set(id, predFloor);
    effEnd.set(id, effStart + (p.end - p.start));
  };

  for (const p of placed) resolve(p.rowId);
  return floor;
}
