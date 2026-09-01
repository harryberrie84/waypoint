// ---------------------------------------------------------------------------
// End-to-end content encryption, the cryptographic core.
// ---------------------------------------------------------------------------
// Built entirely on the Web Crypto API (SubtleCrypto), which is native in every
// modern browser and in Node, so there is no new dependency and the primitives
// are vetted, not hand-rolled.
//
// Model (per-user, for "private lockers"):
//   - Each user has a random 256-bit AES-GCM **master key**. It encrypts their
//     private page content; it is never sent to the server in usable form.
//   - The master key is **wrapped** (encrypted) twice: once with a key stretched
//     from the user's password (PBKDF2), once with a key stretched from a printed
//     **recovery code**. Only those two wrapped blobs reach the server, so the
//     operator, even with full database access, cannot read the content.
//   - Content is AES-256-GCM encrypted with a fresh random IV and stored as an
//     `enc:v1:<base64>` envelope. Plaintext (a normal object) is passed straight
//     through, so existing un-encrypted pages keep working untouched.
//
// AES-GCM is authenticated: a wrong key (or tampered ciphertext) makes decrypt
// throw rather than return garbage, which is how unlock checks the password.

const ENVELOPE_PREFIX = 'enc:v1:';
const IV_BYTES = 12;
const SALT_BYTES = 16;
// OWASP's current floor for PBKDF2-SHA256. The count is stored per wrapped key
// (WrappedKey.iterations), so raising it only affects NEW vaults / rewraps; an
// existing vault still unwraps with whatever count it was wrapped at.
export const DEFAULT_ITERATIONS = 600_000;

const subtle = (): SubtleCrypto => globalThis.crypto.subtle;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

// --- base64 (browser + node, no Buffer) -------------------------------------

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

// TextEncoder.encode is typed against ArrayBufferLike; copy into an ArrayBuffer-
// backed view so it satisfies Web Crypto's BufferSource on this TS lib.
function bytes(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(textEncoder.encode(text));
}

// --- envelope detection -----------------------------------------------------

/** True for an `enc:v1:` ciphertext string. Anything else (a TipTap doc object,
 *  null, plain text) is left alone, that's what keeps existing pages working. */
export function isEnvelope(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(ENVELOPE_PREFIX);
}

/** What to show for a title that's still an unopened ciphertext envelope (vault
 *  locked, or someone else's encrypted page). Plaintext titles pass through. */
export function displayTitle(title: string): string {
  return isEnvelope(title) ? '🔒 Locked' : title || 'Untitled';
}

// --- master key -------------------------------------------------------------

export async function generateMasterKey(): Promise<CryptoKey> {
  return subtle().generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

export async function exportMasterKey(key: CryptoKey): Promise<string> {
  return toBase64(new Uint8Array(await subtle().exportKey('raw', key)));
}

export async function importMasterKey(rawB64: string): Promise<CryptoKey> {
  return subtle().importKey('raw', fromBase64(rawB64), { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
}

/** A NON-extractable copy of a master key, for the on-device cache. It still
 *  encrypts and decrypts, but its raw bytes can no longer be exported, so a script
 *  that runs on the page can use it while the tab is open yet cannot exfiltrate it.
 *  A no-op if the key is already non-extractable. */
export async function nonExtractableMaster(master: CryptoKey): Promise<CryptoKey> {
  if (!master.extractable) return master;
  const raw = new Uint8Array(await subtle().exportKey('raw', master));
  return subtle().importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

// --- AES-GCM encrypt/decrypt of raw bytes (iv prepended) ---------------------

async function aesEncrypt(key: CryptoKey, data: Uint8Array<ArrayBuffer>): Promise<string> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, key, data));
  const joined = new Uint8Array(iv.length + ct.length);
  joined.set(iv, 0);
  joined.set(ct, iv.length);
  return toBase64(joined);
}

async function aesDecrypt(key: CryptoKey, blob: string): Promise<Uint8Array<ArrayBuffer>> {
  const raw = fromBase64(blob);
  const iv = raw.slice(0, IV_BYTES);
  const ct = raw.slice(IV_BYTES);
  return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv }, key, ct));
}

