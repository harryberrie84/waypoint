import { useEffect, useRef, useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { Scale, Landmark, ChefHat, Plus, X, Clock, Users, Link2, Upload, Download } from 'lucide-react';
import { uid } from '../lib/id';
import { WidgetShare } from './WidgetShare';
import { parseRecipes, parseCaseBriefs, parseStatutes } from '../lib/recordImport';
import type { RecipeRecord, CaseRecord, StatuteRecord } from '../lib/recordImport';
import {
  recipeFromAttrs,
  caseFromAttrs,
  statuteFromAttrs,
  recipesToCSV,
  casesToCSV,
  statutesToCSV,
  toJSON,
  download,
  BLANK_JSON,
  BLANK_CSV,
  EXAMPLE_JSON,
  EXAMPLE_CSV,
} from '../lib/recordExport';
import { toast } from '../store/useToast';
import { scaleLine, parseQty, type UnitSystem } from '../lib/recipeScale';
import { GrowTextarea } from '../components/GrowTextarea';

type WidgetKind = 'recipe' | 'case' | 'statute';

// Export the current record, or download a blank fill-in template. Both shapes
// re-import cleanly through the same widget.
function WidgetExport({ kind, record, baseName }: { kind: WidgetKind; record: RecipeRecord | CaseRecord | StatuteRecord | null; baseName: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && e.target instanceof globalThis.Node && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const csvOf = (): string => {
    if (!record) return '';
    if (kind === 'recipe') return recipesToCSV([record as RecipeRecord]);
    if (kind === 'case') return casesToCSV([record as CaseRecord]);
    return statutesToCSV([record as StatuteRecord]);
  };
  const safe = (baseName || kind).replace(/[^\w.-]+/g, '_').slice(0, 40) || kind;

  const Item = ({ label, onClick }: { label: string; onClick: () => void }) => (
    <button
      type="button"
      onClick={() => {
        onClick();
        setOpen(false);
      }}
      className="flex w-full items-center px-3 py-1.5 text-left text-xs text-ink hover:bg-paper-panel dark:text-coal-text dark:hover:bg-coal-line"
    >
      {label}
    </button>
  );

  return (
    <div ref={ref} className="relative shrink-0" contentEditable={false}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Export, or get a blank template"
        className="rounded p-1 text-ink-faint hover:bg-paper-panel hover:text-clay dark:hover:bg-coal-line"
      >
        <Download className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 w-48 overflow-hidden rounded-lg border border-paper-line bg-paper py-1 shadow-xl dark:border-coal-line dark:bg-coal-panel">
          {record && <Item label="Copy as JSON" onClick={() => void navigator.clipboard?.writeText(toJSON(record)).then(() => toast('Copied as JSON'))} />}
          {record && <Item label="Download JSON" onClick={() => download(`${safe}.json`, toJSON(record), 'application/json')} />}
          {record && <Item label="Download CSV" onClick={() => download(`${safe}.csv`, csvOf(), 'text/csv')} />}
          {record && <div className="my-1 border-t border-paper-line dark:border-coal-line" />}
          <Item label="Blank template (JSON)" onClick={() => download(`${kind}-template.json`, BLANK_JSON[kind], 'application/json')} />
          <Item label="Blank template (CSV)" onClick={() => download(`${kind}-template.csv`, BLANK_CSV[kind], 'text/csv')} />
          <Item label="Example (JSON)" onClick={() => download(`${kind}-example.json`, EXAMPLE_JSON[kind], 'application/json')} />
          <Item label="Example (CSV)" onClick={() => download(`${kind}-example.csv`, EXAMPLE_CSV[kind], 'text/csv')} />
        </div>
      )}
    </div>
  );
}

