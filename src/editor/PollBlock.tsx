import { useMemo, useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { Vote, Plus, Check, Trash2 } from 'lucide-react';
import { useData, selectRowsForTable } from '../store/useData';
import { useAuth } from '../store/useAuth';
import { tally, winner } from '../lib/poll';
import { hasReacted } from '../lib/reactions';
import { cellText, titleColumn } from '../lib/tableQuery';
import type { TableRow } from '../types';

// ---------------------------------------------------------------------------
// pollBlock, a compact ballot bound to a /poll table (one row per option). A
// vote is a 👍 reaction on the option row, so votes are per-row records that
// reconcile cleanly when two people vote at once. (Node-attrs would be simpler
// but loses concurrent votes to last-write-wins on the page content, not an
// option for a group decision.)
// ---------------------------------------------------------------------------

const VOTE = '👍';
const voteCount = (r: TableRow): number => (r.reactions?.[VOTE] ?? []).length;

function PollBlockView({ node, updateAttributes, editor, deleteNode }: NodeViewProps) {
  const tableId = node.attrs.tableId as string;
  const mode = (node.attrs.mode as 'single' | 'multi') ?? 'single';
  const table = useData((s) => s.tables[tableId]);
  // Select the stable rows map and derive the filtered list with useMemo. Returning a
  // fresh .filter().sort() array straight from the zustand selector (v5, no built-in
  // memoization) makes getSnapshot uncacheable -> React "Maximum update depth" (#185).
  const rowsMap = useData((s) => s.rows);
  const rows = useMemo(() => selectRowsForTable(rowsMap, tableId), [rowsMap, tableId]);
  const toggleReaction = useData((s) => s.toggleReaction);
  const addRow = useData((s) => s.addRow);
  const deleteRow = useData((s) => s.deleteRow);
  const myId = useAuth((s) => s.user?.id ?? '');
  const [draft, setDraft] = useState('');

  if (!table) {
    return (
      <NodeViewWrapper className="my-3" contentEditable={false}>
        <div className="flex items-center justify-between gap-2 rounded-lg border border-dashed border-paper-line p-3 text-sm text-ink-faint dark:border-coal-line dark:text-coal-soft">
          <span>poll table missing, it was deleted.</span>
          {editor.isEditable && (
            <button type="button" onClick={() => deleteNode()} className="rounded-md px-2 py-1 text-xs text-ink-soft hover:text-clay dark:text-coal-soft">
              detach
            </button>
          )}
        </div>
      </NodeViewWrapper>
    );
  }

  const optionCol = titleColumn(table.columns);
  const ranked = tally(rows, voteCount);
  const top = winner(ranked);
  const pctOf = (rowId: string) => ranked.find((t) => t.rowId === rowId)?.pct ?? 0;

  const vote = (rowId: string) => {
    if (!myId) return;
    const already = hasReacted(rows.find((r) => r.id === rowId)?.reactions, VOTE, myId);
    // Single-choice: clear the voter's other picks before setting the new one.
    if (mode === 'single' && !already) {
      for (const r of rows) {
        if (r.id !== rowId && hasReacted(r.reactions, VOTE, myId)) toggleReaction(r.id, VOTE, myId);
      }
    }
    toggleReaction(rowId, VOTE, myId);
  };

  const addOption = () => {
    const label = draft.trim();
    if (!label || !optionCol) return;
    setDraft('');
    void addRow(tableId, { [optionCol.id]: label });
  };

  return (
    <NodeViewWrapper className="my-4" contentEditable={false}>
      <div className="rounded-xl border border-paper-line bg-paper-panel/40 p-3 dark:border-coal-line dark:bg-coal/40">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-ink-faint dark:text-coal-soft">
            <Vote className="h-3.5 w-3.5 text-clay" /> poll
          </div>
          {editor.isEditable && (
            <button
              type="button"
              onClick={() => updateAttributes({ mode: mode === 'single' ? 'multi' : 'single' })}
              className="rounded-md border border-paper-line px-1.5 py-0.5 text-xs text-ink-soft hover:border-clay hover:text-clay dark:border-coal-line dark:text-coal-soft"
              title="Switch between one vote each and multiple"
            >
              {mode === 'single' ? 'single choice' : 'multiple choice'}
            </button>
          )}
        </div>

        {rows.length === 0 ? (
          <p className="text-sm text-ink-faint dark:text-coal-soft">no options yet.</p>
        ) : (
          <div className="space-y-1.5">
            {rows.map((r) => {
              const count = voteCount(r);
              const mine = hasReacted(r.reactions, VOTE, myId);
              const isWinner = r.id === top;
              return (
                <div key={r.id} className="group flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => vote(r.id)}
                    disabled={!myId}
                    className={[
                      'flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition-colors',
                      mine
                        ? 'border-clay bg-clay text-white'
                        : 'border-paper-line text-transparent hover:border-clay dark:border-coal-line',
                    ].join(' ')}
                    title={mine ? 'remove your vote' : 'vote'}
                  >
                    <Check className="h-3.5 w-3.5" />
                  </button>
                  <div className="relative min-w-0 flex-1 overflow-hidden rounded-md bg-paper-line/50 dark:bg-coal-line/70">
                    <div
                      className={['absolute inset-y-0 left-0 rounded-md', isWinner ? 'bg-clay/30' : 'bg-clay/15'].join(' ')}
                      style={{ width: `${pctOf(r.id)}%` }}
                    />
                    <div className="relative flex items-center justify-between gap-2 px-2 py-1">
                      <span className={['truncate text-sm', isWinner ? 'font-medium text-ink dark:text-coal-text' : 'text-ink-soft dark:text-coal-soft'].join(' ')}>
                        {optionCol ? cellText(r.cells[optionCol.id] ?? null, optionCol) || 'Untitled' : 'Untitled'}
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-ink-faint dark:text-coal-soft">{count}</span>
                    </div>
                  </div>
                  {editor.isEditable && (
                    <button
                      type="button"
                      onClick={() => void deleteRow(r.id)}
                      className="shrink-0 rounded-md p-1 text-ink-faint opacity-0 transition-opacity hover:text-clay group-hover:opacity-100"
                      title="Remove option"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {editor.isEditable && (
          <div className="mt-2 flex items-center gap-1.5">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addOption();
                }
              }}
              placeholder="add an option…"
              className="min-w-0 flex-1 rounded-md border border-paper-line bg-paper px-2 py-1 text-sm text-ink outline-none focus:border-clay dark:border-coal-line dark:bg-coal-panel dark:text-coal-text"
            />
            <button
              type="button"
              onClick={addOption}
              className="flex items-center gap-1 rounded-md bg-clay px-2 py-1 text-xs font-medium text-white hover:bg-clay/90 disabled:opacity-50"
              disabled={!draft.trim()}
            >
              <Plus className="h-3.5 w-3.5" /> add
            </button>
          </div>
        )}
      </div>
    </NodeViewWrapper>
  );
}

export const PollBlock = Node.create({
  name: 'pollBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      tableId: { default: '' },
      mode: { default: 'single' },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-poll-block]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-poll-block': '', 'data-table-id': HTMLAttributes.tableId })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(PollBlockView);
  },
});
