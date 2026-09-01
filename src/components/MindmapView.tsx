import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  X, MapPin, User, FileText, Hash, Type as TypeIcon, CheckSquare, Square, Table2,
  ChevronDown, ChevronRight, Maximize2, Trash2, Search, Spline, ExternalLink,
  ArrowRight, ArrowLeftRight, Minus, ZoomIn, ZoomOut, Maximize, Plus, Image as ImageIcon,
  Download, Upload, FileDown, ClipboardList, Network, Copy,
} from 'lucide-react';
import { useData } from '../store/useData';
import { processImageFile } from '../lib/image';
import { uploadsApi } from '../lib/api';
import { PagePresence } from './PagePresence';
import { useWorkspacePages, useWorkspaceTables } from '../hooks/useScoped';
import { useMembers } from '../hooks/useMembers';
import { searchPlaces, tabelogSearchUrl, googleMapsUrl, type PlaceResult } from '../lib/places';
import { uid, clamp } from '../lib/id';
import { initials, avatarColor } from '../lib/avatar';
import { docExcerpt } from '../lib/excerpt';
import { staticTiles, tileUrl } from '../lib/staticTile';
import { linkHref } from '../lib/cellLink';
import { PageIcon } from './PageIcon';
import { titleColumn, cellText } from '../lib/tableQuery';
import {
  toScreen, toCanvas, edgePath, nodeCenter, connect, dedupeEdges, collapsedHidden, fitView,
  deleteNodes, nodesInRect, toggleSelected, childPosition, duplicateNodes, treeLayout, matchNodes,
  checkProgress, NODE_W, NODE_H, type Pt, type Rect,
} from '../lib/mindmap';
import { isEnvelope } from '../lib/crypto';
import {
  mindmapToBundle, parseMindmapBundle, bundleToMindmap, blankMindmapBundle, exampleMindmapBundle, serializeMindmapBundle,
} from '../lib/mindmapIO';
import type {
  MindmapData, MindNode, MindEdge, MindNodeKind, MindViewport, MindWidgetValue, MindRowValue, GeoValue, PresenceRecord,
} from '../types';

// MindmapView, a free canvas peer to the editor and the map. Drop typed nodes
// (place / person / page / row / number / text / widget), drag them, connect
// them with labeled, styled edges, expand any node to edit its payload. The
// reference kinds render rich live previews and navigate on click (page → open
// the page, row → open the entry), mirroring PageLink/RowRef. Same canvas rules
// as the map: the container is `isolate`d so the SVG can't paint over modals,
// overlays sit at z-[1200], and the view fits bounds once via a fittedRef.
// Persistence rides the graceful `pages.mindmap` path (setPageMindmap).

const EMPTY: MindmapData = { nodes: [], edges: [] };
const CLICK_SLOP = 4; // px of pointer travel below which a node press is a click, not a drag

function downloadJson(name: string, text: string) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const PREVIEW_W = NODE_W - 16;
const PREVIEW_H = 80;

const KIND_META: Record<MindNodeKind, { icon: typeof MapPin; label: string }> = {
  place: { icon: MapPin, label: 'place' },
  person: { icon: User, label: 'person' },
  page: { icon: FileText, label: 'page' },
  row: { icon: Table2, label: 'row' },
  number: { icon: Hash, label: 'number' },
  text: { icon: TypeIcon, label: 'text' },
  widget: { icon: CheckSquare, label: 'checkbox' },
  image: { icon: ImageIcon, label: 'image' },
};

// Page and a row-with-id open something on click; everything else edits via the
// Maximize2 button / double-click.
function isNavigable(n: MindNode): boolean {
  if (n.kind === 'page') return true;
  if (n.kind === 'row') return !!(n.payload as MindRowValue)?.rowId;
  return false;
}

type Drag =
  | { kind: 'pan'; startX: number; startY: number; vpX: number; vpY: number; downScreen: Pt }
  | { kind: 'node'; id: string; offset: Pt; downScreen: Pt; group: { id: string; base: Pt }[] }
  | { kind: 'edge'; from: string }
  | { kind: 'marquee'; start: Pt; additive: boolean }
  | null;

