import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { MessageSquare, Smile, Lock, Unlock, Globe, MoreHorizontal, Copy, Bookmark, BookmarkCheck, Image as ImageIcon, Upload, Printer, X, FileText, Map as MapIcon, Workflow, Zap, Columns3, Network, History, CalendarRange, CalendarDays, Wallet, Images, Camera, Paperclip, Boxes, FolderInput, LayoutGrid, Pin, ChevronDown, BookOpen, Users, CloudSun, Coins, Grid3x3, Layers, Repeat, Trophy } from 'lucide-react';
import { useData, selectMyRole, canEdit, selectWorkspacePages } from '../store/useData';
import { useAuth } from '../store/useAuth';
import { useVault } from '../store/useVault';
import { useWorkspace } from '../store/useWorkspace';
import { useWorkspaceKeys } from '../store/useWorkspaceKeys';
import { isEnvelope, displayTitle } from '../lib/crypto';
import { pageToMarkdown, safeFileName } from '../lib/backup';
import { pageToICS } from '../lib/ics';
import { pageTables } from '../lib/tripViews';
import { isEmptyDoc } from '../lib/doc';
import { toast } from '../store/useToast';
import { Editor } from './Editor';
import { PageMap } from './PageMap';
import { MindmapView } from './MindmapView';
import { BacklinksStrip, LinksGraph } from './PageLinks';
import { VersionHistory } from './VersionHistory';
import { KanbanView } from './KanbanView';
import { TierListTab } from './TierListTab';
import { SheetTab } from './SheetTab';
import { FlashcardsTab } from './FlashcardsTab';
import { RotaTab } from './RotaTab';
import { BracketTab } from './BracketTab';
import { CurrencyTab } from './CurrencyTab';
import { Popover } from './Popover';
import { ItineraryTab } from './ItineraryTab';
import { CalendarTab } from './CalendarTab';
import { BudgetTab } from './BudgetTab';
import { MoodboardTab } from './MoodboardTab';
import { FilesTab } from './FilesTab';
import { PhotosTab } from './PhotosTab';
import { EmojiPicker } from './EmojiPicker';
import { FlowView } from './FlowView';
import { CommentsPanel } from './CommentsPanel';
import { PresenceBar } from './PresenceBar';
import { SharePanel } from './SharePanel';
import { usePresence } from '../hooks/usePresence';
import type { PresenceRecord } from '../types';
import { useCollab } from '../hooks/useCollab';
import { isImageIcon } from '../lib/pageIcon';
import { avatarColor, initials } from '../lib/avatar';
import { extractPlainText } from '../lib/search';
import { PeopleTab } from './PeopleTab';
import { WeatherTab } from './WeatherTab';
import { processImageFile, ImageTooLargeError } from '../lib/image';
import { uploadsApi } from '../lib/api';
import { buildPrintHtml, buildBookletHtml, printHtml } from '../lib/printDoc';
import { COVER_GRADIENTS, GRADIENT_KEYS, coverStyle } from '../lib/cover';

// PageView, the main editing surface for one page: emoji + title header, the
// block editor, live presence, and a collapsible comments rail.

export type PageTab =
  | 'notes' | 'itinerary' | 'calendar' | 'kanban' | 'tierlist' | 'map'
  | 'budget' | 'currency' | 'sheet' | 'cards' | 'rota' | 'bracket' | 'moodboard' | 'files' | 'photos' | 'people' | 'weather' | 'mindmap' | 'links' | 'flow';

// Every tab: key, label, icon. The first PRIMARY_COUNT show inline; the rest
// live behind a "More" menu so the bar stays readable with a dozen tabs.
const TAB_DEFS: readonly (readonly [PageTab, string, typeof FileText])[] = [
  ['notes', 'Notes', FileText],
  ['itinerary', 'Itinerary', CalendarRange],
  ['calendar', 'Calendar', CalendarDays],
  ['map', 'Map', MapIcon],
  ['kanban', 'Kanban', Columns3],
  ['tierlist', 'Tier list', LayoutGrid],
  ['budget', 'Budget', Wallet],
  ['currency', 'Currency', Coins],
  ['sheet', 'Sheet', Grid3x3],
  ['cards', 'Flashcards', Layers],
  ['rota', 'Rota', Repeat],
  ['bracket', 'Bracket', Trophy],
  ['moodboard', 'Moodboard', Images],
  ['files', 'Files', Paperclip],
  ['photos', 'Photos', Camera],
  ['people', 'People', Users],
  ['weather', 'Weather', CloudSun],
  ['mindmap', 'Mindmap', Workflow],
  ['links', 'Links', Network],
  ['flow', 'Flows', Zap],
];
const PRIMARY_COUNT = 6; // notes, itinerary, calendar, map, kanban, tierlist
const isPageTab = (v: unknown): v is PageTab => typeof v === 'string' && TAB_DEFS.some(([k]) => k === v);