// A paste-or-drop import for a widget: JSON or CSV in, records out. The first
// record fills the current widget; any extras are inserted as sibling widgets.
function WidgetImport<T>({ kind, parse, onRecords }: { kind: string; parse: (text: string) => T[]; onRecords: (records: T[]) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const run = () => {
    try {
      const recs = parse(text);
      if (!recs.length) {
        setErr('Nothing to import. Check the JSON or CSV.');
        return;
      }
      onRecords(recs);
    } catch {
      setErr('Could not read that. Paste valid JSON or CSV.');
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mb-2 flex items-center gap-1.5 text-xs text-ink-faint hover:text-clay dark:text-coal-soft"
      >
        <Upload className="h-3.5 w-3.5" /> Import {kind} from JSON or CSV
      </button>
    );
  }
  return (
    <div className="mb-3 rounded-lg border border-paper-line bg-paper p-2 dark:border-coal-line dark:bg-coal-panel">
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setErr('');
        }}
        rows={4}
        placeholder={`Paste ${kind} as JSON or CSV, or choose a file…`}
        className="w-full resize-y rounded border border-paper-line bg-paper px-2 py-1.5 font-mono text-xs text-ink outline-none dark:border-coal-line dark:bg-coal dark:text-coal-text"
      />
      {err && <p className="mt-1 text-xs text-rose-500">{err}</p>}
      <div className="mt-1.5 flex items-center gap-1.5">
        <button type="button" onClick={run} disabled={!text.trim()} className="rounded-md bg-clay px-2.5 py-1 text-xs font-medium text-white hover:bg-clay/90 disabled:opacity-40">
          Import
        </button>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="rounded-md border border-paper-line px-2.5 py-1 text-xs text-ink-soft hover:bg-paper-panel dark:border-coal-line dark:text-coal-soft dark:hover:bg-coal-line"
        >
          Choose file
        </button>
        <button type="button" onClick={() => { setOpen(false); setErr(''); }} className="ml-auto text-xs text-ink-faint hover:text-ink-soft dark:text-coal-soft">
          Cancel
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".json,.csv,.tsv,.txt"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void f.text().then(setText);
        }}
      />
    </div>
  );
}

// Bespoke "document" widgets for presets that are really one structured record,
// not a list: a case brief, a statute, a recipe. Each is an atom node whose fields
// live in attrs and edit through auto-growing inputs, so they read like a clean
// card instead of a wide table.

// A labelled, auto-growing text field. Hidden when empty in read-only mode.
function Field({
  label,
  value,
  onChange,
  editable,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  editable: boolean;
  placeholder?: string;
}) {
  if (!editable && !value) return null;
  return (
    <div className="mb-2.5">
      <div className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-clay">{label}</div>
      {editable ? (
        <GrowTextarea
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          className="w-full bg-transparent text-sm leading-relaxed text-ink outline-none placeholder:text-ink-faint dark:text-coal-text dark:placeholder:text-coal-soft"
        />
      ) : (
        <div className="whitespace-pre-wrap text-sm leading-relaxed text-ink dark:text-coal-text">{value}</div>
      )}
    </div>
  );
}

function Meta({ value, onChange, placeholder, editable }: { value: string; onChange: (v: string) => void; placeholder: string; editable: boolean }) {
  if (!editable) return value ? <span>{value}</span> : null;
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      size={Math.max(placeholder.length, (value || '').length || 1)}
      className="bg-transparent outline-none placeholder:text-ink-faint/70 dark:placeholder:text-coal-soft/70"
    />
  );
}

const cardClass =
  'rounded-xl border border-paper-line bg-paper-panel/40 p-4 dark:border-coal-line dark:bg-coal/40';

// --- Case brief -------------------------------------------------------------

