import { Mark, mergeAttributes } from '@tiptap/core';

// Highlight, a small custom mark instead of @tiptap/extension-highlight, to keep
// the dep surface flat (the repo's bias toward small custom nodes/marks). Renders
// <mark data-hl style="--hl: <color>">; index.css reads --hl with a sensible
// default for marks with no explicit swatch. The selection menu offers a few
// theme-token swatches; multicolor is just the `color` attr.

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    highlight: {
      setHighlight: (attrs?: { color?: string }) => ReturnType;
      toggleHighlight: (attrs?: { color?: string }) => ReturnType;
      unsetHighlight: () => ReturnType;
    };
  }
}

export const Highlight = Mark.create({
  name: 'highlight',

  addAttributes() {
    return {
      color: {
        default: null as string | null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-color'),
        renderHTML: (attrs: { color?: string | null }) =>
          attrs.color ? { 'data-color': attrs.color, style: `--hl: ${attrs.color}` } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'mark' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['mark', mergeAttributes({ 'data-hl': '' }, HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setHighlight: (attrs) => ({ commands }) => commands.setMark('highlight', attrs),
      toggleHighlight: (attrs) => ({ commands }) => commands.toggleMark('highlight', attrs),
      unsetHighlight: () => ({ commands }) => commands.unsetMark('highlight'),
    };
  },
});
