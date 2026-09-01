import { create } from 'zustand';
import type {
  Page,
  TableData,
  TableRow,
  Column,
  ColumnType,
  CellValue,
  SelectOption,
  ShareRole,
  PageMapData,
  MindmapData,
  FlowData,
  KanbanData,
} from '../types';
import { uid, pickTagColor } from '../lib/id';
import { isEmptyDoc, extractTableIds, remapTableIds, setImageThreadId, mediaUrlOfNode } from '../lib/doc';
import { uploadRecordIdFromUrl, referencesToUrl, sameUpload, uploadKey } from '../lib/uploadRefs';
import {
  selectChildren,
  selectTopLevel,
  selectTemplates,
  selectTrashRoots,
  pageWorkspaceId,
  selectWorkspacePages,
  selectWorkspaceTables,
  selectBreadcrumb,
  selectRowsForTable,
} from '../lib/pageTree';
import { selectMyRole, canEdit, canManageSharing } from '../lib/permissions';
import { planImport, parseDelimited } from '../lib/csv';
import type { ImportPlan } from '../lib/notionImport';
import type { KanbanImportPlan, KanbanUpsertPlan } from '../lib/kanbanIO';
import {
  automationsForFieldChange,
  automationsForRowCreated,
  triggerMatchesFieldChange,
  type Automation,
} from '../lib/automations';
import { buildNextCells } from '../lib/recurrence';
import {
  compileFlow,
  runPlan,
  cellScope,
  checkboxFired,
  filterRose,
  coerceCellWrite,
  indexFlows,
  scheduleDue,
  type Effect,
  type FlowContext,
  type FlowEnv,
  type FlowIndex,
  type FlowListener,
  type FlowLogEntry,
} from '../lib/flow';
import type { FlowNode, FlowTrigger } from '../types';
import { fxResolve } from '../lib/fx';
import { commentsApi } from '../lib/api';

// Resolve a table's automation rules: server field first, localStorage fallback.
function loadAutomationsLocal(tableId: string): Automation[] {
  try {
    const raw = localStorage.getItem(`waypoint:automations:${tableId}`);
    return raw ? (JSON.parse(raw) as Automation[]) : [];
  } catch {
    return [];
  }
}
function resolveAutomations(table: { automations?: Automation[] | null; id: string } | undefined): Automation[] {
  if (!table) return [];
  if (Array.isArray(table.automations) && table.automations.length) return table.automations;
  return loadAutomationsLocal(table.id);
}
// Guard so automation-applied writes don't re-trigger automations (no loops).
let automationRunning = false;

// Cover images persist to `pages.cover` when that field exists; otherwise the
// server echo comes back blank and would wipe the optimistic value (the cover
// "flashes" then vanishes). We mirror covers to localStorage and restore them
// whenever a page record arrives without one, so covers work per-browser even
// before the field is added (then sync once it is).
function localCover(pageId: string): string {
  try {
    return localStorage.getItem(`waypoint:cover:${pageId}`) ?? '';
  } catch {
    return '';
  }
}
function withLocalCover(p: Page): Page {
  return p.cover ? p : { ...p, cover: localCover(p.id) };
}

// The page map (pins + routes) degrades the same way as cover: until the
// `pages.map` JSON field exists the echo drops it, so we mirror to localStorage
// and restore whenever a page arrives without one. Once the field exists the
// server value wins (including a deliberately emptied map).
function localMap(pageId: string): PageMapData | null {
  try {
    const raw = localStorage.getItem(`waypoint:map:${pageId}`);
    return raw ? (JSON.parse(raw) as PageMapData) : null;
  } catch {
    return null;
  }
}
function withLocalMap(p: Page): Page {
  return p.map ? p : { ...p, map: localMap(p.id) };
}

// The mindmap (free-canvas graph) degrades exactly like the map: until the
// `pages.mindmap` JSON field exists the echo drops it, so we mirror to
// localStorage and restore it whenever a page arrives without one. Once the
// field is live the server value wins (including a deliberately emptied graph).
function localMindmap(pageId: string): MindmapData | null {
  try {
    const raw = localStorage.getItem(`waypoint:mindmap:${pageId}`);
    return raw ? (JSON.parse(raw) as MindmapData) : null;
  } catch {
    return null;
  }
}
function withLocalMindmap(p: Page): Page {
  return p.mindmap ? p : { ...p, mindmap: localMindmap(p.id) };
}

// The flow canvas degrades exactly like the mindmap: until the `pages.flow` JSON
// field exists the echo drops it, so we mirror to localStorage and restore it
// whenever a page arrives without one. Once the field is live the server wins.
function localFlow(pageId: string): FlowData | null {
  try {
    const raw = localStorage.getItem(`waypoint:flow:${pageId}`);
    return raw ? (JSON.parse(raw) as FlowData) : null;
  } catch {
    return null;
  }
}
function withLocalFlow(p: Page): Page {
  return p.flow ? p : { ...p, flow: localFlow(p.id) };
}

// The kanban board degrades the same way until the `pages.kanban` field exists.
function localKanban(pageId: string): KanbanData | null {
  try {
    const raw = localStorage.getItem(`waypoint:kanban:${pageId}`);
    return raw ? (JSON.parse(raw) as KanbanData) : null;
  } catch {
    return null;
  }
}
function withLocalKanban(p: Page): Page {
  return p.kanban ? p : { ...p, kanban: localKanban(p.id) };
}

// Same localStorage-mirror fallback for the tier list + default tab, so both
// survive an echo while the pages.tierlist / pages.defaultTab fields aren't in
// the schema yet (PocketBase drops unknown fields on write).
function withLocalTierlist(p: Page): Page {
  if (p.tierlist) return p;
  try {
    const raw = localStorage.getItem(`waypoint:tierlist:${p.id}`);
    return raw ? { ...p, tierlist: JSON.parse(raw) as Page['tierlist'] } : p;
  } catch {
    return p;
  }
}
// And the same for the Currency tab's board.
function withLocalRates(p: Page): Page {
  if (p.rates) return p;
  try {
    const raw = localStorage.getItem(`waypoint:rates:${p.id}`);
    return raw ? { ...p, rates: JSON.parse(raw) as Page['rates'] } : p;
  } catch {
    return p;
  }
}
// And the same for the Sheet tab's grid.
function withLocalSheet(p: Page): Page {
  if (p.sheet) return p;
  try {
    const raw = localStorage.getItem(`waypoint:sheet:${p.id}`);
    return raw ? { ...p, sheet: JSON.parse(raw) as Page['sheet'] } : p;
  } catch {
    return p;
  }
}
// And the same for the deck.
function withLocalCards(p: Page): Page {
  if (p.cards) return p;
  try {
    const raw = localStorage.getItem(`waypoint:cards:${p.id}`);
    return raw ? { ...p, cards: JSON.parse(raw) as Page['cards'] } : p;
  } catch {
    return p;
  }
}
// And the same for the rota.
function withLocalRota(p: Page): Page {
  if (p.rota) return p;
  try {
    const raw = localStorage.getItem(`waypoint:rota:${p.id}`);
    return raw ? { ...p, rota: JSON.parse(raw) as Page['rota'] } : p;
  } catch {
    return p;
  }
}
// And the same for the bracket.
function withLocalBracket(p: Page): Page {
  if (p.bracket) return p;
  try {
    const raw = localStorage.getItem(`waypoint:bracket:${p.id}`);
    return raw ? { ...p, bracket: JSON.parse(raw) as Page['bracket'] } : p;
  } catch {
    return p;
  }
}
// Same mirror for the Photos-tab images, so they survive an echo/reload while the
// pages.photos field isn't in the schema yet (PocketBase drops unknown fields).
function withLocalPhotos(p: Page): Page {
  if (p.photos && p.photos.length) return p;
  try {
    const raw = localStorage.getItem(`waypoint:photos:${p.id}`);
    return raw ? { ...p, photos: JSON.parse(raw) as Page['photos'] } : p;
  } catch {
    return p;
  }
}
// Whether this PocketBase has an optional pages column, resolved once per session.
// undefined = not asked yet (or the check itself failed and should be retried).
//
// `toPage` normalises a missing field to a default ([] or null), so the mapped Page
// can never answer this: `undefined` on the RAW record is the only honest signal.
// A confirmed YES is also remembered in localStorage, because the answer only ever
// moves from missing to present, never back. That is what lets an offline device
// that has seen the column once keep editing.
const pageFieldKnown: Record<string, boolean> = {};
const FIELD_SEEN_PREFIX = 'waypoint:pbfield:';

async function pageColumnExists(pageId: string, field: string): Promise<boolean | null> {
  if (pageFieldKnown[field] !== undefined) return pageFieldKnown[field];
  try {
    if (localStorage.getItem(`${FIELD_SEEN_PREFIX}${field}`)) {
      pageFieldKnown[field] = true;
      return true;
    }
  } catch {
    /* no localStorage, fall through to the network probe */
  }
  try {
    const rec = await pb.collection('pages').getOne(pageId);
    const has = (rec as Record<string, unknown>)[field] !== undefined;
    pageFieldKnown[field] = has;
    if (has) {
      try {
        localStorage.setItem(`${FIELD_SEEN_PREFIX}${field}`, '1');
      } catch {
        /* ignore quota */
      }
    }
    return has;
  } catch {
    return null; // couldn't tell; ask again next time rather than guess
  }
}

// An incoming record must never turn a list we hold into an empty one.
//
// This is the "restore on absent, not on empty" rule from the graceful-degradation
// contract, applied where it actually bites. `photos` and `files` arrive as [] from
// toPage for THREE different reasons: the column is missing, the value came back in
// a shape Array.isArray refuses, or it is genuinely empty. Only the last is a real
// clear, and a real clear always comes from a local write, which marks the field
// pending and updates the mirror, so it still gets through.
//
// Without this, an echo landing a second after an upload wiped the list and the file
// vanished from the tab until a refetch, which is the bug that survived four
// attempts at fixing it upstream. Cheap, total, and it cannot lose data: the worst
// case is a stale entry that the next real write corrects.
function keepNonEmptyLists(local: Page | undefined, incoming: Page): Page {
  if (!local) return incoming;
  // SHORTER, not just empty. The diagnostic showed the real event: a list of 2 was
  // replaced by the pre-upload list of 1, so a guard that only looked for [] never
  // fired. An incoming list that has LOST entries is a stale record overtaking a
  // newer one, which is the whole "it blinks and goes away" bug.
  //
  // A real removal is safe: it is a local write, so keepPendingFields has already
  // held the local (shorter) list while it is in flight, and once it settles both
  // sides agree. The residue is that a delete made on ANOTHER device shows up on the
  // next load rather than instantly, which is a fair price for a file not vanishing
  // as you watch.
  if ((incoming.files?.length ?? 0) < (local.files?.length ?? 0)) incoming.files = local.files;
  if ((incoming.photos?.length ?? 0) < (local.photos?.length ?? 0)) incoming.photos = local.photos;
  return incoming;
}

// The same mirror for Files-tab attachments.
function withLocalFiles(p: Page): Page {
  if (p.files && p.files.length) return p;
  try {
    const raw = localStorage.getItem(`waypoint:files:${p.id}`);
    return raw ? { ...p, files: JSON.parse(raw) as Page['files'] } : p;
  } catch {
    return p;
  }
}
// A rejected save on one of the page's JSON canvases (map, mindmap, flow, kanban,
// tier list) used to reach the console and nowhere else. The store keeps the
// optimistic value, so the work stays on screen until some echo replaces it, and
// then it looks like it vanished by itself. The usual cause is the field's ~2 MB
// ceiling, which a wall of inline images reaches, so name that rather than say
// "failed". Silent while offline: writes are expected to fail there and the
// offline design deliberately keeps the local value without complaining.
function pageFieldWriteFailed(field: string, err: unknown): void {
  console.error(`[data] page ${field} write failed`, err);
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  toast(`Could not save the ${field}. If it holds a lot of images, it may be too big to store.`, 'error');
}

// Flag-gated trace for "the tier list image showed and then went" (turn it on with
// localStorage waypoint:tierdebug = 1). It answers the only question worth asking,
// did OUR write drop the picture or did an incoming record, in one round trip. The
// lesson from the vanishing-files bug was to instrument rather than read the same
// path a third time.
function traceTierlist(where: string, before: Page | undefined, after: Page): void {
  try {
    if (!localStorage.getItem('waypoint:tierdebug')) return;
  } catch {
    return;
  }
  const withImage = (p?: Page) => (p?.tierlist?.items ?? []).filter((i) => i.image).length;
  if (withImage(before) !== withImage(after)) {
    console.error(`[tier] ${where}: images ${withImage(before)} -> ${withImage(after)} on ${after.id}`);
  }
}

function withLocalDefaultTab(p: Page): Page {
  if (p.defaultTab) return p;
  try {
    const raw = localStorage.getItem(`waypoint:defaulttab:${p.id}`);
    return raw ? { ...p, defaultTab: raw } : p;
  } catch {
    return p;
  }
}

// Flow trigger index, rebuilt lazily only when some page's flow changes (the
// dirty flag), so a cell edit is an O(1) map lookup, not a scan of every flow.
let flowIndex: FlowIndex | null = null;
let flowIndexDirty = true;
function markFlowsDirty() {
  flowIndexDirty = true;
}
function getFlowIndex(pages: Record<string, Page>): FlowIndex {
  if (!flowIndex || flowIndexDirty) {
    flowIndex = indexFlows(Object.values(pages));
    flowIndexDirty = false;
  }
  return flowIndex;
}

const flowEnv = (): FlowEnv => ({ now: new Date(), fx: fxResolve, rng: Math.random });

// A bounded, in-memory log of flow firings for the canvas to show ("fired
// 12:04, set Completed on Itinerary/row3"). Not persisted; debuggability, not a
// logging framework. Capped so it can't grow without bound.
export interface FlowRunLog {
  pageId: string;
  at: number;
  trigger: string;
  detail: string[];
}
const flowRunLog: FlowRunLog[] = [];
function saveRunLogLocal(pageId: string) {
  try {
    localStorage.setItem(`waypoint:flowlog:${pageId}`, JSON.stringify(flowRunLog.filter((e) => e.pageId === pageId).slice(0, 20)));
  } catch {
    /* ignore quota */
  }
}
function loadRunLogLocal(pageId: string): FlowRunLog[] {
  try {
    const raw = localStorage.getItem(`waypoint:flowlog:${pageId}`);
    return raw ? (JSON.parse(raw) as FlowRunLog[]) : [];
  } catch {
    return [];
  }
}
function pushRunLog(entry: FlowRunLog) {
  flowRunLog.unshift(entry);
  if (flowRunLog.length > 50) flowRunLog.length = 50;
  saveRunLogLocal(entry.pageId); // mirror so a reload keeps recent history
}
export function flowLogFor(pageId: string): FlowRunLog[] {
  const mem = flowRunLog.filter((e) => e.pageId === pageId);
  const seen = new Set(mem.map((e) => `${e.at}:${e.trigger}`));
  const stored = loadRunLogLocal(pageId).filter((e) => !seen.has(`${e.at}:${e.trigger}`));
  return [...mem, ...stored].slice(0, 50);
}

// In-memory bell notices produced by `notify` flow effects. Lost on reload (same
// as the run log), a documented `notifications` collection would be the move if
// these ever need to survive, but v1 stays in-memory, no PB field.
export interface BellNotice {
  id: string;
  at: number;
  text: string;
  rowId?: string;
  tableId?: string;
}
const flowNotices: BellNotice[] = [];
function pushNotice(n: BellNotice) {
  flowNotices.unshift(n);
  if (flowNotices.length > 50) flowNotices.length = 50;
}
export function flowNoticesAll(): BellNotice[] {
  return flowNotices;
}

function cellEquals(cell: CellValue, target: string | undefined): boolean {
  if (typeof cell === 'boolean') return String(cell) === String(target);
  return String(cell ?? '') === String(target ?? '');
}

// Apply executor Effects with the store actions we already have. Runs under the
// automation guard so a flow-driven write can't re-enter flow evaluation. Cell
// writes pass through coerceCellWrite so a bare id from setExpr lands as a
// proper relation array.
function applyEffects(get: () => DataState, effects: Effect[]): void {
  if (!effects.length) return;
  const colsOf = (tableId: string): Column[] => get().tables[tableId]?.columns ?? [];
  const coerce = (cols: Column[], cells: Record<string, CellValue>): Record<string, CellValue> => {
    const out: Record<string, CellValue> = {};
    for (const [cid, v] of Object.entries(cells)) out[cid] = coerceCellWrite(cols.find((c) => c.id === cid), v);
    return out;
  };
  const writeRow = (rowId: string, cols: Column[], cells: Record<string, CellValue>) => {
    for (const [cid, v] of Object.entries(coerce(cols, cells))) get().setCell(rowId, cid, v);
  };
  automationRunning = true;
  try {
    for (const eff of effects) {
      if (eff.kind === 'setCells') {
        writeRow(eff.rowId, colsOf(eff.tableId), eff.cells);
      } else if (eff.kind === 'createRow') {
        void get().addRow(eff.tableId, coerce(colsOf(eff.tableId), eff.cells));
      } else if (eff.kind === 'matchSetCells') {
        const cols = colsOf(eff.tableId);
        const match = Object.values(get().rows).find((r) => r.table === eff.tableId && cellEquals(r.cells[eff.columnId], eff.value));
        if (match) writeRow(match.id, cols, eff.cells);
      } else if (eff.kind === 'matchAllSetCells') {
        const cols = colsOf(eff.tableId);
        for (const r of Object.values(get().rows)) {
          if (r.table === eff.tableId && cellEquals(r.cells[eff.columnId], eff.value)) writeRow(r.id, cols, eff.cells);
        }
      } else if (eff.kind === 'notify') {
        pushNotice({ id: uid('fn'), at: Date.now(), text: eff.text, rowId: eff.rowId, tableId: eff.tableId });
      } else if (eff.kind === 'comment') {
        // The notify_mentions hook handles email for @mentions in the body; we
        // post with no client-resolved mentions array (the store has no roster).
        // In an encrypted workspace, encrypt the body first (drop it if we can't,
        // never post plaintext), mirroring the comments composer.
        const cws = get().pages[eff.pageId]?.workspace ?? '';
        if (cws && useWorkspace.getState().encryptedEnabled(cws)) {
          void useWorkspaceKeys.getState().encryptForWorkspace(cws, eff.body).then((env) => {
            if (env) commentsApi.create(eff.pageId, env, []).catch((err) => console.error('[flow] comment effect failed', err));
            else toast('automation comment skipped, unlock your vault to post it', 'error');
          });
        } else {
          commentsApi.create(eff.pageId, eff.body, []).catch((err) => console.error('[flow] comment effect failed', err));
        }
      }
    }
  } finally {
    automationRunning = false;
  }
}

// Compile + run one listener's flow from its trigger, apply the effects, log it.
function fireListener(get: () => DataState, l: FlowListener, ctx: FlowContext): void {
  const plan = compileFlow(l.flow);
  if (plan.errors.length) {
    // Surface it in the run history too. A cycle used to fail silently to the
    // console, so the canvas showed nothing at all and the flow just looked dead.
    console.error('[flow] compile error', plan.errors);
    pushRunLog({ pageId: l.pageId, at: Date.now(), trigger: describeTrigger(l.trigger), detail: plan.errors.map((e) => `error: ${e}`) });
    return;
  }
  const branch = plan.triggers.find((t) => t.node.id === l.trigger.id);
  if (!branch) return;
  // Own copy of the variable bag. runPlan MUTATES ctx.vars (a code node assigns
  // its outKey there), and callers build one context and hand it to every
  // listener on the trigger, so without this the second flow starts life holding
  // the first flow's computed variables. Two flows on one table then read each
  // other's intermediates, silently and only when both happen to fire.
  const own: FlowContext = { vars: { ...ctx.vars }, row: ctx.row };
  const { effects, log } = runPlan(branch.steps, l.flow.edges, own, flowEnv());
  if (log.length) pushRunLog({ pageId: l.pageId, at: Date.now(), trigger: describeTrigger(l.trigger), detail: log.map((e) => e.detail) });
  applyEffects(get, effects);
}

function describeTrigger(node: FlowNode): string {
  const t = node.payload as { kind?: string; value?: string };
  if (t.kind === 'rowFieldEquals') return `field = ${t.value ?? ''}`;
  if (t.kind === 'rowFieldFilter') return 'filter rose';
  if (t.kind === 'rowCreated') return 'row created';
  if (t.kind === 'rowDeleted') return 'row deleted';
  if (t.kind === 'pageCheckbox') return 'checkbox';
  if (t.kind === 'schedule') return 'schedule';
  return 'manual';
}

// Build a row context, seeding the reserved `@row` scope key so actions can
// reference the triggering row's id (e.g. a setExpr into a relation column).
function rowCtx(tableId: string, rowId: string, columns: Column[], cells: Record<string, CellValue>): FlowContext {
  return { vars: { ...cellScope(columns, cells), '@row': rowId }, row: { tableId, rowId, cells } };
}

// Trigger entry points, called from the mutation hooks below (already guarded by
// !automationRunning at the call site, so these never run inside an effect).
function runRowFieldFlows(get: () => DataState, tableId: string, rowId: string, columnId: string, value: CellValue): void {
  const listeners = getFlowIndex(get().pages).byTableField.get(tableId);
  if (!listeners?.length) return;
  const row = get().rows[rowId];
  const cells = row?.cells ?? { [columnId]: value };
  const table = get().tables[tableId];
  let ctx: FlowContext | null = null;
  for (const l of listeners) {
    const t = l.trigger.payload as { columnId?: string; value?: string };
    if (t.columnId !== columnId || !cellEquals(value, t.value)) continue;
    // Build the context lazily, once, only if a listener actually matches.
    ctx ??= rowCtx(tableId, rowId, table?.columns ?? [], cells);
    fireListener(get, l, ctx);
  }
}

// rowFieldFilter: fire a flow when its predicate transitions false→true. The
// edge needs the pre-edit cells, so setCell threads `oldCells` in. Bucketed by
// table (not table+column) because a predicate can reference several columns.
function runRowFilterFlows(get: () => DataState, tableId: string, rowId: string, oldCells: Record<string, CellValue>, newCells: Record<string, CellValue>): void {
  const listeners = getFlowIndex(get().pages).byTableFilter.get(tableId);
  if (!listeners?.length) return;
  const cols = get().tables[tableId]?.columns ?? [];
  let ctx: FlowContext | null = null;
  for (const l of listeners) {
    const t = l.trigger.payload as { expr?: string };
    if (!t.expr || !filterRose(t.expr, cols, oldCells, newCells, fxResolve)) continue;
    ctx ??= rowCtx(tableId, rowId, cols, newCells);
    fireListener(get, l, ctx);
  }
}

function runRowCreatedFlows(get: () => DataState, tableId: string, rowId: string, cells: Record<string, CellValue>): void {
  const listeners = getFlowIndex(get().pages).byTableCreate.get(tableId);
  if (!listeners?.length) return;
  const table = get().tables[tableId];
  const ctx = rowCtx(tableId, rowId, table?.columns ?? [], cells);
  for (const l of listeners) fireListener(get, l, ctx);
}

function runRowDeletedFlows(get: () => DataState, tableId: string, rowId: string, cells: Record<string, CellValue>): void {
  const listeners = getFlowIndex(get().pages).byTableDelete.get(tableId);
  if (!listeners?.length) return;
  const table = get().tables[tableId];
  // The row is gone; ctx carries the pre-delete snapshot so the flow can read it.
  const ctx = rowCtx(tableId, rowId, table?.columns ?? [], cells);
  for (const l of listeners) fireListener(get, l, ctx);
}

function runCheckboxFlows(get: () => DataState, pageId: string, oldDoc: unknown, newDoc: unknown): void {
  const listeners = getFlowIndex(get().pages).byPageCheckbox.get(pageId);
  if (!listeners?.length) return;
  for (const l of listeners) {
    const t = l.trigger.payload as { checkboxId?: string; checkboxText?: string; checkboxState?: 'checked' | 'unchecked' };
    if (!t.checkboxId && !t.checkboxText) continue;
    if (!checkboxFired(oldDoc, newDoc, { id: t.checkboxId, text: t.checkboxText }, t.checkboxState ?? 'checked')) continue;
    const checked = (t.checkboxState ?? 'checked') === 'checked';
    const ctx: FlowContext = { vars: { checked: checked ? 1 : 0, text: t.checkboxText ?? '' } };
    fireListener(get, l, ctx);
  }
}

// --- Scheduled flows (the schedule trigger) ---------------------------------
// A schedule trigger fires on the wall clock, so the store ticks it. "Last fired"
// is kept per trigger in localStorage so a daily/weekly flow fires once per slot
// and survives reload. Caveat: this is a per-device, tab-open mechanism, so it
// dedupes on THIS device only; firing while every tab is closed, and a single
// authoritative fire across devices, is the server-cron follow-up (bounded by
// encryption the same way reminders are). Prefer idempotent
// scheduled actions (set an absolute value / matchAll) over increments.
const SCHED_TICK_MS = 60 * 1000;
let scheduleTimer: ReturnType<typeof setInterval> | null = null;

function schedLastFired(key: string): number {
  try {
    const raw = localStorage.getItem(`waypoint:flowsched:${key}`);
    return raw ? Number(raw) || 0 : 0;
  } catch {
    return 0;
  }
}
function saveSchedLastFired(key: string, at: number) {
  try {
    localStorage.setItem(`waypoint:flowsched:${key}`, String(at));
  } catch {
    /* ignore quota */
  }
}

function runScheduledFlows(get: () => DataState): void {
  if (automationRunning) return;
  const scheduled = getFlowIndex(get().pages).scheduled;
  if (!scheduled.length) return;
  const now = Date.now();
  for (const l of scheduled) {
    const t = l.trigger.payload as FlowTrigger;
    const key = `${l.pageId}:${l.trigger.id}`;
    if (!scheduleDue(t, schedLastFired(key), now)) continue;
    saveSchedLastFired(key, now);
    // A schedule run has no triggering row; actions target a table or a page.
    fireListener(get, l, { vars: {} });
  }
}

function startScheduleTick(get: () => DataState) {
  if (scheduleTimer || typeof setInterval !== 'function') return;
  runScheduledFlows(get); // catch up a missed slot on open
  scheduleTimer = setInterval(() => runScheduledFlows(get), SCHED_TICK_MS);
}
function stopScheduleTick() {
  if (scheduleTimer) {
    clearInterval(scheduleTimer);
    scheduleTimer = null;
  }
}

// Form tables carry a `formKey` so /form:<key> blocks can find-or-reuse them.
// Same graceful-echo story as cover/map: until the `tables.formKey` field exists
// the echo drops it, so we mirror to localStorage and restore on hydrate/echo.
function localFormKey(tableId: string): string {
  try {
    return localStorage.getItem(`waypoint:formkey:${tableId}`) ?? '';
  } catch {
    return '';
  }
}
function saveFormKey(tableId: string, key: string): void {
  try {
    if (key) localStorage.setItem(`waypoint:formkey:${tableId}`, key);
  } catch {
    /* ignore quota */
  }
}
function withLocalFormKey(t: TableData): TableData {
  return t.formKey ? t : { ...t, formKey: localFormKey(t.id) || undefined };
}

// Sub-item parent links degrade the same way: if the `table_rows.parent` field
// isn't in the schema yet, the echo drops it, so we mirror to localStorage and
// restore on hydrate/echo until the field exists (then it syncs for real).
function localRowParent(rowId: string): string {
  try {
    return localStorage.getItem(`waypoint:rowparent:${rowId}`) ?? '';
  } catch {
    return '';
  }
}
function saveRowParent(rowId: string, parent: string): void {
  try {
    if (parent) localStorage.setItem(`waypoint:rowparent:${rowId}`, parent);
    else localStorage.removeItem(`waypoint:rowparent:${rowId}`);
  } catch {
    /* ignore quota */
  }
}
function withLocalParent(r: TableRow): TableRow {
  return r.parent ? r : { ...r, parent: localRowParent(r.id) };
}

