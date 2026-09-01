import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X, Type, Database, Plane, Vote, Dices, Zap, Calculator, AtSign, Sigma, Keyboard } from 'lucide-react';
import { searchHelp } from '../lib/slashHelp';
import { modKey, searchHint } from '../lib/platform';
import { useWorkspace } from '../store/useWorkspace';

// HelpPanel, a reference for every slash command, grouped the way the editor
// menu is. Search filters across all sections; the left contents jumps to one.
// Read-only: nothing here mutates the workspace.

interface Props {
  open: boolean;
  onClose: () => void;
}

const SECTION_ICONS: Record<string, typeof Type> = {
  text: Type,
  tools: Calculator,
  db: Database,
  trip: Plane,
  live: Vote,
  ttrpg: Dices,
  auto: Zap,
  formulas: Sigma,
};

// Things you trigger by typing, not from the slash menu.
const TYPEAHEAD_TIPS = [
  { trigger: '@', name: 'Mention someone', desc: 'Type @ and pick a member of this workspace to drop their name inline.' },
  { trigger: '[[', name: 'Link a page', desc: 'Type [[ and pick a page; the link opens it when you click it.' },
  { trigger: 'next friday', name: 'Dates in words', desc: 'In a date or reminder cell, type something like "next friday" or "in 3 weeks" and it resolves.' },
];

const SEARCH_TIPS = [
  {
    trigger: 'done;water',
    name: 'Need every word',
    desc: 'A semicolon asks for all of them. This finds the pages that mention both done and water.',
  },
  {
    trigger: '*gmail.com*',
    name: 'Match inside words',
    desc: 'Wrap a bit in stars to match it anywhere, even in the middle of a word.',
  },
  {
    trigger: '*one*;*ter*',
    name: 'Mix them',
    desc: 'Use the two together however you want. Here: contains one, and contains ter.',
  },
];

