import { useMemo, useRef, useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { Music, Play, Pause, Download, X, Loader2, Upload, ListMusic } from 'lucide-react';
import { uploadsApi } from '../lib/api';
import { formatBytes } from '../lib/image';
import { formatTime } from '../lib/audio';
import { useData } from '../store/useData';
import { useWorkspaceTables } from '../hooks/useScoped';
import { collectMedia, pageTables, type MediaItem } from '../lib/tripViews';
import { toast } from '../store/useToast';

// audioBlock, a sound file you can play right in the page. Pick the source two
// ways: an audio file already on this page (a table attachment or another audio
// block), or upload one from your device. An uploaded file goes full-size to the
// PocketBase `uploads` collection and the block keeps the URL (audio is far too
// big for the inline data-URL path images/files use); if that collection isn't
// set up, a small file still falls back to an inline data URL and a large one is
// rejected with a hint. Custom transport (play/pause + a seek bar) over a hidden
// <audio>, so it looks like the rest of the widgets and plays on mobile.
// Searchable text rides the `title` attr (lib/search.ts reads it).
//
// NOTE: like images, an uploaded file lives in PocketBase file storage the server
// can read, so this is NOT end-to-end encrypted (same documented limit as images).

// Audio can't be downscaled, so the inline fallback only takes a genuinely small
// clip; anything bigger needs the uploads collection.
const MAX_INLINE_AUDIO_BYTES = 1_400_000;

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(new Error('Could not read that file.'));
    fr.readAsDataURL(file);
  });
}

