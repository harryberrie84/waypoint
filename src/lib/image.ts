// ---------------------------------------------------------------------------
// Image & file handling (no backend changes required).
// ---------------------------------------------------------------------------
import type { AttachmentValue } from '../types';

// Images are embedded directly into the page's TipTap JSON as data URLs. The
// `content` field caps at ~2MB, so we downscale anything large via a canvas and
// re-encode to JPEG, then enforce a final size ceiling. This keeps media fully
// client-side and avoids needing a PocketBase file collection for v1.

const MAX_DIMENSION = 2000; // px, longest edge (only for the inline-data-URL fallback)
const MAX_BYTES = 1_400_000; // ceiling for the resulting data URL (well under the 2MB field cap)

/** What we accept per file, deliberately a touch under the `uploads.file`
 *  maxSize the uploads collection declares (100 MB vs 100 MiB). Refusing slightly
 *  early is the safe direction: the real ceiling is Cloudflare's proxied
 *  request-body limit on the free plan, and multipart overhead rides on top of
 *  the file itself, so a file that just clears the server cap can still be cut
 *  at the tunnel. It also keeps the message a round number. */
export const MAX_UPLOAD_BYTES = 100_000_000;

export class ImageTooLargeError extends Error {}
export class FileTooLargeError extends Error {}

// Attachments (any mime) ride in the same JSON fields as images, so they share
// the ~2MB field ceiling. A base64 data URL is ~1.37× the raw bytes, so cap the
// raw file at ~1.5MB to keep the stored string under the limit. No downscaling
// is possible for arbitrary files, too big just gets rejected.
const MAX_ATTACHMENT_BYTES = 1_500_000;

function readAsDataURL(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(new Error('Could not read the image file.'));
    fr.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('That file does not look like a valid image.'));
    img.src = src;
  });
}

function approxBytes(dataUrl: string): number {
  // base64 payload length * 3/4, ignoring the small header.
  const comma = dataUrl.indexOf(',');
  const b64 = comma === -1 ? dataUrl : dataUrl.slice(comma + 1);
  return Math.floor((b64.length * 3) / 4);
}

/**
 * Turn an image File/Blob into a data URL suitable for embedding. Large images
 * are scaled down and re-encoded; throws ImageTooLargeError if it still can't
 * fit under the field limit.
 */
export async function processImageFile(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Only image files can be added here.');
  }

  const original = await readAsDataURL(file);

  // Small enough and already a sane format: keep as-is (preserves PNG transparency, GIFs, etc).
  if (approxBytes(original) <= 350_000) return original;

  // Otherwise rasterize + downscale to keep it under the limit.
  const img = await loadImage(original);
  const scale = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return original;
  ctx.drawImage(img, 0, 0, w, h);

  // Try descending JPEG quality until it fits.
  for (const q of [0.85, 0.7, 0.55, 0.4]) {
    const out = canvas.toDataURL('image/jpeg', q);
    if (approxBytes(out) <= MAX_BYTES) return out;
  }
  throw new ImageTooLargeError('This image is too large to embed. Try a smaller one (under ~2MB).');
}

// --- Generic attachments ----------------------------------------------------

/** Read any file into an AttachmentValue (base64 data URL + metadata). Rejects
 *  files over the field budget, there's nothing to downscale, unlike images. */
export async function processAttachmentFile(file: File): Promise<AttachmentValue> {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    const mb = (file.size / 1_000_000).toFixed(1);
    throw new FileTooLargeError(`"${file.name}" is ${mb} MB. Attachments must be under ~1.5 MB so they fit in the page.`);
  }
  const data = await readAsDataURL(file);
  return {
    name: file.name || 'file',
    mime: file.type || 'application/octet-stream',
    size: file.size,
    data,
  };
}

/** Why a file could not be uploaded, or null when it fits. The upload path used
 *  to fall through to the inline attachment reader on any failure, so an
 *  oversized video was reported as "attachments must be under ~1.5 MB", which
 *  named the wrong limit entirely. */
export function oversizeMessage(name: string, size: number, cap = MAX_UPLOAD_BYTES): string | null {
  if (size <= cap) return null;
  return `"${name}" is ${formatBytes(size)}. Files upload up to ${formatBytes(cap)}; trim or compress it first.`;
}

/** Fit a w x h image inside a longest-edge budget, keeping the aspect ratio and
 *  never scaling up. Pure so the sizing is testable without a canvas. */
export function targetDimensions(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge || longest === 0) return { width, height };
  const scale = maxEdge / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export interface CompressOptions {
  /** Longest edge in px. */
  maxEdge?: number;
  /** JPEG quality, 0 to 1. Lower passes are tried automatically if it misses the cap. */
  quality?: number;
  /** Byte budget the result has to fit. */
  cap?: number;
}

/** Re-encode an image to a smaller JPEG File. Used both to rescue a file that is
 *  over the upload cap and to let someone deliberately shrink one before sending
 *  it. Video has no equivalent here: transcoding one needs WebCodecs, which is a
 *  separate path. */
export async function compressImageToFile(file: File, opts: CompressOptions = {}): Promise<File> {
  const { maxEdge = MAX_DIMENSION, quality = 0.85, cap = MAX_UPLOAD_BYTES } = opts;
  const img = await loadImage(await readAsDataURL(file));
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new ImageTooLargeError('Could not compress that image.');

  // Shrink the edge budget until both the pixels and the encoded bytes fit.
  let edge = maxEdge;
  for (let attempt = 0; attempt < 6; attempt++) {
    const dim = targetDimensions(img.width, img.height, edge);
    canvas.width = dim.width;
    canvas.height = dim.height;
    ctx.drawImage(img, 0, 0, dim.width, dim.height);
    for (const q of [quality, quality * 0.8, quality * 0.65]) {
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', q));
      if (blob && blob.size <= cap) {
        const base = (file.name || 'image').replace(/\.[^.]+$/, '');
        return new File([blob], `${base}.jpg`, { type: 'image/jpeg', lastModified: file.lastModified });
      }
    }
    edge = Math.round(edge / 2);
  }
  throw new ImageTooLargeError(`"${file.name}" is too large to upload even after compressing.`);
}

/** Human file size for chips: 1.4 MB, 812 KB, 96 B. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)} KB`;
  return `${bytes} B`;
}