export function HelpPanel({ open, onClose }: Props) {
  const [query, setQuery] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const sectionEls = useRef<Record<string, HTMLElement | null>>({});

  const tabletop = useWorkspace((s) => s.tabletopEnabled());
  // Hide the tabletop reference when the workspace has the tools off, so the help
  // matches the menu the user actually sees.
  const sections = useMemo(
    () => searchHelp(query).filter((s) => tabletop || s.id !== 'ttrpg'),
    [query, tabletop],
  );

  useEffect(() => {
    if (open) setQuery('');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const mod = modKey();
  const shortcuts: { keys: string; name: string }[] = [
    { keys: searchHint(), name: 'Quick find, search every page, cell and card' },
    { keys: '/', name: 'Slash menu, insert any block on a page' },
    { keys: '?', name: 'Open this reference (shortcuts + commands)' },
    { keys: 'Esc', name: 'Close a panel, popover, lightbox or menu' },
    { keys: '← → ↑ ↓', name: 'With a card open on a board or calendar: left/right change stage or day, up/down walk its cards' },
    { keys: `${mod} B / I`, name: 'Bold / italic the selected text' },
    { keys: `${mod} Z`, name: 'Undo the last edit' },
    { keys: 'Enter', name: 'Confirm a slash command, or send a comment' },
  ];

  const jumpTo = (id: string) => {
    sectionEls.current[id]?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/30 pt-[8vh] backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <div
        className="flex h-[80vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-paper-line bg-paper shadow-2xl dark:border-coal-line dark:bg-coal-panel"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-paper-line px-4 py-3 dark:border-coal-line">
          <span className="font-display text-sm font-semibold text-ink dark:text-coal-text">Slash commands</span>
          <div className="ml-2 flex flex-1 items-center gap-2 rounded-lg border border-paper-line px-2.5 dark:border-coal-line">
            <Search className="h-3.5 w-3.5 shrink-0 text-ink-faint dark:text-coal-soft" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter commands…"
              className="w-full bg-transparent py-1.5 text-sm text-ink outline-none placeholder:text-ink-faint dark:text-coal-text"
            />
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-ink-faint hover:bg-paper-panel dark:hover:bg-coal-line"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          <nav className="hidden w-48 shrink-0 overflow-y-auto border-r border-paper-line p-2 sm:block dark:border-coal-line">
            {sections.map((s) => {
              const Icon = SECTION_ICONS[s.id] ?? Type;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => jumpTo(s.id)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-ink-soft hover:bg-paper-panel hover:text-ink dark:text-coal-soft dark:hover:bg-coal-line dark:hover:text-coal-text"
                >
                  <Icon className="h-3.5 w-3.5 shrink-0 text-clay" />
                  <span className="truncate">{s.title}</span>
                </button>
              );
            })}
            {sections.length === 0 && (
              <p className="px-2 py-2 text-xs text-ink-faint dark:text-coal-soft">Nothing matches.</p>
            )}
          </nav>

          <div ref={scrollRef} className="min-w-0 flex-1 overflow-y-auto px-5 py-4">
            {!query && (
              <>
                <section className="mb-7">
                  <div className="flex items-center gap-2">
                    <Keyboard className="h-4 w-4 text-clay" />
                    <h3 className="font-display text-base font-semibold text-ink dark:text-coal-text">Keyboard shortcuts</h3>
                  </div>
                  <p className="mt-1 text-xs text-ink-faint dark:text-coal-soft">Press ? anywhere (outside a text field) to open this.</p>
                  <div className="mt-2">
                    {shortcuts.map((s) => (
                      <div key={s.keys} className="flex items-baseline gap-3 border-b border-paper-line/70 py-2 last:border-0 dark:border-coal-line/60">
                        <kbd className="shrink-0 rounded border border-paper-line bg-paper-panel px-1.5 py-0.5 font-mono text-xs text-ink-soft dark:border-coal-line dark:bg-coal-line dark:text-coal-soft">
                          {s.keys}
                        </kbd>
                        <span className="text-sm text-ink dark:text-coal-text">{s.name}</span>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="mb-7">
                  <div className="flex items-center gap-2">
                    <Search className="h-4 w-4 text-clay" />
                    <h3 className="font-display text-base font-semibold text-ink dark:text-coal-text">Search</h3>
                  </div>
                  <p className="mt-1 text-xs text-ink-faint dark:text-coal-soft">
                    Press {searchHint()} from anywhere. It reads page text, table cells and the cards (a case
                    brief's facts, a recipe's steps), and it forgives typos. Click a result and it jumps to the
                    spot and flashes it.
                  </p>
                  <div className="mt-2">
                    {SEARCH_TIPS.map((t) => (
                      <div key={t.trigger} className="border-b border-paper-line/70 py-2.5 last:border-0 dark:border-coal-line/60">
                        <div className="flex items-baseline gap-2.5">
                          <code className="shrink-0 rounded bg-paper-panel px-1.5 py-0.5 font-mono text-xs text-clay dark:bg-coal-line">
                            {t.trigger}
                          </code>
                          <span className="text-sm font-medium text-ink dark:text-coal-text">{t.name}</span>
                        </div>
                        <p className="mt-1 text-sm text-ink-soft dark:text-coal-soft">{t.desc}</p>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="mb-7">
                  <div className="flex items-center gap-2">
                    <AtSign className="h-4 w-4 text-clay" />
                    <h3 className="font-display text-base font-semibold text-ink dark:text-coal-text">As you type</h3>
                  </div>
                  <p className="mt-1 text-xs text-ink-faint dark:text-coal-soft">A few shortcuts that need no slash.</p>
                  <div className="mt-2">
                    {TYPEAHEAD_TIPS.map((t) => (
                      <div key={t.trigger} className="border-b border-paper-line/70 py-2.5 last:border-0 dark:border-coal-line/60">
                        <div className="flex items-baseline gap-2.5">
                          <code className="shrink-0 rounded bg-paper-panel px-1.5 py-0.5 font-mono text-xs text-clay dark:bg-coal-line">
                            {t.trigger}
                          </code>
                          <span className="text-sm font-medium text-ink dark:text-coal-text">{t.name}</span>
                        </div>
                        <p className="mt-1 text-sm text-ink-soft dark:text-coal-soft">{t.desc}</p>
                      </div>
                    ))}
                  </div>
                </section>

                <p className="mb-4 text-xs text-ink-faint dark:text-coal-soft">
                  Type / on any page to open this menu, then keep typing to narrow it. Move with the arrow keys
                  and press enter, or click. Most blocks answer to several keywords, the shorthand below is just
                  the quickest one.
                </p>
              </>
            )}

            {sections.map((s) => {
              const Icon = SECTION_ICONS[s.id] ?? Type;
              return (
                <section
                  key={s.id}
                  ref={(el) => {
                    sectionEls.current[s.id] = el;
                  }}
                  className="mb-7 scroll-mt-2"
                >
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4 text-clay" />
                    <h3 className="font-display text-base font-semibold text-ink dark:text-coal-text">{s.title}</h3>
                  </div>
                  <p className="mt-1 text-xs text-ink-faint dark:text-coal-soft">{s.blurb}</p>

                  <div className="mt-2">
                    {s.commands.map((c) => (
                      <div
                        key={c.trigger + c.name}
                        className="border-b border-paper-line/70 py-2.5 last:border-0 dark:border-coal-line/60"
                      >
                        <div className="flex items-baseline gap-2.5">
                          <code className="shrink-0 rounded bg-paper-panel px-1.5 py-0.5 font-mono text-xs text-clay dark:bg-coal-line">
                            {c.trigger}
                          </code>
                          <span className="text-sm font-medium text-ink dark:text-coal-text">{c.name}</span>
                        </div>
                        <p className="mt-1 text-sm text-ink-soft dark:text-coal-soft">{c.desc}</p>
                        {c.note && (
                          <p className="mt-0.5 text-xs text-ink-faint dark:text-coal-soft/80">{c.note}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}

            {sections.length === 0 && (
              <p className="py-10 text-center text-sm text-ink-faint dark:text-coal-soft">
                No commands match “{query.trim()}”.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
