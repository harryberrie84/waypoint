import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { TextSelection } from '@tiptap/pm/state';
import { ChevronRight } from 'lucide-react';

// A collapsible section, built as three nodes like a details/summary: a `toggle`
// container holding a `toggleSummary` (the title line, always shown, with the
// chevron) and a `toggleContent` (the body that folds away). This keeps title and
// body distinct so it is obvious what collapses, and Enter in the title drops you
// into the body instead of doing nothing.

function ToggleView({ node, updateAttributes }: NodeViewProps) {
  const open = node.attrs.open !== false;
  return (
    <NodeViewWrapper className="toggle" data-open={open ? 'true' : 'false'}>
      <button
        type="button"
        contentEditable={false}
        onClick={() => updateAttributes({ open: !open })}
        className="toggle-chevron"
        title={open ? 'Collapse' : 'Expand'}
        tabIndex={-1}
      >
        <ChevronRight className={`h-4 w-4 transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      <NodeViewContent className="toggle-body" />
    </NodeViewWrapper>
  );
}

export const Toggle = Node.create({
  name: 'toggle',
  group: 'block',
  content: 'toggleSummary toggleContent',
  defining: true,

  addAttributes() {
    return {
      open: {
        default: true,
        parseHTML: (el) => el.getAttribute('data-open') !== 'false',
        renderHTML: (attrs) => ({ 'data-open': attrs.open ? 'true' : 'false' }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-toggle]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-toggle': '' }), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ToggleView);
  },
});

export const ToggleSummary = Node.create({
  name: 'toggleSummary',
  content: 'inline*',
  defining: true,
  selectable: false,

  parseHTML() {
    return [{ tag: 'div[data-toggle-summary]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-toggle-summary': '', class: 'toggle-summary' }), 0];
  },

  addKeyboardShortcuts() {
    // Enter in the title opens the toggle (if closed) and moves the cursor into
    // the body, so you can keep typing the part that folds.
    const intoBody = () => {
      const { state, view } = this.editor;
      const { selection } = state;
      if (!selection.empty) return false;
      const { $from } = selection;
      if ($from.parent.type.name !== 'toggleSummary') return false;
      const toggle = $from.node(-1);
      if (!toggle || toggle.type.name !== 'toggle') return false;

      const togglePos = $from.before(-1);
      const contentPos = togglePos + 1 + toggle.child(0).nodeSize; // before toggleContent
      let tr = state.tr;
      if (!toggle.attrs.open) tr = tr.setNodeMarkup(togglePos, undefined, { ...toggle.attrs, open: true });
      tr = tr.setSelection(TextSelection.near(tr.doc.resolve(contentPos + 1))).scrollIntoView();
      view.dispatch(tr);
      return true;
    };
    return { Enter: intoBody, 'Shift-Enter': intoBody };
  },
});

export const ToggleContent = Node.create({
  name: 'toggleContent',
  content: 'block+',
  defining: true,
  selectable: false,
  isolating: true,

  parseHTML() {
    return [{ tag: 'div[data-toggle-content]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-toggle-content': '', class: 'toggle-content' }), 0];
  },
});
