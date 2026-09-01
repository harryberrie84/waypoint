import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import type { Editor } from '@tiptap/core';
import { X } from 'lucide-react';

// Side-by-side columns, like Notion but recursive: a `columnList` holds two or
// more `column`s, each `column` holds any blocks, including another `columnList`,
// so a split can be split again. Columns share width by flex-grow and the divider
// between two columns drags to re-weight just those two.

function ColumnView({ node, editor, getPos }: NodeViewProps) {
  const width = (node.attrs.width as number) || 1;
  const editable = editor.isEditable;

  // Am I the last column? (No divider after the last one.)
  let isLast = true;
  if (typeof getPos === 'function') {
    try {
      const p = getPos();
      if (p != null) {
        const $p = editor.state.doc.resolve(p);
        isLast = $p.index() >= $p.parent.childCount - 1;
      }
    } catch {
      /* positions can be momentarily stale during edits */
    }
  }

  return (
    <NodeViewWrapper
      className="tiptap-column group/col relative min-w-0 rounded-md"
      style={{ '--col-grow': String(width) } as CSSProperties}
    >
      {editable && (
        <button
          type="button"
          contentEditable={false}
          onClick={() => deleteColumn(editor, getPos)}
          title="Delete column"
          className="absolute right-1 top-1 z-10 rounded bg-paper/80 p-0.5 text-ink-faint opacity-0 backdrop-blur transition-opacity hover:bg-rose-500/10 hover:text-rose-500 group-hover/col:opacity-100 dark:bg-coal-panel/80"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
      <NodeViewContent className="min-w-0" />
      {editable && !isLast && (
        <div
          contentEditable={false}
          onPointerDown={(e) => startResize(e, editor, getPos)}
          className="absolute -right-2 top-0 z-10 hidden h-full w-3 cursor-col-resize touch-none items-center justify-center sm:flex"
          title="Drag to resize"
        >
          <div className="h-10 w-1 rounded-full bg-paper-line transition-colors hover:bg-clay/50 dark:bg-coal-line" />
        </div>
      )}
    </NodeViewWrapper>
  );
}

// Remove this column. With more than two columns we just drop it; at exactly two
// we unwrap, the columnList is replaced by the surviving column's blocks so the
// content isn't lost and the (min two columns) schema stays valid.
function deleteColumn(editor: Editor, getPos: NodeViewProps['getPos']) {
  if (typeof getPos !== 'function') return;
  const pos = getPos();
  if (pos == null) return;
  editor
    .chain()
    .focus()
    .command(({ tr }) => {
      const $col = tr.doc.resolve(pos);
      const list = $col.parent;
      const node = $col.nodeAfter;
      if (!node || list.type.name !== 'columnList') return false;
      const index = $col.index();
      if (list.childCount > 2) {
        tr.delete(pos, pos + node.nodeSize);
      } else {
        const listBefore = $col.before($col.depth);
        const listAfter = listBefore + list.nodeSize;
        const survivor = list.child(index === 0 ? 1 : 0);
        tr.replaceWith(listBefore, listAfter, survivor.content);
      }
      return true;
    })
    .run();
}

function startResize(e: ReactPointerEvent, editor: Editor, getPos: NodeViewProps['getPos']) {
  if (typeof getPos !== 'function') return;
  e.preventDefault();
  const handle = e.currentTarget as HTMLElement;
  const row = handle.closest('.tiptap-column')?.parentElement;
  if (!row) return;
  const rowWidth = row.getBoundingClientRect().width;
  if (rowWidth <= 0) return;

  const pos = getPos();
  if (pos == null) return;
  const $pos = editor.state.doc.resolve(pos);
  const parent = $pos.parent;
  const index = $pos.index();
  if (index >= parent.childCount - 1) return;

  const grows: number[] = [];
  parent.forEach((child) => grows.push((child.attrs.width as number) || 1));
  const total = grows.reduce((a, b) => a + b, 0);
  const leftStart = grows[index];
  const rightStart = grows[index + 1];
  const pairTotal = leftStart + rightStart;
  const min = total * 0.12;
  const leftPos = pos;
  const rightPos = pos + parent.child(index).nodeSize;
  const startX = e.clientX;

  const move = (ev: PointerEvent) => {
    const deltaGrow = ((ev.clientX - startX) / rowWidth) * total;
    let left = leftStart + deltaGrow;
    left = Math.max(min, Math.min(pairTotal - min, left));
    const right = pairTotal - left;
    editor.commands.command(({ tr }) => {
      tr.setNodeAttribute(leftPos, 'width', left);
      tr.setNodeAttribute(rightPos, 'width', right);
      tr.setMeta('addToHistory', false);
      return true;
    });
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

export const ColumnList = Node.create({
  name: 'columnList',
  group: 'block',
  content: 'column column+', // at least two columns
  defining: true,
  isolating: true,

  parseHTML() {
    return [{ tag: 'div[data-column-list]' }];
  },
  // No React node view: rendering as a plain div means the columns are its direct
  // children, so the .col-row flex (index.css) lays them out as a row. A node view
  // would insert a wrapper between this element and the columns and break the flex.
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-column-list': '', class: 'col-row' }), 0];
  },
});

export const Column = Node.create({
  name: 'column',
  content: 'block+',
  isolating: true,

  addAttributes() {
    return { width: { default: 1 } };
  },
  parseHTML() {
    return [{ tag: 'div[data-column]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-column': '' }), 0];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ColumnView);
  },
});

// Build a column-list of `count` empty columns, for the slash command.
export function makeColumns(count: number) {
  const columns = Array.from({ length: count }, () => ({
    type: 'column',
    attrs: { width: 1 },
    content: [{ type: 'paragraph' }],
  }));
  return { type: 'columnList', content: columns };
}
