import type { Column, CellValue, FlowData, FlowNode, FlowEdge, FlowFilter, FlowCodeSpec, FlowActionSpec, FlowTrigger } from '../types';
import { evaluateFormula, type FormulaScope, type FormulaValue, type FxResolve } from './formula';
import { applyActionsScoped } from './automations';
import { detectCycle } from './deps';
import { cellText } from './tableQuery';
import type { Rng } from './dice';

// ---------------------------------------------------------------------------
// Flows, the pure core of the automation canvas. A Flow is a graph: triggers
// fire it, filters gate it, code computes values, actions write to rows. This
// module compiles the graph into an ordered plan and executes a plan into a
// list of Effects, it never touches the store. The runtime (useData) applies
// the Effects under the existing automation guard. Keeping it pure is what
// makes dry-run/test mode free (just don't apply the effects) and the whole
// thing testable without a DOM or a backend.
//
// The expression engine here is the same safe formula.ts used by formula
// columns, no eval, ever. Arbitrary code (HTTP, loops) is a server-hook
// concern, deliberately not a browser one.
// ---------------------------------------------------------------------------

// What an executed flow wants done. Described, not performed: the runtime turns
// these into store calls. `matchSetCells` carries criteria, not a row id, the
// store resolves the actual row when it applies the effect.
export type Effect =
  | { kind: 'setCells'; tableId: string; rowId: string; cells: Record<string, CellValue> }
  | { kind: 'createRow'; tableId: string; cells: Record<string, CellValue> }
  | { kind: 'matchSetCells'; tableId: string; columnId: string; value: string; cells: Record<string, CellValue> }
  | { kind: 'matchAllSetCells'; tableId: string; columnId: string; value: string; cells: Record<string, CellValue> }
  | { kind: 'notify'; text: string; rowId?: string; tableId?: string } // bell entry
  | { kind: 'comment'; pageId: string; body: string }; // posts a comment

// The bag passed between steps. A trigger seeds `vars` (the row's cells, keyed
// by column name like the formula scope; or {checked,text} for a checkbox);
// code nodes add to it; filters and code read it.
export interface FlowContext {
  vars: FormulaScope;
  row?: { tableId: string; rowId?: string; cells: Record<string, CellValue> };
}

// The bits the pure layer can't compute itself, injected by the runtime.
export interface FlowEnv {
  now: Date;
  fx?: FxResolve;
  rng?: Rng; // injected (Math.random in the runtime) so flow rolls can use dice()
}

export interface FlowLogEntry {
  nodeId: string;
  kind: FlowNode['kind'];
  detail: string;
}

export interface FlowPlan {
  // One entry per trigger / widget entry node, each with its reachable steps in
  // topological order (the entry node first).
  triggers: { node: FlowNode; steps: FlowNode[] }[];
  errors: string[];
}

const truthy = (v: FormulaValue): boolean => (typeof v === 'string' ? v.trim() !== '' : v !== 0);

// --- Compile ----------------------------------------------------------------

// Validate and order. Each entry node (trigger or widget) gets the sub-graph
// reachable from it, topologically sorted. A cycle anywhere bails to an error
// (reusing deps.ts so we don't reinvent cycle detection) rather than hanging.
export function compileFlow(data: FlowData): FlowPlan {
  const errors: string[] = [];
  if (detectCycle(data.edges.map((e) => ({ fromRowId: e.from, toRowId: e.to })))) {
    errors.push('flow has a cycle, execution would not terminate');
    return { triggers: [], errors };
  }

  const byId = new Map(data.nodes.map((n) => [n.id, n]));
  const out = new Map<string, string[]>();
  for (const e of data.edges) {
    if (!byId.has(e.from) || !byId.has(e.to)) continue;
    (out.get(e.from) ?? out.set(e.from, []).get(e.from)!).push(e.to);
  }

  const entries = data.nodes.filter((n) => n.kind === 'trigger' || n.kind === 'widget');
  const triggers = entries.map((node) => ({ node, steps: topoFrom(node.id, out, byId) }));
  return { triggers, errors };
}

