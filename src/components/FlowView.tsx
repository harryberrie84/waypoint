import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  Zap, Filter, Play, Code2, Square, StickyNote, FlaskConical,
  Trash2, ZoomIn, ZoomOut, Maximize, Spline, Power,
  Download, Upload, FileDown, ClipboardList, X,
} from 'lucide-react';
import { useData, flowLogFor, selectWorkspacePages, selectWorkspaceTables, type FlowRunLog } from '../store/useData';
import { useWorkspace } from '../store/useWorkspace';
import { useVault } from '../store/useVault';
import { toast } from '../store/useToast';
import { uid, clamp } from '../lib/id';
import {
  toScreen, toCanvas, edgePath, nodeCenter, connect, dedupeEdges, fitView,
  deleteNodes, toggleSelected, NODE_H, type Pt,
} from '../lib/mindmap';
import { type Effect, compileFlow, taskItems } from '../lib/flow';
import {
  flowToBundle, parseFlowBundle, bundleToFlow, blankFlowBundle, exampleFlowBundle, serializeFlowBundle,
} from '../lib/flowIO';
import { ActionEditor } from './ActionEditor';
import type {
  FlowData, FlowNode, FlowEdge, FlowNodeKind, FlowTrigger, FlowFilter,
  FlowActionSpec, FlowCodeSpec, FlowWidgetSpec, FlowTriggerKind, FlowActionTarget,
  MindViewport, Column, Page, TableData,
} from '../types';

// A flow belongs to a page, and a page to a workspace. Scope every table/page
// picker in this canvas to THAT workspace (not the global active one, they can
// differ), so an automation never reaches across workspaces.
const FlowWsCtx = createContext<string | null>(null);

function useFlowWsId(): string {
  const flowWs = useContext(FlowWsCtx);
  const activeId = useWorkspace((s) => s.activeWorkspaceId);
  const defaultId = useWorkspace((s) => s.defaultWorkspaceId);
  return (flowWs ?? activeId) || defaultId; // '' (default-bucket page) resolves to defaultId
}

function useFlowTables(): TableData[] {
  const wsId = useFlowWsId();
  const tables = useData((s) => s.tables);
  const defaultId = useWorkspace((s) => s.defaultWorkspaceId);
  return useMemo(() => selectWorkspaceTables(tables, wsId, defaultId), [tables, wsId, defaultId]);
}

function useFlowPages(): Record<string, Page> {
  const wsId = useFlowWsId();
  const pages = useData((s) => s.pages);
  const defaultId = useWorkspace((s) => s.defaultWorkspaceId);
  return useMemo(() => selectWorkspacePages(pages, wsId, defaultId), [pages, wsId, defaultId]);
}

// FlowView, a free-canvas automation editor, peer to the mindmap. Drop trigger
// / filter / action / code / widget / note nodes, wire them into a runnable
// graph, edit a node's payload in the side inspector. The canvas reuses the
// mindmap's pure geometry (toScreen/toCanvas/edgePath/connect/…) rather than a
// graph library; the compile + execute logic is pure in lib/flow.ts. Same canvas
// rules as the map and mindmap: the container is `isolate`d, overlays at
// z-[1200], fit-once via a fittedRef. Persistence rides the graceful
// `pages.flow` path (setPageFlow).

const EMPTY: FlowData = { nodes: [], edges: [] };

function downloadJson(name: string, text: string) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const CLICK_SLOP = 4;
const FLOW_W = 208;

const KIND_META: Record<FlowNodeKind, { icon: typeof Zap; label: string; accent: string }> = {
  trigger: { icon: Zap, label: 'trigger', accent: 'rgb(var(--clay))' },
  filter: { icon: Filter, label: 'filter', accent: 'rgb(110 170 240)' },
  action: { icon: Play, label: 'action', accent: 'rgb(110 190 130)' },
  code: { icon: Code2, label: 'code', accent: 'rgb(170 140 240)' },
  widget: { icon: Square, label: 'button', accent: 'rgb(var(--clay))' },
  note: { icon: StickyNote, label: 'note', accent: 'rgb(var(--ink-faint))' },
};

