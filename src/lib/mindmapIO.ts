// Portable JSON for a page's mindmap (the free-canvas graph in `pages.mindmap`):
// its nodes and the edges between them, in a human/AI-authorable shape. A node
// carries friendly fields (text / number / place / checked) instead of the raw
// per-kind `payload`, positions are OPTIONAL (missing ones auto-layout on a
// grid), and edges reference nodes by their `id`. The import side rebuilds real
// MindNode/MindEdge records with fresh ids and remaps the edges onto them.
//
// Non-determinism (id minting) is injected, so the module is pure and testable.
// Reference kinds (page / person / row) round-trip their target id but do NOT
// reconnect from a standalone file / a different workspace, like the kanban's
// cross-table relations.

import type { GeoValue, MindEdge, MindNode, MindNodeKind, MindRowValue, MindWidgetValue, MindmapData } from '../types';

const KINDS = new Set<MindNodeKind>(['text', 'place', 'person', 'page', 'number', 'widget', 'row', 'image']);

// --- Bundle shape -----------------------------------------------------------

export interface MindmapBundleNode {
  id: string; // referenced by edges; minted on export, keep it when hand-authoring
  kind?: MindNodeKind; // default 'text'
  text?: string; // text / page id / person id / image url; and a widget's label
  number?: number; // number kind
  // place kind. address/category are optional and carried through: the card
  // renders the address under the name, so dropping them on export meant a
  // round-trip quietly returned a thinner place than the one you exported.
  place?: { name: string; lat: number; lon: number; address?: string; category?: string };
  row?: MindRowValue; // row kind (tableId / optional rowId)
  checked?: boolean; // widget kind
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  color?: string;
  collapsed?: boolean;
}

export interface MindmapBundleEdge {
  from: string; // node id
  to: string; // node id
  label?: string;
  directed?: boolean;
  biDir?: boolean;
  style?: 'solid' | 'dashed';
  color?: string;
}

export interface MindmapBundle {
  waypointMindmap: 1;
  title: string;
  nodes: MindmapBundleNode[];
  edges: MindmapBundleEdge[];
  instructions?: string[]; // guidance for a human/AI; ignored on import
}

export interface MindmapImportDeps {
  uid: (prefix?: string) => string;
}

// --- Export: MindmapData -> bundle ------------------------------------------

function payloadToFriendly(node: MindNode): Partial<MindmapBundleNode> {
  switch (node.kind) {
    case 'number':
      return { number: typeof node.payload === 'number' ? node.payload : Number(node.payload) || 0 };
    case 'place': {
      const g = node.payload as GeoValue;
      if (!g || typeof g !== 'object') return {};
      return {
        place: {
          name: g.name,
          lat: g.lat,
          lon: g.lon,
          ...(g.address ? { address: g.address } : {}),
          ...(g.category ? { category: g.category } : {}),
        },
      };
    }
    case 'widget': {
      const w = node.payload as MindWidgetValue;
      return w && typeof w === 'object' ? { text: w.text ?? '', checked: !!w.checked } : {};
    }
    case 'row': {
      const r = node.payload as MindRowValue;
      return r && typeof r === 'object' ? { row: { tableId: r.tableId, ...(r.rowId ? { rowId: r.rowId } : {}) } } : {};
    }
    default:
      // text / page / person / image: a plain string payload
      return { text: typeof node.payload === 'string' ? node.payload : '' };
  }
}

/** Snapshot a live mindmap as a portable bundle. */
export function mindmapToBundle(data: MindmapData, title: string): MindmapBundle {
  const nodes: MindmapBundleNode[] = (data.nodes ?? []).map((n) => ({
    id: n.id,
    kind: n.kind,
    ...payloadToFriendly(n),
    x: Math.round(n.x),
    y: Math.round(n.y),
    ...(n.w ? { w: n.w } : {}),
    ...(n.h ? { h: n.h } : {}),
    ...(n.color ? { color: n.color } : {}),
    ...(n.collapsed ? { collapsed: true } : {}),
  }));
  const edges: MindmapBundleEdge[] = (data.edges ?? []).map((e) => ({
    from: e.from,
    to: e.to,
    ...(e.label ? { label: e.label } : {}),
    ...(e.directed ? { directed: true } : {}),
    ...(e.biDir ? { biDir: true } : {}),
    ...(e.style && e.style !== 'solid' ? { style: e.style } : {}),
    ...(e.color ? { color: e.color } : {}),
  }));
  return { waypointMindmap: 1, title: title || 'Mindmap', nodes, edges };
}

