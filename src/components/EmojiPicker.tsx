import { useState } from 'react';
import { Search } from 'lucide-react';
import { EMOJI_GROUPS, searchEmoji } from '../lib/emoji';

// A searchable emoji picker for page icons and the callout block. Category tabs
// when idle, a flat result grid while searching.
export function EmojiPicker({ onSelect }: { onSelect: (emoji: string) => void }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState(0);
  const searching = q.trim().length > 0;
  const items = searching ? searchEmoji(q) : EMOJI_GROUPS[cat].items;

  return (
    <div className="w-72">
      <div className="mb-2 flex items-center gap-1.5 rounded-md border border-paper-line bg-paper px-2 py-1 dark:border-coal-line dark:bg-coal-panel">
        <Search className="h-3.5 w-3.5 shrink-0 text-ink-faint dark:text-coal-soft" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search emoji"
          className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none dark:text-coal-text"
        />
      </div>

      {!searching && (
        <div className="mb-1.5 flex items-center gap-0.5">
          {EMOJI_GROUPS.map((g, i) => (
            <button
              key={g.label}
              type="button"
              onClick={() => setCat(i)}
              title={g.label}
              className={`flex-1 rounded p-1 text-base leading-none ${i === cat ? 'bg-paper-panel dark:bg-coal-line' : 'hover:bg-paper-panel dark:hover:bg-coal-line'}`}
            >
              {g.items[0].e}
            </button>
          ))}
        </div>
      )}

      <div className="grid max-h-56 grid-cols-8 gap-0.5 overflow-y-auto">
        {items.map((d, i) => (
          <button
            key={`${d.e}-${i}`}
            type="button"
            onClick={() => onSelect(d.e)}
            title={d.n}
            className="rounded p-1 text-xl leading-none hover:bg-paper-panel dark:hover:bg-coal-line"
          >
            {d.e}
          </button>
        ))}
      </div>
      {searching && items.length === 0 && (
        <div className="py-3 text-center text-xs text-ink-faint dark:text-coal-soft">no emoji found</div>
      )}
    </div>
  );
}
