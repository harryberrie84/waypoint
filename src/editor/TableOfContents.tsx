import { useEffect, useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import type { Editor } from '@tiptap/core';
import { List } from 'lucide-react';

// tableOfContents, a live outline of the page's headings. Built from the doc on
// every change, so it stays right as you write; clicking an entry scrolls to it.

interface Heading {
  level: number;
  text: string;
  pos: number;
}

function collectHeadings(editor: Editor): Heading[] {
  const out: Heading[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      const text = node.textContent.trim();
      if (text) out.push({ level: node.attrs.level as number, text, pos });
    }
    return true;
  });
  return out;
}

function TocView({ editor }: NodeViewProps) {
  const [items, setItems] = useState<Heading[]>(() => collectHeadings(editor));

  useEffect(() => {
    // Debounced so rebuilding the heading list doesn't walk the doc on every
    // keystroke (kept typing smooth on long pages).
    let t: ReturnType<typeof setTimeout> | null = null;
    const update = () => {
      if (t) clearTimeout(t);
      t = setTimeout(() => setItems(collectHeadings(editor)), 250);
    };
    editor.on('update', update);
    editor.on('selectionUpdate', update);
    return () => {
      if (t) clearTimeout(t);
      editor.off('update', update);
      editor.off('selectionUpdate', update);
    };
  }, [editor]);

  const jump = (pos: number) => {
    try {
      const dom = editor.view.nodeDOM(pos) ?? editor.view.domAtPos(pos).node;
      const el = dom instanceof HTMLElement ? dom : (dom?.parentElement ?? null);
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch {
      /* the heading moved out from under us; the next render fixes the list */
    }
  };

  const min = items.length ? Math.min(...items.map((h) => h.level)) : 1;

  return (
    <NodeViewWrapper className="my-3" contentEditable={false}>
      <div className="rounded-xl border border-paper-line bg-paper-panel/40 p-3 dark:border-coal-line dark:bg-coal/40">
        <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-ink-faint dark:text-coal-soft">
          <List className="h-3.5 w-3.5 text-clay" /> On this page
        </div>
        {items.length === 0 ? (
          <p className="text-sm text-ink-faint dark:text-coal-soft">Add a heading and it shows up here.</p>
        ) : (
          <ul className="space-y-0.5">
            {items.map((h, i) => (
              <li key={i} style={{ paddingLeft: `${(h.level - min) * 0.9}rem` }}>
                <button
                  type="button"
                  onClick={() => jump(h.pos)}
                  className="truncate text-left text-sm text-ink-soft hover:text-clay dark:text-coal-soft"
                >
                  {h.text}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </NodeViewWrapper>
  );
}

export const TableOfContents = Node.create({
  name: 'tableOfContents',
  group: 'block',
  atom: true,
  selectable: true,

  parseHTML() {
    return [{ tag: 'div[data-toc]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-toc': '' })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(TocView);
  },
});
