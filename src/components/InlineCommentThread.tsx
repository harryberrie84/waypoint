import { useCallback, useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { Send, Trash2, Check, X } from 'lucide-react';
import { pb } from '../lib/pocketbase';
import { commentsApi } from '../lib/api';
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

// A small popover for an inline-comment thread: the comments anchored to one
// highlighted span (matched by thread id), plus a composer. Mirrors the page
// CommentsPanel's encryption and realtime, scaled down to a card. Resolving
// removes the editor mark and deletes the thread's comments.

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

function removeThreadMark(editor: Editor, threadId: string): void {
  const { state } = editor;
  let tr = state.tr;
  state.doc.descendants((node, pos) => {
    if (!node.isText) return;
    for (const m of node.marks) {
      if (m.type.name === 'inlineComment' && m.attrs.threadId === threadId) {
        tr = tr.removeMark(pos, pos + node.nodeSize, m.type);
      }
    }
  });
  if (tr.docChanged) editor.view.dispatch(tr);
}

export function InlineCommentThread({
  editor,
  pageId,
  onFirstComment,
}: {
  editor: Editor | null;
  pageId: string;
  // Fired after the FIRST comment on a thread is posted, so a caller that opened a
  // not-yet-persisted thread (the Moodboard, anchoring on an image) can write it in
  // only once it's real, never on an opened-then-abandoned thread.
  onFirstComment?: (threadId: string) => void;
}) {
  const thread = useData((s) => s.commentThread);
  const close = useData((s) => s.closeCommentThread);
  const user = useAuth((s) => s.user);
  const members = useMembers();

  const workspaceId = useData((s) => s.pages[pageId]?.workspace ?? '');
  const wsEncrypted = useWorkspace((s) => (workspaceId ? s.encryptedEnabled(workspaceId) : false));
  const vaultStatus = useVault((s) => s.status);
  const encryptForWorkspace = useWorkspaceKeys((s) => s.encryptForWorkspace);
  const decryptForWorkspace = useWorkspaceKeys((s) => s.decryptForWorkspace);
  const wsKeyReady = useWorkspaceKeys((s) => (workspaceId ? !!s.keys[workspaceId] : true));

  const [comments, setComments] = useState<Comment[]>([]);
  const [bodyCache, setBodyCache] = useState<Record<string, { env: string; plain: string }>>({});
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [mq, setMq] = useState<{ query: string; start: number } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const threadId = thread?.threadId ?? '';

  // Closing a thread that never got a comment removes its mark, so selecting text
  // and changing your mind doesn't leave an empty highlight + badge behind.
  const commentsRef = useRef<Comment[]>([]);
  useEffect(() => {
    commentsRef.current = comments;
  }, [comments]);
  const handleClose = useCallback(() => {
    if (editor && threadId && commentsRef.current.length === 0) removeThreadMark(editor, threadId);
    close();
  }, [editor, threadId, close]);

  // Load + subscribe to this thread's comments.
  useEffect(() => {
    if (!threadId) return;
    let cancelled = false;
    let unsub: (() => void) | null = null;
    void commentsApi
      .listForThread(threadId)
      .then((list) => {
        if (!cancelled) setComments(list);
      })
      .catch(() => {
        if (!cancelled) setComments([]);
      });
    void pb
      .collection('comments')
      .subscribe('*', (e) => {
        const { action, record } = e as { action: string; record: RecordModel };
        const c = toComment(record);
        if (c.thread !== threadId) return;
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
  }, [threadId]);

  // Focus the composer when the thread opens.
  useEffect(() => {
    if (threadId) requestAnimationFrame(() => taRef.current?.focus());
  }, [threadId]);

  // Decrypt encrypted bodies.
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
          /* a locked placeholder shows */
        }
      }
      if (alive && Object.keys(updates).length) setBodyCache((m) => ({ ...m, ...updates }));
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comments, workspaceId, vaultStatus, wsKeyReady]);

  // Close on click outside or Escape.
  useEffect(() => {
    if (!threadId) return;
    const onDown = (e: MouseEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) handleClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    // Defer so the opening click doesn't immediately close it.
    const t = setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [threadId, handleClose]);

  if (!thread) return null;

  const matches = mq
    ? members.filter((m) => m.name.toLowerCase().includes(mq.query.toLowerCase())).slice(0, 5)
    : [];

  const onDraftChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setDraft(e.target.value);
    setMq(activeMentionQuery(e.target.value, e.target.selectionStart ?? e.target.value.length));
  };

  const pickMention = (name: string) => {
    if (!mq) return;
    const before = draft.slice(0, mq.start);
    const after = draft.slice(mq.start + 1 + mq.query.length);
    setDraft(`${before}@${name} ${after}`);
    setMq(null);
    requestAnimationFrame(() => taRef.current?.focus());
  };

  const submit = async () => {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      let toSend = body;
      if (wsEncrypted) {
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
      const wasFirst = commentsRef.current.length === 0;
      await commentsApi.create(pageId, toSend, parseMentions(body, members), '', threadId);
      if (wasFirst) onFirstComment?.(threadId);
      setDraft('');
      setMq(null);
    } catch (err) {
      console.error('[inline comment] create failed', err);
    } finally {
      setBusy(false);
    }
  };

  const resolve = async () => {
    if (editor) removeThreadMark(editor, threadId);
    for (const c of comments) await commentsApi.remove(c.id).catch(() => {});
    close();
  };

  // Position the card, clamped to the viewport.
  const width = 288;
  const left = Math.max(8, Math.min(thread.left, window.innerWidth - width - 8));
  const top = Math.min(thread.top + 8, window.innerHeight - 80);

  return (
    <div
      ref={cardRef}
      style={{ position: 'fixed', top, left, width }}
      className="z-[120] flex max-h-[60vh] flex-col overflow-hidden rounded-xl border border-paper-line bg-paper shadow-2xl dark:border-coal-line dark:bg-coal-panel"
    >
      <div className="flex items-center gap-2 border-b border-paper-line px-3 py-1.5 dark:border-coal-line">
        <span className="text-xs font-semibold text-ink dark:text-coal-text">Comment</span>
        <span className="ml-auto flex items-center gap-1">
          {comments.length > 0 && (
            <button
              type="button"
              onClick={() => void resolve()}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-ink-faint hover:bg-paper-panel hover:text-emerald-600 dark:hover:bg-coal-line"
              title="Resolve: remove the highlight and this thread"
            >
              <Check className="h-3 w-3" /> Resolve
            </button>
          )}
          <button type="button" onClick={handleClose} className="rounded p-0.5 text-ink-faint hover:text-clay" title="Close">
            <X className="h-3.5 w-3.5" />
          </button>
        </span>
      </div>

      <div className="flex-1 space-y-2.5 overflow-y-auto px-3 py-2">
        {comments.length === 0 && <p className="text-xs text-ink-faint dark:text-coal-soft">Add the first note on this text.</p>}
        {comments.map((c) => {
          const mine = user?.id === c.author;
          const shown = bodyCache[c.id]?.plain ?? (isEnvelope(c.body) ? '🔒 locked' : c.body);
          return (
            <div key={c.id} className="group">
              <div className="flex items-baseline gap-2">
                <span className="text-xs font-semibold text-ink dark:text-coal-text">{c.authorName}</span>
                {mine && (
                  <button
                    type="button"
                    onClick={() => commentsApi.remove(c.id).catch(() => {})}
                    className="invisible ml-auto rounded p-0.5 text-ink-faint hover:text-red-500 group-hover:visible"
                    title="Delete"
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

      <div className="relative border-t border-paper-line p-2 dark:border-coal-line">
        {mq && matches.length > 0 && (
          <div className="absolute bottom-full left-2 mb-1 w-52 overflow-hidden rounded-lg border border-paper-line bg-paper shadow-xl dark:border-coal-line dark:bg-coal-panel">
            {matches.map((m) => (
              <button
                key={m.id}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  pickMention(m.name);
                }}
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm text-ink hover:bg-paper-panel dark:text-coal-text dark:hover:bg-coal-line"
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-clay text-[10px] font-bold text-white">
                  {m.name.slice(0, 1).toUpperCase()}
                </span>
                {m.name}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-end gap-1.5">
          <textarea
            ref={taRef}
            value={draft}
            onChange={onDraftChange}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                if (mq) {
                  setMq(null);
                  e.stopPropagation();
                }
                return;
              }
              if (e.key === 'Enter' && !e.shiftKey) {
                if (mq && matches.length > 0) {
                  e.preventDefault();
                  pickMention(matches[0].name);
                  return;
                }
                e.preventDefault();
                void submit();
              }
            }}
            rows={2}
            placeholder="Reply…  (@ to mention)"
            className="min-h-[38px] flex-1 resize-none rounded-lg border border-paper-line bg-paper px-2.5 py-1.5 text-sm text-ink outline-none focus:border-clay dark:border-coal-line dark:bg-coal dark:text-coal-text"
          />
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || !draft.trim()}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-clay text-white transition-opacity hover:bg-clay-soft disabled:opacity-40"
            title="Send"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
