import { useEffect, useRef, useState } from 'react';
import { useAuth } from './store/useAuth';
import { useData } from './store/useData';
import { useWorkspace } from './store/useWorkspace';
import { useVault } from './store/useVault';
import { useWorkspaceKeys } from './store/useWorkspaceKeys';
import { useTheme } from './hooks/useTheme';
import { isImageIcon } from './lib/pageIcon';
import { AuthScreen } from './components/AuthScreen';
import { PublicPage } from './components/PublicPage';
import { Sidebar } from './components/Sidebar';
import { isProseWriting } from './lib/proseSync';
import { saveLastPage } from './lib/landing';
import { Breadcrumb } from './components/Breadcrumb';
import { PageView } from './components/PageView';
import { HomeView } from './components/HomeView';
import { ErrorBoundary } from './components/ErrorBoundary';
import { CommandPalette } from './components/CommandPalette';
import { TrashPanel } from './components/TrashPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { NotificationsBell } from './components/NotificationsBell';
import { RowDetail } from './components/RowDetail';
import { Toaster } from './components/Toaster';
import { ConfirmDialog } from './components/ConfirmDialog';
import { UpdateToast } from './components/UpdateToast';
import { CharacterSheetForm } from './components/CharacterSheetForm';
import { ThemeManager } from './components/ThemeManager';
import { StarterPicker } from './components/StarterPicker';
import { HelpPanel } from './components/HelpPanel';
import { VaultPanel } from './components/VaultPanel';
import { CaptureBar } from './components/CaptureBar';
import { MobilePageSwitcher } from './components/MobilePageSwitcher';
import { AddToHomePrompt } from './components/AddToHomePrompt';
import { toast } from './store/useToast';
import { searchHint, isSearchShortcut } from './lib/platform';
import { Sun, Moon, Palette, LogOut, ChevronsLeft, ChevronsRight, MapPin, Loader2, Search, Settings, Trash2, Undo2, Menu, HelpCircle } from 'lucide-react';

// Draw an emoji to a small canvas and return a PNG data url, for a tab favicon.
function emojiFavicon(emoji: string): string {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.font = '52px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, 32, 36);
    return canvas.toDataURL('image/png');
  } catch {
    return '';
  }
}

export default function App() {
  const authReady = useAuth((s) => s.ready);
  const user = useAuth((s) => s.user);
  const initAuth = useAuth((s) => s.init);

  useEffect(() => {
    initAuth();
  }, [initAuth]);

  // A public share link renders one page read-only, no account and no waiting on
  // auth. Checked before the auth gate so grandparents never see a login wall.
  const shareToken = new URLSearchParams(window.location.search).get('share');
  if (shareToken) return <PublicPage token={shareToken} />;

  if (!authReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper dark:bg-coal">
        <Loader2 className="h-6 w-6 animate-spin text-clay" />
      </div>
    );
  }

  if (!user) return <AuthScreen />;
  return <Workspace />;
}

