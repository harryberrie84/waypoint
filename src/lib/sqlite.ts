// A minimal, READ-ONLY SQLite reader: enough to pull whole tables out of a
// database file in the browser, and nothing else.
//
// It exists for one reason: an Anki `.apkg` is a zip whose payload is a SQLite
// database, and reading it is the difference between "imports Anki files" and
// "imports a text export of an Anki file". The alternative was sql.js, a ~1 MB
// wasm blob, which the no-new-dependency rule rightly refuses for something this
// narrow. This handles table b-trees, overflow pages and the record format, and
// deliberately does NOT handle indices, WAL, encryption or writing.
//
// Format reference: the file header is 100 bytes, pages are 1-indexed, and a
// table b-tree leaf holds (payload size, rowid, record). Everything here is pure
// and takes bytes in, so it is testable without a database file.

export type SqlValue = string | number | Uint8Array | null;

export interface SqliteTable {
  name: string;
  columns: string[];
  rows: SqlValue[][];
}

/** SQLite's big-endian varint: up to 9 bytes, 7 bits each, except the ninth
 *  which contributes all 8. Returns the value and how many bytes it used. */
export function readVarint(buf: Uint8Array, at: number): [number, number] {
  let value = 0;
  for (let i = 0; i < 8; i++) {
    const byte = buf[at + i];
    if (byte === undefined) return [value, i];
    value = value * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) return [value, i + 1];
  }
  const last = buf[at + 8] ?? 0;
  return [value * 256 + last, 9];
}

const be = (buf: Uint8Array, at: number, len: number): number => {
  let n = 0;
  for (let i = 0; i < len; i++) n = n * 256 + (buf[at + i] ?? 0);
  return n;
};

// Signed big-endian, for the integer serial types.
function beSigned(buf: Uint8Array, at: number, len: number): number {
  let n = be(buf, at, len);
  const limit = 2 ** (len * 8 - 1);
  if (n >= limit) n -= limit * 2;
  return n;
}

/** Bytes a serial type occupies. */
function serialWidth(type: number): number {
  if (type === 0 || type === 8 || type === 9) return 0;
  if (type >= 1 && type <= 4) return type;
  if (type === 5) return 6;
  if (type === 6 || type === 7) return 8;
  return Math.floor((type - 12) / 2);
}

/** Decode one record (a row's payload) into its values. */
export function decodeRecord(payload: Uint8Array, utf16 = false): SqlValue[] {
  const [headerSize, used] = readVarint(payload, 0);
  const types: number[] = [];
  let at = used;
  while (at < headerSize) {
    const [t, n] = readVarint(payload, at);
    if (n === 0) break;
    types.push(t);
    at += n;
  }
  const out: SqlValue[] = [];
  let body = headerSize;
  for (const type of types) {
    const width = serialWidth(type);
    if (type === 0) out.push(null);
    else if (type === 8) out.push(0);
    else if (type === 9) out.push(1);
    else if (type >= 1 && type <= 6) out.push(beSigned(payload, body, width));
    else if (type === 7) out.push(new DataView(payload.buffer, payload.byteOffset + body, 8).getFloat64(0));
    else if (type >= 12 && type % 2 === 0) out.push(payload.slice(body, body + width));
    else out.push(new TextDecoder(utf16 ? 'utf-16le' : 'utf-8').decode(payload.slice(body, body + width)));
    body += width;
  }
  return out;
}

/** Column names out of a CREATE TABLE statement. Good enough for the shapes this
 *  reader targets: it splits the top-level parenthesised list on commas and takes
 *  the first token of each, skipping table constraints. */
