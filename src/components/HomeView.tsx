import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, AlertTriangle, Sun, CalendarDays, FileText, Clock, UserCheck, Coins, History } from 'lucide-react';
import { useData } from '../store/useData';
import { useWorkspace } from '../store/useWorkspace';
import { useAuth } from '../store/useAuth';
import { collectAgenda, groupByDay, onThisDay, type AgendaItem } from '../lib/agenda';
import { buildWall, wallTone } from '../lib/countdown';
import { assignedToMe } from '../lib/assignments';
import { whoOwesWhom } from '../lib/whoOwes';
import { getBaseCurrency } from '../lib/fx';
import { usersApi } from '../lib/api';
import { displayTitle } from '../lib/crypto';
import { TEMPLATES } from '../lib/templates';
import { PageIcon } from './PageIcon';

// Home, the surface you land on when no page is open: what's due across every
// workspace (overdue, today, the week ahead), and the pages you touched recently.
// An Agenda tab lays every dated thing out day by day. Each card links into the
// row or page it came from.

function greeting(now: Date): string {
  const h = now.getHours();
  if (h < 5) return 'Still up';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function fmtTime(it: AgendaItem): string {
  const d = new Date(it.ms);
  return it.hasTime ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'all day';
}

function dayLabel(ms: number, now: number): string {
  const d = new Date(ms);
  const diff = Math.round((d.setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return new Date(ms).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
}

export function HomeView() {
  const tables = useData((s) => s.tables);
  const rows = useData((s) => s.rows);
  const pages = useData((s) => s.pages);
  const openRow = useData((s) => s.openRow);
  const setActivePage = useData((s) => s.setActivePage);
  const createTemplatePage = useData((s) => s.createTemplatePage);
  const workspaces = useWorkspace((s) => s.workspaces);
  const setActiveWorkspace = useWorkspace((s) => s.setActiveWorkspace);
  const createWorkspace = useWorkspace((s) => s.createWorkspace);
  const defaultWorkspaceId = useWorkspace((s) => s.defaultWorkspaceId);
  const me = useAuth((s) => s.user);

  // Starting from a template spins up its own workspace (a trip, a sprint, a
  // campaign each gets its own space), then drops the template page inside it.
  const startTemplate = async (key: string, title: string, icon: string) => {
    await createWorkspace(title, icon); // creates and activates it (falls through on failure)
    await createTemplatePage(key); // lands in the now-active workspace
  };

  // Opening something from Home should also switch to its workspace, so the
  // sidebar and scope match what you just opened.
  const openRowIn = (rowId: string, workspace: string) => {
    const ws = workspace || defaultWorkspaceId;
    if (ws) setActiveWorkspace(ws);
    openRow(rowId);
  };
  const openPageIn = (pageId: string, workspace: string) => {
    const ws = workspace || defaultWorkspaceId;
    if (ws) setActiveWorkspace(ws);
    setActivePage(pageId);
  };
  const [tab, setTab] = useState<'today' | 'agenda' | 'wall'>('today');

  const now = Date.now();
  const wsName = useMemo(() => new Map(workspaces.map((w) => [w.id, w.name])), [workspaces]);
  const agenda = useMemo(() => collectAgenda(tables, rows, now, 90), [tables, rows, now]);
  // The countdown wall wants a longer horizon than the agenda list: a trip a
  // year out is exactly the thing you want a big number for.
  const wall = useMemo(
    () => buildWall(collectAgenda(tables, rows, now, 800).map((a) => ({ id: a.id, title: a.title, ms: a.ms, field: a.field, hasTime: a.hasTime })), now),
    [tables, rows, now],
  );
  const past = useMemo(() => onThisDay(tables, rows, now), [tables, rows, now]);

  const overdue = agenda.filter((a) => a.status === 'overdue');
  const today = agenda.filter((a) => a.status === 'today');
  const soon = agenda.filter((a) => a.status === 'upcoming' && a.ms < now + 7 * 86400000);

  const mine = useMemo(() => (me ? assignedToMe(tables, rows, me.id) : []), [tables, rows, me]);

  // Who owes whom, netted across every budget in view. Names come from the user
  // list (cross-workspace), the current user reads as "You".
  const owes = useMemo(() => whoOwesWhom(tables, rows), [tables, rows]);
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => {
    void usersApi
      .listMembers()
      .then((ms) => {
        const map: Record<string, string> = {};
        for (const m of ms) map[m.id] = m.name || m.email || 'Someone';
        setNames(map);
      })
      .catch(() => {});
  }, []);
  const nameOf = (id: string) => (id === me?.id ? 'You' : names[id] || 'Someone');
  const base = getBaseCurrency();
  const money = (n: number) => `${Math.round(n).toLocaleString()} ${base}`;

  const recent = useMemo(
    () =>
      Object.values(pages)
        .filter((p) => !p.trashed && !p.template)
        .sort((a, b) => (b.updated || '').localeCompare(a.updated || ''))
        .slice(0, 8),
    [pages],
  );

  const Item = ({ it }: { it: AgendaItem }) => (
    <button
      type="button"
      onClick={() => openRowIn(it.rowId, it.workspace)}
      className="flex w-full items-center gap-3 rounded-lg border border-paper-line bg-paper px-3 py-2 text-left hover:border-clay/50 hover:bg-paper-panel dark:border-coal-line dark:bg-coal-panel dark:hover:bg-coal-line"
    >
      <span
        className={[
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-xs font-semibold',
          it.status === 'overdue'
            ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
            : it.status === 'today'
              ? 'bg-clay-wash text-clay dark:bg-clay/15'
              : 'bg-paper-panel text-ink-soft dark:bg-coal-line dark:text-coal-soft',
        ].join(' ')}
      >
        <Clock className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-ink dark:text-coal-text">{it.title}</span>
        <span className="block truncate text-[11px] text-ink-faint dark:text-coal-soft">
          {it.field}
          {wsName.get(it.workspace) ? ` · ${wsName.get(it.workspace)}` : ''}
        </span>
      </span>
      <span className="shrink-0 text-right text-[11px] text-ink-faint dark:text-coal-soft">
        {tab === 'today' ? dayLabel(it.ms, now) : ''} {fmtTime(it)}
      </span>
    </button>
  );

  const Section = ({ icon: Icon, label, items, tone }: { icon: typeof Sun; label: string; items: AgendaItem[]; tone: string }) =>
    items.length === 0 ? null : (
      <div>
        <div className={`mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide ${tone}`}>
          <Icon className="h-3.5 w-3.5" /> {label} <span className="opacity-60">{items.length}</span>
        </div>
        <div className="space-y-1.5">
          {items.map((it) => (
            <Item key={it.id} it={it} />
          ))}
        </div>
      </div>
    );

  const grouped = groupByDay(agenda);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-8">
        <h1 className="text-2xl font-semibold text-ink dark:text-coal-text">
          {greeting(new Date(now))}
          {me?.name ? `, ${me.name.split(' ')[0]}` : ''}
        </h1>
        <p className="mt-0.5 text-sm text-ink-faint dark:text-coal-soft">
          {overdue.length + today.length === 0
            ? 'Nothing due. Enjoy it.'
            : `${overdue.length} overdue, ${today.length} due today.`}
        </p>

        <div className="mt-6">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-soft dark:text-coal-soft">
            Start something
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {TEMPLATES.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => void startTemplate(t.key, t.title, t.icon)}
                title={t.blurb}
                className="flex w-40 shrink-0 flex-col gap-1 rounded-xl border border-paper-line bg-paper p-3 text-left hover:border-clay/50 hover:bg-paper-panel dark:border-coal-line dark:bg-coal-panel dark:hover:bg-coal-line"
              >
                <span className="text-2xl leading-none">{t.icon}</span>
                <span className="text-sm font-medium text-ink dark:text-coal-text">{t.title}</span>
                <span className="text-[11px] leading-snug text-ink-faint dark:text-coal-soft">{t.blurb}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6 mb-4 flex items-center gap-1 border-b border-paper-line dark:border-coal-line">
          {(['today', 'agenda', 'wall'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={[
                '-mb-px border-b-2 px-3 py-2 text-sm font-medium capitalize',
                tab === t
                  ? 'border-clay text-ink dark:text-coal-text'
                  : 'border-transparent text-ink-faint hover:text-ink-soft dark:text-coal-soft',
              ].join(' ')}
            >
              {t === 'today' ? 'Today' : t === 'agenda' ? 'Agenda' : 'Countdown'}
            </button>
          ))}
        </div>

        {tab === 'wall' ? (
          <CountdownWall items={wall} onOpen={openRowIn} rows={rows} />
        ) : tab === 'today' ? (
          <div className="space-y-5">
            <Section icon={AlertTriangle} label="Overdue" items={overdue} tone="text-rose-600 dark:text-rose-400" />
            <Section icon={Sun} label="Today" items={today} tone="text-clay" />
            <Section icon={CalendarClock} label="Next 7 days" items={soon} tone="text-ink-soft dark:text-coal-soft" />
            {past.length > 0 && (
              <div>
                <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-soft dark:text-coal-soft">
                  <History className="h-3.5 w-3.5" /> On this day
                </div>
                <div className="space-y-1.5">
                  {past.map((it) => (
                    <button
                      key={it.id}
                      type="button"
                      onClick={() => openRowIn(it.rowId, it.workspace)}
                      className="flex w-full items-center gap-2 rounded-lg border border-paper-line bg-paper px-3 py-2 text-left hover:border-clay dark:border-coal-line dark:bg-coal-panel"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm text-ink dark:text-coal-text">{it.title}</span>
                      <span className="shrink-0 text-xs text-ink-faint dark:text-coal-soft">
                        {it.yearsAgo} year{it.yearsAgo === 1 ? '' : 's'} ago
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {mine.length > 0 && (
              <div>
                <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-soft dark:text-coal-soft">
                  <UserCheck className="h-3.5 w-3.5" /> Assigned to you <span className="opacity-60">{mine.length}</span>
                </div>
                <div className="space-y-1.5">
                  {mine.slice(0, 12).map((a) => (
                    <button
                      key={a.key}
                      type="button"
                      onClick={() => openRowIn(a.rowId, tables[a.tableId]?.workspace ?? '')}
                      className="flex w-full items-center gap-3 rounded-lg border border-paper-line bg-paper px-3 py-2 text-left hover:border-clay/50 hover:bg-paper-panel dark:border-coal-line dark:bg-coal-panel dark:hover:bg-coal-line"
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-paper-panel text-ink-soft dark:bg-coal-line dark:text-coal-soft">
                        <UserCheck className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink dark:text-coal-text">{a.title}</span>
                        <span className="block truncate text-[11px] text-ink-faint dark:text-coal-soft">{a.fieldName}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {owes.transfers.length > 0 && (
              <div>
                <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-soft dark:text-coal-soft">
                  <Coins className="h-3.5 w-3.5" /> Who owes whom
                  <span className="opacity-60">{owes.budgets} budget{owes.budgets === 1 ? '' : 's'}</span>
                </div>
                <div className="space-y-1.5">
                  {owes.transfers.map((t, i) => {
                    const involvesMe = t.from === me?.id || t.to === me?.id;
                    return (
                      <div
                        key={i}
                        className={[
                          'flex items-center gap-2 rounded-lg border px-3 py-2',
                          involvesMe
                            ? 'border-clay/40 bg-clay-wash/40 dark:border-clay/30 dark:bg-clay/10'
                            : 'border-paper-line bg-paper dark:border-coal-line dark:bg-coal-panel',
                        ].join(' ')}
                      >
                        <span className="text-sm text-ink dark:text-coal-text">
                          <span className="font-medium">{nameOf(t.from)}</span> owes <span className="font-medium">{nameOf(t.to)}</span>
                        </span>
                        <span className="ml-auto text-sm font-semibold tabular-nums text-clay">{money(t.amount)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            <div>
              <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-soft dark:text-coal-soft">
                <FileText className="h-3.5 w-3.5" /> Recent pages
              </div>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {recent.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => openPageIn(p.id, p.workspace ?? '')}
                    className="flex items-center gap-2 rounded-lg border border-paper-line bg-paper px-3 py-2 text-left hover:bg-paper-panel dark:border-coal-line dark:bg-coal-panel dark:hover:bg-coal-line"
                  >
                    <span className="flex items-center text-base leading-none"><PageIcon icon={p.icon} size="h-4 w-4" /></span>
                    <span className="min-w-0 flex-1 truncate text-sm text-ink dark:text-coal-text">{displayTitle(p.title)}</span>
                  </button>
                ))}
              </div>
            </div>
            {overdue.length + today.length + soon.length + recent.length === 0 && (
              <p className="py-10 text-center text-sm text-ink-faint dark:text-coal-soft">
                Add a date, reminder or checklist due to something and it shows up here.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-5">
            {grouped.length === 0 && (
              <p className="py-10 text-center text-sm text-ink-faint dark:text-coal-soft">Nothing dated yet.</p>
            )}
            {grouped.map((g) => (
              <div key={g.day}>
                <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-soft dark:text-coal-soft">
                  <CalendarDays className="h-3.5 w-3.5" /> {dayLabel(g.day, now)}
                </div>
                <div className="space-y-1.5">
                  {g.items.map((it) => (
                    <Item key={it.id} it={it} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// The countdown wall: every dated thing ahead, as tiles you can read from across
// a room. Deliberately not a list. The unit changes with the distance (hours
// today, days this month, weeks then months) because "42 days" is harder to read
// at a glance than "6 weeks", and the tone is three coarse bands for the same
// reason. Pure logic in lib/countdown.ts.
function CountdownWall({ items, rows, onOpen }: {
  items: ReturnType<typeof buildWall>;
  rows: Record<string, { id: string; workspace?: string }>;
  onOpen: (rowId: string, workspace: string) => void;
}) {
  if (!items.length) {
    return <p className="py-10 text-center text-sm text-ink-faint dark:text-coal-soft">nothing dated ahead. Put a date on a row and it shows up here.</p>;
  }
  const TONE = {
    now: 'border-clay bg-clay/10 text-clay',
    soon: 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-900/20 dark:text-amber-300',
    later: 'border-paper-line bg-paper text-ink dark:border-coal-line dark:bg-coal-panel dark:text-coal-text',
  } as const;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {items.map((item) => {
        const tone = wallTone(item.days);
        const rowId = item.id.split(':')[0];
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onOpen(rowId, rows[rowId]?.workspace ?? '')}
            className={`flex flex-col items-start rounded-xl border p-4 text-left transition-transform hover:scale-[1.02] ${TONE[tone]}`}
          >
            <span className="font-display text-4xl font-bold leading-none tabular-nums">
              {item.value}
              <span className="ml-1 text-base font-medium opacity-70">{item.unit}</span>
            </span>
            <span className="mt-2 line-clamp-2 text-sm font-medium">{item.title}</span>
            <span className="mt-0.5 text-[11px] opacity-70">
              {item.days === 0 ? 'today' : item.days === 1 ? 'tomorrow' : new Date(item.ms).toLocaleDateString()} · {item.field}
            </span>
          </button>
        );
      })}
    </div>
  );
}
