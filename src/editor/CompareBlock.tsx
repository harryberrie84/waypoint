import { useEffect, useRef, useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { Scale, Plus, Trash2, Star, Crown } from 'lucide-react';

// compareBlock, a side-by-side decision table with weighted scoring: options across
// the top, criteria down the side. A criterion is either a RATING (1-5 dots, times a
// weight) or a NOTE (free text). Rating criteria roll up into a weighted score per
// option, the highest is crowned automatically, and a star lets you override the pick.
// No invented data, you fill everything. All in the block attrs, so it syncs to
// everyone. Good for "which ryokan / which flight". Styled like the other cards.

interface Opt {
  id: string;
  text: string; // the option name, kept in `text` so search finds it
}
interface Crit {
  id: string;
  label: string;
  weight: number; // multiplier for a rating criterion
  rate: boolean; // true = 1-5 rating (scored), false = free-text note
  values: Record<string, string>; // optionId -> rating "0".."5" or note text
}

function newId(): string {
  return Math.random().toString(36).slice(2, 9);
}
function readOpts(attrs: Record<string, unknown>): Opt[] {
  return Array.isArray(attrs.options) ? (attrs.options as Opt[]) : [];
}
function readCrit(attrs: Record<string, unknown>): Crit[] {
  return Array.isArray(attrs.criteria) ? (attrs.criteria as Crit[]) : [];
}

function RatingDots({ value, editable, onChange }: { value: number; editable: boolean; onChange: (n: number) => void }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={!editable}
          onClick={() => onChange(n === value ? 0 : n)}
          title={editable ? `${n}/5` : undefined}
          className={['h-2.5 w-2.5 rounded-full transition-transform', n <= value ? 'bg-clay' : 'bg-paper-line dark:bg-coal-line', editable ? 'hover:scale-125' : 'cursor-default'].join(' ')}
        />
      ))}
    </div>
  );
}

