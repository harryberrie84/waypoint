import { useEffect, useRef, useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { Vote, Check, Plus, Trash2, Trophy, GripVertical } from 'lucide-react';
import { useAuth } from '../store/useAuth';
import { useMembers } from '../hooks/useMembers';
import { initials, avatarColor } from '../lib/avatar';
import { WidgetIO } from './WidgetIO';
import { serializeVote, parseVote, VOTE_TEMPLATE } from '../lib/voteIO';
import { toast } from '../store/useToast';

// voteBlock, a live "decide together" poll for a couple/crew: options with a
// one-tap ❤️ vote each, live tallies + bars, the leader crowned, and the voters'
// avatars. Single-choice or approval (multi) voting. Votes live in the block
// attrs (a `voters` id list per option), so they ride the page's normal sync and
// everyone sees the count update. Styled like the countdown / custom-count cards.

interface VoteOption {
  id: string;
  text: string;
  voters: string[]; // user ids
}

function newId(): string {
  return Math.random().toString(36).slice(2, 9);
}

function readOptions(attrs: Record<string, unknown>): VoteOption[] {
  const raw = attrs.options;
  return Array.isArray(raw) ? (raw as VoteOption[]) : [];
}

function VoterDots({ ids, members }: { ids: string[]; members: readonly { id: string; name: string }[] }) {
  if (ids.length === 0) return null;
  return (
    <span className="flex -space-x-1.5">
      {ids.slice(0, 5).map((id) => {
        const name = members.find((m) => m.id === id)?.name ?? 'Someone';
        return (
          <span
            key={id}
            title={name}
            className="flex h-4 w-4 items-center justify-center rounded-full border border-paper text-[8px] font-semibold text-white dark:border-coal-panel"
            style={{ backgroundColor: avatarColor(id) }}
          >
            {initials(name)}
          </span>
        );
      })}
      {ids.length > 5 && <span className="flex h-4 w-4 items-center justify-center rounded-full border border-paper bg-ink-faint text-[8px] font-semibold text-white dark:border-coal-panel">+{ids.length - 5}</span>}
    </span>
  );
}

function VoteView({ node, updateAttributes, editor }: NodeViewProps) {
  const editable = editor.isEditable;
  const question = (node.attrs.question as string) || '';
  const multi = node.attrs.multi !== false; // default: approval (multi) voting
  const options = readOptions(node.attrs);
  const myId = useAuth((s) => s.user?.id ?? '');
  const members = useMembers();
  const [editing, setEditing] = useState(false);

  const write = (patch: Record<string, unknown>) => updateAttributes(patch);
  const setOptions = (next: VoteOption[]) => write({ options: next });
  const patchOption = (id: string, p: Partial<VoteOption>) => setOptions(options.map((o) => (o.id === id ? { ...o, ...p } : o)));
  const addOption = () => setOptions([...options, { id: newId(), text: '', voters: [] }]);
  const removeOption = (id: string) => setOptions(options.filter((o) => o.id !== id));

  const vote = (id: string) => {
    if (!myId) return;
    setOptions(
      options.map((o) => {
        const has = o.voters.includes(myId);
        if (o.id === id) return { ...o, voters: has ? o.voters.filter((v) => v !== myId) : [...o.voters, myId] };
        // Single-choice: drop my vote from the others.
        if (!multi && !has) return { ...o, voters: o.voters.filter((v) => v !== myId) };
        return o;
      }),
    );
  };

  const exportText = () => serializeVote(question, multi, options.map((o) => ({ text: o.text })));
  const importText = (text: string): boolean => {
    const parsed = parseVote(text);
    if (parsed.options.length === 0) {
      toast('Nothing to import, check the format', 'error');
      return false;
    }
    // Fresh poll: new option ids, votes start empty.
    write({ question: parsed.question || question, multi: parsed.multi, options: parsed.options.map((o) => ({ id: newId(), text: o.text, voters: [] })) });
    toast(`Imported ${parsed.options.length} options`);
    return true;
  };

  // Seed one option so /vote opens ready to fill in.
  const seeded = useRef(false);
  useEffect(() => {
    if (!seeded.current && editable && options.length === 0) {
      seeded.current = true;
      addOption();
      setEditing(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const max = Math.max(1, ...options.map((o) => o.voters.length));
  const totalVoters = new Set(options.flatMap((o) => o.voters)).size;
  const leaders = options.filter((o) => o.voters.length === max && o.voters.length > 0);
  const decided = leaders.length === 1 && totalVoters > 0;

  return (
    <NodeViewWrapper className="my-3" contentEditable={false}>
      <div className="overflow-hidden rounded-xl border border-paper-line bg-gradient-to-br from-clay-wash/50 to-paper-panel/40 dark:border-coal-line dark:from-clay/10 dark:to-coal/40">
        <div className="flex items-center gap-2 px-3 pt-3">
          <Vote className="h-4 w-4 shrink-0 text-clay" />
          {editing && editable ? (
            <input
              value={question}
              onChange={(e) => write({ question: e.target.value })}
              placeholder="What are we deciding?"
              className="min-w-0 flex-1 rounded-lg border border-paper-line bg-paper px-2 py-1 text-sm font-semibold text-ink outline-none dark:border-coal-line dark:bg-coal-panel dark:text-coal-text"
            />
          ) : (
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink dark:text-coal-text">{question || 'Vote'}</span>
          )}
          <span className="shrink-0 text-[11px] text-ink-faint dark:text-coal-soft">{totalVoters} voted</span>
          {editable && (
            <button
              type="button"
              onClick={() => setEditing((e) => !e)}
              className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-ink-soft hover:bg-paper-panel dark:text-coal-soft dark:hover:bg-coal-line"
            >
              {editing ? 'Done' : 'Edit'}
            </button>
          )}
        </div>

        <div className="space-y-1.5 p-3">
          {options.map((o) => {
            const count = o.voters.length;
            const mine = myId ? o.voters.includes(myId) : false;
            const pct = totalVoters ? Math.round((count / max) * 100) : 0;
            const winning = decided && leaders[0].id === o.id;
            return (
              <div key={o.id} className="flex items-center gap-2">
                {editing && editable ? (
                  <>
                    <GripVertical className="h-3.5 w-3.5 shrink-0 text-ink-faint dark:text-coal-soft" />
                    <input
                      value={o.text}
                      onChange={(e) => patchOption(o.id, { text: e.target.value })}
                      placeholder="An option…"
                      className="min-w-0 flex-1 rounded-lg border border-paper-line bg-paper px-2 py-1.5 text-sm text-ink outline-none dark:border-coal-line dark:bg-coal-panel dark:text-coal-text"
                    />
                    <button type="button" onClick={() => removeOption(o.id)} title="Remove option" className="shrink-0 rounded-md p-1 text-ink-faint hover:bg-paper-panel hover:text-rose-500 dark:hover:bg-coal-line">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => vote(o.id)}
                    disabled={!myId}
                    title={mine ? 'Remove your vote' : 'Vote for this'}
                    className={[
                      'relative flex min-w-0 flex-1 items-center gap-2 overflow-hidden rounded-lg border px-2.5 py-2 text-left transition-colors',
                      mine ? 'border-clay bg-clay-wash/60 dark:border-clay dark:bg-clay/15' : 'border-paper-line bg-paper hover:border-clay/60 dark:border-coal-line dark:bg-coal-panel',
                    ].join(' ')}
                  >
                    {/* result bar */}
                    <span className="absolute inset-y-0 left-0 -z-0 rounded-lg bg-clay/10 transition-[width] duration-300 dark:bg-clay/15" style={{ width: `${pct}%` }} />
                    <span
                      className={[
                        'relative z-10 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors',
                        mine ? 'border-clay bg-clay text-white' : 'border-paper-line text-transparent dark:border-coal-line',
                      ].join(' ')}
                    >
                      <Check className="h-3 w-3" />
                    </span>
                    <span className="relative z-10 min-w-0 flex-1 truncate text-sm text-ink dark:text-coal-text">{o.text || 'Untitled option'}</span>
                    {winning && <Trophy className="relative z-10 h-3.5 w-3.5 shrink-0 text-ochre" />}
                    <VoterDots ids={o.voters} members={members} />
                    <span className="relative z-10 w-5 shrink-0 text-right text-xs font-semibold tabular-nums text-ink-soft dark:text-coal-soft">{count}</span>
                  </button>
                )}
              </div>
            );
          })}

          {editing && editable && (
            <button
              type="button"
              onClick={addOption}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-paper-line py-1.5 text-sm text-ink-faint hover:border-clay hover:text-clay dark:border-coal-line"
            >
              <Plus className="h-4 w-4" /> Add an option
            </button>
          )}
        </div>

        {editing && editable && (
          <div className="flex items-center gap-2 border-t border-paper-line px-3 py-2 text-[11px] text-ink-soft dark:border-coal-line dark:text-coal-soft">
            <label className="flex cursor-pointer items-center gap-1.5">
              <input type="checkbox" checked={multi} onChange={(e) => write({ multi: e.target.checked })} className="accent-clay" />
              Allow voting for several
            </label>
            <span className="ml-auto">{options.length} option{options.length === 1 ? '' : 's'}</span>
          </div>
        )}

        {editing && editable && (
          <div className="border-t border-paper-line px-3 py-2 dark:border-coal-line">
            <WidgetIO fileName="vote.txt" templateName="vote-template.txt" templateText={VOTE_TEMPLATE} getText={exportText} onImport={importText} />
          </div>
        )}
      </div>
    </NodeViewWrapper>
  );
}

export const VoteBlock = Node.create({
  name: 'voteBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      question: { default: '' },
      multi: { default: true },
      options: {
        default: [],
        parseHTML: (el: HTMLElement) => {
          try {
            return JSON.parse(el.getAttribute('data-options') || '[]');
          } catch {
            return [];
          }
        },
        renderHTML: (attrs: { options?: VoteOption[] }) => ({ 'data-options': JSON.stringify(attrs.options || []) }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-vote]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-vote': '' })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(VoteView);
  },
});