// --- key wrapping (password / recovery) -------------------------------------

async function deriveWrappingKey(secret: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const base = await subtle().importKey('raw', bytes(secret), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export interface WrappedKey {
  wrapped: string; // base64(iv | ciphertext) of the raw master key
  salt: string; // base64 PBKDF2 salt
  iterations: number;
}

/** Encrypt the master key under a secret (the password or the recovery code). */
export async function wrapMasterKey(master: CryptoKey, secret: string, iterations = DEFAULT_ITERATIONS): Promise<WrappedKey> {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const kek = await deriveWrappingKey(secret, salt, iterations);
  const rawMaster: Uint8Array<ArrayBuffer> = new Uint8Array(await subtle().exportKey('raw', master));
  const wrapped = await aesEncrypt(kek, rawMaster);
  return { wrapped, salt: toBase64(salt), iterations };
}

/** Do two extractable master keys hold the same bytes?
 *
 *  Load-bearing for re-wrapping on a password change: a re-wrap must prove it
 *  round-trips to the SAME key before the old wrap is overwritten. The failure it
 *  exists to catch is the catastrophic one, writing a wrap around a DIFFERENT
 *  key, which would leave every `enc:v1:` value in the database unreadable
 *  forever. Both keys are local and already in memory, so this is a correctness
 *  check, not a side-channel-sensitive comparison. */
export async function sameMasterKey(a: CryptoKey, b: CryptoKey): Promise<boolean> {
  const [ra, rb] = await Promise.all([subtle().exportKey('raw', a), subtle().exportKey('raw', b)]);
  const x = new Uint8Array(ra);
  const y = new Uint8Array(rb);
  if (x.length !== y.length || x.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

/** Recover the master key from a wrapped blob + the secret. Throws if the secret
 *  is wrong (the GCM auth tag fails to verify). */
export async function unwrapMasterKey(w: WrappedKey, secret: string): Promise<CryptoKey> {
  const kek = await deriveWrappingKey(secret, fromBase64(w.salt), w.iterations);
  const raw = await aesDecrypt(kek, w.wrapped);
  return subtle().importKey('raw', raw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
}

// --- content envelopes ------------------------------------------------------

/** Encrypt any JSON-serialisable value to an `enc:v1:` envelope string. */
export async function encryptContent(master: CryptoKey, value: unknown): Promise<string> {
  const blob = await aesEncrypt(master, bytes(JSON.stringify(value)));
  return ENVELOPE_PREFIX + blob;
}

/** Decrypt an `enc:v1:` envelope back to its value. Throws on a wrong key or
 *  tampered ciphertext, callers must keep the ciphertext, never overwrite it. */
export async function decryptContent(master: CryptoKey, envelope: string): Promise<unknown> {
  const bytes = await aesDecrypt(master, envelope.slice(ENVELOPE_PREFIX.length));
  return JSON.parse(textDecoder.decode(bytes));
}

// --- recovery code ----------------------------------------------------------

/** A printable high-entropy recovery code (160 bits, Crockford base32, grouped).
 *  This is the only way back in if the password is forgotten, write it down. */
export function generateRecoveryCode(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(20));
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 31];
  return out.replace(/(.{4})(?=.)/g, '$1-');
}

/** Normalise a typed-in recovery code (case, spaces, dashes) before unwrapping. */
export function normalizeRecoveryCode(code: string): string {
  return code.replace(/[\s-]/g, '').toUpperCase();
}

// ---------------------------------------------------------------------------
// Group / shared encryption, recipient keys (ECDH P-256, "encrypt to a key").
// ---------------------------------------------------------------------------
// For a SHARED workspace, one symmetric content key is encrypted ("wrapped")
// separately to each member's public key, so any member can recover it but a
// non-member (including the operator, for a space they're not in) cannot.
//
// Wrapping uses ECIES: a throwaway ("ephemeral") ECDH keypair derives a shared
// secret with the recipient's public key, HKDF stretches it to an AES-GCM key,
// and that encrypts the content key. The recipient redoes the ECDH with the
// ephemeral public key (stored alongside) to get the same secret. No sender
// identity is needed, so members can be granted access without coordinating.

const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const;

export interface RecipientKeyPair {
  publicKey: CryptoKey;
  privateKey: CryptoKey;
}

export async function generateKeyPair(): Promise<RecipientKeyPair> {
  const pair = await subtle().generateKey(ECDH, true, ['deriveBits']);
  return { publicKey: pair.publicKey, privateKey: pair.privateKey };
}

export async function exportPublicKey(key: CryptoKey): Promise<string> {
  return toBase64(new Uint8Array(await subtle().exportKey('spki', key)));
}
export async function importPublicKey(b64: string): Promise<CryptoKey> {
  return subtle().importKey('spki', fromBase64(b64), ECDH, true, []);
}

/** A short, human-comparable fingerprint of a member's public key: the SHA-256 of
 *  its SPKI bytes, first 128 bits, as grouped uppercase hex. Two people reading
 *  these to each other out of band can confirm they hold each other's real key,
 *  the one check a substituting server can't forge. Deterministic: the same key
 *  always yields the same string. Throws on malformed input. */
export async function keyFingerprint(publicKeyB64: string): Promise<string> {
  const digest = new Uint8Array(await subtle().digest('SHA-256', fromBase64(publicKeyB64)));
  let hex = '';
  for (let i = 0; i < 16; i++) hex += digest[i].toString(16).padStart(2, '0');
  return (hex.toUpperCase().match(/.{4}/g) ?? []).join(' ');
}

async function exportPrivateKey(key: CryptoKey): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await subtle().exportKey('pkcs8', key));
}
async function importPrivateKey(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return subtle().importKey('pkcs8', raw, ECDH, true, ['deriveBits']);
}

/** A fresh random 256-bit content key for a workspace. */
export async function generateContentKey(): Promise<CryptoKey> {
  return generateMasterKey();
}

// Derive the ECIES AES-GCM key-encryption key from an ECDH shared secret.
async function deriveEciesKey(privateKey: CryptoKey, publicKey: CryptoKey): Promise<CryptoKey> {
  const secret = new Uint8Array(await subtle().deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256));
  const hkdf = await subtle().importKey('raw', secret, 'HKDF', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: bytes('waypoint-workspace-key') },
    hkdf,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Wrap a content key to a recipient's public key. Returns `<ephPub>.<blob>`. */
export async function wrapContentKeyFor(contentKey: CryptoKey, recipientPublicKeyB64: string): Promise<string> {
  const recipient = await importPublicKey(recipientPublicKeyB64);
  const eph = await generateKeyPair();
  const kek = await deriveEciesKey(eph.privateKey, recipient);
  const rawKey: Uint8Array<ArrayBuffer> = new Uint8Array(await subtle().exportKey('raw', contentKey));
  const wrapped = await aesEncrypt(kek, rawKey);
  return `${await exportPublicKey(eph.publicKey)}.${wrapped}`;
}

/** Recover a content key from a wrap made to your public key. Throws if it was
 *  wrapped to someone else (you can't derive the shared secret). */
export async function unwrapContentKeyWith(blob: string, privateKey: CryptoKey): Promise<CryptoKey> {
  const dot = blob.indexOf('.');
  const ephPub = await importPublicKey(blob.slice(0, dot));
  const kek = await deriveEciesKey(privateKey, ephPub);
  const raw = await aesDecrypt(kek, blob.slice(dot + 1));
  return subtle().importKey('raw', raw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
}

// The recipient private key is itself protected by the master key (which is
// wrapped by password + recovery), so the whole chain hangs off one unlock.
export async function wrapPrivateKey(privateKey: CryptoKey, master: CryptoKey): Promise<string> {
  return aesEncrypt(master, await exportPrivateKey(privateKey));
}
export async function unwrapPrivateKey(blob: string, master: CryptoKey): Promise<CryptoKey> {
  return importPrivateKey(await aesDecrypt(master, blob));
}
