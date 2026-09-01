// Anki interchange. Two formats, and they are not equally solid, so the tab says
// which is which rather than letting you find out with a deck you care about.
//
// 1. NOTES IN PLAIN TEXT (.txt/.tsv), both directions. This is a first-class Anki
//    format: File > Export > "Notes in Plain Text" writes it, File > Import reads
//    it back. It carries the `#separator:`, `#html:`, `#deck:`, `#tags column:`
//    header lines Anki writes. Round-trips, and it is the path to trust.
//
// 2. .apkg IMPORT, read only. An .apkg is a zip whose payload is a SQLite
//    database, so this unzips it and reads the `notes` table through the minimal
//    reader in lib/sqlite.ts. It works on decks exported with "Support older Anki
//    versions" ticked. Without that box, Anki 2.1.50+ writes `collection.anki21b`
//    compressed with zstd, which no browser can inflate natively and which this
//    deliberately does not ship a decoder for; that case reports itself instead of
//    failing quietly.
//
// Scheduling state is NOT imported. Anki's card table carries its own queue,
// interval and ease in units tied to that collection's config, and importing them
// half-understood would silently corrupt a review schedule. Cards arrive new, so
// the first session re-learns them, which is honest and recoverable.

import { readZip } from './unzip';
import { readTable } from './sqlite';
import type { Card } from './srs';

const FIELD_SEP = ''; // Anki packs a note's fields with this unit separator

export interface AnkiImport {
  cards: Omit<Card, 'id'>[];
  /** The deck this came from, so several imports stay separate instead of
   *  landing in one pile. From `#deck:` in a text export, or the file name. */
  deck?: string;
  /** Told to the user, not swallowed: how many notes had nothing usable. */
  skipped: number;
  /** Set when the file was understood but nothing could be read out of it. */
  problem?: string;
}

/** Anki writes HTML in its fields. Cards here are plain text, so unwrap the
 *  common tags rather than showing the markup. Deliberately not a parser: a
 *  field is a phrase, not a document. */
export function stripHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// --- plain text -------------------------------------------------------------

/** Parse Anki's "Notes in Plain Text". Honours the `#separator:` header when
 *  present and otherwise guesses tab, then semicolon, then comma, by which one
 *  splits the first body line into the most columns. */
export function parseAnkiText(text: string): AnkiImport {
  const lines = text.split(/\r?\n/);
  let sep = '';
  let html = false;
  let tagsCol = -1;
  let deckName = '';
  const body: string[] = [];
  // Headers only count at the TOP of the file. Anki's own reader works this way,
  // and without it a perfectly good card whose front begins with "#" (a hashtag,
  // a sharp, a chord name) is silently eaten as a directive.
  let inHeader = true;
  for (const line of lines) {
    if (inHeader && line.startsWith('#')) {
      const [key, ...rest] = line.slice(1).split(':');
      const value = rest.join(':').trim();
      const k = key.trim().toLowerCase();
      if (k === 'separator') sep = value.toLowerCase() === 'tab' ? '\t' : value.toLowerCase() === 'comma' ? ',' : value.toLowerCase() === 'semicolon' ? ';' : value;
      if (k === 'html') html = value.toLowerCase() === 'true';
      if (k === 'deck') deckName = value;
      if (k === 'tags column') tagsCol = Number(value) - 1;
      continue;
    }
    if (line.trim() !== '') {
      inHeader = false;
      body.push(line);
    }
  }
  if (!body.length) return { cards: [], skipped: 0, problem: 'That file has no notes in it.' };
  if (!sep) {
    const counts = ['\t', ';', ','].map((s) => ({ s, n: body[0].split(s).length }));
    counts.sort((a, b) => b.n - a.n);
    sep = counts[0].n > 1 ? counts[0].s : '\t';
  }

  const cards: Omit<Card, 'id'>[] = [];
  let skipped = 0;
  for (const line of body) {
    const parts = line.split(sep);
    const front = (parts[0] ?? '').trim();
    const back = (parts[1] ?? '').trim();
    if (!front || !back) {
      skipped++;
      continue;
    }
    const tags = tagsCol >= 0 && parts[tagsCol] ? parts[tagsCol].split(/\s+/).filter(Boolean) : undefined;
    cards.push({
      front: html ? stripHtml(front) : front,
      back: html ? stripHtml(back) : back,
      ...(tags && tags.length ? { tags } : {}),
    });
  }
  return { cards, skipped, deck: deckName || undefined };
}