// Nodes reachable from `start`, in topological order with `start` first. The
// graph is already known acyclic here, so a DFS post-order (reversed) is a
// valid topological order.
function topoFrom(start: string, out: Map<string, string[]>, byId: Map<string, FlowNode>): FlowNode[] {
  const order: string[] = [];
  const seen = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id) || !byId.has(id)) return;
    seen.add(id);
    for (const next of out.get(id) ?? []) visit(next);
    order.push(id);
  };
  visit(start);
  order.reverse();
  return order.map((id) => byId.get(id)!);
}

// --- Execute ----------------------------------------------------------------

// Walk the steps in topological order, gating control through filter branches,
// running code/actions, accumulating effects. Pure: returns the effects to
// apply and a log of what happened. `edges` is the flow's full edge list; only
// edges among `steps` matter.
export function runPlan(
  steps: FlowNode[],
  edges: FlowEdge[],
  ctx: FlowContext,
  env: FlowEnv,
): { effects: Effect[]; log: FlowLogEntry[] } {
  const effects: Effect[] = [];
  const log: FlowLogEntry[] = [];
  if (!steps.length) return { effects, log };

  const stepIds = new Set(steps.map((n) => n.id));
  const incoming = new Map<string, FlowEdge[]>();
  for (const e of edges) {
    if (!stepIds.has(e.from) || !stepIds.has(e.to)) continue;
    (incoming.get(e.to) ?? incoming.set(e.to, []).get(e.to)!).push(e);
  }

  const reached = new Set<string>();
  const filterPass = new Map<string, boolean>();
  const entryId = steps[0].id; // topoFrom puts the entry first

  // Is control able to flow along edge u→v, given how its source resolved?
  const edgeLive = (e: FlowEdge): boolean => {
    if (!reached.has(e.from)) return false;
    const src = filterPass.get(e.from);
    if (src === undefined) return true; // non-filter (or unreached filter): always forwards
    // Filter: a branch-tagged edge follows its branch; an untagged edge is pass.
    if (e.branch === 'fail') return src === false;
    return src === true;
  };

  for (const node of steps) {
    const isReached = node.id === entryId || (incoming.get(node.id) ?? []).some(edgeLive);
    if (!isReached) continue;
    reached.add(node.id);

    if (node.kind === 'filter') {
      const expr = (node.payload as FlowFilter)?.expr ?? '';
      const res = evaluateFormula(expr, ctx.vars, env.fx);
      const pass = res.ok && truthy(res.value);
      filterPass.set(node.id, pass);
      log.push({ nodeId: node.id, kind: 'filter', detail: res.ok ? `${expr || '(empty)'} → ${pass ? 'pass' : 'fail'}` : `error: ${res.error}` });
    } else if (node.kind === 'code') {
      const spec = node.payload as FlowCodeSpec;
      const res = evaluateFormula(spec?.expr ?? '', ctx.vars, env.fx, env.rng);
      if (spec?.outKey) ctx.vars[spec.outKey] = res.ok ? res.value : 0;
      log.push({ nodeId: node.id, kind: 'code', detail: res.ok ? `${spec?.outKey || '?'} = ${String(res.value)}` : `error: ${res.error}` });
    } else if (node.kind === 'action') {
      const eff = actionEffect(node.payload as FlowActionSpec, ctx, env);
      if (eff) {
        effects.push(eff);
        log.push({ nodeId: node.id, kind: 'action', detail: describeEffect(eff) });
      } else {
        log.push({ nodeId: node.id, kind: 'action', detail: 'skipped (no target row)' });
      }
    }
    // trigger / widget / note: pass-through.
  }

  return { effects, log };
}

