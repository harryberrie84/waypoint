import { useEffect, useState } from 'react';
import { Upload, X, Image as ImageIcon, FileVideo, Music, File as FileIcon, Loader2, Check, AlertTriangle, Wand2 } from 'lucide-react';
import { compressImageToFile, formatBytes, MAX_UPLOAD_BYTES } from '../lib/image';
import { isVideoFile } from '../lib/media';
import {
  canTranscodeVideo,
  transcodeVideo,
  probeEncoder,
  probeVideo,
  probeCodecs,
  formatDuration,
  VIDEO_PRESETS,
  VIDEO_TARGETS,
  VIDEO_CODECS,
  type VideoInfo,
  type VideoCodecId,
  type CodecSupport,
} from '../lib/videoTranscode';
import { toast } from '../store/useToast';

// The picker before the upload: what you chose, how big it is, whether it clears
// the server cap, and a shrink control for the ones that do not. Uploading blind
// and getting a rejection after the wait was the thing to fix.

type Status = 'ready' | 'over' | 'working' | 'done';

interface Pick {
  id: string;
  file: File; // the current (possibly compressed) file, this is what uploads
  original: File;
  status: Status;
  /** 0 to 1 while a video is transcoding, since that one is not instant. */
  progress?: number;
  /** Seconds left, from the observed rate rather than a capability guess. */
  eta?: number;
}

const EDGES = [
  { label: 'Original', edge: 0 },
  { label: '4K, 3840px', edge: 3840 },
  { label: '2K, 2560px', edge: 2560 },
  { label: 'Full HD, 1920px', edge: 1920 },
  { label: 'Small, 1280px', edge: 1280 },
];

function iconFor(file: File) {
  if (file.type.startsWith('image/')) return ImageIcon;
  if (isVideoFile(file)) return FileVideo;
  if (file.type.startsWith('audio/')) return Music;
  return FileIcon;
}

function statusOf(file: File): Status {
  return file.size > MAX_UPLOAD_BYTES ? 'over' : 'ready';
}

