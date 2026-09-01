import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, FileText, CornerDownLeft, Plus, Table, Home, Settings, Palette, Moon, Lock, FilePlus, Zap, Paperclip } from 'lucide-react';
import { useData, selectTopLevel } from '../store/useData';
import { useWorkspace } from '../store/useWorkspace';
import { useVault } from '../store/useVault';
import { useWorkspaceKeys } from '../store/useWorkspaceKeys';
import { useWorkspacePages, useWorkspaceTables } from '../hooks/useScoped';
import { PageIcon } from './PageIcon';
import { buildSearchIndex, searchIndex, fuzzyScore } from '../lib/search';
import type { TableRow } from '../types';

interface PaletteAction {
  label: string;
  icon: typeof Home;
  keywords: string[];
  run: () => void;
}
import type { ReactNode } from 'react';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Bold the parts of `text` that matched the search (case-insensitive).
function Highlighted({ text, terms }: { text: string; terms: string[] }) {
  const needles = [...new Set(terms.filter((t) => t.trim().length > 0))];
  if (!needles.length || !text) return <>{text}</>;
  const re = new RegExp(`(${needles.map(escapeRegExp).join('|')})`, 'gi');
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      <mark key={m.index} className="rounded bg-clay/20 px-0.5 text-clay dark:text-clay-soft">
        {m[0]}
      </mark>,
    );
    last = m.index + m[0].length;
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

// ---------------------------------------------------------------------------
// CommandPalette, quick find (Ctrl+Q, or K where the browser owns Q) and actions.
// ---------------------------------------------------------------------------
// Searches page titles + body text AND table-row cells (all in memory), so a
// word typed into a cell is findable, not just page titles. Enter on a page
// jumps to it; Enter on a row opens it; the trailing "Create page" action makes
// a new top-level page. Esc or backdrop click closes.

interface Props {
  open: boolean;
  onClose: () => void;
  onOpenSettings?: () => void;
  onOpenThemes?: () => void;
  onToggleTheme?: () => void;
}

