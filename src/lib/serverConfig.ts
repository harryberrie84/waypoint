import { pbBaseUrl } from './pocketbase';

// What the instance is willing to tell an anonymous visitor about itself.
// Served by server/pb_hooks/gate_registration.pb.js.
export type ServerConfig = {
  /** Whether the sign-up form should be offered at all. */
  openRegistration: boolean;
};

// An install running an older build has no such route, so the fetch 404s. That
// install has open registration, which is precisely what this default says, so
// failing open here is not a soft option: it is the truthful answer for the
// server that just failed to answer. The gate itself lives on the server either
// way, so this only decides which form is drawn, never who gets an account.
const FALLBACK: ServerConfig = { openRegistration: true };

let cached: Promise<ServerConfig> | null = null;

/** Read the instance config, once per page load. Never rejects. */
export function serverConfig(): Promise<ServerConfig> {
  if (!cached) cached = load();
  return cached;
}

async function load(): Promise<ServerConfig> {
  try {
    const r = await fetch(`${pbBaseUrl()}/api/waypoint/config`, { headers: { Accept: 'application/json' } });
    if (!r.ok) return FALLBACK;
    const body: unknown = await r.json();
    return { openRegistration: readOpenRegistration(body) };
  } catch {
    return FALLBACK;
  }
}

// Only a literal `false` closes the form. Anything else (a proxy returning an
// HTML error page as 200, a future field rename) leaves it as it is today rather
// than hiding sign-up on an instance that in fact allows it.
export function readOpenRegistration(body: unknown): boolean {
  if (body && typeof body === 'object' && 'openRegistration' in body) {
    return (body as { openRegistration: unknown }).openRegistration !== false;
  }
  return FALLBACK.openRegistration;
}