function Workspace() {
  const { theme, toggle, appearance, applyPreset, setToken, setFont, resetTheme } = useTheme();
  const logout = useAuth((s) => s.logout);
  const userName = useAuth((s) => s.user?.name ?? 'You');

  const hydrate = useData((s) => s.hydrate);
  const subscribe = useData((s) => s.subscribeRealtime);
  const unsubscribe = useData((s) => s.unsubscribeRealtime);
  const teardown = useData((s) => s.teardown);
  const loaded = useData((s) => s.loaded);
  const loadError = useData((s) => s.loadError);
  const activePageId = useData((s) => s.activePageId);
  const pageCount = useData((s) => Object.keys(s.pages).length);

  const [sidebarOpen, setSidebarOpen] = useState(
    () => typeof window === 'undefined' || !window.matchMedia?.('(max-width: 767px)').matches,
  );
  const [pickerDone, setPickerDone] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const lastAction = useData((s) => s.lastAction);
  const undoLast = useData((s) => s.undoLast);
  const dismissLastAction = useData((s) => s.dismissLastAction);
  const pendingWorkspaceMove = useData((s) => s.pendingWorkspaceMove);
  const revertWorkspaceMove = useData((s) => s.revertWorkspaceMove);
  const acceptWorkspaceMove = useData((s) => s.acceptWorkspaceMove);
  const [reverting, setReverting] = useState(false);

  // On phones the sidebar is an overlay; close it once a page is chosen so it
  // doesn't sit on top of the content the user just navigated to.
  useEffect(() => {
    if (typeof window !== 'undefined' && window.matchMedia?.('(max-width: 767px)').matches) {
      setSidebarOpen(false);
    }
  }, [activePageId]);

  // Remember the open page so a refresh (even a hard ctrl+shift+r) returns to it.
  useEffect(() => {
    saveLastPage(activePageId);
  }, [activePageId]);

  // Auto-dismiss the undo toast after a few seconds.
  useEffect(() => {
    if (!lastAction) return;
    const t = setTimeout(() => dismissLastAction(), 7000);
    return () => clearTimeout(t);
  }, [lastAction, dismissLastAction]);

  // Global shortcuts: quick find (Q for query, K accepted as a fallback where the
  // browser owns Q, see lib/platform.ts), and ? for the shortcut + command cheat
  // sheet (only when
  // you're not typing into a field, so a literal "?" in text still types).
  useEffect(() => {
    const isTyping = (t: EventTarget | null): boolean => {
      const el = t as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
    };
    const onKey = (e: KeyboardEvent) => {
      if (isSearchShortcut(e)) {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      if (e.key === '?' && !e.metaKey && !e.ctrlKey && !e.altKey && !isTyping(e.target)) {
        e.preventDefault();
        setHelpOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      // Workspaces first so the active one is known before pages load (create
      // paths + the sidebar scope to it). Falls back to a local default if the
      // backend collections aren't there yet.
      await useWorkspace.getState().hydrateWorkspaces();
      if (!active) return;
      // Claim any invites for this account (client-side, so it doesn't depend on
      // the server hook). If we joined anything, re-hydrate and land there.
      const claimed = await useWorkspace.getState().claimMyInvites();
      if (!active) return;
      if (claimed.length) {
        await useWorkspace.getState().hydrateWorkspaces();
        if (!active) return;
        const ws = useWorkspace.getState();
        const myId = useAuth.getState().user?.id ?? '';
        const landed = claimed.find((w) => ws.members.some((m) => m.workspace === w && m.user === myId));
        if (landed) ws.setActiveWorkspace(landed);
      }
      await hydrate();
      if (!active) return;
      // Auto-purge trash older than 14 days, unless the user turned it off.
      if (localStorage.getItem('waypoint:trashAutoPurge') !== '0') {
        void useData.getState().sweepOldTrash(14);
      }
      await subscribe();
      void useWorkspace.getState().subscribeWorkspaces();
      void useData.getState().refreshRates();
    })();
    return () => {
      active = false;
      void unsubscribe();
      void useWorkspace.getState().unsubscribeWorkspaces();
      teardown();
      useWorkspace.getState().teardownWorkspaces();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Soft re-sync on resume. On mobile the realtime stream gets killed when the
  // tab backgrounds or the network flips (wifi <-> 5G), so changes stop arriving
  // and the page looks stale until a manual refresh. When the tab becomes visible
  // again or the network returns, re-establish the live subscription and refetch
  // IN PLACE, so changes appear on their own, no full page reload. Guarded so it
  // never clobbers an edit you're mid-typing on the open page.
  useEffect(() => {
    let lastAt = 0;
    let running = false;
    const resync = async () => {
      if (running || document.visibilityState !== 'visible' || !navigator.onLine) return;
      if (!useData.getState().loaded) return;
      const now = Date.now();
      if (now - lastAt < 2000) return; // throttle bursts of focus/visibility events
      lastAt = now;
      running = true;
      try {
        await unsubscribe();
        await useWorkspace.getState().unsubscribeWorkspaces();
        // Refetch to catch anything missed while disconnected, unless the user is
        // mid-edit on the open page (a full refetch would overwrite the unsaved
        // local change). The realtime re-subscribe still resumes live updates.
        const activeId = useData.getState().activePageId;
        if (!activeId || !isProseWriting(activeId)) await hydrate();
        await subscribe();
        void useWorkspace.getState().subscribeWorkspaces();
      } catch {
        /* a failed resync just leaves the previous state; the next event retries */
      } finally {
        running = false;
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void resync();
    };
    const onResume = () => void resync();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onResume);
    window.addEventListener('focus', onResume);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onResume);
      window.removeEventListener('focus', onResume);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Show the active workspace's icon as the browser tab favicon (an emoji is drawn
  // to a canvas; an uploaded image uses its url). Falls back to the original.
  const activeWsIcon = useWorkspace((s) => s.workspaces.find((w) => w.id === s.activeWorkspaceId)?.icon ?? '');
  useEffect(() => {
    const link = document.querySelector("link[rel~='icon']") as HTMLLinkElement | null;
    if (!link) return;
    if (!link.dataset.orig) link.dataset.orig = link.href;
    if (!activeWsIcon) {
      link.href = link.dataset.orig;
      return;
    }
    link.href = isImageIcon(activeWsIcon) ? activeWsIcon.trim() : emojiFavicon(activeWsIcon) || link.dataset.orig;
  }, [activeWsIcon]);

  // Keep encrypted page titles decrypted in the store: re-run when the vault
  // unlocks and (debounced) whenever data changes. No-ops when nothing's encrypted.
  const vaultStatus = useVault((s) => s.status);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const decrypt = () => {
      const wk = useWorkspaceKeys.getState();
      void wk.decryptTitles();
      void wk.decryptCells();
      void wk.decryptRowBodies();
      void wk.decryptBodies();
    };
    const run = () => {
      if (t) clearTimeout(t);
      t = setTimeout(decrypt, 150);
    };
    decrypt();
    const unsub = useData.subscribe(run);
    return () => {
      if (t) clearTimeout(t);
      unsub();
    };
  }, [vaultStatus]);

  // Automatic key distribution: when the active workspace is encrypted, ensure
  // its key, which publishes my public key and grants it to co-members who've
  // published theirs. Re-runs as the roster changes so new members get access.
  const activeWorkspaceId = useWorkspace((s) => s.activeWorkspaceId);
  const members = useWorkspace((s) => s.members);
  useEffect(() => {
    if (vaultStatus !== 'unlocked' || !activeWorkspaceId) return;
    if (!useWorkspace.getState().encryptedEnabled(activeWorkspaceId)) return;
    void useWorkspaceKeys.getState().ensure(activeWorkspaceId);
  }, [vaultStatus, activeWorkspaceId, members]);

  // A brand-new account lands on the starter picker (first run, empty workspace)
  // instead of a blank page. Once any page exists, this never shows again.
  //
  // `?starter=1` forces it open whatever the page count, which is the only way
  // to exercise first-run behaviour twice without wiping an account. It changes
  // nothing else: picking a starter still just creates a page.
  const forceStarter = new URLSearchParams(window.location.search).has('starter');
  const showPicker = loaded && !loadError && (pageCount === 0 || forceStarter) && !pickerDone;

  // OS share target + deep links. The share target routes "Share → Waypoint" to
  // `/?text=…`; a push deep-link uses `?page=`/`?row=`. Consume them once after
  // load, then strip so a reload doesn't re-capture.
  const captureToInbox = useData((s) => s.captureToInbox);
  const setActivePage = useData((s) => s.setActivePage);
  const openRow = useData((s) => s.openRow);
  const linkHandled = useRef(false);
  useEffect(() => {
    if (!loaded || linkHandled.current) return;
    linkHandled.current = true;
    const params = new URLSearchParams(window.location.search);
    const shared = [params.get('title'), params.get('text'), params.get('url')].filter(Boolean).join(' ').trim();
    const page = params.get('page');
    const row = params.get('row');
    if (!shared && !page && !row) return;
    if (shared) {
      void captureToInbox(shared).then((id) => {
        if (id) {
          setActivePage(id);
          toast('saved to inbox');
        }
      });
    }
    if (page) setActivePage(page);
    if (row) openRow(row);
    for (const k of ['title', 'text', 'url', 'page', 'row']) params.delete(k);
    const qs = params.toString();
    window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash);
  }, [loaded, captureToInbox, setActivePage, openRow]);

  if (loadError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-paper px-6 text-center dark:bg-coal">
        <p className="text-sm font-medium text-ink dark:text-coal-text">Couldn&rsquo;t reach the workspace server.</p>
        <p className="max-w-md text-xs text-ink-faint dark:text-coal-soft">{loadError}</p>
        <button
          type="button"
          onClick={() => void hydrate()}
          className="rounded-lg bg-clay px-4 py-2 text-sm font-semibold text-white hover:bg-clay-soft"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!loaded) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper dark:bg-coal">
        <div className="flex items-center gap-2 text-sm text-ink-faint dark:text-coal-soft">
          <Loader2 className="h-5 w-5 animate-spin text-ochre dark:text-ochre-soft" />
          Loading workspace…
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-paper text-ink dark:bg-coal dark:text-coal-text">
      {/* Mobile backdrop, taps to close the overlay sidebar. */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-coal/30 backdrop-blur-sm md:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden
        />
      )}
      <aside
        className={[
          'z-40 flex w-64 shrink-0 flex-col border-r border-paper-line bg-paper-panel/40 dark:border-coal-line dark:bg-coal-panel/40',
          // Phone: fixed overlay that slides in/out.
          'fixed inset-y-0 left-0 transition-transform duration-200',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
          // Desktop: in-flow, collapses by width instead.
          'md:relative md:z-auto md:translate-x-0 md:transition-[width]',
          sidebarOpen ? 'md:w-64' : 'md:w-0 md:overflow-hidden',
        ].join(' ')}
      >
        <div className="flex items-center gap-2 px-3 py-3">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-clay text-white">
            <MapPin className="h-4 w-4" />
          </div>
          <span className="font-display text-base font-semibold">Waypoint</span>
        </div>
        <div className="min-h-0 flex-1">
          <Sidebar />
        </div>
        <div className="border-t border-paper-line px-3 py-2.5 dark:border-coal-line">
          <div className="mb-2 flex items-center gap-1">
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-ink-faint hover:bg-paper-panel hover:text-ink-soft dark:text-coal-soft dark:hover:bg-coal-line"
              title="Settings & members"
            >
              <Settings className="h-3.5 w-3.5" /> Settings
            </button>
            <button
              type="button"
              onClick={() => setTrashOpen(true)}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-ink-faint hover:bg-paper-panel hover:text-ink-soft dark:text-coal-soft dark:hover:bg-coal-line"
              title="Trash"
            >
              <Trash2 className="h-3.5 w-3.5" /> Trash
            </button>
          </div>
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-clay/15 text-xs font-semibold text-clay">
              {userName.slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1 truncate text-xs text-ink-soft dark:text-coal-soft">{userName}</span>
            <button
              type="button"
              onClick={logout}
              className="rounded p-1 text-ink-faint hover:bg-paper-line hover:text-ink dark:hover:bg-coal-line dark:hover:text-coal-text"
              title="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-paper-line px-3 py-2 dark:border-coal-line">
          <button
            type="button"
            onClick={() => setSidebarOpen((o) => !o)}
            className="rounded-lg p-1.5 text-ink-faint hover:bg-paper-panel hover:text-ink dark:hover:bg-coal-line dark:hover:text-coal-text"
            title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          >
            <Menu className="h-4 w-4 md:hidden" />
            <span className="hidden md:inline">
              {sidebarOpen ? <ChevronsLeft className="h-4 w-4" /> : <ChevronsRight className="h-4 w-4" />}
            </span>
          </button>
          <div className="min-w-0 flex-1">
            <Breadcrumb />
          </div>
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="flex items-center gap-1.5 rounded-lg border border-paper-line px-2 py-1.5 text-xs text-ink-faint hover:bg-paper-panel hover:text-ink-soft dark:border-coal-line dark:text-coal-soft dark:hover:bg-coal-line"
            title={`Search (${searchHint()})`}
          >
            <Search className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Search</span>
            {/* Was a hardcoded ⌘K, which every Windows and Linux user was also shown. */}
            <kbd className="hidden rounded bg-paper-panel px-1 text-[10px] sm:inline dark:bg-coal-line">{searchHint()}</kbd>
          </button>
          <NotificationsBell />
          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            className="rounded-lg p-1.5 text-ink-faint hover:bg-paper-panel hover:text-ink dark:hover:bg-coal-line dark:hover:text-coal-text"
            title="Help & commands"
          >
            <HelpCircle className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setThemeOpen(true)}
            className="rounded-lg p-1.5 text-ink-faint hover:bg-paper-panel hover:text-ink dark:hover:bg-coal-line dark:hover:text-coal-text"
            title="Appearance"
          >
            <Palette className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={toggle}
            className="rounded-lg p-1.5 text-ink-faint hover:bg-paper-panel hover:text-ink dark:hover:bg-coal-line dark:hover:text-coal-text"
            title="Toggle theme"
          >
            {theme === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
          </button>
        </header>

        <main className="min-h-0 flex-1">
          {activePageId ? (
            <ErrorBoundary key={activePageId} fallbackLabel="This page hit an error.">
              <PageView pageId={activePageId} />
            </ErrorBoundary>
          ) : (
            <ErrorBoundary fallbackLabel="Home hit an error.">
              <HomeView />
            </ErrorBoundary>
          )}
        </main>
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenThemes={() => setThemeOpen(true)}
        onToggleTheme={toggle}
      />
      <TrashPanel open={trashOpen} onClose={() => setTrashOpen(false)} />
      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <HelpPanel open={helpOpen} onClose={() => setHelpOpen(false)} />
      <ThemeManager
        open={themeOpen}
        onClose={() => setThemeOpen(false)}
        mode={theme}
        appearance={appearance}
        applyPreset={applyPreset}
        setToken={setToken}
        setFont={setFont}
        resetTheme={resetTheme}
      />
      <RowDetail />
      <CharacterSheetForm />

      {lastAction && (
        <div className="fixed bottom-safe left-1/2 z-[110] flex -translate-x-1/2 items-center gap-3 rounded-lg border border-paper-line bg-coal px-4 py-2.5 text-sm text-white shadow-2xl dark:border-coal-line">
          <span>{lastAction.label}</span>
          <button
            type="button"
            onClick={() => undoLast()}
            className="flex items-center gap-1 rounded-md bg-white/15 px-2 py-1 text-xs font-semibold hover:bg-white/25"
          >
            <Undo2 className="h-3.5 w-3.5" /> Undo
          </button>
        </div>
      )}
      {pendingWorkspaceMove && (
        <div className="fixed bottom-safe left-1/2 z-[120] flex max-w-[92vw] -translate-x-1/2 flex-wrap items-center justify-center gap-3 rounded-lg border border-paper-line bg-coal px-4 py-2.5 text-sm text-white shadow-2xl dark:border-coal-line">
          <span>{pendingWorkspaceMove.label}</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={reverting}
              onClick={() => {
                setReverting(true);
                void revertWorkspaceMove().finally(() => setReverting(false));
              }}
              className="flex items-center gap-1 rounded-md bg-white/15 px-2 py-1 text-xs font-semibold hover:bg-white/25 disabled:opacity-60"
            >
              <Undo2 className="h-3.5 w-3.5" /> {reverting ? 'reverting…' : 'Revert'}
            </button>
            <button
              type="button"
              disabled={reverting}
              onClick={() => acceptWorkspaceMove()}
              className="rounded-md bg-clay px-2 py-1 text-xs font-semibold text-white hover:bg-clay/90 disabled:opacity-60"
            >
              Accept
            </button>
          </div>
        </div>
      )}
      <Toaster />
      <ConfirmDialog />
      <UpdateToast />
      <MobilePageSwitcher />
      <CaptureBar />
      <AddToHomePrompt />
      <VaultPanel />
      {showPicker && <StarterPicker onDone={() => setPickerDone(true)} />}
    </div>
  );
}
