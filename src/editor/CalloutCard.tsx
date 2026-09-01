import { useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { Palette } from 'lucide-react';
import { useAutoFocus } from './useAutoFocus';

// calloutCard, a Notion-style callout: an icon on the left, rich editable content
// on the right, a soft tinted background and matching border. The icon swaps via
// a small picker; the colour menu retints background and border together.

// Soft tints as rgba so they sit correctly over any theme's page background, and
// a matching slightly stronger border. Text keeps the normal ink colour for
// contrast. Keys double as the labels in the colour menu.
// `bg`/`border` tint the callout; `dot` is the solid colour shown in the picker
// so the swatches are actually distinguishable.
export const CALLOUT_COLORS: Record<string, { bg: string; border: string; dot: string }> = {
  gray: { bg: 'rgba(120,124,131,0.12)', border: 'rgba(120,124,131,0.34)', dot: '#787c83' },
  red: { bg: 'rgba(192,69,94,0.12)', border: 'rgba(192,69,94,0.34)', dot: '#c0455e' },
  orange: { bg: 'rgba(212,102,58,0.12)', border: 'rgba(212,102,58,0.34)', dot: '#d4663a' },
  yellow: { bg: 'rgba(192,137,46,0.14)', border: 'rgba(192,137,46,0.36)', dot: '#c0892e' },
  green: { bg: 'rgba(90,158,79,0.12)', border: 'rgba(90,158,79,0.34)', dot: '#5a9e4f' },
  teal: { bg: 'rgba(58,158,149,0.12)', border: 'rgba(58,158,149,0.34)', dot: '#3a9e95' },
  blue: { bg: 'rgba(58,130,196,0.12)', border: 'rgba(58,130,196,0.34)', dot: '#3a82c4' },
  purple: { bg: 'rgba(140,82,196,0.12)', border: 'rgba(140,82,196,0.34)', dot: '#8c52c4' },
  pink: { bg: 'rgba(184,74,147,0.12)', border: 'rgba(184,74,147,0.34)', dot: '#b84a93' },
};

const QUICK_EMOJI = ['💡', '📌', '⚠️', '✅', '❗', '🔥', '⭐', '📝', '💬', 'ℹ️', '🎯', '🚀', '❤️', '🗒️', '🔑', '🌏'];

function CalloutView({ node, updateAttributes, editor }: NodeViewProps) {
  const emoji = (node.attrs.emoji as string) || '💡';
  const color = (node.attrs.color as string) || 'gray';
  const tint = CALLOUT_COLORS[color] ?? CALLOUT_COLORS.gray;
  const editable = editor.isEditable;
  const [iconOpen, setIconOpen] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);
  const iconRef = useAutoFocus<HTMLInputElement>(iconOpen);

  return (
    <NodeViewWrapper className="my-2">
      <div
        className="group/callout relative flex gap-3 rounded py-4 pl-3 pr-4"
        style={{ backgroundColor: tint.bg, border: `1px solid ${tint.border}` }}
      >
        {/* Icon, top-aligned so it locks to the first line on multi-line content. */}
        <div className="relative shrink-0 select-none" contentEditable={false}>
          <button
            type="button"
            onClick={() => editable && setIconOpen((o) => !o)}
            className="flex h-6 w-6 items-center justify-center rounded text-xl leading-none hover:bg-black/5 dark:hover:bg-white/10"
            title="Change icon"
          >
            {emoji}
          </button>
          {iconOpen && editable && (
            <div className="absolute left-0 top-7 z-30 w-56 rounded-lg border border-paper-line bg-paper p-2 shadow-xl dark:border-coal-line dark:bg-coal-panel">
              <div className="grid grid-cols-8 gap-0.5">
                {QUICK_EMOJI.map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => {
                      updateAttributes({ emoji: e });
                      setIconOpen(false);
                    }}
                    className="rounded p-1 text-lg hover:bg-paper-panel dark:hover:bg-coal-line"
                  >
                    {e}
                  </button>
                ))}
              </div>
              <input
                ref={iconRef}
                defaultValue=""
                onChange={(ev) => {
                  const v = Array.from(ev.target.value)[0];
                  if (v) {
                    updateAttributes({ emoji: v });
                    setIconOpen(false);
                  }
                }}
                placeholder="or type any emoji"
                className="mt-1.5 w-full rounded border border-paper-line bg-paper px-2 py-1 text-xs text-ink outline-none dark:border-coal-line dark:bg-coal dark:text-coal-text"
              />
            </div>
          )}
        </div>

        {/* Rich, editable content. */}
        <NodeViewContent className="callout-content min-w-0 flex-1" />

        {/* Colour menu, retints background + border together. */}
        {editable && (
          <div className="absolute right-1.5 top-1.5 select-none" contentEditable={false}>
            <button
              type="button"
              onClick={() => setColorOpen((o) => !o)}
              className="rounded p-1 text-ink-faint opacity-0 transition-opacity hover:bg-black/5 hover:text-ink-soft group-hover/callout:opacity-100 dark:hover:bg-white/10"
              title="Colour"
            >
              <Palette className="h-3.5 w-3.5" />
            </button>
            {colorOpen && (
              <div className="absolute right-0 top-7 z-30 flex w-44 flex-wrap gap-1.5 rounded-lg border border-paper-line bg-paper p-2 shadow-xl dark:border-coal-line dark:bg-coal-panel">
                {Object.entries(CALLOUT_COLORS).map(([key, c]) => (
                  <button
                    key={key}
                    type="button"
                    title={key}
                    onClick={() => {
                      updateAttributes({ color: key });
                      setColorOpen(false);
                    }}
                    style={{ backgroundColor: c.dot }}
                    className={`h-6 w-6 shrink-0 rounded-full transition hover:scale-110 ${color === key ? 'ring-2 ring-offset-1 ring-ink ring-offset-paper dark:ring-coal-text dark:ring-offset-coal-panel' : 'ring-1 ring-black/10 dark:ring-white/15'}`}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </NodeViewWrapper>
  );
}

export const CalloutCard = Node.create({
  name: 'calloutCard',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      emoji: { default: '💡' },
      color: { default: 'gray' },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-callout]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-callout': '' }), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(CalloutView);
  },
});