const TRIGGER_LABELS: Record<FlowTriggerKind, string> = {
  rowFieldEquals: 'a field equals',
  rowFieldFilter: 'a condition becomes true',
  rowCreated: 'a row is created',
  rowDeleted: 'a row is deleted',
  pageCheckbox: 'a checkbox is ticked',
  schedule: 'on a schedule',
  manual: 'run manually',
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function defaultPayload(kind: FlowNodeKind): FlowNode['payload'] {
  if (kind === 'trigger') return { kind: 'manual' } satisfies FlowTrigger;
  if (kind === 'filter') return { expr: '' } satisfies FlowFilter;
  if (kind === 'action') return { target: { kind: 'thisRow' }, actions: [] } satisfies FlowActionSpec;
  if (kind === 'code') return { expr: '', outKey: 'value' } satisfies FlowCodeSpec;
  if (kind === 'widget') return { label: 'Run' } satisfies FlowWidgetSpec;
  return '';
}

type Drag =
  | { kind: 'pan'; startX: number; startY: number; vpX: number; vpY: number; downScreen: Pt }
  | { kind: 'node'; id: string; offset: Pt; downScreen: Pt }
  | { kind: 'edge'; from: string }
  | null;

export function FlowView({ pageId }: { pageId: string }) {
  const data = useData((s) => s.pages[pageId]?.flow) ?? EMPTY;
  const setFlow = useData((s) => s.setPageFlow);
  const runFlow = useData((s) => s.runFlow);
  const pageWs = useData((s) => s.pages[pageId]?.workspace ?? ''); // scope pickers to this flow's workspace
  const vaultStatus = useVault((s) => s.status);
  const openVault = useVault((s) => s.openPanel);
  const encryptedEnabled = useWorkspace((s) => s.encryptedEnabled);

  const containerRef = useRef<HTMLDivElement>(null);
  const fittedRef = useRef(false);
  const dragRef = useRef<Drag>(null);
  const vpCommit = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [vp, setVp] = useState<MindViewport>(() => data.viewport ?? { x: 0, y: 0, zoom: 1 });
  const [posDraft, setPosDraft] = useState<Record<string, Pt>>({});
  const [edgePreview, setEdgePreview] = useState<Pt | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingEdge, setEditingEdge] = useState<string | null>(null);
  const [addAt, setAddAt] = useState<{ screen: Pt; canvas: Pt; from?: string } | null>(null);
  const [dryRun, setDryRun] = useState(false);
  const [dryEffects, setDryEffects] = useState<Effect[] | null>(null);
  const [logTick, setLogTick] = useState(0); // bump to re-read the run log after a run
  const [ioOpen, setIoOpen] = useState(false); // the import/export menu
  const [importOpen, setImportOpen] = useState(false);

  // Import / export the whole flow as portable JSON (lib/flowIO). Import replaces
  // the canvas and re-fits (fittedRef reset), like a fresh open.
  const exportFlow = () => {
    downloadJson('automation.json', serializeFlowBundle(flowToBundle(data, 'Automation')));
    setIoOpen(false);
  };
  const applyFlowImport = (text: string): boolean => {
    let bundle;
    try {
      bundle = parseFlowBundle(text);
    } catch {
      return false;
    }
    fittedRef.current = false;
    setFlow(pageId, bundleToFlow(bundle, { uid }));
    return true;
  };

  const nodes = data.nodes;
  const edges = data.edges;
  const enabled = data.enabled !== false;
  const log = useMemo(() => flowLogFor(pageId), [pageId, logTick]);
  const compileErrors = useMemo(() => compileFlow(data).errors, [data]);

  useEffect(() => {
    if (fittedRef.current) return;
    const el = containerRef.current;
    if (!el || !nodes.length) return;
    if (data.viewport) { fittedRef.current = true; return; }
    setVp(fitView(nodes, { width: el.clientWidth, height: el.clientHeight }));
    fittedRef.current = true;
  }, [nodes, data.viewport]);

  const commit = useCallback((next: Partial<FlowData>) => {
    setFlow(pageId, { nodes, edges, viewport: vp, enabled: data.enabled, ...next });
  }, [setFlow, pageId, nodes, edges, vp, data.enabled]);

  const queueViewport = useCallback((next: MindViewport) => {
    if (vpCommit.current) clearTimeout(vpCommit.current);
    vpCommit.current = setTimeout(() => setFlow(pageId, { nodes, edges, viewport: next, enabled: data.enabled }), 500);
  }, [setFlow, pageId, nodes, edges, data.enabled]);

  const posOf = (n: FlowNode): Pt => posDraft[n.id] ?? { x: n.x, y: n.y };
  const visibleEdges = dedupeEdges(edges);

  // --- pointer handling -----------------------------------------------------

  const screenPt = (e: { clientX: number; clientY: number }): Pt => {
    const r = containerRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onBackgroundDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    setAddAt(null);
    setEditingEdge(null);
    dragRef.current = { kind: 'pan', startX: e.clientX, startY: e.clientY, vpX: vp.x, vpY: vp.y, downScreen: screenPt(e) };
    containerRef.current?.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    if (d.kind === 'pan') {
      setVp((v) => ({ ...v, x: d.vpX + (e.clientX - d.startX), y: d.vpY + (e.clientY - d.startY) }));
    } else if (d.kind === 'node') {
      const c = toCanvas(screenPt(e), vp);
      setPosDraft((p) => ({ ...p, [d.id]: { x: c.x - d.offset.x, y: c.y - d.offset.y } }));
    } else if (d.kind === 'edge') {
      setEdgePreview(toCanvas(screenPt(e), vp));
    }
  };

  const nodeAtCanvas = (c: Pt): FlowNode | undefined =>
    nodes.find((n) => {
      const p = posOf(n);
      return c.x >= p.x && c.x <= p.x + (n.w ?? FLOW_W) && c.y >= p.y && c.y <= p.y + (n.h ?? NODE_H);
    });

  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    if (d.kind === 'pan') {
      const up = screenPt(e);
      if (Math.hypot(up.x - d.downScreen.x, up.y - d.downScreen.y) <= CLICK_SLOP) setSelected(new Set());
      else queueViewport(vp);
    } else if (d.kind === 'node') {
      const up = screenPt(e);
      const travel = Math.hypot(up.x - d.downScreen.x, up.y - d.downScreen.y);
      if (travel > CLICK_SLOP) {
        const moved = posDraft[d.id];
        setPosDraft((p) => { const { [d.id]: _drop, ...rest } = p; return rest; });
        if (moved) commit({ nodes: nodes.map((n) => (n.id === d.id ? { ...n, x: moved.x, y: moved.y } : n)) });
      } else {
        setPosDraft((p) => { const { [d.id]: _drop, ...rest } = p; return rest; });
        const additive = e.shiftKey || e.metaKey || e.ctrlKey;
        setSelected((s) => toggleSelected(s, d.id, additive));
      }
    } else if (d.kind === 'edge') {
      const drop = toCanvas(screenPt(e), vp);
      const target = nodeAtCanvas(drop);
      setEdgePreview(null);
      if (target && target.id !== d.from) {
        const from = nodes.find((n) => n.id === d.from);
        // Edges out of a filter carry a branch (pass by default); the chip flips it.
        const branch = from?.kind === 'filter' ? { branch: 'pass' as const } : undefined;
        commit({ edges: connect(edges, d.from, target.id, branch) });
      } else if (!target) {
        setAddAt({ screen: screenPt(e), canvas: drop, from: d.from });
      }
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const s = screenPt(e);
    const before = toCanvas(s, vp);
    const zoom = clamp(vp.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1), 0.2, 2.5);
    const next = { x: s.x - before.x * zoom, y: s.y - before.y * zoom, zoom };
    setVp(next);
    queueViewport(next);
  };

  const startNodeDrag = (e: React.PointerEvent, n: FlowNode) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    if (!selected.has(n.id) && !additive) setSelected(new Set([n.id]));
    const c = toCanvas(screenPt(e), vp);
    const p = posOf(n);
    dragRef.current = { kind: 'node', id: n.id, offset: { x: c.x - p.x, y: c.y - p.y }, downScreen: screenPt(e) };
    containerRef.current?.setPointerCapture(e.pointerId);
  };

  const startEdgeDrag = (e: React.PointerEvent, n: FlowNode) => {
    e.stopPropagation();
    dragRef.current = { kind: 'edge', from: n.id };
    setEdgePreview(nodeCenter(n));
    containerRef.current?.setPointerCapture(e.pointerId);
  };

  // --- node ops -------------------------------------------------------------

  const addNode = (kind: FlowNodeKind, canvas: Pt) => {
    const node: FlowNode = { id: uid('fn_'), x: canvas.x - FLOW_W / 2, y: canvas.y - NODE_H / 2, w: FLOW_W, kind, payload: defaultPayload(kind) };
    const from = addAt?.from;
    const fromNode = from ? nodes.find((n) => n.id === from) : undefined;
    const branch = fromNode?.kind === 'filter' ? { branch: 'pass' as const } : undefined;
    const nextEdges = from ? connect(edges, from, node.id, branch) : edges;
    commit({ nodes: [...nodes, node], edges: nextEdges });
    setAddAt(null);
    setSelected(new Set([node.id]));
  };

  const updateNode = (id: string, patch: Partial<FlowNode>) =>
    commit({ nodes: nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) });

  const deleteSelected = () => {
    if (!selected.size) return;
    commit(deleteNodes(nodes, edges, selected));
    setSelected(new Set());
  };

  const updateEdge = (id: string, patch: Partial<FlowEdge>) =>
    commit({ edges: edges.map((e) => (e.id === id ? { ...e, ...patch } : e)) });
  const deleteEdge = (id: string) => { commit({ edges: edges.filter((e) => e.id !== id) }); setEditingEdge(null); };

  // Keyboard: delete selection, Escape clears. Inert while a field owns the keys.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (typing || addAt) return;
      if (e.key === 'Escape') { setSelected(new Set()); setEditingEdge(null); return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected.size) { e.preventDefault(); deleteSelected(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selected, addAt, deleteSelected]);

  const run = (nodeId: string) => {
    // An encrypted-workspace flow can't write comments/cells while the vault is
    // locked, prompt to unlock instead of silently doing nothing.
    if (!dryRun && pageWs && encryptedEnabled(pageWs) && vaultStatus !== 'unlocked') {
      openVault();
      toast('unlock your vault to run this automation', 'error');
      return;
    }
    const res = runFlow(pageId, nodeId, { dryRun });
    if (dryRun) setDryEffects(res.effects);
    else { setDryEffects(null); setLogTick((t) => t + 1); }
  };

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

  const selectedNode = selected.size === 1 ? nodes.find((n) => n.id === [...selected][0]) ?? null : null;
  const editingEdgeObj = editingEdge ? edges.find((e) => e.id === editingEdge) ?? null : null;

  return (
    <FlowWsCtx.Provider value={pageWs}>
    <div className="relative flex h-full w-full">
      <div className="relative min-w-0 flex-1">
        {/* top chrome */}
        <div className="absolute left-3 top-3 z-10 flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => commit({ enabled: !enabled })}
            className={[
              'flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs shadow-sm',
              enabled
                ? 'border-clay/40 bg-clay-wash text-clay dark:bg-clay/15'
                : 'border-paper-line bg-paper text-ink-faint dark:border-coal-line dark:bg-coal-panel dark:text-coal-soft',
            ].join(' ')}
            title={enabled ? 'flow is on, disable' : 'flow is off, enable'}
          >
            <Power className="h-3.5 w-3.5" /> {enabled ? 'On' : 'Off'}
          </button>
          <button
            type="button"
            onClick={() => { setDryRun((v) => !v); setDryEffects(null); }}
            className={[
              'flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs shadow-sm',
              dryRun ? 'border-clay/40 bg-clay-wash text-clay dark:bg-clay/15' : 'border-paper-line bg-paper text-ink-soft dark:border-coal-line dark:bg-coal-panel dark:text-coal-soft',
            ].join(' ')}
            title="dry run, show effects without applying"
          >
            <FlaskConical className="h-3.5 w-3.5" /> Test
          </button>
        </div>

        {/* import / export menu */}
        <div className="absolute right-3 top-3 z-10">
          <button
            type="button"
            onClick={() => setIoOpen((o) => !o)}
            title="Import / export automation"
            className="flex items-center gap-1.5 rounded-lg border border-paper-line bg-paper px-2.5 py-1.5 text-xs font-medium text-ink-soft shadow-sm hover:bg-paper-panel dark:border-coal-line dark:bg-coal-panel dark:text-coal-soft dark:hover:bg-coal-line"
          >
            <Download className="h-3.5 w-3.5" /> Import / export
          </button>
          {ioOpen && (
            <>
              <div className="fixed inset-0 z-[1190]" onMouseDown={() => setIoOpen(false)} />
              <div className="absolute right-0 top-full z-[1200] mt-1 w-56 rounded-lg border border-paper-line bg-paper p-1 shadow-xl dark:border-coal-line dark:bg-coal-panel">
                <button type="button" onClick={exportFlow} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink hover:bg-paper-panel dark:text-coal-text dark:hover:bg-coal-line">
                  <Download className="h-4 w-4 text-ink-faint" /> Export this automation (JSON)
                </button>
                <button type="button" onClick={() => { downloadJson('automation-template.json', serializeFlowBundle(blankFlowBundle())); setIoOpen(false); }} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink hover:bg-paper-panel dark:text-coal-text dark:hover:bg-coal-line">
                  <FileDown className="h-4 w-4 text-ink-faint" /> Download blank template
                </button>
                <button type="button" onClick={() => { downloadJson('automation-example.json', serializeFlowBundle(exampleFlowBundle())); setIoOpen(false); }} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink hover:bg-paper-panel dark:text-coal-text dark:hover:bg-coal-line">
                  <ClipboardList className="h-4 w-4 text-ink-faint" /> Download example (annotated)
                </button>
                <button type="button" onClick={() => { setImportOpen(true); setIoOpen(false); }} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink hover:bg-paper-panel dark:text-coal-text dark:hover:bg-coal-line">
                  <Upload className="h-4 w-4 text-ink-faint" /> Import from JSON…
                </button>
              </div>
            </>
          )}
        </div>

        {importOpen && <FlowImportModal onClose={() => setImportOpen(false)} onImport={applyFlowImport} />}

        {compileErrors.length > 0 && (
          <div className="absolute left-1/2 top-14 z-10 max-w-md -translate-x-1/2 rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-xs text-red-700 shadow-sm dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300">
            {compileErrors.join('; ')}
          </div>
        )}

        <div
          ref={containerRef}
          className="isolate h-full w-full cursor-grab touch-none overflow-hidden bg-paper-panel/30 active:cursor-grabbing dark:bg-coal/40"
          onPointerDown={onBackgroundDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onWheel={onWheel}
          onContextMenu={(e) => { e.preventDefault(); const s = screenPt(e); setAddAt({ screen: s, canvas: toCanvas(s, vp) }); }}
          onDoubleClick={(e) => {
            if (e.target === containerRef.current || (e.target as HTMLElement).dataset.canvas) {
              const s = screenPt(e);
              setAddAt({ screen: s, canvas: toCanvas(s, vp) });
            }
          }}
        >
          <div data-canvas className="absolute left-0 top-0 h-full w-full" style={{ transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`, transformOrigin: '0 0' }}>
            <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width="1" height="1">
              {visibleEdges.map((e) => {
                const from = nodes.find((n) => n.id === e.from);
                const to = nodes.find((n) => n.id === e.to);
                if (!from || !to) return null;
                const a = nodeCenter({ ...from, ...posOf(from) });
                const b = nodeCenter({ ...to, ...posOf(to) });
                const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
                const stroke = e.branch === 'pass' ? 'rgb(110 190 130)' : e.branch === 'fail' ? 'rgb(214 110 110)' : 'rgb(var(--ink-faint))';
                const label = e.branch ?? e.label;
                return (
                  <g key={e.id}>
                    <path d={edgePath(a, b)} fill="none" stroke={stroke} strokeWidth={1.5} markerEnd="url(#flow-arrow)" />
                    <path d={edgePath(a, b)} fill="none" stroke="transparent" strokeWidth={16} className="cursor-pointer" style={{ pointerEvents: 'stroke' }} onClick={() => setEditingEdge(e.id)} />
                    {label && (
                      <text x={mid.x} y={mid.y - 4} textAnchor="middle" dominantBaseline="middle" className="cursor-pointer text-[10px]" style={{ pointerEvents: 'auto', fill: stroke }} onClick={() => setEditingEdge(e.id)}>
                        {label}
                      </text>
                    )}
                  </g>
                );
              })}
              {edgePreview && dragRef.current?.kind === 'edge' && (() => {
                const from = nodes.find((n) => n.id === (dragRef.current as { from: string }).from);
                return from ? <path d={edgePath(nodeCenter({ ...from, ...posOf(from) }), edgePreview)} fill="none" stroke="rgb(var(--clay))" strokeWidth={1.5} strokeDasharray="4 4" /> : null;
              })()}
              <defs>
                <marker id="flow-arrow" markerWidth="9" markerHeight="9" refX="7.5" refY="4" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
                  <path d="M0,0 L8,4 L0,8 Z" fill="context-stroke" />
                </marker>
              </defs>
            </svg>

            {nodes.map((n) => (
              <FlowCard
                key={n.id}
                node={{ ...n, ...posOf(n) }}
                selected={selected.has(n.id)}
                onPointerDown={(e) => startNodeDrag(e, n)}
                onEdgeStart={(e) => startEdgeDrag(e, n)}
                onRun={() => run(n.id)}
                running={dryRun}
              />
            ))}
          </div>

          {!nodes.length && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <p className="rounded-lg bg-paper px-3 py-2 text-sm text-ink-faint shadow-sm dark:bg-coal-panel dark:text-coal-soft">double-click or right-click to drop a trigger</p>
            </div>
          )}

          <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-1.5 rounded-lg bg-paper/90 px-2.5 py-1.5 text-xs text-ink-soft shadow-sm dark:bg-coal-panel/90 dark:text-coal-soft">
            <Spline className="h-3.5 w-3.5 text-clay" /> drag a node's dot onto another to wire it
          </div>
        </div>

        {/* zoom cluster */}
        <div className="absolute bottom-3 right-3 flex flex-col overflow-hidden rounded-lg border border-paper-line bg-paper shadow-sm dark:border-coal-line dark:bg-coal-panel">
          {([['in', ZoomIn, () => zoomBy(1.2)], ['out', ZoomOut, () => zoomBy(1 / 1.2)], ['fit', Maximize, doFit]] as const).map(([key, Icon, fn]) => (
            <button key={key} type="button" onClick={fn} title={key === 'fit' ? 'fit to content' : `zoom ${key}`} className="p-1.5 text-ink-faint hover:bg-paper-panel hover:text-ink dark:hover:bg-coal-line dark:hover:text-coal-text">
              <Icon className="h-4 w-4" />
            </button>
          ))}
          <span className="border-t border-paper-line px-1.5 py-1 text-center text-[10px] font-medium text-ink-faint dark:border-coal-line">{Math.round(vp.zoom * 100)}%</span>
        </div>

        {addAt && <AddMenu at={addAt} onClose={() => setAddAt(null)} onAdd={addNode} />}

        {editingEdgeObj && (
          <EdgeChip
            edge={editingEdgeObj}
            fromFilter={nodes.find((n) => n.id === editingEdgeObj.from)?.kind === 'filter'}
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
      </div>

      {/* inspector / run log rail */}
      <div className="flex w-72 shrink-0 flex-col border-l border-paper-line bg-paper dark:border-coal-line dark:bg-coal-panel">
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {selectedNode ? (
            <Inspector node={selectedNode} onChange={(patch) => updateNode(selectedNode.id, patch)} onDelete={deleteSelected} onRun={() => run(selectedNode.id)} dryRun={dryRun} />
          ) : (
            <p className="text-xs text-ink-faint dark:text-coal-soft">select a node to edit it. a flow starts at a trigger (or a button you press) and walks the wires.</p>
          )}
        </div>
        <RunLog log={log} dryEffects={dryEffects} />
      </div>
    </div>
    </FlowWsCtx.Provider>
  );
}

// --- Node card --------------------------------------------------------------

function FlowCard({ node, selected, onPointerDown, onEdgeStart, onRun, running }: {
  node: FlowNode;
  selected: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onEdgeStart: (e: React.PointerEvent) => void;
  onRun: () => void;
  running: boolean;
}) {
  const meta = KIND_META[node.kind];
  const Icon = meta.icon;
  return (
    <div
      className={[
        'group absolute select-none rounded-lg border bg-paper shadow-sm dark:bg-coal-panel',
        selected ? 'border-clay ring-2 ring-clay ring-offset-1 ring-offset-paper dark:ring-offset-coal-panel' : 'border-paper-line dark:border-coal-line',
      ].join(' ')}
      style={{ left: node.x, top: node.y, width: node.w ?? FLOW_W, minHeight: node.h ?? NODE_H, borderLeft: `3px solid ${node.color ?? meta.accent}` }}
      onPointerDown={onPointerDown}
    >
      <div className="flex items-center gap-1.5 px-2 pt-1.5 text-[11px] text-ink-faint dark:text-coal-soft">
        <Icon className="h-3 w-3 shrink-0" style={{ color: meta.accent }} />
        <span className="flex-1 truncate">{meta.label}</span>
      </div>
      <div className="px-2 pb-2 pt-0.5">
        <CardBody node={node} />
        {(node.kind === 'widget' || (node.kind === 'trigger' && (node.payload as FlowTrigger).kind === 'manual')) && (
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onRun}
            className="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-md bg-clay px-2 py-1 text-xs font-medium text-white hover:bg-clay/90"
          >
            <Play className="h-3 w-3" /> {(node.payload as FlowWidgetSpec)?.label || 'Run'}{running ? ' (test)' : ''}
          </button>
        )}
      </div>
      <button
        type="button"
        onPointerDown={onEdgeStart}
        className="absolute -right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border-2 border-paper bg-clay opacity-0 transition-opacity group-hover:opacity-100 dark:border-coal-panel"
        title="drag to wire"
      />
    </div>
  );
}

// A compact, live summary of a node's payload (the editing UI is the inspector).
function CardBody({ node }: { node: FlowNode }) {
  const tables = useData((s) => s.tables);
  if (node.kind === 'trigger') {
    const t = node.payload as FlowTrigger;
    if (t.kind === 'rowFieldEquals') {
      const tbl = t.tableId ? tables[t.tableId] : undefined;
      const col = tbl?.columns.find((c) => c.id === t.columnId);
      return <Summary>when <b>{col?.name ?? 'a field'}</b> = {t.value || '…'} in {tbl?.name ?? 'a table'}</Summary>;
    }
    if (t.kind === 'rowFieldFilter') return <Summary mono>when {t.expr || '…'} in {t.tableId ? tables[t.tableId]?.name ?? 'a table' : 'a table'}</Summary>;
    if (t.kind === 'rowCreated') return <Summary>when a row is added to {t.tableId ? tables[t.tableId]?.name ?? 'a table' : 'a table'}</Summary>;
    if (t.kind === 'rowDeleted') return <Summary>when a row is deleted from {t.tableId ? tables[t.tableId]?.name ?? 'a table' : 'a table'}</Summary>;
    if (t.kind === 'pageCheckbox') return <Summary>when "{t.checkboxText || '…'}" is {t.checkboxState ?? 'checked'}</Summary>;
    if (t.kind === 'schedule') {
      const when = t.freq === 'weekly' ? `every ${WEEKDAYS[(((t.weekday ?? 1) % 7) + 7) % 7]}` : 'every day';
      return <Summary>{when} at {t.time || '09:00'}</Summary>;
    }
    return <Summary>run manually</Summary>;
  }
  if (node.kind === 'filter') return <Summary mono>{(node.payload as FlowFilter).expr || 'set a condition'}</Summary>;
  if (node.kind === 'code') { const c = node.payload as FlowCodeSpec; return <Summary mono>{c.outKey || 'value'} = {c.expr || '…'}</Summary>; }
  if (node.kind === 'action') {
    const a = node.payload as FlowActionSpec;
    if (a.target.kind === 'notify' || a.target.kind === 'comment') return <Summary>{a.target.kind} · {a.text || '…'}</Summary>;
    const n = a.actions?.length ?? 0;
    return <Summary>{describeTarget(a.target, tables)} · {n} action{n === 1 ? '' : 's'}</Summary>;
  }
  if (node.kind === 'note') return <Summary>{(node.payload as string) || 'note'}</Summary>;
  return null;
}

function Summary({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return <p className={['line-clamp-3 text-xs leading-snug text-ink dark:text-coal-text', mono ? 'font-mono text-[11px]' : ''].join(' ')}>{children}</p>;
}

function describeTarget(t: FlowActionTarget, tables: Record<string, { name: string }>): string {
  if (t.kind === 'thisRow') return 'this row';
  if (t.kind === 'createRow') return `new row in ${tables[t.tableId]?.name ?? 'table'}`;
  if (t.kind === 'matchRow') return `${t.all ? 'every' : 'first'} ${tables[t.tableId]?.name ?? 'table'} where ${t.columnId}=${t.value}`;
  return t.kind;
}

// --- Add menu ---------------------------------------------------------------

function AddMenu({ at, onClose, onAdd }: { at: { screen: Pt; canvas: Pt; from?: string }; onClose: () => void; onAdd: (kind: FlowNodeKind, canvas: Pt) => void }) {
  const kinds: FlowNodeKind[] = ['trigger', 'filter', 'action', 'code', 'widget', 'note'];
  return (
    <>
      <div className="fixed inset-0 z-[60]" onMouseDown={onClose} />
      <div className="absolute z-[70] w-48 rounded-lg border border-paper-line bg-paper p-1 shadow-xl dark:border-coal-line dark:bg-coal-panel" style={{ left: at.screen.x, top: at.screen.y }}>
        {kinds.map((k) => {
          const { icon: Icon, label, accent } = KIND_META[k];
          return (
            <button key={k} type="button" onClick={() => onAdd(k, at.canvas)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink hover:bg-paper-panel dark:text-coal-text dark:hover:bg-coal-line">
              <Icon className="h-4 w-4" style={{ color: accent }} />
              <span className="capitalize">{label}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}

// --- Edge chip --------------------------------------------------------------

function EdgeChip({ edge, fromFilter, screen, onClose, onChange, onDelete }: {
  edge: FlowEdge;
  fromFilter: boolean;
  screen: Pt;
  onClose: () => void;
  onChange: (patch: Partial<FlowEdge>) => void;
  onDelete: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <>
      <div className="fixed inset-0 z-[60]" onMouseDown={onClose} />
      <div className="absolute z-[70] flex -translate-x-1/2 -translate-y-full items-center gap-1 rounded-lg border border-paper-line bg-paper p-1.5 shadow-xl dark:border-coal-line dark:bg-coal-panel" style={{ left: screen.x, top: screen.y - 8 }}>
        {fromFilter && (
          <button type="button" onClick={() => onChange({ branch: edge.branch === 'pass' ? 'fail' : 'pass' })} className="rounded-md border border-paper-line px-2 py-1 text-xs text-ink-soft hover:bg-paper-panel dark:border-coal-line dark:text-coal-soft dark:hover:bg-coal-line" title="which way the gate sends control">
            {edge.branch ?? 'pass'}
          </button>
        )}
        <button type="button" onClick={onDelete} className="rounded-md p-1 text-ink-faint hover:bg-paper-panel hover:text-red-500 dark:hover:bg-coal-line" title="delete wire">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </>
  );
}

// --- Inspector --------------------------------------------------------------

const sel = 'rounded-md border border-paper-line bg-paper px-1.5 py-1 text-xs text-ink dark:border-coal-line dark:bg-coal dark:text-coal-text';
const inputCls = 'w-full rounded-md border border-paper-line bg-paper px-2 py-1.5 text-sm text-ink outline-none focus:border-clay dark:border-coal-line dark:bg-coal dark:text-coal-text';

function Inspector({ node, onChange, onDelete, onRun, dryRun }: {
  node: FlowNode;
  onChange: (patch: Partial<FlowNode>) => void;
  onDelete: () => void;
  onRun: () => void;
  dryRun: boolean;
}) {
  const meta = KIND_META[node.kind];
  const Icon = meta.icon;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5">
        <Icon className="h-4 w-4" style={{ color: meta.accent }} />
        <span className="text-sm font-medium capitalize text-ink dark:text-coal-text">{meta.label}</span>
        <button type="button" onClick={onDelete} className="ml-auto rounded p-1 text-ink-faint hover:text-red-500" title="delete node"><Trash2 className="h-3.5 w-3.5" /></button>
      </div>
      {node.kind === 'trigger' && (
        <>
          <TriggerInspector trigger={node.payload as FlowTrigger} onChange={(p) => onChange({ payload: p })} />
          <button type="button" onClick={onRun} className="flex w-full items-center justify-center gap-1.5 rounded-md bg-clay px-2 py-1.5 text-sm font-medium text-white hover:bg-clay/90">
            <Play className="h-3.5 w-3.5" /> run now{dryRun ? ' (test)' : ''}
          </button>
        </>
      )}
      {node.kind === 'filter' && <FilterInspector filter={node.payload as FlowFilter} onChange={(p) => onChange({ payload: p })} />}
      {node.kind === 'action' && <ActionInspector spec={node.payload as FlowActionSpec} onChange={(p) => onChange({ payload: p })} />}
      {node.kind === 'code' && <CodeInspector code={node.payload as FlowCodeSpec} onChange={(p) => onChange({ payload: p })} />}
      {node.kind === 'widget' && (
        <div className="space-y-2">
          <input value={(node.payload as FlowWidgetSpec).label} onChange={(e) => onChange({ payload: { label: e.target.value } })} placeholder="button label" className={inputCls} />
          <button type="button" onClick={onRun} className="flex w-full items-center justify-center gap-1.5 rounded-md bg-clay px-2 py-1.5 text-sm font-medium text-white hover:bg-clay/90">
            <Play className="h-3.5 w-3.5" /> run{dryRun ? ' (test)' : ''}
          </button>
        </div>
      )}
      {node.kind === 'note' && <textarea value={node.payload as string} onChange={(e) => onChange({ payload: e.target.value })} rows={4} placeholder="document this flow…" className={`${inputCls} resize-none`} />}
    </div>
  );
}

function TablePicker({ value, onChange, label }: { value?: string; onChange: (id: string) => void; label?: string }) {
  const list = useFlowTables().filter((t) => !t.formKey);
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value)} className={sel}>
      <option value="">{label ?? 'pick a table'}</option>
      {list.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
    </select>
  );
}

function ColumnPicker({ tableId, value, onChange }: { tableId?: string; value?: string; onChange: (id: string) => void }) {
  const cols = useData((s) => (tableId ? s.tables[tableId]?.columns : undefined)) ?? [];
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value)} className={sel}>
      <option value="">column</option>
      {cols.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
  );
}

// Pick a checkbox on the chosen page. Binds to the stable taskItem id when the
// page has been opened (the editor stamps ids); on a page that hasn't been
// migrated yet there are no items to list, so we fall back to typing the label.
function CheckboxPicker({ trigger, onChange }: { trigger: FlowTrigger; onChange: (t: FlowTrigger) => void }) {
  const content = useData((s) => (trigger.pageId ? s.pages[trigger.pageId]?.content : undefined));
  const items = useMemo(() => taskItems(content), [content]);
  if (!items.length) {
    return <input value={trigger.checkboxText ?? ''} onChange={(e) => onChange({ ...trigger, checkboxText: e.target.value, checkboxId: undefined })} placeholder="checkbox label (open the page to list them)" className={inputCls} />;
  }
  const current = trigger.checkboxId ?? (trigger.checkboxText ? `t:${trigger.checkboxText}` : '');
  return (
    <select
      value={current}
      onChange={(e) => {
        const v = e.target.value;
        if (!v) { onChange({ ...trigger, checkboxId: undefined, checkboxText: '' }); return; }
        if (v.startsWith('t:')) { onChange({ ...trigger, checkboxId: undefined, checkboxText: v.slice(2) }); return; }
        const it = items.find((x) => x.id === v);
        onChange({ ...trigger, checkboxId: v, checkboxText: it?.text ?? '' });
      }}
      className={`${sel} w-full`}
    >
      <option value="">pick a checkbox</option>
      {items.map((it, i) => <option key={it.id ?? i} value={it.id ?? `t:${it.text}`}>{(it.text || '(empty)') + (it.checked ? ' ✓' : '')}</option>)}
    </select>
  );
}

function TriggerInspector({ trigger, onChange }: { trigger: FlowTrigger; onChange: (t: FlowTrigger) => void }) {
  const tables = useData((s) => s.tables);
  const pages = useFlowPages();
  const col = trigger.tableId ? tables[trigger.tableId]?.columns.find((c) => c.id === trigger.columnId) : undefined;
  return (
    <div className="space-y-2">
      <label className="block text-[11px] font-medium uppercase tracking-wide text-ink-faint dark:text-coal-soft">when</label>
      <select value={trigger.kind} onChange={(e) => onChange({ kind: e.target.value as FlowTriggerKind })} className={`${sel} w-full`}>
        {(Object.keys(TRIGGER_LABELS) as FlowTriggerKind[]).map((k) => <option key={k} value={k}>{TRIGGER_LABELS[k]}</option>)}
      </select>

      {(trigger.kind === 'rowFieldEquals' || trigger.kind === 'rowFieldFilter' || trigger.kind === 'rowCreated' || trigger.kind === 'rowDeleted') && (
        <TablePicker value={trigger.tableId} onChange={(id) => onChange({ ...trigger, tableId: id, columnId: undefined, value: '' })} />
      )}
      {trigger.kind === 'rowFieldFilter' && (
        <div className="space-y-1">
          <input value={trigger.expr ?? ''} onChange={(e) => onChange({ ...trigger, expr: e.target.value })} placeholder='[hp] <= 0' className={`${inputCls} font-mono`} />
          <p className="text-[10px] leading-snug text-ink-faint dark:text-coal-soft">fires once when the row makes this true (not while it stays true).</p>
        </div>
      )}
      {trigger.kind === 'rowFieldEquals' && (
        <div className="flex flex-wrap items-center gap-1">
          <ColumnPicker tableId={trigger.tableId} value={trigger.columnId} onChange={(id) => onChange({ ...trigger, columnId: id, value: '' })} />
          <span className="text-xs text-ink-faint">=</span>
          {col?.type === 'select' ? (
            <select value={trigger.value ?? ''} onChange={(e) => onChange({ ...trigger, value: e.target.value })} className={sel}>
              <option value="">-</option>
              {(col.options ?? []).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          ) : col?.type === 'checkbox' ? (
            <select value={trigger.value ?? 'true'} onChange={(e) => onChange({ ...trigger, value: e.target.value })} className={sel}>
              <option value="true">checked</option>
              <option value="false">unchecked</option>
            </select>
          ) : (
            <input value={trigger.value ?? ''} onChange={(e) => onChange({ ...trigger, value: e.target.value })} placeholder="value" className={`${sel} w-20`} />
          )}
        </div>
      )}

      {trigger.kind === 'pageCheckbox' && (
        <div className="space-y-2">
          <select value={trigger.pageId ?? ''} onChange={(e) => onChange({ ...trigger, pageId: e.target.value, checkboxId: undefined, checkboxText: '' })} className={`${sel} w-full`}>
            <option value="">pick a page</option>
            {Object.values(pages).filter((p) => !p.trashed).map((p) => <option key={p.id} value={p.id}>{p.title || 'Untitled'}</option>)}
          </select>
          <CheckboxPicker trigger={trigger} onChange={onChange} />
          <select value={trigger.checkboxState ?? 'checked'} onChange={(e) => onChange({ ...trigger, checkboxState: e.target.value as 'checked' | 'unchecked' })} className={`${sel} w-full`}>
            <option value="checked">when ticked</option>
            <option value="unchecked">when un-ticked</option>
          </select>
        </div>
      )}

      {trigger.kind === 'schedule' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-1">
            <select value={trigger.freq ?? 'daily'} onChange={(e) => onChange({ ...trigger, freq: e.target.value as 'daily' | 'weekly' })} className={sel}>
              <option value="daily">every day</option>
              <option value="weekly">every week</option>
            </select>
            {(trigger.freq ?? 'daily') === 'weekly' && (
              <select value={String(trigger.weekday ?? 1)} onChange={(e) => onChange({ ...trigger, weekday: Number(e.target.value) })} className={sel}>
                {WEEKDAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
              </select>
            )}
            <span className="text-xs text-ink-faint">at</span>
            <input type="time" value={trigger.time ?? '09:00'} onChange={(e) => onChange({ ...trigger, time: e.target.value })} className={sel} />
          </div>
          <p className="text-[10px] leading-snug text-ink-faint dark:text-coal-soft">
            runs on its own while the app is open. a row-less run, so wire it to a "create row" or "set on every matching row" action.
          </p>
        </div>
      )}
    </div>
  );
}

function FilterInspector({ filter, onChange }: { filter: FlowFilter; onChange: (f: FlowFilter) => void }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-[11px] font-medium uppercase tracking-wide text-ink-faint dark:text-coal-soft">condition</label>
      <input value={filter.expr} onChange={(e) => onChange({ expr: e.target.value })} placeholder='[amount] > 100' className={`${inputCls} font-mono`} />
      <p className="text-[11px] text-ink-faint dark:text-coal-soft">refer to columns by name in brackets. wire the pass/fail outputs to branch.</p>
    </div>
  );
}

function CodeInspector({ code, onChange }: { code: FlowCodeSpec; onChange: (c: FlowCodeSpec) => void }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-[11px] font-medium uppercase tracking-wide text-ink-faint dark:text-coal-soft">compute</label>
      <input value={code.expr} onChange={(e) => onChange({ ...code, expr: e.target.value })} placeholder='[qty] * [price]' className={`${inputCls} font-mono`} />
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-ink-faint">name</span>
        <input value={code.outKey} onChange={(e) => onChange({ ...code, outKey: e.target.value })} placeholder="total" className={`${sel} flex-1`} />
      </div>
      <p className="text-[11px] text-ink-faint dark:text-coal-soft">expression engine, not javascript, arithmetic, if, concat, fx, today.</p>
    </div>
  );
}

function ActionInspector({ spec, onChange }: { spec: FlowActionSpec; onChange: (s: FlowActionSpec) => void }) {
  const tables = useData((s) => s.tables);
  const wsTables = useFlowTables();
  const pages = useFlowPages();
  const writesCells = spec.target.kind === 'thisRow' || spec.target.kind === 'createRow' || spec.target.kind === 'matchRow';
  const targetTableId = spec.target.kind === 'createRow' || spec.target.kind === 'matchRow' ? spec.target.tableId : undefined;
  const columns: Column[] = targetTableId ? tables[targetTableId]?.columns ?? [] : firstColumns(wsTables);
  const setTarget = (target: FlowActionTarget) => onChange({ ...spec, target });
  return (
    <div className="space-y-2">
      <label className="block text-[11px] font-medium uppercase tracking-wide text-ink-faint dark:text-coal-soft">do this to</label>
      <select
        value={spec.target.kind}
        onChange={(e) => {
          const k = e.target.value as FlowActionTarget['kind'];
          if (k === 'thisRow') setTarget({ kind: 'thisRow' });
          else if (k === 'createRow') setTarget({ kind: 'createRow', tableId: targetTableId ?? '' });
          else if (k === 'matchRow') setTarget({ kind: 'matchRow', tableId: targetTableId ?? '', columnId: '', value: '' });
          else if (k === 'notify') setTarget({ kind: 'notify' });
          else setTarget({ kind: 'comment', pageId: '' });
        }}
        className={`${sel} w-full`}
      >
        <option value="thisRow">the triggering row</option>
        <option value="createRow">a new row in…</option>
        <option value="matchRow">rows where…</option>
        <option value="notify">notify (bell)</option>
        <option value="comment">comment on a page</option>
      </select>

      {spec.target.kind === 'createRow' && <TablePicker value={spec.target.tableId} onChange={(id) => setTarget({ kind: 'createRow', tableId: id })} />}
      {spec.target.kind === 'matchRow' && (
        <div className="space-y-1.5">
          <TablePicker value={spec.target.tableId} onChange={(id) => setTarget({ kind: 'matchRow', tableId: id, columnId: '', value: '', all: (spec.target as Extract<FlowActionTarget, { kind: 'matchRow' }>).all })} />
          <div className="flex items-center gap-1">
            <ColumnPicker tableId={spec.target.tableId} value={spec.target.columnId} onChange={(id) => setTarget({ ...(spec.target as Extract<FlowActionTarget, { kind: 'matchRow' }>), columnId: id })} />
            <span className="text-xs text-ink-faint">=</span>
            <input value={spec.target.value} onChange={(e) => setTarget({ ...(spec.target as Extract<FlowActionTarget, { kind: 'matchRow' }>), value: e.target.value })} placeholder="value" className={`${sel} w-20`} />
          </div>
          <select value={spec.target.all ? 'all' : 'first'} onChange={(e) => setTarget({ ...(spec.target as Extract<FlowActionTarget, { kind: 'matchRow' }>), all: e.target.value === 'all' })} className={sel}>
            <option value="first">first match</option>
            <option value="all">all matches</option>
          </select>
        </div>
      )}
      {spec.target.kind === 'comment' && (
        <select value={spec.target.pageId} onChange={(e) => setTarget({ kind: 'comment', pageId: e.target.value })} className={`${sel} w-full`}>
          <option value="">pick a page</option>
          {Object.values(pages).filter((p) => !p.trashed).map((p) => <option key={p.id} value={p.id}>{p.title || 'Untitled'}</option>)}
        </select>
      )}

      {writesCells ? (
        <>
          <label className="block pt-1 text-[11px] font-medium uppercase tracking-wide text-ink-faint dark:text-coal-soft">then</label>
          <ActionEditor columns={columns} actions={spec.actions} onChange={(a) => onChange({ ...spec, actions: a })} allowScoped />
        </>
      ) : (
        <>
          <label className="block pt-1 text-[11px] font-medium uppercase tracking-wide text-ink-faint dark:text-coal-soft">message</label>
          <input value={spec.text ?? ''} onChange={(e) => onChange({ ...spec, text: e.target.value })} placeholder="HP dropped to [hp]" className={`${inputCls} font-mono`} />
          <p className="text-[10px] leading-snug text-ink-faint dark:text-coal-soft">[column name] is filled in from the triggering row.</p>
        </>
      )}
    </div>
  );
}

// Action targets that aren't a specific table edit the trigger row's columns,
// we don't know the table at edit time, so offer the first table's columns as a
// reasonable shape. (A thisRow action's column ids resolve against whatever row
// actually fires it.)
function firstColumns(tables: { columns: Column[]; formKey?: string }[]): Column[] {
  const first = tables.find((t) => !t.formKey);
  return first?.columns ?? [];
}

// --- Run log ----------------------------------------------------------------

function RunLog({ log, dryEffects }: { log: FlowRunLog[]; dryEffects: Effect[] | null }) {
  if (!log.length && !dryEffects) {
    return <div className="border-t border-paper-line px-3 py-2 text-[11px] text-ink-faint dark:border-coal-line dark:text-coal-soft">runs show up here.</div>;
  }
  return (
    <div className="max-h-48 overflow-y-auto border-t border-paper-line dark:border-coal-line">
      {dryEffects && (
        <div className="border-b border-paper-line bg-clay-wash/40 px-3 py-2 dark:border-coal-line dark:bg-clay/10">
          <p className="text-[11px] font-medium text-clay">dry run, {dryEffects.length} effect{dryEffects.length === 1 ? '' : 's'}, not applied</p>
          {dryEffects.map((e, i) => <p key={i} className="mt-0.5 truncate font-mono text-[10px] text-ink-soft dark:text-coal-soft">{effectLine(e)}</p>)}
        </div>
      )}
      {log.map((entry, i) => (
        <div key={i} className="border-b border-paper-line px-3 py-1.5 last:border-0 dark:border-coal-line">
          <p className="text-[10px] text-ink-faint dark:text-coal-soft">{new Date(entry.at).toLocaleTimeString()} · {entry.trigger}</p>
          {entry.detail.map((d, j) => <p key={j} className="truncate text-[11px] text-ink dark:text-coal-text">{d}</p>)}
        </div>
      ))}
    </div>
  );
}

function effectLine(e: Effect): string {
  if (e.kind === 'notify') return `🔔 ${e.text}`;
  if (e.kind === 'comment') return `💬 ${e.pageId}: ${e.body}`;
  const n = Object.keys(e.cells).length;
  if (e.kind === 'createRow') return `+ row in ${e.tableId} (${n})`;
  if (e.kind === 'matchSetCells') return `~ first ${e.tableId} where ${e.columnId}=${e.value} (${n})`;
  if (e.kind === 'matchAllSetCells') return `~ all ${e.tableId} where ${e.columnId}=${e.value} (${n})`;
  return `~ ${e.tableId}/${e.rowId} (${n})`;
}

// Paste or upload an automation JSON. The parse + rebuild lives in lib/flowIO
// (tested); this is the paste box, a file picker, and an honest error. Importing
// replaces the whole canvas.
function FlowImportModal({ onClose, onImport }: { onClose: () => void; onImport: (text: string) => boolean }) {
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const run = () => {
    if (!text.trim()) {
      setErr('Paste an automation JSON file, or pick one.');
      return;
    }
    if (!onImport(text)) {
      setErr('That is not a valid automation file. Download the template or example to see the shape.');
      return;
    }
    onClose();
  };
  return (
    <div className="fixed inset-0 z-[1300] flex items-center justify-center bg-black/30 p-4" onMouseDown={onClose}>
      <div className="w-full max-w-lg rounded-xl border border-paper-line bg-paper p-4 shadow-2xl dark:border-coal-line dark:bg-coal-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink dark:text-coal-text">Import automation</h3>
          <button type="button" onClick={onClose} className="rounded p-1 text-ink-faint hover:bg-paper-panel dark:hover:bg-coal-line">
            <X className="h-4 w-4" />
          </button>
        </div>
        <textarea
          value={text}
          onChange={(e) => { setText(e.target.value); setErr(''); }}
          rows={9}
          placeholder={'Paste an automation JSON (nodes + edges), or use "Choose file".\nDownload the template or example first to see the shape.'}
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
          <span className="ml-auto text-[10px] text-ink-faint dark:text-coal-soft">replaces this automation</span>
        </div>
      </div>
    </div>
  );
}