export function UploadModal({
  files,
  onCancel,
  onUpload,
}: {
  files: File[];
  onCancel: () => void;
  onUpload: (files: File[]) => void;
}) {
  const [picks, setPicks] = useState<Pick[]>([]);
  const [edge, setEdge] = useState(1920);
  const [quality, setQuality] = useState(0.85);
  const [videoEdge, setVideoEdge] = useState(1280);
  const [videoTarget, setVideoTarget] = useState(50_000_000);
  const [videoCodec, setVideoCodec] = useState<VideoCodecId>('avc');
  const [codecs, setCodecs] = useState<CodecSupport[]>([]);
  const [abort, setAbort] = useState<AbortController | null>(null);
  const [encoder, setEncoder] = useState<{ supported: boolean; hardware: boolean } | null>(null);
  const [info, setInfo] = useState<Record<string, VideoInfo>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPicks(files.map((f, i) => ({ id: `${i}:${f.name}:${f.size}`, file: f, original: f, status: statusOf(f) })));
  }, [files]);

  // Probe once per batch: what the browser can encode, and what each video
  // actually is, so the presets below can be honest about what they will do.
  useEffect(() => {
    const vids = files.filter(isVideoFile);
    if (!vids.length) return;
    let live = true;
    void probeEncoder().then((e) => { if (live) setEncoder(e); });
    void probeCodecs().then((c) => { if (live) setCodecs(c); });
    void Promise.all(vids.map(async (f) => [`${f.name}:${f.size}`, await probeVideo(f)] as const)).then((pairs) => {
      if (!live) return;
      const next: Record<string, VideoInfo> = {};
      for (const [key, v] of pairs) if (v) next[key] = v;
      setInfo(next);
    });
    return () => { live = false; };
  }, [files]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, busy]);

  const images = picks.filter((p) => p.original.type.startsWith('image/'));
  const videos = picks.filter((p) => isVideoFile(p.original));
  const canVideo = canTranscodeVideo();
  const blocked = picks.filter((p) => p.status === 'over');
  const sendable = picks.filter((p) => p.status !== 'over');
  const total = sendable.reduce((n, p) => n + p.file.size, 0);

  const shrinkImages = async () => {
    if (!images.length) return;
    setBusy(true);
    try {
      for (const p of images) {
        setPicks((cur) => cur.map((c) => (c.id === p.id ? { ...c, status: 'working' } : c)));
        try {
          const out = edge === 0
            ? await compressImageToFile(p.original, { quality })
            : await compressImageToFile(p.original, { maxEdge: edge, quality });
          setPicks((cur) => cur.map((c) => (c.id === p.id ? { ...c, file: out, status: statusOf(out) === 'over' ? 'over' : 'done' } : c)));
        } catch {
          // Leave the original in place; its own status still tells the truth.
          setPicks((cur) => cur.map((c) => (c.id === p.id ? { ...c, status: statusOf(c.file) } : c)));
          toast(`Could not compress ${p.original.name}.`, 'error');
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const shrinkVideos = async () => {
    if (!videos.length) return;
    const ac = new AbortController();
    setAbort(ac);
    setBusy(true);
    try {
      for (const p of videos) {
        if (ac.signal.aborted) break;
        setPicks((cur) => cur.map((c) => (c.id === p.id ? { ...c, status: 'working', progress: 0 } : c)));
        // Measured, not guessed: once a little real work is done, the observed
        // rate says how long the rest takes far better than any capability probe.
        const startedAt = performance.now();
        try {
          const res = await transcodeVideo(
            p.original,
            { edge: videoEdge, targetBytes: videoTarget, codec: videoCodec },
            (f) => {
              const elapsed = (performance.now() - startedAt) / 1000;
              const eta = f > 0.02 ? (elapsed * (1 - f)) / f : undefined;
              setPicks((cur) => cur.map((c) => (c.id === p.id ? { ...c, progress: f, eta } : c)));
            },
            ac.signal,
          );
          setPicks((cur) =>
            cur.map((c) => (c.id === p.id ? { ...c, file: res.file, progress: undefined, eta: undefined, status: statusOf(res.file) === 'over' ? 'over' : 'done' } : c)),
          );
        } catch (err) {
          setPicks((cur) => cur.map((c) => (c.id === p.id ? { ...c, progress: undefined, eta: undefined, status: statusOf(c.file) } : c)));
          toast(err instanceof Error ? err.message : `Could not compress ${p.original.name}.`, 'error');
        }
      }
    } finally {
      setBusy(false);
      setAbort(null);
    }
  };

  const reset = (p: Pick) =>
    setPicks((cur) => cur.map((c) => (c.id === p.id ? { ...c, file: c.original, status: statusOf(c.original) } : c)));

  const drop = (p: Pick) => setPicks((cur) => cur.filter((c) => c.id !== p.id));

  return (
    <div className="fixed inset-0 z-[1200] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={() => !busy && onCancel()}>
      <div
        className="max-h-[92vh] w-full max-w-lg overflow-hidden rounded-t-2xl border border-paper-line bg-paper shadow-2xl sm:rounded-2xl dark:border-coal-line dark:bg-coal-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-paper-line px-4 py-3 dark:border-coal-line">
          <Upload className="h-4 w-4 text-clay" />
          <h2 className="text-sm font-semibold text-ink dark:text-coal-text">
            Add {picks.length} file{picks.length === 1 ? '' : 's'}
          </h2>
          <button type="button" onClick={onCancel} disabled={busy} className="ml-auto rounded-lg p-1 text-ink-faint hover:bg-paper-panel disabled:opacity-40 dark:text-coal-soft dark:hover:bg-coal-line/50">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[46vh] overflow-y-auto px-4 py-3">
          {picks.map((p) => {
            const Icon = iconFor(p.original);
            const shrunk = p.file !== p.original;
            return (
              <div key={p.id} className="flex items-center gap-2.5 border-b border-paper-line/60 py-2 last:border-0 dark:border-coal-line/60">
                <Icon className={`h-4 w-4 shrink-0 ${p.status === 'over' ? 'text-red-500' : 'text-clay'}`} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-ink dark:text-coal-text">{p.original.name}</p>
                  <p className="text-[11px] text-ink-faint dark:text-coal-soft">
                    {shrunk ? (
                      <span className="text-clay">{formatBytes(p.original.size)} to {formatBytes(p.file.size)}</span>
                    ) : (
                      formatBytes(p.file.size)
                    )}
                    {p.status === 'over' && (
                      <span className="text-red-500"> · over the {formatBytes(MAX_UPLOAD_BYTES)} limit</span>
                    )}
                    {p.progress !== undefined && (
                      <span className="text-clay">
                        {' '}· compressing {Math.round(p.progress * 100)}%
                        {p.eta !== undefined && p.eta > 1 ? `, about ${formatDuration(p.eta)} left` : ''}
                      </span>
                    )}
                    {(() => {
                      const v = info[`${p.original.name}:${p.original.size}`];
                      if (!v) return null;
                      return (
                        <span> · {v.width}x{v.height}{v.duration > 0 ? ` · ${formatDuration(v.duration)}` : ''}</span>
                      );
                    })()}
                  </p>
                  {p.progress !== undefined && (
                    <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-paper-panel dark:bg-coal-line">
                      <div className="h-full bg-clay transition-all" style={{ width: `${Math.round(p.progress * 100)}%` }} />
                    </div>
                  )}
                </div>
                {p.status === 'working' && <Loader2 className="h-3.5 w-3.5 animate-spin text-clay" />}
                {p.status === 'done' && <Check className="h-3.5 w-3.5 text-green-600" />}
                {p.status === 'over' && <AlertTriangle className="h-3.5 w-3.5 text-red-500" />}
                {shrunk && (
                  <button type="button" onClick={() => reset(p)} disabled={busy} className="rounded px-1.5 py-0.5 text-[11px] text-ink-faint hover:text-clay disabled:opacity-40 dark:text-coal-soft">
                    undo
                  </button>
                )}
                <button type="button" onClick={() => drop(p)} disabled={busy} title="Remove from this upload" className="rounded p-1 text-ink-faint hover:text-red-500 disabled:opacity-40 dark:text-coal-soft">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>

        {images.length > 0 && (
          <div className="border-t border-paper-line px-4 py-3 dark:border-coal-line">
            <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-ink-soft dark:text-coal-soft">
              <Wand2 className="h-3.5 w-3.5 text-clay" /> Shrink images before uploading
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={edge}
                onChange={(e) => setEdge(Number(e.target.value))}
                disabled={busy}
                className="rounded-lg border border-paper-line bg-paper px-2 py-1 text-xs text-ink dark:border-coal-line dark:bg-coal dark:text-coal-text"
              >
                {EDGES.map((o) => (
                  <option key={o.edge} value={o.edge}>{o.label}</option>
                ))}
              </select>
              <label className="flex items-center gap-1.5 text-[11px] text-ink-faint dark:text-coal-soft">
                quality
                <input type="range" min={0.4} max={0.95} step={0.05} value={quality} disabled={busy} onChange={(e) => setQuality(Number(e.target.value))} className="accent-clay" />
                {Math.round(quality * 100)}%
              </label>
              <button
                type="button"
                onClick={() => void shrinkImages()}
                disabled={busy}
                className="rounded-lg border border-clay px-2.5 py-1 text-xs font-medium text-clay hover:bg-clay-wash disabled:opacity-60 dark:hover:bg-clay/10"
              >
                {busy ? 'Working…' : `Shrink ${images.length} image${images.length === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        )}

        {videos.length > 0 && (
          <div className="border-t border-paper-line px-4 py-3 dark:border-coal-line">
            <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-ink-soft dark:text-coal-soft">
              <FileVideo className="h-3.5 w-3.5 text-clay" /> Compress video on this device
            </div>
            {encoder && !encoder.supported && (
              // Only claim what is actually knowable. isConfigSupported with a
              // hardware hint is not a reliable hardware signal (Chrome reports
              // supported and then falls back), so the speed guess was wrong as
              // often as right and told people to switch to the browser they
              // were already in. "No encoder at all" is the one honest verdict:
              // snap Firefox on Linux reports exactly that.
              <p className="mb-2 rounded-lg bg-amber-500/10 px-2 py-1.5 text-[11px] text-ink dark:text-coal-text">
                This browser reports no working video encoder, so compressing here will fail or crawl. Chrome
                handles it; a snap-packaged Firefox on Linux does not ship the encoders at all.
              </p>
            )}
            {canVideo ? (
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={videoEdge}
                  onChange={(e) => setVideoEdge(Number(e.target.value))}
                  disabled={busy}
                  className="rounded-lg border border-paper-line bg-paper px-2 py-1 text-xs text-ink dark:border-coal-line dark:bg-coal dark:text-coal-text"
                >
                  {VIDEO_PRESETS.map((o) => (
                    <option key={o.edge} value={o.edge}>{o.label}</option>
                  ))}
                </select>
                <select
                  value={videoTarget}
                  onChange={(e) => setVideoTarget(Number(e.target.value))}
                  disabled={busy}
                  title="The bitrate is worked out from this, so the file really does come out this size"
                  className="rounded-lg border border-paper-line bg-paper px-2 py-1 text-xs text-ink dark:border-coal-line dark:bg-coal dark:text-coal-text"
                >
                  {VIDEO_TARGETS.map((o) => (
                    <option key={o.bytes} value={o.bytes}>{o.label}</option>
                  ))}
                </select>
                {codecs.length > 1 && (
                  <select
                    value={videoCodec}
                    onChange={(e) => setVideoCodec(e.target.value as VideoCodecId)}
                    disabled={busy}
                    className="rounded-lg border border-paper-line bg-paper px-2 py-1 text-xs text-ink dark:border-coal-line dark:bg-coal dark:text-coal-text"
                  >
                    {VIDEO_CODECS.map((c) => ({ ...c, support: codecs.find((s) => s.id === c.id) }))
                      .filter((c) => c.support)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label}, {c.support?.hardware ? c.note : 'software here, slow'}
                        </option>
                      ))}
                  </select>
                )}
                <button
                  type="button"
                  onClick={() => void shrinkVideos()}
                  disabled={busy}
                  className="rounded-lg border border-clay px-2.5 py-1 text-xs font-medium text-clay hover:bg-clay-wash disabled:opacity-60 dark:hover:bg-clay/10"
                >
                  {busy ? 'Compressing…' : `Compress ${videos.length} video${videos.length === 1 ? '' : 's'}`}
                </button>
                {abort && (
                  <button
                    type="button"
                    onClick={() => abort.abort()}
                    className="rounded-lg border border-paper-line px-2.5 py-1 text-xs text-ink-soft hover:border-red-500 hover:text-red-500 dark:border-coal-line dark:text-coal-soft"
                  >
                    Stop
                  </button>
                )}
                <span className="text-[11px] text-ink-faint dark:text-coal-soft">
                  {videos.every((p) => {
                    const v = info[`${p.original.name}:${p.original.size}`];
                    return v && Math.max(v.width, v.height) <= videoEdge;
                  }) && Object.keys(info).length > 0
                    ? 'already this small, so only the bitrate drops'
                    : 'runs here, nothing is sent yet'}
                </span>
              </div>
            ) : (
              <p className="text-[11px] text-ink-faint dark:text-coal-soft">
                This browser has no WebCodecs support (Safari needs 17 or newer), so video has to be shrunk before
                you pick it, for example{' '}
                <code className="rounded bg-paper-panel px-1 py-0.5 font-mono text-[10px] dark:bg-coal-line/60">ffmpeg -i in.mp4 -vf scale=-2:1080 -crf 26 out.mp4</code>.
              </p>
            )}
          </div>
        )}

        {blocked.length > 0 && (
          <div className="border-t border-paper-line bg-red-500/5 px-4 py-2.5 dark:border-coal-line">
            <p className="text-[11px] text-ink dark:text-coal-text">
              {blocked.length} file{blocked.length === 1 ? '' : 's'} over the {formatBytes(MAX_UPLOAD_BYTES)} limit
              {blocked.some((p) => isVideoFile(p.original)) && canVideo ? ', compress the video above to send it' : ' will be skipped'}.
            </p>
          </div>
        )}

        <div className="flex items-center gap-2 border-t border-paper-line px-4 py-3 dark:border-coal-line">
          <span className="text-[11px] text-ink-faint dark:text-coal-soft">
            {sendable.length} ready, {formatBytes(total)}
          </span>
          <button type="button" onClick={onCancel} disabled={busy} className="ml-auto rounded-lg px-3 py-1.5 text-xs text-ink-soft hover:bg-paper-panel disabled:opacity-40 dark:text-coal-soft dark:hover:bg-coal-line/50">
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || sendable.length === 0}
            onClick={() => onUpload(sendable.map((p) => p.file))}
            className="rounded-lg bg-clay px-3 py-1.5 text-xs font-medium text-white hover:bg-clay/90 disabled:opacity-60"
          >
            Upload {sendable.length || ''}
          </button>
        </div>
      </div>
    </div>
  );
}

