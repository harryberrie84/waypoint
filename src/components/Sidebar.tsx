import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronRight, ChevronDown, ChevronsUpDown, Plus, FileText, Trash2, BookOpen, Lock, Users2, Check, Star, Home, Pencil } from 'lucide-react';
import { useData, selectChildren, selectTopLevel, selectTemplates, selectWorkspacePages } from '../store/useData';
import { selectUnfiledPages } from '../lib/pageTree';
import { useWorkspace } from '../store/useWorkspace';
import { displayTitle } from '../lib/crypto';
import { isImageIcon } from '../lib/pageIcon';
import { loadLanding, saveLanding, LANDING_EVENT } from '../lib/landing';
import { PageIcon } from './PageIcon';
import { PagePresence } from './PagePresence';
import { jumpToPresence } from '../lib/jumpTo';
import { useWorkspacePresence } from '../hooks/usePresence';
import type { Page, Workspace, PresenceRecord } from '../types';

// A non-empty, non-workspace id for the Home state: no page matches it, so the
// tree is empty (an empty/falsy id makes selectWorkspacePages return everything).
const HOME_WS = '__home__';

// Render a page icon as a small image when it's an uploaded URL, else the emoji.
function pageIconNode(icon: string | undefined, fallback: ReactNode): ReactNode {
  if (isImageIcon(icon)) return <img src={icon} alt="" className="h-4 w-4 rounded object-contain" />;
  return icon || fallback;
}

// Drop focus after a *mouse* click so a stray spacebar (people tap it to scroll)
// doesn't re-fire the button, e.g. clicking "+" then hitting space would
// otherwise add a second blank page. Keyboard activation (detail 0) keeps focus.
const blurOnMouse = (e: React.MouseEvent<HTMLElement>) => {
  if (e.detail > 0) e.currentTarget.blur();
};

