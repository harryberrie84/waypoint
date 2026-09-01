import { Mark, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import { useData } from '../store/useData';

// inlineComment, a mark that wraps a span of text and carries a thread id. The
// comments live in the `comments` collection (tagged with the same id); this mark
// anchors them to the text and is NOT clickable, so the text stays editable. A
// widget decoration draws a small comment badge (icon + count) at the end of each
// commented run; clicking the badge opens the thread.

export const commentDecoKey = new PluginKey('commentBadges');

function badge(threadId: string): HTMLElement {
  const count = useData.getState().commentCounts[threadId] ?? 0;
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'comment-badge';
  el.contentEditable = 'false';
  el.title = 'Open comment';
  el.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>${count > 0 ? `<span>${count}</span>` : ''}`;
  el.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  el.addEventListener('click', (e) => {
    e.preventDefault();
    const rect = el.getBoundingClientRect();
    useData.getState().openCommentThread(threadId, rect.bottom, rect.left);
  });
  return el;
}

function buildDecos(doc: PMNode): DecorationSet {
  const widgets: Decoration[] = [];
  let runEnd = -1;
  let runThread: string | null = null;
  const flush = () => {
    if (runThread && runEnd >= 0) {
      const tid = runThread;
      const count = useData.getState().commentCounts[tid] ?? 0;
      widgets.push(Decoration.widget(runEnd, () => badge(tid), { side: 1, key: `cmt-${tid}-${count}` }));
    }
    runThread = null;
    runEnd = -1;
  };
  doc.descendants((node, pos) => {
    if (node.isText) {
      const mark = node.marks.find((m) => m.type.name === 'inlineComment');
      const tid = (mark?.attrs.threadId as string | undefined) ?? null;
      if (tid) {
        if (tid !== runThread) flush();
        runThread = tid;
        runEnd = pos + node.nodeSize;
      } else {
        flush();
      }
    } else {
      flush(); // a block or other node ends the run
    }
    return true;
  });
  flush();
  return DecorationSet.create(doc, widgets);
}

export const InlineComment = Mark.create({
  name: 'inlineComment',
  inclusive: false,

  addAttributes() {
    return {
      threadId: {
        default: null as string | null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-comment'),
        renderHTML: (attrs: { threadId?: string | null }) =>
          attrs.threadId ? { 'data-comment': attrs.threadId } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-comment]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes({ class: 'inline-comment' }, HTMLAttributes), 0];
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: commentDecoKey,
        state: {
          init: (_config, state) => buildDecos(state.doc),
          // Rebuild on edits, and on a nudge from the count loader (meta flag).
          apply: (tr, old, _oldState, newState) =>
            tr.docChanged || tr.getMeta(commentDecoKey) ? buildDecos(newState.doc) : old.map(tr.mapping, tr.doc),
        },
        props: {
          decorations(state) {
            return commentDecoKey.getState(state);
          },
        },
      }),
    ];
  },
});
