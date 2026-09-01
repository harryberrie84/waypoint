import { useEffect, useState } from 'react';
import { PageCollab } from '../lib/collab';
import { useAuth } from '../store/useAuth';
import type { Page } from '../types';

// Sets up a Yjs session for a page and reports its status. Yjs is the one editing
// model now; the doc opens local-first (IndexedDB) so `ready` arrives even with no
// network. `editable` says whether editing is safe right now: true when the relay
// is synced OR we already hold the page's content locally (so offline edits merge
// back cleanly). When it's false (offline on a page we've never opened here) the
// view stays a read-only preview. `editable` flips to true on its own once the
// relay syncs (onSync). Runs for every page, encrypted or not.

export type CollabState =
  | { status: 'off' } // not eligible (kill switch, not editable, locked-not-decrypted)
  | { status: 'connecting' }
  | { status: 'ready'; collab: PageCollab; needsSeed: boolean; editable: boolean }
  | { status: 'failed' };

const CONNECT_TIMEOUT_MS = 6000;
const MAX_RETRIES = 4;
const RETRY_MS = 3000;

// `reconnectKey` comes from the caller (PageView's gated pageCollabNonce), not from
// the store directly. resetPageCollab bumps that nonce after any out-of-editor
// content write, wiping the shared doc's three backing stores, so a session still
// bound to the old doc shows state that no longer exists: the "I have to refresh for
// it to appear" bug. Reconnecting reseeds from what was just written.
//
// The caller owns it because the reseed needs the DECRYPTED body, and only the caller
// knows whether its copy is current. Reading the raw nonce here would let the
// reconnect win that race and seed a fresh doc from stale plaintext.
export function useCollab(page: Page | undefined, enabled: boolean, encrypted: boolean, reconnectKey = 0): CollabState {
  const userId = useAuth((s) => s.user?.id ?? '');
  const [state, setState] = useState<CollabState>({ status: 'off' });
  const [attempt, setAttempt] = useState(0);

  const pageId = page?.id;
  // A plaintext page in the default workspace has no workspace id; that's fine,
  // the relay only ciphers when `encrypted` is set. The snapshot is loaded inside
  // connect() (fetched fresh from pages.ydoc), not passed in.
  const workspace = page?.workspace ?? '';

  // Fresh retry budget whenever the target page changes.
  useEffect(() => {
    setAttempt(0);
  }, [pageId]);

  useEffect(() => {
    if (!enabled || !pageId) {
      setState({ status: 'off' });
      return;
    }
    let alive = true;
    let settled = false; // whichever of connect/timeout fires first wins
    setState({ status: 'connecting' });
    const collab = new PageCollab(pageId, workspace, userId, encrypted);
    // The relay flips editable to true (and swaps the read-only preview for the
    // live editor) once it syncs, without a reconnect.
    collab.onSync = () =>
      setState((s) => (s.status === 'ready' && s.collab === collab ? { ...s, editable: collab.editableNow } : s));
    const timer = setTimeout(() => {
      if (!alive || settled) return;
      settled = true;
      collab.destroy();
      setState({ status: 'failed' });
    }, CONNECT_TIMEOUT_MS);

    collab
      .connect()
      .then(() => {
        if (settled) {
          collab.destroy();
          return;
        }
        settled = true;
        clearTimeout(timer);
        if (!alive) {
          collab.destroy();
          return;
        }
        setState({ status: 'ready', collab, needsSeed: collab.needsSeed, editable: collab.editableNow });
      })
      .catch(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        collab.destroy();
        if (alive) setState({ status: 'failed' });
      });

    return () => {
      alive = false;
      clearTimeout(timer);
      collab.destroy();
    };
    // Reconnect only when the page (or its encryption mode) changes, or a retry is
    // scheduled, not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, pageId, workspace, userId, encrypted, attempt, reconnectKey]);

  // Self-heal a failed connect a few times (transient relay blips), then give up
  // until the page is reopened. Bumping `attempt` re-runs the connect effect.
  useEffect(() => {
    if (state.status !== 'failed' || !enabled || attempt >= MAX_RETRIES) return;
    const t = setTimeout(() => setAttempt((a) => a + 1), RETRY_MS);
    return () => clearTimeout(t);
  }, [state.status, enabled, attempt]);

  return state;
}