// Reactions (emoji votes) degrade like cover/parent: until the `table_rows.reactions`
// JSON field exists the server echo drops them, so we mirror to localStorage and
// restore whenever a row arrives without one. A row whose field is present but
// genuinely empty comes back as {} (truthy) and is left alone; only a missing
// field (null) triggers the restore. Once the field exists, votes sync for real
// across clients.
import { toggleReaction as toggleReactionMap, type ReactionMap } from '../lib/reactions';
function localReactions(rowId: string): ReactionMap | null {
  try {
    const raw = localStorage.getItem(`waypoint:reactions:${rowId}`);
    return raw ? (JSON.parse(raw) as ReactionMap) : null;
  } catch {
    return null;
  }
}
function saveReactions(rowId: string, reactions: ReactionMap): void {
  try {
    localStorage.setItem(`waypoint:reactions:${rowId}`, JSON.stringify(reactions));
  } catch {
    /* ignore quota */
  }
}
function withLocalReactions(r: TableRow): TableRow {
  return r.reactions ? r : { ...r, reactions: localReactions(r.id) };
}
// Compose the two row restorers so hydrate + every echo apply both.
function hydrateRow(r: TableRow): TableRow {
  return withLocalReactions(withLocalParent(r));
}
import { pagesApi, tablesApi, rowsApi, workspacesApi, workspaceMembersApi, workspaceKeysApi, uploadsApi, fileTrashApi, setUploadWorkspace } from '../lib/api';
import { maybeSnapshot } from '../lib/versions';
import { useWorkspace } from './useWorkspace';
import { useVault } from './useVault';
import { isImageIcon } from '../lib/pageIcon';
import { processImageFile } from '../lib/image';
import { pb } from '../lib/pocketbase';
import type { RecordModel } from 'pocketbase';
import { toPage, toTable, toRow } from '../lib/api';
import { saveViewConfig, buildTablePreset, defaultViewConfig, rowTitle, type TablePreset } from '../lib/tableQuery';
import { buildCampaignBundle, relationPatchesFor, type CampaignKey } from '../lib/campaign';
import { characterDoc, classIcon, type CharacterSheet } from '../lib/character';
import { STARTERS } from '../lib/starters';
import { appendCapture, appendImage } from '../lib/capture';
import { isEnvelope, displayTitle } from '../lib/crypto';
import { splitCells, ENC_KEY } from '../lib/cellCrypto';
import { saveDataset, loadDataset } from '../lib/offlineCache';
import { clearLocalPageDoc, markForceSeed } from '../lib/collab';
import { remapDeep, orderPagesByParent, deadTableRemaps, type BackupFile, type RestoreCounts, type RestoreCreated, type TableSnapshot } from '../lib/restoreBackup';
import {
  collectMovedSet, descendantPageIds, relationSeverances, neutralizeCrossRefs, movedIdsOf,
  saveMoveSnapshot, loadMoveSnapshot, clearMoveSnapshot, savePendingMove, loadPendingMove, type MoveSnapshot,
} from '../lib/turnIntoWorkspace';
import { useWorkspaceKeys } from './useWorkspaceKeys';
import { toast } from './useToast';
import { beginProseWrite, endProseWrite, reconcileProseEcho, resetProseWrites, beginWrite, endWrite, isWriting, isStaleRecord, keepPendingFields } from '../lib/proseSync';
import { loadLastPage, loadLanding } from '../lib/landing';
import { fetchRates, setRates, ratesAreStale } from '../lib/fx';

// Reset a page's Yjs collab state (drop its snapshot + relayed updates) so the
// next time it opens, the shared doc re-seeds from the page's saved `content`.
// Needed after a DIRECT content write to a page that isn't open in an editor
// (quick capture), whose stale shared doc would otherwise never learn of the
// change and would then overwrite it. Best-effort: the content is already saved,
// so the worst case is the note shows on the next reseed, never data loss.
async function resetPageCollab(pageId: string): Promise<void> {
  try {
    // Flush any pending debounced content write for this page FIRST, so the new
    // content is on the server before we reset collab; otherwise a reopen before that
    // debounce fired would reseed from the pre-write content (the debounce race). This
    // runs setPageContent's own write, which holds the persist-ready value (an envelope
    // on an encrypted page), so it's encryption-safe and covers EVERY out-of-editor
    // writer, not just attachToPage.
    await flushWrite(`page-content-${pageId}`);
    // Clear ALL THREE places the stale shared doc hides, or the change gets undone on
    // next open: the server snapshot (pages.ydoc) here, and the LOCAL IndexedDB doc +
    // the server relay log (yupdates) via dropPageYUpdates (which also force-seeds).
    await pagesApi.update(pageId, { ydoc: '' });
    await dropPageYUpdates(pageId);
  } catch {
    /* the content write stands on its own; a later open still reseeds from it */
  }
  // Reconnect the active page's live collab so it reseeds from the just-written
  // content now, instead of showing the stale pre-write doc until a hard refresh.
  useData.getState().bumpPageCollab(pageId);
}

// The CLIENT-SIDE half of a collab reset: the browser's LOCAL IndexedDB doc plus the
// server `yupdates` relay rows (a different collection from `pages`, so it stays
// separate from the `ydoc: ''` snapshot clear). Used by resetPageCollab AND directly
// by the workspace move, which folds `ydoc: ''` into its single per-page write instead
// of firing resetPageCollab's separate page update: PocketBase's update is
// read-modify-write, so two concurrent updates to the SAME page race and one silently
// clobbers the other's fields (that stranded the converting page's workspace change).
// Clearing the LOCAL doc here is load-bearing: without it, connect() opens local-first,
// loads the stale local doc, and pushes it back up instead of reseeding from content,
// undoing the write (the "images added via a tab vanished" class). So every reset path
// clears all three layers through here + the snapshot clear.
async function dropPageYUpdates(pageId: string): Promise<void> {
  await clearLocalPageDoc(pageId); // never rejects; the third hiding place
  markForceSeed(pageId); // and flag the next connect() to reseed from content, even if the delete above was blocked
  try {
    const rows = await pb.collection('yupdates').getFullList<{ id: string }>({ filter: `page="${pageId}"` });
    await Promise.all(rows.map((r) => pb.collection('yupdates').delete(r.id).catch(() => {})));
  } catch {
    /* best-effort; a later open still reseeds from the saved content */
  }
}

// Persist a table's `columns` with the same in-flight-write guard cells/titles use.
// Column names and select-option labels are typed text, so a realtime echo landing
// mid-edit would otherwise revert them (the tables echo reconciles the whole
// `columns` array). Every columns writer routes through here so none can bypass the
// guard. Debounced + collapsed per table (last write wins), matching the optimistic
// store update each caller already applied.
function persistColumns(tableId: string, columns: Column[], label: string): void {
  const seq = beginWrite(tableId, 'columns');
  debounceWrite(`table-cols-${tableId}`, () => {
    tablesApi
      .update(tableId, { columns })
      .catch((err) => console.error(`[data] ${label} failed`, err))
      .finally(() => endWrite(tableId, 'columns', seq));
  });
}

// ---------------------------------------------------------------------------
// Data store
// ---------------------------------------------------------------------------
// Holds the in-memory mirror of pages / tables / rows. Mutations are optimistic:
// update local state immediately for a snappy UI, fire the network write, and
// let the realtime SSE echo reconcile the canonical server value back in. If a
// write fails we re-hydrate that slice to avoid drift.
//
// Realtime: we subscribe to the three collections with '*'. PocketBase pushes
// { action: 'create'|'update'|'delete', record } over SSE. Because our local
// writes also come back as echoes, applying them is idempotent (we replace by
// id), so there's no double-apply problem.

interface DataState {
  pages: Record<string, Page>;
  tables: Record<string, TableData>;
  rows: Record<string, TableRow>; // keyed by row id
  loaded: boolean;
  loadError: string | null;
  activePageId: string | null;
  // Most recent undoable structural action (trash / move), for the undo toast.
  lastAction: { kind: 'trash' | 'move'; label: string; at: number; undo: () => void } | null;
  // A just-completed "turn into workspace", surfaced as a Revert / Accept notice
  // until the user chooses (it doesn't auto-dismiss, unlike the undo toast).
  pendingWorkspaceMove: { opId: string; label: string } | null;

  hydrate: () => Promise<void>;
  subscribeRealtime: () => Promise<void>;
  unsubscribeRealtime: () => Promise<void>;
  teardown: () => void;

  setActivePage: (id: string | null) => void;
  // After opening a page from search, the text to scroll to and flash. The editor
  // consumes and clears it once it has found the spot.
  pendingFocus: { pageId: string; text: string } | null;
  requestFocus: (pageId: string, text: string) => void;
  clearFocus: () => void;
  // The inline-comment thread currently open, anchored at a screen point.
  commentThread: { threadId: string; top: number; left: number } | null;
  openCommentThread: (threadId: string, top: number, left: number) => void;
  closeCommentThread: () => void;
  // The page comments rail is open (desktop), so floating UI clears it.
  commentsOpen: boolean;
  setCommentsOpen: (open: boolean) => void;
  // Comment count per inline thread on the active page, for the in-text badges.
  commentCounts: Record<string, number>;
  setCommentCounts: (counts: Record<string, number>) => void;
  pendingCommentsPage: string | null;
  requestPageComments: (pageId: string) => void;
  clearPendingComments: () => void;
  // A request to switch a page's view tab from elsewhere (e.g. the /flow slash
  // command). PageView consumes it for the matching page, then clears it.
  pendingPageTab: { pageId: string; tab: 'notes' | 'kanban' | 'map' | 'mindmap' | 'links' | 'flow' | 'itinerary' | 'calendar' | 'budget' | 'moodboard' | 'files' | 'tierlist' | 'photos' } | null;
  requestPageTab: (pageId: string, tab: 'notes' | 'kanban' | 'map' | 'mindmap' | 'links' | 'flow' | 'itinerary' | 'calendar' | 'budget' | 'moodboard' | 'files' | 'tierlist' | 'photos') => void;
  clearPendingPageTab: () => void;
  undoLast: () => void;
  dismissLastAction: () => void;

  // pages
  createPage: (parentId: string, activate?: boolean) => Promise<string | null>;
  // Build a character-sheet page from the /character form and open it. The sheet
  // rides in a characterSheet block; the page is droppable onto a mindmap.
  createCharacterPage: (data: CharacterSheet) => Promise<string | null>;
  // First-run starter pages (lib/starters), spawn a populated page by key.
  createStarterPage: (starterKey: string) => Promise<string | null>;
  // Build a tour page with live demo tables embedded, to show what's possible.
  createDemoPage: () => Promise<string | null>;
  // Build a domain starter page (trip, sprint, dnd, family, weekly) with the
  // right preset tables embedded. Returns the new page id.
  createTemplatePage: (key: string) => Promise<string | null>;
  // Import a parsed Notion export: a workspace per top folder, pages keeping their
  // subpage tree, databases as tables. Returns what it created.
  importNotion: (plan: ImportPlan) => Promise<{ workspaces: number; pages: number; tables: number; images: number }>;
  // Two-tap capture: append a line as a checkbox in the Inbox page (created on
  // first use), without opening the editor. Returns the inbox page id.
  captureToInbox: (text: string) => Promise<string | null>;
  // Same, but drops a photo (data URL) into the Inbox as an image block.
  captureImageToInbox: (dataUrl: string) => Promise<string | null>;
  // Open (or create) today's date as a page, for the daily-note habit.
  openDailyNote: () => Promise<string | null>;
  duplicatePage: (pageId: string, parentOverride?: string, rename?: boolean) => Promise<string | null>;
  setPageTemplate: (pageId: string, value: boolean) => void;
  // Turn a public read-only link on/off. Returns the new token (or null when off).
  setPagePublic: (pageId: string, on: boolean) => Promise<string | null>;
  publishShared: (workspaceId: string, title: string, doc: object) => Promise<{ pageId: string; token: string } | null>;
  updateShared: (pageId: string, title: string, doc: object) => Promise<void>;
  unpublishShared: (pageId: string) => Promise<void>;
  setPageCover: (pageId: string, cover: string) => void;
  setPageMap: (pageId: string, data: PageMapData) => void;
  setPageMindmap: (pageId: string, data: MindmapData) => void;
  setPageFlow: (pageId: string, data: FlowData) => void;
  setPageKanban: (pageId: string, data: KanbanData) => void;
  setPageTierlist: (pageId: string, data: import('../lib/tierList').TierListData) => void;
  setPageRates: (pageId: string, data: import('../lib/fxBoard').FxBoardData) => void;
  // The Sheet tab's grid. Same deal as rates: refuses to write when the column is
  // known missing, rather than leaving a spreadsheet that exists in one browser.
  // Assign someone to a row AND tell them, in one action. Writes the person
  // cell, then posts a comment @-mentioning them, which is what the existing
  // notify_mentions hook emails on and what the in-app bell already watches.
  // Reusing that path rather than adding a second notification channel is the
  // point: one transport, already proven, already handles encryption.
  assignAndNotify: (rowId: string, columnId: string, userIds: string[], note?: string) => Promise<boolean>;
  setPageSheet: (pageId: string, data: import('../lib/sheet').SheetData) => void;
  setPageCards: (pageId: string, data: import('../lib/srs').Deck) => void;
  setPageRota: (pageId: string, data: import('../lib/rota').RotaData) => void;
  setPageBracket: (pageId: string, data: import('../lib/bracket').BracketData) => void;
  setPagePhotos: (pageId: string, photos: Page['photos']) => void; // Photos-tab images (dedicated field, not the page body)
  // The same write, awaited, reporting whether the SERVER actually kept it. Use this
  // before doing anything destructive on the strength of it: `photos` is an optional
  // field, so a collection without it drops the value silently and the localStorage
  // mirror makes the UI look fine while the only durable copy is one browser.
  persistPagePhotos: (pageId: string, photos: Page['photos']) => Promise<boolean>;
  // Files-tab attachments, the sibling of the two above. A file added from the Files
  // tab lands here instead of being appended to the page BODY, which is what used to
  // make it turn up in your Notes.
  setPageFiles: (pageId: string, files: Page['files']) => void;
  persistPageFiles: (pageId: string, files: Page['files']) => Promise<boolean>;
  // Does this server have the pages.files column? Answered once per session from a
  // RAW record, and asked BEFORE an upload starts, so a server without it refuses up
  // front instead of uploading a blob and then discovering there is nowhere to put a
  // reference to it. That ordering is what stops an orphan being created at all.
  pageFilesFieldExists: (pageId: string) => Promise<boolean>;
  // Does this server have the pages.rates column? Asked BEFORE the Currency tab lets
  // anyone type, and unknown counts as NO: see the implementation for why a board
  // that only reaches localStorage is worse than a read-only tab.
  pageRatesFieldExists: (pageId: string) => Promise<boolean>;
  pageSheetFieldExists: (pageId: string) => Promise<boolean>;
  pageCardsFieldExists: (pageId: string) => Promise<boolean>;
  pageRotaFieldExists: (pageId: string) => Promise<boolean>;
  pageBracketFieldExists: (pageId: string) => Promise<boolean>;
  setPageDefaultTab: (pageId: string, tab: string) => void;
  // Create the table that backs a page's Kanban board (cards are rows), migrating
  // any old inline cards, and store its id on the page. Returns the table id.
  createKanbanBoard: (pageId: string) => Promise<string | null>;
  // Build a fresh table-backed board from an imported bundle plan (new table,
  // board view, one row per card with its page body), then point the page at it.
  // Non-destructive: any existing board table is left in place, just unlinked.
  importKanbanBoard: (pageId: string, plan: KanbanImportPlan) => Promise<string | null>;
  restoreBackup: (backup: BackupFile) => Promise<RestoreCounts & { created: RestoreCreated }>;
  // Undo a restore: delete exactly the pages/tables/rows it created, nothing else.
  undoRestore: (created: RestoreCreated) => Promise<void>;
  // Promote a page + its whole sub-page tree into its own new top-level workspace:
  // re-stamp the workspace on every moved page/table/row, clear the root's parent,
  // mirror the source's encryption (re-encrypting content/title/cells under a fresh
  // key), sever the page links + relations pointing INTO the moved set from pages
  // OUTSIDE it, and reset each moved page's collab. Reversible via revertWorkspaceMove
  // until accepted. Returns a reason when it stops (locked vault, no key, etc.).
  turnPageIntoWorkspace: (pageId: string) => Promise<{ ok: boolean; reason?: string }>;
  // Move a page + its whole sub-page tree into an EXISTING workspace, nested under a
  // chosen parent page there (parentPageId '' = top level). Re-encrypts content/title/
  // cells for the target's encryption state (plaintext or its key), severs the page
  // links + relations pointing INTO the moved set from pages OUTSIDE it, and resets
  // each moved page's collab. Reversible via revertWorkspaceMove until accepted.
  movePageToWorkspace: (pageId: string, targetWorkspaceId: string, parentPageId: string) => Promise<{ ok: boolean; reason?: string }>;
  // Undo the pending turnPageIntoWorkspace: move the tree back, restore the root
  // parent, re-encrypt under the old key, restore every severed reference, then delete
  // the created workspace + its keys. Accept keeps the move and drops the snapshot.
  revertWorkspaceMove: () => Promise<void>;
  acceptWorkspaceMove: () => void;
  // Merge an imported bundle into the page's existing board: update rows the plan
  // matched (by card id or title), add the rest, and fold in any new columns/
  // options. Nothing is deleted. Returns the board table id.
  upsertKanbanBoard: (pageId: string, plan: KanbanUpsertPlan) => Promise<string | null>;
  // Run a flow's entry node (a widget/manual trigger) on demand. Applies the
  // effects unless dryRun, and returns them so the canvas can show a test run.
  runFlow: (pageId: string, nodeId: string, opts?: { dryRun?: boolean }) => { effects: Effect[]; log: FlowLogEntry[] };
  // Fire pageCheckbox flows from decrypted docs. Encrypted pages keep only the
  // envelope in the store, so setPageContent can't scan them, the editor (which
  // holds the plaintext) calls this directly after a checkbox toggle.
  firePageCheckboxFlows: (pageId: string, oldDoc: unknown, newDoc: unknown) => void;
  trashPage: (id: string) => Promise<void>; // soft delete (recoverable)
  restorePage: (id: string) => Promise<void>; // bring back from trash
  deletePage: (id: string) => Promise<void>; // permanent delete (from trash)
  emptyTrash: () => Promise<void>; // permanently delete everything in the trash
  sweepOldTrash: (maxAgeDays: number) => Promise<number>; // purge trash older than N days; returns the count
  // Hard-delete every page/table/row stamped with a workspace, from the store and
  // the DB. Used when a workspace is deleted, PB nulls the workspace field on
  // delete (no cascade), so these must be removed explicitly or they orphan into
  // the default bucket. Call BEFORE deleting the workspace record.
  purgeWorkspace: (workspaceId: string) => Promise<void>;
  // Delete any of these tables that are no longer referenced by a live page
  // (their embed or Kanban page was removed). Targeted, never a global sweep, so
  // an in-flight table is safe. Skips encrypted workspaces where we can't read
  // page content to confirm a table is unreferenced.
  gcOrphanTables: (candidateIds: string[]) => void;
  renamePage: (id: string, title: string) => void;
  // Replace encrypted page titles in memory with their decrypted plaintext (the
  // workspace-key store computes the map). In-memory only; never persisted.
  applyTitleDecryptions: (updates: Record<string, string>) => void;
  setPageIcon: (id: string, icon: string) => void;
  setPageContent: (id: string, content: unknown) => void;
  // Append ready-made TipTap block nodes (an image / audio / file block) to a page's
  // body from OUTSIDE the editor (the Files tab's own upload). Decrypts, appends, and
  // re-encrypts on an encrypted page (never writes plaintext; aborts if the vault is
  // locked), then resets collab so the block shows up next time the page is opened.
  attachToPage: (pageId: string, blocks: unknown[]) => Promise<boolean>;
  // Seed a BRAND-NEW page's body from outside the editor (mindmap convert-to-page,
  // selection -> subpage). Encrypts for the workspace first, so a seed can't land as
  // plaintext in an encrypted workspace the way a raw setPageContent did. Returns
  // false WITHOUT writing when the vault is locked, and the caller must then keep the
  // source text where it is (don't swap the node, don't delete the selection) rather
  // than destroy the only remaining copy. No resetPageCollab: the page is new, so
  // there is no stale shared doc to defeat.
  seedPageContent: (pageId: string, doc: object) => Promise<boolean>;
  // Write a comment thread id onto a body image node (decrypt -> set -> re-encrypt,
  // then reset collab), so a comment started from the Moodboard lightbox (where the
  // editor isn't mounted) anchors to the same image the editor badges. Called only
  // once the first comment is actually posted, so opening then closing empty writes
  // nothing. False if the image isn't in the body or the vault is locked.
  anchorImageThread: (pageId: string, src: string, threadId: string) => Promise<boolean>;
  // Drop a page's Yjs collab state so it re-seeds from `content` on next open. Used
  // after a direct content write to a closed page (capture) and after re-encrypting
  // a page's content (lock / workspace migration), so a stale or plaintext shared
  // doc can't overwrite the change or leave readable artifacts behind.
  resetPageCollab: (pageId: string) => void;
  // Bumped to force the active page's live collab to reconnect + reseed from content
  // after an out-of-editor content write (attachToPage / detachFromPage / capture),
  // so the shown doc isn't the stale pre-write one until a hard refresh.
  pageCollabNonce: Record<string, number>;
  bumpPageCollab: (pageId: string) => void;
  // Remove image / gallery blocks matching a url from a page's body (the Photos/Files
  // tabs' delete). Decrypt -> remove -> re-encrypt on an encrypted page, then reset
  // collab, the same safe out-of-editor content-write path attachToPage uses.
  detachFromPage: (pageId: string, url: string) => Promise<boolean>;
  // Remove many body images/gallery items in ONE content rewrite + reseed (used to
  // lift Photos-tab images out of the Notes body when migrating them to pages.photos).
  detachManyFromPage: (pageId: string, urls: string[]) => Promise<number>;
  // Delete the uploaded file itself, not just its use on a page. Refuses while
  // anything still references it and reports what, because the same url is
  // deliberately reused across pages. Admin-only in the UI; the server rule is
  // the real gate.
  purgeUpload: (url: string) => Promise<{ ok: boolean; blockedBy: string[] }>;
  // Queue a file an ordinary member removed, for an admin to clear later.
  trashFile: (url: string, name: string, pageId: string) => Promise<void>;
  movePage: (id: string, newParentId: string, newOrder: number) => void;

  // sharing / permissions
  setPageVisibility: (id: string, visibility: 'workspace' | 'private') => void;
  setShare: (pageId: string, userId: string, role: ShareRole) => void; // add or change a member's role
  removeShare: (pageId: string, userId: string) => void;

  // tables
  createTable: (name: string) => Promise<string | null>;
  createTableFromData: (name: string, headers: string[], rows: string[][]) => Promise<string | null>;
  createTablePreset: (preset: TablePreset) => Promise<string | null>;
  createCampaignBundle: () => Promise<string[]>; // the seven linked TTRPG tables, in display order
  findOrCreateFormTable: (key: string) => Promise<string | null>; // /form:<key>, reuse a key's table or make one
  renameTable: (id: string, name: string) => void;
  setTableView: (tableId: string, view: object) => void;
  setTableAutomations: (tableId: string, rules: Automation[]) => void;
  refreshRates: () => Promise<void>; // pull live currency rates for fx() formulas
  addColumn: (tableId: string, type: ColumnType) => void;
  importRows: (tableId: string, parsed: { headers: string[]; rows: string[][] }, replace?: boolean) => Promise<number>;
  // Snapshot a table's rows + columns + view, so a destructive CSV "replace"
  // import can be undone by restoring it.
  captureTableSnapshot: (tableId: string) => TableSnapshot;
  restoreTableSnapshot: (tableId: string, snapshot: TableSnapshot) => Promise<void>;
  updateColumn: (tableId: string, columnId: string, patch: Partial<Column>) => void;
  moveColumn: (tableId: string, columnId: string, dir: 'left' | 'right') => void;
  deleteColumn: (tableId: string, columnId: string) => void;
  addSelectOption: (tableId: string, columnId: string, label: string) => SelectOption | null;
  setSelectOptionColor: (tableId: string, columnId: string, optionId: string, color: string) => void;
  toggleSelectOptionDone: (tableId: string, columnId: string, optionId: string) => void;
  removeSelectOption: (tableId: string, columnId: string, optionId: string) => void;
  renameSelectOption: (tableId: string, columnId: string, optionId: string, label: string) => void;
  // Move one select option before another (or to the end when before is null).
  // Reorders the board's columns, which follow the option order.
  moveSelectOption: (tableId: string, columnId: string, optionId: string, beforeId: string | null) => void;

  // rows
  addRow: (tableId: string, initialCells?: Record<string, CellValue>, parentId?: string) => Promise<string | null>;
  addSubRow: (parentRowId: string) => Promise<string | null>;
  setRowParent: (rowId: string, parentId: string) => void;
  deleteRow: (rowId: string) => Promise<void>;
  setCell: (rowId: string, columnId: string, value: CellValue) => void;
  // Replace encrypted row cells in memory with their decrypted object (computed by
  // the workspace-key store). In-memory only; never persisted.
  applyCellDecryptions: (updates: Record<string, Record<string, CellValue>>) => void;
  // The row-body twin: swap in the decrypted doc and drop the envelope, so every
  // reader sees a normal body. In-memory only; never persisted.
  applyRowContentDecryptions: (updates: Record<string, object>) => void;
  // Persist already-encrypted cells (operational fields + the __enc blob) without
  // touching in-memory cells, used by the "encrypt existing pages" migration.
  migrateRowCells: (rowId: string, cells: Record<string, CellValue>) => void;
  // The body twin: persist a row body exactly as given (an envelope when encrypting,
  // a plain doc when decrypting), leaving the in-memory copy alone so the drawer
  // keeps rendering it.
  migrateRowContent: (rowId: string, content: string | object) => void;
  setRowContent: (rowId: string, content: object) => void;
  toggleReaction: (rowId: string, emoji: string, userId: string) => void;

  // Row detail ("open as page") overlay
  openRowId: string | null;
  openRow: (rowId: string) => void;
  closeRow: () => void;
}

// Stamp new records with the active workspace (feature 4). Returns '' for the
// synthesized pre-migration default, sending '__default__' to a real relation
// field would 400, and an empty workspace correctly falls into the default
// bucket until the migration backfills it.
// Walk a TipTap doc and point each imported pageLink (a notionId, no pageId yet)
// at the page that notion id became. Mutates in place; returns whether it changed.
function resolvePageLinks(node: unknown, idMap: Map<string, string>): boolean {
  if (!node || typeof node !== 'object') return false;
  const n = node as { type?: string; attrs?: Record<string, unknown>; content?: unknown[] };
  let changed = false;
  if ((n.type === 'pageLink' || n.type === 'pageRef') && n.attrs && n.attrs.notionId && !n.attrs.pageId) {
    const target = idMap.get(n.attrs.notionId as string);
    if (target) {
      n.attrs.pageId = target;
      changed = true;
    }
  }
  if (Array.isArray(n.content)) for (const c of n.content) if (resolvePageLinks(c, idMap)) changed = true;
  return changed;
}

