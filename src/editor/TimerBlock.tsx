import { useEffect, useRef, useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { Timer, Play, Pause, RotateCcw, Plus, Minus } from 'lucide-react';

// timerBlock, a countdown you run in the page (a pomodoro, a 12-minute ramen).
// endsAt is an absolute timestamp while running, so it keeps correct time across a
// reload and reads the same for everyone on the page. remaining holds the paused
// value; total is the set duration.

function fmt(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

function TimerView({ node, updateAttributes, editor }: NodeViewProps) {
  const total = (node.attrs.total as number) || 0;
  const endsAt = (node.attrs.endsAt as number) || 0;
  const stored = node.attrs.remaining as number | null;
  const label = node.attrs.label as string;
  const editable = editor.isEditable;

  const [now, setNow] = useState(() => Date.now());
  const ranged = useRef(false);

  useEffect(() => {
    if (!endsAt) return;
    const t = setInterval(() => {
      const n = Date.now();
      setNow(n);
      if (n >= endsAt) clearInterval(t); // stop ticking once it reaches zero
    }, 250);
    return () => clearInterval(t);
  }, [endsAt]);

  const running = endsAt > 0;
  const remaining = running ? Math.max(0, Math.ceil((endsAt - now) / 1000)) : stored ?? total;
  const done = running && remaining <= 0;
  const atStart = !running && (stored == null || stored === total);

  // WebAudio, created and unlocked on the Start gesture (browsers block audio that
  // starts cold, minutes later). A short alarm when it reaches zero.
  const ctxRef = useRef<AudioContext | null>(null);
  const unlockAudio = () => {
    try {
      if (!ctxRef.current) {
        const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (Ctx) ctxRef.current = new Ctx();
      }
      void ctxRef.current?.resume();
    } catch {
      /* no audio available */
    }
  };
  const playAlarm = () => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    void ctx.resume();
    const beep = (at: number, freq: number) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g);
      g.connect(ctx.destination);
      o.type = 'sine';
      o.frequency.value = freq;
      const t = ctx.currentTime + at;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
      o.start(t);
      o.stop(t + 0.34);
    };
    beep(0, 880);
    beep(0.42, 880);
    beep(0.84, 1175);
  };

  useEffect(() => {
    if (done && !ranged.current) {
      ranged.current = true;
      playAlarm();
    }
    if (!done) ranged.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);

  const start = () => {
    unlockAudio();
    const secs = remaining > 0 ? remaining : total;
    if (secs > 0) updateAttributes({ endsAt: Date.now() + secs * 1000, remaining: secs });
  };
  const pause = () => updateAttributes({ endsAt: 0, remaining });
  const reset = () => updateAttributes({ endsAt: 0, remaining: total });
  const bump = (delta: number) => {
    const next = Math.min(24 * 3600, Math.max(0, total + delta));
    updateAttributes({ total: next, remaining: next, endsAt: 0 });
  };

  return (
    <NodeViewWrapper className="my-3" contentEditable={false}>
      <div
        className={[
          'flex flex-wrap items-center gap-3 rounded-xl border p-3',
          done
            ? 'border-clay bg-clay-wash/60 dark:border-clay dark:bg-clay/15'
            : 'border-paper-line bg-paper-panel/50 dark:border-coal-line dark:bg-coal/40',
        ].join(' ')}
      >
        <Timer className={`h-5 w-5 shrink-0 ${done ? 'text-clay' : 'text-clay'}`} />
        <span className="font-mono text-3xl font-bold tabular-nums tracking-tight text-ink dark:text-coal-text">
          {done ? "Time's up" : fmt(remaining)}
        </span>

        {editable && atStart && !done && (
          <span className="flex items-center gap-1">
            <button type="button" onClick={() => bump(-60)} className="rounded-md p-1 text-ink-faint hover:bg-paper-panel hover:text-clay dark:hover:bg-coal-line" title="Minus a minute">
              <Minus className="h-3.5 w-3.5" />
            </button>
            <button type="button" onClick={() => bump(60)} className="rounded-md p-1 text-ink-faint hover:bg-paper-panel hover:text-clay dark:hover:bg-coal-line" title="Plus a minute">
              <Plus className="h-3.5 w-3.5" />
            </button>
          </span>
        )}

        {editable && (
          <span className="ml-auto flex items-center gap-1.5">
            {!done &&
              (running ? (
                <button type="button" onClick={pause} className="flex items-center gap-1 rounded-lg border border-paper-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-paper-panel dark:border-coal-line dark:text-coal-text dark:hover:bg-coal-line">
                  <Pause className="h-3.5 w-3.5" /> Pause
                </button>
              ) : (
                <button type="button" onClick={start} className="flex items-center gap-1 rounded-lg bg-clay px-2.5 py-1 text-xs font-medium text-white hover:bg-clay/90">
                  <Play className="h-3.5 w-3.5" /> {atStart ? 'Start' : 'Resume'}
                </button>
              ))}
            <button type="button" onClick={reset} className="flex items-center gap-1 rounded-lg border border-paper-line px-2.5 py-1 text-xs font-medium text-ink-soft hover:bg-paper-panel dark:border-coal-line dark:text-coal-soft dark:hover:bg-coal-line" title="Reset">
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          </span>
        )}

        <input
          value={label}
          onChange={(e) => updateAttributes({ label: e.target.value })}
          placeholder="Label"
          readOnly={!editable}
          className="w-full bg-transparent text-sm text-ink-soft outline-none placeholder:text-ink-faint dark:text-coal-soft"
        />
      </div>
    </NodeViewWrapper>
  );
}

export const TimerBlock = Node.create({
  name: 'timerBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      total: { default: 300 },
      remaining: { default: 300 },
      endsAt: { default: 0, renderHTML: () => ({}) },
      label: { default: '' },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-timer]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-timer': '' })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(TimerView);
  },
});