/** Write the same format back, so a deck built here imports straight into Anki.
 *  Separators inside a field would break the columns, so they are replaced with a
 *  space rather than quoted: Anki's reader does not quote either. */
export function serializeAnkiText(cards: Card[], deck = 'Waypoint'): string {
  const clean = (s: string) => (s ?? '').replace(/[\t\r\n]+/g, ' ').trim();
  const rows = cards.map((c) => [clean(c.front), clean(c.back), (c.tags ?? []).join(' ')].join('\t'));
  return ['#separator:tab', '#html:false', `#deck:${clean(deck)}`, '#tags column:3', ...rows].join('\n');
}

export const ANKI_TEMPLATE = [
  '#separator:tab',
  '#html:false',
  '#deck:Japan phrases',
  '#tags column:3',
  'おはよう\tgood morning\tgreetings',
  'ありがとう\tthank you\tgreetings polite',
  'いくらですか\thow much is it?\tshopping',
].join('\n');

// --- .apkg ------------------------------------------------------------------

/** Inflate zstd IF this browser can. Feature-detected rather than assumed: the
 *  codec list for DecompressionStream is growing, and a five-line try beats
 *  shipping a several-thousand-line decompressor or telling people "never". */
async function inflateZstd(bytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    const ds = new DecompressionStream('zstd' as CompressionFormat);
    const body = new Response(new Uint8Array(bytes)).body;
    if (!body) return null;
    return new Uint8Array(await new Response(body.pipeThrough(ds)).arrayBuffer());
  } catch {
    return null; // this engine has no zstd, which is the common case today
  }
}

/** Pull notes out of an Anki .apkg. See the header for what it does not do. */
export async function parseApkg(buf: ArrayBuffer, nameHint?: string): Promise<AnkiImport> {
  let entries;
  try {
    entries = await readZip(buf);
  } catch {
    return { cards: [], skipped: 0, problem: 'That file is not a readable .apkg (it should be a zip).' };
  }
  const byName = new Map(entries.map((e) => [e.name.toLowerCase(), e]));
  const modern = byName.get('collection.anki21b');
  let db = byName.get('collection.anki21') ?? byName.get('collection.anki2');
  // Anki 2.1.50+ writes the collection zstd-compressed unless you tick "Support
  // older Anki versions". No browser inflates zstd through DecompressionStream
  // today, but the spec allows it and engines are adding codecs, so ASK rather
  // than assume: if this browser has it, the newer format just works, and if it
  // does not we fall through to a message that tells you which box to tick.
  if (!db && modern) {
    const raw = await inflateZstd(modern.bytes);
    if (raw) db = { name: modern.name, bytes: raw };
  }
  if (!db) {
    return {
      cards: [],
      skipped: 0,
      problem: modern
        ? 'This deck was exported in the newer compressed format. In Anki, export it again with "Support older Anki versions" ticked.'
        : 'No Anki collection was found inside that file.',
    };
  }

  const notes = readTable(db.bytes, 'notes');
  if (!notes) return { cards: [], skipped: 0, problem: 'The collection inside that file could not be read.' };

  const fldAt = notes.columns.indexOf('flds');
  const tagsAt = notes.columns.indexOf('tags');
  const cards: Omit<Card, 'id'>[] = [];
  let skipped = 0;
  for (const row of notes.rows) {
    const flds = fldAt >= 0 ? row[fldAt] : row[6]; // 7th column in every Anki schema
    if (typeof flds !== 'string') {
      skipped++;
      continue;
    }
    const fields = flds.split(FIELD_SEP).map(stripHtml);
    const front = fields[0] ?? '';
    // A note type with more than two fields keeps the rest on the back rather
    // than dropping them, which is better than losing a reading or an example.
    const back = fields.slice(1).filter(Boolean).join('\n');
    if (!front || !back) {
      skipped++;
      continue;
    }
    const rawTags = tagsAt >= 0 ? row[tagsAt] : null;
    const tags = typeof rawTags === 'string' ? rawTags.split(/\s+/).filter(Boolean) : [];
    cards.push({ front, back, ...(tags.length ? { tags } : {}) });
  }
  if (!cards.length && !skipped) return { cards: [], skipped: 0, problem: 'That collection has no notes in it.' };
  // Anki's own deck names live in the `col` table's decks JSON, keyed by the
  // `did` on each card. Reading that is a second table walk for a label, so the
  // file name is used instead: it is what the person chose, and it is right.
  return { cards, skipped, deck: nameHint };
}
