import type { CellValue } from '../types';
import { evaluateFormula, type FormulaScope, type FxResolve } from './formula';
import type { Rng } from './dice';

// ---------------------------------------------------------------------------
// Buttons + automations, a small, pure rule engine. Buttons run a list of
// actions on one row on click; automations run actions when a field changes to
// a value, or when a row is created. Kept pure so it's fully testable.
//
// Actions come in two flavours. *Literal* kinds (setToday/setNow/setValue/…)
// resolve with no context and drive buttons and the simple field-change rules.
// *Scoped* kinds (setExpr/increment/append/toggle) need a formula scope and/or
// the row's current cell values, so they only run through applyActionsScoped,
// the flow runtime, which always carries a row. Keeping the literal path
// separate means scope-less callers stay byte-for-byte unchanged.
// ---------------------------------------------------------------------------

export type ActionKind =
  | 'setToday' | 'setNow' | 'setValue' | 'check' | 'uncheck' | 'clear' // literal
  | 'setExpr' | 'increment' | 'append' | 'toggle'; // scoped (flow-only)

export interface AutomationAction {
  columnId: string;
  kind: ActionKind;
  value?: string; // setValue: literal · setExpr: a formula expression · increment: a signed number · append: option id / text token
}

export type TriggerKind = 'fieldEquals' | 'rowCreated';

export interface Automation {
  id: string;
  name: string;
  enabled: boolean;
  trigger: { kind: TriggerKind; columnId?: string; value?: string };
  actions: AutomationAction[];
  // When set, the store spawns the next occurrence (date advanced, done signal
  // reset) each time this rule's trigger fires. Ignored by the pure engine, it
  // produces cell patches, not rows; the spawn is a store concern.
  recurrence?: import('./recurrence').RecurrenceRule;
}

export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Resolve one action to the concrete value it writes. */
export function resolveAction(action: AutomationAction, now: Date = new Date()): CellValue {
  switch (action.kind) {
    case 'setToday':
      return isoDate(now);
    case 'setNow':
      return now.toISOString();
    case 'check':
      return true;
    case 'uncheck':
      return false;
    case 'clear':
      return null;
    case 'setValue':
    default:
      return action.value ?? '';
  }
}

/** Turn a list of actions into a {columnId: value} patch. */
export function applyActions(actions: AutomationAction[], now: Date = new Date()): Record<string, CellValue> {
  const out: Record<string, CellValue> = {};
  for (const a of actions) if (a.columnId) out[a.columnId] = resolveAction(a, now);
  return out;
}

// Coerce any cell value to a number the way the formula engine does: a
// non-numeric current value counts as 0 (so increment off an empty cell is +n).
function numCell(v: CellValue): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

// append semantics: multiselect cells are id arrays, add the option if absent;
// text cells get the token appended with a space, no-op if it's already a token.
function appendValue(current: CellValue, value: string): CellValue {
  if (Array.isArray(current)) return current.includes(value) ? current : [...current, value];
  const s = typeof current === 'string' ? current : current == null ? '' : String(current);
  if (!s) return value;
  if (s.split(/\s+/).includes(value)) return s;
  return `${s} ${value}`;
}

// Like applyActions, but also resolves the scoped kinds. `setExpr` evaluates a
// formula against the name-keyed scope; increment/append/toggle read the row's
// current value by column id from `current` (raw, pre-coercion). Earlier actions
// in the same list are visible to later ones, so two `increment by 1` stack.
export function applyActionsScoped(
  actions: AutomationAction[],
  scope: FormulaScope,
  now: Date = new Date(),
  fx?: FxResolve,
  current?: Record<string, CellValue>,
  rng?: Rng, // present only on deliberate runs (flow/button), so dice() can roll
): Record<string, CellValue> {
  const out: Record<string, CellValue> = {};
  const cur = (id: string): CellValue => (id in out ? out[id] : (current?.[id] ?? null));
  for (const a of actions) {
    if (!a.columnId) continue;
    switch (a.kind) {
      case 'setExpr': {
        const res = evaluateFormula(a.value ?? '', scope, fx, rng);
        out[a.columnId] = res.ok ? (res.value as CellValue) : null;
        break;
      }
      case 'increment':
        out[a.columnId] = numCell(cur(a.columnId)) + (Number(a.value) || 0);
        break;
      case 'toggle':
        out[a.columnId] = cur(a.columnId) !== true;
        break;
      case 'append':
        out[a.columnId] = appendValue(cur(a.columnId), a.value ?? '');
        break;
      default:
        out[a.columnId] = resolveAction(a, now);
    }
  }
  return out;
}

function valueEquals(a: CellValue, b: string | undefined): boolean {
  if (typeof a === 'boolean') return String(a) === String(b);
  return String(a ?? '') === String(b ?? '');
}

export function triggerMatchesFieldChange(rule: Automation, columnId: string, newValue: CellValue): boolean {
  return (
    rule.trigger.kind === 'fieldEquals' &&
    rule.trigger.columnId === columnId &&
    valueEquals(newValue, rule.trigger.value)
  );
}

/** All cell updates produced by field-change automations for one change. */
export function automationsForFieldChange(
  rules: Automation[],
  columnId: string,
  newValue: CellValue,
  now: Date = new Date(),
): Record<string, CellValue> {
  const out: Record<string, CellValue> = {};
  for (const r of rules) {
    if (r.enabled && triggerMatchesFieldChange(r, columnId, newValue)) Object.assign(out, applyActions(r.actions, now));
  }
  return out;
}

/** All cell updates produced by row-created automations. */
export function automationsForRowCreated(rules: Automation[], now: Date = new Date()): Record<string, CellValue> {
  const out: Record<string, CellValue> = {};
  for (const r of rules) if (r.enabled && r.trigger.kind === 'rowCreated') Object.assign(out, applyActions(r.actions, now));
  return out;
}

export const ACTION_LABELS: Record<ActionKind, string> = {
  setToday: "set today's date",
  setNow: 'set current time',
  check: 'check',
  uncheck: 'uncheck',
  clear: 'clear',
  setValue: 'set to…',
  setExpr: 'set to formula…',
  increment: 'increment by…',
  append: 'append…',
  toggle: 'toggle',
};
