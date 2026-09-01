// Read a JPEG's EXIF DateTimeOriginal (the moment the photo was taken), so the
// Photos tab can file a picture under its real date instead of when you uploaded
// it. No dependency: a tolerant, fully bounds-checked scan that returns null on
// anything it does not understand (not a JPEG, no EXIF, a truncated file), and
// the caller falls back to the file's own modified time.

// Convert an EXIF datetime string ("YYYY:MM:DD HH:MM:SS") to an ISO local string.
// Pure and unit-tested; returns null on anything that isn't a sane date.
export function exifDateToIso(raw: string): string | null {
  const m = /^\s*(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(raw);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  if (+mo < 1 || +mo > 12 || +d < 1 || +d > 31 || +h > 23 || +mi > 59 || +s > 59) return null;
  return `${y}-${mo}-${d}T${h}:${mi}:${s}`;
}

export function readExifDateTimeOriginal(buf: ArrayBuffer): string | null {
  try {
    const v = new DataView(buf);
    if (v.byteLength < 12 || v.getUint16(0) !== 0xffd8) return null; // not a JPEG (SOI)
    let off = 2;
    while (off + 4 <= v.byteLength) {
      const marker = v.getUint16(off);
      if ((marker & 0xff00) !== 0xff00) return null; // not a marker, give up
      if (marker === 0xffda || marker === 0xffd9) return null; // start of scan / end: no more metadata
      const len = v.getUint16(off + 2);
      if (marker === 0xffe1) {
        const app1 = off + 4;
        // "Exif\0\0" then a TIFF block.
        if (app1 + 6 <= v.byteLength && v.getUint32(app1) === 0x45786966 && v.getUint16(app1 + 4) === 0) {
          return parseTiff(v, app1 + 6);
        }
      }
      off += 2 + len;
    }
    return null;
  } catch {
    return null;
  }
}

function parseTiff(v: DataView, base: number): string | null {
  if (base + 8 > v.byteLength) return null;
  const bo = v.getUint16(base);
  const le = bo === 0x4949; // 'II' little-endian; 'MM' (0x4d4d) big-endian
  if (!le && bo !== 0x4d4d) return null;
  if (v.getUint16(base + 2, le) !== 0x002a) return null;
  const ifd0 = base + v.getUint32(base + 4, le);
  const exifPtr = findLong(v, ifd0, 0x8769, le); // pointer to the Exif sub-IFD
  if (exifPtr == null) return null;
  const dt = findAscii(v, base, base + exifPtr, 0x9003, le); // DateTimeOriginal
  return dt ? exifDateToIso(dt) : null;
}

function findLong(v: DataView, ifd: number, tag: number, le: boolean): number | null {
  if (ifd + 2 > v.byteLength) return null;
  const n = v.getUint16(ifd, le);
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > v.byteLength) break;
    if (v.getUint16(e, le) === tag) return v.getUint32(e + 8, le);
  }
  return null;
}

function findAscii(v: DataView, base: number, ifd: number, tag: number, le: boolean): string | null {
  if (ifd + 2 > v.byteLength) return null;
  const n = v.getUint16(ifd, le);
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > v.byteLength) break;
    if (v.getUint16(e, le) !== tag) continue;
    const count = v.getUint32(e + 4, le);
    const at = count > 4 ? base + v.getUint32(e + 8, le) : e + 8; // inline if it fits in 4 bytes
    if (at < 0 || at + count > v.byteLength) return null;
    let s = '';
    for (let k = 0; k < count; k++) {
      const c = v.getUint8(at + k);
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    return s;
  }
  return null;
}
