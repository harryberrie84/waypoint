import { create } from 'zustand';
import { userKeysApi, type UserKeyRecord } from '../lib/api';
import {
  generateMasterKey,
  importMasterKey,
  wrapMasterKey,
  unwrapMasterKey,
  encryptContent,
  decryptContent,
  generateRecoveryCode,
  normalizeRecoveryCode,
  generateKeyPair,
  exportPublicKey,
  wrapPrivateKey,
  unwrapPrivateKey,
  nonExtractableMaster,
  sameMasterKey,
  DEFAULT_ITERATIONS,
} from '../lib/crypto';

// ---------------------------------------------------------------------------
// Vault, the in-memory home of the user's encryption master key.
// ---------------------------------------------------------------------------
// The master key lives here as a CryptoKey while unlocked; it is never written
// to the server. The wrapped (encrypted) copies live in `user_keys`.
//
// On-device cache: the unlocked key is mirrored to localStorage so a page reload
// doesn't demand the password again. This is a deliberate trade-off, the threat
// model is "the server operator can't read the database", NOT "someone holding
// the unlocked phone". Anyone with the device (and the browser open) can read the
// content; the operator still cannot. Locking (or signing out) wipes the cache.

const cacheKey = (userId: string) => `waypoint:vault:${userId}`;