// Pinned pages are a per-device convenience (which pages you star on this phone),
// kept in localStorage, no schema field, no sync, nothing to break.
const PIN_KEY = 'waypoint:pinned';
function loadPins(): Set<string> {
  try {
    const raw = localStorage.getItem(PIN_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}
function savePins(pins: Set<string>) {
  try {
    localStorage.setItem(PIN_KEY, JSON.stringify([...pins]));
  } catch {
    /* private-mode storage; pins just stay in memory this session */
  }
}

// ---------------------------------------------------------------------------
// Sidebar, infinite nested page tree with drag-and-drop reordering/move.
// ---------------------------------------------------------------------------
// Drag a page onto another to nest it under that target; the store rejects
// illegal moves (dropping a page into its own descendant). HTML5 DnD keeps the
// dependency surface at zero beyond what we already have.

export function Sidebar() {
  const pages = useData((s) => s.pages);
  const createPage = useData((s) => s.createPage);
  const duplicatePage = useData((s) => s.duplicatePage);
  const movePage = useData((s) => s.movePage);
  const setActivePage = useData((s) => s.setActivePage);
  const activePageId = useData((s) => s.activePageId);
  const activeWorkspaceId = useWorkspace((s) => s.activeWorkspaceId);
  const defaultWorkspaceId = useWorkspace((s) => s.defaultWorkspaceId);
  const setActiveWorkspace = useWorkspace((s) => s.setActiveWorkspace);

  // Home is a place above the workspaces: opening it selects no workspace (a
  // sentinel, so selectWorkspacePages returns nothing rather than everything) and
  // shows the cross-workspace landing surface with an empty tree.
  const onHome = activeWorkspaceId === HOME_WS;
  const goHome = () => {
    setActivePage(null);
    setActiveWorkspace(HOME_WS);
  };

  // Only the active workspace's pages feed the tree (legacy empty-workspace
  // pages fall into the default bucket). Children resolve from the full store,
  // they share their parent's workspace.
  const scoped = selectWorkspacePages(pages, activeWorkspaceId, defaultWorkspaceId);
  const roots = selectTopLevel(scoped);
  // Pages that belong here but render nowhere (their parent is missing / trashed /
  // in another workspace), e.g. after a Notion import or a half-finished workspace
  // move. Surfaced below the tree so they can be re-filed instead of being lost.
  const unfiled = selectUnfiledPages(pages, activeWorkspaceId, defaultWorkspaceId);
  const templates = selectTemplates(scoped);
  const [tplOpen, setTplOpen] = useState(false);

  // Who's on each page right now, so their avatars show beside it in the tree.
  const presence = useWorkspacePresence();
  const [pins, setPins] = useState<Set<string>>(() => loadPins());
  const togglePin = (id: string) =>
    setPins((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      savePins(next);
      return next;
    });
  const pinnedPages = [...pins].map((id) => scoped[id]).filter((p): p is Page => !!p && !p.trashed);

  // The per-workspace "home" page: land here when you switch into this workspace.
  // Kept in state (mirrors localStorage) so the tree re-renders when it changes.
  const [landingId, setLandingId] = useState<string | null>(() => loadLanding(activeWorkspaceId));
  useEffect(() => {
    setLandingId(loadLanding(activeWorkspaceId));
    // Keep in sync when the home page is changed elsewhere (workspace settings).
    const onChange = () => setLandingId(loadLanding(activeWorkspaceId));
    window.addEventListener(LANDING_EVENT, onChange);
    return () => window.removeEventListener(LANDING_EVENT, onChange);
  }, [activeWorkspaceId]);
  const toggleLanding = (id: string) => {
    const next = landingId === id ? null : id; // click the current home again to clear it
    saveLanding(activeWorkspaceId, next);
    setLandingId(next);
  };

  // If the active page isn't in the active workspace (e.g. after a switch), drop
  // into that workspace's chosen home page, else its first page, so the main view
  // isn't stranded. A refresh keeps its restored page (it stays in `scoped`, so
  // this returns early), so last-visited wins over home on reload, home on switch.
  useEffect(() => {
    if (activePageId && scoped[activePageId]) return;
    const home = loadLanding(activeWorkspaceId);
    const target = home && scoped[home] && !scoped[home].trashed ? home : roots[0]?.id ?? null;
    setActivePage(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspaceId]);

  return (
    <nav className="flex h-full flex-col">
      <button
        type="button"
        onClick={goHome}
        className={[
          'mx-3 mb-1 mt-2 flex items-center gap-1.5 rounded-md py-1.5 pl-2 pr-1 text-sm transition-colors',
          activePageId === null
            ? 'bg-clay-wash text-clay dark:bg-clay/20 dark:text-clay-soft'
            : 'text-ink-soft hover:bg-paper-panel dark:text-coal-soft dark:hover:bg-coal-line',
        ].join(' ')}
      >
        <Home className="h-4 w-4 shrink-0" /> Home
      </button>

      <WorkspaceSwitcher />

      {pinnedPages.length > 0 && (
        <div className="px-1.5 pb-1 pt-1">
          <div className="px-1.5 pb-1 text-[11px] font-semibold uppercase tracking-widest text-ink-faint dark:text-coal-soft">
            Pinned
          </div>
          {pinnedPages.map((p) => (
            <div
              key={`pin:${p.id}`}
              onClick={() => setActivePage(p.id)}
              className={[
                'group flex cursor-pointer items-center gap-1 rounded-md py-1 pl-2 pr-1 text-sm transition-colors',
                activePageId === p.id
                  ? 'bg-clay-wash text-clay dark:bg-clay/20 dark:text-clay-soft'
                  : 'text-ink-soft hover:bg-paper-panel dark:text-coal-soft dark:hover:bg-coal-line',
              ].join(' ')}
            >
              <span className="shrink-0 text-sm leading-none">{pageIconNode(p.icon, <FileText className="h-3.5 w-3.5" />)}</span>
              <span className="min-w-0 flex-1 truncate">{displayTitle(p.title)}</span>
              <PagePresence people={presence.get(p.id) ?? []} onJump={jumpToPresence} />
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  togglePin(p.id);
                }}
                className="shrink-0 rounded p-0.5 text-clay hover:bg-paper-line dark:hover:bg-coal"
                title="Unpin"
              >
                <Star className="h-3.5 w-3.5 fill-current" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className={`flex items-center justify-between px-3 pb-2 pt-1 ${onHome ? 'hidden' : ''}`}>
        <span className="text-[11px] font-semibold uppercase tracking-widest text-ink-faint dark:text-coal-soft">
          Pages
        </span>
        {roots[0] && (
          <div className="flex items-center gap-0.5">
            <div className="relative">
              <button
                type="button"
                onClick={() => setTplOpen((o) => !o)}
                className="rounded p-1 text-ink-faint hover:bg-paper-line hover:text-ink dark:hover:bg-coal-line dark:hover:text-coal-text"
                title="New from template"
              >
                <BookOpen className="h-4 w-4" />
              </button>
              {tplOpen && (
                <>
                  <div className="fixed inset-0 z-20" onMouseDown={() => setTplOpen(false)} />
                  <div className="absolute right-0 top-full z-30 mt-1 w-56 rounded-lg border border-paper-line bg-paper p-1 shadow-xl dark:border-coal-line dark:bg-coal-panel">
                    <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-ink-faint dark:text-coal-soft">
                      New from template
                    </div>
                    {templates.length === 0 && (
                      <p className="px-2 py-2 text-xs text-ink-faint dark:text-coal-soft">
                        No templates yet. Open a page → ⋯ → Save as template.
                      </p>
                    )}
                    {templates.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => {
                          setTplOpen(false);
                          void duplicatePage(t.id, roots[0].id).then((id) => id && setActivePage(id));
                        }}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink hover:bg-paper-panel dark:text-coal-text dark:hover:bg-coal-line"
                      >
                        <span className="text-base leading-none">{t.icon || '📄'}</span>
                        <span className="truncate">{t.title || 'Untitled'}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            <button
              type="button"
              onClick={() => createPage(roots[0].id)}
              onMouseUp={blurOnMouse}
              className="rounded p-1 text-ink-faint hover:bg-paper-line hover:text-ink dark:hover:bg-coal-line dark:hover:text-coal-text"
              title="New top-level page"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-1.5 pb-4">
        {onHome ? (
          <div className="mx-1.5 mt-2 rounded-lg border border-dashed border-paper-line px-3 py-5 text-center dark:border-coal-line">
            <p className="text-sm font-medium text-ink-soft dark:text-coal-soft">No workspace open</p>
            <p className="mt-1 text-xs text-ink-faint dark:text-coal-soft">
              Pick one from the switcher above, or start something new on Home.
            </p>
          </div>
        ) : (
          <>
            {roots.map((root) => (
              <TreeNode key={root.id} page={root} depth={0} pinned={pins} onTogglePin={togglePin} landingId={landingId} onSetLanding={toggleLanding} presence={presence} />
            ))}
            {unfiled.length > 0 && (
              <div className="mt-3 border-t border-paper-line pt-2 dark:border-coal-line">
                <div className="flex items-center gap-1.5 px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-ink-faint dark:text-coal-soft">
                  Not in the list ({unfiled.length})
                </div>
                <p className="px-2 pb-1.5 text-[11px] leading-snug text-ink-faint dark:text-coal-soft">
                  these are in this workspace but their parent isn&rsquo;t, so they don&rsquo;t show above. add one to the top level, then drag it wherever you want.
                </p>
                {unfiled.map((p) => (
                  <div
                    key={p.id}
                    className="group/uf flex items-center gap-1 rounded-md px-2 py-1 hover:bg-paper-panel dark:hover:bg-coal-line"
                  >
                    <button
                      type="button"
                      onClick={() => setActivePage(p.id)}
                      onMouseUp={blurOnMouse}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm text-ink dark:text-coal-text"
                      title={displayTitle(p.title) || 'Untitled'}
                    >
                      <span className="flex items-center"><PageIcon icon={p.icon} size="h-4 w-4" /></span>
                      <span className="min-w-0 flex-1 truncate">{displayTitle(p.title) || 'Untitled'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => movePage(p.id, '', roots.length)}
                      onMouseUp={blurOnMouse}
                      title="Add to the sidebar (make it a top-level page)"
                      className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium text-clay opacity-0 transition-opacity hover:bg-clay-wash group-hover/uf:opacity-100 dark:hover:bg-clay/20"
                    >
                      Add
                    </button>
                  </div>
                ))}
              </div>
            )}
            {roots.length === 0 && unfiled.length === 0 && (
              <button
                type="button"
                onClick={() => void createPage('')}
                onMouseUp={blurOnMouse}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-ink-soft hover:bg-paper-panel hover:text-ink dark:text-coal-soft dark:hover:bg-coal-line dark:hover:text-coal-text"
              >
                <Plus className="h-4 w-4" /> New page
              </button>
            )}
          </>
        )}
      </div>
    </nav>
  );
}

function TreeNode({
  page,
  depth,
  pinned,
  onTogglePin,
  landingId,
  onSetLanding,
  presence,
}: {
  page: Page;
  depth: number;
  pinned: Set<string>;
  onTogglePin: (id: string) => void;
  landingId: string | null;
  onSetLanding: (id: string) => void;
  presence: Map<string, PresenceRecord[]>;
}) {
  const pages = useData((s) => s.pages);
  const activePageId = useData((s) => s.activePageId);
  const setActivePage = useData((s) => s.setActivePage);
  const createPage = useData((s) => s.createPage);
  const trashPage = useData((s) => s.trashPage);
  const movePage = useData((s) => s.movePage);

  const [expanded, setExpanded] = useState(depth < 2);
  const [dragOver, setDragOver] = useState(false);

  const children = selectChildren(pages, page.id);
  const hasChildren = children.length > 0;
  const isActive = activePageId === page.id;

  return (
    <div>
      <div
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('text/page-id', page.id);
          e.dataTransfer.effectAllowed = 'move';
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const draggedId = e.dataTransfer.getData('text/page-id');
          if (draggedId && draggedId !== page.id) {
            const order = selectChildren(pages, page.id).length;
            movePage(draggedId, page.id, order);
            setExpanded(true);
          }
        }}
        onClick={() => setActivePage(page.id)}
        className={[
          'group flex cursor-pointer items-center gap-1 rounded-md py-1 pr-1 text-sm transition-colors',
          isActive
            ? 'bg-clay-wash text-clay dark:bg-clay/20 dark:text-clay-soft'
            : 'text-ink-soft hover:bg-paper-panel dark:text-coal-soft dark:hover:bg-coal-line',
          dragOver ? 'ring-1 ring-clay' : '',
        ].join(' ')}
        style={{ paddingLeft: `${depth * 14 + 6}px` }}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((x) => !x);
          }}
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-ink-faint hover:bg-paper-line dark:hover:bg-coal"
        >
          {hasChildren ? (
            expanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )
          ) : (
            <span className="h-3.5 w-3.5" />
          )}
        </button>

        <span className="shrink-0 text-sm leading-none">{pageIconNode(page.icon, <FileText className="h-3.5 w-3.5" />)}</span>
        <span className="min-w-0 flex-1 truncate">{displayTitle(page.title)}</span>

        <PagePresence people={presence.get(page.id) ?? []} onJump={jumpToPresence} />

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSetLanding(page.id);
          }}
          className={[
            'shrink-0 rounded p-0.5 hover:bg-paper-line group-hover:visible touch-visible dark:hover:bg-coal',
            landingId === page.id ? 'visible text-clay' : 'invisible text-ink-faint hover:text-ink',
          ].join(' ')}
          title={landingId === page.id ? 'This is the workspace home. Click to clear.' : 'Set as workspace home (opens here)'}
        >
          <Home className={['h-3.5 w-3.5', landingId === page.id ? 'fill-current' : ''].join(' ')} />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onTogglePin(page.id);
          }}
          className={[
            'shrink-0 rounded p-0.5 hover:bg-paper-line group-hover:visible touch-visible dark:hover:bg-coal',
            pinned.has(page.id) ? 'visible text-clay' : 'invisible text-ink-faint hover:text-ink',
          ].join(' ')}
          title={pinned.has(page.id) ? 'Unpin' : 'Pin to top'}
        >
          <Star className={['h-3.5 w-3.5', pinned.has(page.id) ? 'fill-current' : ''].join(' ')} />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            createPage(page.id);
          }}
          onMouseUp={blurOnMouse}
          className="invisible shrink-0 rounded p-0.5 text-ink-faint hover:bg-paper-line hover:text-ink group-hover:visible touch-visible dark:hover:bg-coal dark:hover:text-coal-text"
          title="Add sub-page"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void trashPage(page.id);
          }}
          className="invisible shrink-0 rounded p-0.5 text-ink-faint hover:bg-paper-line hover:text-red-500 group-hover:visible touch-visible dark:hover:bg-coal"
          title="Move to trash"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {expanded && hasChildren && (
        <div>
          {children.map((child) => (
            <TreeNode key={child.id} page={child} depth={depth + 1} pinned={pinned} onTogglePin={onTogglePin} landingId={landingId} onSetLanding={onSetLanding} presence={presence} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// WorkspaceSwitcher, active workspace + a dropdown grouped into Private / Shared
// (feature 4). Selecting one scopes the whole tree; "New workspace" creates a
// private one. Pre-migration there's a single synthesized "Workspace" here.
// ---------------------------------------------------------------------------

function WorkspaceSwitcher() {
  const workspaces = useWorkspace((s) => s.workspaces);
  const activeId = useWorkspace((s) => s.activeWorkspaceId);
  const setActive = useWorkspace((s) => s.setActiveWorkspace);
  const createWorkspace = useWorkspace((s) => s.createWorkspace);
  const renameWorkspace = useWorkspace((s) => s.renameWorkspace);
  const myRole = useWorkspace((s) => s.myRole);
  const createPage = useData((s) => s.createPage);
  const classify = useWorkspace((s) => s.classify);
  const usingDefault = useWorkspace((s) => s.usingDefault);

  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const commitRename = (id: string) => {
    const n = renameDraft.trim();
    if (n) void renameWorkspace(id, n);
    setRenaming(null);
  };
  const active = workspaces.find((w) => w.id === activeId);
  const { private: priv, shared } = classify();

  // Inline "new workspace" row, replaces a native prompt so it matches the
  // rest of the app and you can pick an icon while you're at it.
  const WS_ICONS = ['🗺️', '📍', '✈️', '🏖️', '⛰️', '🏨', '🍜'];
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftIcon, setDraftIcon] = useState(WS_ICONS[0]);
  const nameRef = useRef<HTMLInputElement>(null);

  // Reset the draft whenever the menu closes, and focus the field when the
  // form opens.
  useEffect(() => {
    if (!open) { setCreating(false); setDraftName(''); setDraftIcon(WS_ICONS[0]); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => { if (creating) nameRef.current?.focus(); }, [creating]);

  const submitNew = () => {
    const name = draftName.trim();
    if (!name) return;
    setOpen(false);
    void (async () => {
      const id = await createWorkspace(name, draftIcon); // sets itself active
      // A fresh workspace has no pages, and the tree's create buttons only show
      // once one exists, so drop in an empty top-level page to land on.
      if (id) await createPage('');
    })();
  };

  const Group = ({ label, icon: Icon, items }: { label: string; icon: typeof Lock; items: Workspace[] }) =>
    items.length ? (
      <div className="px-1 py-1">
        <div className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-ink-faint dark:text-coal-soft">
          <Icon className="h-3 w-3" /> {label}
        </div>
        {items.map((w) =>
          renaming === w.id ? (
            <input
              key={w.id}
              autoFocus
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename(w.id);
                else if (e.key === 'Escape') setRenaming(null);
              }}
              onBlur={() => commitRename(w.id)}
              className="m-0.5 w-[calc(100%-0.25rem)] rounded-md border border-clay bg-paper px-2 py-1 text-sm text-ink outline-none dark:bg-coal dark:text-coal-text"
            />
          ) : (
            <div key={w.id} className="group/ws flex items-center">
              <button
                type="button"
                onClick={() => { setActive(w.id); setOpen(false); }}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink hover:bg-paper-panel dark:text-coal-text dark:hover:bg-coal-line"
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center text-base leading-none"><PageIcon icon={w.icon} fallback="🗂️" size="h-4 w-4" /></span>
                <span className="min-w-0 flex-1 truncate">{w.name}</span>
                {w.id === activeId && <Check className="h-3.5 w-3.5 text-clay" />}
              </button>
              {myRole(w.id) === 'admin' && (
                <button
                  type="button"
                  onClick={() => { setRenaming(w.id); setRenameDraft(w.name); }}
                  title="Rename workspace"
                  className="invisible shrink-0 rounded p-1 text-ink-faint hover:bg-paper-panel hover:text-clay group-hover/ws:visible dark:hover:bg-coal-line"
                >
                  <Pencil className="h-3 w-3" />
                </button>
              )}
            </div>
          ),
        )}
      </div>
    ) : null;

  return (
    <div className="relative px-3 pb-1 pt-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-lg border border-paper-line px-2.5 py-2 text-left hover:bg-paper-panel dark:border-coal-line dark:hover:bg-coal-line"
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center text-base leading-none"><PageIcon icon={active?.icon} fallback="🗺️" size="h-4 w-4" /></span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink dark:text-coal-text">{active?.name ?? 'Workspace'}</span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-ink-faint dark:text-coal-soft" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onMouseDown={() => setOpen(false)} />
          <div className="absolute left-3 right-3 top-full z-40 mt-1 overflow-hidden rounded-lg border border-paper-line bg-paper shadow-xl dark:border-coal-line dark:bg-coal-panel">
            <div className="max-h-[40vh] overflow-y-auto">
              <Group label="Private" icon={Lock} items={priv} />
              <Group label="Shared" icon={Users2} items={shared} />
            </div>
            {creating ? (
              <div className="border-t border-paper-line p-2 dark:border-coal-line">
                <div className="mb-1.5 flex flex-wrap gap-1">
                  {WS_ICONS.map((em) => (
                    <button
                      key={em}
                      type="button"
                      // keep focus in the input so the field doesn't blur shut
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => setDraftIcon(em)}
                      className={[
                        'flex h-7 w-7 items-center justify-center rounded-md text-base leading-none',
                        draftIcon === em
                          ? 'bg-clay-wash ring-1 ring-clay dark:bg-clay/20'
                          : 'hover:bg-paper-panel dark:hover:bg-coal-line',
                      ].join(' ')}
                    >
                      {em}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-1.5">
                  <input
                    ref={nameRef}
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') submitNew();
                      else if (e.key === 'Escape') setCreating(false);
                    }}
                    placeholder="Workspace name"
                    className="min-w-0 flex-1 rounded-md border border-paper-line bg-paper px-2 py-1.5 text-sm text-ink outline-none placeholder:text-ink-faint/60 focus:border-clay dark:border-coal-line dark:bg-coal dark:text-coal-text"
                  />
                  <button
                    type="button"
                    onClick={submitNew}
                    disabled={!draftName.trim()}
                    className="shrink-0 rounded-md bg-clay px-2.5 py-1.5 text-sm font-medium text-white hover:bg-clay-soft disabled:opacity-40"
                  >
                    Add
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="flex w-full items-center gap-2 border-t border-paper-line px-3 py-2 text-left text-sm text-ink-soft hover:bg-paper-panel dark:border-coal-line dark:text-coal-soft dark:hover:bg-coal-line"
              >
                <Plus className="h-4 w-4" /> New workspace
              </button>
            )}
            {usingDefault && (
              <p className="border-t border-paper-line px-3 py-2 text-[11px] text-ink-faint dark:border-coal-line dark:text-coal-soft">
                workspaces aren't set up on the server yet, this is a local default. apply the backend to enable private/shared.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
