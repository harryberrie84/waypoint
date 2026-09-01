import { useEffect, useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { evaluateFormula, formatFormulaValue, type FormulaScope } from '../lib/formula';
import { useAutoFocus } from './useAutoFocus';

// inlineFormula, a live calculation in the middle of text. Click it to edit the
// expression; it recomputes as you type. Reuses the table formula engine, so
// functions like floor, round, abs, sqrt, min/max work. It can also read values
// you named earlier on the page, e.g. "STR = 15" then "floor((STR-10)/2)" -> 2.

function compute(expr: string, scope: FormulaScope): { ok: boolean; text: string } {
  if (!expr.trim()) return { ok: true, text: '' };
  const r = evaluateFormula(expr, scope);
  return r.ok ? { ok: true, text: formatFormulaValue(r.value) } : { ok: false, text: 'error' };
}

// Scan the page for "name = number" so a formula can reference it. Plain and
// permissive: a word, an equals, a number (Swedish comma decimals allowed).
function pageScope(editor: Editor): FormulaScope {
  const scope: FormulaScope = {};
  editor.state.doc.descendants((node) => {
    if (node.isText && node.text) {
      const re = /\b([A-Za-z_]\w*)\s*=\s*(-?\d+(?:[.,]\d+)?)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(node.text)) !== null) {
        const v = Number(m[2].replace(',', '.'));
        if (Number.isFinite(v)) scope[m[1]] = v;
      }
    }
    return true;
  });
  return scope;
}

function FormulaView({ node, updateAttributes, editor }: NodeViewProps) {
  const expr = (node.attrs.expr as string) || '';
  const editable = editor.isEditable;
  const [editing, setEditing] = useState(!expr && editable);
  // Local draft so typing never triggers an attr update (which would re-render the
  // node and steal focus, the bug where you couldn't change it). Commit on exit.
  const [draft, setDraft] = useState(expr);
  const inputRef = useAutoFocus<HTMLInputElement>(editing && editable);

  // The page scope, rebuilt when the doc settles so named values stay live.
  // Debounced so it doesn't walk the whole doc on every keystroke (that made
  // typing choppy on pages with formulas).
  const [scope, setScope] = useState<FormulaScope>(() => pageScope(editor));
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const update = () => {
      if (t) clearTimeout(t);
      t = setTimeout(() => setScope(pageScope(editor)), 250);
    };
    editor.on('update', update);
    return () => {
      if (t) clearTimeout(t);
      editor.off('update', update);
    };
  }, [editor]);

  const startEdit = () => {
    setDraft((node.attrs.expr as string) || '');
    setEditing(true);
  };
  const commit = () => {
    if (draft !== expr) updateAttributes({ expr: draft });
    setEditing(false);
  };

  if (editing && editable) {
    const live = compute(draft, scope);
    return (
      <NodeViewWrapper as="span" className="inline-formula-edit" contentEditable={false}>
        <span className="text-clay">=</span>
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === 'Escape') {
              e.preventDefault();
              commit();
              editor.commands.focus();
            }
          }}
          placeholder="floor((STR-10)/2)"
          size={Math.max(10, draft.length + 1)}
          className="bg-transparent text-ink outline-none dark:text-coal-text"
        />
        {draft.trim() && <span className="text-ink-faint dark:text-coal-soft"> = {live.text || '?'}</span>}
      </NodeViewWrapper>
    );
  }

  const result = compute(expr, scope);
  return (
    <NodeViewWrapper
      as="span"
      className={`inline-formula${result.ok ? '' : ' inline-formula-err'}`}
      contentEditable={false}
      onClick={() => editable && startEdit()}
      title={editable ? `= ${expr}  (click to edit)` : expr}
    >
      {result.text || (editable ? 'fx' : '')}
    </NodeViewWrapper>
  );
}

export const InlineFormula = Node.create({
  name: 'inlineFormula',
  inline: true,
  group: 'inline',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      expr: {
        default: '',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-formula') || '',
        renderHTML: (attrs: { expr?: string }) => ({ 'data-formula': attrs.expr || '' }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-formula]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    // Serialize the self-contained value as the text (named values aren't known
    // outside the editor), with the expression kept in the data attr.
    return ['span', mergeAttributes(HTMLAttributes, { 'data-formula': (node.attrs.expr as string) || '' }), compute((node.attrs.expr as string) || '', {}).text];
  },

  addNodeView() {
    return ReactNodeViewRenderer(FormulaView);
  },
});
