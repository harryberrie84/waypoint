// ---------------------------------------------------------------------------
// Capture, append a jotted line to a page's TipTap doc as a checkbox.
// ---------------------------------------------------------------------------
// Two-tap capture writes into an Inbox page without mounting the editor, so the
// append is pure JSON surgery. Repeated captures merge into a trailing taskList
// instead of spawning a new list each time, which keeps the inbox a single tidy
// checklist.

export interface DocNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
  text?: string;
  marks?: unknown[];
}

function isDoc(d: unknown): d is DocNode {
  return !!d && typeof d === 'object' && (d as DocNode).type === 'doc';
}

/** A taskItem carrying one line of text (empty paragraph if blank). */
export function taskItemNode(text: string): DocNode {
  return {
    type: 'taskItem',
    attrs: { checked: false },
    content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }],
  };
}

/** Return a new doc with `text` appended as an unchecked checkbox, folded into
 *  the last taskList when the doc already ends in one. Never mutates `doc`. */
export function appendCapture(doc: unknown, text: string): DocNode {
  const content = isDoc(doc) && Array.isArray(doc.content) ? [...doc.content] : [];
  const item = taskItemNode(text);
  const last = content[content.length - 1];
  if (last && last.type === 'taskList') {
    content[content.length - 1] = { ...last, content: [...(last.content ?? []), item] };
  } else {
    content.push({ type: 'taskList', content: [item] });
  }
  return { type: 'doc', content };
}

/** Return a new doc with an image block (a data URL) appended. Same `image` node
 *  the slash menu inserts, so it renders identically. Never mutates `doc`. */
export function appendImage(doc: unknown, src: string): DocNode {
  const content = isDoc(doc) && Array.isArray(doc.content) ? [...doc.content] : [];
  content.push({ type: 'image', attrs: { src } });
  return { type: 'doc', content };
}