function CaseBriefView({ node, updateAttributes, editor, getPos }: NodeViewProps) {
  const editable = editor.isEditable;
  const a = node.attrs as Record<string, string>;
  const set = (k: string) => (v: string) => updateAttributes({ [k]: v });
  const empty = !['title', 'court', 'year', 'citation', 'facts', 'issue', 'holding', 'reasoning', 'notes'].some((k) => a[k]);

  return (
    <NodeViewWrapper className="my-3" contentEditable={false}>
      <div className={cardClass}>
        {editable && empty && (
          <WidgetImport
            kind="case briefs"
            parse={parseCaseBriefs}
            onRecords={(recs) => {
              updateAttributes({ ...recs[0] });
              const pos = typeof getPos === 'function' ? getPos() : null;
              if (recs.length > 1 && pos != null) {
                editor.chain().insertContentAt(pos + node.nodeSize, recs.slice(1).map((r) => ({ type: 'caseBrief', attrs: { ...r } }))).run();
              }
            }}
          />
        )}
        <div className="mb-3 border-b border-paper-line pb-2 dark:border-coal-line">
          <div className="flex items-center gap-2">
            <Scale className="h-4 w-4 shrink-0 text-clay" />
            {editable ? (
              <input
                value={a.title}
                onChange={(e) => updateAttributes({ title: e.target.value })}
                placeholder="Case name"
                className="min-w-0 flex-1 bg-transparent text-base font-semibold text-ink outline-none placeholder:text-ink-faint dark:text-coal-text"
              />
            ) : (
              <span className="min-w-0 flex-1 text-base font-semibold text-ink dark:text-coal-text">{a.title || 'Untitled case'}</span>
            )}
            {editable && <WidgetExport kind="case" record={empty ? null : caseFromAttrs(a)} baseName={a.title} />}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 pl-6 text-xs text-ink-faint dark:text-coal-soft">
            <Meta value={a.court} onChange={set('court')} placeholder="Court" editable={editable} />
            <Meta value={a.year} onChange={set('year')} placeholder="Year" editable={editable} />
            <Meta value={a.citation} onChange={set('citation')} placeholder="Citation" editable={editable} />
          </div>
        </div>
        <Field label="Facts" value={a.facts} onChange={set('facts')} editable={editable} placeholder="What happened" />
        <Field label="Issue" value={a.issue} onChange={set('issue')} editable={editable} placeholder="The legal question" />
        <Field label="Holding" value={a.holding} onChange={set('holding')} editable={editable} placeholder="What the court decided" />
        <Field label="Reasoning" value={a.reasoning} onChange={set('reasoning')} editable={editable} placeholder="Why they decided it" />
        <Field label="My notes" value={a.notes} onChange={set('notes')} editable={editable} placeholder="Anything to remember" />
      </div>
    </NodeViewWrapper>
  );
}

export const CaseBrief = Node.create({
  name: 'caseBrief',
  group: 'block',
  atom: true,
  selectable: true,
  addAttributes() {
    return { title: { default: '' }, court: { default: '' }, year: { default: '' }, citation: { default: '' }, facts: { default: '' }, issue: { default: '' }, holding: { default: '' }, reasoning: { default: '' }, notes: { default: '' } };
  },
  parseHTML() {
    return [{ tag: 'div[data-case-brief]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-case-brief': '' })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(CaseBriefView);
  },
});

// --- Statute ----------------------------------------------------------------

