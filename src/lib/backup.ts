// Turn a TipTap/ProseMirror doc into plain Markdown for the data export. Covers
// the everyday blocks (headings, paragraphs, lists, todos, quotes, code, rules);
// custom blocks (images, embedded tables, the budget readout, etc.) fall back to
// their text, since the JSON dump in the same backup keeps the exact structure.

interface Node {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  content?: Node[];
}

function inline(node: Node): string {
  if (node.type === 'text') {
    let t = node.text ?? '';
    for (const m of node.marks ?? []) {
      if (m.type === 'bold') t = `**${t}**`;
      else if (m.type === 'italic') t = `*${t}*`;
      else if (m.type === 'code') t = `\`${t}\``;
      else if (m.type === 'strike') t = `~~${t}~~`;
      else if (m.type === 'link') t = `[${t}](${String(m.attrs?.href ?? '')})`;
    }
    return t;
  }
  return (node.content ?? []).map(inline).join('');
}

// First paragraph-ish child of a list item, as inline text.
function itemText(li: Node): string {
  const first = (li.content ?? [])[0];
  return first ? inline(first) : inline(li);
}

export function pageToMarkdown(title: string, content: unknown): string {
  const lines: string[] = [];
  if (title) {
    lines.push(`# ${title}`, '');
  }
  const doc = content && typeof content === 'object' ? (content as Node) : null;

  const walk = (nodes: Node[] | undefined) => {
    for (const n of nodes ?? []) {
      switch (n.type) {
        case 'heading':
          lines.push(`${'#'.repeat(Math.min(6, Number(n.attrs?.level) || 1))} ${inline(n)}`, '');
          break;
        case 'paragraph': {
          const t = inline(n);
          lines.push(t, '');
          break;
        }
        case 'bulletList':
          for (const li of n.content ?? []) lines.push(`- ${itemText(li)}`);
          lines.push('');
          break;
        case 'orderedList':
          (n.content ?? []).forEach((li, i) => lines.push(`${i + 1}. ${itemText(li)}`));
          lines.push('');
          break;
        case 'taskList':
          for (const ti of n.content ?? []) lines.push(`- [${ti.attrs?.checked ? 'x' : ' '}] ${itemText(ti)}`);
          lines.push('');
          break;
        case 'blockquote':
          lines.push(`> ${inline(n)}`, '');
          break;
        case 'codeBlock':
          lines.push('```', inline(n), '```', '');
          break;
        case 'horizontalRule':
          lines.push('---', '');
          break;
        default: {
          if (n.content) walk(n.content);
          else {
            const t = inline(n);
            if (t) lines.push(t, '');
          }
        }
      }
    }
  };
  walk(doc?.content);
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

// Safe-ish file name for a page or table inside the zip.
export function safeFileName(name: string, fallback: string): string {
  const cleaned = (name || fallback).replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim();
  return cleaned.slice(0, 80) || fallback;
}
