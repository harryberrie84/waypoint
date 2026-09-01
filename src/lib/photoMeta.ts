// Per-page photo metadata for the Photos tab: a date and an album (Osaka, Tokyo,
// ...) per image. Kept off the editor content and the store write-guards on
// purpose (so this can never touch the edit path): a small map of image-url ->
// info, mirrored to localStorage, keyed by page. Per device for now; a synced
// `pages.photoMeta` field is a later, additive step.

import { readExifDateTimeOriginal } from './exif';

export interface PhotoInfo {
  date?: string; // ISO; a manual edit or the capture/upload date
  album?: string;
}
export type PhotoMeta = Record<string, PhotoInfo>; // image url -> info

const keyFor = (pageId: string) => `waypoint:photometa:${pageId}`;
const legacyKey = (pageId: string) => `waypoint:photodates:${pageId}`; // date-only v1

export function loadPhotoMeta(pageId: string): PhotoMeta {
  const out: PhotoMeta = {};
  try {
    const raw = JSON.parse(localStorage.getItem(keyFor(pageId)) || '{}') as Record<string, unknown>;
    for (const [url, v] of Object.entries(raw)) {
      if (typeof v === 'string') out[url] = { date: v };
      else if (v && typeof v === 'object') {
        const o = v as { date?: unknown; album?: unknown };
        out[url] = {
          date: typeof o.date === 'string' ? o.date : undefined,
          album: typeof o.album === 'string' ? o.album : undefined,
        };
      }
    }
    // Fold in the old date-only map so early uploads keep their dates.
    const legacy = JSON.parse(localStorage.getItem(legacyKey(pageId)) || '{}') as Record<string, unknown>;
    for (const [url, v] of Object.entries(legacy)) {
      if (typeof v === 'string' && !out[url]) out[url] = { date: v };
    }
  } catch {
    return {};
  }
  return out;
}

export function setPhotoInfo(pageId: string, url: string, patch: Partial<PhotoInfo>): PhotoMeta {
  const meta = loadPhotoMeta(pageId);
  const next: PhotoInfo = { ...meta[url], ...patch };
  if (!next.date && !next.album) delete meta[url];
  else meta[url] = next;
  try {
    localStorage.setItem(keyFor(pageId), JSON.stringify(meta));
  } catch {
    // Private mode / quota: it just won't persist, which is fine.
  }
  return meta;
}

// The distinct album names in use, sorted. Pure, so it is unit-tested.
export function albumsIn(meta: PhotoMeta): string[] {
  const s = new Set<string>();
  for (const v of Object.values(meta)) if (v.album) s.add(v.album);
  return [...s].sort((a, b) => a.localeCompare(b));
}

// The date to file a freshly added photo under: its EXIF capture time if the file
// carries one, else the file's own modified time, else now. Only the file's head
// holds EXIF, so we read the first 128 KB, not the whole image (reading a big
// photo whole blocked the UI on the first upload).
export async function photoDateFromFile(file: File): Promise<string> {
  if (/jpe?g/i.test(file.type)) {
    try {
      const head = file.slice(0, 128 * 1024);
      const iso = readExifDateTimeOriginal(await head.arrayBuffer());
      if (iso) return iso;
    } catch {
      // fall through to the file timestamp
    }
  }
  return new Date(file.lastModified || Date.now()).toISOString();
}