function StatuteView({ node, updateAttributes, editor, getPos }: NodeViewProps) {
  const editable = editor.isEditable;
  const a = node.attrs as Record<string, string>;
  const set = (k: string) => (v: string) => updateAttributes({ [k]: v });
  const empty = !['act', 'section', 'summary', 'link'].some((k) => a[k]);

  return (
    <NodeViewWrapper className="my-3" contentEditable={false}>
      <div className={`${cardClass} border-l-4 border-l-clay`}>
        {editable && empty && (
          <WidgetImport
            kind="statutes"
            parse={parseStatutes}
            onRecords={(recs) => {
              updateAttributes({ ...recs[0] });
              const pos = typeof getPos === 'function' ? getPos() : null;
              if (recs.length > 1 && pos != null) {
                editor.chain().insertContentAt(pos + node.nodeSize, recs.slice(1).map((r) => ({ type: 'statute', attrs: { ...r } }))).run();
              }
            }}
          />
        )}
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Landmark className="h-4 w-4 shrink-0 text-clay" />
          {editable ? (
            <input
              value={a.act}
              onChange={(e) => updateAttributes({ act: e.target.value })}
              placeholder="Act or code"
              className="min-w-0 flex-1 bg-transparent text-base font-semibold text-ink outline-none placeholder:text-ink-faint dark:text-coal-text"
            />
          ) : (
            <span className="text-base font-semibold text-ink dark:text-coal-text">{a.act || 'Untitled act'}</span>
          )}
          <span className="text-ink-faint dark:text-coal-soft">§</span>
          {editable ? (
            <input
              value={a.section}
              onChange={(e) => updateAttributes({ section: e.target.value })}
              placeholder="Section"
              size={Math.max(7, (a.section || '').length)}
              className="bg-transparent text-sm font-medium text-ink outline-none placeholder:text-ink-faint dark:text-coal-text"
            />
          ) : (
            a.section && <span className="text-sm font-medium text-ink dark:text-coal-text">{a.section}</span>
          )}
          {editable && <WidgetExport kind="statute" record={empty ? null : statuteFromAttrs(a)} baseName={a.act} />}
        </div>
        <Field label="Summary" value={a.summary} onChange={set('summary')} editable={editable} placeholder="What it says, in plain words" />
        {editable ? (
          <div className="mt-1 flex items-center gap-1.5">
            <Link2 className="h-3.5 w-3.5 shrink-0 text-ink-faint dark:text-coal-soft" />
            <input
              value={a.link}
              onChange={(e) => updateAttributes({ link: e.target.value })}
              placeholder="Link to the source"
              className="min-w-0 flex-1 bg-transparent text-xs text-ink-soft outline-none placeholder:text-ink-faint dark:text-coal-soft"
            />
          </div>
        ) : (
          a.link && (
            <a href={a.link} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-clay hover:underline">
              <Link2 className="h-3.5 w-3.5" /> source
            </a>
          )
        )}
      </div>
    </NodeViewWrapper>
  );
}

export const Statute = Node.create({
  name: 'statute',
  group: 'block',
  atom: true,
  selectable: true,
  addAttributes() {
    return { act: { default: '' }, section: { default: '' }, summary: { default: '' }, link: { default: '' } };
  },
  parseHTML() {
    return [{ tag: 'div[data-statute]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-statute': '' })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(StatuteView);
  },
});

// --- Recipe -----------------------------------------------------------------

interface Ingredient {
  id: string;
  text: string;
  done: boolean;
}

// Publish a recipe as its own read-only, link-only public page, and manage it.
function RecipeShare({ attrs, updateAttributes }: { attrs: Record<string, unknown>; updateAttributes: (a: Record<string, unknown>) => void }) {
  return (
    <WidgetShare
      attrs={attrs}
      updateAttributes={updateAttributes}
      title={String(attrs.title || 'Recipe')}
      label="recipe"
      docOf={() => ({
        type: 'doc',
        content: [{ type: 'recipeCard', attrs: { title: attrs.title, servings: attrs.servings, time: attrs.time, ingredients: attrs.ingredients, steps: attrs.steps } }],
      })}
    />
  );
}