function actionEffect(spec: FlowActionSpec, ctx: FlowContext, env: FlowEnv): Effect | null {
  if (!spec) return null;
  const target = spec.target;
  if (!target) return null;

  // notify/comment carry an interpolated message, not a cell patch.
  if (target.kind === 'notify') {
    return { kind: 'notify', text: interpolateRefs(spec.text ?? '', ctx.vars), rowId: ctx.row?.rowId, tableId: ctx.row?.tableId };
  }
  if (target.kind === 'comment') {
    return { kind: 'comment', pageId: target.pageId, body: interpolateRefs(spec.text ?? '', ctx.vars) };
  }

  // The rest write cells. Scoped resolution reads the trigger row's current
  // values (raw, by id) for increment/append/toggle; setExpr uses the scope.
  const cells = applyActionsScoped(spec.actions ?? [], ctx.vars, env.now, env.fx, ctx.row?.cells, env.rng);
  if (target.kind === 'thisRow') {
    if (!ctx.row?.rowId) return null; // a triggerless / checkbox run has no row to write back
    return { kind: 'setCells', tableId: ctx.row.tableId, rowId: ctx.row.rowId, cells };
  }
  if (target.kind === 'createRow') {
    return { kind: 'createRow', tableId: target.tableId, cells };
  }
  return { kind: target.all ? 'matchAllSetCells' : 'matchSetCells', tableId: target.tableId, columnId: target.columnId, value: target.value, cells };
}

function describeEffect(eff: Effect): string {
  if (eff.kind === 'notify') return `notify: ${eff.text.slice(0, 60)}`;
  if (eff.kind === 'comment') return `comment on ${eff.pageId}: ${eff.body.slice(0, 50)}`;
  const cells = Object.keys(eff.cells).length;
  const fields = `${cells} field${cells === 1 ? '' : 's'}`;
  if (eff.kind === 'createRow') return `create row in ${eff.tableId} (${fields})`;
  if (eff.kind === 'matchSetCells') return `set ${fields} on first ${eff.tableId} where ${eff.columnId}=${eff.value}`;
  if (eff.kind === 'matchAllSetCells') return `set ${fields} on every ${eff.tableId} where ${eff.columnId}=${eff.value}`;
  return `set ${fields} on ${eff.tableId}/${eff.rowId}`;
}

// Substitute [column name] / [@row] references in a free-text template with their
// scope values. The shared interpolation for notify/comment messages, distinct
// from the formula engine (which parses [ref] as an expression token).
export function interpolateRefs(template: string, scope: FormulaScope): string {
  return template.replace(/\[([^\]]+)\]/g, (whole, name: string) => {
    const v = scope[name.trim()];
    return v === undefined ? whole : String(v);
  });
}

// A scoped action (e.g. setExpr resolving [@row]) can hand a relation column a
// bare id string; relation cells are id arrays, so wrap it. Everything else
// passes through. Coercion is the column's problem on write, never the engine's.
export function coerceCellWrite(column: Column | undefined, value: CellValue): CellValue {
  if (column?.type === 'relation' && typeof value === 'string') return value === '' ? [] : [value];
  return value;
}

// --- Trigger index ----------------------------------------------------------

// A cheap lookup so a keystroke in a cell is an O(1)-ish map hit, not a scan of
// every flow on every page. Each enabled flow's trigger nodes are bucketed by
// what they listen to. The runtime rebuilds this only when some page's flow
// changes (see useData), not per event.
export interface FlowListener {
  pageId: string;
  flow: FlowData;
  trigger: FlowNode; // the specific trigger node this listener starts from
}

export interface FlowIndex {
  byTableField: Map<string, FlowListener[]>; // keyed by tableId (rowFieldEquals)
  byTableFilter: Map<string, FlowListener[]>; // keyed by tableId (rowFieldFilter, predicate eval on any change)
  byTableCreate: Map<string, FlowListener[]>; // keyed by tableId (rowCreated)
  byTableDelete: Map<string, FlowListener[]>; // keyed by tableId (rowDeleted)
  byPageCheckbox: Map<string, FlowListener[]>; // keyed by pageId (pageCheckbox)
  scheduled: FlowListener[]; // time triggers, evaluated against the wall clock on a tick
}

