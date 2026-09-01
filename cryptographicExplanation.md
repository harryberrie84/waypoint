# How the encryption works

A plain-language and precise account of the crypto in this app. The goal is one
thing: in an encrypted workspace, only its members can read the content, not the
person running the server, not anyone with the database, not a network observer.
Everything below is built on the browser's native Web Crypto (SubtleCrypto), so
the primitives are vetted, not hand-rolled, and there is no crypto dependency to
trust. The source is `src/lib/crypto.ts`, `src/lib/cellCrypto.ts`,
`src/store/useVault.ts`, and `src/store/useWorkspaceKeys.ts`.

## The short answer to "do other members need the key handed to them?"

No manual handoff. It is automatic, with two conditions:

1. Both people have set up their vault (which publishes a public key on their
   membership row).
2. Someone who already holds the workspace key opens the workspace while online.

The granting happens in the browser of an existing key-holder, because the server
has no key and cannot do it. So a new member who opens an encrypted workspace sees
"Locked" until a key-holder is next online, at which point their app silently
wraps the workspace key to the new member's public key. From then on the new
member reads everything with no further action. The person who first turned
encryption on is the first key-holder and grants the rest.

If nobody who holds the key is online yet, the new member waits. Nobody types a
password to each other, nobody copies a key around.

## The building blocks

- **AES-256-GCM** for all content. GCM is authenticated: a wrong key or a tampered
  ciphertext makes decryption throw, it never returns garbage. That property is
  also how an unlock checks the password.
- **PBKDF2-SHA256, 310,000 iterations** to stretch a password or recovery code into
  a key-wrapping key. The iteration count makes guessing the password slow.
- **ECDH on P-256** plus **HKDF-SHA256** to encrypt a key "to" someone's public key
  (so a shared workspace key can be handed to each member individually).
- Random 12-byte IV per encryption, random 16-byte salt per PBKDF2 wrap, all from
  the OS CSPRNG (`crypto.getRandomValues`).

## Layer 1: your private vault (per user)

When you set up encryption you get a random **256-bit master key**. It never
leaves your device in a usable form. It is wrapped (encrypted) twice and only the
wrapped blobs are stored on the server:

- once with a key stretched from **your password**,
- once with a key stretched from a printed **recovery code** (160 bits, the only
  way back in if you forget the password).

The operator, even with the full database, sees only these two wrapped blobs and
cannot unwrap them without your password or recovery code. Unlocking on a device
unwraps the master key into memory and caches it locally so a refresh stays
unlocked; locking or signing out wipes that cache.

Alongside the master key you get an **ECDH identity keypair**. Its private key is
itself encrypted with your master key (so the whole chain hangs off one unlock),
and its public key is published on your workspace-membership row for others to
encrypt to. This is what makes shared workspaces possible.

## Layer 2: content envelopes

Any value (a page body, a title, a table cell object, a comment) is encrypted to a
string that looks like `enc:v1:<base64 of iv + ciphertext>`. A normal object,
plain text, or null is left exactly as-is. That passthrough is deliberate: pages
written before encryption, or in a non-encrypted workspace, keep working untouched
and the code can always tell ciphertext from plaintext (`isEnvelope`).

Decryption happens **in the browser, in memory**. The store holds the ciphertext
as it came from the server and decrypts on demand for display; it never writes the
plaintext back. Formulas and read-only blocks compute over the decrypted values in
memory and also never persist a result. So nothing about a feature "running" leaks
plaintext to the server.

## Layer 3: shared workspaces (group keys)

A shared encrypted workspace has one random **content key** (256-bit AES-GCM). That
single key is what actually encrypts the workspace's pages, titles, and cells. The
trick is handing that one key to every member without the server ever seeing it.

It is wrapped separately to each member using **ECIES**: a throwaway ephemeral
ECDH keypair is generated, it derives a shared secret with the member's published
public key, HKDF stretches that into an AES-GCM key, and that encrypts the content
key. The result, `<ephemeralPublicKey>.<wrapped>`, is stored as that member's row
in a `workspace_keys` table. The member redoes the ECDH with the stored ephemeral
public key and their own private key to get the same secret, and unwraps the
content key. A non-member cannot derive the secret, so a non-member (including the
operator, for a workspace they are not in) cannot read it.

### The handshake, step by step

This is the automatic flow from the short answer above (`ensure` and
`grantToMembers` in `useWorkspaceKeys.ts`):

1. On unlock, your app publishes your ECDH public key onto your membership row
   (once per session).
2. When you open an encrypted workspace, your app fetches the `workspace_keys`
   rows. If your row exists, it unwraps the content key with your private key and
   caches it. If no rows exist at all, you are the first in: your app mints the
   content key and wraps it to yourself. If rows exist but none is yours, you are
   not granted yet, so the workspace stays locked for you.
3. Whenever a key-holder's app has the content key, it wraps it to every member who
   has published a public key but does not yet have a `workspace_keys` row. That is
   the grant. It is best-effort and idempotent, several members can do it, and a
   member who is not ready (no published key) is simply skipped until they are.