function RecipeView({ node, updateAttributes, editor, getPos }: NodeViewProps) {
  const editable = editor.isEditable;
  const title = (node.attrs.title as string) || '';
  const servings = (node.attrs.servings as string) || '';
  const time = (node.attrs.time as string) || '';
  const ingredients: Ingredient[] = Array.isArray(node.attrs.ingredients) ? (node.attrs.ingredients as Ingredient[]) : [];
  const steps: string[] = Array.isArray(node.attrs.steps) ? (node.attrs.steps as string[]) : [];

  const setIngredients = (next: Ingredient[]) => updateAttributes({ ingredients: next });
  const setSteps = (next: string[]) => updateAttributes({ steps: next });
  const empty = !title && ingredients.length === 0 && steps.length === 0;
  const [factor, setFactor] = useState(1);
  const [system, setSystem] = useState<UnitSystem>('sv');
  const scaling = factor !== 1 || system !== 'sv';
  const baseServes = parseQty(servings);
  const recipeAttrs = (r: { title: string; servings: string; time: string; ingredients: string[]; steps: string[] }) => ({
    title: r.title,
    servings: r.servings,
    time: r.time,
    ingredients: r.ingredients.map((text) => ({ id: uid('ig'), text, done: false })),
    steps: r.steps,
  });

  return (
    <NodeViewWrapper className="my-3" contentEditable={false}>
      <div className={cardClass}>
        {editable && empty && (
          <WidgetImport
            kind="recipes"
            parse={parseRecipes}
            onRecords={(recs) => {
              updateAttributes(recipeAttrs(recs[0]));
              const pos = typeof getPos === 'function' ? getPos() : null;
              if (recs.length > 1 && pos != null) {
                editor.chain().insertContentAt(pos + node.nodeSize, recs.slice(1).map((r) => ({ type: 'recipeCard', attrs: recipeAttrs(r) }))).run();
              }
            }}
          />
        )}
        <div className="mb-3 flex flex-wrap items-center gap-2 border-b border-paper-line pb-2 dark:border-coal-line">
          <ChefHat className="h-4 w-4 shrink-0 text-clay" />
          {editable ? (
            <input
              value={title}
              onChange={(e) => updateAttributes({ title: e.target.value })}
              placeholder="Recipe name"
              className="min-w-0 flex-1 bg-transparent text-base font-semibold text-ink outline-none placeholder:text-ink-faint dark:text-coal-text"
            />
          ) : (
            <span className="min-w-0 flex-1 text-base font-semibold text-ink dark:text-coal-text">{title || 'Untitled recipe'}</span>
          )}
          <span className="flex items-center gap-1 text-xs text-ink-faint dark:text-coal-soft">
            <Users className="h-3.5 w-3.5" />
            <Meta value={servings} onChange={(v) => updateAttributes({ servings: v })} placeholder="serves" editable={editable} />
          </span>
          <span className="flex items-center gap-1 text-xs text-ink-faint dark:text-coal-soft">
            <Clock className="h-3.5 w-3.5" />
            <Meta value={time} onChange={(v) => updateAttributes({ time: v })} placeholder="time" editable={editable} />
          </span>
          {editable && !empty && <RecipeShare attrs={node.attrs as Record<string, unknown>} updateAttributes={updateAttributes} />}
          {editable && <WidgetExport kind="recipe" record={empty ? null : recipeFromAttrs(node.attrs)} baseName={title} />}
        </div>

        {!empty && (
          <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-ink-faint dark:text-coal-soft">Scale</span>
            {[0.5, 1, 2, 3].map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFactor(f)}
                className={[
                  'rounded px-1.5 py-0.5 font-medium',
                  factor === f ? 'bg-clay text-white' : 'bg-paper-panel text-ink-soft hover:text-clay dark:bg-coal-line dark:text-coal-soft',
                ].join(' ')}
              >
                {f === 0.5 ? '½×' : `${f}×`}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setSystem((s) => (s === 'sv' ? 'us' : 'sv'))}
              className="ml-1 rounded bg-paper-panel px-1.5 py-0.5 font-medium text-ink-soft hover:text-clay dark:bg-coal-line dark:text-coal-soft"
              title="Switch measurement system"
            >
              {system === 'sv' ? 'Svenskt mått' : 'US units'}
            </button>
            {scaling && baseServes != null && (
              <span className="text-ink-faint dark:text-coal-soft">
                for {String(Math.round(baseServes * factor * 10) / 10).replace('.', ',')} servings
              </span>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,11rem)_1fr]">
          {/* Ingredients */}
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-clay">Ingredients</div>
            <div className="space-y-0.5">
              {ingredients.map((it, i) => (
                <div key={it.id} className="group/ing flex items-start gap-1.5">
                  <input
                    type="checkbox"
                    checked={it.done}
                    onChange={(e) => setIngredients(ingredients.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)))}
                    className="mt-1 h-3.5 w-3.5 shrink-0 cursor-pointer accent-clay"
                  />
                  {editable && !scaling ? (
                    <GrowTextarea
                      value={it.text}
                      onChange={(v) => setIngredients(ingredients.map((x, j) => (j === i ? { ...x, text: v } : x)))}
                      className={`min-w-0 flex-1 bg-transparent text-sm leading-relaxed outline-none ${it.done ? 'text-ink-faint line-through dark:text-coal-soft' : 'text-ink dark:text-coal-text'}`}
                    />
                  ) : (
                    <span className={`min-w-0 flex-1 whitespace-pre-wrap text-sm leading-relaxed ${it.done ? 'text-ink-faint line-through dark:text-coal-soft' : 'text-ink dark:text-coal-text'}`}>
                      {scaling ? scaleLine(it.text, factor, system) : it.text}
                    </span>
                  )}
                  {editable && (
                    <button type="button" onClick={() => setIngredients(ingredients.filter((_, j) => j !== i))} className="invisible mt-0.5 rounded p-0.5 text-ink-faint hover:text-rose-500 group-hover/ing:visible">
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {editable && (
              <button
                type="button"
                onClick={() => setIngredients([...ingredients, { id: uid('ig'), text: '', done: false }])}
                className="mt-1 flex items-center gap-1 text-xs text-ink-soft hover:text-clay dark:text-coal-soft"
              >
                <Plus className="h-3.5 w-3.5" /> Add
              </button>
            )}
          </div>

          {/* Steps */}
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-clay">Steps</div>
            <ol className="space-y-1">
              {steps.map((s, i) => (
                <li key={i} className="group/step flex gap-2">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-clay-wash text-[11px] font-semibold text-clay dark:bg-clay/15">
                    {i + 1}
                  </span>
                  {editable ? (
                    <GrowTextarea
                      value={s}
                      onChange={(v) => setSteps(steps.map((x, j) => (j === i ? v : x)))}
                      placeholder="What to do"
                      className="min-w-0 flex-1 bg-transparent text-sm leading-relaxed text-ink outline-none placeholder:text-ink-faint dark:text-coal-text"
                    />
                  ) : (
                    <span className="min-w-0 flex-1 whitespace-pre-wrap text-sm leading-relaxed text-ink dark:text-coal-text">{s}</span>
                  )}
                  {editable && (
                    <button type="button" onClick={() => setSteps(steps.filter((_, j) => j !== i))} className="invisible mt-0.5 h-min rounded p-0.5 text-ink-faint hover:text-rose-500 group-hover/step:visible">
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </li>
              ))}
            </ol>
            {editable && (
              <button type="button" onClick={() => setSteps([...steps, ''])} className="mt-1 flex items-center gap-1 text-xs text-ink-soft hover:text-clay dark:text-coal-soft">
                <Plus className="h-3.5 w-3.5" /> Add step
              </button>
            )}
          </div>
        </div>
      </div>
    </NodeViewWrapper>
  );
}

export const Recipe = Node.create({
  name: 'recipeCard',
  group: 'block',
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      title: { default: '' },
      servings: { default: '' },
      time: { default: '' },
      ingredients: { default: [], renderHTML: () => ({}) },
      steps: { default: [], renderHTML: () => ({}) },
      shareId: { default: '', renderHTML: () => ({}) },
      shareToken: { default: '', renderHTML: () => ({}) },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-recipe]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-recipe': '' })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(RecipeView);
  },
});
