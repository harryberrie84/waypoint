import { useEffect, useRef, useState } from 'react';
import { MessageSquare, Send, Trash2, X } from 'lucide-react';
import { pb } from '../lib/pocketbase';
import { commentsApi, type Member } from '../lib/api';
import type { Comment } from '../types';
import type { RecordModel } from 'pocketbase';
import { useAuth } from '../store/useAuth';
import { useData } from '../store/useData';
import { useWorkspace } from '../store/useWorkspace';
import { useVault } from '../store/useVault';
import { useWorkspaceKeys } from '../store/useWorkspaceKeys';
import { useMembers } from '../hooks/useMembers';
import { parseMentions, mentionSegments, activeMentionQuery } from '../lib/mentions';
import { isEnvelope } from '../lib/crypto';

// ---------------------------------------------------------------------------
// Comments, live discussion thread for a page, or for a single table row.
// ---------------------------------------------------------------------------
// Loads comments for the active target (page, or row when `rowId` is given) and
// subscribes to the `comments` collection over SSE, filtering in the handler so
// new comments from other users appear instantly. Row threads carry the page id
// too (the required relation) but are kept off the page thread.

function toComment(r: RecordModel): Comment {
  return {
    id: r.id,
    page: r.page ?? '',
    row: r.row ?? '',
    thread: r.thread ?? '',
    author: r.author ?? '',
    authorName: r.authorName ?? 'Someone',
    body: r.body ?? '',
    mentions: Array.isArray(r.mentions) ? (r.mentions as string[]) : [],
    created: r.created,
    updated: r.updated,
  };
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function CommentsPanel({ pageId, rowId, onClose }: { pageId: string; rowId?: string; onClose?: () => void }) {
  const user = useAuth((s) => s.user);
  const [comments, setComments] = useState<Comment[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const members = useMembers();
  // Comment bodies are encrypted in an encrypted workspace; mentions stay plain
  // (the server hook needs the ids). Decrypted bodies are cached for display.
  const workspaceId = useData((s) => s.pages[pageId]?.workspace ?? '');
  const wsEncrypted = useWorkspace((s) => (workspaceId ? s.encryptedEnabled(workspaceId) : false));
  const vaultStatus = useVault((s) => s.status);
  const encryptForWorkspace = useWorkspaceKeys((s) => s.encryptForWorkspace);
  const decryptForWorkspace = useWorkspaceKeys((s) => s.decryptForWorkspace);
  // Retry decryption once the workspace key is actually cached, so a freshly
  // posted (or flow-posted) encrypted comment resolves instead of sticking on
  // the "locked" placeholder.
  const wsKeyReady = useWorkspaceKeys((s) => (workspaceId ? !!s.keys[workspaceId] : true));
  // Keyed by comment id, holds the envelope it was decrypted from and the plain
  // text, so an edit on another device (a new envelope) re-decrypts instead of
  // showing the stale cached text.
  const [bodyCache, setBodyCache] = useState<Record<string, { env: string; plain: string }>>({});
  const [mq, setMq] = useState<{ query: string; start: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const belongs = (c: Comment) => (rowId ? c.row === rowId : c.page === pageId && !c.row && !c.thread);

  const matches = mq
    ? members.filter((m) => m.name.toLowerCase().includes(mq.query.toLowerCase())).slice(0, 6)
    : [];

  const onDraftChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setDraft(e.target.value);
    setMq(activeMentionQuery(e.target.value, e.target.selectionStart ?? e.target.value.length));
  };

  const pickMention = (m: Member) => {
    if (!mq) return;
    const before = draft.slice(0, mq.start);
    const after = draft.slice(mq.start + 1 + mq.query.length);
    const next = `${before}@${m.name} ${after}`;
    setDraft(next);
    setMq(null);
    requestAnimationFrame(() => taRef.current?.focus());
  };

  useEffect(() => {
    let cancelled = false;
    let unsub: (() => void) | null = null;

    const load = async () => {
      try {
        const list = rowId ? await commentsApi.listForRow(rowId) : await commentsApi.listForPage(pageId);
        if (!cancelled) setComments(list);
      } catch {
        if (!cancelled) setComments([]);
      }
    };

    void load();

    void pb
      .collection('comments')
      .subscribe('*', (e) => {
        const { action, record } = e as { action: string; record: RecordModel };
        const c = toComment(record);
        if (!belongs(c)) return;
        setComments((prev) => {
          if (action === 'delete') return prev.filter((x) => x.id !== c.id);
          const exists = prev.some((x) => x.id === c.id);
          const next = exists ? prev.map((x) => (x.id === c.id ? c : x)) : [...prev, c];
          return next.sort((a, b) => a.created.localeCompare(b.created));
        });
      })
      .then((fn) => {
        unsub = fn;
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      if (unsub) unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId, rowId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [comments.length]);

  // Decrypt any encrypted comment bodies for display. Re-decrypts when the body
  // envelope changed (an edit on another device), not only when it's missing.
  useEffect(() => {
    const enc = comments.filter((c) => isEnvelope(c.body) && bodyCache[c.id]?.env !== c.body);
    if (!enc.length || !workspaceId) return;
    let alive = true;
    void (async () => {
      const updates: Record<string, { env: string; plain: string }> = {};
      for (const c of enc) {
        try {
          const plain = await decryptForWorkspace(workspaceId, c.body);
          if (typeof plain === 'string') updates[c.id] = { env: c.body, plain };
        } catch {
          /* leave it; a locked placeholder shows */
        }
      }
      if (alive && Object.keys(updates).length) setBodyCache((m) => ({ ...m, ...updates }));
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comments, workspaceId, vaultStatus, wsKeyReady]);

  const submit = async () => {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      let toSend = body;
      if (wsEncrypted) {
        // Encrypt the body; never send plaintext to an encrypted workspace.
        if (vaultStatus !== 'unlocked') {
          setBusy(false);
          return;
        }
        const env = await encryptForWorkspace(workspaceId, body);
        if (!env) {
          setBusy(false);
          return;
        }
        toSend = env;
      }
      await commentsApi.create(pageId, toSend, parseMentions(body, members), rowId ?? '');
      setDraft('');
      setMq(null);
    } catch (err) {
      console.error('[comments] create failed', err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-paper-line px-4 py-3 dark:border-coal-line">
        <MessageSquare className="h-4 w-4 text-clay" />
        <span className="text-sm font-semibold text-ink dark:text-coal-text">Comments</span>
        <span className="ml-auto text-xs text-ink-faint dark:text-coal-soft">{comments.length}</span>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            title="Close comments"
            className="-mr-1 rounded-md p-1 text-ink-faint hover:bg-paper-panel hover:text-ink dark:text-coal-soft dark:hover:bg-coal-line dark:hover:text-coal-text"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {comments.length === 0 && (
          <p className="pt-4 text-center text-xs text-ink-faint dark:text-coal-soft">
            No comments yet. Start the conversation.
          </p>
        )}
        {comments.map((c) => {
          const mine = user?.id === c.author;
          const shown = bodyCache[c.id]?.plain ?? (isEnvelope(c.body) ? '🔒 locked' : c.body);
          return (
            <div key={c.id} className="group">
              <div className="flex items-baseline gap-2">
                <span className="text-xs font-semibold text-ink dark:text-coal-text">{c.authorName}</span>
                <span className="text-[10px] text-ink-faint dark:text-coal-soft">{timeAgo(c.created)}</span>
                {mine && (
                  <button
                    type="button"
                    onClick={() => commentsApi.remove(c.id).catch(() => {})}
                    className="invisible ml-auto rounded p-0.5 text-ink-faint hover:text-red-500 group-hover:visible"
                    title="Delete comment"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>
              <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-ink-soft dark:text-coal-soft">
                {mentionSegments(shown, members).map((seg, i) =>
                  seg.member ? (
                    <span key={i} className="rounded bg-clay-wash px-0.5 font-medium text-clay dark:bg-clay/20">
                      {seg.text}
                    </span>
                  ) : (
                    <span key={i}>{seg.text}</span>
                  ),
                )}
              </p>
            </div>
          );
        })}
      </div>

      <div className="border-t border-paper-line p-3 dark:border-coal-line">
        <div className="relative flex items-end gap-2">
          {mq && matches.length > 0 && (
            <div className="absolute bottom-full left-0 mb-1 w-56 overflow-hidden rounded-lg border border-paper-line bg-paper shadow-xl dark:border-coal-line dark:bg-coal-panel">
              {matches.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pickMention(m);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-ink hover:bg-paper-panel dark:text-coal-text dark:hover:bg-coal-line"
                >
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-clay text-[10px] font-bold text-white">
                    {m.name.slice(0, 1).toUpperCase()}
                  </span>
                  {m.name}
                </button>
              ))}
            </div>
          )}
          <textarea
            ref={taRef}
            value={draft}
            onChange={onDraftChange}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setMq(null);
                return;
              }
              if (e.key === 'Enter' && !e.shiftKey) {
                if (mq && matches.length > 0) {
                  e.preventDefault();
                  pickMention(matches[0]);
                  return;
                }
                e.preventDefault();
                void submit();
              }
            }}
            rows={2}
            placeholder="Add a comment…  (@ to mention, Enter to send)"
            className="min-h-[40px] flex-1 resize-none rounded-lg border border-paper-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-clay dark:border-coal-line dark:bg-coal dark:text-coal-text"
          />
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || !draft.trim()}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-clay text-white transition-opacity hover:bg-clay-soft disabled:opacity-40"
            title="Send"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