export function MindmapView({ pageId, presence, onFocusNode }: { pageId: string; presence?: Map<string, PresenceRecord[]>; onFocusNode?: (id: string | null) => void }) {
  const data = useData((s) => s.pages[pageId]?.mindmap) ?? EMPTY;
  const setMindmap = useData((s) => s.setPageMindmap);
  const requestPageTab = useData((s) => s.requestPageTab);
  const openRow = useData((s) => s.openRow);
  const createPage = useData((s) => s.createPage);
  const renamePage = useData((s) => s.renamePage);
  const seedPageContent = useData((s) => s.seedPageContent);

  const containerRef = useRef<HTMLDivElement>(null);
  const fittedRef = useRef(false);
  const dragRef = useRef<Drag>(null);
  const vpCommit = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [vp, setVp] = useState<MindViewport>(() => data.viewport ?? { x: 0, y: 0, zoom: 1 });
  const [posDraft, setPosDraft] = useState<Record<string, Pt>>({});
  const [edgePreview, setEdgePreview] = useState<Pt | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [marquee, setMarquee] = useState<{ a: Pt; b: Pt } | null>(null); // screen-space rect while dragging
  // `from` set when the menu was opened by dropping an edge into empty space:
  // picking a kind then spawns the node already wired to the source.
  const [addAt, setAddAt] = useState<{ screen: Pt; canvas: Pt; from?: string } | null>(null);
  const [editingEdge, setEditingEdge] = useState<string | null>(null);
  const [ioOpen, setIoOpen] = useState(false); // the import/export menu
  const [importOpen, setImportOpen] = useState(false);
  const [find, setFind] = useState<string | null>(null); // null = the find box is closed
  const [findAt, setFindAt] = useState(0); // which match Enter last walked to

  const allPages = useData((s) => s.pages);
  const allTables = useData((s) => s.tables);
  const allRows = useData((s) => s.rows);
  const members = useMembers();

  // Import / export the whole mindmap as portable JSON (lib/mindmapIO). Import
  // replaces the canvas and re-fits (fittedRef reset), like a fresh open.
  const exportMindmap = () => {
    downloadJson('mindmap.json', serializeMindmapBundle(mindmapToBundle(data, 'Mindmap')));
    setIoOpen(false);
  };
  const applyMindmapImport = (text: string): boolean => {
    let bundle;
    try {
      bundle = parseMindmapBundle(text);
    } catch {
      return false;
    }
    fittedRef.current = false;
    setMindmap(pageId, bundleToMindmap(bundle, { uid }));
    return true;
  };

  const nodes = data.nodes;
  const edges = data.edges;

  // Fit to content once, when we first have nodes and a measured container.
  useEffect(() => {
    if (fittedRef.current) return;
    const el = containerRef.current;
    if (!el || !nodes.length) return;
    if (data.viewport) {
      fittedRef.current = true;
      return;
    }
    setVp(fitView(nodes, { width: el.clientWidth, height: el.clientHeight }));
    fittedRef.current = true;
  }, [nodes, data.viewport]);

  const commit = useCallback((next: Partial<MindmapData>) => {
    setMindmap(pageId, { nodes, edges, viewport: vp, ...next });
  }, [setMindmap, pageId, nodes, edges, vp]);

  // Persist viewport a beat after panning/zooming settles (don't thrash writes).
  const queueViewport = useCallback((next: MindViewport) => {
    if (vpCommit.current) clearTimeout(vpCommit.current);
    vpCommit.current = setTimeout(() => setMindmap(pageId, { nodes, edges, viewport: next }), 500);
  }, [setMindmap, pageId, nodes, edges]);

  const posOf = (n: MindNode): Pt => posDraft[n.id] ?? { x: n.x, y: n.y };

  const hidden = useMemo(() => {
    const collapsed = new Set(nodes.filter((n) => n.collapsed).map((n) => n.id));
    return collapsedHidden(nodes, edges, collapsed);
  }, [nodes, edges]);

  const visibleNodes = nodes.filter((n) => !hidden.has(n.id));
  const visibleEdges = dedupeEdges(edges).filter((e) => !hidden.has(e.from) && !hidden.has(e.to));

  // --- pointer handling -----------------------------------------------------

  const screenPt = (e: { clientX: number; clientY: number }): Pt => {
    const r = containerRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onBackgroundDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    setAddAt(null);
    setEditingEdge(null);
    const s = screenPt(e);
    if (e.shiftKey) {
      // Shift+background drag = marquee select. Plain drag stays pan (the
      // expected canvas gesture), so we don't add a mode toggle.
      dragRef.current = { kind: 'marquee', start: s, additive: e.metaKey || e.ctrlKey };
      setMarquee({ a: s, b: s });
    } else {
      dragRef.current = { kind: 'pan', startX: e.clientX, startY: e.clientY, vpX: vp.x, vpY: vp.y, downScreen: s };
    }
    containerRef.current?.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    if (d.kind === 'pan') {
      setVp((v) => ({ ...v, x: d.vpX + (e.clientX - d.startX), y: d.vpY + (e.clientY - d.startY) }));
    } else if (d.kind === 'node') {
      const c = toCanvas(screenPt(e), vp);
      const nx = c.x - d.offset.x;
      const ny = c.y - d.offset.y;
      if (d.group.length) {
        // Group move: shift every selected node by the same delta from its base.
        const self = d.group.find((g) => g.id === d.id);
        const dx = nx - (self?.base.x ?? nx);
        const dy = ny - (self?.base.y ?? ny);
        setPosDraft((p) => {
          const next = { ...p };
          for (const g of d.group) next[g.id] = { x: g.base.x + dx, y: g.base.y + dy };
          return next;
        });
      } else {
        setPosDraft((p) => ({ ...p, [d.id]: { x: nx, y: ny } }));
      }
    } else if (d.kind === 'edge') {
      setEdgePreview(toCanvas(screenPt(e), vp));
    } else if (d.kind === 'marquee') {
      setMarquee({ a: d.start, b: screenPt(e) });
    }
  };

  // Hit-test against the card's MEASURED size, not the size it was stored with.
  // Cards lay out with minHeight, so any node with more than a line of content is
  // taller than its stored h, and testing against that h meant only the top strip
  // (the kind/title row) counted: dropping an edge anywhere on the body of a card
  // did nothing. Falls back to the stored/default box until the first measurement.
  const sizesRef = useRef<Map<string, { w: number; h: number }>>(new Map());
  const measureNode = useCallback((id: string, w: number, h: number) => {
    sizesRef.current.set(id, { w, h });
  }, []);

  const nodeAtCanvas = (c: Pt): MindNode | undefined =>
    // Reverse order so the topmost card wins when two overlap, matching what you see.
    [...visibleNodes].reverse().find((n) => {
      const p = posOf(n);
      const m = sizesRef.current.get(n.id);
      const w = m?.w ?? n.w ?? NODE_W;
      const h = m?.h ?? n.h ?? NODE_H;
      return c.x >= p.x && c.x <= p.x + w && c.y >= p.y && c.y <= p.y + h;
    });

  const activate = (n: MindNode) => {
    // Opening a page node dives into that sub-page's OWN mindmap, so nested
    // maps chain like "true" mind maps (its Mindmap tab, not its notes).
    if (n.kind === 'page') requestPageTab(n.payload as string, 'mindmap');
    else if (n.kind === 'row') {
      const v = n.payload as MindRowValue;
      if (v?.rowId) openRow(v.rowId);
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    if (d.kind === 'pan') {
      const up = screenPt(e);
      const travel = Math.hypot(up.x - d.downScreen.x, up.y - d.downScreen.y);
      // A press on empty background that didn't pan clears the selection.
      if (travel <= CLICK_SLOP) setSelected(new Set());
      else queueViewport(vp);
    } else if (d.kind === 'node') {
      const up = screenPt(e);
      const travel = Math.hypot(up.x - d.downScreen.x, up.y - d.downScreen.y);
      if (travel > CLICK_SLOP) {
        // Drag end: commit moved positions (the whole group, if any) in one change.
        const ids = d.group.length ? new Set(d.group.map((g) => g.id)) : new Set([d.id]);
        commit({ nodes: nodes.map((n) => { const p = posDraft[n.id]; return ids.has(n.id) && p ? { ...n, x: p.x, y: p.y } : n; }) });
        setPosDraft((p) => { const rest = { ...p }; for (const id of ids) delete rest[id]; return rest; });
      } else {
        // Click: select only this node (shift/⌘ toggles). Never navigates, open
        // is the explicit button / Enter, so a plain press can't open a page.
        setPosDraft((p) => { const { [d.id]: _drop, ...rest } = p; return rest; });
        const additive = e.shiftKey || e.metaKey || e.ctrlKey;
        setSelected((s) => toggleSelected(s, d.id, additive));
      }
    } else if (d.kind === 'edge') {
      const drop = toCanvas(screenPt(e), vp);
      const target = nodeAtCanvas(drop);
      setEdgePreview(null);
      if (target && target.id !== d.from) {
        commit({ edges: connect(edges, d.from, target.id, { directed: true }) });
      } else if (!target) {
        // Obsidian's move: drop into empty space → spawn a node wired to the source.
        const s = screenPt(e);
        setAddAt({ screen: s, canvas: drop, from: d.from });
      }
    } else if (d.kind === 'marquee') {
      const screen = normRect(d.start, screenPt(e));
      setMarquee(null);
      const a = toCanvas({ x: screen.x, y: screen.y }, vp);
      const b = toCanvas({ x: screen.x + screen.w, y: screen.y + screen.h }, vp);
      const hits = nodesInRect(visibleNodes, { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y });
      setSelected((s) => (d.additive ? new Set([...s, ...hits]) : new Set(hits)));
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const s = screenPt(e);
    const before = toCanvas(s, vp);
    const zoom = clamp(vp.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1), 0.2, 2.5);
    // Keep the canvas point under the cursor fixed across the zoom.
    const next = { x: s.x - before.x * zoom, y: s.y - before.y * zoom, zoom };
    setVp(next);
    queueViewport(next);
  };

  // --- node ops -------------------------------------------------------------

  const startNodeDrag = (e: React.PointerEvent, n: MindNode) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    // Pressing an unselected node (no modifier) selects just it, so a drag moves
    // the thing under the cursor. A press inside a multi-selection keeps it.
    if (!selected.has(n.id) && !additive) setSelected(new Set([n.id]));
    const c = toCanvas(screenPt(e), vp);
    const p = posOf(n);
    // Group move only when dragging a node that's part of a real multi-selection.
    const group =
      selected.has(n.id) && selected.size > 1
        ? [...selected].map((id) => { const sp = posOf(nodes.find((x) => x.id === id) ?? n); return { id, base: { x: sp.x, y: sp.y } }; })
        : [];
    dragRef.current = { kind: 'node', id: n.id, offset: { x: c.x - p.x, y: c.y - p.y }, downScreen: screenPt(e), group };
    containerRef.current?.setPointerCapture(e.pointerId);
  };

  const startEdgeDrag = (e: React.PointerEvent, n: MindNode) => {
    e.stopPropagation();
    dragRef.current = { kind: 'edge', from: n.id };
    setEdgePreview(nodeCenter(n));
    containerRef.current?.setPointerCapture(e.pointerId);
  };

  // `size` comes from the content when the content has one (an image measures
  // itself), so the card is made to fit the picture rather than the picture being
  // crammed into a text-sized card and spilling over the connect handle.
  const addNode = (kind: MindNodeKind, canvas: Pt, payload: MindNode['payload'], size?: { w: number; h: number }) => {
    const w = size?.w ?? NODE_W;
    const h = size?.h ?? NODE_H;
    const node: MindNode = { id: uid('mn_'), x: canvas.x - w / 2, y: canvas.y - h / 2, kind, payload, ...(size ? { w, h } : {}) };
    const from = addAt?.from;
    const nextEdges = from ? connect(edges, from, node.id, { directed: true }) : edges;
    commit({ nodes: [...nodes, node], edges: nextEdges });
    setAddAt(null);
    if (kind === 'text' || kind === 'number') setEditing(node.id);
  };

  const updateNode = (id: string, patch: Partial<MindNode>) =>
    commit({ nodes: nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) });

  const deleteNode = (id: string) => commit(deleteNodes(nodes, edges, new Set([id])));

  // Delete the whole selection (nodes + every incident edge) in one commit.
  const deleteSelected = () => {
    if (!selected.size) return;
    commit(deleteNodes(nodes, edges, selected));
    setSelected(new Set());
  };

  const colorSelected = (color: string) => {
    if (!selected.size) return;
    commit({ nodes: nodes.map((n) => (selected.has(n.id) ? { ...n, color } : n)) });
  };

  const toggleCollapse = (id: string) =>
    commit({ nodes: nodes.map((n) => (n.id === id ? { ...n, collapsed: !n.collapsed } : n)) });

  // Tick a checkbox node straight from its card.
  const toggleCheck = (id: string) => {
    const n = nodes.find((x) => x.id === id);
    if (!n || n.kind !== 'widget') return;
    const w = (n.payload ?? { text: '', checked: false }) as MindWidgetValue;
    updateNode(id, { payload: { ...w, checked: !w.checked } });
  };

  // Add a child of `parent`, already wired to it, and select it so you can keep
  // going. The classic mindmap gesture: the map grows without a trip to a menu.
  const addChild = (parent: MindNode) => {
    const kidIds = new Set(edges.filter((e) => e.from === parent.id).map((e) => e.to));
    const siblings = nodes.filter((n) => kidIds.has(n.id));
    const at = childPosition(parent, siblings);
    const child: MindNode = { id: uid('mn_'), x: at.x, y: at.y, kind: 'text', payload: '' };
    commit({ nodes: [...nodes, child], edges: connect(edges, parent.id, child.id, { directed: true }) });
    setSelected(new Set([child.id]));
    setEditing(child.id);
  };

  const duplicateSelection = () => {
    if (!selected.size) return;
    const out = duplicateNodes(nodes, edges, selected, uid);
    commit({ nodes: out.nodes, edges: out.edges });
    setSelected(new Set(out.newIds));
  };

  // Lay the whole graph out as a left-to-right tree, then frame the result, in
  // ONE write. Only x/y change: no node, edge or payload is touched, so tidying
  // can never lose anything. (Reframing via fittedRef would not work here, that
  // effect short-circuits as soon as a viewport is stored, which it always is by
  // the time you press this.)
  const tidy = () => {
    if (!nodes.length) return;
    // Lay out against the size each card is ACTUALLY rendered at. Cards use
    // minHeight, so a node with an image or a few lines of text is taller than
    // its stored h, and tidying against that h is what left them overlapping.
    const laid = treeLayout(nodes, edges, { x: 80, y: 80 }, (n) => {
      const m = sizesRef.current.get(n.id);
      return { w: m?.w ?? n.w ?? NODE_W, h: m?.h ?? n.h ?? NODE_H };
    });
    const el = containerRef.current;
    const next = el ? fitView(laid, { width: el.clientWidth, height: el.clientHeight }) : vp;
    setVp(next);
    setMindmap(pageId, { nodes: laid, edges, viewport: next });
  };

  // The searchable text of a node. Reference kinds read their label from the
  // store, which is why matchNodes takes this as a parameter rather than
  // reaching for the store itself.
  const nodeLabel = (n: MindNode): string => {
    switch (n.kind) {
      case 'page': return allPages[n.payload as string]?.title || 'Untitled';
      case 'person': return members.find((m) => m.id === n.payload)?.name ?? '';
      case 'place': return (n.payload as GeoValue)?.name ?? '';
      case 'widget': return (n.payload as MindWidgetValue)?.text ?? '';
      case 'number': return String(n.payload ?? '');
      case 'row': {
        const v = n.payload as MindRowValue;
        const table = allTables[v?.tableId ?? ''];
        if (!table) return '';
        if (!v?.rowId) return table.name || 'Table';
        const row = allRows[v.rowId];
        const title = titleColumn(table.columns);
        return (row && title ? cellText(row.cells[title.id] ?? null, title, members) : '') || 'Untitled';
      }
      default: return typeof n.payload === 'string' ? n.payload : '';
    }
  };

  // Whether the open button should appear. isNavigable answers "is this a kind
  // that opens something"; this also asks whether the thing it points at still
  // exists, so a card already showing "page removed" stops offering to open it.
  const canOpen = (n: MindNode): boolean => {
    if (!isNavigable(n)) return false;
    if (n.kind === 'page') {
      const p = allPages[n.payload as string];
      return !!p && !p.trashed;
    }
    return !!allRows[(n.payload as MindRowValue).rowId ?? ''];
  };

  // Derived in render, not memoised: visibleNodes is a fresh array every render,
  // so a dep array would either be a lie or never hit. Both are a single pass
  // over a canvas that holds tens of nodes.
  const matches = find ? matchNodes(visibleNodes, find, nodeLabel) : [];
  const matchSet = new Set(matches);
  const progress = checkProgress(nodes);

  // Centre the viewport on a node without changing the zoom.
  const centerOn = (id: string) => {
    const el = containerRef.current;
    const n = nodes.find((x) => x.id === id);
    if (!el || !n) return;
    const c = nodeCenter(n);
    const next = { x: el.clientWidth / 2 - c.x * vp.zoom, y: el.clientHeight / 2 - c.y * vp.zoom, zoom: vp.zoom };
    setVp(next);
    queueViewport(next);
  };

  // Enter in the find box walks the matches, wrapping at the end.
  const stepFind = () => {
    if (!matches.length) return;
    const next = findAt % matches.length;
    centerOn(matches[next]);
    setSelected(new Set([matches[next]]));
    setFindAt(next + 1);
  };

  const openEditor = (id: string) => { setEditing(id); };

  const updateEdge = (id: string, patch: Partial<MindEdge>) =>
    commit({ edges: edges.map((e) => (e.id === id ? { ...e, ...patch } : e)) });
  const deleteEdge = (id: string) => { commit({ edges: edges.filter((e) => e.id !== id) }); setEditingEdge(null); };

  // Promote a loose text card into a real page, seeded with its text, then swap
  // the node to a live page node (Obsidian's text-card → note lifecycle).
  const convertToPage = async (node: MindNode) => {
    const text = typeof node.payload === 'string' ? node.payload : '';
    const id = await createPage(pageId, false);
    if (!id) return;
    const lines = text.split('\n');
    const title = (lines[0] || 'Untitled').slice(0, 80).trim() || 'Untitled';
    renamePage(id, title);
    const bodyLines = lines.slice(1).filter((l) => l.trim());
    if (bodyLines.length) {
      const ok = await seedPageContent(id, {
        type: 'doc',
        content: bodyLines.map((line) => ({ type: 'paragraph', content: [{ type: 'text', text: line }] })),
      });
      // Locked vault in an encrypted workspace: the body was NOT written. Leave the
      // card as text (the store already said why) instead of swapping it for a page
      // node, which would drop the only copy of these lines. The titled page stays.
      if (!ok) return;
    }
    updateNode(node.id, { kind: 'page', payload: id });
    setEditing(null);
  };

  const editingNode = nodes.find((n) => n.id === editing) ?? null;

  // Broadcast which node I'm on (editing, or a lone selection) so collaborators
  // see my avatar on it. Cleared when I'm on nothing in particular.
  const focusNodeId = editing ?? (selected.size === 1 ? [...selected][0] : null);
  useEffect(() => {
    onFocusNode?.(focusNodeId);
    return () => onFocusNode?.(null);
  }, [focusNodeId, onFocusNode]);
  const editingEdgeObj = editingEdge ? edges.find((e) => e.id === editingEdge) ?? null : null;

  // --- zoom controls --------------------------------------------------------

  const zoomBy = (factor: number) => {
    const el = containerRef.current;
    if (!el) return;
    const c = { x: el.clientWidth / 2, y: el.clientHeight / 2 };
    const before = toCanvas(c, vp);
    const zoom = clamp(vp.zoom * factor, 0.2, 2.5);
    const next = { x: c.x - before.x * zoom, y: c.y - before.y * zoom, zoom };
    setVp(next);
    queueViewport(next);
  };
  const doFit = () => {
    const el = containerRef.current;
    if (!el || !nodes.length) return;
    const next = fitView(nodes, { width: el.clientWidth, height: el.clientHeight });
    setVp(next);
    queueViewport(next);
  };
  const doReset = () => { const next = { x: 0, y: 0, zoom: 1 }; setVp(next); queueViewport(next); };

  // Keyboard: delete the selection, Enter to open the one selected navigable
  // node, Escape to clear. Inert while a field/modal owns the keyboard, never
  // eats a Backspace the user meant for an input or the AddMenu search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (typing || editing || editingEdge) return; // a modal/field has the keyboard
      if (e.key === 'Escape') {
        if (addAt) { setAddAt(null); return; }
        if (selected.size) setSelected(new Set());
        return;
      }
      if (addAt) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected.size) {
        e.preventDefault();
        deleteSelected();
      } else if (e.key === 'Tab' && selected.size === 1) {
        // Tab grows the map from the selected card. Prevented hard, or the
        // browser moves focus to the next control and the gesture does nothing.
        e.preventDefault();
        const parent = nodes.find((n) => n.id === [...selected][0]);
        if (parent) addChild(parent);
      } else if ((e.key === 'd' || e.key === 'D') && (e.metaKey || e.ctrlKey) && selected.size) {
        e.preventDefault();
        duplicateSelection();
      } else if ((e.key === 'a' || e.key === 'A') && (e.metaKey || e.ctrlKey) && visibleNodes.length) {
        e.preventDefault();
        setSelected(new Set(visibleNodes.map((n) => n.id)));
      } else if (e.key === 'Enter' && selected.size === 1) {
        const only = nodes.find((n) => n.id === [...selected][0]);
        if (only && canOpen(only)) activate(only);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selected, editing, editingEdge, addAt, nodes, visibleNodes, deleteSelected, activate, addChild, duplicateSelection]);

  return (
    <div className="relative h-full w-full">
      <div
        ref={containerRef}
        className="isolate h-full w-full cursor-grab touch-none overflow-hidden bg-paper-panel/30 active:cursor-grabbing dark:bg-coal/40"
        onPointerDown={onBackgroundDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
        onContextMenu={(e) => {
          e.preventDefault();
          const s = screenPt(e);
          setAddAt({ screen: s, canvas: toCanvas(s, vp) });
        }}
        onDoubleClick={(e) => {
          if (e.target === containerRef.current || (e.target as HTMLElement).dataset.canvas) {
            const s = screenPt(e);
            setAddAt({ screen: s, canvas: toCanvas(s, vp) });
          }
        }}
      >
        <div data-canvas className="absolute left-0 top-0 h-full w-full" style={{ transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`, transformOrigin: '0 0' }}>
          {/* edges sit beneath the node cards */}
          <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width="1" height="1">
            {visibleEdges.map((e) => {
              const from = nodes.find((n) => n.id === e.from);
              const to = nodes.find((n) => n.id === e.to);
              if (!from || !to) return null;
              const a = withPos(from, posOf(from));
              const b = withPos(to, posOf(to));
              const mid = { x: (nodeCenter(a).x + nodeCenter(b).x) / 2, y: (nodeCenter(a).y + nodeCenter(b).y) / 2 };
              const stroke = e.color ?? 'rgb(var(--ink-faint))';
              const arrow = e.directed || e.biDir;
              return (
                <g key={e.id}>
                  <path
                    d={edgePath(nodeCenter(a), nodeCenter(b))}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={1.5}
                    strokeDasharray={e.style === 'dashed' ? '4 4' : undefined}
                    markerEnd={arrow ? 'url(#mm-arrow)' : undefined}
                    markerStart={e.biDir ? 'url(#mm-arrow)' : undefined}
                  />
                  {/* Fat transparent hit-area so the whole edge is clickable, not
                      just the label. stopPropagation for the same reason every
                      NodeCard button does it: without it the press bubbles to
                      onBackgroundDown, which captures the pointer on the
                      container, and the click is retargeted away from this path. */}
                  <path d={edgePath(nodeCenter(a), nodeCenter(b))} fill="none" stroke="transparent" strokeWidth={16} className="cursor-pointer" style={{ pointerEvents: 'stroke' }} onPointerDown={(ev) => ev.stopPropagation()} onClick={() => setEditingEdge(e.id)} />
                  {e.label && (
                    <text x={mid.x} y={mid.y} textAnchor="middle" dominantBaseline="middle" className="cursor-pointer fill-ink-soft text-[11px] dark:fill-coal-soft" style={{ pointerEvents: 'auto' }} onPointerDown={(ev) => ev.stopPropagation()} onClick={() => setEditingEdge(e.id)}>
                      {e.label}
                    </text>
                  )}
                </g>
              );
            })}
            {edgePreview && dragRef.current?.kind === 'edge' && (() => {
              const from = nodes.find((n) => n.id === (dragRef.current as { from: string }).from);
              return from ? <path d={edgePath(nodeCenter(withPos(from, posOf(from))), edgePreview)} fill="none" stroke="rgb(var(--clay))" strokeWidth={1.5} strokeDasharray="4 4" /> : null;
            })()}
            <defs>
              <marker id="mm-arrow" markerWidth="9" markerHeight="9" refX="7.5" refY="4" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
                <path d="M0,0 L8,4 L0,8 Z" fill="context-stroke" />
              </marker>
            </defs>
          </svg>

          {visibleNodes.map((n) => (
            <NodeCard
              key={n.id}
              node={withPos(n, posOf(n))}
              hasChildren={edges.some((e) => e.from === n.id)}
              selected={selected.has(n.id)}
              found={matchSet.has(n.id)}
              navigable={canOpen(n)}
              people={presence?.get(n.id)}
              onPointerDown={(e) => startNodeDrag(e, n)}
              onEdgeStart={(e) => startEdgeDrag(e, n)}
              onOpen={() => activate(n)}
              onExpand={() => openEditor(n.id)}
              onCollapse={() => toggleCollapse(n.id)}
              onMeasure={measureNode}
              onToggleCheck={n.kind === 'widget' ? () => toggleCheck(n.id) : undefined}
            />
          ))}
        </div>

        {/* marquee rect (screen space, above the canvas) */}
        {marquee && (() => {
          const r = normRect(marquee.a, marquee.b);
          return <div className="pointer-events-none absolute rounded-sm border border-clay/60 bg-clay/10" style={{ left: r.x, top: r.y, width: r.w, height: r.h }} />;
        })()}

        {/* Selection toolbar. It lives INSIDE the canvas container, so without
            this stopPropagation a press on any button here bubbles to
            onBackgroundDown, which starts a pan and calls setPointerCapture on
            the container. Capture retargets the pointerup, so the click never
            reaches the button and the pan branch instead runs its
            "pressed empty background" clear: pressing delete silently
            DESELECTED rather than deleting. Every button on a NodeCard already
            guards this way. */}
        {selected.size > 0 && (
          <div
            onPointerDown={(e) => e.stopPropagation()}
            className="absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-1.5 rounded-lg border border-paper-line bg-paper px-2 py-1.5 shadow-md dark:border-coal-line dark:bg-coal-panel"
          >
            <span className="px-1 text-xs text-ink-faint dark:text-coal-soft">{selected.size} selected</span>
            <div className="flex items-center gap-1">
              {NODE_COLORS.map((c) => (
                <button key={c} type="button" onClick={() => colorSelected(c)} title="set colour" className="h-4 w-4 rounded-full border border-paper-line dark:border-coal-line" style={{ background: c }} />
              ))}
            </div>
            <button type="button" onClick={duplicateSelection} title="duplicate selection (ctrl+D)" className="rounded p-1 text-ink-faint hover:bg-paper-panel hover:text-ink dark:hover:bg-coal-line dark:hover:text-coal-text">
              <Copy className="h-3.5 w-3.5" />
            </button>
            <button type="button" onClick={deleteSelected} title="delete selection" className="rounded p-1 text-ink-faint hover:bg-paper-panel hover:text-red-500 dark:hover:bg-coal-line">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {!nodes.length && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <p className="rounded-lg bg-paper px-3 py-2 text-sm text-ink-faint shadow-sm dark:bg-coal-panel dark:text-coal-soft">double-click or right-click to drop a node</p>
          </div>
        )}

        {/* hint chip, and the checkbox roll-up when the map is being used as a list */}
        <div className="absolute bottom-3 left-3 flex items-center gap-2">
          <div className="pointer-events-none flex items-center gap-1.5 rounded-lg bg-paper/90 px-2.5 py-1.5 text-xs text-ink-soft shadow-sm dark:bg-coal-panel/90 dark:text-coal-soft">
            <Spline className="h-3.5 w-3.5 text-clay" /> drag a node's dot to branch, or select one and press Tab
          </div>
          {progress.total > 0 && (
            <div className="pointer-events-none flex items-center gap-1.5 rounded-lg bg-paper/90 px-2.5 py-1.5 text-xs text-ink-soft shadow-sm dark:bg-coal-panel/90 dark:text-coal-soft" title="checkbox nodes ticked">
              <CheckSquare className={`h-3.5 w-3.5 ${progress.done === progress.total ? 'text-clay' : 'text-ink-faint'}`} />
              {progress.done} of {progress.total} done
            </div>
          )}
        </div>
      </div>

      {/* find a node: highlights every match, Enter walks them */}
      <div className="absolute left-3 top-3 flex items-center gap-1.5">
        {find === null ? (
          <button
            type="button"
            onClick={() => { setFind(''); setFindAt(0); }}
            title="find a node"
            className="flex items-center gap-1.5 rounded-lg border border-paper-line bg-paper px-2.5 py-1 text-xs font-medium text-ink-soft shadow-sm hover:bg-paper-panel dark:border-coal-line dark:bg-coal-panel dark:text-coal-soft dark:hover:bg-coal-line"
          >
            <Search className="h-3.5 w-3.5" /> Find
          </button>
        ) : (
          <div className="flex items-center gap-1.5 rounded-lg border border-paper-line bg-paper px-2 py-1 shadow-sm dark:border-coal-line dark:bg-coal-panel">
            <Search className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
            <input
              autoFocus
              value={find}
              onChange={(e) => { setFind(e.target.value); setFindAt(0); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); stepFind(); }
                if (e.key === 'Escape') { e.preventDefault(); setFind(null); }
              }}
              placeholder="find a node"
              className="w-40 bg-transparent text-xs text-ink outline-none placeholder:text-ink-faint/70 dark:text-coal-text"
            />
            <span className="shrink-0 text-[10px] tabular-nums text-ink-faint dark:text-coal-soft">
              {find.trim() ? `${matches.length}` : ''}
            </span>
            <button type="button" onClick={() => setFind(null)} title="close find" className="rounded p-0.5 text-ink-faint hover:bg-paper-panel dark:hover:bg-coal-line">
              <X className="h-3 w-3" />
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={tidy}
          disabled={!nodes.length}
          title="tidy: lay the map out as a tree"
          className="flex items-center gap-1.5 rounded-lg border border-paper-line bg-paper px-2.5 py-1 text-xs font-medium text-ink-soft shadow-sm hover:bg-paper-panel disabled:opacity-50 dark:border-coal-line dark:bg-coal-panel dark:text-coal-soft dark:hover:bg-coal-line"
        >
          <Network className="h-3.5 w-3.5" /> Tidy
        </button>
      </div>

      {/* import / export menu */}
      <div className="absolute right-3 top-3">
        <button
          type="button"
          onClick={() => setIoOpen((o) => !o)}
          title="Import / export mindmap"
          className="flex items-center gap-1.5 rounded-lg border border-paper-line bg-paper px-2.5 py-1 text-xs font-medium text-ink-soft shadow-sm hover:bg-paper-panel dark:border-coal-line dark:bg-coal-panel dark:text-coal-soft dark:hover:bg-coal-line"
        >
          <Download className="h-3.5 w-3.5" /> Import / export
        </button>
        {ioOpen && (
          <>
            <div className="fixed inset-0 z-[1190]" onMouseDown={() => setIoOpen(false)} />
            <div className="absolute right-0 top-full z-[1200] mt-1 w-56 rounded-lg border border-paper-line bg-paper p-1 shadow-xl dark:border-coal-line dark:bg-coal-panel">
              <button type="button" onClick={exportMindmap} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink hover:bg-paper-panel dark:text-coal-text dark:hover:bg-coal-line">
                <Download className="h-4 w-4 text-ink-faint" /> Export this mindmap (JSON)
              </button>
              <button type="button" onClick={() => { downloadJson('mindmap-template.json', serializeMindmapBundle(blankMindmapBundle())); setIoOpen(false); }} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink hover:bg-paper-panel dark:text-coal-text dark:hover:bg-coal-line">
                <FileDown className="h-4 w-4 text-ink-faint" /> Download blank template
              </button>
              <button type="button" onClick={() => { downloadJson('mindmap-example.json', serializeMindmapBundle(exampleMindmapBundle())); setIoOpen(false); }} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink hover:bg-paper-panel dark:text-coal-text dark:hover:bg-coal-line">
                <ClipboardList className="h-4 w-4 text-ink-faint" /> Download example (annotated)
              </button>
              <button type="button" onClick={() => { setImportOpen(true); setIoOpen(false); }} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink hover:bg-paper-panel dark:text-coal-text dark:hover:bg-coal-line">
                <Upload className="h-4 w-4 text-ink-faint" /> Import from JSON…
              </button>
            </div>
          </>
        )}
      </div>

      {importOpen && (
        <MindmapImportModal onClose={() => setImportOpen(false)} onImport={applyMindmapImport} />
      )}

      {/* zoom cluster */}
      <div className="absolute bottom-3 right-3 flex flex-col overflow-hidden rounded-lg border border-paper-line bg-paper shadow-sm dark:border-coal-line dark:bg-coal-panel">
        {([['in', ZoomIn, () => zoomBy(1.2)], ['out', ZoomOut, () => zoomBy(1 / 1.2)], ['fit', Maximize, doFit]] as const).map(([key, Icon, fn]) => (
          <button key={key} type="button" onClick={fn} title={key === 'fit' ? 'fit to content' : `zoom ${key}`} className="p-1.5 text-ink-faint hover:bg-paper-panel hover:text-ink dark:hover:bg-coal-line dark:hover:text-coal-text">
            <Icon className="h-4 w-4" />
          </button>
        ))}
        <button type="button" onClick={doReset} title="reset view" className="border-t border-paper-line px-1.5 py-1 text-[10px] font-medium text-ink-faint hover:bg-paper-panel hover:text-ink dark:border-coal-line dark:hover:bg-coal-line dark:hover:text-coal-text">
          {Math.round(vp.zoom * 100)}%
        </button>
      </div>

      {addAt && <AddMenu at={addAt} currentPageId={pageId} onClose={() => setAddAt(null)} onAdd={addNode} />}

      {editingEdgeObj && (
        <EdgePanel
          edge={editingEdgeObj}
          screen={(() => {
            const from = nodes.find((n) => n.id === editingEdgeObj.from);
            const to = nodes.find((n) => n.id === editingEdgeObj.to);
            if (!from || !to) return { x: 0, y: 0 };
            const mid = { x: (nodeCenter(from).x + nodeCenter(to).x) / 2, y: (nodeCenter(from).y + nodeCenter(to).y) / 2 };
            return toScreen(mid, vp);
          })()}
          onClose={() => setEditingEdge(null)}
          onChange={(patch) => updateEdge(editingEdgeObj.id, patch)}
          onDelete={() => deleteEdge(editingEdgeObj.id)}
        />
      )}

      {editingNode && (
        <NodeEditor
          node={editingNode}
          currentPageId={pageId}
          onClose={() => setEditing(null)}
          onChange={(patch) => updateNode(editingNode.id, patch)}
          onDelete={() => { deleteNode(editingNode.id); setEditing(null); }}
          onConvertToPage={() => void convertToPage(editingNode)}
        />
      )}
    </div>
  );
}

function withPos(n: MindNode, p: Pt): MindNode {
  return { ...n, x: p.x, y: p.y };
}

// Two screen points → a normalised rect (positive w/h) for the marquee.
function normRect(a: Pt, b: Pt): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

// --- Node card --------------------------------------------------------------

function NodeCard({ node, hasChildren, selected, found, navigable, people, onPointerDown, onEdgeStart, onOpen, onExpand, onCollapse, onMeasure, onToggleCheck }: {
  node: MindNode;
  hasChildren: boolean;
  selected: boolean;
  found: boolean;
  navigable: boolean;
  people?: PresenceRecord[];
  onPointerDown: (e: React.PointerEvent) => void;
  onEdgeStart: (e: React.PointerEvent) => void;
  onOpen: () => void;
  onExpand: () => void;
  onCollapse: () => void;
  onMeasure: (id: string, w: number, h: number) => void;
  onToggleCheck?: () => void;
}) {
  const { icon: Icon } = KIND_META[node.kind];
  // Report the card's REAL size. It is laid out with minHeight, so a node with more
  // than one line of content, an excerpt, or a picture is taller than the h it was
  // stored with, and anything hit-testing against that stored h only covers the top
  // of the card. offsetWidth/Height, not getBoundingClientRect: the canvas is
  // transform-scaled, and these stay in unscaled canvas units.
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const report = () => onMeasure(node.id, el.offsetWidth, el.offsetHeight);
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id]);
  // The colour was doing something, it was just invisible: a 3px strip on the left
  // edge, which on an image node the picture covered entirely. Same value, now also
  // tinting the header row and its icon, so picking a colour visibly does something.
  const nodeColor = node.color ?? 'rgb(var(--clay))';
  return (
    <div
      className={[
        'group absolute select-none rounded-lg border bg-paper shadow-sm dark:bg-coal-panel',
        selected
          ? 'border-clay ring-2 ring-clay ring-offset-1 ring-offset-paper dark:ring-offset-coal-panel'
          : found
            ? 'border-ochre ring-2 ring-ochre ring-offset-1 ring-offset-paper dark:ring-offset-coal-panel'
            : 'border-paper-line dark:border-coal-line',
      ].join(' ')}
      ref={cardRef}
      style={{ left: node.x, top: node.y, width: node.w ?? NODE_W, minHeight: node.h ?? NODE_H, borderLeft: `4px solid ${nodeColor}` }}
      onPointerDown={onPointerDown}
      onDoubleClick={(e) => { e.stopPropagation(); onExpand(); }}
    >
      {people && people.length > 0 && (
        <div className="absolute -right-1.5 -top-2 z-10" onPointerDown={(e) => e.stopPropagation()}>
          <PagePresence people={people} />
        </div>
      )}
      <div
        className="flex items-center gap-1.5 rounded-tr-lg px-2 py-1 text-[11px] text-ink-faint dark:text-coal-soft"
        style={{ background: `color-mix(in srgb, ${nodeColor} 14%, transparent)` }}
      >
        <Icon className="h-3 w-3 shrink-0" style={{ color: nodeColor }} />
        <span className="flex-1 truncate">{KIND_META[node.kind].label}</span>
        {navigable && (
          <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={onOpen} className={['rounded p-0.5 hover:bg-paper-panel hover:text-clay dark:hover:bg-coal-line', selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'].join(' ')} title="open">
            <ExternalLink className="h-3 w-3" />
          </button>
        )}
        {hasChildren && (
          <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={onCollapse} className="rounded p-0.5 hover:bg-paper-panel dark:hover:bg-coal-line" title={node.collapsed ? 'expand subtree' : 'collapse subtree'}>
            {node.collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
        )}
        <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={onExpand} className="rounded p-0.5 opacity-0 hover:bg-paper-panel group-hover:opacity-100 dark:hover:bg-coal-line" title="edit">
          <Maximize2 className="h-3 w-3" />
        </button>
      </div>
      <div className="px-2 pb-2 pt-0.5">
        <NodeBody node={node} onToggleCheck={onToggleCheck} />
      </div>
      {/* connect handle */}
      <button
        type="button"
        onPointerDown={onEdgeStart}
        className="absolute -right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border-2 border-paper bg-clay opacity-0 transition-opacity group-hover:opacity-100 dark:border-coal-panel"
        title="drag to connect"
      />
    </div>
  );
}

// Size an image node from the picture itself, so a portrait photo gets a tall card
// and a wide one a wide card, instead of every image being squeezed into the same
// 168px text-card width and overflowing it. Capped so a big photo cannot take over
// the canvas. Falls back to the default card if the image will not load.
const IMG_MAX_W = 260;
const IMG_MAX_H = 320;
const IMG_CHROME_H = 26; // the kind/label row above the picture

export function imageNodeSize(url: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const nw = img.naturalWidth || IMG_MAX_W;
      const nh = img.naturalHeight || IMG_MAX_H;
      const scale = Math.min(IMG_MAX_W / nw, IMG_MAX_H / nh, 1);
      const w = Math.max(120, Math.round(nw * scale));
      resolve({ w, h: Math.round(nh * scale) + IMG_CHROME_H });
    };
    img.onerror = () => resolve({ w: NODE_W, h: NODE_H });
    img.src = url;
  });
}

// Rich live short views. Reference kinds (page/person/row) resolve from the
// store so renames/edits propagate; the rest render their own payload.
function NodeBody({ node, onToggleCheck }: { node: MindNode; onToggleCheck?: () => void }) {
  const page = useData((s) => (node.kind === 'page' ? s.pages[node.payload as string] : null));
  const subPages = useData((s) =>
    node.kind === 'page' ? Object.values(s.pages).filter((p) => p.parent === (node.payload as string) && !p.trashed).length : 0,
  );
  const rowVal = node.kind === 'row' ? (node.payload as MindRowValue) : null;
  const table = useData((s) => (rowVal ? s.tables[rowVal.tableId] : null));
  const row = useData((s) => (rowVal?.rowId ? s.rows[rowVal.rowId] : null));
  const rowCount = useData((s) => (rowVal && !rowVal.rowId ? Object.values(s.rows).filter((r) => r.table === rowVal.tableId).length : 0));
  const members = useMembers();

  if (node.kind === 'page') {
    if (!page || page.trashed) return <Tomb label="page removed" />;
    // The store holds an encrypted page's body as an `enc:v1:` envelope, so this
    // is a STRING there and docExcerpt walks it to nothing. That is the safe
    // direction but it reads as an empty page, so say which it is.
    const locked = isEnvelope(page.content);
    const excerpt = locked ? '' : docExcerpt(page.content);
    return (
      <div className="space-y-1">
        <span className="flex items-center gap-1 text-sm font-medium text-ink underline-offset-2 group-hover:underline dark:text-coal-text">
          <span className="flex items-center"><PageIcon icon={page.icon} size="h-4 w-4" /></span>
          <span className="min-w-0 flex-1 truncate">{page.title || 'Untitled'}</span>
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-faint opacity-0 group-hover:opacity-100" />
        </span>
        {locked
          ? <p className="text-[11px] italic leading-snug text-ink-faint dark:text-coal-soft">locked, unlock to preview</p>
          : excerpt && <p className="line-clamp-2 text-[11px] leading-snug text-ink-faint dark:text-coal-soft">{excerpt}</p>}
        {subPages > 0 && <p className="text-[10px] text-ink-faint dark:text-coal-soft">{subPages} sub-page{subPages > 1 ? 's' : ''}</p>}
      </div>
    );
  }

  if (node.kind === 'person') {
    const m = members.find((x) => x.id === node.payload);
    if (!m) return <Tomb label="former member" />;
    return (
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white" style={{ background: avatarColor(m.id) }}>{initials(m.name)}</span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-ink dark:text-coal-text">{m.name}</span>
          {m.email && <span className="block truncate text-[10px] text-ink-faint dark:text-coal-soft">{m.email}</span>}
        </span>
      </div>
    );
  }

  if (node.kind === 'place') {
    const g = node.payload as GeoValue;
    if (!g?.name) return <span className="text-sm text-ink-faint">place</span>;
    return <PlaceBody geo={g} />;
  }

  if (node.kind === 'row') {
    if (!table) return <Tomb label="table removed" />;
    if (!rowVal?.rowId) {
      // whole-table summary card
      return (
        <span className="flex items-center gap-1.5 text-sm text-ink dark:text-coal-text">
          <Table2 className="h-3.5 w-3.5 shrink-0 text-clay" />
          <span className="min-w-0 flex-1 truncate font-medium">{table.name || 'Table'}</span>
          <span className="shrink-0 text-[10px] text-ink-faint dark:text-coal-soft">{rowCount} row{rowCount === 1 ? '' : 's'}</span>
        </span>
      );
    }
    if (!row) return <Tomb label="row removed" />;
    const title = titleColumn(table.columns);
    const titleText = (title ? cellText(row.cells[title.id] ?? null, title, members) : '') || 'Untitled';
    const chips = table.columns
      .filter((c) => c.id !== title?.id)
      .map((c) => cellText(row.cells[c.id] ?? null, c, members))
      .filter((t) => t)
      .slice(0, 3);
    return (
      <div className="space-y-1">
        <span className="flex items-center gap-1 text-sm font-medium text-ink underline-offset-2 group-hover:underline dark:text-coal-text">
          <Table2 className="h-3.5 w-3.5 shrink-0 text-clay" />
          <span className="min-w-0 flex-1 truncate">{titleText}</span>
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-faint opacity-0 group-hover:opacity-100" />
        </span>
        {chips.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {chips.map((t, i) => (
              <span key={i} className="max-w-[8rem] truncate rounded bg-paper-panel px-1.5 py-0.5 text-[10px] text-ink-soft dark:bg-coal-line dark:text-coal-soft">{t}</span>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (node.kind === 'image') {
    const src = (node.payload as string) || '';
    if (!src) return <Tomb label="no image" />;
    // w-full, NOT a max-width in its own units. The card is a fixed width, so an
    // image allowed to be wider than it (this was max-w-[18rem] against a 168px
    // card) simply spilled out of the right edge and sat on top of the connect
    // handle, which is why you could not drag an edge off an image node.
    // object-contain so nothing crops; draggable=false so the node drags on the
    // canvas instead of starting a browser image drag.
    return <img src={src} alt="" draggable={false} className="h-auto w-full select-none rounded-md object-contain" />;
  }

  if (node.kind === 'number') {
    return <span className="font-display text-xl font-bold text-ink dark:text-coal-text">{String(node.payload ?? 0)}</span>;
  }

  if (node.kind === 'widget') {
    const w = node.payload as MindWidgetValue;
    // The box is the control. It used to be a plain icon, so the one node kind
    // whose whole point is being tickable could only be ticked by opening the
    // editor modal, which reads as the checkbox being broken. stopPropagation on
    // pointerdown keeps the press off the drag handler, so a tick is a tick and
    // dragging the card still works from anywhere else on it.
    return (
      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onToggleCheck?.(); }}
        aria-pressed={!!w?.checked}
        title={w?.checked ? 'mark as not done' : 'mark as done'}
        className="flex w-full items-start gap-1.5 rounded text-left text-sm text-ink hover:bg-paper-panel/60 dark:text-coal-text dark:hover:bg-coal-line/60"
      >
        {w?.checked
          ? <CheckSquare className="mt-0.5 h-4 w-4 shrink-0 text-clay" />
          : <Square className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" />}
        <span className={`min-w-0 break-words ${w?.checked ? 'line-through opacity-60' : ''}`}>{w?.text || 'to-do'}</span>
      </button>
    );
  }

  // text, soft line breaks + auto-linked bare URLs
  const text = (node.payload as string) || '';
  if (!text) return <span className="text-sm text-ink-faint">empty</span>;
  return <span className="whitespace-pre-wrap break-words text-sm text-ink dark:text-coal-text"><Linkified text={text} /></span>;
}

function Linkified({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s]+|www\.[^\s]+)/gi);
  return (
    <>
      {parts.map((p, i) =>
        /^(https?:\/\/|www\.)/i.test(p) ? (
          <a key={i} href={linkHref(p)} target="_blank" rel="noopener noreferrer" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()} className="text-clay underline">{p}</a>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

// Static OSM tile preview (no Leaflet mount) + name, address and outbound links.
function PlaceBody({ geo }: { geo: GeoValue }) {
  const preview = useMemo(() => {
    if (typeof geo.lat !== 'number' || typeof geo.lon !== 'number') return null;
    return staticTiles(geo.lat, geo.lon, 13, PREVIEW_W, PREVIEW_H);
  }, [geo.lat, geo.lon]);
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <div className="space-y-1.5">
      <span className="flex items-center gap-1 text-sm font-medium text-ink dark:text-coal-text">
        <MapPin className="h-3.5 w-3.5 shrink-0 text-clay" />
        <span className="min-w-0 truncate">{geo.name}</span>
      </span>
      {preview && (
        <div className="relative overflow-hidden rounded-md border border-paper-line dark:border-coal-line" style={{ width: PREVIEW_W, height: PREVIEW_H }}>
          {preview.tiles.map((t) => (
            <img key={`${t.x}-${t.y}`} src={tileUrl(t)} alt="" loading="lazy" draggable={false} className="pointer-events-none absolute select-none" style={{ left: t.left, top: t.top, width: preview.tileSize, height: preview.tileSize }} />
          ))}
          <span className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white bg-clay shadow" style={{ left: preview.marker.left, top: preview.marker.top }} />
        </div>
      )}
      {geo.address && <p className="line-clamp-1 text-[10px] text-ink-faint dark:text-coal-soft">{geo.address}</p>}
      <div className="flex items-center gap-2 text-[10px]">
        <a href={googleMapsUrl(geo.name, geo.lat, geo.lon)} target="_blank" rel="noopener noreferrer" onPointerDown={stop} onClick={stop} className="inline-flex items-center gap-0.5 text-clay hover:underline">
          Maps <ExternalLink className="h-2.5 w-2.5" />
        </a>
        <a href={tabelogSearchUrl(geo.name)} target="_blank" rel="noopener noreferrer" onPointerDown={stop} onClick={stop} className="inline-flex items-center gap-0.5 text-ink-faint hover:underline dark:text-coal-soft">
          Tabelog <ExternalLink className="h-2.5 w-2.5" />
        </a>
      </div>
    </div>
  );
}

function Tomb({ label }: { label: string }) {
  return <span className="text-sm italic text-ink-faint dark:text-coal-soft">{label}</span>;
}

// --- Add menu ---------------------------------------------------------------

function AddMenu({ at, currentPageId, onClose, onAdd }: {
  at: { screen: Pt; canvas: Pt; from?: string };
  currentPageId: string;
  onClose: () => void;
  onAdd: (kind: MindNodeKind, canvas: Pt, payload: MindNode['payload'], size?: { w: number; h: number }) => void;
}) {
  const [sub, setSub] = useState<MindNodeKind | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const kinds: MindNodeKind[] = ['text', 'image', 'number', 'place', 'person', 'page', 'row', 'widget'];

  const pickImage = async (file: File) => {
    try {
      const url = (await uploadsApi.upload(file)) ?? (await processImageFile(file));
      if (url) onAdd('image', at.canvas, url, await imageNodeSize(url));
    } catch {
      /* not a usable image */
    }
    onClose();
  };

  return (
    <>
      <div className="fixed inset-0 z-[60]" onMouseDown={onClose} />
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void pickImage(f);
        }}
      />
      <div className="absolute z-[70] w-56 rounded-lg border border-paper-line bg-paper p-1 shadow-xl dark:border-coal-line dark:bg-coal-panel" style={{ left: at.screen.x, top: at.screen.y }}>
        {sub === 'place' ? (
          <PlacePicker onPick={(g) => onAdd('place', at.canvas, g)} />
        ) : sub === 'person' ? (
          <PersonPicker onPick={(id) => onAdd('person', at.canvas, id)} />
        ) : sub === 'page' ? (
          <PagePickerPlus currentPageId={currentPageId} onPick={(id) => onAdd('page', at.canvas, id)} />
        ) : sub === 'row' ? (
          <RowPicker onPick={(v) => onAdd('row', at.canvas, v)} />
        ) : (
          kinds.map((k) => {
            const { icon: Icon, label } = KIND_META[k];
            return (
              <button
                key={k}
                type="button"
                onClick={() => {
                  if (k === 'place' || k === 'person' || k === 'page' || k === 'row') setSub(k);
                  else if (k === 'image') fileRef.current?.click();
                  else if (k === 'widget') onAdd('widget', at.canvas, { text: '', checked: false });
                  else if (k === 'number') onAdd('number', at.canvas, 0);
                  else onAdd('text', at.canvas, '');
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink hover:bg-paper-panel dark:text-coal-text dark:hover:bg-coal-line"
              >
                <Icon className="h-4 w-4 text-ink-faint dark:text-coal-soft" />
                <span className="capitalize">{label}</span>
              </button>
            );
          })
        )}
      </div>
    </>
  );
}

function PlacePicker({ onPick }: { onPick: (g: GeoValue) => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return; }
    let live = true;
    setBusy(true);
    const t = setTimeout(() => {
      void searchPlaces(q).then((r) => { if (live) { setResults(r); setBusy(false); } });
    }, 350);
    return () => { live = false; clearTimeout(t); };
  }, [q]);
  return (
    <div className="p-1">
      <div className="mb-1 flex items-center gap-1.5 rounded-md border border-paper-line px-2 py-1 dark:border-coal-line">
        <Search className="h-3.5 w-3.5 text-ink-faint" />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="search a place" className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint/70 dark:text-coal-text" />
      </div>
      <div className="max-h-48 overflow-y-auto">
        {busy && <p className="px-2 py-1.5 text-xs text-ink-faint">searching…</p>}
        {results.map((r) => (
          <button key={r.id} type="button" onClick={() => onPick({ name: r.name, lat: r.lat, lon: r.lon, category: r.category, address: r.address })} className="flex w-full items-start gap-1.5 rounded-md px-2 py-1.5 text-left text-sm text-ink hover:bg-paper-panel dark:text-coal-text dark:hover:bg-coal-line">
            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-clay" />
            <span className="min-w-0"><span className="block truncate">{r.name}</span>{r.address && <span className="block truncate text-[11px] text-ink-faint dark:text-coal-soft">{r.address}</span>}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function PersonPicker({ onPick }: { onPick: (id: string) => void }) {
  const members = useMembers();
  return (
    <div className="max-h-56 overflow-y-auto p-1">
      {!members.length && <p className="px-2 py-1.5 text-xs text-ink-faint">no members, invite from the Members panel</p>}
      {members.map((m) => (
        <button key={m.id} type="button" onClick={() => onPick(m.id)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink hover:bg-paper-panel dark:text-coal-text dark:hover:bg-coal-line">
          <span className="flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold text-white" style={{ background: avatarColor(m.id) }}>{initials(m.name)}</span>
          <span className="truncate">{m.name}</span>
        </button>
      ))}
    </div>
  );
}

// Create-or-link picker: a "+ new page" action above the filtered existing list.
// New pages nest under the mindmap's own page so the tree mirrors the canvas.
function PagePickerPlus({ currentPageId, onPick }: { currentPageId: string; onPick: (id: string) => void }) {
  const pages = useWorkspacePages();
  const createPage = useData((s) => s.createPage);
  const renamePage = useData((s) => s.renamePage);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const query = q.trim();
  const list = Object.values(pages)
    .filter((p) => !p.trashed && p.id !== currentPageId && (p.title || 'Untitled').toLowerCase().includes(query.toLowerCase()))
    .slice(0, 50);

  const create = async () => {
    if (busy) return;
    setBusy(true);
    const id = await createPage(currentPageId, false);
    if (id) {
      if (query) renamePage(id, query);
      onPick(id);
    }
    setBusy(false);
  };

  return (
    <div className="p-1">
      <div className="mb-1 flex items-center gap-1.5 rounded-md border border-paper-line px-2 py-1 dark:border-coal-line">
        <Search className="h-3.5 w-3.5 text-ink-faint" />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} placeholder="link or create a page" className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint/70 dark:text-coal-text" />
      </div>
      <button type="button" onClick={create} disabled={busy} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-clay hover:bg-paper-panel disabled:opacity-60 dark:hover:bg-coal-line">
        <Plus className="h-4 w-4 shrink-0" />
        <span className="truncate">New page{query ? `: "${query}"` : ''}</span>
      </button>
      <div className="mt-0.5 max-h-48 overflow-y-auto">
        {list.map((p) => (
          <button key={p.id} type="button" onClick={() => onPick(p.id)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink hover:bg-paper-panel dark:text-coal-text dark:hover:bg-coal-line">
            <span className="flex items-center"><PageIcon icon={p.icon} size="h-4 w-4" /></span>
            <span className="truncate">{p.title || 'Untitled'}</span>
          </button>
        ))}
        {!list.length && query && <p className="px-2 py-1 text-[11px] text-ink-faint">no match, create it above</p>}
      </div>
    </div>
  );
}

// Pick a table, then a row (link existing or append a blank), or the whole table.
function RowPicker({ onPick }: { onPick: (v: MindRowValue) => void }) {
  const tables = useData((s) => s.tables);
  const rowsMap = useData((s) => s.rows);
  const addRow = useData((s) => s.addRow);
  const members = useMembers();
  const [tableId, setTableId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // form-backed tables are an implementation detail, not for linking.
  const tableList = useWorkspaceTables().filter((t) => !t.formKey);

  if (!tableId) {
    return (
      <div className="max-h-56 overflow-y-auto p-1">
        {!tableList.length && <p className="px-2 py-1.5 text-xs text-ink-faint">no tables yet</p>}
        {tableList.map((t) => (
          <button key={t.id} type="button" onClick={() => setTableId(t.id)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink hover:bg-paper-panel dark:text-coal-text dark:hover:bg-coal-line">
            <Table2 className="h-4 w-4 shrink-0 text-ink-faint dark:text-coal-soft" />
            <span className="truncate">{t.name || 'Table'}</span>
          </button>
        ))}
      </div>
    );
  }

  const table = tables[tableId];
  if (!table) { setTableId(null); return null; }
  const title = titleColumn(table.columns);
  const rows = Object.values(rowsMap).filter((r) => r.table === tableId).sort((a, b) => a.position - b.position);
  const label = (r: (typeof rows)[number]) => (title ? cellText(r.cells[title.id] ?? null, title, members) : '') || 'Untitled';

  const addBlank = async () => {
    if (busy) return;
    setBusy(true);
    const id = await addRow(tableId);
    if (id) onPick({ tableId, rowId: id });
    setBusy(false);
  };

  return (
    <div className="p-1">
      <div className="mb-1 flex items-center gap-1.5 px-1 text-[11px] text-ink-faint dark:text-coal-soft">
        <button type="button" onClick={() => setTableId(null)} className="rounded p-0.5 hover:bg-paper-panel dark:hover:bg-coal-line"><ChevronRight className="h-3 w-3 rotate-180" /></button>
        <span className="truncate">{table.name || 'Table'}</span>
      </div>
      <button type="button" onClick={() => onPick({ tableId })} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink hover:bg-paper-panel dark:text-coal-text dark:hover:bg-coal-line">
        <Table2 className="h-4 w-4 shrink-0 text-clay" /> whole table
      </button>
      <button type="button" onClick={addBlank} disabled={busy} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-clay hover:bg-paper-panel disabled:opacity-60 dark:hover:bg-coal-line">
        <Plus className="h-4 w-4 shrink-0" /> new blank row
      </button>
      <div className="mt-0.5 max-h-44 overflow-y-auto">
        {rows.map((r) => (
          <button key={r.id} type="button" onClick={() => onPick({ tableId, rowId: r.id })} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink hover:bg-paper-panel dark:text-coal-text dark:hover:bg-coal-line">
            <span className="truncate">{label(r)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// --- Edge styling panel -----------------------------------------------------
// Screen-positioned (not a foreignObject) so it isn't subject to the canvas
// scale. Label, direction, line style, colour, delete, Obsidian's edge grammar.

const EDGE_COLORS = ['rgb(var(--ink-faint))', 'rgb(var(--clay))', 'rgb(110 190 130)', 'rgb(110 170 240)', 'rgb(170 140 240)'];

function EdgePanel({ edge, screen, onClose, onChange, onDelete }: {
  edge: MindEdge;
  screen: Pt;
  onClose: () => void;
  onChange: (patch: Partial<MindEdge>) => void;
  onDelete: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Direction cycle: none → forward → both.
  const dir: 'none' | 'forward' | 'both' = edge.biDir ? 'both' : edge.directed ? 'forward' : 'none';
  const cycleDir = () => {
    if (dir === 'none') onChange({ directed: true, biDir: false });
    else if (dir === 'forward') onChange({ directed: true, biDir: true });
    else onChange({ directed: false, biDir: false });
  };
  const DirIcon = dir === 'both' ? ArrowLeftRight : dir === 'forward' ? ArrowRight : Minus;

  return (
    <>
      <div className="fixed inset-0 z-[60]" onMouseDown={onClose} />
      <div className="absolute z-[70] w-52 -translate-x-1/2 -translate-y-full rounded-lg border border-paper-line bg-paper p-2 shadow-xl dark:border-coal-line dark:bg-coal-panel" style={{ left: screen.x, top: screen.y - 8 }}>
        <input
          autoFocus
          value={edge.label ?? ''}
          onChange={(e) => onChange({ label: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Enter') onClose(); }}
          placeholder="label this edge"
          className="mb-2 w-full rounded-md border border-paper-line bg-paper px-2 py-1 text-sm text-ink outline-none focus:border-clay placeholder:text-ink-faint/60 dark:border-coal-line dark:bg-coal dark:text-coal-text"
        />
        <div className="mb-2 flex items-center gap-1">
          <button type="button" onClick={cycleDir} title={`direction: ${dir}`} className="flex items-center gap-1 rounded-md border border-paper-line px-2 py-1 text-xs text-ink-soft hover:bg-paper-panel dark:border-coal-line dark:text-coal-soft dark:hover:bg-coal-line">
            <DirIcon className="h-3.5 w-3.5" /> {dir}
          </button>
          <button type="button" onClick={() => onChange({ style: edge.style === 'dashed' ? 'solid' : 'dashed' })} title="line style" className={`rounded-md border px-2 py-1 text-xs hover:bg-paper-panel dark:hover:bg-coal-line ${edge.style === 'dashed' ? 'border-clay text-clay' : 'border-paper-line text-ink-soft dark:border-coal-line dark:text-coal-soft'}`}>
            {edge.style === 'dashed' ? 'dashed' : 'solid'}
          </button>
          <button type="button" onClick={onDelete} title="delete edge" className="ml-auto rounded-md p-1 text-ink-faint hover:bg-paper-panel hover:text-red-500 dark:hover:bg-coal-line">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex items-center gap-1.5">
          {EDGE_COLORS.map((c) => (
            <button key={c} type="button" onClick={() => onChange({ color: c })} className={['h-5 w-5 rounded-full border', (edge.color ?? EDGE_COLORS[0]) === c ? 'ring-2 ring-clay ring-offset-1 dark:ring-offset-coal-panel' : 'border-paper-line dark:border-coal-line'].join(' ')} style={{ background: c }} />
          ))}
        </div>
      </div>
    </>
  );
}

// --- Node editor overlay ----------------------------------------------------

const NODE_COLORS = ['rgb(var(--clay))', 'rgb(var(--ochre))', 'rgb(110 190 130)', 'rgb(110 170 240)', 'rgb(170 140 240)', 'rgb(var(--ink-faint))'];

function NodeEditor({ node, currentPageId, onClose, onChange, onDelete, onConvertToPage }: {
  node: MindNode;
  currentPageId: string;
  onClose: () => void;
  onChange: (patch: Partial<MindNode>) => void;
  onDelete: () => void;
  onConvertToPage: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const { icon: Icon, label } = KIND_META[node.kind];
  return (
    <div className="fixed inset-0 z-[1200] flex items-start justify-center overflow-y-auto bg-coal/40 p-4 backdrop-blur-sm sm:p-8">
      <div className="absolute inset-0" onMouseDown={onClose} />
      <div className="relative z-10 my-8 w-full max-w-md rounded-2xl border border-paper-line bg-paper shadow-2xl dark:border-coal-line dark:bg-coal-panel">
        <div className="flex items-center justify-between border-b border-paper-line px-4 py-2 dark:border-coal-line">
          <span className="flex items-center gap-1.5 text-xs font-medium text-ink-faint dark:text-coal-soft"><Icon className="h-3.5 w-3.5" /> {label} node</span>
          <div className="flex items-center gap-1">
            <button type="button" onClick={onDelete} className="rounded-md p-1.5 text-ink-faint hover:bg-paper-panel hover:text-red-500 dark:hover:bg-coal-line" title="delete node"><Trash2 className="h-4 w-4" /></button>
            <button type="button" onClick={onClose} className="rounded-md p-1.5 text-ink-faint hover:bg-paper-panel hover:text-ink dark:hover:bg-coal-line dark:hover:text-coal-text"><X className="h-4 w-4" /></button>
          </div>
        </div>
        <div className="space-y-4 p-4">
          <PayloadEditor node={node} currentPageId={currentPageId} onChange={onChange} />
          {node.kind === 'text' && typeof node.payload === 'string' && node.payload.trim() && (
            <button type="button" onClick={onConvertToPage} className="flex items-center gap-1.5 text-xs text-clay hover:underline">
              <FileText className="h-3.5 w-3.5" /> convert to page
            </button>
          )}
          <div>
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-faint dark:text-coal-soft">colour</p>
            <div className="flex items-center gap-1.5">
              {NODE_COLORS.map((c) => (
                <button key={c} type="button" onClick={() => onChange({ color: c })} className={['h-6 w-6 rounded-full border', node.color === c ? 'ring-2 ring-offset-1 ring-clay dark:ring-offset-coal-panel' : 'border-paper-line dark:border-coal-line'].join(' ')} style={{ background: c }} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PayloadEditor({ node, currentPageId, onChange }: { node: MindNode; currentPageId: string; onChange: (patch: Partial<MindNode>) => void }) {
  if (node.kind === 'text') {
    return <textarea autoFocus value={node.payload as string} onChange={(e) => onChange({ payload: e.target.value })} rows={4} placeholder="write…" className="w-full resize-none rounded-lg border border-paper-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-clay dark:border-coal-line dark:bg-coal dark:text-coal-text" />;
  }
  if (node.kind === 'number') {
    return <input autoFocus type="number" value={Number(node.payload ?? 0)} onChange={(e) => onChange({ payload: Number(e.target.value) })} className="w-full rounded-lg border border-paper-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-clay dark:border-coal-line dark:bg-coal dark:text-coal-text" />;
  }
  if (node.kind === 'widget') {
    const w = node.payload as MindWidgetValue;
    return (
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm text-ink dark:text-coal-text">
          <input type="checkbox" checked={!!w?.checked} onChange={(e) => onChange({ payload: { ...w, checked: e.target.checked } })} />
          done
        </label>
        <input autoFocus value={w?.text ?? ''} onChange={(e) => onChange({ payload: { ...w, text: e.target.value } })} placeholder="to-do text" className="w-full rounded-lg border border-paper-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-clay dark:border-coal-line dark:bg-coal dark:text-coal-text" />
      </div>
    );
  }
  if (node.kind === 'place') {
    const g = node.payload as GeoValue;
    return (
      <div className="space-y-2">
        {g?.name && <p className="text-sm text-ink dark:text-coal-text"><MapPin className="mr-1 inline h-3.5 w-3.5 text-clay" />{g.name}</p>}
        <div className="rounded-lg border border-paper-line dark:border-coal-line"><PlacePicker onPick={(geo) => onChange({ payload: geo })} /></div>
      </div>
    );
  }
  if (node.kind === 'person') {
    return <div className="rounded-lg border border-paper-line dark:border-coal-line"><PersonPicker onPick={(id) => onChange({ payload: id })} /></div>;
  }
  if (node.kind === 'page') {
    return <div className="rounded-lg border border-paper-line dark:border-coal-line"><PagePickerPlus currentPageId={currentPageId} onPick={(id) => onChange({ payload: id })} /></div>;
  }
  if (node.kind === 'row') {
    return <div className="rounded-lg border border-paper-line dark:border-coal-line"><RowPicker onPick={(v) => onChange({ payload: v })} /></div>;
  }
  if (node.kind === 'image') {
    return (
      <div className="space-y-2">
        {node.payload ? <img src={node.payload as string} alt="" className="max-h-40 w-full rounded-md object-contain" /> : null}
        <label className="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed border-paper-line py-2 text-sm text-ink-soft hover:border-clay hover:text-clay dark:border-coal-line dark:text-coal-soft">
          <ImageIcon className="h-4 w-4" /> Replace image
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                const url = (await uploadsApi.upload(f)) ?? (await processImageFile(f));
                // Re-measure: a replacement with a different aspect would otherwise
                // keep the old card's shape and letterbox or overflow inside it.
                if (url) onChange({ payload: url, ...(await imageNodeSize(url)) });
              } catch {
                /* not a usable image */
              }
            }}
          />
        </label>
      </div>
    );
  }
  return null;
}

// Paste or upload a mindmap JSON. The parse + rebuild lives in lib/mindmapIO
// (tested); this is the paste box, a file picker, and an honest error. Importing
// replaces the whole canvas.
function MindmapImportModal({ onClose, onImport }: { onClose: () => void; onImport: (text: string) => boolean }) {
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const run = () => {
    if (!text.trim()) {
      setErr('Paste a mindmap JSON file, or pick one.');
      return;
    }
    if (!onImport(text)) {
      setErr('That is not a valid mindmap file. Download the template or example to see the shape.');
      return;
    }
    onClose();
  };
  return (
    <div className="fixed inset-0 z-[1300] flex items-center justify-center bg-black/30 p-4" onMouseDown={onClose}>
      <div className="w-full max-w-lg rounded-xl border border-paper-line bg-paper p-4 shadow-2xl dark:border-coal-line dark:bg-coal-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink dark:text-coal-text">Import mindmap</h3>
          <button type="button" onClick={onClose} className="rounded p-1 text-ink-faint hover:bg-paper-panel dark:hover:bg-coal-line">
            <X className="h-4 w-4" />
          </button>
        </div>
        <textarea
          value={text}
          onChange={(e) => { setText(e.target.value); setErr(''); }}
          rows={9}
          placeholder={'Paste a mindmap JSON (nodes + edges), or use "Choose file".\nDownload the template or example first to see the shape.'}
          className="w-full resize-none rounded-lg border border-paper-line bg-paper px-2 py-1.5 font-mono text-xs text-ink outline-none dark:border-coal-line dark:bg-coal dark:text-coal-text"
        />
        {err && <p className="mt-1 text-xs text-red-500">{err}</p>}
        <div className="mt-3 flex items-center gap-2">
          <button type="button" onClick={run} className="rounded-lg bg-clay px-3 py-1.5 text-sm font-medium text-white hover:bg-clay-soft">
            Import
          </button>
          <button type="button" onClick={() => fileRef.current?.click()} className="rounded-lg border border-paper-line px-3 py-1.5 text-sm text-ink-soft hover:bg-paper-panel dark:border-coal-line dark:text-coal-soft dark:hover:bg-coal-line">
            Choose file…
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) { setText(await f.text()); setErr(''); }
              e.target.value = '';
            }}
          />
          <span className="ml-auto text-[10px] text-ink-faint dark:text-coal-soft">replaces this mindmap</span>
        </div>
      </div>
    </div>
  );
}
