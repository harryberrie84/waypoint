import * as Y from 'yjs';

const STORE = 'updates';
const COMPACT_AFTER = 200;

export type Seal = (bytes: Uint8Array) => Promise<string | null>;
export type Unseal = (value: string) => Promise<Uint8Array | null>;

function openDb(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function sealedDocName(pageId: string): string {
  return `wp-sealed-${pageId}`;
}

export class SealedDocStore {
  readonly whenSynced: Promise<void>;
  private db: IDBDatabase | null = null;
  private queue: Promise<void> = Promise.resolve();
  private written = 0;
  private closed = false;
  private readable: IDBValidKey[] = [];

  private readonly name: string;
  private readonly doc: Y.Doc;
  private readonly seal: Seal;
  private readonly unseal: Unseal;

  constructor(name: string, doc: Y.Doc, seal: Seal, unseal: Unseal) {
    this.name = name;
    this.doc = doc;
    this.seal = seal;
    this.unseal = unseal;
    this.whenSynced = this.load();
  }

  private async load(): Promise<void> {
    this.db = await openDb(this.name);
    const tx = this.db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const entries: { key: IDBValidKey; value: string }[] = await new Promise((resolve, reject) => {
      const out: { key: IDBValidKey; value: string }[] = [];
      const req = store.openCursor();
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return resolve(out);
        if (typeof cur.value === 'string') out.push({ key: cur.key, value: cur.value });
        cur.continue();
      };
      req.onerror = () => reject(req.error);
    });
    for (const e of entries) {
      const bytes = await this.unseal(e.value);
      if (!bytes) continue;
      try {
        Y.applyUpdate(this.doc, bytes, this);
        this.readable.push(e.key);
      } catch {
        continue;
      }
    }
    this.written = entries.length;
    this.doc.on('update', this.onUpdate);
  }

  private onUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this || this.closed) return;
    this.queue = this.queue.then(() => this.put(update)).catch(() => {});
  };

  private async put(update: Uint8Array): Promise<void> {
    const value = await this.seal(update);
    if (!value || !this.db) return;
    const tx = this.db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).add(value);
    await done(tx);
    this.readable.push(req.result);
    this.written++;
    if (this.written >= COMPACT_AFTER) await this.compactNow();
  }

  async compact(): Promise<boolean> {
    let ok = false;
    this.queue = this.queue.then(async () => {
      ok = await this.compactNow();
    });
    await this.queue;
    return ok;
  }

  private async compactNow(): Promise<boolean> {
    if (!this.db) return false;
    const value = await this.seal(Y.encodeStateAsUpdate(this.doc));
    if (!value) return false;
    const drop = this.readable.slice();
    const tx = this.db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const req = store.add(value);
    for (const k of drop) store.delete(k);
    await done(tx);
    this.readable = [req.result];
    this.written = 1;
    return true;
  }

  async flush(): Promise<void> {
    await this.queue;
  }

  destroy(): void {
    this.closed = true;
    this.doc.off('update', this.onUpdate);
    const db = this.db;
    void this.queue.finally(() => db?.close());
  }
}

export async function localDatabaseNames(): Promise<string[] | null> {
  try {
    const list = await (indexedDB as IDBFactory & { databases?: () => Promise<{ name?: string }[]> }).databases?.();
    return list ? list.map((d) => d.name ?? '').filter(Boolean) : null;
  } catch {
    return null;
  }
}

export function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}
