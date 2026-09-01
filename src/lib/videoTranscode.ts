// Shrink a video in the browser before it uploads.
//
// This is the one place a runtime dependency earned its place. The job is
// demux -> decode -> scale -> encode -> remux, and the hand-rolled version means
// mp4box for the demux, a WebCodecs pipeline, and a muxer, with audio track
// passthrough as the fiddly part. mediabunny is that stack behind one API, pure
// TypeScript with no wasm blob, and it drives WebCodecs, so the encode runs on
// the same hardware encoder the phone films with. The alternative, ffmpeg.wasm,
// is a ~32 MB software decoder with no hardware path, which is worse on exactly
// the large files this exists for.
//
// Availability is checked, never assumed: WebCodecs needs Safari/iOS 17+, and an
// older browser has to fall back to the honest rejection rather than hang.
import {
  Input,
  Output,
  Conversion,
  BlobSource,
  BufferTarget,
  Mp4OutputFormat,
  ALL_FORMATS,
  QUALITY_MEDIUM,
  type Quality,
} from 'mediabunny';
import { targetDimensions } from './image';

/** Presets the picker offers. `edge` is the longest output edge in pixels. */
export const VIDEO_PRESETS = [
  { label: '1080p', edge: 1920 },
  { label: '720p', edge: 1280 },
  { label: '480p', edge: 854 },
] as const;

/**
 * Codecs offered, most compatible first. H.264 is the default on purpose: it is
 * the least efficient of the three but the only one that plays on everything,
 * and the device doing the encoding is often not the device doing the watching.
 * The others are opt-in with their trade-off stated, never auto-selected.
 */
export const VIDEO_CODECS = [
  { id: 'avc' as const, label: 'H.264', note: 'plays everywhere', test: 'avc1.42001f' },
  { id: 'hevc' as const, label: 'HEVC', note: 'smaller, best on Apple devices', test: 'hvc1.1.6.L93.B0' },
  { id: 'av1' as const, label: 'AV1', note: 'smallest, needs a recent device', test: 'av01.0.04M.08' },
] as const;

export type VideoCodecId = (typeof VIDEO_CODECS)[number]['id'];

export interface CodecSupport {
  id: VideoCodecId;
  /** False when only a software encoder will take it. Worth surfacing: software
   *  AV1 is far heavier than software H.264, so an unmarked AV1 option reads as
   *  "smaller file" and delivers a ten minute wait. */
  hardware: boolean;
}

/** Which of the above this device can encode, and whether the hardware will take
 *  it. A "no" to prefer-hardware is the trustworthy direction here; a "yes" only
 *  means the hint was accepted, not that silicon is doing the work. */
export async function probeCodecs(width = 1280, height = 720): Promise<CodecSupport[]> {
  if (!canTranscodeVideo()) return [];
  const out: CodecSupport[] = [];
  for (const c of VIDEO_CODECS) {
    const config = { codec: c.test, width, height, bitrate: 2_000_000, framerate: 30 };
    let hardware = false;
    try {
      hardware = !!(await VideoEncoder.isConfigSupported({ ...config, hardwareAcceleration: 'prefer-hardware' })).supported;
    } catch {
      // An unsupported combination throws rather than reporting unsupported.
    }
    if (hardware) {
      out.push({ id: c.id, hardware: true });
      continue;
    }
    try {
      if ((await VideoEncoder.isConfigSupported(config)).supported) out.push({ id: c.id, hardware: false });
    } catch {
      // Not encodable at all, leave it off the menu.
    }
  }
  return out;
}

/** Size targets. This is the control that decides whether a file actually
 *  shrinks, so it is offered next to the resolution rather than buried. */
export const VIDEO_TARGETS = [
  { label: 'about 25 MB', bytes: 25_000_000 },
  { label: 'about 50 MB', bytes: 50_000_000 },
  { label: 'about 90 MB', bytes: 90_000_000 },
] as const;

/** Whether this browser can transcode at all. WebCodecs is the hard requirement;
 *  everything else in the pipeline is plain TypeScript. */
export function canTranscodeVideo(): boolean {
  return typeof globalThis.VideoEncoder === 'function' && typeof globalThis.VideoDecoder === 'function';
}

/**
 * Ask the browser whether it can actually encode, not just whether the class
 * exists. The two come apart in practice: snap-packaged Firefox on Linux ships
 * without the ffmpeg encoders, so `VideoEncoder` is present while every codec
 * reports encoding unsupported (about:support shows FEATURE_FAILURE_VIDEO_
 * ENCODING_MISSING), leaving only a slow software fallback. Better to say so up
 * front than after someone waits out a long clip.
 */
export async function probeEncoder(): Promise<{ supported: boolean; hardware: boolean }> {
  if (!canTranscodeVideo()) return { supported: false, hardware: false };
  const config = { codec: 'avc1.42001f', width: 1280, height: 720, bitrate: 2_000_000, framerate: 30 };
  try {
    const hw = await VideoEncoder.isConfigSupported({ ...config, hardwareAcceleration: 'prefer-hardware' });
    if (hw.supported) return { supported: true, hardware: true };
    const any = await VideoEncoder.isConfigSupported(config);
    return { supported: !!any.supported, hardware: false };
  } catch {
    return { supported: false, hardware: false };
  }
}

export interface VideoInfo {
  width: number;
  height: number;
  /** Seconds. 0 when the container does not say. */
  duration: number;
  codec: string;
}

