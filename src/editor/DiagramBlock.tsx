import { useEffect, useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { Workflow } from 'lucide-react';
import { useAutoFocus } from './useAutoFocus';

// diagramBlock, a Mermaid flow/sequence rendered from text. Mermaid is heavy, so
// it loads lazily the first time a diagram renders and is initialised once.

type Mermaid = (typeof import('mermaid'))['default'];
let mermaidReady: Promise<Mermaid> | null = null;
let renderSeq = 0;

function loadMermaid(): Promise<Mermaid> {
  if (!mermaidReady) {
    const dark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
    mermaidReady = import('mermaid').then((m) => {
      m.default.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'default' });
      return m.default;
    });
  }
  return mermaidReady;
}

function DiagramView({ node, updateAttributes, editor }: NodeViewProps) {
  const code = (node.attrs.code as string) || '';
  const editable = editor.isEditable;
  const [svg, setSvg] = useState('');
  const [err, setErr] = useState('');
  const taRef = useAutoFocus<HTMLTextAreaElement>(!code && editable);

  useEffect(() => {
    let alive = true;
    if (!code.trim()) {
      setSvg('');
      setErr('');
      return;
    }
    void loadMermaid().then(async (mermaid) => {
      try {
        const { svg } = await mermaid.render(`mmd-${++renderSeq}`, code);
        if (alive) {
          setSvg(svg);
          setErr('');
        }
      } catch (e) {
        if (alive) {
          setSvg('');
          setErr(e instanceof Error ? e.message : 'Could not render the diagram');
        }
      }
    });
    return () => {
      alive = false;
    };
  }, [code]);

  return (
    <NodeViewWrapper className="my-3" contentEditable={false}>
      <div className="rounded-xl border border-paper-line bg-paper-panel/40 p-3 dark:border-coal-line dark:bg-coal/40">
        {code.trim() ? (
          err ? (
            <div className="whitespace-pre-wrap text-sm text-rose-500">{err}</div>
          ) : (
            <div className="flex justify-center overflow-x-auto [&_svg]:max-w-full" dangerouslySetInnerHTML={{ __html: svg }} />
          )
        ) : (
          <div className="flex items-center gap-1.5 text-sm text-ink-faint dark:text-coal-soft">
            <Workflow className="h-4 w-4 text-clay" /> Describe a diagram in Mermaid below.
          </div>
        )}
        {editable && (
          <textarea
            ref={taRef}
            value={code}
            onChange={(e) => updateAttributes({ code: e.target.value })}
            placeholder={'flowchart TD\n  A[Start] --> B{Decide}\n  B -->|yes| C[Go]\n  B -->|no| D[Stop]'}
            rows={Math.max(3, code.split('\n').length)}
            className="mt-2 w-full resize-y rounded-lg border border-paper-line bg-paper px-2 py-1.5 font-mono text-xs text-ink outline-none placeholder:text-ink-faint dark:border-coal-line dark:bg-coal-panel dark:text-coal-text"
          />
        )}
      </div>
    </NodeViewWrapper>
  );
}

export const DiagramBlock = Node.create({
  name: 'diagramBlock',
  group: 'block',
  atom: true,
  selectable: true,
  addAttributes() {
    return { code: { default: '' } };
  },
  parseHTML() {
    return [{ tag: 'div[data-diagram]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-diagram': '' })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(DiagramView);
  },
});
