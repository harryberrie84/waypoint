// Portable JSON for a page's automation flow (the trigger -> filter -> action
// canvas in `pages.flow`): its nodes and edges. Unlike the mindmap, a flow node's
// `payload` is already a clean structured object (a FlowTrigger / FlowFilter /
// FlowActionSpec / ...), so it round-trips verbatim; only ids and positions are
// rewritten on import. Edges reference nodes by id and carry a filter branch.
//
// Pure and testable (id minting is injected). References inside a payload
// (tableId / columnId / pageId) round-trip but only reconnect within the SAME
// workspace, like the kanban's cross-table relations, so a flow copied across
// workspaces keeps its shape but its table/page pointers need re-picking.

import type { FlowData, FlowEdge, FlowNode, FlowNodeKind, FlowPayload } from '../types';

const KINDS = new Set<FlowNodeKind>(['trigger', 'filter', 'action', 'code', 'widget', 'note']);

// A sane default payload per kind, used when a hand-authored node omits one.
function defaultPayload(kind: FlowNodeKind): FlowPayload {
  switch (kind) {
    case 'trigger':
      return { kind: 'manual' };
    case 'filter':
      return { expr: '' };
    case 'action':
      return { target: { kind: 'notify' }, actions: [], text: '' };
    case 'code':
      return { expr: '', outKey: 'out' };
    case 'widget':
      return { label: 'Run' };
    default:
      return ''; // note
  }
}

// --- Bundle shape -----------------------------------------------------------

export interface FlowBundleNode {
  id: string; // referenced by edges; minted on export
  kind: FlowNodeKind;
  payload?: FlowPayload; // structured, kind-specific; passed through verbatim
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  color?: string;
}

export interface FlowBundleEdge {
  from: string;
  to: string;
  label?: string;
  branch?: 'pass' | 'fail'; // for edges out of a filter
}

export interface FlowBundle {
  waypointFlow: 1;
  title: string;
  enabled?: boolean;
  nodes: FlowBundleNode[];
  edges: FlowBundleEdge[];
  instructions?: string[]; // guidance; ignored on import
}

export interface FlowImportDeps {
  uid: (prefix?: string) => string;
}

// --- Export: FlowData -> bundle ---------------------------------------------

/** Snapshot a live flow as a portable bundle. */
export function flowToBundle(data: FlowData, title: string): FlowBundle {
  const nodes: FlowBundleNode[] = (data.nodes ?? []).map((n) => ({
    id: n.id,
    kind: n.kind,
    payload: n.payload,
    x: Math.round(n.x),
    y: Math.round(n.y),
    ...(n.w ? { w: n.w } : {}),
    ...(n.h ? { h: n.h } : {}),
    ...(n.color ? { color: n.color } : {}),
  }));
  const edges: FlowBundleEdge[] = (data.edges ?? []).map((e) => ({
    from: e.from,
    to: e.to,
    ...(e.label ? { label: e.label } : {}),
    ...(e.branch ? { branch: e.branch } : {}),
  }));
  return { waypointFlow: 1, title: title || 'Automation', ...(data.enabled === false ? { enabled: false } : {}), nodes, edges };
}

// --- Parse + validate -------------------------------------------------------

/** Parse and validate a pasted/loaded bundle. Throws a readable error on bad input. */
export function parseFlowBundle(text: string): FlowBundle {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('That is not valid JSON.');
  }
  const obj = raw as Partial<FlowBundle>;
  if (!obj || typeof obj !== 'object' || !Array.isArray(obj.nodes)) {
    throw new Error('Not an automation file (expected a "nodes" array).');
  }
  const nodes: FlowBundleNode[] = obj.nodes
    .map((n) => n as Partial<FlowBundleNode>)
    .filter((n) => n && typeof n === 'object')
    .map((n, i) => ({
      id: typeof n.id === 'string' && n.id.trim() ? n.id : `n${i}`,
      kind: typeof n.kind === 'string' && KINDS.has(n.kind as FlowNodeKind) ? (n.kind as FlowNodeKind) : 'note',
      payload: n.payload as FlowPayload | undefined,
      x: typeof n.x === 'number' ? n.x : undefined,
      y: typeof n.y === 'number' ? n.y : undefined,
      w: typeof n.w === 'number' ? n.w : undefined,
      h: typeof n.h === 'number' ? n.h : undefined,
      color: typeof n.color === 'string' ? n.color : undefined,
    }));
  const edges: FlowBundleEdge[] = Array.isArray(obj.edges)
    ? obj.edges
        .map((e) => e as Partial<FlowBundleEdge>)
        .filter((e) => e && typeof e.from === 'string' && typeof e.to === 'string')
        .map((e) => ({
          from: e.from as string,
          to: e.to as string,
          label: typeof e.label === 'string' ? e.label : undefined,
          branch: e.branch === 'pass' || e.branch === 'fail' ? e.branch : undefined,
        }))
    : [];
  return { waypointFlow: 1, title: typeof obj.title === 'string' ? obj.title : 'Automation', enabled: obj.enabled === false ? false : undefined, nodes, edges };
}

