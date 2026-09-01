import { useMemo, useState } from 'react';
import { Lock, Globe, X, UserPlus, Link2, Copy, Check } from 'lucide-react';
import { useData, canManageSharing, selectMyRole } from '../store/useData';
import { type Member } from '../lib/api';
import { isEnvelope } from '../lib/crypto';
import { useAuth } from '../store/useAuth';
import { useMembers } from '../hooks/useMembers';
import type { ShareRole } from '../types';

// SharePanel, per-page sharing. The owner sets visibility (workspace vs
// private) and, when private, grants specific members a viewer/editor role.
// Roles live as `editors` / `viewers` user-id arrays on the page record.

interface Props {
  pageId: string;
  open: boolean;
  onClose: () => void;
}

interface ShareRow {
  id: string;
  name: string;
  role: ShareRole;
}

export function SharePanel({ pageId, open, onClose }: Props) {
  const me = useAuth((s) => s.user);
  const page = useData((s) => s.pages[pageId]);
  const role = useData((s) => selectMyRole(s.pages, pageId, me?.id ?? null));
  const setPageVisibility = useData((s) => s.setPageVisibility);
  const setShare = useData((s) => s.setShare);
  const removeShare = useData((s) => s.removeShare);
  const setPagePublic = useData((s) => s.setPagePublic);
  const [copied, setCopied] = useState(false);

  const members = useMembers();

  // Resolve the editor/viewer id arrays to display names.
  const nameFor = useMemo(() => {
    const map = new Map(members.map((m) => [m.id, m.name]));
    return (id: string) =>
      id === me?.id ? `${map.get(id) ?? me?.name ?? 'You'} (you)` : map.get(id) ?? 'Member';
  }, [members, me]);

  if (!open || !page) return null;
  const manage = canManageSharing(role);
  const isPrivate = page.visibility === 'private';

  const shareRows: ShareRow[] = [
    ...page.editors.map((id) => ({ id, name: nameFor(id), role: 'editor' as ShareRole })),
    ...page.viewers.map((id) => ({ id, name: nameFor(id), role: 'viewer' as ShareRole })),
  ].sort((a, b) => a.name.localeCompare(b.name));

  const sharedIds = new Set([page.owner, ...page.editors, ...page.viewers]);
  const addable = members.filter((m) => !sharedIds.has(m.id));

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/30 pt-[14vh] backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-xl border border-paper-line bg-paper shadow-2xl dark:border-coal-line dark:bg-coal-panel"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-paper-line px-4 py-3 dark:border-coal-line">
          <span className="flex-1 text-sm font-semibold text-ink dark:text-coal-text">
            Share &ldquo;{page.title || 'Untitled'}&rdquo;
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-ink-faint hover:bg-paper-panel dark:hover:bg-coal-line"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4">
          {/* Visibility */}
          <div className="mb-4 grid grid-cols-2 gap-2">
            {(['workspace', 'private'] as const).map((v) => {
              const Icon = v === 'workspace' ? Globe : Lock;
              const selected = page.visibility === v;
              return (
                <button
                  key={v}
                  type="button"
                  disabled={!manage}
                  onClick={() => setPageVisibility(pageId, v)}
                  className={[
                    'flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm',
                    selected
                      ? 'border-clay bg-clay-wash text-clay dark:border-clay dark:bg-clay/15 dark:text-clay-soft'
                      : 'border-paper-line text-ink-soft dark:border-coal-line dark:text-coal-soft',
                    manage ? 'hover:border-clay/60' : 'cursor-default opacity-70',
                  ].join(' ')}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>
                    <span className="block font-medium">{v === 'workspace' ? 'Workspace' : 'Private'}</span>
                    <span className="block text-[11px] opacity-80">
                      {v === 'workspace' ? 'All members can edit' : 'Only people you add'}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          {/* Public read-only link, owner-only and only for plaintext pages
              (an encrypted page has no key to hand out). */}
          {manage && !isEnvelope(page.content) && (
            <div className="mb-4 rounded-lg border border-paper-line p-3 dark:border-coal-line">
              <div className="flex items-center gap-2">
                <Link2 className="h-4 w-4 shrink-0 text-ink-faint dark:text-coal-soft" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-ink dark:text-coal-text">Public link</div>
                  <p className="text-[11px] text-ink-faint dark:text-coal-soft">anyone with the link can read this page, no account needed.</p>
                </div>
                <button
                  type="button"
                  onClick={() => void setPagePublic(pageId, !page.publicToken)}
                  className="shrink-0 rounded-md border border-paper-line px-2.5 py-1 text-xs font-medium text-ink-soft hover:bg-paper-panel dark:border-coal-line dark:text-coal-soft dark:hover:bg-coal-line"
                >
                  {page.publicToken ? 'turn off' : 'create link'}
                </button>
              </div>
              {page.publicToken && (
                <div className="mt-2 flex items-center gap-1.5">
                  <input
                    readOnly
                    value={`${location.origin}${location.pathname}?share=${page.publicToken}`}
                    onFocus={(e) => e.currentTarget.select()}
                    className="min-w-0 flex-1 rounded-md border border-paper-line bg-paper px-2 py-1 font-mono text-[11px] text-ink-soft outline-none dark:border-coal-line dark:bg-coal dark:text-coal-soft"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard?.writeText(`${location.origin}${location.pathname}?share=${page.publicToken}`);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    }}
                    className="flex shrink-0 items-center gap-1 rounded-md bg-clay px-2 py-1 text-xs font-medium text-white hover:bg-clay/90"
                  >
                    {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied ? 'copied' : 'copy'}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* People with access (only meaningful when private) */}
          {isPrivate && (
            <div className="space-y-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint dark:text-coal-soft">
                People with access
              </p>

              <div className="flex items-center gap-2 rounded-lg px-1 py-1.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-clay/15 text-xs font-semibold text-clay">
                  {nameFor(page.owner).slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-ink dark:text-coal-text">
                  {nameFor(page.owner)}
                </span>
                <span className="text-xs text-ink-faint dark:text-coal-soft">Owner</span>
              </div>

              {shareRows.map((r) => (
                <div key={r.id} className="flex items-center gap-2 rounded-lg px-1 py-1.5">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-paper-panel text-xs font-semibold text-ink-soft dark:bg-coal-line dark:text-coal-soft">
                    {r.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-ink dark:text-coal-text">{r.name}</span>
                  {manage ? (
                    <>
                      <select
                        value={r.role}
                        onChange={(e) => setShare(pageId, r.id, e.target.value as ShareRole)}
                        className="rounded-md border border-paper-line bg-paper px-1.5 py-1 text-xs text-ink dark:border-coal-line dark:bg-coal dark:text-coal-text"
                      >
                        <option value="viewer">Viewer</option>
                        <option value="editor">Editor</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => removeShare(pageId, r.id)}
                        className="rounded p-1 text-ink-faint hover:text-red-500"
                        title="Remove"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </>
                  ) : (
                    <span className="text-xs capitalize text-ink-faint dark:text-coal-soft">{r.role}</span>
                  )}
                </div>
              ))}

              {manage && <AddMember addable={addable} onAdd={(m, r) => setShare(pageId, m.id, r)} />}
              {!manage && (
                <p className="px-1 pt-1 text-[11px] text-ink-faint dark:text-coal-soft">
                  Only the owner can change sharing.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AddMember({ addable, onAdd }: { addable: Member[]; onAdd: (m: Member, role: ShareRole) => void }) {
  const [memberId, setMemberId] = useState('');
  const [role, setRole] = useState<ShareRole>('editor');

  return (
    <div className="mt-2 flex items-center gap-1.5 border-t border-paper-line pt-2 dark:border-coal-line">
      <select
        value={memberId}
        onChange={(e) => setMemberId(e.target.value)}
        className="min-w-0 flex-1 rounded-md border border-paper-line bg-paper px-2 py-1.5 text-xs text-ink dark:border-coal-line dark:bg-coal dark:text-coal-text"
      >
        <option value="">Add a member&hellip;</option>
        {addable.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
      <select
        value={role}
        onChange={(e) => setRole(e.target.value as ShareRole)}
        className="rounded-md border border-paper-line bg-paper px-1.5 py-1.5 text-xs text-ink dark:border-coal-line dark:bg-coal dark:text-coal-text"
      >
        <option value="editor">Editor</option>
        <option value="viewer">Viewer</option>
      </select>
      <button
        type="button"
        disabled={!memberId}
        onClick={() => {
          const m = addable.find((x) => x.id === memberId);
          if (m) {
            onAdd(m, role);
            setMemberId('');
          }
        }}
        className="flex items-center gap-1 rounded-md bg-clay px-2 py-1.5 text-xs font-semibold text-white hover:bg-clay-soft disabled:opacity-40"
      >
        <UserPlus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
