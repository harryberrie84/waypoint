import { useState } from 'react';
import CodeBlock from '@tiptap/extension-code-block';
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { Copy, Check } from 'lucide-react';

// A code block with a one-click copy button (a small overlay, shown on hover) and
// an optional filename header. Extends the standard code block, so syntax
// highlighting, the ``` input rule and Tab still work; only the chrome is added.

function CodeBlockComponent({ node, updateAttributes, editor }: NodeViewProps) {
  const [copied, setCopied] = useState(false);
  const filename = (node.attrs.filename as string) || '';
  const editable = editor.isEditable;

  const copy = () => {
    void navigator.clipboard.writeText(node.textContent).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };

  return (
    <NodeViewWrapper className="group/code relative my-3">
      {(editable || filename) && (
        <div className="flex items-center px-3 pt-1.5 text-[11px] text-ink-faint dark:text-coal-soft" contentEditable={false}>
          {editable ? (
            <input
              value={filename}
              onChange={(e) => updateAttributes({ filename: e.target.value })}
              placeholder="filename (optional)"
              className="min-w-0 flex-1 bg-transparent font-mono outline-none placeholder:text-ink-faint/60"
            />
          ) : (
            <span className="min-w-0 flex-1 truncate font-mono">{filename}</span>
          )}
        </div>
      )}
      <button
        type="button"
        onClick={copy}
        contentEditable={false}
        title="Copy code"
        className="absolute right-2 top-1.5 z-10 flex items-center gap-1 rounded-md border border-paper-line bg-paper px-1.5 py-0.5 text-[11px] text-ink-faint opacity-0 transition-opacity hover:text-ink group-hover/code:opacity-100 dark:border-coal-line dark:bg-coal-panel dark:hover:text-coal-text"
      >
        {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
        {copied ? 'Copied' : 'Copy'}
      </button>
      <pre>
        <NodeViewContent as={'code' as 'div'} />
      </pre>
    </NodeViewWrapper>
  );
}

export const CodeBlockWithCopy = CodeBlock.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      filename: {
        default: '',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-filename') || '',
        renderHTML: (attrs: { filename?: string }) => (attrs.filename ? { 'data-filename': attrs.filename } : {}),
      },
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockComponent);
  },
});
