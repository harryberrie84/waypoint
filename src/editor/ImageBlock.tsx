import { useEffect, useRef, useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { MessageSquarePlus, MessageSquare, Maximize2 } from 'lucide-react';
import { useData } from '../store/useData';
import { commentsApi } from '../lib/api';
import { uid } from '../lib/id';
import { MediaPreview } from '../components/MediaPreview';
import type { MediaItem } from '../lib/tripViews';

// ---------------------------------------------------------------------------
// image, a block-level image node. The src is a data URL embedded in the doc
// JSON (see lib/image.ts). It carries an optional `threadId` so you can comment
// on the image itself, the same as commenting on selected text: the thread rides
// the shared InlineCommentThread popover (comments keyed by thread id), so no new
// storage, encryption, or realtime, it all just works.
// ---------------------------------------------------------------------------

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    image: {
      setImage: (attrs: { src: string; alt?: string }) => ReturnType;
    };
  }
}

function ImageView({ node, updateAttributes, editor, selected }: NodeViewProps) {
  const src = (node.attrs.src as string) || '';
  const alt = (node.attrs.alt as string) || '';
  const threadId = (node.attrs.threadId as string) || '';
  const openThread = useData((s) => s.openCommentThread);
  const commentThread = useData((s) => s.commentThread);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<MediaItem | null>(null);
  const expand = () => setPreview({ key: 'img', name: alt || 'Image', url: src, mime: '', size: 0, isImage: true, isAudio: false, source: 'Page body' });

  const open = () => {
    let id = threadId;
    if (!id) {
      if (!editor.isEditable) return; // can't anchor a new thread on a read-only image
      id = uid('cmt');
      updateAttributes({ threadId: id });
    }
    const r = wrapRef.current?.getBoundingClientRect();
    openThread(id, r ? r.bottom : 120, r ? r.left : 120);
  };

  // Mirror text comments: if a just-opened thread is closed (or resolved) without
  // any comment, drop the badge so a stray empty thread never lingers.
  const watching = useRef(false);
  useEffect(() => {
    if (!threadId) return;
    if (commentThread?.threadId === threadId) {
      watching.current = true;
      return;
    }
    if (watching.current && !commentThread) {
      watching.current = false;
      void commentsApi
        .listForThread(threadId)
        .then((list) => {
          if (list.length === 0) updateAttributes({ threadId: '' });
        })
        .catch(() => {});
    }
  }, [commentThread, threadId, updateAttributes]);

  return (
    <NodeViewWrapper className="my-3 inline-block max-w-full leading-none" contentEditable={false}>
      <div ref={wrapRef} className="group relative inline-block max-w-full">
        {src && (
          <img
            src={src}
            alt={alt}
            draggable={false}
            className={['max-h-[70vh] max-w-full rounded-lg border', selected ? 'border-clay ring-2 ring-clay/40' : 'border-paper-line dark:border-coal-line'].join(' ')}
          />
        )}
        {/* existing thread → always-visible badge */}
        {threadId && (
          <button
            type="button"
            onClick={open}
            title="Open image comments"
            className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-clay px-1.5 py-0.5 text-[11px] font-semibold text-white shadow-md hover:bg-clay-soft"
          >
            <MessageSquare className="h-3 w-3" />
          </button>
        )}
        {/* add a comment → hover button, editable pages only */}
        {editor.isEditable && (
          <button
            type="button"
            onClick={open}
            title="Comment on this image"
            className="absolute right-2 top-2 flex items-center gap-1 rounded-md bg-black/45 px-1.5 py-1 text-[11px] font-medium text-white opacity-0 transition-opacity hover:bg-black/65 group-hover:opacity-100"
          >
            <MessageSquarePlus className="h-3.5 w-3.5" /> Comment
          </button>
        )}
        {/* expand → hover button, always (viewing works read-only too) */}
        {src && (
          <button
            type="button"
            onClick={expand}
            title="Expand"
            className="absolute bottom-2 right-2 flex items-center gap-1 rounded-md bg-black/45 px-1.5 py-1 text-[11px] font-medium text-white opacity-0 transition-opacity hover:bg-black/65 group-hover:opacity-100"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <MediaPreview item={preview} onClose={() => setPreview(null)} />
    </NodeViewWrapper>
  );
}

export const ImageBlock = Node.create({
  name: 'image',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      src: { default: '' },
      alt: { default: '' },
      threadId: { default: '' },
    };
  },

  parseHTML() {
    return [{ tag: 'img[src]' }];
  },

  renderHTML({ HTMLAttributes }) {
    // Static fallback (exports, print, public projections without the nodeview).
    return [
      'img',
      mergeAttributes(HTMLAttributes, {
        class: 'my-3 max-h-[70vh] max-w-full rounded-lg border border-paper-line dark:border-coal-line',
        draggable: 'false',
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageView);
  },

  addCommands() {
    return {
      setImage:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: 'image', attrs }),
    };
  },
});