`ensure` is hardened so a busy app cannot storm the server: concurrent calls share
one in-flight resolution, the public-key publish runs at most once per session, and
a failed attempt backs off for a few seconds.

## Hybrid cell encryption (so reminders still work)

Encrypting a whole table row would blind the server's reminder cron, which needs to
know when to fire and whom to email. So a row's cells are split
(`cellCrypto.ts::splitCells`):

- **reminder** datetimes, **person** assignees, and the `__notified` sentinels stay
  **plaintext**.
- everything else is encrypted into one `__enc` blob.
- additionally, if a row has a reminder set, its **title (first column)** is kept
  plaintext too, so the reminder email can say what it is about. Rows with no
  reminder keep their title encrypted.

The server therefore learns, for reminder rows only, the time, the recipients, and
the title, exactly what it needs to send a reminder, and nothing else. The cron
reads those plaintext fields; the app re-merges the decrypted secret on top for
display.

## What is and isn't protected

Encrypted (in an encrypted workspace, unreadable by the server):

- page bodies, page titles, table cell content, comment bodies.

Deliberately plaintext (operational, so server features keep working):

- reminder datetimes and person assignees on a row, and a reminder row's title.

Not end-to-end encrypted yet:

- **File attachments and uploaded images.** They go to PocketBase file storage,
  which the server can read. Client-side encrypted attachments are a planned
  build. For now, keep genuinely sensitive scans off encrypted workspaces or out
  of the app.

## Recovery and key rotation

- Forgot your password: unlock with the printed recovery code, then set a new
  password (the master key is re-wrapped under it).
- Lose both password and recovery code: the content is unrecoverable by design.
  There is no operator backdoor.
- **Member removal does not re-key the workspace today.** Removing someone stops
  them being granted access to anything new, but they keep whatever key they
  already unwrapped. To fully cut someone off you would rotate the workspace
  content key and re-grant the remaining members. That rotation is not built yet.

## Honest limits

- This is end-to-end against the database and the server's stored data. It is not a
  defense against a malicious or compromised server **serving you bad JavaScript**:
  a web app is delivered by the server, so the operator who wants to could ship
  code that captures your key after you unlock. That is true of every in-browser
  E2E app and is the reason the operator here is you, not a third party.
- Server-side features cannot read encrypted data: the cron cannot read an
  encrypted reminder that isn't on a `reminder`/`person` field, and full-text
  search only indexes what your unlocked device has decrypted.
- The decrypted master key is cached in `localStorage` so refreshes stay unlocked.
  Anyone with physical access to an unlocked device can read it. Locking or signing
  out clears it.

## The short version (send this to a dev friend)

It's a Notion-style planner (React + TypeScript on the front, PocketBase as the
backend/DB) with optional end-to-end encryption per workspace, all done in the
browser with the native Web Crypto API, no crypto library.

The model in four sentences:

1. Each user has a random AES-256 master key, stored only as two encrypted blobs:
   one wrapped by their password, one by a printed recovery code. The server never
   sees a usable key.
2. Each user also has an ECDH keypair (its private half encrypted by the master
   key, its public half published on their membership row).
3. A shared workspace has one random content key that actually encrypts the pages,
   titles and cells; that key is wrapped separately to each member's public key
   (ECIES), so any member can open it but the server can't.
4. Content is AES-GCM and stored as `enc:v1:<base64>` strings; the app decrypts in
   memory for display and never writes plaintext back. One exception: a row's
   reminder date and assignee stay plaintext so the server cron can still send
   reminders, everything else on the row is encrypted.

So the operator (me) can run the server and see structure and timestamps, but
cannot read the content of an encrypted workspace. The usual caveat applies: it's
a web app, so you still trust the server to ship honest JavaScript. Code lives in
`src/lib/crypto.ts` and `src/store/useWorkspaceKeys.ts`.

## The SMS version (just text this)

For a dev pal, a bit of jargon, still textable.

One text:

> my planner does per-workspace E2E encryption in the browser, native WebCrypto, no
> lib. server only ever stores ciphertext (enc:v1:<b64>, AES-256-GCM) + metadata, so
> as the operator i see structure and timestamps but never plaintext.

The "but how do I read it on a new device then?" text:

> your master key is a random AES-256 key the server never holds. it's stored only
> as 2 wrapped blobs: one AES-wrapped by a PBKDF2(password) key, one by
> PBKDF2(recovery code). new device = you log in, app pulls the wrapped blob,
> re-derives the wrapping key from your password client-side (PBKDF2, ~310k iters)
> and unwraps the master key into memory. server only ever saw the wrapped blob, so
> it can't, but you can with your password.

If they want the shared-workspace bit, a third:

> shared workspace has 1 random content key that does the actual AES-GCM. it's
> wrapped to each member individually via ECDH(P-256)+HKDF (ECIES) to their
> published pubkey, so every member unwraps it but a non-member (me) can't derive
> the secret. only reminder date + assignee stay plaintext so the server cron can
> still fire. lose password AND recovery code = gone, no backdoor.
