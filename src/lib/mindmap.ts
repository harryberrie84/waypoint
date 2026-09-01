import { curvePoints } from './tableQuery';
import type { MindNode, MindEdge, MindViewport, MindWidgetValue } from '../types';

// ---------------------------------------------------------------------------
// Mindmap, pure geometry + graph helpers for the free-canvas view. No React,
// no store. The view feeds these node/edge/viewport plain objects; mutations are
// persisted by the store (setPageMindmap), the lib only transforms.
// ---------------------------------------------------------------------------

export interface Pt {
  x: number;
  y: number;
}

// Default card size, used for anchor centres + fit bounds when a node hasn't
// been measured/resized yet.
export const NODE_W = 168;
export const NODE_H = 64;

// screen = canvas * zoom + pan ; and the exact inverse. Round-trip stable.
export function toScreen(canvas: Pt, vp: MindViewport): Pt {
  return { x: canvas.x * vp.zoom + vp.x, y: canvas.y * vp.zoom + vp.y };
}
export function toCanvas(screen: Pt, vp: MindViewport): Pt {
  return { x: (screen.x - vp.x) / vp.zoom, y: (screen.y - vp.y) / vp.zoom };
}

// The centre of a node's card in canvas space, where edges attach. Structural
// so it serves both mindmap and flow nodes (only x/y/w/h are read).
export function nodeCenter(node: { x: number; y: number; w?: number; h?: number }): Pt {
  return { x: node.x + (node.w ?? NODE_W) / 2, y: node.y + (node.h ?? NODE_H) / 2 };
}

// Bowed SVG path between two canvas points, reusing the map's curve sampler so
// edges arc the same way the map's connectors do. Endpoints are exact.
export function edgePath(a: Pt, b: Pt, curvature = 0.18): string {
  const pts = curvePoints([a.x, a.y], [b.x, b.y], curvature);
  return pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
}

// --- Edge ops ---------------------------------------------------------------

const edgeKey = (e: { from: string; to: string }) => `${e.from}->${e.to}`;

