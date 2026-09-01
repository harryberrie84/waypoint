// A plain-text teaser pulled from a TipTap JSON doc (pages.content), shown on
// the mindmap's page nodes. Walks text nodes, joins block boundaries with a
// space so a heading doesn't glue onto the next paragraph, collapses runs of
// whitespace, and trims to ~140 chars on a word boundary. Atom blocks (embeds,
// images, tables) carry no text and simply contribute nothing, fine for a
// preview. Pure; no React, no store.

import { attrText } from './search';

interface ProseNode {
  type?: string;
  text?: string;
  content?: ProseNode[];
  attrs?: Record<string, unknown>;
}

// Block-level nodes whose end is a natural space in the flattened text.
const BLOCK_TYPES = new Set([
  'paragraph', 'heading', 'blockquote', 'listItem', 'taskItem', 'codeBlock',
  'bulletList', 'orderedList', 'taskList', 'horizontalRule',
]);

export function docExcerpt(doc: unknown, max = 140): string {
  const parts: string[] = [];
  const walk = (node: ProseNode | undefined) => {
    if (!node || typeof node !== 'object') return;
    if (typeof node.text === 'string') parts.push(node.text);
    // Widget nodes (case brief, recipe, statute...) keep their text in attrs.
    if (node.attrs) {
      const t = attrText(node.attrs).trim();
      if (t) parts.push(t + ' ');
    }
    if (Array.isArray(node.content)) {
      for (const child of node.content) walk(child);
      if (node.type && BLOCK_TYPES.has(node.type)) parts.push(' ');
    }
  };
  walk(doc as ProseNode);

  const text = parts.join('').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  // Prefer cutting at the last space before the limit, unless that loses too
  // much; then append an ellipsis.
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  const base = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${base.trimEnd()}…`;
}
