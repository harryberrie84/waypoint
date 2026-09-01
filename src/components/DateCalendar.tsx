import { useState } from 'react';
import { ChevronLeft, ChevronRight, Clock } from 'lucide-react';

// A small, themed month calendar to replace the browser's native date picker.
// `value` is the app's stored ISO ('YYYY-MM-DD' or 'YYYY-MM-DDTHH:mm'); onChange
// emits the same. With `withTime` it adds an hour/minute row and stays open so you
// can set both; date-only closes on pick.

const WD = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']; // Monday-first (Swedish)

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function clamp(lo: number, hi: number, n: number): number {
  return Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : lo));
}

export function DateCalendar({
  value,
  withTime,
  onChange,
  onClose,
}: {
  value: string;
  withTime: boolean;
  onChange: (iso: string | null) => void;
  onClose: () => void;
}) {
  const sel = value ? new Date(value.length <= 10 ? `${value}T00:00` : value) : null;
  const valid = sel && !Number.isNaN(sel.getTime()) ? sel : null;
  const [view, setView] = useState(() => valid ?? new Date());
  const [h, setH] = useState(valid && withTime ? valid.getHours() : 9);
  const [mi, setMi] = useState(valid && withTime ? valid.getMinutes() : 0);

  const year = view.getFullYear();
  const month = view.getMonth();
  const first = new Date(year, month, 1);
  const startDow = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - startDow);
  const todayY = ymd(new Date());
  const selY = valid ? ymd(valid) : '';

  const pick = (d: Date) => {
    onChange(withTime ? `${ymd(d)}T${pad(h)}:${pad(mi)}` : ymd(d));
    if (!withTime) onClose();
  };
  const setTime = (nh: number, nmi: number) => {
    setH(nh);
    setMi(nmi);
    if (valid) onChange(`${ymd(valid)}T${pad(nh)}:${pad(nmi)}`);
  };

  return (
    <div className="w-64 select-none p-2">
      <div className="mb-1 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setView(new Date(year, month - 1, 1))}
          className="rounded p-1 text-ink-faint hover:bg-paper-panel hover:text-clay dark:hover:bg-coal-line"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-sm font-medium text-ink dark:text-coal-text">
          {view.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
        </span>
        <button
          type="button"
          onClick={() => setView(new Date(year, month + 1, 1))}
          className="rounded p-1 text-ink-faint hover:bg-paper-panel hover:text-clay dark:hover:bg-coal-line"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 text-center text-[10px] font-medium text-ink-faint dark:text-coal-soft">
        {WD.map((w) => (
          <span key={w} className="py-0.5">
            {w}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {Array.from({ length: 42 }, (_, i) => {
          const d = new Date(start);
          d.setDate(start.getDate() + i);
          const inMonth = d.getMonth() === month;
          const dy = ymd(d);
          const isSel = dy === selY;
          const isToday = dy === todayY;
          return (
            <button
              key={i}
              type="button"
              onClick={() => pick(d)}
              className={[
                'h-7 rounded text-xs transition-colors',
                isSel
                  ? 'bg-clay font-semibold text-white'
                  : isToday
                    ? 'bg-clay-wash font-medium text-clay dark:bg-clay/20'
                    : inMonth
                      ? 'text-ink hover:bg-paper-panel dark:text-coal-text dark:hover:bg-coal-line'
                      : 'text-ink-faint/50 hover:bg-paper-panel dark:text-coal-soft/40 dark:hover:bg-coal-line',
              ].join(' ')}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>

      {withTime && (
        <div className="mt-2 flex items-center gap-1.5 border-t border-paper-line pt-2 dark:border-coal-line">
          <Clock className="h-3.5 w-3.5 text-ink-faint dark:text-coal-soft" />
          <input
            type="number"
            min={0}
            max={23}
            value={pad(h)}
            onChange={(e) => setTime(clamp(0, 23, Number(e.target.value)), mi)}
            className="w-11 rounded border border-paper-line bg-paper px-1.5 py-1 text-center text-sm tabular-nums text-ink outline-none focus:border-clay dark:border-coal-line dark:bg-coal dark:text-coal-text"
          />
          <span className="text-ink-faint dark:text-coal-soft">:</span>
          <input
            type="number"
            min={0}
            max={59}
            value={pad(mi)}
            onChange={(e) => setTime(h, clamp(0, 59, Number(e.target.value)))}
            className="w-11 rounded border border-paper-line bg-paper px-1.5 py-1 text-center text-sm tabular-nums text-ink outline-none focus:border-clay dark:border-coal-line dark:bg-coal dark:text-coal-text"
          />
          <span className="ml-auto text-[11px] text-ink-faint dark:text-coal-soft">24h</span>
        </div>
      )}

      <div className="mt-2 flex items-center gap-2 border-t border-paper-line pt-2 text-xs dark:border-coal-line">
        <button type="button" onClick={() => pick(new Date())} className="rounded px-2 py-1 font-medium text-clay hover:bg-clay-wash dark:hover:bg-clay/15">
          Today
        </button>
        <button
          type="button"
          onClick={() => {
            onChange(null);
            onClose();
          }}
          className="ml-auto rounded px-2 py-1 text-ink-faint hover:text-rose-500"
        >
          Clear
        </button>
      </div>
    </div>
  );
}
