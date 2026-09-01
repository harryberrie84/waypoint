import PocketBase from 'pocketbase';

// ---------------------------------------------------------------------------
// PocketBase client
// ---------------------------------------------------------------------------
// Base URL resolution order:
//   1. VITE_PB_URL build-time env (set this when serving the SPA from a
//      different origin than PocketBase).
//   2. Same-origin (window.location.origin), the production default, because
//      we serve the built SPA from PocketBase's own pb_public directory, so the
//      API and the app share a host. This is what makes the Cloudflare tunnel
//      and LAN access "just work" without per-device config.
//   3. http://127.0.0.1:8090 fallback for `npm run dev` against a local PB.

function resolveBaseUrl(): string {
  // Optional-chained: import.meta.env only exists under the bundler, and this
  // module is reachable from the pure test runner, which has no bundler.
  const envUrl = import.meta.env?.VITE_PB_URL as string | undefined;
  if (envUrl && envUrl.trim()) return envUrl.trim();
  if (typeof window !== 'undefined' && window.location?.origin) {
    // In dev (vite on :5173) we still want :8090, so only trust same-origin
    // when not on a typical vite dev port.
    const { origin, port } = window.location;
    if (port !== '5173' && port !== '4173') return origin;
  }
  return 'http://127.0.0.1:8090';
}

export const pb = new PocketBase(resolveBaseUrl());

// Keep the SDK from auto-cancelling overlapping requests; we fire several
// reads/writes concurrently (e.g. hydrate) and PB's default auto-cancel would
// abort the earlier ones.
pb.autoCancellation(false);

export function pbBaseUrl(): string {
  return pb.baseURL;
}