// --- Parse + validate -------------------------------------------------------

/** Parse and validate a pasted/loaded bundle. Throws a readable error on bad input. */
export function parseMindmapBundle(text: string): MindmapBundle {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('That is not valid JSON.');
  }
  const obj = raw as Partial<MindmapBundle>;
  if (!obj || typeof obj !== 'object' || !Array.isArray(obj.nodes)) {
    throw new Error('Not a mindmap file (expected a "nodes" array).');
  }
  const nodes: MindmapBundleNode[] = obj.nodes
    .map((n) => n as Partial<MindmapBundleNode> & { id?: unknown })
    .filter((n) => n && typeof n === 'object')
    .map((n, i) => ({
      id: typeof n.id === 'string' && n.id.trim() ? n.id : `n${i}`,
      kind: typeof n.kind === 'string' && KINDS.has(n.kind as MindNodeKind) ? (n.kind as MindNodeKind) : 'text',
      text: typeof n.text === 'string' ? n.text : undefined,
      number: typeof n.number === 'number' ? n.number : undefined,
      place: n.place && typeof n.place === 'object' ? n.place : undefined,
      row: n.row && typeof n.row === 'object' ? n.row : undefined,
      checked: typeof n.checked === 'boolean' ? n.checked : undefined,
      x: typeof n.x === 'number' ? n.x : undefined,
      y: typeof n.y === 'number' ? n.y : undefined,
      w: typeof n.w === 'number' ? n.w : undefined,
      h: typeof n.h === 'number' ? n.h : undefined,
      color: typeof n.color === 'string' ? n.color : undefined,
      collapsed: typeof n.collapsed === 'boolean' ? n.collapsed : undefined,
    }));
  const edges: MindmapBundleEdge[] = Array.isArray(obj.edges)
    ? obj.edges
        .map((e) => e as Partial<MindmapBundleEdge>)
        .filter((e) => e && typeof e.from === 'string' && typeof e.to === 'string')
        .map((e) => ({
          from: e.from as string,
          to: e.to as string,
          label: typeof e.label === 'string' ? e.label : undefined,
          directed: typeof e.directed === 'boolean' ? e.directed : undefined,
          biDir: typeof e.biDir === 'boolean' ? e.biDir : undefined,
          style: e.style === 'dashed' ? 'dashed' : undefined,
          color: typeof e.color === 'string' ? e.color : undefined,
        }))
    : [];
  return { waypointMindmap: 1, title: typeof obj.title === 'string' ? obj.title : 'Mindmap', nodes, edges };
}

// --- Import: bundle -> MindmapData ------------------------------------------

function friendlyToPayload(node: MindmapBundleNode): MindNode['payload'] {
  switch (node.kind) {
    case 'number':
      return typeof node.number === 'number' ? node.number : Number(node.number) || 0;
    case 'place':
      return (node.place && typeof node.place === 'object'
        ? {
            name: node.place.name ?? '',
            lat: Number(node.place.lat) || 0,
            lon: Number(node.place.lon) || 0,
            ...(node.place.address ? { address: node.place.address } : {}),
            ...(node.place.category ? { category: node.place.category } : {}),
          }
        : { name: '', lat: 0, lon: 0 }) as GeoValue;
    case 'widget':
      return { text: node.text ?? '', checked: !!node.checked } as MindWidgetValue;
    case 'row':
      return (node.row && typeof node.row === 'object' ? node.row : { tableId: '' }) as MindRowValue;
    default:
      return node.text ?? '';
  }
}

/** Turn a validated bundle into real MindmapData with fresh ids (edges remapped
 *  onto them). Nodes with no x/y are laid out on a simple grid so they don't
 *  stack at the origin. */
