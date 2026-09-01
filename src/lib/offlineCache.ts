// Offline read cache. After every successful load we stash the raw pages/tables/
// rows to IndexedDB; when a later load can't reach the server (offline, a blocked
// network, the GFW) `hydrate()` falls back to this snapshot instead of showing a
// blank "couldn't reach the workspace" screen.
//
// SAFETY: we cache exactly what the API returned, BEFORE the store decrypts it.
// So for an encrypted workspace the cache holds ciphertext (enc:v1 envelopes,
// cellsEnc blobs), same as the server, and the vault decrypts it in memory on
// load just like a live fetch. No decrypted content is ever written at rest here.
// Every call is best-effort and swallows its own errors: the cache must never be
// able to break a normal online load.

import { idbGet, idbSet } from './idb';
import type { Page, TableData, TableRow } from '../types';

export interface CachedDataset {
  pages: Page[];
  tables: TableData[];
  rows: TableRow[];
}

const KEY = 'dataset';

export async function saveDataset(d: CachedDataset): Promise<void> {
  try {
    await idbSet(KEY, d);
  } catch {
    // A full disk / private-mode quota / no IndexedDB: the cache is a bonus, not
    // load-bearing, so a failure here is silently fine.
  }
}

export async function loadDataset(): Promise<CachedDataset | null> {
  try {
    return (await idbGet<CachedDataset>(KEY)) ?? null;
  } catch {
    return null;
  }
}