function CompareView({ node, updateAttributes, editor, getPos }: NodeViewProps) {
  const editable = editor.isEditable;
  const title = (node.attrs.title as string) || 'Compare';
  const options = readOpts(node.attrs);
  const criteria = readCrit(node.attrs);
  const winner = (node.attrs.winner as string) || '';
  const [editing, setEditing] = useState(false);

  // Read the LIVE attrs off the current doc (via the node position), not the React
  // `node` prop, which only refreshes on the next render. Rating a couple of cells in
  // quick succession off the stale prop would clobber each other; ProseMirror applies
  // each updateAttributes synchronously, so reading the doc here always sees the last.
  const liveAttrs = (): Record<string, unknown> => {
    try {
      const pos = typeof getPos === 'function' ? getPos() : null;
      if (typeof pos === 'number') {
        const n = editor.state.doc.nodeAt(pos);
        if (n && n.type.name === 'compareBlock') return n.attrs;
      }
    } catch {
      /* fall back to the prop below */
    }
    return node.attrs;
  };
  const liveOpts = () => readOpts(liveAttrs());
  const liveCrit = () => readCrit(liveAttrs());

  const writeOpts = (next: Opt[]) => updateAttributes({ options: next });
  const writeCrit = (next: Crit[]) => updateAttributes({ criteria: next });
  const addOption = () => writeOpts([...liveOpts(), { id: newId(), text: '' }]);
  const renameOption = (id: string, text: string) => writeOpts(liveOpts().map((o) => (o.id === id ? { ...o, text } : o)));
  const removeOption = (id: string) => {
    writeOpts(liveOpts().filter((o) => o.id !== id));
    writeCrit(liveCrit().map((c) => { const v = { ...c.values }; delete v[id]; return { ...c, values: v }; }));
    if (winner === id) updateAttributes({ winner: '' });
  };
  const addCriterion = (rate = true) => writeCrit([...liveCrit(), { id: newId(), label: '', weight: 1, rate, values: {} }]);
  const renameCriterion = (id: string, label: string) => writeCrit(liveCrit().map((c) => (c.id === id ? { ...c, label } : c)));
  const setWeight = (id: string, weight: number) => writeCrit(liveCrit().map((c) => (c.id === id ? { ...c, weight: Math.max(1, weight || 1) } : c)));
  const toggleRate = (id: string) => writeCrit(liveCrit().map((c) => (c.id === id ? { ...c, rate: !c.rate } : c)));
  const removeCriterion = (id: string) => writeCrit(liveCrit().filter((c) => c.id !== id));
  const setCell = (cid: string, oid: string, val: string) => writeCrit(liveCrit().map((c) => (c.id === cid ? { ...c, values: { ...c.values, [oid]: val } } : c)));
  const setWinner = (id: string) => updateAttributes({ winner: winner === id ? '' : id });

  // Weighted score per option, and the auto-best (a manual star overrides it).
  const rateCrit = criteria.filter((c) => c.rate);
  const scoreOf = (oid: string) => rateCrit.reduce((s, c) => s + (Number(c.values[oid]) || 0) * (c.weight || 1), 0);
  const maxScore = options.length ? Math.max(...options.map((o) => scoreOf(o.id))) : 0;
  const best = rateCrit.length && maxScore > 0 ? options.find((o) => scoreOf(o.id) === maxScore)?.id : undefined;
  // The highlighted column: a manual star overrides the auto-best, but ignore a
  // stale star id (an option a collaborator deleted) so it falls back cleanly.
  const pick = winner && options.some((o) => o.id === winner) ? winner : best;

  const seeded = useRef(false);
  useEffect(() => {
    if (!seeded.current && editable && options.length === 0 && criteria.length === 0) {
      seeded.current = true;
      updateAttributes({
        options: [{ id: newId(), text: '' }, { id: newId(), text: '' }],
        criteria: [
          { id: newId(), label: 'Price', weight: 1, rate: true, values: {} },
          { id: newId(), label: 'Location', weight: 1, rate: true, values: {} },
          { id: newId(), label: 'Notes', weight: 1, rate: false, values: {} },
        ],
      });
      setEditing(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cellCls = 'min-w-[7rem] border border-paper-line px-1.5 py-1 align-middle dark:border-coal-line';
  const inputCls = 'w-full rounded bg-transparent px-1 py-0.5 text-sm text-ink outline-none placeholder:text-ink-faint focus:bg-paper dark:text-coal-text dark:focus:bg-coal';

  return (
    <NodeViewWrapper className="my-3" contentEditable={false}>
      <div className="overflow-hidden rounded-xl border border-paper-line bg-gradient-to-br from-clay-wash/50 to-paper-panel/40 dark:border-coal-line dark:from-clay/10 dark:to-coal/40">
        <div className="flex items-center gap-2 px-3 pt-3">
          <Scale className="h-4 w-4 shrink-0 text-clay" />
          {editing && editable ? (
            <input value={title} onChange={(e) => updateAttributes({ title: e.target.value })} className="min-w-0 flex-1 rounded-lg border border-paper-line bg-paper px-2 py-1 text-sm font-semibold text-ink outline-none dark:border-coal-line dark:bg-coal-panel dark:text-coal-text" />
          ) : (
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink dark:text-coal-text">{title}</span>
          )}
          {editable && (
            <button type="button" onClick={() => setEditing((e) => !e)} className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-ink-soft hover:bg-paper-panel dark:text-coal-soft dark:hover:bg-coal-line">
              {editing ? 'Done' : 'Edit'}
            </button>
          )}
        </div>

        <div className="overflow-x-auto p-3">
          <table className="border-collapse">
            <thead>
              <tr>
                <th className="min-w-[7rem] px-1.5 py-1 text-left" />
                {options.map((o) => (
                  <th key={o.id} className={['min-w-[7rem] border border-paper-line px-1.5 py-1 dark:border-coal-line', o.id === pick ? 'bg-clay/10' : ''].join(' ')}>
                    <div className="flex items-center gap-1">
                      <button type="button" onClick={() => setWinner(o.id)} title={winner === o.id ? 'Your pick (starred)' : 'Star as the pick'} className={['shrink-0', o.id === winner ? 'text-clay' : o.id === best ? 'text-amber-500' : 'text-ink-faint hover:text-clay dark:text-coal-soft'].join(' ')}>
                        {o.id === best && o.id !== winner ? <Crown className="h-3.5 w-3.5" /> : <Star className={['h-3.5 w-3.5', o.id === winner ? 'fill-clay' : ''].join(' ')} />}
                      </button>
                      {editing && editable ? (
                        <input value={o.text} onChange={(e) => renameOption(o.id, e.target.value)} placeholder="Option" className={`${inputCls} font-semibold`} />
                      ) : (
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink dark:text-coal-text">{o.text || 'Option'}</span>
                      )}
                      {editing && editable && (
                        <button type="button" onClick={() => removeOption(o.id)} title="Remove option" className="shrink-0 text-ink-faint hover:text-rose-500"><Trash2 className="h-3 w-3" /></button>
                      )}
                    </div>
                  </th>
                ))}
                {editing && editable && (
                  <th className="px-1.5 py-1">
                    <button type="button" onClick={addOption} title="Add option" className="flex items-center gap-1 rounded-md border border-dashed border-paper-line px-2 py-1 text-[11px] text-ink-faint hover:border-clay hover:text-clay dark:border-coal-line"><Plus className="h-3 w-3" /></button>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {criteria.map((c) => (
                <tr key={c.id}>
                  <th className="min-w-[7rem] border border-paper-line px-1.5 py-1 text-left dark:border-coal-line">
                    <div className="flex items-center gap-1">
                      {editing && editable ? (
                        <input value={c.label} onChange={(e) => renameCriterion(c.id, e.target.value)} placeholder="Criterion" className={`${inputCls} font-medium`} />
                      ) : (
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink-soft dark:text-coal-soft">
                          {c.label || 'Criterion'}
                          {c.rate && c.weight > 1 && <span className="ml-1 text-[10px] text-clay">×{c.weight}</span>}
                        </span>
                      )}
                      {editing && editable && (
                        <>
                          <button type="button" onClick={() => toggleRate(c.id)} title={c.rate ? 'Rating row (click for a note row)' : 'Note row (click for a rating row)'} className="shrink-0 rounded border border-paper-line px-1 text-[9px] uppercase text-ink-soft hover:border-clay dark:border-coal-line dark:text-coal-soft">
                            {c.rate ? 'rate' : 'note'}
                          </button>
                          {c.rate && (
                            <input type="number" min={1} value={c.weight} onChange={(e) => setWeight(c.id, Number(e.target.value))} title="Weight" className="w-9 shrink-0 rounded border border-paper-line bg-paper px-1 py-0.5 text-[11px] text-ink-soft outline-none dark:border-coal-line dark:bg-coal dark:text-coal-soft" />
                          )}
                          <button type="button" onClick={() => removeCriterion(c.id)} title="Remove row" className="shrink-0 text-ink-faint hover:text-rose-500"><Trash2 className="h-3 w-3" /></button>
                        </>
                      )}
                    </div>
                  </th>
                  {options.map((o) => (
                    <td key={o.id} className={[cellCls, o.id === pick ? 'bg-clay/5' : ''].join(' ')}>
                      {c.rate ? (
                        <RatingDots value={Number(c.values[o.id]) || 0} editable={editable} onChange={(n) => setCell(c.id, o.id, String(n))} />
                      ) : editable ? (
                        <input value={c.values[o.id] ?? ''} onChange={(e) => setCell(c.id, o.id, e.target.value)} placeholder="…" className={inputCls} />
                      ) : (
                        <span className="text-sm text-ink dark:text-coal-text">{c.values[o.id] ?? ''}</span>
                      )}
                    </td>
                  ))}
                  {editing && editable && <td className="border border-transparent" />}
                </tr>
              ))}
              {rateCrit.length > 0 && options.length > 0 && (
                <tr>
                  <th className="border border-paper-line px-1.5 py-1 text-left text-sm font-semibold text-ink dark:border-coal-line dark:text-coal-text">Score</th>
                  {options.map((o) => {
                    const sc = scoreOf(o.id);
                    return (
                      <td key={o.id} className={['border border-paper-line px-1.5 py-1 text-center dark:border-coal-line', o.id === pick ? 'bg-clay/10' : ''].join(' ')}>
                        <span className="inline-flex items-center gap-1 font-semibold tabular-nums text-ink dark:text-coal-text">
                          {o.id === best && sc > 0 && <Crown className="h-3.5 w-3.5 text-amber-500" />}
                          {sc}
                        </span>
                      </td>
                    );
                  })}
                  {editing && editable && <td className="border border-transparent" />}
                </tr>
              )}
            </tbody>
          </table>
          {editing && editable && (
            <div className="mt-2 flex gap-2">
              <button type="button" onClick={() => addCriterion(true)} className="flex items-center gap-1.5 rounded-lg border border-dashed border-paper-line px-2 py-1 text-sm text-ink-faint hover:border-clay hover:text-clay dark:border-coal-line">
                <Plus className="h-4 w-4" /> Rating row
              </button>
              <button type="button" onClick={() => addCriterion(false)} className="flex items-center gap-1.5 rounded-lg border border-dashed border-paper-line px-2 py-1 text-sm text-ink-faint hover:border-clay hover:text-clay dark:border-coal-line">
                <Plus className="h-4 w-4" /> Note row
              </button>
            </div>
          )}
        </div>
      </div>
    </NodeViewWrapper>
  );
}

export const CompareBlock = Node.create({
  name: 'compareBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    const json = (name: string) => ({
      default: [] as unknown,
      parseHTML: (el: HTMLElement) => {
        try {
          return JSON.parse(el.getAttribute(`data-${name}`) || '[]');
        } catch {
          return [];
        }
      },
      renderHTML: (attrs: Record<string, unknown>) => ({ [`data-${name}`]: JSON.stringify(attrs[name] ?? []) }),
    });
    return {
      title: { default: 'Compare' },
      winner: { default: '' },
      options: json('options'),
      criteria: json('criteria'),
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-compare]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-compare': '' })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(CompareView);
  },
});