// Fill an imported image block's `src` from the uploaded url keyed by its `importKey`
// (set by the Notion parser), then drop the transient key. An unresolved image is
// left with an empty src (rare: the upload failed), harmless.
function resolveImportedImages(node: unknown, urls: Map<string, string>): boolean {
  if (!node || typeof node !== 'object') return false;
  const n = node as { type?: string; attrs?: Record<string, unknown>; content?: unknown[] };
  let changed = false;
  if (n.type === 'image' && n.attrs && n.attrs.importKey) {
    const url = urls.get(n.attrs.importKey as string);
    if (url) n.attrs.src = url;
    delete n.attrs.importKey;
    changed = true;
  }
  if (Array.isArray(n.content)) for (const c of n.content) if (resolveImportedImages(c, urls)) changed = true;
  return changed;
}

// 16 random bytes as hex, unguessable enough for a "anyone with the link" token.
function publicToken(): string {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

// Parent sentinel for stand-alone shared pages (a shared recipe). Not a real page
// id, so the page never shows in the sidebar tree or search, but it still exists
// on the server as a plaintext, public-by-token record.
export const SHARED_PARENT = '__shared__';

function activeWsForWrite(): string {
  const { activeWorkspaceId, usingDefault } = useWorkspace.getState();
  return !usingDefault && activeWorkspaceId && activeWorkspaceId !== '__default__' ? activeWorkspaceId : '';
}

// Keep the uploads layer told which workspace new files belong to. An unstamped
// upload can never be deleted through the app (the delete rule requires a
// workspace), so this has to track the active workspace rather than be passed at
// each of upload()'s many call sites.
setUploadWorkspace(activeWsForWrite());
useWorkspace.subscribe(() => setUploadWorkspace(activeWsForWrite()));

// What to persist for a row's cells. In an encrypted workspace, the operational
// fields (reminder datetime, person ids, __notified sentinels) stay plaintext so
// the server reminder cron keeps working, and everything else is encrypted under
// `__enc`. Returns null when the key isn't available, the caller must then NOT
// write, so secret values never leak into an encrypted workspace.
async function cellsToPersist(
  workspaceId: string,
  cells: Record<string, CellValue>,
  columns: Column[],
): Promise<Record<string, CellValue> | null> {
  if (workspaceId && useWorkspace.getState().encryptedEnabled(workspaceId)) {
    const { operational, secret } = splitCells(cells, columns);
    if (Object.keys(secret).length === 0) return operational; // nothing secret to hide
    const env = await useWorkspaceKeys.getState().encryptForWorkspace(workspaceId, secret);
    if (!env) return null;
    return { ...operational, [ENC_KEY]: env };
  }
  return cells;
}

// Remember the envelope we are about to persist, so this row's own realtime echo
// is recognised as ours and the decrypted cells in memory survive it. Every write
// mints a new envelope (fresh GCM IV), so without this our own echo is
// indistinguishable from another device's edit.
function noteOwnCellsEnvelope(rowId: string, toStore: Record<string, CellValue>): void {
  const env = toStore[ENC_KEY];
  if (typeof env === 'string') useWorkspaceKeys.getState().noteCellsEnvelope(rowId, env);
}

// Writing a row body as ciphertext is the ONE change in this release that puts a new
// SHAPE into the database, and it is the only one that cannot be undone by rolling
// the client back. Two reasons it is off until you deliberately turn it on:
//   1. A client older than 0.176 maps an `enc:v1:` body to null, shows an empty
//      editor, and can save that emptiness straight over the ciphertext. Rolling the
//      client BACK therefore makes it worse, not better.
//   2. Row bodies have no version history. pages have page_versions; table_rows have
//      nothing, so a clobbered card body is gone for good.
// The READ path ships enabled (contentEnc handling, decryptRowBodies, the RowDetail
// notice, setRowContent's refusal): that is pure defence and can only prevent loss.
// Only the WRITE waits. Turn it on once every client is updated and pb_data is
// backed up:  localStorage.setItem('waypoint:encryptrowbodies', '1')
function encryptRowBodiesEnabled(): boolean {
  try {
    return localStorage.getItem('waypoint:encryptrowbodies') === '1';
  } catch {
    return false; // private mode: stay on the safe side
  }
}

// The same claim for a row BODY envelope, so the echo of our own body write keeps
// the decrypted doc instead of re-locking the card we are typing in.
function noteOwnRowBodyEnvelope(rowId: string, env: string): void {
  useWorkspaceKeys.getState().noteRowBodyEnvelope(rowId, env);
}

// Typing into a card body with the vault locked persists nothing. Say it once every
// few seconds rather than on every debounce settle, so a long note warns without
// stacking toasts.
let lastBodyWarn = 0;
function warnUnsavedBody(): void {
  const now = Date.now();
  if (now - lastBodyWarn < 5000) return;
  lastBodyWarn = now;
  toast('Unlock your vault to save these notes. Nothing is being saved right now.', 'error');
}

// Per-collection write debouncers so rapid edits (typing in a cell, dragging a
// column resize) coalesce into fewer network writes.
const writeTimers = new Map<string, ReturnType<typeof setTimeout>>();
// When the burst started for each key, so maxWait can force a flush mid-typing.
const writeFirstAt = new Map<string, number>();
// The pending fn per key, so a specific write can be run early via flushWrite().
const writeFns = new Map<string, () => void | Promise<unknown>>();

// Debounced write that also honours a maxWait: it saves `delay` ms after the last
// call (save-on-pause), but if a continuous burst runs past `maxWait` it flushes
// anyway, so a fast typist's text syncs every second or so instead of only on stop.
function debounceWrite(key: string, fn: () => void | Promise<unknown>, delay = 350, maxWait = 0) {
  const existing = writeTimers.get(key);
  if (existing) clearTimeout(existing);
  writeFns.set(key, fn);
  if (maxWait > 0) {
    const first = writeFirstAt.get(key);
    const now = Date.now();
    if (first === undefined) {
      writeFirstAt.set(key, now);
    } else if (now - first >= maxWait) {
      writeFirstAt.delete(key);
      writeFns.delete(key);
      void fn();
      return;
    }
  }
  writeTimers.set(
    key,
    setTimeout(() => {
      writeTimers.delete(key);
      writeFirstAt.delete(key);
      writeFns.delete(key);
      void fn();
    }, delay),
  );
}

// Run a specific pending debounced write NOW and await it (no-op if nothing pending).
// Lets resetPageCollab get an out-of-editor content write onto the server before it
// resets collab, so a reopen can't reseed from the pre-write content (the debounce
// race). It runs setPageContent's own write, so encryption is preserved.
async function flushWrite(key: string): Promise<void> {
  const fn = writeFns.get(key);
  if (!fn) return;
  const timer = writeTimers.get(key);
  if (timer) clearTimeout(timer);
  writeTimers.delete(key);
  writeFirstAt.delete(key);
  writeFns.delete(key);
  await fn();
}

// Docs (pages / rows) with an outstanding prose write are tracked in
// lib/proseSync so a debounced save's own realtime echo can't rewind the editor
// and eat the keystrokes typed since the save fired. See that module for why.

/** Every table id still referenced by a page in the store: embedded in its
 *  content, or backing its Kanban board. A table in no page's reference set is an
 *  orphan and can be cleaned up. TRASHED pages count too, on purpose: a trashed
 *  page is restorable, so a table it still embeds must survive, or restoring the
 *  page later finds a dead embed with its rows gone. (A permanently deleted page
 *  is already removed from the store before gcOrphanTables reads this, so its own
 *  orphan tables are still cleaned; only tables another live-or-trashed page
 *  references are protected.) Skipping trashed pages here let the automatic
 *  14-day trash sweep silently hard-delete a still-referenced table. */
function referencedTableIds(pages: Record<string, Page>): Set<string> {
  const ids = new Set<string>();
  // An encrypted page's body is an opaque envelope here, so extractTableIds finds
  // nothing in it. decryptBodies records what it embeds while it has the doc in the
  // clear; fold that in, or every table an encrypted page embeds reads as an orphan.
  const decrypted = useWorkspaceKeys.getState().searchTables;
  for (const p of Object.values(pages)) {
    for (const id of decrypted[p.id] ?? []) ids.add(id);
    for (const id of extractTableIds(p.content)) ids.add(id);
    if (p.kanban?.tableId) ids.add(p.kanban.tableId);
  }
  return ids;
}

/** The signed-in user's id, or '' when signed out. */
function pbUserId(): string {
  return (pb.authStore.record?.id as string) ?? '';
}

// Pre-neutralization docs of the OUTSIDE pages a "turn into workspace" severed, held
// in memory (not localStorage) so a live Revert can restore them: a neutralized doc
// can be the plaintext of encrypted content, which shouldn't persist to disk. A
// refresh drops these, so a post-refresh revert restores structure + relations only.
const moveContentSnaps = new Map<string, { pageId: string; oldContent: unknown }[]>();

export const useData = create<DataState>((set, get) => ({
  pages: {},
  tables: {},
  rows: {},
  loaded: false,
  loadError: null,
  activePageId: null,
  lastAction: null,
  pendingWorkspaceMove: null,
  openRowId: null,
  pageCollabNonce: {},

  hydrate: async () => {
    let pages: Page[];
    let tables: TableData[];
    let rows: TableRow[];
    try {
      [pages, tables, rows] = await Promise.all([
        pagesApi.list(),
        tablesApi.list(),
        rowsApi.list(),
      ]);
      // Write-through the offline read cache on every good load (best-effort, and
      // it stores exactly what the server sent, so encrypted content stays
      // ciphertext at rest, decrypted in memory like a live fetch).
      void saveDataset({ pages, tables, rows });
    } catch (err) {
      // Fall back to the last cached snapshot ONLY when we are genuinely offline,
      // so the workspace still opens read-only with no signal (the China case). A
      // failure while ONLINE (a server error, an expired token) still surfaces the
      // error instead of masking it with stale data. The cache is read-only display
      // and is never written back to the server, so it can't overwrite anything.
      const cached = navigator.onLine ? null : await loadDataset();
      if (!cached) {
        set({ loadError: err instanceof Error ? err.message : 'Failed to load workspace', loaded: true });
        return;
      }
      pages = cached.pages;
      tables = cached.tables;
      rows = cached.rows;
    }
    try {
      // hydrate() is a full refetch used both for first load and as the recovery
      // path after a failed write / on reconnect. Because it replaces the store
      // wholesale, it must honour the same in-flight-write guards the realtime
      // echoes do, or a refetch triggered mid-typing (a flaky connection, a tab
      // resume) rewinds every field the user is still editing to the server's
      // stale copy. So keep any field that currently has a pending local write.
      const cur = get();
      const pageMap: Record<string, Page> = {};
      for (const p of pages) {
        const mapped = withLocalBracket(withLocalRota(withLocalCards(withLocalSheet(withLocalRates(withLocalFiles(withLocalPhotos(withLocalDefaultTab(withLocalTierlist(withLocalKanban(withLocalFlow(withLocalMindmap(withLocalMap(withLocalCover(p))))))))))))));
        // A list response that set off before a write landed is stale wholesale,
        // the same out-of-order case the echoes guard. Keep what we hold.
        if (isStaleRecord(cur.pages[p.id], mapped)) {
          pageMap[p.id] = cur.pages[p.id];
          continue;
        }
        pageMap[p.id] = keepNonEmptyLists(
          cur.pages[p.id],
          keepPendingFields(cur.pages[p.id], mapped, ['content', 'title', 'map', 'mindmap', 'flow', 'kanban', 'tierlist', 'rates', 'sheet', 'cards', 'rota', 'bracket', 'defaultTab', 'photos', 'files', 'cover', 'icon']),
        );
      }
      const tableMap: Record<string, TableData> = {};
      for (const t of tables) tableMap[t.id] = keepPendingFields(cur.tables[t.id], withLocalFormKey(t), ['name', 'columns', 'views', 'automations']);
      const rowMap: Record<string, TableRow> = {};
      for (const r of rows) {
        const mapped = keepPendingFields(cur.rows[r.id], hydrateRow(r), ['content']);
        // Plaintext cells being typed: hold them too (encrypted cells carry a blob).
        let held =
          cur.rows[r.id] && !mapped.cellsEnc && isWriting(r.id, 'cells')
            ? { ...mapped, cells: cur.rows[r.id].cells }
            : mapped;
        // Row body, same rule as the realtime echo below and gated the SAME way. Keep
        // our decrypted doc only when the envelope is the one WE wrote, or a write is
        // still in flight. Preferring the local copy unconditionally (what this did
        // first) silently swallowed a collaborator's edit: their new envelope was
        // dropped, contentEnc was cleared so decryptRowBodies never retried, and the
        // next save wrote our stale doc over their text.
        const local = cur.rows[r.id];
        if (
          held.contentEnc &&
          local?.content &&
          !local.contentEnc &&
          (isWriting(r.id, 'content') || useWorkspaceKeys.getState().sameRowBodyEnvelope(r.id, held.contentEnc))
        ) {
          held = { ...held, content: local.content, contentEnc: undefined };
        }
        rowMap[r.id] = held;
      }

      // Keep optimistic records the server list doesn't have yet: a page/table/row
      // just created locally whose create is still in flight would otherwise be
      // dropped by this wholesale replace (and any text typed into it lost). A record
      // deleted remotely was already removed from the store by its delete echo, so it
      // isn't here to resurrect; at worst a not-yet-echoed delete lingers one beat.
      for (const id in cur.pages) if (!pageMap[id]) pageMap[id] = cur.pages[id];
      for (const id in cur.tables) if (!tableMap[id]) tableMap[id] = cur.tables[id];
      for (const id in cur.rows) if (!rowMap[id]) rowMap[id] = cur.rows[id];

      // Pick an initial active page. On a refresh (even a hard ctrl+shift+r) the
      // store is fresh, so `activePageId` is null; fall back to the last page we
      // persisted so you land back where you were. Then a workspace's chosen home
      // page, then a deep (non-root) non-trashed page.
      const prev = get().activePageId ?? loadLastPage();
      let active = prev && pageMap[prev] && !pageMap[prev].trashed ? prev : null;
      if (!active) {
        const ws = useWorkspace.getState().activeWorkspaceId;
        const landing = loadLanding(ws);
        if (landing && pageMap[landing] && !pageMap[landing].trashed) {
          active = landing;
        } else {
          const candidate =
            pages.find((p) => p.parent !== '' && !p.trashed) ?? pages.find((p) => !p.trashed);
          active = candidate ? candidate.id : null;
        }
      }

      // Restore a pending Revert/Accept notice across a refresh (only Accept/Revert
      // clears it), so a move can't become un-revertable just by reloading.
      set({ pages: pageMap, tables: tableMap, rows: rowMap, loaded: true, loadError: null, activePageId: active, pendingWorkspaceMove: loadPendingMove() });
      markFlowsDirty();
      startScheduleTick(get); // schedule triggers fire on their own from here
    } catch (err) {
      set({ loadError: err instanceof Error ? err.message : 'Failed to load workspace', loaded: true });
    }
  },

  subscribeRealtime: async () => {
    // pages
    await pb.collection('pages').subscribe('*', (e) => {
      const { action, record } = e as { action: string; record: RecordModel };
      markFlowsDirty(); // a page create/update/delete may add or change a flow
      set((s) => {
        const pages = { ...s.pages };
        if (action === 'delete') {
          delete pages[record.id];
          return { pages };
        }
        const incoming = withLocalBracket(withLocalRota(withLocalCards(withLocalSheet(withLocalRates(withLocalFiles(withLocalPhotos(withLocalDefaultTab(withLocalTierlist(withLocalKanban(withLocalFlow(withLocalMindmap(withLocalMap(withLocalCover(toPage(record)))))))))))))));
        // An echo older than what we hold arrived out of order; applying it rewinds
        // the whole record (the vanishing-upload bug). Drop it, ours is newer.
        if (isStaleRecord(s.pages[record.id], incoming)) return s;
        // Mid-write: keep the locally typed body AND title, sync the rest of the
        // record. Without the title guard a stale echo (this record's own save
        // round-trip, or any other field changing on it) reverted the title the
        // user was actively typing, wiping their keystrokes.
        let merged = keepNonEmptyLists(
          s.pages[record.id],
          keepPendingFields(s.pages[record.id], incoming, ['content', 'title', 'map', 'mindmap', 'flow', 'kanban', 'tierlist', 'rates', 'sheet', 'cards', 'rota', 'bracket', 'defaultTab', 'photos', 'files', 'cover', 'icon']),
        );
        // Keep an already-decrypted title across echoes (e.g. a second session)
        // so it doesn't flash "Locked"; a rename carries a new envelope and shows.
        const keptTitle = useWorkspaceKeys.getState().keepDecryptedTitle(record.id, merged.title);
        if (keptTitle !== null) merged = { ...merged, title: keptTitle };
        traceTierlist('echo', s.pages[record.id], merged);
        pages[record.id] = merged;
        return { pages };
      });
    });
    // tables
    await pb.collection('tables').subscribe('*', (e) => {
      const { action, record } = e as { action: string; record: RecordModel };
      set((s) => {
        const tables = { ...s.tables };
        if (action === 'delete') delete tables[record.id];
        // Mid-write: keep the locally typed table name / column names (and the
        // column set) so a stale echo can't revert a rename in progress.
        else {
          const incoming = withLocalFormKey(toTable(record));
          if (isStaleRecord(s.tables[record.id], incoming)) return s; // out-of-order echo
          tables[record.id] = keepPendingFields(s.tables[record.id], incoming, ['name', 'columns', 'views', 'automations']);
        }
        return { tables };
      });
    });
    // rows
    await pb.collection('table_rows').subscribe('*', (e) => {
      const { action, record } = e as { action: string; record: RecordModel };
      set((s) => {
        const rows = { ...s.rows };
        if (action === 'delete') {
          delete rows[record.id];
          return { rows };
        }
        const incoming = hydrateRow(toRow(record));
        if (isStaleRecord(s.rows[record.id], incoming)) return s; // out-of-order echo
        // Same guard as pages, don't wipe the row body you're typing in the
        // detail overlay. Cells still sync; only `content` holds while writing.
        const existing = s.rows[record.id];
        let merged = reconcileProseEcho(existing, incoming);
        // Hold what the user is typing in a cell against a stale echo (the same
        // protection the body has). This covers the ENCRYPTED case too: an echo
        // carrying a cellsEnc blob would otherwise replace the decrypted cells
        // mid-edit, and setCell refuses a row holding cellsEnc, so the next
        // keystroke would be dropped with no error. Keeping our decrypted copy is
        // last-write-wins, the same as the plaintext path.
        if (existing && !existing.cellsEnc && isWriting(record.id, 'cells')) {
          merged = { ...merged, cells: existing.cells, cellsEnc: undefined };
        }
        // Encrypted-cells echo: if it carries the SAME envelope we already
        // decrypted (e.g. our own write coming back), keep the in-memory cells so
        // typing doesn't stall or flicker. A DIFFERENT envelope means another
        // device edited the row, so let it through and decryptCells re-decrypts.
        if (
          incoming.cellsEnc &&
          existing &&
          !existing.cellsEnc &&
          Object.keys(existing.cells).length > 0 &&
          useWorkspaceKeys.getState().sameCellsEnvelope(record.id, incoming.cellsEnc)
        ) {
          merged = { ...merged, cells: existing.cells, cellsEnc: undefined };
        }
        // The row BODY twin of both guards above. reconcileProseEcho already holds
        // `content` while a body write is in flight, but an encrypted echo carries the
        // doc as `contentEnc`, which would re-lock the card mid-edit and then make
        // setRowContent refuse the next keystroke. Keep our decrypted doc when the
        // envelope is the one we wrote, or while the write is still settling.
        if (
          incoming.contentEnc &&
          existing &&
          !existing.contentEnc &&
          existing.content &&
          (isWriting(record.id, 'content') ||
            useWorkspaceKeys.getState().sameRowBodyEnvelope(record.id, incoming.contentEnc))
        ) {
          merged = { ...merged, content: existing.content, contentEnc: undefined };
        }
        rows[record.id] = merged;
        return { rows };
      });
    });
  },

  unsubscribeRealtime: async () => {
    try {
      await pb.collection('pages').unsubscribe('*');
      await pb.collection('tables').unsubscribe('*');
      await pb.collection('table_rows').unsubscribe('*');
    } catch {
      // ignore, connection may already be closed
    }
  },

  teardown: () => {
    stopScheduleTick();
    for (const t of writeTimers.values()) clearTimeout(t);
    writeTimers.clear();
    resetProseWrites();
    set({ pages: {}, tables: {}, rows: {}, loaded: false, activePageId: null });
  },

  purgeWorkspace: async (workspaceId) => {
    if (!workspaceId) return;
    const s = get();
    const pageIds = Object.values(s.pages).filter((p) => p.workspace === workspaceId).map((p) => p.id);
    const tableIds = Object.values(s.tables).filter((t) => t.workspace === workspaceId).map((t) => t.id);
    const rowIds = Object.values(s.rows).filter((r) => r.workspace === workspaceId).map((r) => r.id);
    // Optimistic local removal so the UI clears immediately.
    set((st) => {
      const pages = { ...st.pages };
      pageIds.forEach((id) => delete pages[id]);
      const tables = { ...st.tables };
      tableIds.forEach((id) => delete tables[id]);
      const rows = { ...st.rows };
      rowIds.forEach((id) => delete rows[id]);
      const activePageId = pageIds.includes(st.activePageId ?? '') ? null : st.activePageId;
      return { pages, tables, rows, activePageId };
    });
    // Delete rows before tables (a table delete may cascade its rows; a 404 on an
    // already-gone row is harmless). allSettled so one failure doesn't abort the rest.
    await Promise.allSettled(rowIds.map((id) => rowsApi.remove(id)));
    await Promise.allSettled([
      ...tableIds.map((id) => tablesApi.remove(id)),
      ...pageIds.map((id) => pagesApi.remove(id)),
    ]);
  },

  gcOrphanTables: (candidateIds) => {
    const unique = [...new Set(candidateIds)];
    if (!unique.length) return;
    const s = get();
    // Do not GC at all while a page's body is unreadable and undecrypted. Such a page
    // may embed the candidate, and getting this wrong permanently deletes a live table
    // and all its rows (2026-07-18, recovered out of SQLite free pages). With the vault
    // unlocked decryptBodies accounts for every encrypted page, so this only pauses
    // cleanup while genuinely blind, rather than disabling it.
    const known = useWorkspaceKeys.getState().searchTables;
    const blind = Object.values(s.pages).some((p) => !p.trashed && isEnvelope(p.content) && !known[p.id]);
    if (blind) return;
    const refs = referencedTableIds(s.pages);
    const encOn = useWorkspace.getState().encryptedEnabled;
    const orphans = unique.filter((id) => {
      const t = s.tables[id];
      if (!t || refs.has(id)) return false;
      // In an encrypted workspace page content is opaque, so we can't be sure the
      // table isn't referenced. Leave it rather than risk deleting a live table.
      return !encOn(t.workspace ?? '');
    });
    if (!orphans.length) return;
    const orphanSet = new Set(orphans);
    const rowIds = Object.values(s.rows)
      .filter((r) => orphanSet.has(r.table))
      .map((r) => r.id);
    set((st) => {
      const tables = { ...st.tables };
      orphans.forEach((id) => delete tables[id]);
      const rows = { ...st.rows };
      rowIds.forEach((id) => delete rows[id]);
      return { tables, rows };
    });
    void Promise.allSettled(rowIds.map((id) => rowsApi.remove(id)));
    void Promise.allSettled(orphans.map((id) => tablesApi.remove(id)));
  },

  setActivePage: (id) => set({ activePageId: id }),
  pendingFocus: null,
  requestFocus: (pageId, text) => set({ activePageId: pageId, pendingFocus: text ? { pageId, text } : null }),
  clearFocus: () => set({ pendingFocus: null }),
  commentThread: null,
  openCommentThread: (threadId, top, left) => set({ commentThread: { threadId, top, left } }),
  closeCommentThread: () => set({ commentThread: null }),
  commentsOpen: false,
  setCommentsOpen: (open) => set({ commentsOpen: open }),
  commentCounts: {},
  setCommentCounts: (counts) => set({ commentCounts: counts }),
  pendingCommentsPage: null,
  requestPageComments: (pageId) => set({ activePageId: pageId, pendingCommentsPage: pageId }),
  clearPendingComments: () => set({ pendingCommentsPage: null }),
  pendingPageTab: null,
  requestPageTab: (pageId, tab) => set({ activePageId: pageId, pendingPageTab: { pageId, tab } }),
  clearPendingPageTab: () => set({ pendingPageTab: null }),

  undoLast: () => {
    const a = get().lastAction;
    if (!a) return;
    a.undo();
    set({ lastAction: null });
  },
  dismissLastAction: () => set({ lastAction: null }),

  // --- pages --------------------------------------------------------------

  createPage: async (parentId, activate = true) => {
    const siblings = Object.values(get().pages).filter((p) => p.parent === parentId && !p.trashed);
    try {
      const page = await pagesApi.create({
        title: 'Untitled',
        icon: '📄',
        parent: parentId,
        order: siblings.length,
        content: null,
        workspace: activeWsForWrite(),
      });
      set((s) => ({ pages: { ...s.pages, [page.id]: page }, ...(activate ? { activePageId: page.id } : {}) }));
      return page.id;
    } catch (err) {
      console.error('[data] createPage failed', err);
      return null;
    }
  },

  createCharacterPage: async (data) => {
    // Sit it under the page you ran /character from (keeps a party together),
    // else top-level. The class picks the page icon; the form guarantees a name.
    const parent = get().activePageId ?? '';
    const siblings = Object.values(get().pages).filter((p) => p.parent === parent && !p.trashed);
    try {
      const page = await pagesApi.create({
        title: data.name.trim() || 'New character',
        icon: classIcon(data.className),
        parent,
        order: siblings.length,
        content: characterDoc(data),
        workspace: activeWsForWrite(),
      });
      set((s) => ({ pages: { ...s.pages, [page.id]: page }, activePageId: page.id }));
      return page.id;
    } catch (err) {
      console.error('[data] createCharacterPage failed', err);
      return null;
    }
  },

  createStarterPage: async (starterKey) => {
    const starter = STARTERS.find((s) => s.key === starterKey);
    const siblings = Object.values(get().pages).filter((p) => p.parent === '' && !p.trashed);
    try {
      const page = await pagesApi.create({
        title: starter?.title ?? 'Untitled',
        icon: starter?.icon ?? '📄',
        parent: '',
        order: siblings.length,
        content: starter?.build() ?? null,
        workspace: activeWsForWrite(),
      });
      set((s) => ({ pages: { ...s.pages, [page.id]: page }, activePageId: page.id }));
      return page.id;
    } catch (err) {
      console.error('[data] createStarterPage failed', err);
      return null;
    }
  },

  createDemoPage: async () => {
    const ws = activeWsForWrite();
    const txt = (s: string) => ({ type: 'text', text: s });
    const para = (s = '') => ({ type: 'paragraph', content: s ? [txt(s)] : [] });
    const head = (level: number, s: string) => ({ type: 'heading', attrs: { level }, content: [txt(s)] });
    const quote = (s: string) => ({ type: 'blockquote', content: [para(s)] });
    const bullets = (items: string[]) => ({ type: 'bulletList', content: items.map((t) => ({ type: 'listItem', content: [para(t)] })) });
    const todos = (items: [string, boolean][]) => ({ type: 'taskList', content: items.map(([t, c]) => ({ type: 'taskItem', attrs: { checked: c }, content: [para(t)] })) });

    try {
      // A database with mixed column types and a self-writing formula column.
      const cPlace = uid('c'), cArea = uid('c'), cBeen = uid('c'), cRating = uid('c'), cWorth = uid('c'), cNotes = uid('c');
      const oHakata = uid('o'), oTenjin = uid('o'), oOhori = uid('o'), oDazaifu = uid('o');
      const hitCols: Column[] = [
        { id: cPlace, name: 'Place', type: 'text', width: 190 },
        { id: cArea, name: 'Area', type: 'select', width: 120, options: [
          { id: oHakata, label: 'Hakata', color: pickTagColor(1) },
          { id: oTenjin, label: 'Tenjin', color: pickTagColor(2) },
          { id: oOhori, label: 'Ohori', color: pickTagColor(3) },
          { id: oDazaifu, label: 'Dazaifu', color: pickTagColor(5) },
        ] },
        { id: cBeen, name: 'Been', type: 'checkbox', width: 70 },
        { id: cRating, name: 'Rating', type: 'number', width: 90 },
        { id: cWorth, name: 'Verdict', type: 'formula', width: 130, formula: 'if([Rating] >= 4, "go again", "once is fine")' },
        { id: cNotes, name: 'Notes', type: 'text', width: 280 },
      ];
      const hit = await tablesApi.create({ name: 'Fukuoka hit list', columns: hitCols, workspace: ws });
      set((s) => ({ tables: { ...s.tables, [hit.id]: { ...hit } } }));
      get().setTableView(hit.id, defaultViewConfig());
      const hitRows: Record<string, CellValue>[] = [
        { [cPlace]: 'Ichiran Honten', [cArea]: oHakata, [cBeen]: true, [cRating]: 5, [cNotes]: 'The original shop. Go before noon or queue.' },
        { [cPlace]: 'Ohori Park', [cArea]: oOhori, [cBeen]: true, [cRating]: 4, [cNotes]: 'Run the loop, rent a swan boat after.' },
        { [cPlace]: 'Yatai on Nakasu', [cArea]: oHakata, [cBeen]: false, [cRating]: 5, [cNotes]: 'Riverside food stalls, bring cash.' },
        { [cPlace]: 'Dazaifu Tenmangu', [cArea]: oDazaifu, [cBeen]: false, [cRating]: 3, [cNotes]: 'Half a day once you add the train out.' },
        { [cPlace]: 'Tenjin underground', [cArea]: oTenjin, [cBeen]: true, [cRating]: 4, [cNotes]: 'Where you go when it rains.' },
      ];
      for (const cells of hitRows) await get().addRow(hit.id, cells);

      // A second table so the money block has real numbers to total.
      const mName = uid('c'), mAmount = uid('c'), mCur = uid('c');
      const cJPY = uid('o'), cSEK = uid('o');
      const costCols: Column[] = [
        { id: mName, name: 'Item', type: 'text', width: 180 },
        { id: mAmount, name: 'Amount', type: 'number', width: 110 },
        { id: mCur, name: 'Currency', type: 'select', width: 100, options: [
          { id: cJPY, label: 'JPY', color: pickTagColor(1) },
          { id: cSEK, label: 'SEK', color: pickTagColor(2) },
        ] },
      ];
      const cost = await tablesApi.create({ name: 'Monthly costs', columns: costCols, workspace: ws });
      set((s) => ({ tables: { ...s.tables, [cost.id]: { ...cost } } }));
      get().setTableView(cost.id, defaultViewConfig());
      const costRows: Record<string, CellValue>[] = [
        { [mName]: 'Rent', [mAmount]: 78000, [mCur]: cJPY },
        { [mName]: 'Groceries', [mAmount]: 45000, [mCur]: cJPY },
        { [mName]: 'Transit pass', [mAmount]: 8000, [mCur]: cJPY },
        { [mName]: 'Phone', [mAmount]: 3300, [mCur]: cJPY },
      ];
      for (const cells of costRows) await get().addRow(cost.id, cells);

      // A map table: a place column pins itself on the map view.
      const mapName = uid('c'), mapPlace = uid('c');
      const mapCols: Column[] = [
        { id: mapName, name: 'Name', type: 'text', width: 200 },
        { id: mapPlace, name: 'Place', type: 'place', width: 200 },
      ];
      const mapT = await tablesApi.create({ name: 'Map', columns: mapCols, workspace: ws });
      set((s) => ({ tables: { ...s.tables, [mapT.id]: { ...mapT } } }));
      get().setTableView(mapT.id, { ...defaultViewConfig(), name: 'Map', type: 'map', placeColumnId: mapPlace });
      await get().addRow(mapT.id, { [mapName]: '', [mapPlace]: { name: 'Fukuoka', lat: 33.5902, lon: 130.4017 } });

      const soon = new Date(Date.now() + 86 * 86400000).toISOString().slice(0, 10);
      const content = {
        type: 'doc',
        content: [
          quote('A quick tour of what this thing does. Poke at all of it, none of it is a screenshot.'),
          head(2, 'One database, eight ways to look at it'),
          para('The table below is a single list. Use its tabs to flip between grid, board, calendar, map and the rest. The Verdict column is a formula, it reads the rating and writes itself.'),
          { type: 'tableEmbed', attrs: { tableId: hit.id } },
          head(2, 'Money, in two currencies at once'),
          para('Put a number and a currency in any table and this totals it, converted live. It found the costs table on its own.'),
          { type: 'moneyDashboard', attrs: { base: '' } },
          head(2, 'A countdown that keeps itself'),
          { type: 'countdownBlock', attrs: { label: 'Lease renewal', date: soon, emoji: '🔑' } },
          head(2, 'On the map'),
          para('Add places to a table and they pin themselves. This one has Fukuoka. Give it more rows and they all land on the map.'),
          { type: 'tableEmbed', attrs: { tableId: mapT.id } },
          head(2, 'Weather and time, where you are'),
          para('A place block knows the local time and the forecast there, handy when whoever you are planning with is several hours behind.'),
          { type: 'placeWidget', attrs: { name: 'Fukuoka', country: 'Japan', lat: 33.5902, lon: 130.4017, timezone: 'Asia/Tokyo', days: 3 } },
          head(2, 'And it is still just a doc'),
          para('Write normally. Checklists, lists, quotes, code, all of it. Type a slash anywhere to drop a block.'),
          todos([['Unlock the vault once a session', true], ['Invite someone to the workspace', false], ['Turn one page into a public link', false]]),
          bullets(['Drag the right edge of a table column to resize it', 'Right click a table to import or export CSV', 'Every formula runs live on its own row']),
          { type: 'horizontalRule' },
          para('It started as a trip planner and grew into a place to run anything. Make it yours.'),
        ],
      };

      const siblings = Object.values(get().pages).filter((p) => p.parent === '' && !p.trashed);
      const page = await pagesApi.create({ title: 'Welcome, a tour', icon: '🧭', parent: '', order: siblings.length, content, workspace: ws });
      set((s) => ({ pages: { ...s.pages, [page.id]: page }, activePageId: page.id }));
      return page.id;
    } catch (err) {
      console.error('[data] createDemoPage failed', err);
      return null;
    }
  },

  createTemplatePage: async (key) => {
    const ws = activeWsForWrite();
    const txt = (s: string) => ({ type: 'text', text: s });
    const para = (s = '') => ({ type: 'paragraph', content: s ? [txt(s)] : [] });
    const head = (level: number, s: string) => ({ type: 'heading', attrs: { level }, content: [txt(s)] });
    const callout = (emoji: string, s: string) => ({ type: 'calloutCard', attrs: { emoji, color: 'blue' }, content: [para(s)] });
    const todos = (items: string[]) => ({ type: 'taskList', content: items.map((t) => ({ type: 'taskItem', attrs: { checked: false }, content: [para(t)] })) });
    const embed = async (preset: TablePreset): Promise<object> => {
      const id = await get().createTablePreset(preset);
      return id ? { type: 'tableEmbed', attrs: { tableId: id } } : para('');
    };

    let title = 'Untitled';
    let icon = '📄';
    const blocks: object[] = [];
    try {
      if (key === 'trip') {
        title = 'New trip';
        icon = '✈️';
        blocks.push(callout('🌏', 'A home for one trip: where you are going, what it costs, and what to pack.'));
        blocks.push(head(2, 'Itinerary'), await embed('itinerary'));
        blocks.push(head(2, 'Budget'), await embed('budget'));
        blocks.push(head(2, 'Packing'), await embed('packing'));
        blocks.push(head(2, 'Notes'), para('Flight numbers, confirmations, anything to remember.'));
      } else if (key === 'sprint') {
        title = 'New sprint';
        icon = '🎯';
        blocks.push(callout('🏁', 'One sprint: the goal, the board, and what done means.'));
        blocks.push(head(2, 'Goal'), para('What this sprint is for.'));
        blocks.push(head(2, 'Board'), await embed('board'));
        blocks.push(head(2, 'Definition of done'), todos(['Tests pass', 'Reviewed', 'Docs updated', 'Shipped']));
      } else if (key === 'dnd') {
        title = 'D&D session';
        icon = '🐉';
        blocks.push(callout('🎲', 'Run a session: who is in the fight, what happens, and what stuck.'));
        blocks.push(head(2, 'Initiative'), await embed('combat'));
        blocks.push(head(2, 'Scene notes'), para('Where the party is and what they find.'));
        blocks.push(head(2, 'Recap'), para('What happened, for next time.'));
      } else if (key === 'family') {
        title = 'Family visit';
        icon = '🧳';
        blocks.push(callout('🏠', 'When family comes to stay: the plan, day by day.'));
        blocks.push(head(2, 'Their itinerary'), await embed('itinerary'));
        blocks.push(head(2, 'Show them'), todos(['Favourite food spot', 'A day trip', 'The local park', 'Somewhere quiet']));
        blocks.push(head(2, 'Logistics'), para('Arrival time, keys, wifi, anything they need.'));
      } else if (key === 'weekly') {
        title = 'Weekly review';
        icon = '🗓️';
        blocks.push(callout('🧭', 'Ten minutes to reset the week.'));
        blocks.push(head(2, 'Last week'), para('What went well? What did not?'));
        blocks.push(head(2, 'This week'), todos(['Top three for the week', 'Anything overdue', 'One thing for me', 'One thing for us']));
        blocks.push(head(2, 'Notes'), para(''));
      } else {
        return null;
      }

      const content = { type: 'doc', content: blocks };
      const siblings = Object.values(get().pages).filter((p) => p.parent === '' && !p.trashed);
      const page = await pagesApi.create({ title, icon, parent: '', order: siblings.length, content, workspace: ws });
      set((s) => ({ pages: { ...s.pages, [page.id]: page }, activePageId: page.id }));
      return page.id;
    } catch (err) {
      console.error('[data] createTemplatePage failed', err);
      return null;
    }
  },

  importNotion: async (plan) => {
    let workspaces = 0;
    let pages = 0;
    let tables = 0;

    // Upload every referenced export image once (full resolution via the uploads
    // collection; a data-URL fallback for SVG / when uploads aren't set up), keyed so
    // the per-page content pass can fill each image block's src.
    const imageUrls = new Map<string, string>();
    for (const img of plan.images ?? []) {
      try {
        const file = new File([img.bytes as BlobPart], img.name, { type: img.mime });
        let url = await uploadsApi.upload(file);
        if (!url) {
          try { url = await processImageFile(file); } catch { url = null; } // too big to inline → skip
        }
        if (url) imageUrls.set(img.key, url);
      } catch (err) {
        console.error('[data] importNotion image failed', err);
      }
    }

    for (const ws of plan.workspaces) {
      const wsId = await useWorkspace.getState().createWorkspace(ws.name || 'Imported from Notion');
      if (!wsId) continue;
      workspaces++;

      const idMap = new Map<string, string>(); // notion id -> new page id
      const orderBy = new Map<string, number>(); // parent new id ('' for root) -> next order
      const remaining = [...ws.pages];
      const created: { recId: string; content: unknown }[] = []; // for the link-resolve pass

      const createPage = async (page: (typeof ws.pages)[number], parentNewId: string) => {
        const order = orderBy.get(parentNewId) ?? 0;
        orderBy.set(parentNewId, order + 1);
        let content: unknown = page.content;
        if (page.csv) {
          try {
            const tbl = await tablesApi.create({ name: page.title || 'Table', columns: [], workspace: wsId });
            set((s) => ({ tables: { ...s.tables, [tbl.id]: { ...tbl } } }));
            await get().importRows(tbl.id, parseDelimited(page.csv));
            content = { type: 'doc', content: [{ type: 'tableEmbed', attrs: { tableId: tbl.id } }] };
            tables++;
          } catch (err) {
            console.error('[data] importNotion table failed', err);
          }
        }
        const rec = await pagesApi.create({ title: page.title, icon: '', parent: parentNewId, order, content, workspace: wsId });
        set((s) => ({ pages: { ...s.pages, [rec.id]: rec } }));
        idMap.set(page.notionId, rec.id);
        created.push({ recId: rec.id, content });
        pages++;
      };

      // Create parents before children so each child can point at a real parent.
      let safety = remaining.length * 2 + 10;
      while (remaining.length && safety-- > 0) {
        const idx = remaining.findIndex((p) => p.parentId === null || idMap.has(p.parentId));
        if (idx === -1) break; // only orphans left
        const page = remaining.splice(idx, 1)[0];
        const parentNewId = page.parentId ? idMap.get(page.parentId) ?? '' : '';
        try {
          await createPage(page, parentNewId);
        } catch (err) {
          console.error('[data] importNotion page failed', err);
        }
      }
      // Orphans (a parent that never resolved) land at the top level.
      for (const page of remaining) {
        try {
          await createPage(page, '');
        } catch (err) {
          console.error('[data] importNotion orphan failed', err);
        }
      }

      // Every page exists now, so re-point the in-page links at the right pages and
      // fill each imported image's src from the upload made above.
      for (const c of created) {
        const linksChanged = resolvePageLinks(c.content, idMap);
        const imagesChanged = resolveImportedImages(c.content, imageUrls);
        if (linksChanged || imagesChanged) {
          try {
            await pagesApi.update(c.recId, { content: c.content });
            set((s) => {
              const p = s.pages[c.recId];
              return p ? { pages: { ...s.pages, [c.recId]: { ...p, content: c.content } } } : s;
            });
          } catch (err) {
            console.error('[data] importNotion link resolve failed', err);
          }
        }
      }
    }

    return { workspaces, pages, tables, images: imageUrls.size };
  },

  captureToInbox: async (text) => {
    const line = text.trim();
    if (!line) return null;
    const ws = activeWsForWrite();
    let inbox = Object.values(get().pages).find(
      (p) => !p.trashed && p.title === 'Inbox' && (p.workspace ?? '') === ws,
    );
    if (!inbox) {
      const siblings = Object.values(get().pages).filter((p) => p.parent === '' && !p.trashed);
      try {
        inbox = await pagesApi.create({
          title: 'Inbox',
          icon: '📥',
          parent: '',
          order: siblings.length,
          content: { type: 'doc', content: [] },
          workspace: ws,
        });
        set((s) => ({ pages: { ...s.pages, [inbox!.id]: inbox! } }));
      } catch (err) {
        console.error('[data] inbox create failed', err);
        return null;
      }
    }
    get().setPageContent(inbox.id, appendCapture(inbox.content, line));
    void resetPageCollab(inbox.id); // so an already-opened Inbox reseeds with this note
    return inbox.id;
  },

  captureImageToInbox: async (dataUrl) => {
    if (!dataUrl) return null;
    const ws = activeWsForWrite();
    let inbox = Object.values(get().pages).find(
      (p) => !p.trashed && p.title === 'Inbox' && (p.workspace ?? '') === ws,
    );
    if (!inbox) {
      const siblings = Object.values(get().pages).filter((p) => p.parent === '' && !p.trashed);
      try {
        inbox = await pagesApi.create({
          title: 'Inbox',
          icon: '📥',
          parent: '',
          order: siblings.length,
          content: { type: 'doc', content: [] },
          workspace: ws,
        });
        set((s) => ({ pages: { ...s.pages, [inbox!.id]: inbox! } }));
      } catch (err) {
        console.error('[data] inbox create failed', err);
        return null;
      }
    }
    get().setPageContent(inbox.id, appendImage(inbox.content, dataUrl));
    void resetPageCollab(inbox.id); // so an already-opened Inbox reseeds with this image
    return inbox.id;
  },

  openDailyNote: async () => {
    const now = new Date();
    const title = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const ws = activeWsForWrite();
    const existing = Object.values(get().pages).find(
      (p) => !p.trashed && p.title === title && (p.workspace ?? '') === ws,
    );
    if (existing) {
      set({ activePageId: existing.id });
      return existing.id;
    }
    const siblings = Object.values(get().pages).filter((p) => p.parent === '' && !p.trashed);
    try {
      const page = await pagesApi.create({
        title,
        icon: '🗓️',
        parent: '',
        order: siblings.length,
        content: null,
        workspace: ws,
      });
      set((s) => ({ pages: { ...s.pages, [page.id]: page }, activePageId: page.id }));
      return page.id;
    } catch (err) {
      console.error('[data] openDailyNote failed', err);
      return null;
    }
  },

  // Deep-duplicate a page: clones its embedded tables (so the copy is fully
  // independent), then the page, then its child pages recursively.
  duplicatePage: async (pageId, parentOverride, rename = true) => {
    const state = get();
    const src = state.pages[pageId];
    if (!src) return null;

    // 1. Clone embedded tables + their rows; build an old->new id map.
    const map: Record<string, string> = {};
    for (const tid of extractTableIds(src.content)) {
      const t = state.tables[tid];
      if (!t) continue;
      try {
        const nt = await tablesApi.create({ name: t.name, columns: t.columns, workspace: activeWsForWrite() });
        set((s) => ({ tables: { ...s.tables, [nt.id]: { ...nt, views: t.views ?? null } } }));
        if (t.views) get().setTableView(nt.id, t.views);
        map[tid] = nt.id;
        const trows = Object.values(state.rows)
          .filter((r) => r.table === tid)
          .sort((a, b) => a.position - b.position);
        for (const r of trows) {
          const cloneWs = activeWsForWrite();
          const cloneCells = (await cellsToPersist(cloneWs, r.cells, t.columns)) ?? r.cells;
          const nr = await rowsApi.create({ table: nt.id, cells: cloneCells, position: r.position, workspace: cloneWs });
          // The body rides along, encrypted if the destination is AND row-body
          // encryption is switched on. Same gate as setRowContent: a duplicate must
          // not be the back door that puts the new ciphertext shape into the database
          // while the switch is still off.
          if (r.content) {
            const encryptBody = useWorkspace.getState().encryptedEnabled(cloneWs) && encryptRowBodiesEnabled();
            const bodyStore = encryptBody
              ? await useWorkspaceKeys.getState().encryptForWorkspace(cloneWs, r.content)
              : r.content;
            if (bodyStore) rowsApi.update(nr.id, { content: bodyStore }).catch(() => {});
          }
          // Keep plaintext cells in memory (persisted copy may be encrypted).
          set((s) => ({ rows: { ...s.rows, [nr.id]: { ...nr, cells: r.cells, cellsEnc: undefined, content: (r.content as object) ?? null } } }));
        }
      } catch (e) {
        console.error('[data] clone embedded table failed', e);
      }
    }
    const newContent = remapTableIds(src.content, map);

    // 2. Clone the page itself.
    const parent = parentOverride ?? src.parent;
    const siblings = Object.values(get().pages).filter((p) => p.parent === parent && !p.trashed);
    try {
      const page = await pagesApi.create({
        title: rename ? `${src.title || 'Untitled'} copy` : src.title,
        icon: src.icon,
        parent,
        order: siblings.length,
        content: newContent,
        workspace: activeWsForWrite(),
      });
      set((s) => ({ pages: { ...s.pages, [page.id]: page } }));

      // 3. Recurse into children, reparenting to the new page.
      const children = Object.values(state.pages).filter((p) => p.parent === pageId && !p.trashed);
      for (const ch of children) await get().duplicatePage(ch.id, page.id, false);
      return page.id;
    } catch (err) {
      console.error('[data] duplicatePage failed', err);
      return null;
    }
  },

  setPageTemplate: (pageId, value) => {
    set((s) => {
      const p = s.pages[pageId];
      if (!p) return s;
      return { pages: { ...s.pages, [pageId]: { ...p, template: value } } };
    });
    pagesApi.update(pageId, { template: value }).catch((err) => console.error('[data] setPageTemplate failed', err));
  },

  setPagePublic: async (pageId, on) => {
    const token = on ? publicToken() : '';
    set((s) => {
      const p = s.pages[pageId];
      if (!p) return s;
      return { pages: { ...s.pages, [pageId]: { ...p, publicToken: token || undefined } } };
    });
    try {
      await pagesApi.update(pageId, { publicToken: token });
    } catch (err) {
      console.error('[data] setPagePublic failed', err);
    }
    return token || null;
  },

  // Publish a single block (a recipe) as its own read-only public page: a small
  // plaintext doc with a random token, parked off-tree so it never clutters the
  // sidebar. Returns the page id + token for the ?share= link.
  publishShared: async (workspaceId, title, doc) => {
    const token = publicToken();
    try {
      const page = await pagesApi.create({
        title: title || 'Shared recipe',
        content: doc as unknown as Page['content'],
        parent: SHARED_PARENT,
        publicToken: token,
        ...(workspaceId ? { workspace: workspaceId } : {}),
      });
      return { pageId: page.id, token };
    } catch (err) {
      console.error('[data] publishShared failed', err);
      return null;
    }
  },

  updateShared: async (pageId, title, doc) => {
    try {
      await pagesApi.update(pageId, { title: title || 'Shared recipe', content: doc as unknown as Page['content'] });
    } catch (err) {
      console.error('[data] updateShared failed', err);
    }
  },

  unpublishShared: async (pageId) => {
    set((s) => {
      const next = { ...s.pages };
      delete next[pageId];
      return { pages: next };
    });
    try {
      await pagesApi.remove(pageId);
    } catch (err) {
      console.error('[data] unpublishShared failed', err);
    }
  },

  setPageCover: (pageId, cover) => {
    set((s) => {
      const p = s.pages[pageId];
      if (!p) return s;
      return { pages: { ...s.pages, [pageId]: { ...p, cover } } };
    });
    try {
      if (cover) localStorage.setItem(`waypoint:cover:${pageId}`, cover);
      else localStorage.removeItem(`waypoint:cover:${pageId}`);
    } catch {
      /* ignore quota */
    }
    const seq = beginWrite(pageId, 'cover');
    pagesApi
      .update(pageId, { cover })
      .catch((err) => console.error('[data] setPageCover failed', err))
      .finally(() => endWrite(pageId, 'cover', seq));
  },

  setPageMap: (pageId, data) => {
    set((s) => {
      const p = s.pages[pageId];
      if (!p) return s;
      return { pages: { ...s.pages, [pageId]: { ...p, map: data } } };
    });
    // Mirror to localStorage so the value survives an echo when the `pages.map`
    // field isn't in the schema yet (PocketBase drops unknown fields on write).
    try {
      localStorage.setItem(`waypoint:map:${pageId}`, JSON.stringify(data));
    } catch {
      /* ignore quota */
    }
    const seq = beginWrite(pageId, 'map');
    debounceWrite(`page-map-${pageId}`, () => {
      pagesApi
        .update(pageId, { map: data })
        .catch((err) => pageFieldWriteFailed('map', err))
        .finally(() => endWrite(pageId, 'map', seq));
    });
  },

  setPageMindmap: (pageId, data) => {
    set((s) => {
      const p = s.pages[pageId];
      if (!p) return s;
      return { pages: { ...s.pages, [pageId]: { ...p, mindmap: data } } };
    });
    // Mirror to localStorage so the value survives the echo while the
    // `pages.mindmap` field isn't in the schema yet (PB drops unknown fields).
    try {
      localStorage.setItem(`waypoint:mindmap:${pageId}`, JSON.stringify(data));
    } catch {
      /* ignore quota */
    }
    const seq = beginWrite(pageId, 'mindmap');
    debounceWrite(`page-mindmap-${pageId}`, () => {
      pagesApi
        .update(pageId, { mindmap: data })
        .catch((err) => pageFieldWriteFailed('mindmap', err))
        .finally(() => endWrite(pageId, 'mindmap', seq));
    });
  },

  setPageFlow: (pageId, data) => {
    set((s) => {
      const p = s.pages[pageId];
      if (!p) return s;
      return { pages: { ...s.pages, [pageId]: { ...p, flow: data } } };
    });
    markFlowsDirty();
    // Mirror to localStorage so the value survives the echo while the
    // `pages.flow` field isn't in the schema yet (PB drops unknown fields).
    try {
      localStorage.setItem(`waypoint:flow:${pageId}`, JSON.stringify(data));
    } catch {
      /* ignore quota */
    }
    const seq = beginWrite(pageId, 'flow');
    debounceWrite(`page-flow-${pageId}`, () => {
      pagesApi
        .update(pageId, { flow: data })
        .catch((err) => pageFieldWriteFailed('flow', err))
        .finally(() => endWrite(pageId, 'flow', seq));
    });
  },

  setPageKanban: (pageId, data) => {
    set((s) => {
      const p = s.pages[pageId];
      if (!p) return s;
      return { pages: { ...s.pages, [pageId]: { ...p, kanban: data } } };
    });
    // Mirror to localStorage so the board survives the echo while the
    // `pages.kanban` field isn't in the schema yet (PB drops unknown fields).
    try {
      localStorage.setItem(`waypoint:kanban:${pageId}`, JSON.stringify(data));
    } catch {
      /* ignore quota */
    }
    const seq = beginWrite(pageId, 'kanban');
    debounceWrite(`page-kanban-${pageId}`, () => {
      pagesApi
        .update(pageId, { kanban: data })
        .catch((err) => pageFieldWriteFailed('board', err))
        .finally(() => endWrite(pageId, 'kanban', seq));
    });
  },

  setPageTierlist: (pageId, data) => {
    set((s) => {
      const p = s.pages[pageId];
      if (!p) return s;
      const next = { ...p, tierlist: data };
      traceTierlist('write', p, next);
      return { pages: { ...s.pages, [pageId]: next } };
    });
    try {
      localStorage.setItem(`waypoint:tierlist:${pageId}`, JSON.stringify(data));
    } catch {
      /* ignore quota */
    }
    const seq = beginWrite(pageId, 'tierlist');
    debounceWrite(`page-tierlist-${pageId}`, () => {
      pagesApi
        .update(pageId, { tierlist: data })
        .catch((err) => pageFieldWriteFailed('tier list', err))
        .finally(() => endWrite(pageId, 'tierlist', seq));
    });
  },

  setPageRates: (pageId, data) => {
    // The column is known missing, so PocketBase would drop this write and the
    // localStorage mirror would become the only copy of the board. Refuse instead of
    // building something that exists in one browser and nowhere else. The Currency
    // tab is already read-only in this state; this guard is for the next caller that
    // isn't, which is the whole point of putting it here rather than only in the UI.
    if (pageFieldKnown.rates === false) {
      console.error('[data] pages.rates column missing. This install predates the field: add an optional JSON field named rates to the pages collection in the PocketBase dashboard (the toast stays plain on purpose)');
      toast('Could not save the currency board: this Waypoint is not set up to store it yet.', 'error');
      return;
    }
    set((s) => {
      const p = s.pages[pageId];
      if (!p) return s;
      return { pages: { ...s.pages, [pageId]: { ...p, rates: data } } };
    });
    try {
      localStorage.setItem(`waypoint:rates:${pageId}`, JSON.stringify(data));
    } catch {
      /* ignore quota */
    }
    const seq = beginWrite(pageId, 'rates');
    debounceWrite(`page-rates-${pageId}`, () => {
      pagesApi
        .update(pageId, { rates: data })
        .catch((err) => pageFieldWriteFailed('currency board', err))
        .finally(() => endWrite(pageId, 'rates', seq));
    });
  },
  assignAndNotify: async (rowId, columnId, userIds, note) => {
    const row = get().rows[rowId];
    if (!row) return false;
    const table = get().tables[row.table];
    const col = table?.columns.find((c) => c.id === columnId);
    if (!col) return false;

    // The assignment goes through setCell, so encryption, automations and the
    // pending-write guard all apply exactly as they do for a manual edit.
    get().setCell(rowId, columnId, col.peopleMulti ? userIds : (userIds[0] ?? ''));
    if (!userIds.length) return true;

    // Telling someone is a COMMENT that @-mentions them. That reuses the whole
    // existing path: the notify_mentions hook emails on it, the in-app bell
    // already watches it, and it encrypts like any other comment. A second
    // notification channel would be a second thing to get wrong.
    const me = pbUserId();
    const others = userIds.filter((id) => id !== me);
    if (!others.length) return true; // assigning to yourself needs no email

    // The thread has to hang on a page. Find one that actually shows this table,
    // rather than inventing a location the reader cannot navigate to.
    const pageId = Object.values(get().pages).find(
      (p) => !p.trashed && (p.kanban?.tableId === row.table || extractTableIds(p.content).includes(row.table)),
    )?.id;
    if (!pageId) return true; // assigned, but nowhere sensible to post; not an error

    const roster = useWorkspace.getState().roster;
    const names = others.map((id) => `@${roster.find((m) => m.id === id)?.name ?? 'someone'}`).join(' ');
    const title = rowTitle(row.cells, table?.columns ?? []) || 'a row';
    const body = `${names} you have been assigned "${title}"${note ? `: ${note}` : ''}`;

    try {
      const ws = get().pages[pageId]?.workspace ?? '';
      if (ws && useWorkspace.getState().encryptedEnabled(ws)) {
        const env = await useWorkspaceKeys.getState().encryptForWorkspace(ws, body);
        if (!env) {
          toast('assigned, but the note could not be posted while the vault is locked', 'error');
          return false;
        }
        await commentsApi.create(pageId, env, others, rowId);
      } else {
        await commentsApi.create(pageId, body, others, rowId);
      }
      return true;
    } catch (err) {
      // The assignment already landed; only the telling failed, and saying which
      // matters more than a generic failure.
      console.error('[data] assignAndNotify: assigned but could not notify', err);
      toast('assigned, but could not send the notification', 'error');
      return false;
    }
  },

  setPageSheet: (pageId, data) => {
    // Same refusal as the currency board: PocketBase drops an unknown field
    // instead of rejecting the write, so without the column the only copy of a
    // spreadsheet would be one browser's localStorage. The tab is already
    // read-only in that state; this guards the next caller that is not.
    if (pageFieldKnown.sheet === false) {
      console.error('[data] pages.sheet column missing. This install predates the field: add an optional JSON field named sheet to the pages collection in the PocketBase dashboard (the toast stays plain on purpose)');
      toast('Could not save the sheet: this Waypoint is not set up to store it yet.', 'error');
      return;
    }
    set((s) => {
      const p = s.pages[pageId];
      if (!p) return s;
      return { pages: { ...s.pages, [pageId]: { ...p, sheet: data } } };
    });
    try {
      localStorage.setItem(`waypoint:sheet:${pageId}`, JSON.stringify(data));
    } catch {
      /* ignore quota */
    }
    const seq = beginWrite(pageId, 'sheet');
    debounceWrite(`page-sheet-${pageId}`, () => {
      pagesApi
        .update(pageId, { sheet: data })
        .catch((err) => pageFieldWriteFailed('sheet', err))
        .finally(() => endWrite(pageId, 'sheet', seq));
    });
  },
  setPageCards: (pageId, data) => {
    // Refuses when the column is known missing, so a deck can never exist
    // only in one browser's localStorage. Same contract as the currency board.
    if (pageFieldKnown.cards === false) {
      console.error('[data] pages.cards column missing. This install predates the field: add an optional JSON field named cards to the pages collection in the PocketBase dashboard (the toast stays plain on purpose)');
      toast('Could not save the deck: this Waypoint is not set up to store it yet.', 'error');
      return;
    }
    set((s) => {
      const p = s.pages[pageId];
      if (!p) return s;
      return { pages: { ...s.pages, [pageId]: { ...p, cards: data } } };
    });
    try {
      localStorage.setItem(`waypoint:cards:${pageId}`, JSON.stringify(data));
    } catch {
      /* ignore quota */
    }
    const seq = beginWrite(pageId, 'cards');
    debounceWrite(`page-cards-${pageId}`, () => {
      pagesApi
        .update(pageId, { cards: data })
        .catch((err) => pageFieldWriteFailed('deck', err))
        .finally(() => endWrite(pageId, 'cards', seq));
    });
  },
  setPageRota: (pageId, data) => {
    // Refuses when the column is known missing, so a rota can never exist
    // only in one browser's localStorage. Same contract as the currency board.
    if (pageFieldKnown.rota === false) {
      console.error('[data] pages.rota column missing. This install predates the field: add an optional JSON field named rota to the pages collection in the PocketBase dashboard (the toast stays plain on purpose)');
      toast('Could not save the rota: this Waypoint is not set up to store it yet.', 'error');
      return;
    }
    set((s) => {
      const p = s.pages[pageId];
      if (!p) return s;
      return { pages: { ...s.pages, [pageId]: { ...p, rota: data } } };
    });
    try {
      localStorage.setItem(`waypoint:rota:${pageId}`, JSON.stringify(data));
    } catch {
      /* ignore quota */
    }
    const seq = beginWrite(pageId, 'rota');
    debounceWrite(`page-rota-${pageId}`, () => {
      pagesApi
        .update(pageId, { rota: data })
        .catch((err) => pageFieldWriteFailed('rota', err))
        .finally(() => endWrite(pageId, 'rota', seq));
    });
  },
  setPageBracket: (pageId, data) => {
    // Refuses when the column is known missing, so a bracket can never exist
    // only in one browser's localStorage. Same contract as the currency board.
    if (pageFieldKnown.bracket === false) {
      console.error('[data] pages.bracket column missing. This install predates the field: add an optional JSON field named bracket to the pages collection in the PocketBase dashboard (the toast stays plain on purpose)');
      toast('Could not save the bracket: this Waypoint is not set up to store it yet.', 'error');
      return;
    }
    set((s) => {
      const p = s.pages[pageId];
      if (!p) return s;
      return { pages: { ...s.pages, [pageId]: { ...p, bracket: data } } };
    });
    try {
      localStorage.setItem(`waypoint:bracket:${pageId}`, JSON.stringify(data));
    } catch {
      /* ignore quota */
    }
    const seq = beginWrite(pageId, 'bracket');
    debounceWrite(`page-bracket-${pageId}`, () => {
      pagesApi
        .update(pageId, { bracket: data })
        .catch((err) => pageFieldWriteFailed('bracket', err))
        .finally(() => endWrite(pageId, 'bracket', seq));
    });
  },
  setPageFiles: (pageId, files) => {
    set((s) => {
      const p = s.pages[pageId];
      return p ? { pages: { ...s.pages, [pageId]: { ...p, files } } } : s;
    });
    try {
      localStorage.setItem(`waypoint:files:${pageId}`, JSON.stringify(files));
    } catch {
      /* ignore quota */
    }
    const seq = beginWrite(pageId, 'files');
    debounceWrite(`page-files-${pageId}`, () => {
      pagesApi
        .update(pageId, { files })
        .catch((err) => console.error('[data] setPageFiles failed', err))
        .finally(() => endWrite(pageId, 'files', seq));
    });
  },

  persistPageFiles: async (pageId, files) => {
    set((s) => {
      const p = s.pages[pageId];
      return p ? { pages: { ...s.pages, [pageId]: { ...p, files } } } : s;
    });
    try {
      localStorage.setItem(`waypoint:files:${pageId}`, JSON.stringify(files));
    } catch {
      /* ignore quota */
    }
    // Write it, and NEVER take it back out of the store. There used to be a
    // verify-then-revert here, and that revert was the bug: it removed the list AND
    // the localStorage mirror, so a file that had saved perfectly well vanished from
    // the tab and only came back on the next refetch. Every "it disappeared, I had to
    // refresh" report traced to this, not to the write, which the database showed
    // succeeding all along.
    //
    // Whether the column exists is settled BEFORE anything is uploaded now
    // (pageFilesFieldExists), so there is nothing left to discover here and nothing
    // to undo. A failed request just leaves the optimistic value, which is how every
    // other optimistic field in this store behaves; the next hydrate reconciles it.
    const seq = beginWrite(pageId, 'files');
    try {
      await pb.collection('pages').update(pageId, { files });
      return true;
    } catch (err) {
      console.error('[data] persistPageFiles failed', err);
      return false;
    } finally {
      endWrite(pageId, 'files', seq);
    }
  },

  // Unknown is treated as YES here: a transient failure must not block an upload,
  // and the write path can still tell afterwards.
  pageFilesFieldExists: async (pageId) => (await pageColumnExists(pageId, 'files')) ?? true,

  // Unknown is treated as NO here, the opposite call, and deliberately. A board the
  // Currency tab cannot save server-side would live only in this browser's
  // localStorage, and quietly: PocketBase DROPS an unknown field instead of
  // rejecting the write, so nothing throws, nothing toasts, and the board looks
  // synced right up until you clear site data or open the page anywhere else. The
  // tab stays read-only until the column is confirmed present. This is the same
  // refusal the Files tab makes, for the same reason.
  pageRatesFieldExists: async (pageId) => (await pageColumnExists(pageId, 'rates')) ?? false,
  pageSheetFieldExists: async (pageId) => (await pageColumnExists(pageId, 'sheet')) ?? false,
  pageCardsFieldExists: async (pageId) => (await pageColumnExists(pageId, 'cards')) ?? false,
  pageRotaFieldExists: async (pageId) => (await pageColumnExists(pageId, 'rota')) ?? false,
  pageBracketFieldExists: async (pageId) => (await pageColumnExists(pageId, 'bracket')) ?? false,

  persistPagePhotos: async (pageId, photos) => {
    const prev = get().pages[pageId]?.photos ?? [];
    const revert = () => {
      set((s) => {
        const p = s.pages[pageId];
        return p ? { pages: { ...s.pages, [pageId]: { ...p, photos: prev } } } : s;
      });
      try {
        if (prev.length) localStorage.setItem(`waypoint:photos:${pageId}`, JSON.stringify(prev));
        else localStorage.removeItem(`waypoint:photos:${pageId}`);
      } catch {
        /* ignore */
      }
    };
    set((s) => {
      const p = s.pages[pageId];
      return p ? { pages: { ...s.pages, [pageId]: { ...p, photos } } } : s;
    });
    try {
      localStorage.setItem(`waypoint:photos:${pageId}`, JSON.stringify(photos));
    } catch {
      /* ignore quota */
    }
    // ONE update, awaited, and we check the server handed the gallery back. A
    // `photos` field that does not exist on the collection is dropped SILENTLY by
    // PocketBase, and the localStorage mirror then hides that from the UI, so
    // "it saved" is not something the caller may assume here. "Did anything come
    // back", not "did the same count", so a concurrent edit is not read as failure.
    // A failed write reverts, or the gallery would look saved on this browser while
    // the images are about to be cut out of the body.
    const seq = beginWrite(pageId, 'photos');
    try {
      // Raw record, same reasoning as persistPageFiles: `undefined` is the only
      // signal that means "this column does not exist". A length comparison turns a
      // successful save into a revert, which here would cut images out of the notes
      // body on the strength of a gallery write that actually landed.
      const rec = await pb.collection('pages').update(pageId, { photos });
      const kept = (rec as { photos?: unknown }).photos !== undefined;
      if (!kept) revert();
      return kept;
    } catch (err) {
      console.error('[data] persistPagePhotos failed', err);
      revert();
      return false;
    } finally {
      endWrite(pageId, 'photos', seq);
    }
  },

  setPagePhotos: (pageId, photos) => {
    set((s) => {
      const p = s.pages[pageId];
      return p ? { pages: { ...s.pages, [pageId]: { ...p, photos } } } : s;
    });
    try {
      localStorage.setItem(`waypoint:photos:${pageId}`, JSON.stringify(photos));
    } catch {
      /* ignore quota */
    }
    const seq = beginWrite(pageId, 'photos');
    debounceWrite(`page-photos-${pageId}`, () => {
      pagesApi
        .update(pageId, { photos })
        .catch((err) => console.error('[data] setPagePhotos failed', err))
        .finally(() => endWrite(pageId, 'photos', seq));
    });
  },

  setPageDefaultTab: (pageId, tab) => {
    set((s) => {
      const p = s.pages[pageId];
      return p ? { pages: { ...s.pages, [pageId]: { ...p, defaultTab: tab } } } : s;
    });
    try {
      localStorage.setItem(`waypoint:defaulttab:${pageId}`, tab);
    } catch {
      /* ignore quota */
    }
    const seq = beginWrite(pageId, 'defaultTab');
    debounceWrite(`page-defaulttab-${pageId}`, () => {
      pagesApi
        .update(pageId, { defaultTab: tab })
        .catch((err) => console.error('[data] setPageDefaultTab failed', err))
        .finally(() => endWrite(pageId, 'defaultTab', seq));
    });
  },

  createKanbanBoard: async (pageId) => {
    const page = get().pages[pageId];
    if (!page) return null;
    const ws = page.workspace || activeWsForWrite();
    const old = page.kanban;
    const cName = uid('c'), cStage = uid('c'), cLabels = uid('c'), cWho = uid('c'), cDue = uid('c'), cDesc = uid('c'), cList = uid('c');
    // Stage options come from the old inline columns (so a migration keeps them)
    // or a sensible default.
    const stageSrc = old?.columns?.length ? old.columns.map((c) => c.title || 'Stage') : ['To do', 'Doing', 'Done'];
    const stageOptions = stageSrc.map((label, i) => ({ id: uid('o'), label, color: pickTagColor(i) }));
    const columns: Column[] = [
      { id: cName, name: 'Title', type: 'text', width: 240 },
      { id: cStage, name: 'Stage', type: 'select', width: 140, options: stageOptions },
      { id: cLabels, name: 'Labels', type: 'multiselect', width: 160, options: [] },
      { id: cWho, name: 'Assignees', type: 'person', width: 160 },
      { id: cDue, name: 'Due', type: 'date', width: 130 },
      { id: cList, name: 'Checklist', type: 'checklist', width: 140 },
      { id: cDesc, name: 'Description', type: 'text', width: 280 },
    ];
    try {
      const tbl = await tablesApi.create({ name: page.title || 'Board', columns, workspace: ws });
      set((s) => ({ tables: { ...s.tables, [tbl.id]: { ...tbl } } }));
      get().setTableView(tbl.id, { ...defaultViewConfig(), name: 'Board', type: 'board', groupColumnId: cStage });
      // Migrate old inline cards into rows, preserving their stage.
      if (old?.columns?.length) {
        for (const col of old.columns) {
          const opt = stageOptions.find((o) => o.label === (col.title || 'Stage'));
          for (const card of col.cards) {
            await get().addRow(tbl.id, { [cName]: card.title, [cStage]: opt?.id ?? null, [cDesc]: card.note ?? '' });
          }
        }
      }
      get().setPageKanban(pageId, { tableId: tbl.id });
      return tbl.id;
    } catch (err) {
      console.error('[data] createKanbanBoard failed', err);
      return null;
    }
  },

  importKanbanBoard: async (pageId, plan) => {
    const page = get().pages[pageId];
    if (!page) return null;
    const ws = page.workspace || activeWsForWrite();
    try {
      const tbl = await tablesApi.create({ name: plan.name || 'Board', columns: plan.columns, workspace: ws });
      set((s) => ({ tables: { ...s.tables, [tbl.id]: { ...tbl } } }));
      const view = { ...defaultViewConfig(), name: 'Board', type: 'board' as const, groupColumnId: plan.groupColumnId };
      get().setTableView(tbl.id, view);
      saveViewConfig(tbl.id, view);
      // Rows in order; addRow handles encryption + workspace stamping, setRowContent
      // fills the card's page body where the bundle carried one.
      for (const card of plan.cards) {
        const rowId = await get().addRow(tbl.id, card.cells);
        if (rowId && card.body) get().setRowContent(rowId, card.body);
      }
      get().setPageKanban(pageId, { tableId: tbl.id });
      return tbl.id;
    } catch (err) {
      console.error('[data] importKanbanBoard failed', err);
      return null;
    }
  },

  upsertKanbanBoard: async (pageId, plan) => {
    const tableId = get().pages[pageId]?.kanban?.tableId;
    if (!tableId || !get().tables[tableId]) return null;
    try {
      // Fold in any new columns / select options first, so cell writes below
      // resolve against them. The board view is untouched: it keeps grouping by
      // its existing stage column, and new options show up as lanes on their own.
      if (plan.columnsChanged) {
        set((s) => {
          const tbl = s.tables[tableId];
          if (!tbl) return s;
          return { tables: { ...s.tables, [tableId]: { ...tbl, columns: plan.columns } } };
        });
        await tablesApi.update(tableId, { columns: plan.columns });
      }
      // Matched cards: setCell handles encryption + automations and coalesces the
      // per-row writes; setRowContent fills the body when the card carried one. A
      // still-encrypted row (locked vault) is skipped by setCell's own guard.
      for (const u of plan.updates) {
        for (const [cid, v] of Object.entries(u.cells)) get().setCell(u.rowId, cid, v);
        if (u.body) get().setRowContent(u.rowId, u.body);
      }
      for (const c of plan.creates) {
        const rowId = await get().addRow(tableId, c.cells);
        if (rowId && c.body) get().setRowContent(rowId, c.body);
      }
      return tableId;
    } catch (err) {
      console.error('[data] upsertKanbanBoard failed', err);
      return null;
    }
  },

  restoreBackup: async (backup) => {
    // Recreate a backup into the ACTIVE workspace as brand-new records: mint
    // fresh ids for every table/row/page (so nothing existing is overwritten) and
    // rewrite references (page links, table embeds, row refs, relations, kanban
    // boards, map/mindmap/flow canvases, view configs) onto them.
    // Reuses the store's own writers (tablesApi.create / addRow / setCell /
    // createPage / renamePage / encryptForWorkspace) so encryption stays correct,
    // it never writes plaintext into an encrypted workspace.
    const ws = activeWsForWrite();
    const encrypted = useWorkspace.getState().encryptedEnabled(ws);
    const wk = useWorkspaceKeys.getState();
    const idMap = new Map<string, string>();
    const counts: RestoreCounts = { pages: 0, tables: 0, rows: 0 };

    // Phase 1a, tables (columns only; views/automations follow in phase 2, once
    // every id is known), collect the id map.
    const tableCreates: { table: BackupFile['tables'][number]; newId: string }[] = [];
    for (const t of backup.tables) {
      try {
        const created = await tablesApi.create({ name: t.name || 'Table', columns: t.columns, workspace: ws });
        set((s) => ({ tables: { ...s.tables, [created.id]: { ...created } } }));
        idMap.set(t.id, created.id);
        tableCreates.push({ table: t, newId: created.id });
        counts.tables++;
      } catch (err) {
        console.error('[data] restore: table create failed', err);
      }
    }

    // Phase 1b, empty rows in backup order, which is position order (cells
    // filled in phase 2, once every id is known so a relation to another row
    // resolves), collect the id map.
    const rowCreates: { row: BackupFile['tables'][number]['rows'][number]; newId: string }[] = [];
    for (const { table, newId: tableNewId } of tableCreates) {
      for (const r of table.rows) {
        const newRowId = await get().addRow(tableNewId, {}, '');
        if (newRowId) {
          idMap.set(r.id, newRowId);
          rowCreates.push({ row: r, newId: newRowId });
          counts.rows++;
        }
      }
    }

    // Phase 1c, pages (parents before children), title + icon now; content and
    // the JSON canvases later, once every id is known.
    const pageCreates: { page: BackupFile['pages'][number]; newId: string }[] = [];
    for (const p of orderPagesByParent(backup.pages)) {
      const newParent = p.parent ? idMap.get(p.parent) ?? '' : '';
      const newId = await get().createPage(newParent, false);
      if (!newId) continue;
      idMap.set(p.id, newId);
      pageCreates.push({ page: p, newId });
      counts.pages++;
      if (p.title) get().renamePage(newId, p.title);
      if (p.icon) get().setPageIcon(newId, p.icon);
      if (p.cover) get().setPageCover(newId, p.cover);
    }

    // Phase 2a, remapped cells through setCell (encrypts + coalesces per row),
    // then the row extras: sub-item parent and the row's page body.
    for (const { row, newId } of rowCreates) {
      const mapped = remapDeep(row.cells, idMap);
      for (const [colId, value] of Object.entries(mapped)) get().setCell(newId, colId, value as CellValue);
      const newParent = row.parent ? idMap.get(row.parent) : undefined;
      if (newParent) get().setRowParent(newId, newParent);
      if (row.content && typeof row.content === 'object') get().setRowContent(newId, remapDeep(row.content, idMap));
    }
    // Phase 2b, table view config + automations (they reference column ids,
    // which the columns kept, and possibly table/row ids, which remap). The
    // columns themselves can point at another table too (a relation's
    // relationTableId, button actions), so remap and re-persist them when
    // anything changed; phase 1a wrote them before the id map was complete.
    for (const { table, newId } of tableCreates) {
      const cols = remapDeep(table.columns, idMap);
      if (JSON.stringify(cols) !== JSON.stringify(table.columns)) {
        set((s) => {
          const tbl = s.tables[newId];
          return tbl ? { tables: { ...s.tables, [newId]: { ...tbl, columns: cols } } } : s;
        });
        persistColumns(newId, cols, 'restore columns');
      }
      if (table.views) get().setTableView(newId, remapDeep(table.views, idMap));
      if (table.automations?.length) get().setTableAutomations(newId, remapDeep(table.automations, idMap));
    }
    // Phase 2c, remapped page content. Encrypt before storing in an encrypted
    // workspace (skip rather than store plaintext if the vault isn't ready), then
    // reset collab so the fresh page's shared doc seeds from what we just wrote.
    // The JSON canvases (map/mindmap/flow/kanban) remap too, so a board finds
    // its restored table and routes find their pins.
    for (const { page, newId } of pageCreates) {
      if (page.map) get().setPageMap(newId, remapDeep(page.map, idMap));
      if (page.mindmap) get().setPageMindmap(newId, remapDeep(page.mindmap, idMap));
      if (page.flow) get().setPageFlow(newId, remapDeep(page.flow, idMap));
      if (page.kanban) get().setPageKanban(newId, remapDeep(page.kanban, idMap));
      // The page's remaining own data. A tier list and a currency board carry no ids
      // but go through remapDeep anyway, for the same reason the sweep scans them:
      // blunt and uniform beats a special case that is wrong later. `rates` refuses
      // itself when the column is missing, which is why it is guarded on being there
      // at all rather than called for every page.
      if (page.tierlist) get().setPageTierlist(newId, remapDeep(page.tierlist, idMap) as NonNullable<Page['tierlist']>);
      if (page.rates) get().setPageRates(newId, remapDeep(page.rates, idMap) as NonNullable<Page['rates']>);
      if (page.sheet) get().setPageSheet(newId, remapDeep(page.sheet, idMap) as NonNullable<Page['sheet']>);
      if (page.cards) get().setPageCards(newId, remapDeep(page.cards, idMap) as NonNullable<Page['cards']>);
      if (page.rota) get().setPageRota(newId, remapDeep(page.rota, idMap) as NonNullable<Page['rota']>);
      if (page.bracket) get().setPageBracket(newId, remapDeep(page.bracket, idMap) as NonNullable<Page['bracket']>);
      if (page.photos?.length) get().setPagePhotos(newId, remapDeep(page.photos, idMap) as Page['photos']);
      if (page.files?.length) get().setPageFiles(newId, remapDeep(page.files, idMap) as Page['files']);
      if (page.defaultTab) get().setPageDefaultTab(newId, page.defaultTab);
      const content = page.content;
      if (!content || typeof content !== 'object') continue;
      const doc = remapDeep(content, idMap);
      if (encrypted) {
        const env = await wk.encryptForWorkspace(ws, doc);
        if (!env) continue;
        get().setPageContent(newId, env);
      } else {
        get().setPageContent(newId, doc);
      }
      get().resetPageCollab(newId);
    }
    // Phase 3, heal dead references. A LIVE page can still point at a table id
    // that no longer exists (its table was deleted out from under it) while the
    // backup carries that table under the same original id. Repoint those pages
    // at the restored copy so restoring a backup actually fixes them: the
    // kanban binding always (plaintext JSON), the body embeds when the content
    // is readable plaintext (an envelope is opaque, left alone). Content is
    // written through the guarded setPageContent + resetPageCollab pair, the
    // same out-of-editor path capture/restore already use.
    const restoredPageIds = new Set(pageCreates.map((p) => p.newId));
    const fixes = deadTableRemaps(idMap, new Set(Object.keys(get().tables)), Object.values(get().pages), restoredPageIds);
    for (const f of fixes) {
      const page = get().pages[f.pageId];
      if (!page) continue;
      if (f.kanban && page.kanban?.tableId) {
        get().setPageKanban(f.pageId, { ...page.kanban, tableId: f.remap[page.kanban.tableId] ?? page.kanban.tableId });
      }
      if (f.content && page.content && typeof page.content === 'object') {
        get().setPageContent(f.pageId, remapTableIds(page.content, f.remap) as object);
        get().resetPageCollab(f.pageId);
      }
    }
    const created: RestoreCreated = {
      pageIds: pageCreates.map((p) => p.newId),
      tableIds: tableCreates.map((t) => t.newId),
      rowIds: rowCreates.map((r) => r.newId),
    };
    return { ...counts, created };
  },

  turnPageIntoWorkspace: async (pageId) => {
    const data = get();
    const page = data.pages[pageId];
    if (!page || page.trashed) return { ok: false, reason: 'page not found' };

    const ws = useWorkspace.getState();
    const sourceWs = page.workspace ?? '';
    if (ws.usingDefault || !sourceWs) return { ok: false, reason: 'workspaces are not set up yet' };

    const sourceEncrypted = ws.encryptedEnabled(sourceWs);
    const wk = useWorkspaceKeys.getState();

    // An encrypted source must be readable in the clear to re-encrypt under the new
    // key. Abort with the unlock prompt like backup restore; never store plaintext of
    // encrypted content.
    if (sourceEncrypted && useVault.getState().status !== 'unlocked') {
      useVault.getState().openPanel();
      return { ok: false, reason: 'unlock your vault to move an encrypted page' };
    }

    // 1a. Decrypt each moved page's body + title up front (source key): a locked
    //     page's stored content is an opaque envelope, so embedded-table ids can only
    //     be read from the decrypted doc, and the bodies re-encrypt under the new key.
    const movedPageIds = descendantPageIds(data.pages, pageId);
    const plainContent: Record<string, unknown> = {};
    const plainTitle: Record<string, string> = {};
    for (const pid of movedPageIds) {
      const p = data.pages[pid];
      if (!p) continue;
      try {
        plainContent[pid] = isEnvelope(p.content) ? await wk.decryptForWorkspace(sourceWs, p.content as string) : p.content;
        plainTitle[pid] = isEnvelope(p.title) ? String(await wk.decryptForWorkspace(sourceWs, p.title)) : p.title;
      } catch {
        return { ok: false, reason: 'could not read part of this page tree; try again once the vault is ready' };
      }
    }

    const movedSet = collectMovedSet(data.pages, data.tables, data.rows, pageId, plainContent);
    const moved = movedIdsOf(movedSet);

    // 1b. Decrypt any still-encrypted moved rows so their cells re-encrypt cleanly
    //     under the new key.
    const plainCells: Record<string, Record<string, CellValue>> = {};
    for (const rid of movedSet.rowIds) {
      const r = data.rows[rid];
      if (!r) continue;
      if (r.cellsEnc) {
        try {
          const secret = await wk.decryptForWorkspace(sourceWs, r.cellsEnc);
          plainCells[rid] = secret && typeof secret === 'object' ? { ...r.cells, ...(secret as Record<string, CellValue>) } : r.cells;
        } catch {
          return { ok: false, reason: 'could not read encrypted rows in this tree; try again once the vault is ready' };
        }
      } else {
        plainCells[rid] = r.cells;
      }
    }

    // 2. Create the target workspace (kept inactive until the move lands) and mirror
    //    the source's encryption. For an encrypted target, mint its content key now
    //    (the "first in" path) so every re-encryption below has a key; clean up and
    //    abort if it can't be minted, rather than fall back to plaintext.
    const wsName = (displayTitle(plainTitle[pageId]) || 'Workspace').slice(0, 80);
    const wsIcon = page.icon && !isImageIcon(page.icon) ? page.icon : '🗺️';
    const newWs = await ws.createWorkspace(wsName, wsIcon, false);
    if (!newWs) return { ok: false, reason: 'could not create the workspace' };

    const cleanupNewWs = async () => {
      const mine = useWorkspace.getState().members.find((m) => m.workspace === newWs);
      if (mine) { try { await workspaceMembersApi.remove(mine.id); } catch { /* ignore */ } }
      try { await workspacesApi.remove(newWs); } catch { /* an empty leftover ws is harmless */ }
      useWorkspace.setState((s) => ({
        workspaces: s.workspaces.filter((w) => w.id !== newWs),
        members: s.members.filter((m) => m.workspace !== newWs),
      }));
    };

    if (sourceEncrypted) {
      await ws.setWorkspaceEncrypted(true, newWs);
      const key = await wk.ensure(newWs);
      if (!key) {
        await cleanupNewWs();
        return { ok: false, reason: 'could not set up encryption for the new workspace' };
      }
    }
    const newEncrypted = sourceEncrypted;

    // 3. Precompute every re-encrypted value BEFORE any write, so a crypto failure
    //    aborts cleanly (never a half-moved, half-encrypted tree).
    const contentOut: Record<string, unknown> = {};
    const titleOut: Record<string, string> = {};
    const cellsOut: Record<string, Record<string, CellValue>> = {};
    if (newEncrypted) {
      try {
        for (const pid of movedPageIds) {
          const env = await wk.encryptForWorkspace(newWs, plainContent[pid]);
          if (!env) throw new Error('content');
          contentOut[pid] = env;
          const tenv = await wk.encryptForWorkspace(newWs, plainTitle[pid]);
          if (!tenv) throw new Error('title');
          titleOut[pid] = tenv;
        }
        for (const rid of movedSet.rowIds) {
          const cols = data.tables[data.rows[rid]?.table ?? '']?.columns ?? [];
          const persisted = await cellsToPersist(newWs, plainCells[rid], cols);
          if (persisted == null) throw new Error('cells');
          cellsOut[rid] = persisted;
        }
      } catch {
        await cleanupNewWs();
        return { ok: false, reason: 'could not re-encrypt the content for the new workspace' };
      }
    }

    // 4. Relocate. Idempotent per record (re-stamp by id) and fail-safe per item. The
    //    workspace-FK writes are tracked in `fkWrites` and awaited before the notice
    //    appears (step 6), so a fast convert -> Revert can't delete the new workspace
    //    while a record still points at it, and a partial failure surfaces instead of
    //    silently stranding a record. The content/title writes stay debounce-coalesced
    //    (a later Revert write replaces an in-flight one on the same key), so they are
    //    deliberately not in this set.
    const fkWrites: Promise<boolean>[] = [];
    const track = (label: string, p: Promise<unknown>): Promise<boolean> =>
      p.then(() => true, (err) => { console.error(label, err); return false; });
    // 4a. Tables (workspace FK only; columns unchanged).
    set((s) => {
      const tables = { ...s.tables };
      for (const tid of movedSet.tableIds) if (tables[tid]) tables[tid] = { ...tables[tid], workspace: newWs };
      return { tables };
    });
    for (const tid of movedSet.tableIds) {
      fkWrites.push(track('[data] move table failed', tablesApi.update(tid, { workspace: newWs })));
    }
    // 4b. Rows: workspace FK, and re-encrypted cells for an encrypted target. The
    //     in-memory cells stay decrypted plaintext for display.
    set((s) => {
      const rows = { ...s.rows };
      for (const rid of movedSet.rowIds) {
        const r = rows[rid];
        if (r) rows[rid] = { ...r, workspace: newWs, cells: plainCells[rid] ?? r.cells, cellsEnc: undefined };
      }
      return { rows };
    });
    for (const rid of movedSet.rowIds) {
      const patch = newEncrypted ? { workspace: newWs, cells: cellsOut[rid] } : { workspace: newWs };
      fkWrites.push(track('[data] move row failed', rowsApi.update(rid, patch)));
    }
    // 4c. Pages: ONE combined write per page. Everything the move changes on a page
    //     (workspace FK, the root's parent-clear, the re-encrypted body + title for an
    //     encrypted target, and ydoc:'' to reset collab) goes in a SINGLE update, so we
    //     never fire two concurrent writes to the same page. PocketBase's update is
    //     read-modify-write, so a second concurrent update to the same record reloads
    //     the old row and silently clobbers the first's fields, which is what stranded
    //     the converting page (its workspace change was overwritten by the collab
    //     reset's own page write). The yupdates rows are dropped separately (a
    //     different collection, so no collision).
    set((s) => {
      const pages = { ...s.pages };
      for (const pid of movedPageIds) {
        const p = pages[pid];
        if (!p) continue;
        pages[pid] = {
          ...p,
          workspace: newWs,
          ...(pid === pageId ? { parent: '', order: 0 } : {}),
          // Encrypted target: store the envelope (so the editor decrypts) but keep the
          // title plaintext in memory for display. Plaintext target: content unchanged.
          ...(newEncrypted ? { content: contentOut[pid], title: plainTitle[pid] } : {}),
        };
      }
      return { pages };
    });
    for (const pid of movedPageIds) {
      const patch: Partial<Page> = { workspace: newWs, ydoc: '' };
      if (pid === pageId) { patch.parent = ''; patch.order = 0; }
      if (newEncrypted) { patch.content = contentOut[pid]; patch.title = titleOut[pid]; }
      fkWrites.push(track('[data] move page failed', pagesApi.update(pid, patch)));
      void dropPageYUpdates(pid);
    }

    // 5. Sever the references that point INTO the moved set from records OUTSIDE it.
    //    Ids don't change on a move, so a stale cross-boundary pointer would still
    //    resolve by id into a workspace a viewer can't see; cut it deliberately.
    // 5a. Relations: drop moved row ids from outside rows' relation cells. setCell
    //     re-encrypts under the outside row's own (unchanged) source key and guards
    //     against a mid-flight echo.
    const relSevs = relationSeverances(data.tables, data.rows, moved.rows);
    for (const rel of relSevs) get().setCell(rel.rowId, rel.columnId, rel.newIds);
    // 5b. Page links: blank pageLink / pageRef ids that point at a moved page, on
    //     every OUTSIDE page. Read the decrypted doc, neutralize, write it back and
    //     reset that page's collab. Prior docs are kept in memory for a live revert.
    const contentSevs: { pageId: string; oldContent: unknown }[] = [];
    for (const p of Object.values(data.pages)) {
      if (moved.pages.has(p.id) || p.trashed) continue;
      let doc: unknown;
      try {
        doc = isEnvelope(p.content) ? await wk.decryptForWorkspace(p.workspace ?? '', p.content as string) : p.content;
      } catch {
        continue; // can't read it; leave it intact (best-effort)
      }
      const neu = neutralizeCrossRefs(doc, moved);
      if (!neu.changed) continue;
      try {
        const out = isEnvelope(p.content) ? await wk.encryptForWorkspace(p.workspace ?? '', neu.doc) : neu.doc;
        if (out == null) continue; // couldn't re-encrypt; leave it intact
        contentSevs.push({ pageId: p.id, oldContent: doc });
        // One combined write (content + ydoc:'') so it can't race a separate collab
        // reset on the same page; yupdates dropped separately.
        set((s) => { const pg = s.pages[p.id]; return pg ? { pages: { ...s.pages, [p.id]: { ...pg, content: out } } } : s; });
        fkWrites.push(track('[data] sever page link failed', pagesApi.update(p.id, { content: out, ydoc: '' })));
        void dropPageYUpdates(p.id);
      } catch (err) {
        console.error('[data] sever page link failed', err);
      }
    }

    // 6. Wait for the workspace-FK writes to persist BEFORE offering Revert, so Revert
    //    (which deletes the new workspace) can't strand a record still stamped with it,
    //    and a partial failure is reported rather than swallowed.
    const fkFailed = (await Promise.all(fkWrites)).filter((ok) => !ok).length;

    // Record the revert snapshot (structure + relations to localStorage, the severed
    // docs to memory), land the user in the new workspace, and surface the notice.
    const opId = uid('wsmove_');
    const snap: MoveSnapshot = {
      opId, sourceWs, newWs,
      sourceEncrypted, targetEncrypted: newEncrypted, createdWs: true,
      rootPageId: pageId, rootParent: page.parent ?? '', rootOrder: page.order ?? 0,
      pageIds: movedPageIds, tableIds: movedSet.tableIds, rowIds: movedSet.rowIds,
      relations: relSevs,
    };
    saveMoveSnapshot(snap);
    moveContentSnaps.set(opId, contentSevs);

    useWorkspace.getState().setActiveWorkspace(newWs);
    const notice = { opId, label: `moved “${wsName}” into its own workspace` };
    // Persist the notice so it survives a refresh; only Accept or Revert clears it.
    savePendingMove(notice);
    set({ activePageId: pageId, pendingWorkspaceMove: notice });
    // Refresh the decrypt passes so re-encrypted titles/cells resolve to plaintext fast.
    void wk.decryptTitles();
    void wk.decryptCells();
    // A partial move still leaves the Revert notice up (the escape hatch), but the
    // stranded items are called out so it isn't mistaken for a clean move.
    if (fkFailed) toast(`${fkFailed} item${fkFailed === 1 ? '' : 's'} could not be moved; revert if this looks wrong`, 'error');
    return { ok: true };
  },

  movePageToWorkspace: async (pageId, targetWorkspaceId, parentPageId) => {
    const data = get();
    const page = data.pages[pageId];
    if (!page || page.trashed) return { ok: false, reason: 'page not found' };

    const ws = useWorkspace.getState();
    const sourceWs = page.workspace ?? '';
    const targetWs = targetWorkspaceId;
    if (ws.usingDefault || !sourceWs) return { ok: false, reason: 'workspaces are not set up yet' };
    if (!targetWs || targetWs === sourceWs) return { ok: false, reason: 'pick a different workspace' };
    if (ws.myRole(targetWs) === 'none') return { ok: false, reason: "you're not a member of that workspace" };

    const movedPageIds = descendantPageIds(data.pages, pageId);
    // The destination parent must be a live page in the TARGET workspace (or top
    // level), and can't be one of the pages being moved.
    if (parentPageId) {
      const parent = data.pages[parentPageId];
      if (!parent || parent.trashed || (parent.workspace ?? '') !== targetWs) return { ok: false, reason: 'that destination page is not in the target workspace' };
      if (movedPageIds.includes(parentPageId)) return { ok: false, reason: "can't move a page under itself" };
    }

    const sourceEncrypted = ws.encryptedEnabled(sourceWs);
    const targetEncrypted = ws.encryptedEnabled(targetWs);
    const wk = useWorkspaceKeys.getState();
    // Either side encrypted means we must read/write plaintext in the clear.
    if ((sourceEncrypted || targetEncrypted) && useVault.getState().status !== 'unlocked') {
      useVault.getState().openPanel();
      return { ok: false, reason: 'unlock your vault to move between encrypted workspaces' };
    }

    // 1a. Decrypt each moved page's body + title up front (source key).
    const plainContent: Record<string, unknown> = {};
    const plainTitle: Record<string, string> = {};
    for (const pid of movedPageIds) {
      const p = data.pages[pid];
      if (!p) continue;
      try {
        plainContent[pid] = isEnvelope(p.content) ? await wk.decryptForWorkspace(sourceWs, p.content as string) : p.content;
        plainTitle[pid] = isEnvelope(p.title) ? String(await wk.decryptForWorkspace(sourceWs, p.title)) : p.title;
      } catch {
        return { ok: false, reason: 'could not read part of this page tree; try again once the vault is ready' };
      }
    }
    const movedSet = collectMovedSet(data.pages, data.tables, data.rows, pageId, plainContent);
    const moved = movedIdsOf(movedSet);

    // 1b. Decrypt any still-encrypted moved rows so their cells re-encrypt cleanly.
    const plainCells: Record<string, Record<string, CellValue>> = {};
    for (const rid of movedSet.rowIds) {
      const r = data.rows[rid];
      if (!r) continue;
      if (r.cellsEnc) {
        try {
          const secret = await wk.decryptForWorkspace(sourceWs, r.cellsEnc);
          plainCells[rid] = secret && typeof secret === 'object' ? { ...r.cells, ...(secret as Record<string, CellValue>) } : r.cells;
        } catch {
          return { ok: false, reason: 'could not read encrypted rows in this tree; try again once the vault is ready' };
        }
      } else {
        plainCells[rid] = r.cells;
      }
    }

    // 2. If the target is encrypted, its content key must be available before we write.
    if (targetEncrypted) {
      const key = await wk.ensure(targetWs);
      if (!key) return { ok: false, reason: 'could not get the encryption key for that workspace' };
    }

    // 3. Precompute the TARGET representation of every value. Content/title/cells only
    //    change when either side is encrypted (both-plaintext keeps them verbatim).
    const contentChanged = sourceEncrypted || targetEncrypted;
    const contentOut: Record<string, unknown> = {};
    const titleOut: Record<string, string> = {};
    const cellsOut: Record<string, Record<string, CellValue>> = {};
    if (contentChanged) {
      try {
        for (const pid of movedPageIds) {
          contentOut[pid] = targetEncrypted ? await wk.encryptForWorkspace(targetWs, plainContent[pid]) : plainContent[pid];
          if (contentOut[pid] == null) throw new Error('content');
          const t = targetEncrypted ? await wk.encryptForWorkspace(targetWs, plainTitle[pid]) : plainTitle[pid];
          if (t == null) throw new Error('title');
          titleOut[pid] = t;
        }
        for (const rid of movedSet.rowIds) {
          const cols = data.tables[data.rows[rid]?.table ?? '']?.columns ?? [];
          const persisted = await cellsToPersist(targetWs, plainCells[rid], cols);
          if (persisted == null) throw new Error('cells');
          cellsOut[rid] = persisted;
        }
      } catch {
        return { ok: false, reason: 'could not re-encrypt the content for the target workspace' };
      }
    }

    const rootOrder = Object.values(data.pages).filter((p) => p.parent === parentPageId && !p.trashed).length;
    const fkWrites: Promise<boolean>[] = [];
    const track = (label: string, p: Promise<unknown>): Promise<boolean> =>
      p.then(() => true, (err) => { console.error(label, err); return false; });

    // 4. Relocate (one combined write per page; the read-modify-write hazard again).
    set((s) => {
      const tables = { ...s.tables };
      for (const tid of movedSet.tableIds) if (tables[tid]) tables[tid] = { ...tables[tid], workspace: targetWs };
      return { tables };
    });
    for (const tid of movedSet.tableIds) {
      fkWrites.push(track('[data] move table failed', tablesApi.update(tid, { workspace: targetWs })));
    }
    set((s) => {
      const rows = { ...s.rows };
      for (const rid of movedSet.rowIds) {
        const r = rows[rid];
        if (r) rows[rid] = { ...r, workspace: targetWs, cells: plainCells[rid] ?? r.cells, cellsEnc: undefined };
      }
      return { rows };
    });
    for (const rid of movedSet.rowIds) {
      const patch = contentChanged ? { workspace: targetWs, cells: cellsOut[rid] } : { workspace: targetWs };
      fkWrites.push(track('[data] move row failed', rowsApi.update(rid, patch)));
    }
    set((s) => {
      const pages = { ...s.pages };
      for (const pid of movedPageIds) {
        const p = pages[pid];
        if (!p) continue;
        pages[pid] = {
          ...p,
          workspace: targetWs,
          ...(pid === pageId ? { parent: parentPageId, order: rootOrder } : {}),
          ...(contentChanged ? { content: contentOut[pid], title: plainTitle[pid] } : {}),
        };
      }
      return { pages };
    });
    for (const pid of movedPageIds) {
      const patch: Partial<Page> = { workspace: targetWs, ydoc: '' };
      if (pid === pageId) { patch.parent = parentPageId; patch.order = rootOrder; }
      if (contentChanged) { patch.content = contentOut[pid]; patch.title = titleOut[pid]; }
      fkWrites.push(track('[data] move page failed', pagesApi.update(pid, patch)));
      void dropPageYUpdates(pid);
    }

    // 5. Sever references pointing INTO the moved set from records OUTSIDE it.
    const relSevs = relationSeverances(data.tables, data.rows, moved.rows);
    for (const rel of relSevs) get().setCell(rel.rowId, rel.columnId, rel.newIds);
    const contentSevs: { pageId: string; oldContent: unknown }[] = [];
    for (const p of Object.values(data.pages)) {
      if (moved.pages.has(p.id) || p.trashed) continue;
      let doc: unknown;
      try {
        doc = isEnvelope(p.content) ? await wk.decryptForWorkspace(p.workspace ?? '', p.content as string) : p.content;
      } catch {
        continue;
      }
      const neu = neutralizeCrossRefs(doc, moved);
      if (!neu.changed) continue;
      try {
        const out = isEnvelope(p.content) ? await wk.encryptForWorkspace(p.workspace ?? '', neu.doc) : neu.doc;
        if (out == null) continue;
        contentSevs.push({ pageId: p.id, oldContent: doc });
        set((s) => { const pg = s.pages[p.id]; return pg ? { pages: { ...s.pages, [p.id]: { ...pg, content: out } } } : s; });
        fkWrites.push(track('[data] sever page link failed', pagesApi.update(p.id, { content: out, ydoc: '' })));
        void dropPageYUpdates(p.id);
      } catch (err) {
        console.error('[data] sever page link failed', err);
      }
    }

    // 6. Wait for the FK writes, snapshot for revert, land in the target, notify.
    const fkFailed = (await Promise.all(fkWrites)).filter((ok) => !ok).length;
    const opId = uid('wsmove_');
    const targetName = ws.workspaces.find((w) => w.id === targetWs)?.name || 'workspace';
    const snap: MoveSnapshot = {
      opId, sourceWs, newWs: targetWs,
      sourceEncrypted, targetEncrypted, createdWs: false,
      rootPageId: pageId, rootParent: page.parent ?? '', rootOrder: page.order ?? 0,
      pageIds: movedPageIds, tableIds: movedSet.tableIds, rowIds: movedSet.rowIds,
      relations: relSevs,
    };
    saveMoveSnapshot(snap);
    moveContentSnaps.set(opId, contentSevs);

    useWorkspace.getState().setActiveWorkspace(targetWs);
    const notice = { opId, label: `moved “${displayTitle(plainTitle[pageId]) || 'page'}” into ${targetName}` };
    savePendingMove(notice);
    set({ activePageId: pageId, pendingWorkspaceMove: notice });
    void wk.decryptTitles();
    void wk.decryptCells();
    if (fkFailed) toast(`${fkFailed} item${fkFailed === 1 ? '' : 's'} could not be moved; revert if this looks wrong`, 'error');
    return { ok: true };
  },

  revertWorkspaceMove: async () => {
    const notice = get().pendingWorkspaceMove;
    if (!notice) return;
    const snap = loadMoveSnapshot(notice.opId);
    if (!snap) {
      savePendingMove(null);
      set({ pendingWorkspaceMove: null });
      toast('this move can no longer be reverted', 'error');
      return;
    }
    const wk = useWorkspaceKeys.getState();
    const data = get();
    const pending: Promise<unknown>[] = [];

    // 1. Move the tree back, re-encrypting under the OLD key (symmetric with the
    //    forward move). Restore the root's parent + order. AWAIT the relocation writes
    //    before deleting the created workspace, so no in-flight record is still
    //    stamped with it when it's removed.
    set((s) => {
      const tables = { ...s.tables };
      for (const tid of snap.tableIds) if (tables[tid]) tables[tid] = { ...tables[tid], workspace: snap.sourceWs };
      return { tables };
    });
    for (const tid of snap.tableIds) {
      pending.push(tablesApi.update(tid, { workspace: snap.sourceWs }).catch((err) => console.error('[data] revert table failed', err)));
    }
    set((s) => {
      const rows = { ...s.rows };
      for (const rid of snap.rowIds) if (rows[rid]) rows[rid] = { ...rows[rid], workspace: snap.sourceWs };
      return { rows };
    });
    for (const rid of snap.rowIds) {
      const r = data.rows[rid];
      if (!r) continue;
      let patch: { workspace: string; cells?: Record<string, CellValue> } = { workspace: snap.sourceWs };
      if (snap.sourceEncrypted || snap.targetEncrypted) {
        // The in-memory cells are decrypted plaintext, so cellsToPersist rebuilds the
        // SOURCE representation (re-encrypted if the source ws is encrypted, else plain).
        const cols = data.tables[r.table]?.columns ?? [];
        const persisted = await cellsToPersist(snap.sourceWs, r.cells, cols);
        if (persisted != null) patch = { workspace: snap.sourceWs, cells: persisted };
      }
      pending.push(rowsApi.update(rid, patch).catch((err) => console.error('[data] revert row failed', err)));
    }
    set((s) => {
      const pages = { ...s.pages };
      for (const pid of snap.pageIds) {
        const p = pages[pid];
        if (p) pages[pid] = { ...p, workspace: snap.sourceWs, ...(pid === snap.rootPageId ? { parent: snap.rootParent, order: snap.rootOrder } : {}) };
      }
      return { pages };
    });
    for (const pid of snap.pageIds) {
      const p = data.pages[pid];
      if (!p) continue;
      // ONE combined write per page (same read-modify-write hazard as the forward
      // move): workspace back, root parent/order restored, re-encrypted body + title
      // for an encrypted source, and ydoc:'' to reset collab. yupdates dropped apart.
      const patch: Partial<Page> = { workspace: snap.sourceWs, ydoc: '' };
      if (pid === snap.rootPageId) { patch.parent = snap.rootParent; patch.order = snap.rootOrder; }
      // Re-represent the body + title for the SOURCE workspace: decrypt whatever the
      // TARGET holds (envelope if the target is encrypted), then encrypt for the source
      // only if the source is encrypted. Both-plaintext skips this entirely.
      if (snap.sourceEncrypted || snap.targetEncrypted) {
        try {
          const plainDoc = isEnvelope(p.content) ? await wk.decryptForWorkspace(snap.newWs, p.content as string) : p.content;
          const t = isEnvelope(p.title) ? String(await wk.decryptForWorkspace(snap.newWs, p.title)) : p.title;
          const outDoc = snap.sourceEncrypted ? await wk.encryptForWorkspace(snap.sourceWs, plainDoc) : plainDoc;
          const outTitle = snap.sourceEncrypted ? await wk.encryptForWorkspace(snap.sourceWs, t) : t;
          if (outDoc != null) patch.content = outDoc;
          if (outTitle != null) patch.title = outTitle;
          set((s) => {
            const pg = s.pages[pid];
            // Keep the title plaintext in memory for display; store the source-rep body.
            return pg ? { pages: { ...s.pages, [pid]: { ...pg, title: t, ...(outDoc != null ? { content: outDoc } : {}) } } } : s;
          });
        } catch (err) { console.error('[data] revert page re-encrypt failed', err); }
      }
      pending.push(pagesApi.update(pid, patch).then(() => undefined, (err) => console.error('[data] revert page failed', err)));
      void dropPageYUpdates(pid);
    }

    // 2. Restore severed references: relations to their prior arrays, and the outside
    //    page-link docs held in memory (re-encrypted under the source key if needed).
    for (const rel of snap.relations) get().setCell(rel.rowId, rel.columnId, rel.oldIds);
    for (const cs of moveContentSnaps.get(snap.opId) ?? []) {
      const p = get().pages[cs.pageId];
      if (!p) continue;
      try {
        const out = isEnvelope(p.content) ? await wk.encryptForWorkspace(p.workspace ?? '', cs.oldContent) : cs.oldContent;
        if (out == null) continue;
        set((s) => { const pg = s.pages[cs.pageId]; return pg ? { pages: { ...s.pages, [cs.pageId]: { ...pg, content: out } } } : s; });
        pending.push(pagesApi.update(cs.pageId, { content: out, ydoc: '' }).then(() => undefined, (err) => console.error('[data] revert page link failed', err)));
        void dropPageYUpdates(cs.pageId);
      } catch (err) { console.error('[data] revert page link failed', err); }
    }

    // 3. Switch active back to the source, wait for the relocation writes so a delete
    //    can't strand an in-flight record, and (ONLY when this move created the target)
    //    drop that now-empty workspace and its key rows. A move into an EXISTING
    //    workspace leaves the target alone.
    useWorkspace.getState().setActiveWorkspace(snap.sourceWs);
    await Promise.allSettled(pending);
    if (snap.createdWs) {
      try {
        const keys = await workspaceKeysApi.listForWorkspace(snap.newWs);
        await Promise.allSettled(keys.map((k) => workspaceKeysApi.remove(k.id)));
      } catch { /* best-effort; orphan key rows reference a deleted ws and are harmless */ }
      await useWorkspace.getState().deleteWorkspace(snap.newWs);
    }

    clearMoveSnapshot(snap.opId);
    savePendingMove(null);
    moveContentSnaps.delete(snap.opId);
    set({ pendingWorkspaceMove: null, activePageId: snap.rootPageId });
    void wk.decryptTitles();
    void wk.decryptCells();
    toast('move reverted');
  },

  acceptWorkspaceMove: () => {
    const notice = get().pendingWorkspaceMove;
    if (notice) {
      clearMoveSnapshot(notice.opId);
      moveContentSnaps.delete(notice.opId);
    }
    savePendingMove(null);
    set({ pendingWorkspaceMove: null });
  },

  runFlow: (pageId, nodeId, opts) => {
    const flow = get().pages[pageId]?.flow;
    if (!flow) return { effects: [], log: [] };
    const plan = compileFlow(flow);
    const branch = plan.triggers.find((t) => t.node.id === nodeId);
    if (!branch) return { effects: [], log: plan.errors.map((detail) => ({ nodeId, kind: 'trigger' as const, detail })) };
    const ctx: FlowContext = { vars: {} }; // manual/widget run has no triggering row
    const result = runPlan(branch.steps, flow.edges, ctx, flowEnv());
    if (!opts?.dryRun) {
      pushRunLog({ pageId, at: Date.now(), trigger: 'manual run', detail: result.log.map((e) => e.detail) });
      applyEffects(get, result.effects);
    }
    return result;
  },

  firePageCheckboxFlows: (pageId, oldDoc, newDoc) => {
    if (!automationRunning) runCheckboxFlows(get, pageId, oldDoc, newDoc);
  },

  // Helper-free recursive descendant collection used by trash/restore/delete.
  trashPage: async (id) => {
    const pages = get().pages;
    const ids: string[] = [];
    const collect = (pid: string) => {
      for (const p of Object.values(pages)) if (p.parent === pid) collect(p.id);
      ids.push(pid);
    };
    collect(id);
    const label = pages[id]?.title || 'page';

    set((s) => {
      const next = { ...s.pages };
      for (const rid of ids) if (next[rid]) next[rid] = { ...next[rid], trashed: true };
      let active = s.activePageId;
      if (active && ids.includes(active)) {
        // Pick the next page from the SAME workspace, so trashing doesn't fling
        // you into another workspace.
        const ws = s.pages[id]?.workspace ?? '';
        const sameWs = (p: Page) => (p.workspace ?? '') === ws && !p.trashed;
        const remaining = Object.values(next).filter((p) => sameWs(p) && p.parent !== '');
        active = remaining[0]?.id ?? Object.values(next).find(sameWs)?.id ?? null;
      }
      return {
        pages: next,
        activePageId: active,
        lastAction: {
          kind: 'trash' as const,
          label: `Moved “${label}” to trash`,
          at: Date.now(),
          undo: () => {
            void get().restorePage(id);
          },
        },
      };
    });

    markFlowsDirty(); // trashed pages' flows stop firing; don't wait for the echo
    for (const rid of ids) {
      pagesApi.update(rid, { trashed: true }).catch((err) => {
        console.error('[data] trashPage failed for', rid, err);
        if (navigator.onLine) void get().hydrate();
      });
    }
  },

  restorePage: async (id) => {
    const pages = get().pages;
    const ids: string[] = [];
    const collect = (pid: string) => {
      for (const p of Object.values(pages)) if (p.parent === pid) collect(p.id);
      ids.push(pid);
    };
    collect(id);

    set((s) => {
      const next = { ...s.pages };
      for (const rid of ids) if (next[rid]) next[rid] = { ...next[rid], trashed: false };
      return { pages: next, activePageId: id };
    });

    markFlowsDirty(); // and start again on restore
    for (const rid of ids) {
      pagesApi.update(rid, { trashed: false }).catch((err) => {
        console.error('[data] restorePage failed for', rid, err);
        if (navigator.onLine) void get().hydrate();
      });
    }
  },

  deletePage: async (id) => {
    // Collect descendants client-side and delete deepest-first.
    const pages = get().pages;
    const toRemove: string[] = [];
    const collect = (pid: string) => {
      for (const p of Object.values(pages)) if (p.parent === pid) collect(p.id);
      toRemove.push(pid);
    };
    collect(id);

    // Tables embedded in (or backing) the pages being permanently deleted, so we
    // can clean up the ones nothing else references once the pages are gone.
    const candidateTables: string[] = [];
    for (const rid of toRemove) {
      const p = pages[rid];
      if (!p) continue;
      candidateTables.push(...extractTableIds(p.content));
      if (p.kanban?.tableId) candidateTables.push(p.kanban.tableId);
    }

    // Optimistic local removal.
    set((s) => {
      const next = { ...s.pages };
      for (const rid of toRemove) delete next[rid];
      let active = s.activePageId;
      if (active && toRemove.includes(active)) {
        // Stay in the deleted page's workspace.
        const ws = pages[id]?.workspace ?? '';
        const sameWs = (p: Page) => (p.workspace ?? '') === ws;
        const remaining = Object.values(next).filter((p) => sameWs(p) && p.parent !== '');
        active = remaining[0]?.id ?? Object.values(next).find(sameWs)?.id ?? null;
      }
      return { pages: next, activePageId: active };
    });

    // The pages are gone from the store now, so anything no longer referenced is
    // an orphan, delete those tables and their rows.
    get().gcOrphanTables(candidateTables);

    for (const rid of toRemove) {
      try {
        await pagesApi.remove(rid);
      } catch (err) {
        console.error('[data] deletePage failed for', rid, err);
        if (navigator.onLine) void get().hydrate();
        break;
      }
    }
  },

  emptyTrash: async () => {
    // Each root cascades to its trashed subtree, so deleting the roots clears all.
    for (const root of selectTrashRoots(get().pages)) await get().deletePage(root.id);
  },

  sweepOldTrash: async (maxAgeDays) => {
    const cutoff = Date.now() - maxAgeDays * 86400000;
    const stale = selectTrashRoots(get().pages).filter((p) => {
      const t = new Date(p.updated).getTime();
      return Number.isFinite(t) && t < cutoff; // trashing updates the record, so `updated` is when it was trashed
    });
    for (const p of stale) await get().deletePage(p.id);
    return stale.length;
  },

  renamePage: (id, title) => {
    set((s) => {
      const page = s.pages[id];
      if (!page) return s;
      return { pages: { ...s.pages, [id]: { ...page, title } } };
    });
    const page = get().pages[id];
    const ws = page?.workspace ?? '';
    const wsEncrypted = !!ws && useWorkspace.getState().encryptedEnabled(ws);
    // Guard the title against its own echo: hold the typed value until this save
    // settles, so a trailing echo can't rewind the keystrokes.
    const seq = beginWrite(id, 'title');
    debounceWrite(`page-title-${id}`, () => {
      const done = () => endWrite(id, 'title', seq);
      const persist = (value: string) =>
        pagesApi.update(id, { title: value }).catch((err) => {
          console.error('[data] renamePage failed', err);
          // Offline: don't refetch (it would blank/rewind the title); just keep the
          // optimistic value for the session. Offline edits are NOT synced back.
          if (navigator.onLine) void get().hydrate();
        });
      if (wsEncrypted) {
        // Persist ciphertext; the in-memory title stays plaintext for display. If
        // we can't encrypt (vault locked) we skip the write, never store plaintext.
        void useWorkspaceKeys
          .getState()
          .encryptForWorkspace(ws, title)
          .then((env) => (env ? persist(env) : undefined))
          .finally(done);
      } else {
        void persist(title).finally(done);
      }
    });
  },

  applyTitleDecryptions: (updates) => {
    set((s) => {
      let changed = false;
      const pages = { ...s.pages };
      for (const id in updates) {
        const p = pages[id];
        if (p && p.title !== updates[id]) {
          pages[id] = { ...p, title: updates[id] };
          changed = true;
        }
      }
      return changed ? { pages } : s;
    });
  },

  setPageIcon: (id, icon) => {
    set((s) => {
      const page = s.pages[id];
      if (!page) return s;
      return { pages: { ...s.pages, [id]: { ...page, icon } } };
    });
    // Guard the optimistic icon like every other page field: mark it pending so a
    // realtime echo / hydrate arriving before this save settles can't revert it.
    // (Without this, a freshly set icon showed for a beat then vanished; the twin
    // of the title/cover data-loss class: mark pending on write, keep pending on
    // every reconcile.)
    const seq = beginWrite(id, 'icon');
    pagesApi
      .update(id, { icon })
      .catch((err) => console.error('[data] setPageIcon failed', err))
      .finally(() => endWrite(id, 'icon', seq));
  },

  resetPageCollab: (pageId) => {
    void resetPageCollab(pageId);
  },
  bumpPageCollab: (pageId) => set((s) => ({ pageCollabNonce: { ...s.pageCollabNonce, [pageId]: (s.pageCollabNonce[pageId] ?? 0) + 1 } })),

  setPageContent: (id, content) => {
    const prevContent = get().pages[id]?.content ?? null;
    // Data-loss guards. Page content is always a doc object or an `enc:` envelope
    // string, never null. And an encrypted page must never be replaced by an empty
    // plaintext doc: that is the signature of a failed decrypt or an editor reset
    // (e.g. another device encrypted the page) wiping content we can't read.
    if (content == null) {
      console.warn('[data] setPageContent ignored null content for', id);
      return;
    }
    if (isEnvelope(prevContent) && !isEnvelope(content) && isEmptyDoc(content)) {
      console.warn('[data] setPageContent refused to overwrite encrypted content with an empty doc for', id);
      return;
    }
    // The plaintext twin: never blank a non-empty plaintext page with an empty
    // doc. This is almost always spurious (a Yjs doc mounting before it seeds, a
    // stale editor reset) rather than a real clear, and under collab it wiped whole
    // pages (the doc looked blank, then the blank overwrote the saved content). A
    // deliberate "empty the whole page" is refused too, on purpose: the content is
    // kept rather than silently lost. To actually clear a page, delete it. Partial
    // edits (deleting one widget or line among others) leave a non-empty doc and
    // are untouched.
    if (prevContent != null && !isEnvelope(prevContent) && !isEmptyDoc(prevContent) && !isEnvelope(content) && isEmptyDoc(content)) {
      console.warn('[data] setPageContent refused to blank a non-empty plaintext page for', id);
      return;
    }
    set((s) => {
      const page = s.pages[id];
      if (!page) return s;
      return { pages: { ...s.pages, [id]: { ...page, content } } };
    });
    // Periodic backup (throttled + pruned in lib/versions), of whatever is stored
    // (an envelope stays ciphertext). The previous content is the restore point.
    maybeSnapshot(id, get().pages[id]?.workspace ?? '', prevContent ?? content);
    // pageCheckbox flows: a task checkbox flipping is the one new event source.
    // Encrypted content is opaque (a string), so there's nothing to scan.
    if (!automationRunning && !isEnvelope(content)) runCheckboxFlows(get, id, prevContent, content);
    // NO table GC here, ever. This used to diff prev/new content and delete a
    // table whose embed "went away", but a content write is not proof of user
    // intent: a transiently partial doc projection (mid-bind, a stale save)
    // looked like an embed removal and permanently deleted a live table and all
    // its rows (real data loss, 2026-07-18, recovered from SQLite free pages).
    // A content diff must never cascade server-side deletes. Orphan cleanup
    // stays on deletePage only, where the user explicitly deleted the page.
    const seq = beginProseWrite(id);
    // Save ~500ms after a pause, but flush at least once a second while the user
    // keeps typing (roughly every few characters) so edits sync sooner and aren't
    // stranded mid-paragraph. Still falls back to the pause save when they stop.
    debounceWrite(
      `page-content-${id}`,
      () =>
        pagesApi
          .update(id, { content })
          .catch((err) => console.error('[data] setPageContent failed', err))
          .finally(() => endProseWrite(id, seq)),
      500,
      1000,
    );
  },

  attachToPage: async (pageId, blocks) => {
    if (!blocks.length) return false;
    const page = get().pages[pageId];
    if (!page) return false;
    const ws = page.workspace ?? '';
    const encrypted = useWorkspace.getState().encryptedEnabled(ws);
    const wk = useWorkspaceKeys.getState();

    // The current body as a plain doc: decrypt it first on an encrypted page. If we
    // can't read it (locked vault / failed decrypt) we must not append, appending
    // would overwrite the envelope with a plaintext doc that drops the old content.
    let doc: { type: string; content: unknown[] };
    const raw = page.content;
    if (encrypted && isEnvelope(raw)) {
      const plain = await wk.decryptForPage(page, raw as string).catch(() => null);
      if (!plain || typeof plain !== 'object') {
        toast('Unlock your vault to add files to this page.', 'error');
        return false;
      }
      const p = plain as { type?: string; content?: unknown[] };
      doc = { type: 'doc', content: Array.isArray(p.content) ? [...p.content] : [] };
    } else if (raw && typeof raw === 'object') {
      const p = raw as { type?: string; content?: unknown[] };
      doc = { type: 'doc', content: Array.isArray(p.content) ? [...p.content] : [] };
    } else {
      doc = { type: 'doc', content: [] };
    }

    doc.content.push(...blocks);

    const toStore: unknown = encrypted ? await wk.encryptForWorkspace(ws, doc) : doc;
    if (encrypted && !toStore) {
      toast('Unlock your vault to add files to this page.', 'error');
      return false;
    }
    get().setPageContent(pageId, toStore);
    // resetPageCollab flushes this content write synchronously (so a reopen can't
    // reseed from pre-image content), clears all three collab layers, and sets the
    // force-seed flag, so the next open reseeds from THIS content, not a stale doc.
    await resetPageCollab(pageId);
    return true;
  },

  seedPageContent: async (pageId, doc) => {
    const page = get().pages[pageId];
    if (!page) return false;
    const ws = page.workspace ?? '';
    if (!useWorkspace.getState().encryptedEnabled(ws)) {
      get().setPageContent(pageId, doc);
      return true;
    }
    const env = await useWorkspaceKeys.getState().encryptForWorkspace(ws, doc);
    if (!env) {
      toast('Unlock your vault to put text on a new page here.', 'error');
      return false;
    }
    get().setPageContent(pageId, env);
    return true;
  },

  detachFromPage: async (pageId, url) => {
    if (!url) return false;
    const page = get().pages[pageId];
    if (!page) return false;
    const ws = page.workspace ?? '';
    const encrypted = useWorkspace.getState().encryptedEnabled(ws);
    const wk = useWorkspaceKeys.getState();
    // Read the current body as a plain doc (decrypt on an encrypted page; abort if we
    // can't, so we never overwrite the envelope with a partial doc). Clone it so we
    // never mutate the store's content object in place.
    let doc: { type?: string; content?: unknown[] };
    const raw = page.content;
    if (encrypted && isEnvelope(raw)) {
      const plain = await wk.decryptForPage(page, raw as string).catch(() => null);
      if (!plain || typeof plain !== 'object') {
        toast('Unlock your vault to remove this file.', 'error');
        return false;
      }
      doc = JSON.parse(JSON.stringify(plain));
    } else if (raw && typeof raw === 'object') {
      doc = JSON.parse(JSON.stringify(raw));
    } else {
      return false;
    }
    // Drop any media block pointing at this url (image, audio, file) plus gallery
    // items with this src, anywhere in the doc.
    let removed = false;
    const prune = (nodes: unknown[]): unknown[] =>
      nodes.filter((n) => {
        if (!n || typeof n !== 'object') return true;
        const node = n as { type?: string; attrs?: Record<string, unknown>; content?: unknown[] };
        const nodeUrl = mediaUrlOfNode(node);
        if (nodeUrl && sameUpload(nodeUrl, url)) { removed = true; return false; }
        if (node.type === 'galleryBlock' && Array.isArray(node.attrs?.items)) {
          const items = node.attrs.items as { src?: unknown }[];
          const kept = items.filter((it) => !(typeof it?.src === 'string' && sameUpload(it.src, url)));
          if (kept.length !== items.length) { removed = true; node.attrs.items = kept; }
        }
        if (Array.isArray(node.content)) node.content = prune(node.content);
        return true;
      });
    doc.content = prune(Array.isArray(doc.content) ? doc.content : []);
    if (!removed) return false; // a cover or table attachment, not a body image: nothing here
    const toStore: unknown = encrypted ? await wk.encryptForWorkspace(ws, doc) : doc;
    if (encrypted && !toStore) {
      toast('Unlock your vault to remove this photo.', 'error');
      return false;
    }
    get().setPageContent(pageId, toStore);
    await resetPageCollab(pageId);
    return true;
  },

  purgeUpload: async (url) => {
    const id = uploadRecordIdFromUrl(url);
    // Only a file we serve has a record to delete; a data URL or a remote image
    // lives nowhere on our server.
    if (!id) return { ok: false, blockedBy: ['That file is not stored on this server.'] };
    const s = get();
    // Sweep EVERYTHING loaded, not just the active workspace. The same url is
    // deliberately shared (the Photos "just copy" flow, /audio's "on this page"
    // picker), so one removal never proves it is unused, and a page moved
    // between workspaces carries the url with it while the upload's own stamp
    // stays behind. Over-blocking is the safe direction here; the store only
    // ever holds workspaces you are a member of, so this leaks nothing.
    const refs = referencesToUrl(
      Object.values(s.pages),
      Object.values(s.tables),
      Object.values(s.rows),
      url,
      useWorkspace.getState().workspaces,
    );
    // 'locked' means a page could not be read, not that it uses this file, so it
    // must not make a file LOOK used in the listing.
    const used = refs.filter((r) => r.kind !== 'locked');
    if (used.length) return { ok: false, blockedBy: [...new Set(used.map((r) => r.label))] };
    // But "not a use" is not "proof of non-use", and deleting the blob cannot be
    // undone. An encrypted page we could not read may well embed this file, and
    // with the vault locked EVERY page reads as locked, which would make the sweep
    // come back empty and green-light deleting a file the whole trip uses. Refuse
    // and say why, rather than guess in the irreversible direction.
    const unreadable = [...new Set(refs.filter((r) => r.kind === 'locked').map((r) => r.label))];
    if (unreadable.length) {
      return {
        ok: false,
        blockedBy: [`${unreadable.length} page${unreadable.length === 1 ? '' : 's'} could not be read (unlock your vault first): ${unreadable.slice(0, 2).join(', ')}`],
      };
    }
    try {
      await pb.collection('uploads').delete(id);
      return { ok: true, blockedBy: [] };
    } catch (err) {
      console.error('[uploads] delete failed', id, err);
      return { ok: false, blockedBy: ['The server refused the delete. The file may predate file ownership.'] };
    }
  },

  trashFile: async (url, name, pageId) => {
    if (!uploadRecordIdFromUrl(url)) return; // inline data, nothing on the server
    const me = pb.authStore.record;
    await fileTrashApi.add({
      workspace: activeWsForWrite(),
      url,
      name,
      page: pageId,
      removedBy: me?.id ?? '',
      removedByName: me?.name || me?.email || 'Someone',
    });
  },

  detachManyFromPage: async (pageId, urls) => {
    const targets = new Set(urls.filter(Boolean).map(uploadKey));
    if (!targets.size) return 0;
    const page = get().pages[pageId];
    if (!page) return 0;
    const ws = page.workspace ?? '';
    const encrypted = useWorkspace.getState().encryptedEnabled(ws);
    const wk = useWorkspaceKeys.getState();
    // Same safety as detachFromPage: read the body as a plain doc (decrypt on an
    // encrypted page, abort if we cannot), clone it, never mutate the store in place.
    let doc: { type?: string; content?: unknown[] };
    const raw = page.content;
    if (encrypted && isEnvelope(raw)) {
      const plain = await wk.decryptForPage(page, raw as string).catch(() => null);
      if (!plain || typeof plain !== 'object') {
        toast('Unlock your vault to move these photos.', 'error');
        return 0;
      }
      doc = JSON.parse(JSON.stringify(plain));
    } else if (raw && typeof raw === 'object') {
      doc = JSON.parse(JSON.stringify(raw));
    } else {
      return 0;
    }
    let removed = 0;
    const prune = (nodes: unknown[]): unknown[] =>
      nodes.filter((n) => {
        if (!n || typeof n !== 'object') return true;
        const node = n as { type?: string; attrs?: Record<string, unknown>; content?: unknown[] };
        const mediaUrl = mediaUrlOfNode(node);
        if (mediaUrl && targets.has(uploadKey(mediaUrl))) {
          removed++;
          return false;
        }
        if (node.type === 'galleryBlock' && Array.isArray(node.attrs?.items)) {
          const items = node.attrs.items as { src?: unknown }[];
          const kept = items.filter((it) => !(typeof it?.src === 'string' && targets.has(uploadKey(it.src))));
          if (kept.length !== items.length) {
            removed += items.length - kept.length;
            node.attrs.items = kept;
          }
        }
        if (Array.isArray(node.content)) node.content = prune(node.content);
        return true;
      });
    doc.content = prune(Array.isArray(doc.content) ? doc.content : []);
    if (!removed) return 0;
    const toStore: unknown = encrypted ? await wk.encryptForWorkspace(ws, doc) : doc;
    if (encrypted && !toStore) {
      toast('Unlock your vault to move these photos.', 'error');
      return 0;
    }
    get().setPageContent(pageId, toStore);
    await resetPageCollab(pageId);
    return removed;
  },

  anchorImageThread: async (pageId, src, threadId) => {
    const page = get().pages[pageId];
    if (!page || !threadId) return false;
    const ws = page.workspace ?? '';
    const encrypted = useWorkspace.getState().encryptedEnabled(ws);
    const wk = useWorkspaceKeys.getState();

    // The current body as a plain doc: decrypt on an encrypted page, abort if we
    // can't read it (never write plaintext over the envelope).
    let doc: unknown;
    const raw = page.content;
    if (encrypted && isEnvelope(raw)) {
      const plain = await wk.decryptForPage(page, raw as string).catch(() => null);
      if (!plain || typeof plain !== 'object') {
        toast('Unlock your vault to comment on this image.', 'error');
        return false;
      }
      doc = plain;
    } else if (raw && typeof raw === 'object') {
      doc = raw;
    } else {
      return false;
    }

    const next = setImageThreadId(doc, src, threadId);
    if (!next) return false; // no matching body image (a cover / table attachment can't anchor)

    if (encrypted) {
      const env = await wk.encryptForWorkspace(ws, next);
      if (!env) {
        toast('Unlock your vault to comment on this image.', 'error');
        return false;
      }
      get().setPageContent(pageId, env);
    } else {
      get().setPageContent(pageId, next);
    }
    get().resetPageCollab(pageId);
    return true;
  },

  movePage: (id, newParentId, newOrder) => {
    const before = get().pages[id];
    const prevParent = before?.parent ?? '';
    const prevOrder = before?.order ?? 0;
    set((s) => {
      const page = s.pages[id];
      if (!page) return s;
      // Reject dropping into own descendant.
      let cursor: string = newParentId;
      while (cursor) {
        if (cursor === id) return s;
        cursor = s.pages[cursor]?.parent ?? '';
      }
      const pages = { ...s.pages, [id]: { ...page, parent: newParentId, order: newOrder } };
      const sibs = Object.values(pages)
        .filter((p) => p.parent === newParentId)
        .sort((a, b) => a.order - b.order);
      sibs.forEach((p, i) => {
        pages[p.id] = { ...pages[p.id], order: i };
      });
      return { pages };
    });
    // Persist the moved page and its new siblings' order.
    const pages = get().pages;
    const moved = pages[id];
    if (!moved) return;
    pagesApi.update(id, { parent: moved.parent, order: moved.order }).catch((err) => {
      console.error('[data] movePage failed', err);
      if (navigator.onLine) void get().hydrate();
    });
    Object.values(pages)
      .filter((p) => p.parent === newParentId && p.id !== id)
      .forEach((p) => {
        debounceWrite(`page-order-${p.id}`, () => {
          pagesApi.update(p.id, { order: p.order }).catch(() => {});
        });
      });

    // Only register undo if the move actually changed the parent (a real
    // structural move, not just a reorder during drag).
    if (prevParent !== newParentId) {
      set({
        lastAction: {
          kind: 'move',
          label: `Moved “${moved.title || 'page'}”`,
          at: Date.now(),
          undo: () => {
            get().movePage(id, prevParent, prevOrder);
            // Reversing a move shouldn't itself leave an undo toast.
            set({ lastAction: null });
          },
        },
      });
    }
  },

  // --- sharing / permissions ----------------------------------------------

  setPageVisibility: (id, visibility) => {
    set((s) => {
      const page = s.pages[id];
      if (!page) return s;
      return { pages: { ...s.pages, [id]: { ...page, visibility } } };
    });
    pagesApi.update(id, { visibility }).catch((err) => {
      console.error('[data] setPageVisibility failed', err);
      if (navigator.onLine) void get().hydrate();
    });
  },

  setShare: (pageId, userId, role) => {
    let editors: string[] = [];
    let viewers: string[] = [];
    set((s) => {
      const page = s.pages[pageId];
      if (!page) return s;
      editors = page.editors.filter((u) => u !== userId);
      viewers = page.viewers.filter((u) => u !== userId);
      if (role === 'editor') editors = [...editors, userId];
      else viewers = [...viewers, userId];
      return { pages: { ...s.pages, [pageId]: { ...page, editors, viewers } } };
    });
    pagesApi.update(pageId, { editors, viewers }).catch((err) => {
      console.error('[data] setShare failed', err);
      if (navigator.onLine) void get().hydrate();
    });
  },

  removeShare: (pageId, userId) => {
    let editors: string[] = [];
    let viewers: string[] = [];
    set((s) => {
      const page = s.pages[pageId];
      if (!page) return s;
      editors = page.editors.filter((u) => u !== userId);
      viewers = page.viewers.filter((u) => u !== userId);
      return { pages: { ...s.pages, [pageId]: { ...page, editors, viewers } } };
    });
    pagesApi.update(pageId, { editors, viewers }).catch((err) => {
      console.error('[data] removeShare failed', err);
      if (navigator.onLine) void get().hydrate();
    });
  },

  // --- tables -------------------------------------------------------------

  createTable: async (name) => {
    const colA = uid('c');
    const colB = uid('c');
    const columns: Column[] = [
      { id: colA, name: 'Name', type: 'text', width: 200 },
      { id: colB, name: 'Amount', type: 'number', width: 120 },
    ];
    try {
      const ws = activeWsForWrite();
      const table = await tablesApi.create({ name: name || 'Untitled table', columns, workspace: ws });
      set((s) => ({ tables: { ...s.tables, [table.id]: table } }));
      // Seed one empty row so the table isn't visually empty.
      const row = await rowsApi.create({ table: table.id, cells: {}, position: 0, workspace: ws });
      set((s) => ({ rows: { ...s.rows, [row.id]: row } }));
      return table.id;
    } catch (err) {
      console.error('[data] createTable failed', err);
      return null;
    }
  },

  // Build a real table from a parsed grid (a pasted markdown / CSV-ish table):
  // columns from the header row with types inferred, rows from the data. Reuses
  // the CSV import planner so a numeric column becomes a number, etc.
  createTableFromData: async (name, headers, rows) => {
    try {
      const ws = activeWsForWrite();
      const { newColumns, resolve } = planImport([], { headers, rows });
      const columns: Column[] = newColumns.map((c) => ({ id: uid('c'), name: c.name || 'Column', type: c.type, width: 160 }));
      const newIds: Record<string, string> = {};
      newColumns.forEach((c, i) => {
        newIds[c.name] = columns[i].id;
      });
      const cellRecords = resolve(newIds);
      const table = await tablesApi.create({ name: name || 'Table', columns, workspace: ws });
      set((s) => ({ tables: { ...s.tables, [table.id]: table } }));
      for (let r = 0; r < cellRecords.length; r++) {
        const row = await rowsApi.create({ table: table.id, cells: cellRecords[r], position: r, workspace: ws });
        set((s) => ({ rows: { ...s.rows, [row.id]: row } }));
      }
      return table.id;
    } catch (err) {
      console.error('[data] createTableFromData failed', err);
      return null;
    }
  },

  // Create a table already shaped for a specific view: board gets a Status
  // select column (so kanban columns exist immediately), calendar gets a Date
  // column, etc. The matching view config is persisted so the embed opens in
  // that view rather than the grid.
  createTablePreset: async (preset) => {
    const { columns, view } = buildTablePreset(preset);
    try {
      const ws = activeWsForWrite();
      const table = await tablesApi.create({ name: 'Untitled table', columns, workspace: ws });
      set((s) => ({ tables: { ...s.tables, [table.id]: { ...table, views: view } } }));
      saveViewConfig(table.id, view); // localStorage fallback
      get().setTableView(table.id, view); // server (synced), tolerant if field absent
      const row = await rowsApi.create({ table: table.id, cells: {}, position: 0, workspace: ws });
      set((s) => ({ rows: { ...s.rows, [row.id]: row } }));
      return table.id;
    } catch (err) {
      console.error('[data] createTablePreset failed', err);
      return null;
    }
  },

  // The TTRPG campaign bible: seven linked tables created in one shot. Each is a
  // plain table (created like createTablePreset), then the relation columns are
  // patched to point at their real sibling ids, relations can't self-point at
  // build time because the targets don't exist yet (see lib/campaign.ts).
  createCampaignBundle: async () => {
    try {
      const ws = activeWsForWrite();
      const specs = buildCampaignBundle();
      const idByKey = {} as Record<CampaignKey, string>;
      const orderedIds: string[] = [];
      for (const spec of specs) {
        const table = await tablesApi.create({ name: spec.name, columns: spec.columns, workspace: ws });
        set((s) => ({ tables: { ...s.tables, [table.id]: table } }));
        const row = await rowsApi.create({ table: table.id, cells: {}, position: 0, workspace: ws });
        set((s) => ({ rows: { ...s.rows, [row.id]: row } }));
        idByKey[spec.key] = table.id;
        orderedIds.push(table.id);
      }
      for (const p of relationPatchesFor(specs, idByKey)) {
        get().updateColumn(p.tableId, p.columnId, { relationTableId: p.relationTableId });
      }
      return orderedIds;
    } catch (err) {
      console.error('[data] createCampaignBundle failed', err);
      return [];
    }
  },

  // A form is a table rendered as a form: one table per form key, its `columns`
  // are the schema, each filled-out form is a row. Reuse the key's table if it
  // exists (so adding a field on one form ripples to every form of that key);
  // otherwise spin one up with the default Name / Date / Notes fields.
  findOrCreateFormTable: async (key) => {
    const norm = key.trim();
    if (!norm) return null;
    const existing = Object.values(get().tables).find((t) => t.formKey === norm);
    if (existing) return existing.id;
    const colName = uid('c');
    const colDate = uid('c');
    const colNotes = uid('c');
    const columns: Column[] = [
      { id: colName, name: 'Name', type: 'text', width: 200 },
      { id: colDate, name: 'Date', type: 'date', width: 140 },
      { id: colNotes, name: 'Notes', type: 'text', width: 260 },
    ];
    try {
      const table = await tablesApi.create({ name: `Form: ${norm}`, columns, formKey: norm, workspace: activeWsForWrite() });
      saveFormKey(table.id, norm); // survives the echo if the PB field is missing
      set((s) => ({ tables: { ...s.tables, [table.id]: { ...table, formKey: norm } } }));
      return table.id;
    } catch (err) {
      console.error('[data] findOrCreateFormTable failed', err);
      return null;
    }
  },

  renameTable: (id, name) => {
    set((s) => {
      const tbl = s.tables[id];
      if (!tbl) return s;
      return { tables: { ...s.tables, [id]: { ...tbl, name } } };
    });
    const seq = beginWrite(id, 'name');
    debounceWrite(`table-name-${id}`, () => {
      tablesApi
        .update(id, { name })
        .catch((err) => console.error('[data] renameTable failed', err))
        .finally(() => endWrite(id, 'name', seq));
    });
  },

  setTableView: (tableId, view) => {
    set((s) => {
      const tbl = s.tables[tableId];
      if (!tbl) return s;
      return { tables: { ...s.tables, [tableId]: { ...tbl, views: view } } };
    });
    // Mark 'views' pending so an echo mid-write (e.g. the create-echo of a table
    // whose board view was set right after create, during a kanban import) can't
    // revert it to null and make the board vanish. keepPendingFields holds it.
    const seq = beginWrite(tableId, 'views');
    debounceWrite(`table-views-${tableId}`, () => {
      // Persists view config to the table so it syncs across devices/users. If
      // the `views` JSON field hasn't been added to the tables collection yet,
      // this 400s, caught here; the view still works this session and the
      // localStorage fallback keeps it across reloads until the field exists.
      tablesApi
        .update(tableId, { views: view })
        .catch((err) => console.error('[data] setTableView failed', err))
        .finally(() => endWrite(tableId, 'views', seq));
    });
  },

  setTableAutomations: (tableId, rules) => {
    set((s) => {
      const tbl = s.tables[tableId];
      if (!tbl) return s;
      return { tables: { ...s.tables, [tableId]: { ...tbl, automations: rules } } };
    });
    try {
      localStorage.setItem(`waypoint:automations:${tableId}`, JSON.stringify(rules));
    } catch {
      /* ignore quota */
    }
    const seq = beginWrite(tableId, 'automations');
    debounceWrite(`table-automations-${tableId}`, () => {
      tablesApi
        .update(tableId, { automations: rules })
        .catch((err) => console.error('[data] setTableAutomations failed', err))
        .finally(() => endWrite(tableId, 'automations', seq));
    });
  },

  refreshRates: async () => {
    if (!ratesAreStale()) return; // cached rates are fresh enough
    try {
      setRates(await fetchRates());
    } catch (err) {
      console.error('[data] refreshRates failed', err); // keep whatever's cached
    }
  },

  addColumn: (tableId, type) => {
    let nextColumns: Column[] = [];
    set((s) => {
      const tbl = s.tables[tableId];
      if (!tbl) return s;
      const col: Column = {
        id: uid('c'),
        name: `${type[0].toUpperCase()}${type.slice(1)} ${tbl.columns.length + 1}`,
        type,
        width: type === 'text' ? 180 : type === 'person' ? 160 : 120,
        ...(type === 'select' ? { options: [] } : {}),
        ...(type === 'formula' ? { formula: '' } : {}),
      };
      nextColumns = [...tbl.columns, col];
      return { tables: { ...s.tables, [tableId]: { ...tbl, columns: nextColumns } } };
    });
    persistColumns(tableId, nextColumns, 'addColumn');
  },

  importRows: async (tableId, parsed, replace = false) => {
    const style = useWorkspace.getState().numberStyle(get().tables[tableId]?.workspace);
    // Replace mode makes the table MATCH the file: wipe every existing row, then
    // drop every column the file's header row doesn't name (by name, case-
    // insensitive), so a re-import of a CSV with different headers doesn't leave
    // the old columns behind. Append mode (default) keeps rows and columns and
    // just adds the new rows.
    // Column mutations here update LOCAL state only; the final column set is
    // persisted to the server ONCE at the end (a single tablesApi.update), so a
    // dropped-columns write can't race/clobber the added-columns write. (That
    // race, a debounced persistColumns firing after the immediate add, wiped a
    // table to zero columns.)
    let columnsChanged = false;
    if (replace) {
      const existing = Object.values(get().rows).filter((r) => r.table === tableId).map((r) => r.id);
      for (const id of existing) await get().deleteRow(id);

      const headerSet = new Set(parsed.headers.map((h) => h.trim().toLowerCase()).filter(Boolean));
      const cur = get().tables[tableId];
      if (cur) {
        const kept = cur.columns.filter((c) => headerSet.has(c.name.trim().toLowerCase()));
        if (kept.length !== cur.columns.length) {
          columnsChanged = true;
          set((s) => {
            const t = s.tables[tableId];
            return t ? { tables: { ...s.tables, [tableId]: { ...t, columns: kept } } } : s;
          });
        }
      }
    }
    const { newColumns, resolve } = planImport(get().tables[tableId]?.columns ?? [], parsed, style);
    // Create any missing columns (type inferred from the data) and remember name -> new id.
    const newIds: Record<string, string> = {};
    if (newColumns.length) {
      columnsChanged = true;
      set((s) => {
        const tbl = s.tables[tableId];
        if (!tbl) return s;
        const added = newColumns.map((c) => ({ id: uid('c'), name: c.name, type: c.type, width: 180 }));
        added.forEach((c, i) => (newIds[newColumns[i].name] = c.id));
        return { tables: { ...s.tables, [tableId]: { ...tbl, columns: [...tbl.columns, ...added] } } };
      });
    }
    // One authoritative persist of the resulting columns (drop + adds combined).
    if (columnsChanged) {
      const finalCols = get().tables[tableId]?.columns;
      if (finalCols) await tablesApi.update(tableId, { columns: finalCols }).catch((e) => console.error('[data] import columns', e));
    }
    const records = resolve(newIds);
    let n = 0;
    for (const cells of records) {
      const id = await get().addRow(tableId, cells);
      if (id) n++;
    }
    // If a replace dropped a column that the table's view pointed at (e.g. the
    // calendar's date column), clear that dangling reference so the toolbar
    // re-picks a sensible default instead of showing an empty view.
    if (replace) {
      const tbl = get().tables[tableId];
      const view = tbl?.views as Record<string, unknown> | null | undefined;
      if (tbl && view) {
        const valid = new Set(tbl.columns.map((c) => c.id));
        const refs = ['dateColumnId', 'endDateColumnId', 'groupColumnId', 'placeColumnId', 'arrivalColumnId', 'departureColumnId'];
        const next: Record<string, unknown> = { ...view };
        let changed = false;
        for (const k of refs) {
          if (typeof next[k] === 'string' && !valid.has(next[k] as string)) {
            delete next[k];
            changed = true;
          }
        }
        if (changed) get().setTableView(tableId, next);
      }
    }
    return n;
  },

  captureTableSnapshot: (tableId) => {
    const t = get().tables[tableId];
    const rows = Object.values(get().rows)
      .filter((r) => r.table === tableId)
      .sort((a, b) => a.position - b.position)
      .map((r) => ({ cells: { ...r.cells }, parent: r.parent ?? '', content: (r.content ?? null) as object | null }));
    return { columns: t ? t.columns.map((c) => ({ ...c })) : [], views: (t?.views ?? null) as object | null, rows };
  },

  restoreTableSnapshot: async (tableId, snap) => {
    // Undo of a replace-import: wipe the just-imported rows, put the old columns
    // + view back (guarded write, like the import), then re-add the old rows.
    const current = Object.values(get().rows).filter((r) => r.table === tableId).map((r) => r.id);
    for (const id of current) await get().deleteRow(id);
    set((s) => {
      const t = s.tables[tableId];
      return t ? { tables: { ...s.tables, [tableId]: { ...t, columns: snap.columns, views: snap.views } } } : s;
    });
    const cseq = beginWrite(tableId, 'columns');
    const vseq = beginWrite(tableId, 'views');
    await tablesApi
      .update(tableId, { columns: snap.columns, views: snap.views })
      .catch((e) => console.error('[data] restoreTableSnapshot failed', e))
      .finally(() => {
        endWrite(tableId, 'columns', cseq);
        endWrite(tableId, 'views', vseq);
      });
    for (const r of snap.rows) {
      const id = await get().addRow(tableId, r.cells as Record<string, CellValue>, r.parent);
      if (id && r.content) get().setRowContent(id, r.content);
    }
  },

  undoRestore: async (created) => {
    // Delete exactly the ids the restore created, nothing else. Local removal
    // first for a snappy UI, then the server, rows -> tables -> pages.
    set((s) => {
      const rows = { ...s.rows };
      created.rowIds.forEach((id) => delete rows[id]);
      const tables = { ...s.tables };
      created.tableIds.forEach((id) => delete tables[id]);
      const pages = { ...s.pages };
      created.pageIds.forEach((id) => delete pages[id]);
      const activePageId = created.pageIds.includes(s.activePageId ?? '') ? null : s.activePageId;
      return { rows, tables, pages, activePageId };
    });
    await Promise.allSettled(created.rowIds.map((id) => rowsApi.remove(id)));
    await Promise.allSettled(created.tableIds.map((id) => tablesApi.remove(id)));
    await Promise.allSettled(created.pageIds.map((id) => pagesApi.remove(id)));
  },

  updateColumn: (tableId, columnId, patch) => {
    let nextColumns: Column[] = [];
    set((s) => {
      const tbl = s.tables[tableId];
      if (!tbl) return s;
      nextColumns = tbl.columns.map((c) => (c.id === columnId ? { ...c, ...patch } : c));
      return { tables: { ...s.tables, [tableId]: { ...tbl, columns: nextColumns } } };
    });
    persistColumns(tableId, nextColumns, 'updateColumn');
  },

  moveColumn: (tableId, columnId, dir) => {
    let nextColumns: Column[] = [];
    set((s) => {
      const tbl = s.tables[tableId];
      if (!tbl) return s;
      const cols = tbl.columns;
      const i = cols.findIndex((c) => c.id === columnId);
      const j = dir === 'left' ? i - 1 : i + 1;
      if (i < 0 || j < 0 || j >= cols.length) return s;
      nextColumns = cols.slice();
      [nextColumns[i], nextColumns[j]] = [nextColumns[j], nextColumns[i]];
      return { tables: { ...s.tables, [tableId]: { ...tbl, columns: nextColumns } } };
    });
    if (nextColumns.length) persistColumns(tableId, nextColumns, 'moveColumn');
  },

  deleteColumn: (tableId, columnId) => {
    let nextColumns: Column[] = [];
    const affectedRows: TableRow[] = [];
    set((s) => {
      const tbl = s.tables[tableId];
      if (!tbl) return s;
      nextColumns = tbl.columns.filter((c) => c.id !== columnId);
      const rows = { ...s.rows };
      for (const r of Object.values(rows)) {
        if (r.table === tableId && columnId in r.cells) {
          const cells = { ...r.cells };
          delete cells[columnId];
          rows[r.id] = { ...r, cells };
          affectedRows.push(rows[r.id]);
        }
      }
      return { tables: { ...s.tables, [tableId]: { ...tbl, columns: nextColumns } }, rows };
    });
    persistColumns(tableId, nextColumns, 'deleteColumn');
    for (const r of affectedRows) {
      void cellsToPersist(r.workspace ?? '', r.cells, nextColumns).then((toStore) => {
        if (toStore != null) rowsApi.update(r.id, { cells: toStore }).catch(() => {});
      });
    }
  },

  addSelectOption: (tableId, columnId, label) => {
    const trimmed = label.trim();
    if (!trimmed) return null;
    const option: SelectOption = { id: uid('o'), label: trimmed, color: '#000' };
    let nextColumns: Column[] = [];
    set((s) => {
      const tbl = s.tables[tableId];
      if (!tbl) return s;
      nextColumns = tbl.columns.map((c) => {
        if (c.id !== columnId) return c;
        const existing = c.options ?? [];
        option.color = pickTagColor(existing.length);
        return { ...c, options: [...existing, option] };
      });
      return { tables: { ...s.tables, [tableId]: { ...tbl, columns: nextColumns } } };
    });
    persistColumns(tableId, nextColumns, 'addSelectOption');
    return option;
  },

  setSelectOptionColor: (tableId, columnId, optionId, color) => {
    let nextColumns: Column[] = [];
    set((s) => {
      const tbl = s.tables[tableId];
      if (!tbl) return s;
      nextColumns = tbl.columns.map((c) =>
        c.id !== columnId
          ? c
          : { ...c, options: (c.options ?? []).map((o) => (o.id === optionId ? { ...o, color } : o)) },
      );
      return { tables: { ...s.tables, [tableId]: { ...tbl, columns: nextColumns } } };
    });
    persistColumns(tableId, nextColumns, 'setSelectOptionColor');
  },

  toggleSelectOptionDone: (tableId, columnId, optionId) => {
    let nextColumns: Column[] = [];
    set((s) => {
      const tbl = s.tables[tableId];
      if (!tbl) return s;
      nextColumns = tbl.columns.map((c) =>
        c.id !== columnId
          ? c
          : { ...c, options: (c.options ?? []).map((o) => (o.id === optionId ? { ...o, done: !o.done } : o)) },
      );
      return { tables: { ...s.tables, [tableId]: { ...tbl, columns: nextColumns } } };
    });
    persistColumns(tableId, nextColumns, 'toggleSelectOptionDone');
  },

  renameSelectOption: (tableId, columnId, optionId, label) => {
    let nextColumns: Column[] = [];
    set((s) => {
      const tbl = s.tables[tableId];
      if (!tbl) return s;
      nextColumns = tbl.columns.map((c) =>
        c.id !== columnId
          ? c
          : { ...c, options: (c.options ?? []).map((o) => (o.id === optionId ? { ...o, label } : o)) },
      );
      return { tables: { ...s.tables, [tableId]: { ...tbl, columns: nextColumns } } };
    });
    persistColumns(tableId, nextColumns, 'renameSelectOption');
  },

  moveSelectOption: (tableId, columnId, optionId, beforeId) => {
    let nextColumns: Column[] = [];
    set((s) => {
      const tbl = s.tables[tableId];
      if (!tbl) return s;
      nextColumns = tbl.columns.map((c) => {
        if (c.id !== columnId) return c;
        const opts = [...(c.options ?? [])];
        const from = opts.findIndex((o) => o.id === optionId);
        if (from === -1) return c;
        const [moved] = opts.splice(from, 1);
        const to = beforeId ? opts.findIndex((o) => o.id === beforeId) : opts.length;
        opts.splice(to === -1 ? opts.length : to, 0, moved);
        return { ...c, options: opts };
      });
      return { tables: { ...s.tables, [tableId]: { ...tbl, columns: nextColumns } } };
    });
    persistColumns(tableId, nextColumns, 'moveSelectOption');
  },

  // Drop an option from the column. Cells that still point at it just render
  // blank (the lookup misses), so no row rewrite is needed.
  removeSelectOption: (tableId, columnId, optionId) => {
    let nextColumns: Column[] = [];
    set((s) => {
      const tbl = s.tables[tableId];
      if (!tbl) return s;
      nextColumns = tbl.columns.map((c) =>
        c.id !== columnId ? c : { ...c, options: (c.options ?? []).filter((o) => o.id !== optionId) },
      );
      return { tables: { ...s.tables, [tableId]: { ...tbl, columns: nextColumns } } };
    });
    persistColumns(tableId, nextColumns, 'removeSelectOption');
  },

  // --- rows ---------------------------------------------------------------

  addRow: async (tableId, initialCells, parentId = '') => {
    const existing = Object.values(get().rows).filter((r) => r.table === tableId);
    const position = existing.length;
    const autoCells = automationsForRowCreated(resolveAutomations(get().tables[tableId]));
    const cells = { ...autoCells, ...(initialCells ?? {}) };
    // Optimistic temp row, replaced by the server echo (same id) on success.
    const tempId = uid('r');
    const optimistic: TableRow = {
      id: tempId,
      table: tableId,
      parent: parentId,
      cells,
      position,
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
    };
    set((s) => ({ rows: { ...s.rows, [tempId]: optimistic } }));
    try {
      const ws = get().tables[tableId]?.workspace || activeWsForWrite();
      // Encrypt the new row's cells in an encrypted workspace (falls back to the
      // plain object if the key isn't ready; it re-encrypts on the next edit).
      const cellsStore = (await cellsToPersist(ws, cells, get().tables[tableId]?.columns ?? [])) ?? cells;
      const row = await rowsApi.create({ table: tableId, parent: parentId, cells: cellsStore, position, workspace: ws });
      // Claim the envelope so the create echo doesn't re-lock the row we just made.
      noteOwnCellsEnvelope(row.id, cellsStore);
      if (parentId) saveRowParent(row.id, parentId); // survives the echo if the field is missing
      set((s) => {
        const rows = { ...s.rows };
        delete rows[tempId];
        // Keep the plaintext cells in memory (the persisted copy may be encrypted).
        rows[row.id] = { ...hydrateRow(row), cells, cellsEnc: undefined };
        return { rows };
      });
      // rowCreated flows fire on the real row id, unless we're already inside a
      // flow/automation (a flow that creates rows must not chain into itself).
      if (!automationRunning) runRowCreatedFlows(get, tableId, row.id, cells);
      return row.id;
    } catch (err) {
      console.error('[data] addRow failed', err);
      set((s) => {
        const rows = { ...s.rows };
        delete rows[tempId];
        return { rows };
      });
      return null;
    }
  },

  addSubRow: async (parentRowId) => {
    const parent = get().rows[parentRowId];
    if (!parent) return null;
    return get().addRow(parent.table, undefined, parentRowId);
  },

  setRowParent: (rowId, parentId) => {
    set((s) => {
      const row = s.rows[rowId];
      if (!row) return s;
      return { rows: { ...s.rows, [rowId]: { ...row, parent: parentId } } };
    });
    saveRowParent(rowId, parentId);
    debounceWrite(`row-parent-${rowId}`, () => {
      // 400s harmlessly if `table_rows.parent` isn't in the schema yet; the
      // localStorage mirror keeps the hierarchy until the field is added.
      rowsApi.update(rowId, { parent: parentId }).catch((err) => console.error('[data] setRowParent failed', err));
    });
  },

  deleteRow: async (rowId) => {
    const snapshot = get().rows[rowId];
    set((s) => {
      const rows = { ...s.rows };
      delete rows[rowId];
      return { rows };
    });
    // rowDeleted flows run on the pre-delete snapshot, not inside another flow.
    if (snapshot && !automationRunning) runRowDeletedFlows(get, snapshot.table, rowId, snapshot.cells);
    try {
      await rowsApi.remove(rowId);
    } catch (err) {
      console.error('[data] deleteRow failed', err);
      if (snapshot) set((s) => ({ rows: { ...s.rows, [rowId]: snapshot } }));
    }
  },

  setCell: (rowId, columnId, value) => {
    // Refuse to edit a row whose cells are still encrypted (not decrypted yet),
    // writing now would overwrite the ciphertext and lose the other cells.
    if (get().rows[rowId]?.cellsEnc) return;
    const prevCells = get().rows[rowId]?.cells ?? {}; // pre-edit, for rowFieldFilter's rising edge
    let nextCells: Record<string, CellValue> = {};
    set((s) => {
      const row = s.rows[rowId];
      if (!row) return s;
      nextCells = { ...row.cells, [columnId]: value };
      return { rows: { ...s.rows, [rowId]: { ...row, cells: nextCells } } };
    });
    const ws = get().rows[rowId]?.workspace ?? '';
    const cols = get().tables[get().rows[rowId]?.table ?? '']?.columns ?? [];
    // Guard the cells against their own echo: hold the typed values until this save
    // settles, so a trailing echo can't rewind what was just entered in a cell.
    const seq = beginWrite(rowId, 'cells');
    debounceWrite(`cell-${rowId}`, () => {
      void cellsToPersist(ws, nextCells, cols)
        .then((toStore) => {
          if (toStore == null) return; // encrypted ws + locked vault: skip, never write plaintext
          noteOwnCellsEnvelope(rowId, toStore);
          return rowsApi.update(rowId, { cells: toStore }).catch((err) => {
            console.error('[data] setCell failed', err);
            // Offline: don't refetch (it would blank/rewind the cell); just keep the
            // optimistic value for the session. Offline edits are NOT synced back.
            if (navigator.onLine) void get().hydrate();
          });
        })
        .finally(() => endWrite(rowId, 'cells', seq));
    });

    // Fire field-change automations (guarded against recursion).
    if (!automationRunning) {
      const row = get().rows[rowId];
      const table = row ? get().tables[row.table] : undefined;
      const rules = resolveAutomations(table);
      if (rules.length) {
        const updates = automationsForFieldChange(rules, columnId, value);
        const entries = Object.entries(updates).filter(([cid]) => cid !== columnId);
        if (entries.length) {
          automationRunning = true;
          try {
            for (const [cid, v] of entries) get().setCell(rowId, cid, v);
          } finally {
            automationRunning = false;
          }
        }

        // Recurring rows: when this completing edit matches a recurrence rule's
        // trigger, spawn the next occurrence with its date advanced and the done
        // signal reset. The spawn lives here (the engine is pure and can't create
        // rows); the spawned row starts not-done so it can't re-trigger, but we
        // guard anyway against future rule shapes.
        const current = get().rows[rowId];
        const recurring = rules.filter(
          (r) => r.enabled && r.recurrence && triggerMatchesFieldChange(r, columnId, value),
        );
        if (current && table && recurring.length) {
          automationRunning = true;
          try {
            for (const r of recurring) {
              const rule = r.recurrence!;
              // A deleted date column degrades the rule to a no-op, don't spawn
              // a dateless orphan, don't crash.
              if (!table.columns.some((c) => c.id === rule.dateColumnId)) continue;
              const nextCells = buildNextCells(current.cells, rule.dateColumnId, rule.interval, columnId);
              void get().addRow(table.id, nextCells);
            }
          } finally {
            automationRunning = false;
          }
        }
      }

      // Workspace-wide flows: a rowFieldEquals trigger on this table+column.
      // Separate from table automations (which are table-local), a flow can
      // target other tables/pages. Same guard keeps it from recursing.
      if (table) {
        runRowFieldFlows(get, table.id, rowId, columnId, value);
        runRowFilterFlows(get, table.id, rowId, prevCells, nextCells);
      }
    }
  },

  applyCellDecryptions: (updates) => {
    set((s) => {
      let changed = false;
      const rows = { ...s.rows };
      for (const id in updates) {
        const r = rows[id];
        if (r) {
          rows[id] = { ...r, cells: updates[id], cellsEnc: undefined };
          changed = true;
        }
      }
      return changed ? { rows } : s;
    });
  },

  applyRowContentDecryptions: (updates) => {
    set((s) => {
      let changed = false;
      const rows = { ...s.rows };
      for (const id in updates) {
        const r = rows[id];
        if (r) {
          rows[id] = { ...r, content: updates[id], contentEnc: undefined };
          changed = true;
        }
      }
      return changed ? { rows } : s;
    });
  },

  migrateRowCells: (rowId, cells) => {
    rowsApi.update(rowId, { cells }).catch((err) => console.error('[data] migrateRowCells failed', err));
  },

  migrateRowContent: (rowId, content) => {
    rowsApi.update(rowId, { content }).catch((err) => console.error('[data] migrateRowContent failed', err));
  },

  setRowContent: (rowId, content) => {
    // Refuse a row whose body is still ciphertext we haven't opened. The row-detail
    // editor mounts with a null doc and reports an empty document on mount, so
    // without this the first render of an undecrypted card would save that emptiness
    // straight over the body. Same guard, same reason, as setCell's cellsEnc check.
    if (get().rows[rowId]?.contentEnc) return;
    set((s) => {
      const row = s.rows[rowId];
      if (!row) return s;
      return { rows: { ...s.rows, [rowId]: { ...row, content } } };
    });
    const ws = get().rows[rowId]?.workspace ?? '';
    // Gated: see encryptRowBodiesEnabled. Off means this writes a plain doc exactly
    // as every build before today did, so a deploy changes nothing about what lands
    // in table_rows.content.
    const encrypted = useWorkspace.getState().encryptedEnabled(ws) && encryptRowBodiesEnabled();
    const seq = beginProseWrite(rowId);
    debounceWrite(`rowcontent-${rowId}`, () => {
      // If the `content` field hasn't been added to the table_rows collection
      // yet, this 400s, caught here so cell edits and the in-session body still
      // work; the body just won't persist until the field exists.
      void (encrypted ? useWorkspaceKeys.getState().encryptForWorkspace(ws, content) : Promise.resolve(content))
        .then((toStore) => {
          // Encrypted workspace with no key (locked vault). Never write the body out
          // in the clear, but SAY SO: the edit only lives in memory now and a reload
          // loses it. Failing silently here is worse than the leak it prevents,
          // because you would keep typing notes into a card that is saving nothing.
          // A brand-new row has no contentEnc, so the guard above cannot catch this.
          if (encrypted && !toStore) {
            warnUnsavedBody();
            endProseWrite(rowId, seq);
            return;
          }
          if (typeof toStore === 'string') noteOwnRowBodyEnvelope(rowId, toStore);
          return rowsApi
            .update(rowId, { content: toStore })
            .catch((err) => console.error('[data] setRowContent failed', err))
            .finally(() => endProseWrite(rowId, seq));
        })
        .catch(() => endProseWrite(rowId, seq));
    });
  },

  toggleReaction: (rowId, emoji, userId) => {
    if (!userId) return;
    let next: ReactionMap = {};
    set((s) => {
      const row = s.rows[rowId];
      if (!row) return s;
      next = toggleReactionMap(row.reactions, emoji, userId);
      return { rows: { ...s.rows, [rowId]: { ...row, reactions: next } } };
    });
    saveReactions(rowId, next); // survives the echo when the field is missing
    debounceWrite(`reactions-${rowId}`, () => {
      // No-ops harmlessly if `table_rows.reactions` isn't in the schema yet:
      // PocketBase drops the unknown field and the localStorage mirror carries
      // the votes per-browser until the field is added (then they sync for real).
      rowsApi.update(rowId, { reactions: next }).catch((err) => console.error('[data] toggleReaction failed', err));
    });
  },

  openRow: (rowId) => set({ openRowId: rowId }),
  closeRow: () => set({ openRowId: null }),
}));

// --- Derived selectors + permissions ----------------------------------------
// The pure selectors and the page-permission logic now live in lib/pageTree.ts
// and lib/permissions.ts (testable from scripts/tests.ts, which only reaches
// lib/). They are re-exported here so existing `from '../store/useData'` imports
// across the components keep working unchanged.
export {
  selectChildren,
  selectTopLevel,
  selectTemplates,
  selectTrashRoots,
  pageWorkspaceId,
  selectWorkspacePages,
  selectWorkspaceTables,
  selectBreadcrumb,
  selectRowsForTable,
  selectMyRole,
  canEdit,
  canManageSharing,
  extractTableIds,
  remapTableIds,
};