// On-device key cache. The unlocked master key is kept
// across reloads as a NON-extractable CryptoKey in IndexedDB instead of raw bytes in
// localStorage: a script on the page can use it while the tab is open but can no
// longer export and steal it. A pre-existing localStorage raw key is migrated to
// IndexedDB on load and then deleted. The KEY ITSELF is unchanged, this is only
// where/how it is cached, so existing encrypted content is unaffected.
const IDB_NAME = 'waypoint-vault';
const IDB_STORE = 'keys';

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbPut(key: string, value: CryptoKey): Promise<void> {
  const db = await openIdb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
async function idbGet(key: string): Promise<CryptoKey | null> {
  const db = await openIdb();
  try {
    return await new Promise<CryptoKey | null>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const rq = tx.objectStore(IDB_STORE).get(key);
      rq.onsuccess = () => resolve((rq.result as CryptoKey | undefined) ?? null);
      rq.onerror = () => reject(rq.error);
    });
  } finally {
    db.close();
  }
}
async function idbDel(key: string): Promise<void> {
  const db = await openIdb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

type Status = 'absent' | 'locked' | 'unlocked';

/** Which door we open to get an extractable master before re-wrapping it. The
 *  cached session key is deliberately NON-extractable, so a re-wrap cannot be
 *  built from it and must start from a secret the user just proved. */
export type RewrapSecret = { password: string } | { recoveryCode: string };
export type RewrapResult = 'ok' | 'wrong-secret' | 'too-short' | 'failed';

/** Below this the password is not accepted, matching the users collection. */
const MIN_PASSWORD = 8;

interface VaultState {
  status: Status;
  // False until the first load()/unlock settles, so the UI can show "decrypting…"
  // instead of flashing a "locked" panel before the cached key is restored.
  ready: boolean;
  master: CryptoKey | null;
  // ECDH identity for shared-workspace key wrapping (derived from the master on
  // unlock). The private key stays in memory; the public key is shareable.
  privateKey: CryptoKey | null;
  publicKey: string | null;
  record: UserKeyRecord | null;
  userId: string | null;
  recoveryCode: string | null; // shown once, right after setup
  panelOpen: boolean;

  load: (userId: string) => Promise<void>;
  setup: (userId: string, password: string) => Promise<string | null>;
  unlock: (password: string) => Promise<boolean>;
  unlockWithRecovery: (code: string) => Promise<boolean>;
  // Re-wrap the EXISTING master key under a new password.
  // Changing the account password leaves `wrappedKey` wrapped under the old one,
  // so the old password still opens the vault and the new one does not. This
  // rewrites only the password door; the recovery door is never touched.
  rewrapToPassword: (current: RewrapSecret, newPassword: string) => Promise<RewrapResult>;
  tryUnlock: (userId: string, password: string) => Promise<void>;
  lock: () => void;
  clearRecoveryCode: () => void;
  openPanel: () => void;
  closePanel: () => void;
  encrypt: (value: unknown) => Promise<string | null>;
  decrypt: (envelope: string) => Promise<unknown>;
}

// Persist the master for reloads as a non-extractable IndexedDB key, and return
// that key so the session holds the non-extractable copy too. Falls back to the
// given key (in-memory only this session) if IndexedDB is unavailable.
async function cache(userId: string, master: CryptoKey): Promise<CryptoKey> {
  try {
    const ne = await nonExtractableMaster(master);
    await idbPut(cacheKey(userId), ne);
    try {
      localStorage.removeItem(cacheKey(userId)); // drop any legacy raw key
    } catch {
      /* ignore */
    }
    return ne;
  } catch {
    return master;
  }
}

// Recover the ECDH identity from the row, or mint one for a pre-keypair (phase-1)
// row and persist it. Never throws, a failure just leaves shared encryption
// unavailable, not the whole vault.
async function restoreIdentity(record: UserKeyRecord, master: CryptoKey): Promise<{ privateKey: CryptoKey | null; publicKey: string }> {
  if (record.wrappedPrivateKey && record.publicKey) {
    try {
      return { privateKey: await unwrapPrivateKey(record.wrappedPrivateKey, master), publicKey: record.publicKey };
    } catch {
      return { privateKey: null, publicKey: record.publicKey };
    }
  }
  try {
    const pair = await generateKeyPair();
    const publicKey = await exportPublicKey(pair.publicKey);
    const wrappedPrivateKey = await wrapPrivateKey(pair.privateKey, master);
    await userKeysApi.update(record.id, { publicKey, wrappedPrivateKey });
    return { privateKey: pair.privateKey, publicKey };
  } catch (err) {
    console.error('[vault] identity upgrade failed', err);
    return { privateKey: null, publicKey: '' };
  }
}

export const useVault = create<VaultState>((set, get) => ({
  status: 'absent',
  ready: false,
  master: null,
  privateKey: null,
  publicKey: null,
  record: null,
  userId: null,
  recoveryCode: null,
  panelOpen: false,

  load: async (userId) => {
    const record = await userKeysApi.getMine(userId);
    if (!record) {
      set({ status: 'absent', ready: true, record: null, userId, master: null, privateKey: null, publicKey: null });
      return;
    }
    // Restore from the on-device cache (IndexedDB) so a refresh stays unlocked.
    // Migrate a legacy localStorage raw key into IndexedDB on first sight, then drop it.
    let master: CryptoKey | null = null;
    try {
      master = await idbGet(cacheKey(userId));
      if (!master) {
        let legacy: string | null = null;
        try {
          legacy = localStorage.getItem(cacheKey(userId));
        } catch {
          legacy = null;
        }
        if (legacy) master = await cache(userId, await importMasterKey(legacy));
      }
    } catch {
      master = null;
    }
    if (master) {
      const id = await restoreIdentity(record, master);
      set({ record, userId, master, status: 'unlocked', ready: true, privateKey: id.privateKey, publicKey: id.publicKey });
    } else {
      set({ record, userId, master: null, status: 'locked', ready: true, privateKey: null, publicKey: null });
    }
  },

  setup: async (userId, password) => {
    try {
      const master = await generateMasterKey();
      const code = generateRecoveryCode();
      const byPw = await wrapMasterKey(master, password, DEFAULT_ITERATIONS);
      const byRec = await wrapMasterKey(master, normalizeRecoveryCode(code), DEFAULT_ITERATIONS);
      const pair = await generateKeyPair();
      const publicKey = await exportPublicKey(pair.publicKey);
      const wrappedPrivateKey = await wrapPrivateKey(pair.privateKey, master);
      const record = await userKeysApi.create({
        user: userId,
        wrappedKey: byPw.wrapped,
        pwSalt: byPw.salt,
        recoveryKey: byRec.wrapped,
        recoverySalt: byRec.salt,
        iterations: byPw.iterations,
        publicKey,
        wrappedPrivateKey,
      });
      const cached = await cache(userId, master);
      set({ master: cached, record, userId, status: 'unlocked', ready: true, recoveryCode: code, privateKey: pair.privateKey, publicKey });
      return code;
    } catch (err) {
      console.error('[vault] setup failed', err);
      return null;
    }
  },

  unlock: async (password) => {
    const { record, userId } = get();
    const rec = record ?? (userId ? await userKeysApi.getMine(userId) : null);
    if (!rec || !userId) return false;
    try {
      const master = await unwrapMasterKey(
        { wrapped: rec.wrappedKey, salt: rec.pwSalt, iterations: rec.iterations },
        password,
      );
      const cached = await cache(userId, master);
      const id = await restoreIdentity(rec, cached);
      set({ master: cached, record: rec, status: 'unlocked', ready: true, privateKey: id.privateKey, publicKey: id.publicKey });
      return true;
    } catch {
      return false;
    }
  },

  unlockWithRecovery: async (code) => {
    const { record, userId } = get();
    const rec = record ?? (userId ? await userKeysApi.getMine(userId) : null);
    if (!rec || !userId) return false;
    try {
      const master = await unwrapMasterKey(
        { wrapped: rec.recoveryKey, salt: rec.recoverySalt, iterations: rec.iterations },
        normalizeRecoveryCode(code),
      );
      const cached = await cache(userId, master);
      const id = await restoreIdentity(rec, cached);
      set({ master: cached, record: rec, status: 'unlocked', ready: true, privateKey: id.privateKey, publicKey: id.publicKey });
      return true;
    } catch {
      return false;
    }
  },

  rewrapToPassword: async (current, newPassword) => {
    const { record, userId } = get();
    const rec = record ?? (userId ? await userKeysApi.getMine(userId) : null);
    if (!rec || !userId) return 'failed';
    if (newPassword.length < MIN_PASSWORD) return 'too-short';
    try {
      // Open an existing door to get the REAL master. Never generate one here: a
      // fresh key would leave every enc:v1: value in the database permanently
      // unreadable, which is the only way this operation can destroy anything.
      const door =
        'password' in current
          ? { wrapped: rec.wrappedKey, salt: rec.pwSalt, secret: current.password }
          : { wrapped: rec.recoveryKey, salt: rec.recoverySalt, secret: normalizeRecoveryCode(current.recoveryCode) };
      let master: CryptoKey;
      try {
        master = await unwrapMasterKey({ wrapped: door.wrapped, salt: door.salt, iterations: rec.iterations }, door.secret);
      } catch {
        return 'wrong-secret'; // nothing written, both doors untouched
      }

      const next = await wrapMasterKey(master, newPassword, DEFAULT_ITERATIONS);
      // Prove the new blob opens with the new password AND yields the same key,
      // BEFORE overwriting the old one. A wrap that cannot be unwrapped would
      // shut the password door; a wrap around the wrong key would be far worse.
      const check = await unwrapMasterKey({ wrapped: next.wrapped, salt: next.salt, iterations: next.iterations }, newPassword);
      if (!(await sameMasterKey(check, master))) {
        console.error('[vault] rewrap verification failed, nothing was written');
        return 'failed';
      }

      // ONE update. PocketBase's update is read-modify-write, so the blob, its
      // salt and the iteration count have to move together or a concurrent write
      // can strand a salt that no longer matches its ciphertext.
      const saved = await userKeysApi.update(rec.id, {
        wrappedKey: next.wrapped,
        pwSalt: next.salt,
        iterations: next.iterations,
      });
      const cached = await cache(userId, master);
      const id = await restoreIdentity(saved, cached);
      set({ master: cached, record: saved, status: 'unlocked', ready: true, privateKey: id.privateKey, publicKey: id.publicKey });
      return 'ok';
    } catch (err) {
      console.error('[vault] rewrap failed', err);
      return 'failed';
    }
  },

  // Login knows the password, so try to unlock transparently right then.
  tryUnlock: async (userId, password) => {
    await get().load(userId);
    if (get().status === 'locked') await get().unlock(password);
  },

  lock: () => {
    const { userId, record } = get();
    if (userId) {
      void idbDel(cacheKey(userId)).catch(() => {});
      try {
        localStorage.removeItem(cacheKey(userId));
      } catch {
        /* ignore */
      }
    }
    set({ master: null, privateKey: null, publicKey: null, status: record ? 'locked' : 'absent', recoveryCode: null });
  },

  clearRecoveryCode: () => set({ recoveryCode: null }),
  openPanel: () => set({ panelOpen: true }),
  closePanel: () => set({ panelOpen: false }),

  encrypt: async (value) => {
    const { master } = get();
    if (!master) return null;
    return encryptContent(master, value);
  },
  decrypt: async (envelope) => {
    const { master } = get();
    if (!master) throw new Error('vault is locked');
    return decryptContent(master, envelope);
  },
}));