export function columnsFromSql(sql: string): string[] {
  const open = sql.indexOf('(');
  const close = sql.lastIndexOf(')');
  if (open < 0 || close < open) return [];
  const body = sql.slice(open + 1, close);
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of body) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  parts.push(cur);
  const skip = new Set(['primary', 'unique', 'check', 'foreign', 'constraint']);
  const out: string[] = [];
  for (const raw of parts) {
    const token = raw.trim().split(/\s+/)[0] ?? '';
    const name = token.replace(/^[`"[]|[`"\]]$/g, '');
    if (!name || skip.has(name.toLowerCase())) continue;
    out.push(name);
  }
  return out;
}

interface Db {
  bytes: Uint8Array;
  pageSize: number;
  usable: number;
  utf16: boolean;
}

const pageAt = (db: Db, page: number): number => (page - 1) * db.pageSize;

/** Follow a payload that spilled onto overflow pages and return the whole thing. */
function fullPayload(db: Db, start: number, inPage: number, total: number): Uint8Array {
  if (inPage >= total) return db.bytes.slice(start, start + total);
  const out = new Uint8Array(total);
  out.set(db.bytes.slice(start, start + inPage), 0);
  let filled = inPage;
  let next = be(db.bytes, start + inPage, 4);
  while (next > 0 && filled < total) {
    const base = pageAt(db, next);
    if (base < 0 || base >= db.bytes.length) break;
    const take = Math.min(db.usable - 4, total - filled);
    out.set(db.bytes.slice(base + 4, base + 4 + take), filled);
    filled += take;
    next = be(db.bytes, base, 4);
  }
  return out;
}

/** How much of a table-leaf payload lives on the page itself. */
function localSize(db: Db, total: number): number {
  const x = db.usable - 35;
  if (total <= x) return total;
  const m = Math.floor(((db.usable - 12) * 32) / 255) - 23;
  const k = m + ((total - m) % (db.usable - 4));
  return k <= x ? k : m;
}

/** Walk a table b-tree from `page`, collecting every leaf record. Cycle-guarded
 *  by a visited set: a corrupt file must not loop forever in a browser tab. */
function walk(db: Db, page: number, seen: Set<number>, out: Uint8Array[]) {
  if (page < 1 || seen.has(page) || out.length > 200000) return;
  seen.add(page);
  const base = pageAt(db, page);
  if (base < 0 || base + 8 > db.bytes.length) return;
  const head = page === 1 ? base + 100 : base;
  const type = db.bytes[head];
  const cells = be(db.bytes, head + 3, 2);
  const headerLen = type === 2 || type === 5 ? 12 : 8;
  const pointers = head + headerLen;

  if (type === 5) {
    for (let i = 0; i < cells; i++) {
      const at = base + be(db.bytes, pointers + i * 2, 2);
      walk(db, be(db.bytes, at, 4), seen, out);
    }
    walk(db, be(db.bytes, head + 8, 4), seen, out); // right-most child
    return;
  }
  if (type !== 13) return; // not a table b-tree page

  for (let i = 0; i < cells; i++) {
    const at = base + be(db.bytes, pointers + i * 2, 2);
    const [total, n1] = readVarint(db.bytes, at);
    const [, n2] = readVarint(db.bytes, at + n1); // rowid, unused
    const start = at + n1 + n2;
    out.push(fullPayload(db, start, localSize(db, total), total));
  }
}

function openDb(bytes: Uint8Array): Db | null {
  if (bytes.length < 100) return null;
  if (new TextDecoder().decode(bytes.slice(0, 15)) !== 'SQLite format 3') return null;
  const raw = be(bytes, 16, 2);
  const pageSize = raw === 1 ? 65536 : raw;
  if (pageSize < 512) return null;
  const usable = pageSize - (bytes[20] ?? 0);
  return { bytes, pageSize, usable, utf16: be(bytes, 56, 4) !== 1 };
}

/** Every table in the file, by name, with its declared columns. */
export function listTables(bytes: Uint8Array): { name: string; rootPage: number; sql: string }[] {
  const db = openDb(bytes);
  if (!db) return [];
  const records: Uint8Array[] = [];
  walk(db, 1, new Set(), records);
  const out: { name: string; rootPage: number; sql: string }[] = [];
  for (const rec of records) {
    // sqlite_master: type, name, tbl_name, rootpage, sql
    const v = decodeRecord(rec, db.utf16);
    if (v[0] !== 'table' || typeof v[1] !== 'string' || typeof v[3] !== 'number') continue;
    out.push({ name: v[1], rootPage: v[3], sql: typeof v[4] === 'string' ? v[4] : '' });
  }
  return out;
}

/** Read one table whole. Null when the file is not SQLite or has no such table. */
export function readTable(bytes: Uint8Array, table: string): SqliteTable | null {
  const db = openDb(bytes);
  if (!db) return null;
  const entry = listTables(bytes).find((t) => t.name.toLowerCase() === table.toLowerCase());
  if (!entry) return null;
  const records: Uint8Array[] = [];
  walk(db, entry.rootPage, new Set(), records);
  return {
    name: entry.name,
    columns: columnsFromSql(entry.sql),
    rows: records.map((r) => decodeRecord(r, db.utf16)),
  };
}
