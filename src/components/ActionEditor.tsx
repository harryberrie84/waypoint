import { Plus, X } from 'lucide-react';
import type { Column } from '../types';
import type { AutomationAction, ActionKind } from '../lib/automations';

const LITERAL_KINDS: { kind: ActionKind; label: string }[] = [
  { kind: 'setValue', label: 'set to…' },
  { kind: 'setToday', label: "today's date" },
  { kind: 'setNow', label: 'current time' },
  { kind: 'check', label: 'check ✓' },
  { kind: 'uncheck', label: 'uncheck' },
  { kind: 'clear', label: 'clear' },
];

// Scoped kinds compute against the row, so they only show in the flow canvas
// (allowScoped). Buttons and simple field-change rules stay literal-only.
const SCOPED_KINDS: { kind: ActionKind; label: string }[] = [
  { kind: 'setExpr', label: 'set to formula…' },
  { kind: 'increment', label: 'increment by…' },
  { kind: 'append', label: 'append…' },
  { kind: 'toggle', label: 'toggle' },
];

const SETTABLE = new Set(['text', 'number', 'select', 'multiselect', 'date', 'checkbox', 'url']);
// Computed/derived columns can't be written to; scoped actions may target the rest.
const COMPUTED = new Set(['formula', 'rollup', 'lookup', 'button']);
const KINDS_WITH_VALUE = new Set<ActionKind>(['setValue', 'setExpr', 'increment', 'append']);

const PLACEHOLDER: Partial<Record<ActionKind, string>> = {
  setExpr: '[col] * 2, dice("1d6")',
  increment: '1',
  append: 'option id / word',
};

// ActionEditor, edit a list of actions (used by button columns and automations).
export function ActionEditor({
  columns,
  actions,
  onChange,
  allowScoped = false,
}: {
  columns: Column[];
  actions: AutomationAction[];
  onChange: (next: AutomationAction[]) => void;
  allowScoped?: boolean;
}) {
  const kinds = allowScoped ? [...LITERAL_KINDS, ...SCOPED_KINDS] : LITERAL_KINDS;
  const targets = columns.filter((c) => (allowScoped ? !COMPUTED.has(c.type) : SETTABLE.has(c.type)));
  const update = (i: number, patch: Partial<AutomationAction>) =>
    onChange(actions.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  const remove = (i: number) => onChange(actions.filter((_, j) => j !== i));
  const add = () => onChange([...actions, { columnId: targets[0]?.id ?? '', kind: 'setValue', value: '' }]);

  const sel = 'rounded-md border border-paper-line bg-paper px-1.5 py-1 text-xs text-ink dark:border-coal-line dark:bg-coal dark:text-coal-text';

  return (
    <div className="space-y-1.5">
      {actions.map((a, i) => {
        const col = targets.find((c) => c.id === a.columnId);
        return (
          <div key={i} className="flex flex-wrap items-center gap-1">
            <span className="text-[11px] text-ink-faint dark:text-coal-soft">Set</span>
            <select value={a.columnId} onChange={(e) => update(i, { columnId: e.target.value })} className={sel}>
              {targets.length === 0 && <option value="">(no editable columns)</option>}
              {targets.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <select value={a.kind} onChange={(e) => update(i, { kind: e.target.value as ActionKind })} className={sel}>
              {kinds.map((k) => (
                <option key={k.kind} value={k.kind}>{k.label}</option>
              ))}
            </select>
            {KINDS_WITH_VALUE.has(a.kind) && (
              a.kind === 'setValue' && col && col.type === 'select' ? (
                <select value={a.value ?? ''} onChange={(e) => update(i, { value: e.target.value })} className={sel}>
                  <option value="">-</option>
                  {(col.options ?? []).map((o) => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </select>
              ) : (
                <input
                  value={a.value ?? ''}
                  onChange={(e) => update(i, { value: e.target.value })}
                  placeholder={PLACEHOLDER[a.kind] ?? 'value'}
                  className={`${sel} ${a.kind === 'setExpr' ? 'w-44 font-mono' : 'w-24'}`}
                />
              )
            )}
            <button type="button" onClick={() => remove(i)} className="rounded p-0.5 text-ink-faint hover:text-red-500" title="Remove">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
      <button
        type="button"
        onClick={add}
        className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-clay hover:bg-clay-wash dark:hover:bg-clay/15"
      >
        <Plus className="h-3 w-3" /> Add action
      </button>
    </div>
  );
}