export function indexFlows(pages: { id: string; flow?: FlowData | null; trashed?: boolean }[]): FlowIndex {
  const idx: FlowIndex = { byTableField: new Map(), byTableFilter: new Map(), byTableCreate: new Map(), byTableDelete: new Map(), byPageCheckbox: new Map(), scheduled: [] };
  const push = (map: Map<string, FlowListener[]>, key: string | undefined, listener: FlowListener) => {
    if (!key) return;
    (map.get(key) ?? map.set(key, []).get(key)!).push(listener);
  };
  for (const page of pages) {
    const flow = page.flow;
    if (!flow || flow.enabled === false) continue;
    // A page in the trash is deleted as far as the user is concerned, and its
    // automations have to be too. They used to keep firing from the bin, so
    // "throw the page away" was not a way to stop a flow that was misbehaving,
    // and restoring the page silently brought nothing back because it had never
    // actually stopped.
    if (page.trashed) continue;
    for (const node of flow.nodes) {
      if (node.kind !== 'trigger') continue;
      const trig = node.payload as { kind?: string; tableId?: string; pageId?: string };
      const listener: FlowListener = { pageId: page.id, flow, trigger: node };
      if (trig.kind === 'rowFieldEquals') push(idx.byTableField, trig.tableId, listener);
      else if (trig.kind === 'rowFieldFilter') push(idx.byTableFilter, trig.tableId, listener);
      else if (trig.kind === 'rowCreated') push(idx.byTableCreate, trig.tableId, listener);
      else if (trig.kind === 'rowDeleted') push(idx.byTableDelete, trig.tableId, listener);
      else if (trig.kind === 'pageCheckbox') push(idx.byPageCheckbox, trig.pageId, listener);
      else if (trig.kind === 'schedule') idx.scheduled.push(listener);
    }
  }
  return idx;
}

// --- Scheduled triggers -----------------------------------------------------
// A schedule trigger fires on the wall clock, not on an edit, so the runtime
// evaluates it on a tick. These two helpers are the pure decision the tick uses;
// the runtime owns the timer and the per-trigger "last fired" memory.

function parseHHmm(time: string | undefined): [number, number] {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time ?? '');
  if (!m) return [9, 0];
  return [Math.min(23, Math.max(0, +m[1])), Math.min(59, Math.max(0, +m[2]))];
}

/** The most recent instant this schedule was due, at or before `now` (local
 *  time), or null if it has not come round yet. Daily resolves to today at HH:mm
 *  (or yesterday's if we are before it); weekly to the most recent matching
 *  weekday at HH:mm within the last week. */
export function lastScheduledSlot(trigger: FlowTrigger, now: number): number | null {
  const [hh, mm] = parseHHmm(trigger.time);
  const d = new Date(now);
  if (trigger.freq === 'weekly') {
    const target = (((trigger.weekday ?? 1) % 7) + 7) % 7;
    for (let back = 0; back < 7; back++) {
      const cand = new Date(d.getFullYear(), d.getMonth(), d.getDate() - back, hh, mm, 0, 0).getTime();
      if (cand <= now && new Date(cand).getDay() === target) return cand;
    }
    return null;
  }
  const today = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh, mm, 0, 0).getTime();
  return today <= now ? today : today - 86400000;
}

/** Should a scheduled flow fire now? True when its most recent slot is in the
 *  past and we have not already fired for that slot (`lastFired` predates it).
 *  So a flow fires once per slot, and catches up at most one missed slot. */
export function scheduleDue(trigger: FlowTrigger, lastFired: number, now: number): boolean {
  const slot = lastScheduledSlot(trigger, now);
  return slot != null && lastFired < slot && now >= slot;
}

// Did a row's predicate flip false→true across an edit? The rising-edge test for
// the rowFieldFilter trigger, needs the pre-edit cells, so the store captures
// `prev` before applying the optimistic write and threads both states in.
export function filterRose(expr: string, columns: Column[], oldCells: Record<string, CellValue>, newCells: Record<string, CellValue>, fx?: FxResolve): boolean {
  if (!expr.trim()) return false;
  const passes = (cells: Record<string, CellValue>): boolean => {
    const res = evaluateFormula(expr, cellScope(columns, cells), fx);
    return res.ok && truthy(res.value);
  };
  return !passes(oldCells) && passes(newCells);
}

