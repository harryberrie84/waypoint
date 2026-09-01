import { useEffect, useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { Sigma } from 'lucide-react';
import 'katex/dist/katex.min.css';
import { useAutoFocus } from './useAutoFocus';

// mathBlock, a TeX equation rendered with KaTeX. The library loads lazily the
// first time a formula renders, so it stays out of the main bundle.

function MathView({ node, updateAttributes, editor }: NodeViewProps) {
  const latex = (node.attrs.latex as string) || '';
  const editable = editor.isEditable;
  const [html, setHtml] = useState('');
  const [err, setErr] = useState('');
  const taRef = useAutoFocus<HTMLTextAreaElement>(!latex && editable);

  useEffect(() => {
    let alive = true;
    if (!latex.trim()) {
      setHtml('');
      setErr('');
      return;
    }
    void import('katex').then((m) => {
      if (!alive) return;
      try {
        setHtml(m.default.renderToString(latex, { displayMode: true, throwOnError: true, output: 'html' }));
        setErr('');
      } catch (e) {
        setHtml('');
        setErr(e instanceof Error ? e.message.replace(/^KaTeX parse error: /, '') : 'Could not render that');
      }
    });
    return () => {
      alive = false;
    };
  }, [latex]);

  return (
    <NodeViewWrapper className="my-3" contentEditable={false}>
      <div className="rounded-xl border border-paper-line bg-paper-panel/40 p-3 dark:border-coal-line dark:bg-coal/40">
        {latex.trim() ? (
          err ? (
            <div className="text-sm text-rose-500">{err}</div>
          ) : (
            <div className="overflow-x-auto text-center text-ink dark:text-coal-text" dangerouslySetInnerHTML={{ __html: html }} />
          )
        ) : (
          <div className="flex items-center gap-1.5 text-sm text-ink-faint dark:text-coal-soft">
            <Sigma className="h-4 w-4 text-clay" /> Write a formula in TeX below.
          </div>
        )}
        {editable && (
          <textarea
            ref={taRef}
            value={latex}
            onChange={(e) => updateAttributes({ latex: e.target.value })}
            placeholder="\frac{-b \pm \sqrt{b^2 - 4ac}}{2a}"
            rows={Math.max(1, latex.split('\n').length)}
            className="mt-2 w-full resize-y rounded-lg border border-paper-line bg-paper px-2 py-1.5 font-mono text-xs text-ink outline-none placeholder:text-ink-faint dark:border-coal-line dark:bg-coal-panel dark:text-coal-text"
          />
        )}
      </div>
    </NodeViewWrapper>
  );
}

export const MathBlock = Node.create({
  name: 'mathBlock',
  group: 'block',
  atom: true,
  selectable: true,
  addAttributes() {
    return { latex: { default: '' } };
  },
  parseHTML() {
    return [{ tag: 'div[data-math]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-math': '' })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(MathView);
  },
});
