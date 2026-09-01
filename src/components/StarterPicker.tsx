import { useData } from '../store/useData';
import { STARTERS } from '../lib/starters';

// StarterPicker, the first thing a brand-new account sees instead of a blank
// page. Pick one and land on a populated, editable page. Small on purpose; the
// "blank page" option is the escape hatch for people who'd rather just start.

export function StarterPicker({ onDone }: { onDone: () => void }) {
  const createStarterPage = useData((s) => s.createStarterPage);

  const pick = (key: string) => {
    void createStarterPage(key).then(() => onDone());
  };

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-coal/30 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl border border-paper-line bg-paper p-5 shadow-2xl dark:border-coal-line dark:bg-coal-panel">
        <h2 className="font-display text-lg font-semibold text-ink dark:text-coal-text">start with something</h2>
        <p className="mt-1 text-sm text-ink-soft dark:text-coal-soft">
          pick one to drop in a ready-made page. you can edit or delete it.
        </p>
        <div className="mt-4 grid gap-2">
          {STARTERS.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => pick(s.key)}
              className="flex items-center gap-3 rounded-lg border border-paper-line px-3 py-2.5 text-left text-sm text-ink hover:bg-paper-panel dark:border-coal-line dark:text-coal-text dark:hover:bg-coal-line"
            >
              <span className="text-xl leading-none">{s.icon}</span>
              <span>{s.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
