// Inline markdown to ProseMirror text nodes with marks, for paste: **bold**,
// *italic*, `code`, ~~strike~~ and [label](href). Emphasis uses asterisks only (so
// snake_case identifiers are left alone), and emphasised text must not be
// space-padded (so "2 * 3 * 4" is not read as italic). Bold is tried before italic.

export interface InlineNode {
  type: 'text';
  text: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

const SOURCE = /\*\*(\S(?:.*?\S)?)\*\*|\*(\S(?:.*?\S)?)\*|`([^`]+?)`|~~(\S(?:.*?\S)?)~~|\[([^\]]+?)\]\(([^)\s]+?)\)/;

export function hasInlineMarkdown(text: string): boolean {
  return new RegExp(SOURCE.source).test(text);
}

export function parseInlineMarkdown(text: string): InlineNode[] {
  const out: InlineNode[] = [];
  const re = new RegExp(SOURCE.source, 'g');
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ type: 'text', text: text.slice(last, m.index) });
    if (m[1] != null) out.push({ type: 'text', text: m[1], marks: [{ type: 'bold' }] });
    else if (m[2] != null) out.push({ type: 'text', text: m[2], marks: [{ type: 'italic' }] });
    else if (m[3] != null) out.push({ type: 'text', text: m[3], marks: [{ type: 'code' }] });
    else if (m[4] != null) out.push({ type: 'text', text: m[4], marks: [{ type: 'strike' }] });
    else if (m[5] != null) out.push({ type: 'text', text: m[5], marks: [{ type: 'link', attrs: { href: m[6] } }] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) });
  return out;
}