// Drop self-edges and exact duplicates (same from→to). A reverse edge (b→a) is
// kept, directed edges can be mutual. Generic so flow edges reuse it.
export function dedupeEdges<E extends { id: string; from: string; to: string }>(edges: E[]): E[] {
  const seen = new Set<string>();
  const out: E[] = [];
  for (const e of edges) {
    if (e.from === e.to) continue;
    const k = edgeKey(e);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out;
}

// Add an edge from→to unless it's a self-edge or already present. Generic so the
// flow canvas (FlowEdge) and the mindmap (MindEdge) share one connector; the new
// edge is built from the caller's optional attrs.
export function connect<E extends { id: string; from: string; to: string }>(
  edges: E[],
  from: string,
  to: string,
  attrs?: Partial<Omit<E, 'id' | 'from' | 'to'>>,
): E[] {
  if (from === to) return edges;
  if (edges.some((e) => e.from === from && e.to === to)) return edges;
  const edge = { id: `e_${from}_${to}_${Math.random().toString(36).slice(2, 7)}`, from, to, ...attrs } as E;
  return [...edges, edge];
}

// --- Collapse ---------------------------------------------------------------

// Given the set of collapsed node ids, the ids of nodes that should hide: the
// descendants reachable along outgoing edges from any collapsed node. A mindmap
// is a graph, not a tree, so the walk is cycle-guarded (a back-edge can't loop).
export function collapsedHidden(nodes: MindNode[], edges: MindEdge[], collapsed: Set<string>): Set<string> {
  const out = new Set<string>();
  if (!collapsed.size) return out;
  const ids = new Set(nodes.map((n) => n.id));
  const children = new Map<string, string[]>();
  for (const e of edges) {
    if (!ids.has(e.from) || !ids.has(e.to)) continue;
    const bucket = children.get(e.from) ?? [];
    bucket.push(e.to);
    children.set(e.from, bucket);
  }
  const walk = (start: string) => {
    const stack = [...(children.get(start) ?? [])];
    while (stack.length) {
      const id = stack.pop()!;
      if (out.has(id) || id === start) continue;
      out.add(id);
      for (const next of children.get(id) ?? []) if (!out.has(next)) stack.push(next);
    }
  };
  for (const id of collapsed) walk(id);
  // A collapsed node itself stays visible, it's the thing you click to expand.
  for (const id of collapsed) out.delete(id);
  return out;
}

// --- Selection --------------------------------------------------------------

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Drop the given nodes and every edge that touches one of them, in a single
// pass. Returns fresh arrays the caller commits as one change (so the store
// sees one update, not N). A no-op when the id set is empty. Generic so the flow
// canvas reuses it.
export function deleteNodes<N extends { id: string }, E extends { from: string; to: string }>(
  nodes: N[],
  edges: E[],
  ids: Set<string>,
): { nodes: N[]; edges: E[] } {
  if (!ids.size) return { nodes, edges };
  return {
    nodes: nodes.filter((n) => !ids.has(n.id)),
    edges: edges.filter((e) => !ids.has(e.from) && !ids.has(e.to)),
  };
}

// Ids of nodes whose card box (canvas space) intersects the rect, the marquee
// hit test. Box-overlap, so a node straddling an edge counts. The rect is
// expected normalised (positive w/h); callers normalise a backwards drag first.
export function nodesInRect(nodes: MindNode[], rect: Rect): string[] {
  const rx2 = rect.x + rect.w;
  const ry2 = rect.y + rect.h;
  const out: string[] = [];
  for (const n of nodes) {
    const nx2 = n.x + (n.w ?? NODE_W);
    const ny2 = n.y + (n.h ?? NODE_H);
    if (n.x < rx2 && nx2 > rect.x && n.y < ry2 && ny2 > rect.y) out.push(n.id);
  }
  return out;
}

// Selection update: additive toggles the id in/out (shift/⌘-click); otherwise
// the id becomes the sole selection. Always a new Set, never mutates the input.
export function toggleSelected(set: Set<string>, id: string, additive: boolean): Set<string> {
  if (!additive) return new Set([id]);
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

// --- Growing the map --------------------------------------------------------

// Where a new child of `parent` goes: one column to its right, and below any
// children it already has, so pressing the add-child key repeatedly fans out
// instead of stacking every child on the same spot.
export function childPosition(parent: { x: number; y: number; w?: number; h?: number }, siblings: { y: number; h?: number }[]): Pt {
  const x = parent.x + (parent.w ?? NODE_W) + 72;
  if (!siblings.length) return { x, y: parent.y };
  let lowest = -Infinity;
  for (const s of siblings) lowest = Math.max(lowest, s.y + (s.h ?? NODE_H));
  return { x, y: lowest + 24 };
}

// Copy a selection. Edges are copied ONLY when both ends are inside it: a
// half-copied edge would re-point at the original node and read as the copy
// having been wired to it, which is not what duplicating drew on screen.
export function duplicateNodes(
  nodes: MindNode[],
  edges: MindEdge[],
  ids: Set<string>,
  mint: (prefix?: string) => string,
  offset: Pt = { x: 28, y: 28 },
): { nodes: MindNode[]; edges: MindEdge[]; newIds: string[] } {
  if (!ids.size) return { nodes, edges, newIds: [] };
  const idMap = new Map<string, string>();
  const copies: MindNode[] = [];
  for (const n of nodes) {
    if (!ids.has(n.id)) continue;
    const id = mint('mn_');
    idMap.set(n.id, id);
    copies.push({ ...n, id, x: n.x + offset.x, y: n.y + offset.y });
  }
  const copiedEdges: MindEdge[] = [];
  for (const e of edges) {
    const from = idMap.get(e.from);
    const to = idMap.get(e.to);
    if (!from || !to) continue;
    copiedEdges.push({ ...e, id: mint('me_'), from, to });
  }
  return { nodes: [...nodes, ...copies], edges: [...edges, ...copiedEdges], newIds: copies.map((c) => c.id) };
}

// --- Tidy -------------------------------------------------------------------

export const LAYOUT_GAP_X = 72; // clear space between one column and the next
export const LAYOUT_GAP_Y = 28; // clear space between two cards stacked in a column

/** How big a card actually is. The default reads the stored box, but the view
 *  passes its MEASURED sizes: cards lay out with minHeight, so a node with an
 *  image or a few lines of text is taller than the `h` it was stored with, and
 *  laying out against that stored h is what makes a tidy overlap. */
export type SizeOf = (n: MindNode) => { w: number; h: number };
const storedSize: SizeOf = (n) => ({ w: n.w ?? NODE_W, h: n.h ?? NODE_H });

// Lay the graph out left to right: roots in the first column, each child one
// column further right, and a parent centred against the band its children
// occupy. Spacing comes from the cards themselves, never a fixed step: a column
// is as wide as its widest card and a card is followed by the next one below it
// plus a gap, so a tall image node pushes its neighbours down instead of sitting
// on top of them. Within a column, a running floor guarantees no two cards can
// overlap even when a parent is much taller than the band it centres on.
//
// A mindmap is a graph rather than a tree, so this walks a spanning tree (the
// first parent to reach a node owns it) and is cycle-guarded; anything no root
// can reach, an island or a pure cycle, is laid out afterwards so nothing is
// left behind at its old coordinates. Deterministic: same input, same output.
export function treeLayout(nodes: MindNode[], edges: MindEdge[], origin: Pt = { x: 0, y: 0 }, sizeOf: SizeOf = storedSize): MindNode[] {
  if (!nodes.length) return nodes;
  const ids = new Set(nodes.map((n) => n.id));
  const size = new Map<string, { w: number; h: number }>();
  for (const n of nodes) size.set(n.id, sizeOf(n));

  const children = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const n of nodes) indegree.set(n.id, 0);
  for (const e of edges) {
    if (e.from === e.to || !ids.has(e.from) || !ids.has(e.to)) continue;
    const bucket = children.get(e.from) ?? [];
    if (bucket.includes(e.to)) continue; // a duplicate edge must not double-count
    bucket.push(e.to);
    children.set(e.from, bucket);
    indegree.set(e.to, (indegree.get(e.to) ?? 0) + 1);
  }

  // Pass 1: depth, and the spanning tree the second pass walks. Recording the
  // tree here (rather than re-deriving it) keeps both passes on the same shape.
  const depth = new Map<string, number>();
  const treeKids = new Map<string, string[]>();
  const seen = new Set<string>();
  const assign = (id: string, d: number, parent: string | null) => {
    if (seen.has(id)) return;
    seen.add(id);
    depth.set(id, d);
    if (parent) treeKids.set(parent, [...(treeKids.get(parent) ?? []), id]);
    for (const k of children.get(id) ?? []) assign(k, d + 1, id);
  };
  const order = nodes.map((n) => n.id);
  for (const id of order) if ((indegree.get(id) ?? 0) === 0) assign(id, 0, null);
  for (const id of order) assign(id, 0, null); // islands and pure cycles

  // Column positions: each column starts after the widest card in the one before.
  const widest = new Map<number, number>();
  for (const [id, d] of depth) widest.set(d, Math.max(widest.get(d) ?? 0, size.get(id)!.w));
  const colX = new Map<number, number>();
  let x = origin.x;
  for (const d of [...widest.keys()].sort((a, b) => a - b)) {
    colX.set(d, x);
    x += (widest.get(d) ?? NODE_W) + LAYOUT_GAP_X;
  }

  // Pass 2: y, children before parents, with a per-column floor so nothing overlaps.
  const yOf = new Map<string, number>();
  const floor = new Map<number, number>();
  let cursor = origin.y;
  const put = (id: string, desired: number): number => {
    const d = depth.get(id) ?? 0;
    const h = size.get(id)!.h;
    const y = Math.max(desired, floor.has(d) ? floor.get(d)! + LAYOUT_GAP_Y : origin.y);
    yOf.set(id, y);
    floor.set(d, y + h);
    return y;
  };
  const walked = new Set<string>();
  const walk = (id: string) => {
    if (walked.has(id)) return;
    walked.add(id);
    const kids = treeKids.get(id) ?? [];
    const h = size.get(id)!.h;
    if (!kids.length) {
      cursor = put(id, cursor) + h + LAYOUT_GAP_Y;
      return;
    }
    for (const k of kids) walk(k);
    const top = yOf.get(kids[0])!;
    const lastKid = kids[kids.length - 1];
    const bottom = yOf.get(lastKid)! + size.get(lastKid)!.h;
    const y = put(id, (top + bottom) / 2 - h / 2);
    cursor = Math.max(cursor, y + h + LAYOUT_GAP_Y);
  };
  for (const id of order) if ((indegree.get(id) ?? 0) === 0) walk(id);
  for (const id of order) walk(id);

  return nodes.map((n) => {
    const y = yOf.get(n.id);
    const cx = colX.get(depth.get(n.id) ?? 0);
    return y === undefined || cx === undefined ? n : { ...n, x: cx, y };
  });
}

// --- Find + roll-up ---------------------------------------------------------

// Ids of nodes whose label contains the query, case-insensitively. The label
// resolver is injected because page / person / row nodes read their text from
// the store, which this module deliberately cannot see. Blank query matches
// nothing (rather than everything, which would "highlight" the whole canvas).
export function matchNodes(nodes: MindNode[], query: string, label: (n: MindNode) => string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return nodes.filter((n) => label(n).toLowerCase().includes(q)).map((n) => n.id);
}

// How many checkbox nodes are ticked. Drives the "n of m done" chip, so a map
// used as a to-do list can be read at a glance without counting cards.
export function checkProgress(nodes: MindNode[]): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const n of nodes) {
    if (n.kind !== 'widget') continue;
    total += 1;
    if ((n.payload as MindWidgetValue)?.checked) done += 1;
  }
  return { done, total };
}

// --- Fit --------------------------------------------------------------------

// One-time viewport that frames every node with padding, centred. Empty graph →
// identity. Zoom clamped so a single node doesn't zoom to absurd levels.
export function fitView(nodes: { x: number; y: number; w?: number; h?: number }[], size: { width: number; height: number }, padding = 80): MindViewport {
  if (!nodes.length || size.width <= 0 || size.height <= 0) return { x: 0, y: 0, zoom: 1 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + (n.w ?? NODE_W));
    maxY = Math.max(maxY, n.y + (n.h ?? NODE_H));
  }
  const bw = maxX - minX || NODE_W;
  const bh = maxY - minY || NODE_H;
  const zoom = Math.max(0.2, Math.min(1.4, Math.min((size.width - padding * 2) / bw, (size.height - padding * 2) / bh)));
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return { x: size.width / 2 - cx * zoom, y: size.height / 2 - cy * zoom, zoom };
}