export function bundleToMindmap(bundle: MindmapBundle, deps: MindmapImportDeps): MindmapData {
  const idMap = new Map<string, string>();
  const nodes: MindNode[] = bundle.nodes.map((bn, i) => {
    const id = deps.uid('mn_');
    idMap.set(bn.id, id);
    const node: MindNode = {
      id,
      kind: bn.kind ?? 'text',
      x: typeof bn.x === 'number' ? bn.x : (i % 5) * 220,
      y: typeof bn.y === 'number' ? bn.y : Math.floor(i / 5) * 150,
      payload: friendlyToPayload(bn),
    };
    if (bn.w) node.w = bn.w;
    if (bn.h) node.h = bn.h;
    if (bn.color) node.color = bn.color;
    if (bn.collapsed) node.collapsed = true;
    return node;
  });

  const edges: MindEdge[] = [];
  for (const be of bundle.edges) {
    const from = idMap.get(be.from);
    const to = idMap.get(be.to);
    if (!from || !to) continue; // an edge to a node that isn't in the file is dropped
    const edge: MindEdge = { id: deps.uid('me_'), from, to };
    if (be.label) edge.label = be.label;
    if (be.directed) edge.directed = true;
    if (be.biDir) edge.biDir = true;
    if (be.style === 'dashed') edge.style = 'dashed';
    if (be.color) edge.color = be.color;
    edges.push(edge);
  }
  return { nodes, edges };
}

/** Pretty-print a bundle for download (stable 2-space JSON). */
export function serializeMindmapBundle(bundle: MindmapBundle): string {
  return JSON.stringify(bundle, null, 2);
}

// --- Downloadable template + annotated example ------------------------------

/** A tiny scaffold that imports cleanly: three text nodes wired as a little tree. */
export function blankMindmapBundle(): MindmapBundle {
  return {
    waypointMindmap: 1,
    title: 'New mindmap',
    nodes: [
      { id: 'root', kind: 'text', text: 'Central idea', x: 220, y: 40 },
      { id: 'a', kind: 'text', text: 'First branch', x: 60, y: 220 },
      { id: 'b', kind: 'text', text: 'Second branch', x: 380, y: 220 },
    ],
    edges: [
      { from: 'root', to: 'a', directed: true },
      { from: 'root', to: 'b', directed: true },
    ],
  };
}

/** A worked example with guidance embedded (ignored on import). */
export function exampleMindmapBundle(): MindmapBundle {
  return {
    waypointMindmap: 1,
    title: 'Japan trip mindmap',
    instructions: [
      'This file imports as a page mindmap. Keep this shape and replace the content. "waypointMindmap", "nodes" and "edges" are required; "instructions" is ignored on import.',
      'Each node needs an "id" (any string, unique in the file) that edges reference. "kind" is text, number, place, widget, page, person, row or image; it defaults to text.',
      'A text/page/person/image node carries "text". A "number" node carries "number". A "place" node carries "place": { "name", "lat", "lon" } and may add "address" and "category". A "widget" node (a checkable sticky) carries "text" and "checked".',
      'Positions "x"/"y" are optional, leave them out and nodes auto-layout on a grid; set them to place nodes yourself (y grows downward).',
      'Each edge is { "from": nodeId, "to": nodeId } plus optional "label", "directed" (arrow at to), "biDir" (both ends), "style": "dashed", and "color". An edge to a node not in the file is dropped.',
      'page / person / row nodes keep their target id but do NOT reconnect from a standalone file or a different workspace.',
    ],
    nodes: [
      { id: 'trip', kind: 'text', text: 'Japan trip', x: 260, y: 20, color: 'rgb(224,90,134)' },
      { id: 'food', kind: 'text', text: 'Food to try', x: 40, y: 200 },
      { id: 'ramen', kind: 'text', text: 'Tonkotsu ramen in Fukuoka', x: 20, y: 340 },
      { id: 'stay', kind: 'text', text: 'Where to stay', x: 300, y: 200 },
      { id: 'ryokan', kind: 'place', text: '', place: { name: 'Yufuin ryokan', lat: 33.2646, lon: 131.36 }, x: 300, y: 340 },
      { id: 'budget', kind: 'number', number: 320000, x: 520, y: 200 },
      { id: 'todo', kind: 'widget', text: 'Book the shinkansen passes', checked: false, x: 520, y: 340 },
    ],
    edges: [
      { from: 'trip', to: 'food', directed: true },
      { from: 'trip', to: 'stay', directed: true },
      { from: 'trip', to: 'budget', directed: true, label: 'yen' },
      { from: 'food', to: 'ramen' },
      { from: 'stay', to: 'ryokan' },
      { from: 'stay', to: 'todo', style: 'dashed' },
    ],
  };
}
