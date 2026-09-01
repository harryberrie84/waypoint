import { useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { Tv, ExternalLink } from 'lucide-react';
import { useAutoFocus } from './useAutoFocus';

// embedBlock, paste a YouTube / Google Maps / Google Docs / Spotify (or any)
// URL and render it as an iframe. Known providers are converted to their proper
// embeddable URL; anything else is iframed as-is (best effort).

export interface EmbedSpec {
  src: string;
  kind: string;
  height?: number; // fixed-height embeds (Spotify); else 16:9 responsive
}

function normalize(raw: string): string {
  const t = raw.trim();
  if (!t) return '';
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

export function embedUrl(raw: string): EmbedSpec | null {
  const url = normalize(raw);
  if (!url) return null;

  // YouTube
  let m = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{6,})/i);
  if (m) return { src: `https://www.youtube.com/embed/${m[1]}`, kind: 'YouTube' };

  // Spotify
  m = url.match(/open\.spotify\.com\/(track|album|playlist|artist|episode|show)\/([\w]+)/i);
  if (m) return { src: `https://open.spotify.com/embed/${m[1]}/${m[2]}`, kind: 'Spotify', height: m[1] === 'track' ? 152 : 352 };

  // Google Docs / Sheets / Slides
  m = url.match(/docs\.google\.com\/(document|spreadsheets|presentation)\/d\/([\w-]+)/i);
  if (m) return { src: `https://docs.google.com/${m[1]}/d/${m[2]}/preview`, kind: 'Google Docs' };

  // Google Maps
  if (/google\.[\w.]+\/maps|maps\.google\.[\w.]+|maps\.app\.goo\.gl/i.test(url)) {
    if (/[?&]output=embed/i.test(url)) return { src: url, kind: 'Google Maps' };
    const at = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/); // @lat,lng
    if (at) return { src: `https://maps.google.com/maps?q=${at[1]},${at[2]}&z=14&output=embed`, kind: 'Google Maps' };
    const place = url.match(/maps\/place\/([^/@]+)/i);
    if (place) return { src: `https://maps.google.com/maps?q=${place[1]}&output=embed`, kind: 'Google Maps' };
    return { src: `${url}${url.includes('?') ? '&' : '?'}output=embed`, kind: 'Google Maps' };
  }

  // Generic
  return { src: url, kind: 'Embed' };
}

function EmbedView({ node, updateAttributes, editor }: NodeViewProps) {
  const url = node.attrs.url as string;
  const editable = editor.isEditable;
  const [draft, setDraft] = useState('');
  const spec = url ? embedUrl(url) : null;
  const urlRef = useAutoFocus<HTMLInputElement>((!url || !spec) && editable);

  if (!url || !spec) {
    return (
      <NodeViewWrapper className="my-3" contentEditable={false}>
        <div className="rounded-xl border border-paper-line bg-paper-panel/50 p-3 dark:border-coal-line dark:bg-coal/40">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-ink-faint dark:text-coal-soft">
            <Tv className="h-3.5 w-3.5 text-clay" /> Embed, YouTube, Google Maps / Docs, Spotify, or any URL
          </div>
          {editable ? (
            <div className="flex items-center gap-2">
              <input
                ref={urlRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && draft.trim() && updateAttributes({ url: normalize(draft) })}
                placeholder="Paste a link to embed…"
                className="flex-1 rounded-lg border border-paper-line bg-paper px-2 py-1.5 text-sm text-ink outline-none dark:border-coal-line dark:bg-coal-panel dark:text-coal-text"
              />
              <button
                type="button"
                onClick={() => draft.trim() && updateAttributes({ url: normalize(draft) })}
                className="rounded-lg bg-clay px-3 py-1.5 text-sm font-medium text-white hover:bg-clay/90"
              >
                Embed
              </button>
            </div>
          ) : (
            <p className="text-sm text-ink-faint dark:text-coal-soft">No embed set.</p>
          )}
        </div>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper className="my-3" contentEditable={false}>
      <div className="overflow-hidden rounded-xl border border-paper-line dark:border-coal-line">
        <div className="flex items-center justify-between gap-2 border-b border-paper-line bg-paper-panel/60 px-2 py-1 text-[11px] text-ink-faint dark:border-coal-line dark:bg-coal/40 dark:text-coal-soft">
          <span>{spec.kind}</span>
          <span className="flex items-center gap-2">
            <a href={url} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-clay">
              <ExternalLink className="h-3 w-3" /> open
            </a>
            {editable && (
              <button type="button" onClick={() => updateAttributes({ url: '' })} className="hover:text-clay">
                replace
              </button>
            )}
          </span>
        </div>
        {spec.height ? (
          <iframe
            src={spec.src}
            title={spec.kind}
            height={spec.height}
            className="w-full"
            style={{ border: 0 }}
            loading="lazy"
            allow="encrypted-media; clipboard-write; picture-in-picture"
            allowFullScreen
          />
        ) : (
          <div className="relative w-full" style={{ paddingBottom: '56.25%' }}>
            <iframe
              src={spec.src}
              title={spec.kind}
              className="absolute inset-0 h-full w-full"
              style={{ border: 0 }}
              loading="lazy"
              allow="accelerometer; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        )}
      </div>
    </NodeViewWrapper>
  );
}

export const EmbedBlock = Node.create({
  name: 'embedBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return { url: { default: '' } };
  },
  parseHTML() {
    return [{ tag: 'div[data-embed]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-embed': '' })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(EmbedView);
  },
});