/** Read a picked video's shape so the picker can show what it is and warn when a
 *  preset would not actually shrink the frame. Cheap: headers only, no decode. */
export async function probeVideo(file: File): Promise<VideoInfo | null> {
  try {
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack();
    if (!track) return null;
    return {
      width: track.displayWidth,
      height: track.displayHeight,
      duration: await input.computeDuration().catch(() => 0),
      codec: track.codec ?? '',
    };
  } catch {
    return null; // an unreadable container just shows no detail
  }
}

/** "24:31", or "1:02:09" past an hour. */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** Audio we leave room for when sizing the video stream. */
const AUDIO_BITRATE = 128_000;

/**
 * The video bitrate that lands a clip of `duration` seconds near `targetBytes`.
 * This is the control that actually matters: a quality preset re-encodes an
 * already-modest 720p source at a HIGHER bitrate than it came in at, so the file
 * comes out the same size or bigger, which is exactly what a "compress" button
 * must never do. Returns 0 when the duration is unknown and the caller has to
 * fall back to a preset.
 */
export function bitrateForTarget(targetBytes: number, duration: number, audioBitrate = AUDIO_BITRATE): number {
  if (duration <= 0 || targetBytes <= 0) return 0;
  // Leave a few percent for container overhead so the result lands under, not over.
  const video = (targetBytes * 8 * 0.96) / duration - audioBitrate;
  return Math.max(120_000, Math.floor(video));
}

/** Never spend more bitrate than the source already used: re-encoding upward
 *  costs time and adds nothing. Returns the bitrate to actually request. */
export function clampToSource(wanted: number, sourceBytes: number, duration: number): number {
  if (duration <= 0) return wanted;
  const source = (sourceBytes * 8) / duration;
  return Math.min(wanted, Math.floor(source * 0.9));
}

export interface TranscodeResult {
  file: File;
  /** Bytes saved, for the "12.4 MB from 155.6 MB" line in the picker. */
  from: number;
  to: number;
}

/**
 * Re-encode `file` so its longest edge is at most `edge` px, keeping the aspect
 * ratio. Audio rides along untouched where the format allows it. `onProgress`
 * receives 0 to 1. Rejects if the browser cannot transcode, so callers should
 * gate on `canTranscodeVideo()` first and offer the plain rejection instead.
 */
export interface TranscodeOptions {
  /** Longest output edge in px. */
  edge: number;
  /** Aim for roughly this many bytes. Wins over a quality preset when the
   *  duration is known, because it is the only control that guarantees the file
   *  actually gets smaller. */
  targetBytes?: number;
  /** Defaults to H.264, the only one that plays everywhere. */
  codec?: VideoCodecId;
}

export async function transcodeVideo(
  file: File,
  opts: TranscodeOptions,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<TranscodeResult> {
  if (!canTranscodeVideo()) throw new Error('This browser cannot compress video.');

  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error('That file has no video track to compress.');

  // Scale from the track's own dimensions so a portrait phone clip stays portrait
  // instead of being letterboxed into a landscape box.
  const dim = targetDimensions(track.displayWidth, track.displayHeight, opts.edge);
  const duration = await input.computeDuration().catch(() => 0);

  // Size target first, clamped so we never ask for more bitrate than the source
  // already spent. Falls back to a preset only when the duration is unknown.
  let bitrate: number | Quality = QUALITY_MEDIUM;
  if (opts.targetBytes) {
    const wanted = bitrateForTarget(opts.targetBytes, duration);
    if (wanted > 0) bitrate = clampToSource(wanted, file.size, duration);
  }

  const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });

  // NO hardwareAcceleration hint. Asking for 'prefer-hardware' on a machine with
  // no hardware encoder fails the encoder config for EVERY codec, H.264
  // included, and it fails late: Conversion.init returns a valid-looking
  // conversion and the config only blows up inside execute(), so a guard around
  // init never fires. 'no-preference' (the default) already uses hardware where
  // it exists, so the hint bought nothing and broke compression outright.
  const codec = opts.codec ?? 'avc';
  const conversion = await Conversion.init({
    input,
    output,
    video: { width: dim.width, height: dim.height, fit: 'contain', codec, bitrate },
  });
  if (!conversion.isValid) {
    throw new Error(
      codec === 'avc'
        ? 'This browser cannot compress video.'
        : `This browser cannot encode ${codec.toUpperCase()}. Try H.264.`,
    );
  }
  if (onProgress) conversion.onProgress = (p) => onProgress(p);

  // A long clip on a software encoder is slow, so the caller must be able to
  // stop it rather than sit there with a spinner.
  const onAbort = () => void conversion.cancel();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    await conversion.execute();
  } catch (err) {
    if (signal?.aborted) throw new Error('Compression cancelled.');
    // The encoder config can still fail here rather than at init, so turn the
    // library's codec-string message into something actionable.
    const detail = err instanceof Error ? err.message : '';
    if (/not supported|configuration/i.test(detail)) {
      throw new Error(
        codec === 'avc'
          ? 'This browser could not encode the video at that size. Try a smaller resolution.'
          : `This browser could not encode ${codec.toUpperCase()}. Try H.264.`,
      );
    }
    throw err;
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }

  const buffer = output.target.buffer;
  if (!buffer) throw new Error('Compressing produced no output.');
  const stem = (file.name || 'video').replace(/\.[^.]+$/, '');
  const out = new File([buffer], `${stem}-${dim.height}p.mp4`, { type: 'video/mp4', lastModified: file.lastModified });
  return { file: out, from: file.size, to: out.size };
}