export function CommandPalette({ open, onClose, onOpenSettings, onOpenThemes, onToggleTheme }: Props) {
  // Scope search to the active workspace, so results never jump you into another
  // workspace you happen to be a member of.
  const pages = useWorkspacePages();
  const tables = useData((s) => s.tables);
  const rows = useData((s) => s.rows);
  const wsTables = useWorkspaceTables();
  const setActivePage = useData((s) => s.setActivePage);
  const requestFocus = useData((s) => s.requestFocus);
  const openRow = useData((s) => s.openRow);
  const requestPageTab = useData((s) => s.requestPageTab);
  const createPage = useData((s) => s.createPage);
  const renamePage = useData((s) => s.renamePage);
  const createWorkspace = useWorkspace((s) => s.createWorkspace);
  const vaultStatus = useVault((s) => s.status);
  const lockVault = useVault((s) => s.lock);

  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Decrypted bodies of encrypted pages, so search can reach their text too.
  const searchBodies = useWorkspaceKeys((s) => s.searchBodies);
  // Rows scoped to the active workspace (those whose table is in this workspace).
  const scopedRows = useMemo(() => {
    const ids = new Set(wsTables.map((t) => t.id));
    const out: Record<string, TableRow> = {};
    for (const r of Object.values(rows)) if (ids.has(r.table)) out[r.id] = r;
    return out;
  }, [rows, wsTables]);
  // Rebuilt only when the store data changes, not on every keystroke.
  const index = useMemo(() => buildSearchIndex(pages, tables, scopedRows, searchBodies), [pages, tables, scopedRows, searchBodies]);
  const results = useMemo(() => searchIndex(index, query, 8), [index, query]);

  // Things the palette can DO, not just find. Built from the store plus the app
  // handlers; the ones whose handler isn't wired are dropped.
  const actions: PaletteAction[] = [
    { label: 'Go to Home', icon: Home, keywords: ['home', 'today', 'dashboard', 'agenda'], run: () => setActivePage(null) },
    {
      label: 'New page',
      icon: FilePlus,
      keywords: ['new page', 'create page', 'add page'],
      run: () => void createPage(selectTopLevel(pages)[0]?.id ?? '').then((id) => id && setActivePage(id)),
    },
    { label: 'New workspace', icon: Plus, keywords: ['new workspace', 'space', 'team'], run: () => void createWorkspace('Untitled workspace') },
    onOpenSettings && { label: 'Open settings', icon: Settings, keywords: ['settings', 'members', 'invite', 'backup', 'export', 'import', 'notion'], run: onOpenSettings },
    onOpenThemes && { label: 'Themes', icon: Palette, keywords: ['theme', 'colour', 'color', 'appearance', 'font'], run: onOpenThemes },
    onToggleTheme && { label: 'Toggle dark mode', icon: Moon, keywords: ['dark', 'light', 'mode', 'night', 'toggle'], run: onToggleTheme },
    vaultStatus === 'unlocked' && { label: 'Lock the vault', icon: Lock, keywords: ['lock', 'vault', 'secure', 'encrypt'], run: () => lockVault() },
  ].filter((a): a is PaletteAction => Boolean(a));

  const actionHits = query.trim()
    ? actions
        .map((a) => ({ a, score: Math.max(fuzzyScore(query, a.label), ...a.keywords.map((k) => fuzzyScore(query, k))) }))
        .filter((x) => x.score >= 0)
        .sort((x, y) => y.score - x.score)
        .slice(0, 4)
        .map((x) => x.a)
    : [];

  // Selectable list: results, then matching actions, then "create page".
  const canCreate = query.trim().length > 0;
  const itemCount = results.length + actionHits.length + (canCreate ? 1 : 0);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      // focus after the element mounts
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => setActive(0), [query]);

  if (!open) return null;

  const roots = selectTopLevel(pages);

  const runCreate = async () => {
    const parent = roots[0]?.id ?? '';
    const title = query.trim();
    const id = await createPage(parent);
    if (id) {
      if (title) renamePage(id, title);
      setActivePage(id);
    }
    onClose();
  };

  const choose = (i: number) => {
    if (i < results.length) {
      const hit = results[i];
      if (hit.kind === 'row') {
        openRow(hit.id);
      } else if (hit.kind === 'file') {
        // A file has no page of its own, so its hit carries the page that holds it.
        // Land on that page's Files tab rather than its notes, since that is where
        // the thing you searched for actually is.
        setActivePage(hit.id);
        requestPageTab(hit.id, 'files');
      } else if (hit.highlights[0]) {
        // Open the page and scroll to / flash the matched text (a card, a word).
        requestFocus(hit.id, hit.highlights[0]);
      } else {
        setActivePage(hit.id);
      }
      onClose();
    } else if (i < results.length + actionHits.length) {
      actionHits[i - results.length].run();
      onClose();
    } else if (canCreate) {
      void runCreate();
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => (itemCount ? (a + 1) % itemCount : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (itemCount ? (a + itemCount - 1) % itemCount : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(active);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/30 pt-[12vh] backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-xl border border-paper-line bg-paper shadow-2xl dark:border-coal-line dark:bg-coal-panel"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-paper-line px-3 dark:border-coal-line">
          <Search className="h-4 w-4 shrink-0 text-ink-faint dark:text-coal-soft" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search pages and tables, or type to create…"
            className="w-full bg-transparent py-3 text-sm text-ink outline-none placeholder:text-ink-faint dark:text-coal-text"
          />
          <kbd className="hidden shrink-0 rounded border border-paper-line px-1.5 py-0.5 text-[10px] text-ink-faint sm:block dark:border-coal-line dark:text-coal-soft">
            esc
          </kbd>
        </div>

        <div className="max-h-[50vh] overflow-y-auto p-1.5">
          {results.map((r, i) => (
            <button
              key={`${r.kind}:${r.id}`}
              type="button"
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(i)}
              className={[
                'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left',
                i === active ? 'bg-paper-panel dark:bg-coal-line' : '',
              ].join(' ')}
            >
              <span className="flex h-5 w-5 shrink-0 items-center justify-center text-base leading-none">
                {r.kind === 'row' ? (
                  <Table className="h-4 w-4 text-ink-faint dark:text-coal-soft" />
                ) : r.kind === 'file' ? (
                  <Paperclip className="h-4 w-4 text-ink-faint dark:text-coal-soft" />
                ) : r.icon ? (
                  <PageIcon icon={r.icon} size="h-4 w-4" />
                ) : (
                  <FileText className="h-4 w-4 text-ink-faint" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium text-ink dark:text-coal-text">
                    <Highlighted text={r.title} terms={r.highlights} />
                  </span>
                  {r.context && (
                    <span className="shrink-0 rounded bg-paper-panel px-1.5 text-[10px] text-ink-faint dark:bg-coal-line dark:text-coal-soft">
                      {r.context}
                    </span>
                  )}
                  {r.match && (
                    <span
                      className="shrink-0 rounded bg-clay-wash px-1.5 text-[10px] font-medium text-clay dark:bg-clay/20 dark:text-clay-soft"
                      title={`closest match to “${query.trim()}”`}
                    >
                      ≈ {r.match}
                    </span>
                  )}
                </span>
                {r.snippet && (
                  <span className="block truncate text-xs text-ink-faint dark:text-coal-soft">
                    <Highlighted text={r.snippet} terms={r.highlights} />
                  </span>
                )}
              </span>
              {i === active && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-ink-faint" />}
            </button>
          ))}

          {actionHits.length > 0 && (
            <div className="px-2.5 pb-0.5 pt-2 text-[10px] font-medium uppercase tracking-wide text-ink-faint dark:text-coal-soft">
              Actions
            </div>
          )}
          {actionHits.map((a, ai) => {
            const idx = results.length + ai;
            const Icon = a.icon;
            return (
              <button
                key={a.label}
                type="button"
                onMouseEnter={() => setActive(idx)}
                onClick={() => choose(idx)}
                className={[
                  'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left',
                  idx === active ? 'bg-paper-panel dark:bg-coal-line' : '',
                ].join(' ')}
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-clay/15 text-clay">
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-ink dark:text-coal-text">{a.label}</span>
                <Zap className="h-3 w-3 shrink-0 text-ink-faint dark:text-coal-soft" />
                {idx === active && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-ink-faint" />}
              </button>
            );
          })}

          {canCreate && (
            <button
              type="button"
              onMouseEnter={() => setActive(results.length + actionHits.length)}
              onClick={() => choose(results.length + actionHits.length)}
              className={[
                'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left',
                active === results.length + actionHits.length ? 'bg-paper-panel dark:bg-coal-line' : '',
              ].join(' ')}
            >
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-clay/15 text-clay">
                <Plus className="h-3.5 w-3.5" />
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-ink dark:text-coal-text">
                Create page “{query.trim()}”
              </span>
            </button>
          )}

          {results.length === 0 && !canCreate && (
            <p className="px-3 py-6 text-center text-sm text-ink-faint dark:text-coal-soft">No pages yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