export function PageView({ pageId }: { pageId: string }) {
  const page = useData((s) => s.pages[pageId]);
  const renamePage = useData((s) => s.renamePage);
  const setPageIcon = useData((s) => s.setPageIcon);
  const setPageContent = useData((s) => s.setPageContent);
  const resetPageCollab = useData((s) => s.resetPageCollab);
  const pendingFocus = useData((s) => s.pendingFocus);
  const clearFocus = useData((s) => s.clearFocus);
  const firePageCheckboxFlows = useData((s) => s.firePageCheckboxFlows);
  const duplicatePage = useData((s) => s.duplicatePage);
  const setPageTemplate = useData((s) => s.setPageTemplate);
  const setActivePage = useData((s) => s.setActivePage);
  const setPageCover = useData((s) => s.setPageCover);
  const pendingCommentsPage = useData((s) => s.pendingCommentsPage);
  const clearPendingComments = useData((s) => s.clearPendingComments);
  const pendingPageTab = useData((s) => s.pendingPageTab);
  const clearPendingPageTab = useData((s) => s.clearPendingPageTab);
  const myId = useAuth((s) => s.user?.id ?? null);
  const role = useData((s) => selectMyRole(s.pages, pageId, myId));
  const editable = canEdit(role);

  const vaultStatus = useVault((s) => s.status);
  const vaultReady = useVault((s) => s.ready);
  const openVault = useVault((s) => s.openPanel);
  const encryptForPage = useWorkspaceKeys((s) => s.encryptForPage);
  const decryptForPage = useWorkspaceKeys((s) => s.decryptForPage);
  // Re-decrypt once the workspace key is actually cached (it arrives a beat after
  // unlock / a grant), so a first attempt before the key lands recovers.
  const wsKeyReady = useWorkspaceKeys((s) => (page?.workspace ? !!s.keys[page.workspace] : true));
  const wsEncrypted = useWorkspace((s) => (page?.workspace ? s.encryptedEnabled(page.workspace) : false));
  const locked = isEnvelope(page?.content);
  // Save path encrypts when the page is already encrypted OR its workspace is set
  // to encrypt-by-default.
  const shouldEncrypt = locked || wsEncrypted;

  const [editing, setEditing] = useState(false);
  // Mirror `editing` into a ref so the decrypt effect can read it without making
  // it a dependency (the effect runs on every content echo).
  const editingRef = useRef(false);
  const onEditingChange = (f: boolean) => {
    editingRef.current = f;
    setEditing(f);
  };
  const [showComments, setShowComments] = useState(false);
  // Tell floating UI (the capture button) the comments rail is open so it can move
  // aside instead of covering the send button.
  useEffect(() => {
    useData.getState().setCommentsOpen(showComments);
    return () => useData.getState().setCommentsOpen(false);
  }, [showComments]);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  // A decrypted doc to push into the editor when restoring a version. Routing it
  // through the editor (not setPageContent) means a collab page restores into the
  // shared Yjs doc, so every peer converges and the snapshot updates.
  const [restoreDoc, setRestoreDoc] = useState<object | null>(null);
  const handleRestore = async (raw: unknown) => {
    if (!page) return;
    let doc = raw;
    if (typeof raw === 'string' && isEnvelope(raw)) {
      try {
        doc = await decryptForPage(page, raw);
      } catch {
        return; // can't read that snapshot with the current key
      }
    }
    if (doc && typeof doc === 'object') setRestoreDoc(doc as object);
  };
  // Download this one page as a Markdown file. Mirrors the workspace backup's
  // page-to-markdown, but for a single page and on demand. An encrypted page needs
  // the vault unlocked so its content can be read in the clear (the store may hold
  // the ciphertext envelope); a locked vault pops the unlock panel instead.
  const exportMarkdown = async () => {
    if (!page) return;
    let content: unknown = page.content;
    if (typeof content === 'string' && isEnvelope(content)) {
      if (vaultStatus !== 'unlocked') {
        openVault();
        toast('unlock your vault to export this page', 'error');
        return;
      }
      try {
        content = await decryptForPage(page, content);
      } catch {
        toast('could not decrypt this page', 'error');
        return;
      }
    }
    const title = displayTitle(page.title);
    const md = pageToMarkdown(title, content);
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeFileName(title, 'page')}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Download this page's dated rows as a .ics so each of you can subscribe just the
  // trip on your phone. Merges every table on the page into one calendar; reuses the
  // store's rows (decrypted in memory, like the grid), same as the per-table export.
  const exportIcs = () => {
    if (!page) return;
    const { tables, rows } = useData.getState();
    // Encrypted pages hold an envelope in the store, which yields no tables at
    // all; use the decrypted body when we have one.
    const pts = pageTables(decrypted ? { ...page, content: decrypted } : page, Object.values(tables));
    const allRows = Object.values(rows);
    const entries = pts.map((t) => ({ table: t, rows: allRows.filter((r) => r.table === t.id) }));
    const ics = pageToICS(displayTitle(page.title), entries);
    if (!ics.includes('BEGIN:VEVENT')) {
      toast('No dated rows on this page to put on a calendar', 'error');
      return;
    }
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeFileName(displayTitle(page.title), 'page')}.ics`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const [decrypted, setDecrypted] = useState<object | null>(null);
  const [decryptedFor, setDecryptedFor] = useState<string | null>(null);
  const [decryptFailed, setDecryptFailed] = useState(false);

  // Reading stats + who edited last, for the strip under the body. The page record's
  // owner is the best "who" it carries; presence answers who is here NOW, which is a
  // different question. Counts the DECRYPTED body when we hold one, so an encrypted
  // page reports words rather than the length of its ciphertext.
  const memberList = useWorkspace((s) => s.members);
  const lastEditor = useMemo(() => {
    const m = memberList.find((x) => x.user === page?.owner);
    return m ? { id: m.user, name: m.userName || 'Someone' } : null;
  }, [memberList, page?.owner]);
  const readStats = useMemo(() => {
    const doc = locked ? decrypted : page?.content;
    const text = doc && typeof doc === 'object' ? extractPlainText(doc) : '';
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    return { words, minutes: Math.max(1, Math.round(words / 220)) };
  }, [page?.content, decrypted, locked]);

  // "3 minutes ago" / "yesterday" / a date once it stops being recent.
  const relativeTime = (iso: string): string => {
    const then = new Date(iso).getTime();
    if (!then) return 'recently';
    const mins = Math.round((Date.now() - then) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs} h ago`;
    const days = Math.round(hrs / 24);
    if (days === 1) return 'yesterday';
    if (days < 7) return `${days} days ago`;
    return new Date(iso).toLocaleDateString();
  };

  // resetPageCollab bumps this after an out-of-editor write so the session
  // reconnects and reseeds instead of showing the pre-write doc until a refresh.
  //
  // It is GATED, and that gate is load-bearing on an encrypted page. The reseed
  // takes its content from `decrypted`, which is refreshed by an async effect. If the
  // reconnect won that race, the fresh doc would be seeded from the PREVIOUS
  // plaintext and saved straight back, throwing away the file that was just added.
  // So the nonce is only applied once the decrypted copy belongs to the envelope the
  // store currently holds. A plaintext page has nothing to wait for.
  const rawNonce = useData((s) => s.pageCollabNonce[pageId] ?? 0);
  const bodyCurrent = !locked || decryptedFor === page?.content;

  // Notes/Map/Mindmap is per-device UI state, not page data. PageView remounts
  // per page (App keys it by active id), so reading localStorage on init is enough.
  // Declared up here because the collab reconnect below is gated on which tab is
  // showing, and useCollab needs that gate.
  const [tab, setTab] = useState<PageTab>(() => {
    // The page's shared default tab (an admin/editor set it for everyone) wins on
    // entry; else the per-device last-visited tab; else Notes.
    if (isPageTab(page?.defaultTab)) return page!.defaultTab as PageTab;
    try {
      const v = localStorage.getItem(`waypoint:tab:${pageId}`);
      if (isPageTab(v)) return v;
    } catch {
      /* ignore */
    }
    return 'notes';
  });
  const selectTab = (next: PageTab) => {
    setTab(next);
    try {
      localStorage.setItem(`waypoint:tab:${pageId}`, next);
    } catch {
      // private-mode storage; the in-memory tab still switches.
    }
  };

  // The gated collab reconnect. Two conditions, both learned the hard way:
  //
  // 1. The Notes editor must actually be mounted. It is the only thing that seeds a
  //    reseeded doc (via collabSeed), so reconnecting while you are on Files or
  //    Photos tears the session down, consumes the force-seed flag with nobody around
  //    to act on it, and leaves an empty document behind. That is the "it showed for
  //    a second and then vanished" report.
  // 2. On an encrypted page the decrypted copy must belong to the envelope the store
  //    currently holds, or the reseed would seed from the PREVIOUS plaintext and save
  //    it back, discarding what was just added.
  //
  // When neither holds we simply do not reconnect: switching to Notes mounts the
  // editor fresh against current content anyway, which is the same outcome.
  const [collabNonce, setCollabNonce] = useState(rawNonce);
  useEffect(() => {
    if (tab === 'notes' && bodyCurrent && rawNonce !== collabNonce) setCollabNonce(rawNonce);
  }, [tab, bodyCurrent, rawNonce, collabNonce]);

  // Turn this page + its sub-tree into its own workspace. The source workspace is
  // "shared" when it has more members than just you; converting then removes the
  // moved tree from everyone else in it, which the confirm spells out.
  const turnPageIntoWorkspace = useData((s) => s.turnPageIntoWorkspace);
  const [convertOpen, setConvertOpen] = useState(false);
  const [converting, setConverting] = useState(false);
  const sourceShared = useWorkspace((s) => {
    const wsId = page?.workspace ?? '';
    return !!wsId && s.members.filter((m) => m.workspace === wsId).length > 1;
  });
  const runConvert = async () => {
    setConverting(true);
    const res = await turnPageIntoWorkspace(pageId);
    setConverting(false);
    setConvertOpen(false);
    if (!res.ok && res.reason) toast(res.reason, 'error');
  };

  // Move this page + its sub-tree into an EXISTING workspace, under a chosen parent.
  const movePageToWorkspace = useData((s) => s.movePageToWorkspace);
  const allPages = useData((s) => s.pages);
  const allWorkspaces = useWorkspace((s) => s.workspaces);
  const wsMembers = useWorkspace((s) => s.members);
  const defaultWorkspaceId = useWorkspace((s) => s.defaultWorkspaceId);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveTargetWs, setMoveTargetWs] = useState('');
  const [moveParent, setMoveParent] = useState(''); // '' = top level
  const [moveQuery, setMoveQuery] = useState('');
  const [moving, setMoving] = useState(false);
  // Workspaces I belong to other than this page's own.
  const otherWorkspaces = useMemo(
    () =>
      allWorkspaces.filter(
        (w) => w.id !== (page?.workspace ?? '') && wsMembers.some((m) => m.workspace === w.id && m.user === myId),
      ),
    [allWorkspaces, wsMembers, myId, page?.workspace],
  );
  const targetPages = useMemo(() => {
    if (!moveTargetWs) return [];
    const q = moveQuery.trim().toLowerCase();
    return Object.values(selectWorkspacePages(allPages, moveTargetWs, defaultWorkspaceId))
      .filter((p) => !p.trashed && !p.template && (!q || displayTitle(p.title).toLowerCase().includes(q)))
      .sort((a, b) => displayTitle(a.title).localeCompare(displayTitle(b.title)))
      .slice(0, 40);
  }, [moveTargetWs, allPages, defaultWorkspaceId, moveQuery]);
  const openMove = () => {
    setMoveTargetWs('');
    setMoveParent('');
    setMoveQuery('');
    setMoveOpen(true);
  };
  const runMove = async () => {
    if (!moveTargetWs) return;
    setMoving(true);
    const res = await movePageToWorkspace(pageId, moveTargetWs, moveParent);
    setMoving(false);
    setMoveOpen(false);
    if (!res.ok && res.reason) toast(res.reason, 'error');
  };

  // Real-time co-editing, now for every page (Yjs is the one content model). A
  // plaintext page collaborates in the clear; an encrypted one only once the vault
  // is unlocked and (if locked) decrypted, so the shared doc can seed from the
  // plaintext without ciphering an empty doc over content we can't read. Falls back
  // to the plain editor when off or unreachable, so editing is never blocked.
  // Only while the Notes editor is actually on screen. A collab session exists to
  // drive that editor; holding one open on the Files or Photos tab keeps a Yjs doc
  // in memory that nothing is bound to, and that stale doc can be written back
  // (snapshot / relay catch-up) AFTER an out-of-editor write has just replaced the
  // content. That is how an uploaded image appeared, then vanished, and never came
  // back: the file stayed on disk with nothing referencing it. No editor, no session.
  const collabEnabled =
    tab === 'notes' &&
    editable &&
    localStorage.getItem('waypoint:nocollab') !== '1' && // kill switch if it ever misbehaves
    (shouldEncrypt
      ? vaultStatus === 'unlocked' && !!page?.workspace && (!locked || !!decrypted)
      : true);
  const collabState = useCollab(page, collabEnabled, shouldEncrypt, collabNonce);
  // Yjs is the one editing model: a page is editable once its shared doc is bound
  // AND editing is safe right now (`editable`: the relay is synced, or we already
  // hold the page's content locally so offline edits merge back). The connect
  // window, a failed relay, and offline-on-a-page-we've-never-opened-here all fall
  // back to a read-only preview of the stored content, never a plain editable path,
  // so nothing can clobber the doc or edit a blank over real content. Viewers and an
  // encrypted-but-not-unlocked workspace stay read-only regardless.
  const canEditNow =
    editable &&
    !(wsEncrypted && vaultStatus !== 'unlocked') &&
    collabState.status === 'ready' &&
    collabState.editable;

  // Decrypt a locked page when the vault opens AND whenever the encrypted content
  // changes (an edit from another device). Skipped while you're editing here, so a
  // remote echo never clobbers what you're typing; your own optimistic content
  // stays until you blur.
  useEffect(() => {
    setDecryptFailed(false);
    if (!locked || vaultStatus !== 'unlocked' || !page) {
      setDecrypted(null);
      return;
    }
    if (editingRef.current) return;
    let alive = true;
    const env = page.content as string;
    void decryptForPage(page, env)
      .then((d) => {
        if (!alive) return;
        setDecrypted(d as object);
        setDecryptedFor(env); // which envelope this plaintext belongs to
      })
      .catch(() => alive && setDecryptFailed(true));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId, locked, vaultStatus, wsKeyReady, page?.content]);

  const toggleLock = async () => {
    if (vaultStatus !== 'unlocked') {
      openVault();
      return;
    }
    if (!page) return;
    if (locked) {
      try {
        const plain = await decryptForPage(page, page.content as string);
        setPageContent(pageId, plain as object);
        resetPageCollab(pageId); // drop the encrypted shared doc; it re-seeds plaintext
      } catch {
        toast('could not unlock this page', 'error');
      }
    } else {
      const plain = (page.content as object) ?? { type: 'doc', content: [] };
      const env = await encryptForPage(page, plain);
      if (env) {
        setDecrypted(plain); // seed so the editor doesn't flash empty
        setPageContent(pageId, env);
        // Scrub the plaintext shared doc so locking doesn't leave server-readable
        // content behind; the reconnecting encrypted session re-seeds from `env`.
        resetPageCollab(pageId);
      }
    }
  };

  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const setPageDefaultTab = useData((s) => s.setPageDefaultTab);

  // Collaboration cursors ride the same live collab session (when we can edit).
  const presenceCollab = collabState.status === 'ready' && canEditNow ? collabState.collab : null;
  // Widget-level carets: broadcast the specific thing I'm on within this tab, so
  // peers see me on that card/pin, not just the tab. A row drawer is global state
  // (openRowId); a sub-view (the map) reports its own target via setViewTarget.
  const openRowId = useData((s) => s.openRowId);
  const [viewTarget, setViewTarget] = useState<string | null>(null); // e.g. "pin:<id>" from PageMap
  useEffect(() => setViewTarget(null), [tab]); // a new tab is a new target space
  // Stable so PageMap's focus effect keys only on which pin is open, not identity.
  const focusPin = useCallback((id: string | null) => setViewTarget(id ? `pin:${id}` : null), []);
  const target = openRowId ? `row:${openRowId}` : viewTarget;
  const focus = target ? `${tab}:${target}` : tab;
  const others = usePresence(pageId, editing, { collab: presenceCollab, focus });

  // Group collaborators by the element (row/pin) they're on, so each view can
  // drop their avatars onto it. focus is "tab:kind:id"; we key by "kind:id".
  const targetPresence = useMemo(() => {
    const m = new Map<string, PresenceRecord[]>();
    for (const o of others) {
      const parts = (o.focus || '').split(':');
      if (parts.length < 3) continue;
      const key = `${parts[1]}:${parts.slice(2).join(':')}`; // kind:id
      const arr = m.get(key) ?? [];
      arr.push(o);
      m.set(key, arr);
    }
    return m;
  }, [others]);
  // Per-kind views: rowId -> people, pinId -> people.
  const rowPresence = useMemo(() => {
    const m = new Map<string, PresenceRecord[]>();
    for (const [k, v] of targetPresence) if (k.startsWith('row:')) m.set(k.slice(4), v);
    return m;
  }, [targetPresence]);
  const pinPresence = useMemo(() => {
    const m = new Map<string, PresenceRecord[]>();
    for (const [k, v] of targetPresence) if (k.startsWith('pin:')) m.set(k.slice(4), v);
    return m;
  }, [targetPresence]);
  const nodePresence = useMemo(() => {
    const m = new Map<string, PresenceRecord[]>();
    for (const [k, v] of targetPresence) if (k.startsWith('node:')) m.set(k.slice(5), v);
    return m;
  }, [targetPresence]);
  const focusNode = useCallback((id: string | null) => setViewTarget(id ? `node:${id}` : null), []);

  useEffect(() => {
    if (pendingCommentsPage === pageId) {
      setShowComments(true);
      clearPendingComments();
    }
  }, [pendingCommentsPage, pageId, clearPendingComments]);

  useEffect(() => {
    if (pendingPageTab && pendingPageTab.pageId === pageId) {
      selectTab(pendingPageTab.tab);
      clearPendingPageTab();
    }
  }, [pendingPageTab, pageId, clearPendingPageTab]);

  if (!page) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-ochre-wash text-ochre dark:bg-ochre/15 dark:text-ochre-soft">
          <MapIcon className="h-5 w-5" />
        </div>
        <p className="text-sm text-ink-faint dark:text-coal-soft">Pick a page from the sidebar to start planning.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 px-3 pt-3 sm:px-8 sm:pt-4">
          {(() => {
            const primary = TAB_DEFS.slice(0, PRIMARY_COUNT);
            const overflow = TAB_DEFS.slice(PRIMARY_COUNT);
            // The active tab always shows inline, even if it lives in "More".
            const inline = primary.some(([k]) => k === tab) ? primary : [...primary, ...overflow.filter(([k]) => k === tab)];
            const overflowActive = overflow.some(([k]) => k === tab);
            const renderTab = ([key, label, Icon]: readonly [PageTab, string, typeof FileText]) => {
              const onTab = others.filter((o) => (o.focus || 'notes').split(':')[0] === key);
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => selectTab(key)}
                  aria-pressed={tab === key}
                  className={[
                    'relative flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-sm transition-colors',
                    tab === key ? 'bg-paper text-ink shadow-sm dark:bg-coal-panel dark:text-coal-text' : 'text-ink-soft hover:text-ink dark:text-coal-soft dark:hover:text-coal-text',
                  ].join(' ')}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{label}</span>
                  {onTab.length > 0 && (
                    <span className="absolute -right-0.5 -top-1 flex -space-x-1">
                      {onTab.slice(0, 3).map((o) => (
                        <span key={o.user} title={`${o.userName}${o.mode === 'editing' ? ' is editing' : ' is on'} ${label}`} className={['h-2.5 w-2.5 rounded-full border border-paper dark:border-coal-panel', o.mode === 'editing' ? 'ring-1 ring-clay' : ''].join(' ')} style={{ backgroundColor: avatarColor(o.user) }} />
                      ))}
                    </span>
                  )}
                </button>
              );
            };
            const isDefault = isPageTab(page?.defaultTab) && page!.defaultTab === tab;
            return (
              <div className="flex min-w-0 items-center gap-0.5 rounded-lg border border-paper-line bg-paper-panel/40 p-0.5 dark:border-coal-line dark:bg-coal-line/40">
                {inline.map(renderTab)}
                {overflow.length > 0 && (
                  <>
                    <button
                      ref={moreRef}
                      type="button"
                      onClick={() => setMoreOpen((o) => !o)}
                      className={['flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-sm', overflowActive ? 'text-ink dark:text-coal-text' : 'text-ink-soft hover:text-ink dark:text-coal-soft dark:hover:text-coal-text'].join(' ')}
                      title="More views"
                    >
                      <MoreHorizontal className="h-3.5 w-3.5" />
                      <ChevronDown className="h-3 w-3" />
                    </button>
                    <Popover open={moreOpen} onClose={() => setMoreOpen(false)} anchorRef={moreRef} width={180} align="right">
                      {overflow.map(([key, label, Icon]) => (
                        <button key={key} type="button" onClick={() => { selectTab(key); setMoreOpen(false); }} className={['flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm', tab === key ? 'bg-clay-wash text-clay dark:bg-clay/20 dark:text-clay-soft' : 'text-ink hover:bg-paper-panel dark:text-coal-text dark:hover:bg-coal-line'].join(' ')}>
                          <Icon className="h-4 w-4 text-ink-faint dark:text-coal-soft" /> {label}
                        </button>
                      ))}
                    </Popover>
                  </>
                )}
                {editable && (
                  <button
                    type="button"
                    onClick={() => setPageDefaultTab(pageId, isDefault ? '' : tab)}
                    className={['ml-0.5 flex shrink-0 items-center rounded-md p-1', isDefault ? 'text-clay' : 'text-ink-faint hover:text-clay dark:text-coal-soft'].join(' ')}
                    title={isDefault ? 'This tab opens by default for everyone on this page. Click to unset.' : 'Make this the default tab everyone lands on for this page'}
                  >
                    <Pin className={['h-3.5 w-3.5', isDefault ? 'fill-current' : ''].join(' ')} />
                  </button>
                )}
              </div>
            );
          })()}
          <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5 sm:gap-3">
            <PresenceBar others={others} />
            {!editable && (
              <span className="rounded-md bg-paper-panel px-2 py-1 text-xs text-ink-faint dark:bg-coal-line dark:text-coal-soft">
                Read-only
              </span>
            )}
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((o) => !o)}
                className="flex items-center rounded-lg border border-paper-line px-2 py-1.5 text-ink-soft transition-colors hover:bg-paper-panel dark:border-coal-line dark:text-coal-soft dark:hover:bg-coal-line"
                title="More"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-20" onMouseDown={() => setMenuOpen(false)} />
                  <div className="absolute right-0 top-full z-30 mt-1 w-52 rounded-lg border border-paper-line bg-paper p-1 shadow-xl dark:border-coal-line dark:bg-coal-panel">
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        void duplicatePage(pageId).then((id) => id && setActivePage(id));
                      }}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink hover:bg-paper-panel dark:text-coal-text dark:hover:bg-coal-line"
                    >
                      <Copy className="h-4 w-4 text-ink-faint dark:text-coal-soft" /> Duplicate
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        const { pages, tables, rows } = useData.getState();
                        printHtml(buildPrintHtml(pageId, { pages, tables, rows }));
                      }}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink hover:bg-paper-panel dark:text-coal-text dark:hover:bg-coal-line"
                    >
                      <Printer className="h-4 w-4 text-ink-faint dark:text-coal-soft" /> Print / PDF
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        const { pages, tables, rows } = useData.getState();
                        // This page AND everything under it, with a cover and contents.
                        // The one backup that survives a dead phone and a blocked domain.
                        printHtml(buildBookletHtml(pageId, { pages, tables, rows }, new Date().toLocaleDateString()));
                      }}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink hover:bg-paper-panel dark:text-coal-text dark:hover:bg-coal-line"
                    >
                      <BookOpen className="h-4 w-4 text-ink-faint dark:text-coal-soft" /> Print as booklet
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        void exportMarkdown();
                      }}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink hover:bg-paper-panel dark:text-coal-text dark:hover:bg-coal-line"
                    >
                      <FileText className="h-4 w-4 text-ink-faint dark:text-coal-soft" /> Export as Markdown
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        exportIcs();
                      }}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink hover:bg-paper-panel dark:text-coal-text dark:hover:bg-coal-line"
                    >
                      <CalendarDays className="h-4 w-4 text-ink-faint dark:text-coal-soft" /> Export dates (.ics)
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        setHistoryOpen(true);
                      }}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink hover:bg-paper-panel dark:text-coal-text dark:hover:bg-coal-line"
                    >
                      <History className="h-4 w-4 text-ink-faint dark:text-coal-soft" /> Version history
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPageTemplate(pageId, !page.template);
                        setMenuOpen(false);
                      }}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink hover:bg-paper-panel dark:text-coal-text dark:hover:bg-coal-line"
                    >
                      {page.template ? (
                        <>
                          <BookmarkCheck className="h-4 w-4 text-clay" /> Remove from templates
                        </>
                      ) : (
                        <>
                          <Bookmark className="h-4 w-4 text-ink-faint dark:text-coal-soft" /> Save as template
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        void toggleLock();
                      }}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink hover:bg-paper-panel dark:text-coal-text dark:hover:bg-coal-line"
                    >
                      {locked ? (
                        <>
                          <Unlock className="h-4 w-4 text-clay" /> Decrypt page
                        </>
                      ) : (
                        <>
                          <Lock className="h-4 w-4 text-ink-faint dark:text-coal-soft" /> Lock page (private)
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        setConvertOpen(true);
                      }}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink hover:bg-paper-panel dark:text-coal-text dark:hover:bg-coal-line"
                    >
                      <Boxes className="h-4 w-4 text-ink-faint dark:text-coal-soft" /> Turn into workspace
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        openMove();
                      }}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink hover:bg-paper-panel dark:text-coal-text dark:hover:bg-coal-line"
                    >
                      <FolderInput className="h-4 w-4 text-ink-faint dark:text-coal-soft" /> Move to workspace
                    </button>
                  </div>
                </>
              )}
            </div>
            <button
              type="button"
              onClick={() => setShareOpen(true)}
              className="flex items-center gap-1.5 rounded-lg border border-paper-line px-2.5 py-1.5 text-sm text-ink-soft transition-colors hover:bg-paper-panel dark:border-coal-line dark:text-coal-soft dark:hover:bg-coal-line"
              title="Share"
            >
              {page.visibility === 'private' ? <Lock className="h-4 w-4" /> : <Globe className="h-4 w-4" />}
              <span className="hidden sm:inline">Share</span>
            </button>
            <button
              type="button"
              onClick={() => setShowComments((s) => !s)}
              className={[
                'flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm transition-colors',
                showComments
                  ? 'border-clay bg-clay-wash text-clay dark:border-clay dark:bg-clay/20 dark:text-clay-soft'
                  : 'border-paper-line text-ink-soft hover:bg-paper-panel dark:border-coal-line dark:text-coal-soft dark:hover:bg-coal-line',
              ].join(' ')}
            >
              <MessageSquare className="h-4 w-4" />
              <span className="hidden sm:inline">Comments</span>
            </button>
          </div>
        </div>

        {tab === 'itinerary' ? (
          <div className="min-h-0 flex-1">
            <ItineraryTab pageId={pageId} presence={rowPresence} body={decrypted} />
          </div>
        ) : tab === 'calendar' ? (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <CalendarTab pageId={pageId} presence={rowPresence} body={decrypted} />
          </div>
        ) : tab === 'budget' ? (
          <div className="min-h-0 flex-1">
            <BudgetTab pageId={pageId} body={decrypted} />
          </div>
        ) : tab === 'currency' ? (
          <div className="min-h-0 flex-1">
            <CurrencyTab pageId={pageId} editable={editable} />
          </div>
        ) : tab === 'moodboard' ? (
          <div className="min-h-0 flex-1">
            <MoodboardTab pageId={pageId} body={decrypted} />
          </div>
        ) : tab === 'people' ? (
          <div className="min-h-0 flex-1">
            <PeopleTab pageId={pageId} body={decrypted} />
          </div>
        ) : tab === 'weather' ? (
          <div className="min-h-0 flex-1">
            <WeatherTab pageId={pageId} editable={editable} body={decrypted} />
          </div>
        ) : tab === 'files' ? (
          <div className="min-h-0 flex-1">
            <FilesTab pageId={pageId} editable={editable} body={decrypted} />
          </div>
        ) : tab === 'photos' ? (
          <div className="min-h-0 flex-1">
            <PhotosTab pageId={pageId} editable={editable} body={decrypted} />
          </div>
        ) : tab === 'kanban' ? (
          <div className="min-h-0 flex-1 py-3">
            <KanbanView pageId={pageId} editable={editable} presence={rowPresence} />
          </div>
        ) : tab === 'tierlist' ? (
          <div className="min-h-0 flex-1">
            <TierListTab pageId={pageId} editable={editable} />
          </div>
        ) : tab === 'sheet' ? (
          <div className="min-h-0 flex-1">
            <SheetTab pageId={pageId} editable={editable} />
          </div>
        ) : tab === 'cards' ? (
          <div className="min-h-0 flex-1">
            <FlashcardsTab pageId={pageId} editable={editable} />
          </div>
        ) : tab === 'rota' ? (
          <div className="min-h-0 flex-1">
            <RotaTab pageId={pageId} editable={editable} />
          </div>
        ) : tab === 'bracket' ? (
          <div className="min-h-0 flex-1">
            <BracketTab pageId={pageId} editable={editable} />
          </div>
        ) : tab === 'map' ? (
          <div className="min-h-0 flex-1">
            <PageMap pageId={pageId} presence={pinPresence} onFocusPin={focusPin} body={decrypted} />
          </div>
        ) : tab === 'mindmap' ? (
          <div className="min-h-0 flex-1">
            <MindmapView pageId={pageId} presence={nodePresence} onFocusNode={focusNode} />
          </div>
        ) : tab === 'links' ? (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <LinksGraph pageId={pageId} />
          </div>
        ) : tab === 'flow' ? (
          <div className="min-h-0 flex-1">
            <FlowView pageId={pageId} />
          </div>
        ) : (
          <div className="group/page flex-1 overflow-y-auto">
            <CoverBand cover={page.cover} editable={editable} onChange={(c) => setPageCover(pageId, c)} />
          <div className={`mx-auto max-w-[77rem] px-4 pb-24 sm:px-8 ${page.cover ? 'pt-0' : 'pt-6'}`}>
            <div className={`relative mb-2 flex items-center gap-3 ${page.cover ? '-mt-8' : ''}`}>
              <button
                type="button"
                onClick={() => editable && setEmojiOpen((o) => !o)}
                disabled={!editable}
                className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-paper text-6xl leading-none shadow-sm hover:bg-paper-panel disabled:hover:bg-paper md:h-[6.5rem] md:w-[6.5rem] md:text-7xl dark:bg-coal-panel dark:hover:bg-coal-line"
                title="Change icon"
              >
                {page.icon ? (
                  isImageIcon(page.icon) ? (
                    <img src={page.icon.trim()} alt="" className="h-full w-full object-contain" />
                  ) : (
                    page.icon
                  )
                ) : (
                  <Smile className="h-9 w-9 text-ink-faint md:h-12 md:w-12" />
                )}
              </button>
              {emojiOpen && editable && (
                <div className="absolute left-0 top-full z-30 mt-1 rounded-lg border border-paper-line bg-paper p-2 shadow-xl dark:border-coal-line dark:bg-coal-panel">
                  <EmojiPicker
                    onSelect={(em) => {
                      setPageIcon(pageId, em);
                      setEmojiOpen(false);
                    }}
                  />
                  <label className="mt-1.5 flex w-full cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-left text-xs text-ink-soft hover:bg-paper-panel dark:text-coal-soft dark:hover:bg-coal-line">
                    <ImageIcon className="h-3.5 w-3.5" /> Upload an image
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        try {
                          const url = (await uploadsApi.upload(file)) ?? (await processImageFile(file));
                          if (url) setPageIcon(pageId, url);
                        } catch {
                          /* ignore a bad image */
                        }
                        setEmojiOpen(false);
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setPageIcon(pageId, '');
                      setEmojiOpen(false);
                    }}
                    className="mt-0.5 w-full rounded px-2 py-1 text-left text-xs text-ink-faint hover:bg-paper-panel dark:text-coal-soft dark:hover:bg-coal-line"
                  >
                    Remove icon
                  </button>
                </div>
              )}
              {editable && !page.cover && (
                <button
                  type="button"
                  onClick={() => setPageCover(pageId, 'g1')}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-ink-faint opacity-0 transition-opacity hover:bg-paper-panel hover:text-ink group-hover/page:opacity-100 touch-visible dark:hover:bg-coal-line"
                  title="Add cover"
                >
                  <ImageIcon className="h-3.5 w-3.5" /> Add cover
                </button>
              )}
            </div>

            <input
              value={isEnvelope(page.title) ? '' : page.title}
              onChange={(e) => renamePage(pageId, e.target.value)}
              readOnly={!editable || (wsEncrypted && vaultStatus !== 'unlocked')}
              placeholder={isEnvelope(page.title) ? '🔒 Locked' : 'Untitled'}
              className="mb-4 w-full max-w-3xl bg-transparent font-display text-3xl font-bold text-ink outline-none placeholder:text-ink-faint/50 dark:text-coal-text sm:text-4xl"
            />

            {locked && !vaultReady ? (
              <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-sm text-ink-faint dark:text-coal-soft">
                unlocking…
              </div>
            ) : locked && vaultStatus !== 'unlocked' ? (
              <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-paper-line py-16 text-center dark:border-coal-line">
                <Lock className="h-6 w-6 text-clay" />
                <p className="text-sm text-ink-soft dark:text-coal-soft">this page is locked.</p>
                <button
                  type="button"
                  onClick={() => openVault()}
                  className="rounded-lg bg-clay px-4 py-2 text-sm font-semibold text-white hover:bg-clay-soft"
                >
                  unlock to read
                </button>
              </div>
            ) : locked && decryptFailed ? (
              <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-paper-line py-16 text-center dark:border-coal-line">
                <Lock className="h-6 w-6 text-ink-faint" />
                <p className="max-w-sm text-sm text-ink-soft dark:text-coal-soft">
                  this page is encrypted and couldn't be opened with your key. it belongs to whoever locked it.
                </p>
              </div>
            ) : locked && !decrypted ? (
              // Locked, vault open, decrypt still in flight (or it returned
              // nothing). Never fall through to the editor here: it would mount
              // empty, and an empty save would encrypt over content we haven't
              // read yet. Show a placeholder and let the decrypt effect resolve.
              <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-sm text-ink-faint dark:text-coal-soft">
                decrypting…
              </div>
            ) : (
              <>
                {wsEncrypted && !locked && vaultStatus !== 'unlocked' && editable && (
                  <div className="mb-3 flex items-center gap-2 rounded-lg border border-paper-line bg-paper-panel/50 px-3 py-2 text-xs text-ink-soft dark:border-coal-line dark:bg-coal-line/40 dark:text-coal-soft">
                    <Lock className="h-3.5 w-3.5 text-clay" />
                    <span className="flex-1">this workspace is encrypted, unlock to edit.</span>
                    <button
                      type="button"
                      onClick={() => openVault()}
                      className="rounded-md bg-clay px-2 py-1 text-[11px] font-semibold text-white hover:bg-clay-soft"
                    >
                      unlock
                    </button>
                  </div>
                )}
                {editable && collabEnabled && !canEditNow && (
                  // The doc is binding, the relay is retrying, or we're offline on a
                  // page we haven't opened here before: the content below is a
                  // read-only preview until editing is safe.
                  <div className="mb-2 flex items-center gap-1.5 text-[11px] text-ink-faint dark:text-coal-soft">
                    <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-clay" />
                    {collabState.status === 'failed' ? 'reconnecting to the live session…' : 'connecting to the live session…'}
                  </div>
                )}
                <Editor
                  // The nonce is part of the key on purpose. useCollab reconnects to
                  // a FRESH doc after an out-of-editor write, but Editor builds its
                  // Yjs binding once (useEditor with no deps), so swapping the
                  // `collab` prop alone leaves it bound to the old document and the
                  // change still would not show until a reload. Remounting rebinds it.
                  key={`${pageId}:${canEditNow ? 'collab' : 'ro'}:${collabNonce}`}
                  collab={canEditNow ? collabState.collab : null}
                  collabSeed={canEditNow ? collabState.needsSeed : false}
                  content={locked ? decrypted : ((page.content as object) ?? null)}
                  editable={canEditNow}
                  onChange={(json) => {
                    if (shouldEncrypt) {
                      // Safety net against data loss: if the page is locked but we
                      // never decrypted it, do not let any edit (especially an
                      // empty reset) overwrite the ciphertext we can't read.
                      if (locked && !decrypted) return;
                      // And never cipher an empty doc over real content: the store
                      // guard can't see through the envelope to catch this, but here
                      // we hold the plaintext, so refuse a spurious empty (a collab
                      // doc mounting before it seeds) that would blank the page.
                      if (isEmptyDoc(json) && decrypted && !isEmptyDoc(decrypted)) return;
                      void encryptForPage(page, json).then((env) => {
                        if (env) {
                          // setPageContent stores the opaque envelope, so it can't
                          // scan for checkbox toggles, fire those flows here from
                          // the plaintext (prev decrypted -> new json).
                          firePageCheckboxFlows(pageId, decrypted, json);
                          setDecrypted(json); // seed it so the flip to the locked view does not blank
                          setPageContent(pageId, env);
                        }
                      });
                    } else {
                      setPageContent(pageId, json);
                    }
                  }}
                  onFocusChange={onEditingChange}
                  focusText={pendingFocus?.pageId === pageId ? pendingFocus.text : ''}
                  onFocusConsumed={clearFocus}
                  pageId={pageId}
                  restore={restoreDoc}
                  onRestoreConsumed={() => setRestoreDoc(null)}
                />
                {/* Who touched this last, and how much there is to read. Two people
                    sharing a plan ask "did you change this?" constantly, and the
                    answer was only ever in version history. */}
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-paper-line pt-2 text-[11px] text-ink-faint dark:border-coal-line dark:text-coal-soft">
                  <span>Edited {relativeTime(page.updated)}</span>
                  {lastEditor && (
                    <span className="flex items-center gap-1">
                      by
                      <span
                        className="flex h-3.5 w-3.5 items-center justify-center rounded-full text-[7px] font-semibold text-white"
                        style={{ backgroundColor: avatarColor(lastEditor.id) }}
                      >
                        {initials(lastEditor.name)}
                      </span>
                      {lastEditor.name}
                    </span>
                  )}
                  {readStats.words > 0 && (
                    <span>
                      {readStats.words.toLocaleString()} words &middot; {readStats.minutes} min read
                    </span>
                  )}
                </div>
                <BacklinksStrip pageId={pageId} />
              </>
            )}
          </div>
          </div>
        )}
      </div>

      {showComments && (
        <>
          {/* Phone: slide the rail over the page with a tap-to-close backdrop. */}
          <div
            className="fixed inset-0 z-[120] bg-coal/30 backdrop-blur-sm md:hidden"
            onClick={() => setShowComments(false)}
            aria-hidden
          />
          <aside className="fixed inset-y-0 right-0 z-[120] w-[92%] max-w-sm border-l border-paper-line bg-paper shadow-2xl dark:border-coal-line dark:bg-coal-panel md:relative md:inset-auto md:z-auto md:w-80 md:max-w-none md:shadow-none md:bg-paper-panel/30 md:dark:bg-coal/30">
            <CommentsPanel pageId={pageId} onClose={() => setShowComments(false)} />
          </aside>
        </>
      )}

      <SharePanel pageId={pageId} open={shareOpen} onClose={() => setShareOpen(false)} />
      <VersionHistory pageId={pageId} open={historyOpen} onClose={() => setHistoryOpen(false)} onRestore={handleRestore} />

      {convertOpen && (
        <div
          className="fixed inset-0 z-[1200] flex items-center justify-center bg-ink/40 p-4"
          onMouseDown={() => !converting && setConvertOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-paper-line bg-paper p-4 shadow-2xl dark:border-coal-line dark:bg-coal-panel"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-ink dark:text-coal-text">
              <Boxes className="h-4 w-4 text-clay" /> turn this page into its own workspace
            </h3>
            <p className="mb-2 text-xs text-ink-soft dark:text-coal-soft">
              this page and every sub-page under it (with their tables and rows) move into a
              new top-level workspace.
            </p>
            <p className="mb-2 text-xs text-ink-soft dark:text-coal-soft">
              links and relations to this page and its sub-pages from other pages in this
              workspace will be disconnected.
              {sourceShared && ' other members of this workspace lose access to the moved pages.'}
              {wsEncrypted && ' the moved content is re-encrypted under the new workspace’s key.'}
            </p>
            <p className="mb-3 text-xs text-ink-faint dark:text-coal-soft">
              you can revert this straight after.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={converting}
                onClick={() => setConvertOpen(false)}
                className="rounded-lg border border-paper-line px-3 py-1.5 text-sm text-ink-soft disabled:opacity-50 dark:border-coal-line dark:text-coal-soft"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={converting}
                onClick={() => void runConvert()}
                className="rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-60"
              >
                {converting ? 'moving…' : 'Yes, move it'}
              </button>
            </div>
          </div>
        </div>
      )}

      {moveOpen && (
        <div
          className="fixed inset-0 z-[1200] flex items-center justify-center bg-ink/40 p-4"
          onMouseDown={() => !moving && setMoveOpen(false)}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-md flex-col rounded-xl border border-paper-line bg-paper p-4 shadow-2xl dark:border-coal-line dark:bg-coal-panel"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-ink dark:text-coal-text">
              <FolderInput className="h-4 w-4 text-clay" /> move this page to another workspace
            </h3>
            {otherWorkspaces.length === 0 ? (
              <>
                <p className="mb-3 text-xs text-ink-soft dark:text-coal-soft">
                  you only have this workspace, so there&rsquo;s nowhere to move it yet.
                </p>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setMoveOpen(false)}
                    className="rounded-lg border border-paper-line px-3 py-1.5 text-sm text-ink-soft dark:border-coal-line dark:text-coal-soft"
                  >
                    Close
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="mb-2 text-xs text-ink-soft dark:text-coal-soft">
                  this page and every sub-page (with their tables and rows) moves. links and relations to it
                  from other pages will disconnect. reversible right after.
                </p>
                <div className="mb-2">
                  <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-ink-faint dark:text-coal-soft">workspace</div>
                  <div className="flex flex-wrap gap-1.5">
                    {otherWorkspaces.map((w) => (
                      <button
                        key={w.id}
                        type="button"
                        onClick={() => {
                          setMoveTargetWs(w.id);
                          setMoveParent('');
                        }}
                        className={[
                          'rounded-lg border px-2.5 py-1 text-sm',
                          moveTargetWs === w.id
                            ? 'border-clay bg-clay-wash text-clay dark:bg-clay/20'
                            : 'border-paper-line text-ink hover:bg-paper-panel dark:border-coal-line dark:text-coal-text dark:hover:bg-coal-line',
                        ].join(' ')}
                      >
                        <span className="mr-1">{isImageIcon(w.icon) ? '🗂️' : w.icon || '🗺️'}</span>
                        {w.name || 'Workspace'}
                      </button>
                    ))}
                  </div>
                </div>
                {moveTargetWs && (
                  <div className="mb-2 flex min-h-0 flex-1 flex-col overflow-hidden">
                    <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-ink-faint dark:text-coal-soft">nest under</div>
                    <input
                      value={moveQuery}
                      onChange={(e) => setMoveQuery(e.target.value)}
                      placeholder="search a page, or leave at top level"
                      className="mb-1.5 w-full rounded-md border border-paper-line bg-paper px-2 py-1 text-sm text-ink outline-none focus:border-clay dark:border-coal-line dark:bg-coal dark:text-coal-text"
                    />
                    <div className="max-h-48 overflow-y-auto">
                      <button
                        type="button"
                        onClick={() => setMoveParent('')}
                        className={[
                          'flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm',
                          moveParent === '' ? 'bg-clay-wash text-clay dark:bg-clay/20' : 'text-ink hover:bg-paper-panel dark:text-coal-text dark:hover:bg-coal-line',
                        ].join(' ')}
                      >
                        Top level
                      </button>
                      {targetPages.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => setMoveParent(p.id)}
                          className={[
                            'flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm',
                            moveParent === p.id ? 'bg-clay-wash text-clay dark:bg-clay/20' : 'text-ink hover:bg-paper-panel dark:text-coal-text dark:hover:bg-coal-line',
                          ].join(' ')}
                        >
                          <span className="shrink-0">{isImageIcon(p.icon) ? '📄' : p.icon || '📄'}</span>
                          <span className="min-w-0 flex-1 truncate">{displayTitle(p.title) || 'Untitled'}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="mt-2 flex justify-end gap-2">
                  <button
                    type="button"
                    disabled={moving}
                    onClick={() => setMoveOpen(false)}
                    className="rounded-lg border border-paper-line px-3 py-1.5 text-sm text-ink-soft disabled:opacity-50 dark:border-coal-line dark:text-coal-soft"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={moving || !moveTargetWs}
                    onClick={() => void runMove()}
                    className="rounded-lg bg-clay px-3 py-1.5 text-sm font-medium text-white hover:bg-clay/90 disabled:opacity-50"
                  >
                    {moving ? 'moving…' : 'Move here'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// --- Cover band -------------------------------------------------------------

function CoverBand({ cover, editable, onChange }: { cover: string; editable: boolean; onChange: (c: string) => void }) {
  const [menu, setMenu] = useState(false);
  const [url, setUrl] = useState('');
  const [err, setErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const onPick = (file: File | undefined) => {
    if (!file) return;
    setErr('');
    // Upload to a short URL so the cover fits the field and syncs to everyone; a
    // base64 cover overflowed the field and only ever lived in localStorage. Falls
    // back to the inline image when the uploads collection isn't set up.
    void (async () => {
      try {
        const uploaded = await uploadsApi.upload(file);
        onChange(uploaded ?? (await processImageFile(file)));
        setMenu(false);
      } catch (e) {
        setErr(e instanceof ImageTooLargeError ? e.message : 'Could not read that image.');
      }
    })();
  };

  if (!cover) return null;
  return (
    <div className="relative h-44 w-full md:h-60" style={coverStyle(cover)}>
      {editable && (
        <div className="absolute bottom-2 right-3 flex items-center gap-1.5 opacity-0 transition-opacity group-hover/page:opacity-100">
          <button
            type="button"
            onClick={() => setMenu((m) => !m)}
            className="rounded-md bg-black/40 px-2 py-1 text-xs font-medium text-white backdrop-blur hover:bg-black/55"
          >
            Change cover
          </button>
          <button
            type="button"
            onClick={() => onChange('')}
            className="rounded-md bg-black/40 p-1 text-white backdrop-blur hover:bg-black/55"
            title="Remove cover"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      {menu && editable && (
        <div className="absolute bottom-12 right-3 z-30 w-64 rounded-lg border border-paper-line bg-paper p-2 shadow-xl dark:border-coal-line dark:bg-coal-panel">
          <div className="mb-2 grid grid-cols-6 gap-1">
            {GRADIENT_KEYS.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => {
                  onChange(k);
                  setMenu(false);
                }}
                className="h-7 rounded"
                style={{ backgroundImage: COVER_GRADIENTS[k] }}
                title={k}
              />
            ))}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => onPick(e.target.files?.[0])}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="mb-1.5 flex w-full items-center justify-center gap-1.5 rounded-md border border-paper-line py-1.5 text-xs font-medium text-ink-soft hover:bg-paper-panel dark:border-coal-line dark:text-coal-soft dark:hover:bg-coal-line"
          >
            <Upload className="h-3.5 w-3.5" /> Upload image
          </button>
          {err && <p className="mb-1.5 text-[11px] text-red-500">{err}</p>}
          <div className="flex items-center gap-1">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="…or paste image URL"
              className="min-w-0 flex-1 rounded-md border border-paper-line bg-paper px-2 py-1 text-xs text-ink outline-none dark:border-coal-line dark:bg-coal dark:text-coal-text"
            />
            <button
              type="button"
              onClick={() => {
                if (url.trim()) {
                  onChange(url.trim());
                  setMenu(false);
                  setUrl('');
                }
              }}
              className="rounded-md bg-clay px-2 py-1 text-xs font-medium text-white hover:bg-clay/90"
            >
              Set
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
