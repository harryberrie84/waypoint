// Trust-on-first-use for member public keys. Public keys arrive from the untrusted
// server, so we pin the first key we see for each member (per device) and treat a
// later CHANGE as suspicious: to the server, a substituting attacker and a member
// who legitimately reset their vault look identical, so a human must re-verify
// before we grant the workspace key to the new key. Pins live in localStorage, per
// device; there is no server side to this.

export type KeyTrust = 'new' | 'trusted' | 'changed';

const PIN_KEY = (userId: string) => `waypoint:keypin:${userId}`;

/** Pure trust decision from a stored pin and the current key. Split out so it can
 *  be unit-tested without a browser. 'new' = never seen, 'trusted' = matches the
 *  pin, 'changed' = differs from the pin (do not auto-trust). */
export function keyTrustStatus(pinned: string | null, current: string): KeyTrust {
  if (!pinned) return 'new';
  return pinned === current ? 'trusted' : 'changed';
}

export function pinnedKeyFor(userId: string): string | null {
  try {
    return localStorage.getItem(PIN_KEY(userId));
  } catch {
    return null;
  }
}

/** Pin (or re-pin) a member's key as trusted. Used on first sight and when a user
 *  explicitly verifies a changed key out of band. */
export function trustKey(userId: string, publicKey: string): void {
  try {
    localStorage.setItem(PIN_KEY(userId), publicKey);
  } catch {
    /* storage full / disabled: we just won't pin, granting stays as-is */
  }
}

/** Look at a member's current key, pinning it on FIRST sight (trust-on-first-use).
 *  Returns the status as it was before this call: 'new' means "just pinned and
 *  trusted", 'changed' means "differs from the pin, do not trust automatically". */
export function seeKey(userId: string, current: string): KeyTrust {
  const status = keyTrustStatus(pinnedKeyFor(userId), current);
  if (status === 'new' && current) trustKey(userId, current);
  return status;
}
