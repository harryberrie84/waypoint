import { useEffect, useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { Link2, Loader2, ExternalLink } from 'lucide-react';
import { domainOf, faviconUrl, normalizeUrl, fetchLinkMeta } from '../lib/linkMeta';
import { useAutoFocus } from './useAutoFocus';

// bookmarkBlock, paste a URL, get a rich card (title, description, thumbnail,
// favicon). Metadata comes from this server, which reads the page (see
// lib/linkMeta); if that fails we still show the link, the domain and the icon.

export { domainOf, faviconUrl };

function BookmarkView({ node, updateAttributes, editor }: NodeViewProps) {
  const url = node.attrs.url as string;
  const title = node.attrs.title as string;
  const description = node.attrs.description as string;
  const image = node.attrs.image as string;
  const editable = editor.isEditable;

  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const urlRef = useAutoFocus<HTMLInputElement>(!url && editable);

  useEffect(() => {
    if (!url || title) return; // already resolved
    let cancelled = false;
    setLoading(true);
    (async () => {
      const meta = await fetchLinkMeta(url);
      if (cancelled) return;
      updateAttributes(
        meta && meta.title
          ? { title: meta.title, description: meta.description, image: meta.image }
          : { title: domainOf(url) },
      );
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [url, title, updateAttributes]);

  if (!url) {
    return (
      <NodeViewWrapper className="my-3" contentEditable={false}>
        <div className="rounded-xl border border-paper-line bg-paper-panel/50 p-3 dark:border-coal-line dark:bg-coal/40">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-ink-faint dark:text-coal-soft">
            <Link2 className="h-3.5 w-3.5 text-clay" /> Bookmark a link
          </div>
          {editable ? (
            <div className="flex items-center gap-2">
              <input
                ref={urlRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && draft.trim() && updateAttributes({ url: normalizeUrl(draft) })}
                placeholder="Paste a URL…"
                className="flex-1 rounded-lg border border-paper-line bg-paper px-2 py-1.5 text-sm text-ink outline-none dark:border-coal-line dark:bg-coal-panel dark:text-coal-text"
              />
              <button
                type="button"
                onClick={() => draft.trim() && updateAttributes({ url: normalizeUrl(draft) })}
                className="rounded-lg bg-clay px-3 py-1.5 text-sm font-medium text-white hover:bg-clay/90"
              >
                Add
              </button>
            </div>
          ) : (
            <p className="text-sm text-ink-faint dark:text-coal-soft">No link set.</p>
          )}
        </div>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper className="my-3" contentEditable={false}>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="group flex overflow-hidden rounded-xl border border-paper-line bg-paper transition-colors hover:border-clay/50 dark:border-coal-line dark:bg-coal-panel"
      >
        <div className="min-w-0 flex-1 p-3">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-ink dark:text-coal-text">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-ink-faint" /> : null}
            <span className="truncate">{title || domainOf(url)}</span>
          </div>
          {description && (
            <p className="mt-1 line-clamp-2 text-xs text-ink-soft dark:text-coal-soft">{description}</p>
          )}
          <div className="mt-2 flex items-center gap-1.5 text-[11px] text-ink-faint dark:text-coal-soft">
            {faviconUrl(url) && (
              <img
                src={faviconUrl(url)}
                alt=""
                className="h-3.5 w-3.5 rounded-sm"
                // Plenty of sites serve no /favicon.ico. Drop the broken-image
                // glyph rather than showing it next to every such link.
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
            )}
            <span className="truncate">{domainOf(url)}</span>
            <ExternalLink className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
          </div>
        </div>
        {image && (
          <div
            className="hidden w-32 shrink-0 bg-cover bg-center sm:block"
            style={{ backgroundImage: `url(${image})` }}
            aria-hidden
          />
        )}
      </a>
      {editable && (
        <button
          type="button"
          onClick={() => updateAttributes({ url: '', title: '', description: '', image: '' })}
          className="mt-1 text-[11px] text-ink-faint hover:text-clay dark:text-coal-soft"
        >
          Replace link
        </button>
      )}
    </NodeViewWrapper>
  );
}

export const BookmarkBlock = Node.create({
  name: 'bookmarkBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      url: { default: '' },
      title: { default: '' },
      description: { default: '' },
      image: { default: '' },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-bookmark]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-bookmark': '' })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(BookmarkView);
  },
});
