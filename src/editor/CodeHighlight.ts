import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import { highlightCode } from '../lib/codeHighlight';

// Lightweight syntax highlighting for code blocks, done as ProseMirror inline
// decorations (no node replacement, no dependency). Recomputes only when the doc
// changes. Token colours live in index.css (.tok-keyword / -string / -number /
// -comment).

const key = new PluginKey('codeHighlight');

function build(doc: PMNode): DecorationSet {
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'codeBlock') return;
    const text = node.textContent;
    if (!text) return;
    for (const t of highlightCode(text)) {
      // +1: the code text starts one position inside the codeBlock node.
      decos.push(Decoration.inline(pos + 1 + t.from, pos + 1 + t.to, { class: t.cls }));
    }
  });
  return DecorationSet.create(doc, decos);
}

export const CodeHighlight = Extension.create({
  name: 'codeHighlight',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key,
        state: {
          init: (_, { doc }) => build(doc),
          apply: (tr, old) => (tr.docChanged ? build(tr.doc) : old),
        },
        props: {
          decorations(state) {
            return key.getState(state);
          },
        },
      }),
    ];
  },
});