function AudioView({ node, updateAttributes, editor }: NodeViewProps) {
  const src = (node.attrs.src as string) || '';
  const name = (node.attrs.name as string) || '';
  const title = (node.attrs.title as string) || '';
  const size = (node.attrs.size as number) || 0;
  const editable = editor.isEditable;

  const inputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [uploading, setUploading] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);

  // Audio already on the page you're editing, for the "on this page" source.
  const activePageId = useData((s) => s.activePageId);
  const page = useData((s) => (activePageId ? s.pages[activePageId] : undefined));
  const allTables = useWorkspaceTables();
  const rows = useData((s) => s.rows);
  const pageAudio = useMemo(() => {
    if (!page) return [];
    return collectMedia(page, pageTables(page, allTables), rows).filter((m) => m.isAudio && m.url);
  }, [page, allTables, rows]);

  const pickExisting = (m: MediaItem) => {
    updateAttributes({ src: m.url, name: m.name, title: title || m.name, mime: m.mime, size: m.size });
    setBrowsing(false);
  };

  const pick = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('audio/')) {
      toast('That is not an audio file.', 'error');
      return;
    }
    setUploading(true);
    try {
      let url = await uploadsApi.upload(file);
      if (!url) {
        // No uploads collection (or the rule blocked it): inline a small clip,
        // otherwise there is nowhere to put it.
        if (file.size > MAX_INLINE_AUDIO_BYTES) {
          toast('Audio uploads are not set up on the server, so only small clips (under ~1.4 MB) can be added.', 'error');
          return;
        }
        url = await readAsDataUrl(file);
      }
      updateAttributes({ src: url, name: file.name || 'audio', title: title || file.name || '', mime: file.type, size: file.size });
    } catch {
      toast('Could not add that audio file.', 'error');
    } finally {
      setUploading(false);
    }
  };

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) void a.play().catch(() => toast('Could not play this file.', 'error'));
    else a.pause();
  };

  const seek = (t: number) => {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = t;
    setCurrent(t);
  };

  const remove = () => updateAttributes({ src: '', name: '', title: '', mime: '', size: 0 });

  // Empty: a picker (edit mode) or a quiet placeholder (read-only).
  if (!src) {
    return (
      <NodeViewWrapper className="my-3" contentEditable={false}>
        <input ref={inputRef} type="file" accept="audio/*" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
        <div className="rounded-2xl border border-paper-line bg-paper-panel/50 p-3 dark:border-coal-line dark:bg-coal/40">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-ink-faint dark:text-coal-soft">
            <Music className="h-3.5 w-3.5 text-clay" /> Audio
          </div>
          {editable ? (
            <>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setBrowsing((v) => !v)}
                  className="flex items-center gap-1.5 rounded-lg border border-paper-line px-3 py-1.5 text-sm font-medium text-ink-soft hover:border-clay hover:text-clay dark:border-coal-line dark:text-coal-soft"
                >
                  <ListMusic className="h-3.5 w-3.5" /> On this page{pageAudio.length ? ` (${pageAudio.length})` : ''}
                </button>
                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => inputRef.current?.click()}
                  className="flex items-center gap-1.5 rounded-lg bg-clay px-3 py-1.5 text-sm font-medium text-white hover:bg-clay/90 disabled:opacity-60"
                >
                  {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                  {uploading ? 'Adding…' : 'Upload from device'}
                </button>
              </div>
              {browsing && (
                <div className="mt-2 max-h-56 space-y-1 overflow-y-auto rounded-lg border border-paper-line bg-paper/60 p-1.5 dark:border-coal-line dark:bg-coal/40">
                  {pageAudio.length === 0 ? (
                    <p className="px-1.5 py-2 text-xs text-ink-faint dark:text-coal-soft">No audio on this page yet. Upload one, or add audio elsewhere on the page first.</p>
                  ) : (
                    pageAudio.map((m) => (
                      <button
                        key={m.key}
                        type="button"
                        onClick={() => pickExisting(m)}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-paper-panel dark:hover:bg-coal-line"
                      >
                        <Music className="h-3.5 w-3.5 shrink-0 text-clay" />
                        <span className="min-w-0 flex-1 truncate text-ink dark:text-coal-text">{m.name}</span>
                        {m.size > 0 && <span className="shrink-0 text-[11px] text-ink-faint dark:text-coal-soft">{formatBytes(m.size)}</span>}
                      </button>
                    ))
                  )}
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-ink-faint dark:text-coal-soft">No audio attached.</p>
          )}
        </div>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper className="my-3" contentEditable={false}>
      <input ref={inputRef} type="file" accept="audio/*" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
      <div className="rounded-2xl border border-paper-line bg-paper-panel/40 p-3 dark:border-coal-line dark:bg-coal/30">
        <audio
          ref={audioRef}
          src={src}
          preload="metadata"
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
          onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime || 0)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
        />
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={toggle}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-clay text-white shadow-sm hover:bg-clay/90"
            title={playing ? 'Pause' : 'Play'}
          >
            {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 translate-x-[1px]" />}
          </button>

          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center gap-2">
              {editable ? (
                <input
                  value={title}
                  onChange={(e) => updateAttributes({ title: e.target.value })}
                  placeholder={name || 'Track name'}
                  className="min-w-0 flex-1 bg-transparent text-sm font-medium text-ink outline-none placeholder:text-ink-faint dark:text-coal-text"
                />
              ) : (
                <div className="min-w-0 flex-1 truncate text-sm font-medium text-ink dark:text-coal-text">{title || name || 'Audio'}</div>
              )}
              <span className="shrink-0 whitespace-nowrap text-[11px] tabular-nums text-ink-faint dark:text-coal-soft">
                {formatTime(current)} / {formatTime(duration)}
              </span>
            </div>

            <input
              type="range"
              min={0}
              max={duration || 0}
              step="any"
              value={Math.min(current, duration || 0)}
              onChange={(e) => seek(Number(e.target.value))}
              className="h-1.5 w-full cursor-pointer accent-clay"
              aria-label="Seek"
            />
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <a
              href={src}
              download={name || undefined}
              className="rounded-lg p-1.5 text-ink-faint hover:bg-paper-panel hover:text-clay dark:hover:bg-coal-line"
              title="Download"
            >
              <Download className="h-4 w-4" />
            </a>
            {editable && (
              <button
                type="button"
                onClick={remove}
                className="rounded-lg p-1.5 text-ink-faint hover:bg-paper-panel hover:text-rose-500 dark:hover:bg-coal-line"
                title="Remove audio"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
        {size > 0 && <div className="mt-1.5 pl-14 text-[11px] text-ink-faint dark:text-coal-soft">{formatBytes(size)}</div>}
      </div>
    </NodeViewWrapper>
  );
}

export const AudioBlock = Node.create({
  name: 'audioBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      src: { default: '' },
      name: { default: '' },
      title: { default: '' },
      mime: { default: '' },
      size: { default: 0 },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-audio]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-audio': '' })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(AudioView);
  },
});
