import { useEffect, useState } from 'react';
import { X, Download, FileText, File as FileIcon, Music, MessageSquarePlus } from 'lucide-react';
import type { MediaItem } from '../lib/tripViews';
import { isVideoMedia } from '../lib/media';

// MediaPreview, a full-screen previewer for one attachment: images render big,
// audio plays in a player, PDFs open in an embedded viewer (the browser's native
// PDF renderer via an iframe over a Blob URL, so data-URL PDFs display reliably
// and no external library is needed), anything else offers a download. Esc or the
// backdrop closes it; a Download button is always present.

function isPdf(m: MediaItem): boolean {
  return /pdf/i.test(m.mime) || /\.pdf(\?|#|$)/i.test(m.name) || /^data:application\/pdf/i.test(m.url);
}

// Detection lives in lib/media.ts so the harness can test it; re-exported here
// because the Files tab and the previewer both already import from this module.
export { isVideoMedia };

// data: URLs are unreliable inside <iframe> (some browsers block them), so turn
// one into a Blob URL, which embeds cleanly. http(s) URLs are used as-is.
function dataUrlToBlobUrl(dataUrl: string): string | null {
  try {
    const m = /^data:([^;,]*?)(;base64)?,(.*)$/s.exec(dataUrl);
    if (!m) return null;
    const mime = m[1] || 'application/octet-stream';
    const bytesStr = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
    const arr = new Uint8Array(bytesStr.length);
    for (let i = 0; i < bytesStr.length; i++) arr[i] = bytesStr.charCodeAt(i);
    return URL.createObjectURL(new Blob([arr], { type: mime }));
  } catch {
    return null;
  }
}

export function MediaPreview({
  item,
  onClose,
  onComment,
}: {
  item: MediaItem | null;
  onClose: () => void;
  // Given for a body image the caller supports commenting on: opens/anchors a
  // thread. The anchor is where to pop the thread card (below the button).
  onComment?: (item: MediaItem, anchor: { top: number; left: number }) => void;
}) {
  // For embeddable, non-image files (PDFs) resolve a URL the iframe can load.
  const [embedUrl, setEmbedUrl] = useState<string | null>(null);
  const pdf = item ? isPdf(item) : false;
  const video = item ? !item.isImage && !item.isAudio && isVideoMedia(item) : false;

  useEffect(() => {
    if (!item || item.isImage || !pdf) {
      setEmbedUrl(null);
      return;
    }
    if (/^https?:/i.test(item.url)) {
      setEmbedUrl(item.url);
      return;
    }
    const blobUrl = dataUrlToBlobUrl(item.url);
    setEmbedUrl(blobUrl);
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [item, pdf]);

  useEffect(() => {
    if (!item) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [item, onClose]);

  if (!item) return null;

  return (
    <div className="fixed inset-0 z-[90] flex flex-col bg-black/85 backdrop-blur-sm" onClick={onClose}>
      {/* header */}
      <div className="flex items-center gap-3 px-4 py-2.5 text-white" onClick={(e) => e.stopPropagation()}>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.name}</span>
        <span className="hidden shrink-0 text-xs text-white/50 sm:inline">{item.source}</span>
        {onComment && item.pageId && item.isImage && (
          <button
            type="button"
            onClick={(e) => {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              onComment(item, { top: r.bottom, left: r.left });
            }}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium hover:bg-white/20"
            title="Comment on this image"
          >
            <MessageSquarePlus className="h-3.5 w-3.5" /> {item.threadId ? 'Comments' : 'Comment'}
          </button>
        )}
        <a
          href={item.url}
          download={item.name}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium hover:bg-white/20"
          title="Download"
        >
          <Download className="h-3.5 w-3.5" /> Download
        </a>
        <button type="button" onClick={onClose} className="shrink-0 rounded-full bg-white/10 p-2 hover:bg-white/20" title="Close (Esc)">
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* body */}
      <div className="flex min-h-0 flex-1 items-center justify-center p-4" onClick={(e) => e.stopPropagation()}>
        {item.isImage ? (
          <img src={item.url} alt={item.name} className="max-h-full max-w-full rounded-lg object-contain shadow-2xl" />
        ) : item.isAudio ? (
          <div className="flex w-full max-w-xl flex-col items-center gap-5 rounded-2xl bg-white/5 px-8 py-12 text-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-clay/90 text-white shadow-lg">
              <Music className="h-9 w-9" />
            </div>
            <div className="max-w-full truncate text-base font-medium text-white">{item.name}</div>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <audio src={item.url} controls autoPlay className="w-full max-w-md">
              Your browser cannot play this audio.
            </audio>
          </div>
        ) : video ? (
          // Native inline playback: works in every desktop + mobile browser, tap for
          // fullscreen on a phone. playsInline stops iOS from force-fullscreening.
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video src={item.url} controls playsInline preload="metadata" className="max-h-full max-w-full rounded-lg bg-black shadow-2xl">
            Your browser cannot play this video.
          </video>
        ) : pdf && embedUrl ? (
          <iframe src={embedUrl} title={item.name} className="h-full w-full rounded-lg border-0 bg-white shadow-2xl" />
        ) : (
          <div className="flex flex-col items-center gap-3 rounded-2xl bg-white/5 px-10 py-12 text-center text-white/80">
            {pdf ? <FileText className="h-10 w-10 text-white/60" /> : <FileIcon className="h-10 w-10 text-white/60" />}
            <p className="text-sm">{pdf ? 'Preparing preview…' : 'No inline preview for this file type.'}</p>
            <a href={item.url} download={item.name} className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-2 text-sm font-medium hover:bg-white/20">
              <Download className="h-4 w-4" /> Download {item.name}
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