// --- Scope ------------------------------------------------------------------

// A formula scope from a row's cells, keyed by column name (matching the table
// formula scope so a filter writes `[Status]`, not a column id). Mirrors
// TableCell.buildScope / printDoc.printScope intentionally, those live in a
// component / are tied to print, and a pure lib can't import the component.
export function cellScope(columns: Column[], cells: Record<string, CellValue>): FormulaScope {
  const scope: FormulaScope = {};
  for (const c of columns) {
    const v = cells[c.id] ?? null;
    if (c.type === 'number') scope[c.name] = typeof v === 'number' ? v : Number(v) || 0;
    else if (c.type === 'date' || c.type === 'datetime' || c.type === 'reminder') scope[c.name] = dayIndex(v);
    else if (c.type === 'checkbox') scope[c.name] = v === true ? 1 : 0;
    else if (c.type === 'text' || c.type === 'url' || c.type === 'select' || c.type === 'multiselect' || c.type === 'place') scope[c.name] = cellText(v, c);
  }
  // Repeat until stable so formulas can reference each other regardless of order.
  const formulaCols = columns.filter((c) => c.type === 'formula' && c.formula);
  for (let pass = 0; pass < formulaCols.length; pass++) {
    let changed = false;
    for (const c of formulaCols) {
      const v = evaluateFormula(c.formula as string, scope).value;
      if (scope[c.name] !== v) {
        scope[c.name] = v;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return scope;
}

function dayIndex(v: CellValue): number {
  if (typeof v !== 'string') return 0;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(v);
  if (!m) return 0;
  const day = Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000);
  return m[4] !== undefined ? day + (+m[4] * 60 + +m[5]) / 1440 : day;
}

// --- Task checkboxes (pageCheckbox trigger) ---------------------------------

interface ProseNode {
  type?: string;
  text?: string;
  attrs?: { checked?: boolean; id?: string };
  content?: ProseNode[];
}

export interface TaskItem {
  id?: string; // stable taskItem id once the editor has stamped one
  text: string;
  checked: boolean;
}

// Flatten a TipTap doc to its task items in document order. Each item's text is
// the concatenation of its descendant text nodes (nested task lists included),
// and `id` is the stable attribute the editor stamps (absent on un-migrated
// docs, in which case callers fall back to text matching).
export function taskItems(doc: unknown): TaskItem[] {
  const out: TaskItem[] = [];
  const textOf = (node: ProseNode): string => {
    let s = node.text ?? '';
    for (const c of node.content ?? []) {
      if (c.type === 'taskItem') continue; // a nested task's text belongs to that task
      s += textOf(c);
    }
    return s;
  };
  const walk = (node: ProseNode | undefined) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'taskItem') {
      out.push({ id: node.attrs?.id, text: textOf(node).replace(/\s+/g, ' ').trim(), checked: node.attrs?.checked === true });
    }
    for (const c of node.content ?? []) walk(c);
  };
  walk(doc as ProseNode);
  return out;
}

// Did the configured checkbox flip into `state` between two doc versions? Matches
// by stable id when one is given (survives text edits / duplicate labels), else
// by text. Fires on the transition into the wanted state (a new match counts).
export function checkboxFired(oldDoc: unknown, newDoc: unknown, match: { id?: string; text?: string }, state: 'checked' | 'unchecked'): boolean {
  const want = state === 'checked';
  const pick = match.id
    ? (t: TaskItem) => t.id === match.id
    : (t: TaskItem) => t.text === match.text;
  const before = taskItems(oldDoc).find(pick);
  const after = taskItems(newDoc).find(pick);
  if (!after) return false;
  const wasInState = before ? before.checked === want : false;
  return after.checked === want && !wasInState;
}
