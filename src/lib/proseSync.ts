// Guards optimistic text fields against their own (or any stale) realtime echo.
//
// Every optimistic write (page title/body, table name, column names, cell text)
// updates the store immediately and saves on a debounce, so a realtime echo always
// trails the live value by up to one debounce window. Applying that echo while the
// user is still typing rewinds the field to a pre-keystroke value: the text they
// just wrote vanishes (this is the "the sync erased what I wrote" bug, and it hit
// titles, cells and column names, not just the page body). So each field is marked
// "pending" from the first keystroke until its own save settles; while pending, the
// echo reconcile keeps the LOCAL value for that field and takes only the rest of the
// record from the server. A fresh keystroke bumps a per-field seq so a save that
// lands mid-typing can't clear the flag out from under newer edits, only the settle
// whose seq is still current does.

const pending = new Map<string, Map<string, number>>(); // recordId -> field -> seq

// When each field was last written locally (this machine's clock, compared only
// against another reading of the same clock, so no cross-machine skew is involved).
//
// `pending` alone covers the window while a save is in flight, which is enough for a
// realtime echo: the echo IS the save, so it lands inside or just after the window.
// It is not enough for `hydrate()`, whose list fetches take SECONDS on a big
// workspace: a hydrate that set off before an import started lands after every one of
// the import's writes has settled and the guard has closed, so it reverts the lot to a
// snapshot taken before the import existed. That is how a board import put every card
// under "No Stage" (the merged select options were rolled back while the rows kept the
// new option ids) and how "New board" appeared to do nothing (`pages.kanban` snapped
// back to the table it replaced). So also remember WHEN, and let a reconcile keep any
// field written after that reconcile's own read began.
const lastWrite = new Map<string, Map<string, number>>(); // recordId -> field -> Date.now()

// Bounded: a long session touches a lot of records, and this map would otherwise
// only grow. Anything older than the longest plausible fetch is useless to
// keepFieldsWrittenSince, so drop it once the map gets big.
const STAMP_TTL_MS = 120_000;
const STAMP_MAX_RECORDS = 500;

function stamp(id: string, field: string): void {
  let m = lastWrite.get(id);
  if (!m) {
    m = new Map();
    lastWrite.set(id, m);
  }
  m.set(field, Date.now());
  if (lastWrite.size <= STAMP_MAX_RECORDS) return;
  const cutoff = Date.now() - STAMP_TTL_MS;
  for (const [rid, fields] of lastWrite) {
    let newest = 0;
    for (const t of fields.values()) if (t > newest) newest = t;
    if (newest < cutoff) lastWrite.delete(rid);
  }
}

// Call when a write to `field` of `id` is queued; returns a seq the caller hands
// back to endWrite once that exact write settles.
export function beginWrite(id: string, field: string): number {
  let m = pending.get(id);
  if (!m) {
    m = new Map();
    pending.set(id, m);
  }
  const seq = (m.get(field) ?? 0) + 1;
  m.set(field, seq);
  stamp(id, field);
  return seq;
}

// Release the guard only if no newer keystroke queued a write in the meantime.
export function endWrite(id: string, field: string, seq: number): void {
  stamp(id, field); // the value is only on the server as of NOW, not as of beginWrite
  const m = pending.get(id);
  if (!m) return;
  if (m.get(field) === seq) {
    m.delete(field);
    if (m.size === 0) pending.delete(id);
  }
}

export function isWriting(id: string, field: string): boolean {
  return pending.get(id)?.has(field) ?? false;
}

export function resetWrites(): void {
  pending.clear();
  lastWrite.clear();
}

/** True if `field` of `id` was written locally at or after `since` (or is still in
 *  flight). `since` must come from the same Date.now() clock. */
export function writtenSince(id: string, field: string, since: number): boolean {
  if (isWriting(id, field)) return true;
  const at = lastWrite.get(id)?.get(field);
  return at !== undefined && at >= since;
}

// For a realtime echo: keep the local value of any listed field that currently has
// a pending local write, so a stale echo can't revert what the user is still typing.
// Mutates and returns `incoming` (a fresh object from toPage/toRow/toTable, never
// aliased into the store), so overwriting a field on it is safe.
export function keepPendingFields<T extends { id: string }>(
  local: T | undefined,
  incoming: T,
  fields: readonly (keyof T & string)[],
): T {
  if (!local) return incoming;
  const m = pending.get(incoming.id);
  if (!m) return incoming;
  for (const f of fields) {
    if (m.has(f)) incoming[f] = local[f];
  }
  return incoming;
}

// For `hydrate()`, which re-reads the whole workspace and REPLACES the store with it.
// Same idea as keepPendingFields, but the test is "written locally since this read
// began" rather than "still in flight", because the read outlives the flight. `since`
// is a Date.now() taken before the fetches went out.
export function keepFieldsWrittenSince<T extends { id: string }>(
  local: T | undefined,
  incoming: T,
  fields: readonly (keyof T & string)[],
  since: number,
): T {
  if (!local) return incoming;
  for (const f of fields) {
    if (writtenSince(incoming.id, f, since)) incoming[f] = local[f];
  }
  return incoming;
}

// An incoming record whose `updated` stamp is OLDER than the copy we already hold
// is an echo that arrived out of order. PocketBase sends one per update and a slow
// one can land after a newer save has already been applied here, which rewinds
// EVERY field on the record at once. That is how an uploaded file showed for a
// moment and then went: the store held two files, then a second later held the
// pre-upload list of one again. keepPendingFields cannot see this, because it only
// covers the window while a write is in flight, and the stale echo usually arrives
// just after that window closes.
//
// Equal stamps mean we cannot tell which is newer, so the incoming record wins, as
// it did before. Dropping a stale echo loses nothing: a strictly newer copy of the
// same record is already in the store.
export function isStaleRecord(local: { updated?: string } | undefined, incoming: { updated?: string }): boolean {
  if (!local?.updated || !incoming.updated) return false;
  return incoming.updated < local.updated;
}

// --- Back-compat shims for the page/row BODY guard (the field 'content'). --------
// The body predates the generalized guard; these keep its call sites unchanged.
export function beginProseWrite(id: string): number {
  return beginWrite(id, 'content');
}

export function endProseWrite(id: string, seq: number): void {
  endWrite(id, 'content', seq);
}

export function isProseWriting(id: string): boolean {
  return isWriting(id, 'content');
}

export function resetProseWrites(): void {
  resetWrites();
}

// Merge a realtime echo with the local doc, keeping the locally typed body while
// it's mid-write. Retained as the body-specific entry point; new fields use
// keepPendingFields directly.
export function reconcileProseEcho<T extends { id: string; content?: unknown }>(
  local: T | undefined,
  incoming: T,
): T {
  return keepPendingFields(local, incoming, ['content'] as (keyof T & string)[]);
}
