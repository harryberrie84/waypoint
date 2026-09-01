import { useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { Swords } from 'lucide-react';
import { useAuth } from '../store/useAuth';
import { useMembers } from '../hooks/useMembers';
import { initials, avatarColor } from '../lib/avatar';

// thisOrThatBlock, a quick two-way call: two big option cards, tap yours to pick
// (single choice, switching sides moves your pick). The leading side lights up.
// Lighter than /vote, for the "sushi or ramen tonight?" moments. Picks live in
// the block attrs so both of you see them live.

interface Side {
  text: string;
  voters: string[];
}

function readSide(raw: unknown): Side {
  const s = (raw as Side) || {};
  return { text: typeof s.text === 'string' ? s.text : '', voters: Array.isArray(s.voters) ? s.voters : [] };
}

function ThisOrThatView({ node, updateAttributes, editor }: NodeViewProps) {
  const editable = editor.isEditable;
  const question = (node.attrs.question as string) || '';
  const a = readSide(node.attrs.a);
  const b = readSide(node.attrs.b);
  const myId = useAuth((s) => s.user?.id ?? '');
  const members = useMembers();
  const [editing, setEditing] = useState(false);

  const pick = (which: 'a' | 'b') => {
    if (!myId || editing) return;
    const inA = a.voters.includes(myId);
    const inB = b.voters.includes(myId);
    const nextA = { ...a, voters: a.voters.filter((v) => v !== myId) };
    const nextB = { ...b, voters: b.voters.filter((v) => v !== myId) };
    // Tapping your current side clears it; otherwise move your pick to that side.
    if (which === 'a' && !inA) nextA.voters.push(myId);
    if (which === 'b' && !inB) nextB.voters.push(myId);
    updateAttributes({ a: nextA, b: nextB });
  };

  const lead = a.voters.length === b.voters.length ? null : a.voters.length > b.voters.length ? 'a' : 'b';

  const Card = ({ side, data, other }: { side: 'a' | 'b'; data: Side; other: Side }) => {
    const mine = myId ? data.voters.includes(myId) : false;
    const leading = lead === side && (data.voters.length > 0);
    return (
      <button
        type="button"
        onClick={() => pick(side)}
        disabled={!myId || editing}
        className={[
          'flex min-h-[5.5rem] flex-1 flex-col items-center justify-center gap-1.5 rounded-xl border-2 px-3 py-3 text-center transition-all',
          mine ? 'border-clay bg-clay-wash/70 dark:border-clay dark:bg-clay/15' : leading ? 'border-clay/40 bg-paper dark:border-clay/40 dark:bg-coal-panel' : 'border-paper-line bg-paper hover:border-clay/50 dark:border-coal-line dark:bg-coal-panel',
        ].join(' ')}
      >
        <span className="text-sm font-semibold text-ink dark:text-coal-text">{data.text || (side === 'a' ? 'This' : 'That')}</span>
        <span className="font-mono text-2xl font-bold tabular-nums text-clay">{data.voters.length}</span>
        {data.voters.length > 0 && (
          <span className="flex -space-x-1.5">
            {data.voters.slice(0, 4).map((id) => {
              const name = members.find((m) => m.id === id)?.name ?? 'Someone';
              return (
                <span key={id} title={name} className="flex h-4 w-4 items-center justify-center rounded-full border border-paper text-[8px] font-semibold text-white dark:border-coal-panel" style={{ backgroundColor: avatarColor(id) }}>
                  {initials(name)}
                </span>
              );
            })}
          </span>
        )}
        {/* reference `other` so an empty tie still renders both sides evenly */}
        <span className="sr-only">{other.voters.length}</span>
      </button>
    );
  };

  return (
    <NodeViewWrapper className="my-3" contentEditable={false}>
      <div className="rounded-xl border border-paper-line bg-gradient-to-br from-clay-wash/40 to-paper-panel/40 p-3 dark:border-coal-line dark:from-clay/10 dark:to-coal/40">
        <div className="mb-2 flex items-center gap-2">
          <Swords className="h-4 w-4 shrink-0 text-clay" />
          {editing && editable ? (
            <input
              value={question}
              onChange={(e) => updateAttributes({ question: e.target.value })}
              placeholder="This or that?"
              className="min-w-0 flex-1 rounded-lg border border-paper-line bg-paper px-2 py-1 text-sm font-semibold text-ink outline-none dark:border-coal-line dark:bg-coal-panel dark:text-coal-text"
            />
          ) : (
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink dark:text-coal-text">{question || 'This or that?'}</span>
          )}
          {editable && (
            <button type="button" onClick={() => setEditing((e) => !e)} className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-ink-soft hover:bg-paper-panel dark:text-coal-soft dark:hover:bg-coal-line">
              {editing ? 'Done' : 'Edit'}
            </button>
          )}
        </div>

        {editing && editable ? (
          <div className="grid grid-cols-2 gap-2">
            <input value={a.text} onChange={(e) => updateAttributes({ a: { ...a, text: e.target.value } })} placeholder="This" className="rounded-lg border border-paper-line bg-paper px-2 py-1.5 text-sm text-ink outline-none dark:border-coal-line dark:bg-coal-panel dark:text-coal-text" />
            <input value={b.text} onChange={(e) => updateAttributes({ b: { ...b, text: e.target.value } })} placeholder="That" className="rounded-lg border border-paper-line bg-paper px-2 py-1.5 text-sm text-ink outline-none dark:border-coal-line dark:bg-coal-panel dark:text-coal-text" />
          </div>
        ) : (
          <div className="flex items-stretch gap-2">
            <Card side="a" data={a} other={b} />
            <span className="flex items-center text-[11px] font-semibold uppercase tracking-wide text-ink-faint dark:text-coal-soft">or</span>
            <Card side="b" data={b} other={a} />
          </div>
        )}
      </div>
    </NodeViewWrapper>
  );
}

export const ThisOrThatBlock = Node.create({
  name: 'thisOrThatBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      question: { default: '' },
      a: {
        default: { text: '', voters: [] },
        parseHTML: (el: HTMLElement) => {
          try {
            return JSON.parse(el.getAttribute('data-a') || '{}');
          } catch {
            return { text: '', voters: [] };
          }
        },
        renderHTML: (attrs: { a?: Side }) => ({ 'data-a': JSON.stringify(attrs.a || { text: '', voters: [] }) }),
      },
      b: {
        default: { text: '', voters: [] },
        parseHTML: (el: HTMLElement) => {
          try {
            return JSON.parse(el.getAttribute('data-b') || '{}');
          } catch {
            return { text: '', voters: [] };
          }
        },
        renderHTML: (attrs: { b?: Side }) => ({ 'data-b': JSON.stringify(attrs.b || { text: '', voters: [] }) }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-thisorthat]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-thisorthat': '' })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ThisOrThatView);
  },
});
