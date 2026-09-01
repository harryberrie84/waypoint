import { useState } from 'react';
import { Zap, Plus, Trash2, X } from 'lucide-react';
import { useData } from '../store/useData';
import { uid } from '../lib/id';
import type { Column } from '../types';
import type { Automation } from '../lib/automations';
import type { RecurrenceRule, RecurrenceUnit } from '../lib/recurrence';
import { ActionEditor } from './ActionEditor';

function loadLocal(tableId: string): Automation[] {
  try {
    const raw = localStorage.getItem(`waypoint:automations:${tableId}`);
    return raw ? (JSON.parse(raw) as Automation[]) : [];
  } catch {
    return [];
  }
}

export function AutomationsButton({ tableId, columns }: { tableId: string; columns: Column[] }) {
  const serverRules = useData((s) => s.tables[tableId]?.automations);
  const setTableAutomations = useData((s) => s.setTableAutomations);
  const [open, setOpen] = useState(false);

  const rules: Automation[] = (serverRules && serverRules.length ? serverRules : loadLocal(tableId)) ?? [];
  const save = (next: Automation[]) => setTableAutomations(tableId, next);

  const addRule = () =>
    save([
      ...rules,
      { id: uid('a'), name: 'New rule', enabled: true, trigger: { kind: 'fieldEquals', columnId: columns[0]?.id, value: '' }, actions: [] },
    ]);
  const updateRule = (id: string, patch: Partial<Automation>) => save(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const removeRule = (id: string) => save(rules.filter((r) => r.id !== id));

  const sel = 'rounded-md border border-paper-line bg-paper px-1.5 py-1 text-xs text-ink dark:border-coal-line dark:bg-coal dark:text-coal-text';

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 rounded p-1 text-ink-faint hover:bg-paper-panel hover:text-clay dark:hover:bg-coal-line"
        title="Automations"
      >
        <Zap className="h-3.5 w-3.5" />
        {rules.length > 0 && <span className="text-[10px] font-semibold">{rules.length}</span>}
      </button>

      {open && (
        <div className="fixed inset-0 z-[1200] flex items-start justify-center overflow-y-auto bg-coal/40 p-4 backdrop-blur-sm sm:p-8" onMouseDown={() => setOpen(false)}>
          <div className="my-4 w-full max-w-xl rounded-2xl border border-paper-line bg-paper p-4 shadow-2xl dark:border-coal-line dark:bg-coal-panel" onMouseDown={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center gap-2">
              <Zap className="h-4 w-4 text-clay" />
              <h3 className="text-sm font-semibold text-ink dark:text-coal-text">Automations</h3>
              <button type="button" onClick={() => setOpen(false)} className="ml-auto rounded p-1 text-ink-faint hover:text-ink dark:hover:text-coal-text">
                <X className="h-4 w-4" />
              </button>
            </div>

            {rules.length === 0 && (
              <p className="mb-3 rounded-lg bg-paper-panel/60 p-3 text-xs text-ink-faint dark:bg-coal/40 dark:text-coal-soft">
                No rules yet. Example: <em>when Status becomes Done → set Completed = today's date</em>.
              </p>
            )}

            <div className="space-y-3">
              {rules.map((r) => {
                const trigCol = columns.find((c) => c.id === r.trigger.columnId);
                return (
                  <div key={r.id} className="rounded-xl border border-paper-line p-3 dark:border-coal-line">
                    <div className="mb-2 flex items-center gap-2">
                      <input type="checkbox" checked={r.enabled} onChange={(e) => updateRule(r.id, { enabled: e.target.checked })} />
                      <input
                        value={r.name}
                        onChange={(e) => updateRule(r.id, { name: e.target.value })}
                        className="min-w-0 flex-1 bg-transparent text-sm font-medium text-ink outline-none dark:text-coal-text"
                      />
                      <button type="button" onClick={() => removeRule(r.id)} className="rounded p-0.5 text-ink-faint hover:text-red-500">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    <div className="mb-2 flex flex-wrap items-center gap-1 text-[11px] text-ink-faint dark:text-coal-soft">
                      <span className="font-semibold uppercase tracking-wide">When</span>
                      <select
                        value={r.trigger.kind}
                        onChange={(e) => updateRule(r.id, { trigger: { ...r.trigger, kind: e.target.value as Automation['trigger']['kind'] } })}
                        className={sel}
                      >
                        <option value="fieldEquals">a field equals</option>
                        <option value="rowCreated">a row is created</option>
                      </select>
                      {r.trigger.kind === 'fieldEquals' && (
                        <>
                          <select
                            value={r.trigger.columnId ?? ''}
                            onChange={(e) => updateRule(r.id, { trigger: { ...r.trigger, columnId: e.target.value, value: '' } })}
                            className={sel}
                          >
                            {columns.map((c) => (
                              <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                          </select>
                          <span>=</span>
                          {trigCol?.type === 'select' ? (
                            <select value={r.trigger.value ?? ''} onChange={(e) => updateRule(r.id, { trigger: { ...r.trigger, value: e.target.value } })} className={sel}>
                              <option value="">-</option>
                              {(trigCol.options ?? []).map((o) => (
                                <option key={o.id} value={o.id}>{o.label}</option>
                              ))}
                            </select>
                          ) : trigCol?.type === 'checkbox' ? (
                            <select value={r.trigger.value ?? 'true'} onChange={(e) => updateRule(r.id, { trigger: { ...r.trigger, value: e.target.value } })} className={sel}>
                              <option value="true">checked</option>
                              <option value="false">unchecked</option>
                            </select>
                          ) : (
                            <input value={r.trigger.value ?? ''} onChange={(e) => updateRule(r.id, { trigger: { ...r.trigger, value: e.target.value } })} placeholder="value" className={`${sel} w-24`} />
                          )}
                        </>
                      )}
                    </div>

                    <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint dark:text-coal-soft">Then</div>
                    <ActionEditor columns={columns} actions={r.actions} onChange={(a) => updateRule(r.id, { actions: a })} />
                    <RecurrenceEditor
                      columns={columns}
                      recurrence={r.recurrence}
                      onChange={(rec) => updateRule(r.id, { recurrence: rec })}
                    />
                  </div>
                );
              })}
            </div>

            <button
              type="button"
              onClick={addRule}
              className="mt-3 flex items-center gap-1.5 rounded-lg border border-dashed border-paper-line px-3 py-2 text-sm text-ink-faint hover:border-clay hover:text-clay dark:border-coal-line"
            >
              <Plus className="h-4 w-4" /> Add rule
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// Repeat: when a rule fires, spawn the next occurrence with its date advanced and
// the trigger reset. The "when" trigger above is the done signal, so this only
// makes sense paired with a `fieldEquals` trigger (e.g. Status = Done).
function RecurrenceEditor({
  columns,
  recurrence,
  onChange,
}: {
  columns: Column[];
  recurrence?: RecurrenceRule;
  onChange: (rec: RecurrenceRule | undefined) => void;
}) {
  const dateCols = columns.filter((c) => c.type === 'date');
  const sel = 'rounded-md border border-paper-line bg-paper px-1.5 py-1 text-xs text-ink dark:border-coal-line dark:bg-coal dark:text-coal-text';

  const toggle = (checked: boolean) => {
    if (!checked) return onChange(undefined);
    onChange({
      dateColumnId: recurrence?.dateColumnId ?? dateCols[0]?.id ?? '',
      interval: recurrence?.interval ?? { unit: 'week', n: 1 },
    });
  };

  return (
    <div className="mt-2 border-t border-paper-line pt-2 dark:border-coal-line">
      <label className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint dark:text-coal-soft">
        <input type="checkbox" checked={!!recurrence} onChange={(e) => toggle(e.target.checked)} className="accent-clay" />
        Repeat
      </label>
      {recurrence && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[11px] text-ink-faint dark:text-coal-soft">
          {dateCols.length === 0 ? (
            <span>Add a Date column to repeat on.</span>
          ) : (
            <>
              <span>advance</span>
              <select value={recurrence.dateColumnId} onChange={(e) => onChange({ ...recurrence, dateColumnId: e.target.value })} className={sel}>
                {dateCols.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <span>by</span>
              <input
                type="number"
                min={1}
                value={recurrence.interval.n}
                onChange={(e) => onChange({ ...recurrence, interval: { ...recurrence.interval, n: Math.max(1, Number(e.target.value) || 1) } })}
                className={`${sel} w-14`}
              />
              <select
                value={recurrence.interval.unit}
                onChange={(e) => onChange({ ...recurrence, interval: { ...recurrence.interval, unit: e.target.value as RecurrenceUnit } })}
                className={sel}
              >
                <option value="day">day(s)</option>
                <option value="week">week(s)</option>
                <option value="month">month(s)</option>
              </select>
              <span>when this fires, and reset it</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
