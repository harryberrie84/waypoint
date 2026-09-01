import { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, AlarmClock, UserCheck, Zap } from 'lucide-react';
import { useData, flowNoticesAll, type BellNotice } from '../store/useData';
import { useAuth } from '../store/useAuth';
import { commentsApi } from '../lib/api';
import { dueReminders, formatInstant, type DueReminder } from '../lib/reminders';
import { isEnvelope } from '../lib/crypto';
import { assignedToMe, type Assignment } from '../lib/assignments';
import type { Comment } from '../types';
import { Popover } from './Popover';

const MENTIONS_SEEN_KEY = 'waypoint:notifsSeen';
const REMINDERS_SEEN_KEY = 'waypoint:remindersSeen';
const ASSIGNED_SEEN_KEY = 'waypoint:assignedSeen';
const NOTICES_SEEN_KEY = 'waypoint:noticesSeen';

function timeAgo(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function untilLabel(target: number, now: number): string {
  const m = Math.round((target - now) / 60000);
  if (m <= 0) return 'now';
  if (m < 60) return `in ${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `in ${h}h`;
  return `in ${Math.round(h / 24)}d`;
}

export function NotificationsBell() {
  const me = useAuth((s) => s.user);
  const pages = useData((s) => s.pages);
  const tables = useData((s) => s.tables);
  const rows = useData((s) => s.rows);
  const requestPageComments = useData((s) => s.requestPageComments);
  const openRow = useData((s) => s.openRow);
  const setCell = useData((s) => s.setCell);

  // Push a reminder forward by writing its datetime cell ahead of now. The bell
  // recomputes due reminders off the cell, so it drops out of the list at once.
  const snooze = (r: DueReminder, ms: number) => setCell(r.rowId, r.columnId, formatInstant(Date.now() + ms));

  const [items, setItems] = useState<Comment[]>([]);
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [mentionsSeen, setMentionsSeen] = useState<number>(() => Number(localStorage.getItem(MENTIONS_SEEN_KEY) ?? 0));
  const [remindersSeen, setRemindersSeen] = useState<number>(() => Number(localStorage.getItem(REMINDERS_SEEN_KEY) ?? 0));
  const [assignedSeen, setAssignedSeen] = useState<number>(() => Number(localStorage.getItem(ASSIGNED_SEEN_KEY) ?? 0));
  const [noticesSeen, setNoticesSeen] = useState<number>(() => Number(localStorage.getItem(NOTICES_SEEN_KEY) ?? 0));
  const [canNotify, setCanNotify] = useState<NotificationPermission>(
    typeof Notification !== 'undefined' ? Notification.permission : 'denied',
  );
  const notifiedRef = useRef<Set<string>>(new Set());
  const btnRef = useRef<HTMLButtonElement>(null);

  const load = () => {
    if (!me?.id) return;
    commentsApi
      .listMentioning(me.id)
      .then((list) => setItems(list.filter((c) => c.author !== me.id)))
      .catch(() => {});
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.id]);

  // Tick so reminders surface as their windows open without a manual refresh.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const due = useMemo<DueReminder[]>(() => dueReminders(tables, rows, now), [tables, rows, now]);
  const assignments = useMemo<Assignment[]>(() => assignedToMe(tables, rows, me?.id ?? ''), [tables, rows, me?.id]);
  // flowNotices is an in-memory array; re-read on the same tick the panel already runs.
  const notices = useMemo<BellNotice[]>(() => flowNoticesAll().slice(0, 20), [now, open]);

  // Fire a browser notification once per reminder per session (if allowed).
  useEffect(() => {
    if (canNotify !== 'granted') return;
    for (const r of due) {
      if (notifiedRef.current.has(r.key)) continue;
      notifiedRef.current.add(r.key);
      try {
        new Notification(`Reminder · ${r.fieldName}`, { body: `${r.title}, ${untilLabel(r.target, Date.now())}`, tag: r.key });
      } catch {
        /* some browsers block construction outside a user gesture */
      }
    }
  }, [due, canNotify]);

  const mentionUnread = items.filter((c) => new Date(c.created).getTime() > mentionsSeen).length;
  const reminderUnread = due.filter((r) => r.fireAt > remindersSeen).length;
  const assignedUnread = assignments.filter((a) => a.updated > assignedSeen).length;
  const noticeUnread = notices.filter((n) => n.at > noticesSeen).length;
  const unread = mentionUnread + reminderUnread + assignedUnread + noticeUnread;

  const openPanel = () => {
    setOpen(true);
    const t = Date.now();
    localStorage.setItem(MENTIONS_SEEN_KEY, String(t));
    localStorage.setItem(REMINDERS_SEEN_KEY, String(t));
    localStorage.setItem(ASSIGNED_SEEN_KEY, String(t));
    localStorage.setItem(NOTICES_SEEN_KEY, String(t));
    setMentionsSeen(t);
    setRemindersSeen(t);
    setAssignedSeen(t);
    setNoticesSeen(t);
  };

  const enableAlerts = () => {
    if (typeof Notification === 'undefined') return;
    void Notification.requestPermission().then((p) => {
      setCanNotify(p);
    });
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openPanel())}
        className="relative flex items-center rounded-lg border border-paper-line px-2 py-1.5 text-ink-soft transition-colors hover:bg-paper-panel dark:border-coal-line dark:text-coal-soft dark:hover:bg-coal-line"
        title="Notifications"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-clay px-1 text-[10px] font-bold text-white">
            {unread}
          </span>
        )}
      </button>

      <Popover open={open} onClose={() => setOpen(false)} anchorRef={btnRef} width={300} align="right">
        {notices.length > 0 && (
          <>
            <div className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint dark:text-coal-soft">
              Flow alerts
            </div>
            {notices.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => {
                  if (n.rowId) openRow(n.rowId);
                  setOpen(false);
                }}
                className="block w-full rounded-md px-2 py-1.5 text-left hover:bg-paper-panel dark:hover:bg-coal-line"
              >
                <div className="flex items-baseline gap-1.5">
                  <Zap className="h-3 w-3 shrink-0 self-center text-clay" />
                  <span className="truncate text-xs text-ink dark:text-coal-text">{n.text}</span>
                  <span className="ml-auto shrink-0 text-[10px] text-ink-faint dark:text-coal-soft">{timeAgo(new Date(n.at).toISOString())}</span>
                </div>
              </button>
            ))}
            <div className="my-1 border-t border-paper-line dark:border-coal-line" />
          </>
        )}
        {due.length > 0 && (
          <>
            <div className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint dark:text-coal-soft">
              Reminders
            </div>
            {due.map((r) => (
              <div key={r.key} className="rounded-md px-2 py-1.5 hover:bg-paper-panel dark:hover:bg-coal-line">
                <button
                  type="button"
                  onClick={() => {
                    openRow(r.rowId);
                    setOpen(false);
                  }}
                  className="block w-full text-left"
                >
                  <div className="flex items-baseline gap-1.5">
                    <AlarmClock className="h-3 w-3 shrink-0 self-center text-clay" />
                    <span className="truncate text-xs font-semibold text-ink dark:text-coal-text">{r.title}</span>
                    <span className="ml-auto shrink-0 text-[10px] text-clay">{untilLabel(r.target, now)}</span>
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-ink-soft dark:text-coal-soft">{r.fieldName}</p>
                </button>
                <div className="mt-1 flex items-center gap-1 pl-4">
                  <span className="text-[10px] text-ink-faint dark:text-coal-soft">snooze</span>
                  <button
                    type="button"
                    onClick={() => snooze(r, 3600_000)}
                    className="rounded bg-paper-panel px-1.5 text-[10px] text-ink-soft hover:bg-paper-line dark:bg-coal-line dark:text-coal-soft dark:hover:bg-coal"
                  >
                    1h
                  </button>
                  <button
                    type="button"
                    onClick={() => snooze(r, 86400_000)}
                    className="rounded bg-paper-panel px-1.5 text-[10px] text-ink-soft hover:bg-paper-line dark:bg-coal-line dark:text-coal-soft dark:hover:bg-coal"
                  >
                    1d
                  </button>
                </div>
              </div>
            ))}
            {canNotify === 'default' && (
              <button
                type="button"
                onClick={enableAlerts}
                className="mt-0.5 block w-full rounded-md px-2 py-1 text-left text-[11px] text-clay hover:bg-paper-panel dark:hover:bg-coal-line"
              >
                Enable browser alerts
              </button>
            )}
            <div className="my-1 border-t border-paper-line dark:border-coal-line" />
          </>
        )}

        {assignments.length > 0 && (
          <>
            <div className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint dark:text-coal-soft">
              Assigned to you
            </div>
            {assignments.slice(0, 20).map((a) => (
              <button
                key={a.key}
                type="button"
                onClick={() => {
                  openRow(a.rowId);
                  setOpen(false);
                }}
                className="block w-full rounded-md px-2 py-1.5 text-left hover:bg-paper-panel dark:hover:bg-coal-line"
              >
                <div className="flex items-baseline gap-1.5">
                  <UserCheck className="h-3 w-3 shrink-0 self-center text-clay" />
                  <span className="truncate text-xs font-semibold text-ink dark:text-coal-text">{a.title}</span>
                </div>
                <p className="mt-0.5 truncate text-[11px] text-ink-soft dark:text-coal-soft">{a.fieldName}</p>
              </button>
            ))}
            <div className="my-1 border-t border-paper-line dark:border-coal-line" />
          </>
        )}

        <div className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint dark:text-coal-soft">
          Mentions
        </div>
        {items.length === 0 && (
          <p className="px-2 py-3 text-center text-xs text-ink-faint dark:text-coal-soft">
            No mentions yet. When someone @-mentions you in a comment, it shows up here.
          </p>
        )}
        {items.slice(0, 20).map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => {
              requestPageComments(c.page);
              setOpen(false);
            }}
            className="block w-full rounded-md px-2 py-1.5 text-left hover:bg-paper-panel dark:hover:bg-coal-line"
          >
            <div className="flex items-baseline gap-1.5">
              <span className="text-xs font-semibold text-ink dark:text-coal-text">{c.authorName}</span>
              <span className="truncate text-[11px] text-ink-faint dark:text-coal-soft">
                in {pages[c.page]?.title || 'a page'}
              </span>
              <span className="ml-auto shrink-0 text-[10px] text-ink-faint dark:text-coal-soft">{timeAgo(c.created)}</span>
            </div>
            <p className="mt-0.5 line-clamp-2 text-xs text-ink-soft dark:text-coal-soft">
              {isEnvelope(c.body) ? '🔒 mentioned you in a private thread' : c.body}
            </p>
          </button>
        ))}
      </Popover>
    </>
  );
}
