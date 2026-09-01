// A tiny zip READER (the counterpart to lib/zip.ts's writer). Reads the central
// directory and inflates each entry with the browser-native DecompressionStream,
// so there's no dependency. Enough for Notion exports (stored + deflate entries).

export interface ZipEntry {
  name: string;
  bytes: Uint8Array;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  // Copy into a fresh ArrayBuffer-backed view so Response accepts it cleanly.
  const ds = new DecompressionStream('deflate-raw');
  const body = new Response(new Uint8Array(data)).body;
  if (!body) throw new Error('no body');
  const out = await new Response(body.pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(out);
}

/** Read every file entry from a zip. Folders are skipped. */
export async function readZip(buf: ArrayBuffer): Promise<ZipEntry[]> {
  const view = new DataView(buf);
  const u8 = new Uint8Array(buf);
  const decoder = new TextDecoder('utf-8');

  // Find the End Of Central Directory record (scan back from the end; the comment
  // is almost always empty so it's near the tail).
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a zip file');

  const count = view.getUint16(eocd + 10, true);
  let off = view.getUint32(eocd + 16, true);
  const entries: ZipEntry[] = [];

  for (let n = 0; n < count; n++) {
    if (off + 46 > buf.byteLength || view.getUint32(off, true) !== 0x02014b50) break;
    const method = view.getUint16(off + 10, true);
    const compSize = view.getUint32(off + 20, true);
    const nameLen = view.getUint16(off + 28, true);
    const extraLen = view.getUint16(off + 30, true);
    const commentLen = view.getUint16(off + 32, true);
    const localOff = view.getUint32(off + 42, true);
    const name = decoder.decode(u8.subarray(off + 46, off + 46 + nameLen));

    if (!name.endsWith('/')) {
      // Jump to the local header to find where the data actually starts (its own
      // name/extra lengths can differ from the central record's).
      const lNameLen = view.getUint16(localOff + 26, true);
      const lExtraLen = view.getUint16(localOff + 28, true);
      const dataStart = localOff + 30 + lNameLen + lExtraLen;
      const comp = u8.subarray(dataStart, dataStart + compSize);
      let bytes: Uint8Array;
      if (method === 0) bytes = comp.slice();
      else if (method === 8) bytes = await inflateRaw(comp);
      else throw new Error(`Unsupported zip compression ${method}`);
      entries.push({ name, bytes });
    }

    off += 46 + nameLen + extraLen + commentLen;
  }

  return entries;
}
