import { useEffect, useRef, useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { Gauge, Plus, Trash2, Check } from 'lucide-react';
import { WidgetIO } from './WidgetIO';
import { serializeChecklist, parseChecklist, READINESS_TEMPLATE } from '../lib/checklistIO';
import { toast } from '../store/useToast';

// readinessBlock, a "how ready are we?" gauge: a checklist of trip milestones
// (flights booked, hotel booked, visa, insurance…) with a big live percentage
// ring, so the whole crew can see at a glance what's still undone. Styled like
// the countdown / vote cards.

interface ReadyItem {
  id: string;
  label: string;
  done: boolean;
}

function newId(): string {
  return Math.random().toString(36).slice(2, 9);
}

function readItems(attrs: Record<string, unknown>): ReadyItem[] {
  const raw = attrs.items;
  return Array.isArray(raw) ? (raw as ReadyItem[]) : [];
}

const DEFAULTS = ['Flights booked', 'Somewhere to stay', 'Passports valid', 'Travel insurance', 'Packed'];

function Ring({ pct }: { pct: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 64 64" className="h-16 w-16 shrink-0 -rotate-90">
      <circle cx="32" cy="32" r={r} fill="none" strokeWidth="6" className="stroke-paper-line dark:stroke-coal-line" />
      <circle
        cx="32"
        cy="32"
        r={r}
        fill="none"
        strokeWidth="6"
        strokeLinecap="round"
        className="stroke-clay transition-[stroke-dashoffset] duration-500"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - pct / 100)}
      />
    </svg>
  );
}

function ReadinessView({ node, updateAttributes, editor }: NodeViewProps) {
  const editable = editor.isEditable;
  const items = readItems(node.attrs);
  const title = (node.attrs.title as string) || 'Trip readiness';
  const [editing, setEditing] = useState(false);

  const write = (next: ReadyItem[]) => updateAttributes({ items: next });
  const patch = (id: string, p: Partial<ReadyItem>) => write(items.map((it) => (it.id === id ? { ...it, ...p } : it)));
  const add = (label = '') => write([...items, { id: newId(), label, done: false }]);
  const remove = (id: string) => write(items.filter((it) => it.id !== id));

  // Seed a starter checklist so /readiness opens useful, then let them edit.
  const seeded = useRef(false);
  useEffect(() => {
    if (!seeded.current && editable && items.length === 0) {
      seeded.current = true;
      write(DEFAULTS.map((label) => ({ id: newId(), label, done: false })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const exportText = () => serializeChecklist(title, items.map((it) => ({ text: it.label, done: it.done })));
  const importText = (text: string): boolean => {
    const parsed = parseChecklist(text);
    if (parsed.items.length === 0) {
      toast('Nothing to import, check the format', 'error');
      return false;
    }
    updateAttributes({ title: parsed.title || title, items: parsed.items.map((it) => ({ id: newId(), label: it.text, done: it.done })) });
    toast(`Imported ${parsed.items.length} items`);
    return true;
  };

  const done = items.filter((it) => it.done).length;
  const pct = items.length ? Math.round((done / items.length) * 100) : 0;
  const blurb = pct === 100 ? 'all set, bon voyage!' : pct >= 60 ? 'nearly there' : pct > 0 ? 'getting started' : "let's plan this";

  return (
    <NodeViewWrapper className="my-3" contentEditable={false}>
      <div className="overflow-hidden rounded-xl border border-paper-line bg-gradient-to-br from-clay-wash/50 to-paper-panel/40 dark:border-coal-line dark:from-clay/10 dark:to-coal/40">
        <div className="flex items-center gap-3 p-3">
          <div className="relative flex items-center justify-center">
            <Ring pct={pct} />
            <span className="absolute font-mono text-sm font-bold tabular-nums text-clay">{pct}%</span>
          </div>
          <div className="min-w-0 flex-1">
            {editing && editable ? (
              <input
                value={title}
                onChange={(e) => updateAttributes({ title: e.target.value })}
                className="w-full rounded-lg border border-paper-line bg-paper px-2 py-1 text-sm font-semibold text-ink outline-none dark:border-coal-line dark:bg-coal-panel dark:text-coal-text"
              />
            ) : (
              <div className="flex items-center gap-1.5 text-sm font-semibold text-ink dark:text-coal-text">
                <Gauge className="h-4 w-4 text-clay" /> {title}
              </div>
            )}
            <div className="mt-0.5 text-[11px] text-ink-faint dark:text-coal-soft">
              {done} of {items.length} done · {blurb}
            </div>
          </div>
          {editable && (
            <button type="button" onClick={() => setEditing((e) => !e)} className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-ink-soft hover:bg-paper-panel dark:text-coal-soft dark:hover:bg-coal-line">
              {editing ? 'Done' : 'Edit'}
            </button>
          )}
        </div>

        <div className="space-y-1 border-t border-paper-line px-3 py-2 dark:border-coal-line">
          {items.map((it) => (
            <div key={it.id} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => editable && patch(it.id, { done: !it.done })}
                disabled={!editable}
                className={[
                  'flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors',
                  it.done ? 'border-clay bg-clay text-white' : 'border-paper-line hover:border-clay dark:border-coal-line',
                ].join(' ')}
                title={it.done ? 'Mark not done' : 'Mark done'}
              >
                {it.done && <Check className="h-3.5 w-3.5" />}
              </button>
              {editing && editable ? (
                <input
                  value={it.label}
                  onChange={(e) => patch(it.id, { label: e.target.value })}
                  placeholder="A milestone…"
                  className="min-w-0 flex-1 rounded-lg border border-paper-line bg-paper px-2 py-1 text-sm text-ink outline-none dark:border-coal-line dark:bg-coal-panel dark:text-coal-text"
                />
              ) : (
                <span className={['min-w-0 flex-1 truncate text-sm', it.done ? 'text-ink-faint line-through dark:text-coal-soft' : 'text-ink dark:text-coal-text'].join(' ')}>{it.label || 'Untitled'}</span>
              )}
              {editing && editable && (
                <button type="button" onClick={() => remove(it.id)} title="Remove" className="shrink-0 rounded-md p-1 text-ink-faint hover:bg-paper-panel hover:text-rose-500 dark:hover:bg-coal-line">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
          {editing && editable && (
            <button type="button" onClick={() => add()} className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-paper-line py-1.5 text-sm text-ink-faint hover:border-clay hover:text-clay dark:border-coal-line">
              <Plus className="h-4 w-4" /> Add a milestone
            </button>
          )}
        </div>
        {editable && (
          <div className="border-t border-paper-line px-3 py-2 dark:border-coal-line">
            <WidgetIO fileName="readiness.txt" templateName="readiness-template.txt" templateText={READINESS_TEMPLATE} getText={exportText} onImport={importText} />
          </div>
        )}
      </div>
    </NodeViewWrapper>
  );
}

export const ReadinessBlock = Node.create({
  name: 'readinessBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      title: { default: 'Trip readiness' },
      items: {
        default: [],
        parseHTML: (el: HTMLElement) => {
          try {
            return JSON.parse(el.getAttribute('data-items') || '[]');
          } catch {
            return [];
          }
        },
        renderHTML: (attrs: { items?: ReadyItem[] }) => ({ 'data-items': JSON.stringify(attrs.items || []) }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-readiness]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-readiness': '' })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ReadinessView);
  },
});