// --- Import: bundle -> FlowData ---------------------------------------------

/** Turn a validated bundle into real FlowData with fresh ids (edges remapped
 *  onto them). Nodes with no x/y lay out on a simple grid. The payload is kept
 *  verbatim, or a per-kind default is filled in when a hand-authored node omits it. */
export function bundleToFlow(bundle: FlowBundle, deps: FlowImportDeps): FlowData {
  const idMap = new Map<string, string>();
  const nodes: FlowNode[] = bundle.nodes.map((bn, i) => {
    const id = deps.uid('fn_');
    idMap.set(bn.id, id);
    const node: FlowNode = {
      id,
      kind: bn.kind,
      x: typeof bn.x === 'number' ? bn.x : (i % 4) * 240,
      y: typeof bn.y === 'number' ? bn.y : Math.floor(i / 4) * 160,
      payload: bn.payload ?? defaultPayload(bn.kind),
    };
    if (bn.w) node.w = bn.w;
    if (bn.h) node.h = bn.h;
    if (bn.color) node.color = bn.color;
    return node;
  });

  const edges: FlowEdge[] = [];
  for (const be of bundle.edges) {
    const from = idMap.get(be.from);
    const to = idMap.get(be.to);
    if (!from || !to) continue; // an edge to a node not in the file is dropped
    const edge: FlowEdge = { id: deps.uid('fe_'), from, to };
    if (be.label) edge.label = be.label;
    if (be.branch) edge.branch = be.branch;
    edges.push(edge);
  }
  return { nodes, edges, ...(bundle.enabled === false ? { enabled: false } : {}) };
}

/** Pretty-print a bundle for download (stable 2-space JSON). */
export function serializeFlowBundle(bundle: FlowBundle): string {
  return JSON.stringify(bundle, null, 2);
}

// --- Downloadable template + annotated example ------------------------------

/** A tiny scaffold that imports cleanly: a manual trigger wired to a notify. */
export function blankFlowBundle(): FlowBundle {
  return {
    waypointFlow: 1,
    title: 'New automation',
    nodes: [
      { id: 'start', kind: 'trigger', payload: { kind: 'manual' }, x: 40, y: 40 },
      { id: 'do', kind: 'action', payload: { target: { kind: 'notify' }, actions: [], text: 'It ran.' }, x: 320, y: 40 },
    ],
    edges: [{ from: 'start', to: 'do' }],
  };
}

/** A worked example with guidance embedded (ignored on import). */
export function exampleFlowBundle(): FlowBundle {
  return {
    waypointFlow: 1,
    title: 'Big expense alert',
    instructions: [
      'This file imports as a page automation (the trigger -> filter -> action canvas). Keep this shape and replace the content. "waypointFlow", "nodes" and "edges" are required; "instructions" is ignored on import.',
      'Each node needs an "id" (unique in the file) that edges reference. "kind" is one of: trigger, filter, action, code, widget, note.',
      'A node\'s "payload" is a structured object specific to its kind (see below); leave it out for a per-kind default. Positions "x"/"y" are optional (missing ones auto-layout).',
      'trigger payload: { "kind": "manual" | "schedule" | "rowCreated" | "rowFieldEquals" | "rowFieldFilter" | "rowDeleted" | "pageCheckbox", plus that kind\'s fields, e.g. tableId/columnId/value or a schedule time }.',
      'filter payload: { "expr": "[amount] > 100" } (safe formula engine, must be truthy to pass). An edge out of a filter can set "branch": "pass" or "fail".',
      'action payload: { "target": { "kind": "notify" | "comment" | "thisRow" | "createRow" | "matchRow", ... }, "actions": [ ...cell writes... ], "text": "message with [refs]" }.',
      'code payload: { "expr": "...", "outKey": "name" } binds a computed value for downstream nodes. note payload is a plain string.',
      'tableId / columnId / pageId inside a payload only reconnect within the same workspace; re-pick them after importing into a different space.',
    ],
    nodes: [
      { id: 'created', kind: 'trigger', payload: { kind: 'rowCreated', tableId: 'REPLACE_WITH_TABLE_ID' }, x: 40, y: 60 },
      { id: 'big', kind: 'filter', payload: { expr: '[amount] > 20000' }, x: 320, y: 60 },
      { id: 'ping', kind: 'action', payload: { target: { kind: 'notify' }, actions: [], text: 'Heads up: a big expense was just added ([amount] yen).' }, x: 600, y: 20 },
      { id: 'why', kind: 'note', payload: 'Swap the tableId for your expenses table, then tweak the threshold.', x: 320, y: 220 },
    ],
    edges: [
      { from: 'created', to: 'big' },
      { from: 'big', to: 'ping', branch: 'pass' },
    ],
  };
}
