import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useData } from '../store/useData';
import { CurrencyEditor } from '../editor/CurrencyBlock';
import { getBaseCurrency } from '../lib/fx';
import { defaultFxBoard, type FxBoardData } from '../lib/fxBoard';

// The page-level Currency tab: the same editor the /currency widget uses, backed by
// pages.rates (page-scoped, synced) instead of a node's attrs.
//
// It refuses to accept an edit until it has CONFIRMED the server has that column.
// Without it PocketBase drops the field silently, the write returns 200, and the
// board would live only in this browser's localStorage: gone with your site data,
// invisible on every other device, and not in a backup either. A read-only tab that
// says so beats a board that disappears. The /currency block in the page body has no
// such dependency, it rides the doc like any other block, so the feature is still
// usable while the column is missing.
export function CurrencyTab({ pageId, editable }: { pageId: string; editable: boolean }) {
  const page = useData((s) => s.pages[pageId]);
  const setPageRates = useData((s) => s.setPageRates);
  const pageRatesFieldExists = useData((s) => s.pageRatesFieldExists);
  const value: FxBoardData = page?.rates ?? defaultFxBoard(getBaseCurrency());
  // null while the answer is still in flight, so the board never renders as editable
  // for the split second before we know.
  const [fieldOk, setFieldOk] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    void pageRatesFieldExists(pageId).then((ok) => {
      if (!alive) return;
      setFieldOk(ok);
      // The operator detail goes to the console, never on screen. What is on screen
      // is for whoever is using the app, who cannot add a database column and should
      // not be reading about one.
      if (!ok) console.warn('[currency] pages.rates column missing. This install predates the field: add an optional JSON field named rates to the pages collection in the PocketBase dashboard.');
    });
    return () => {
      alive = false;
    };
  }, [pageId, pageRatesFieldExists]);

  // Read the store at WRITE time, not the value this render closed over: a rate
  // refresh or a collaborator's edit can land between the click and the write,
  // and merging into the older snapshot would put their row list back.
  const live = (): FxBoardData => useData.getState().pages[pageId]?.rates ?? defaultFxBoard(getBaseCurrency());
  const canEdit = editable && fieldOk === true;

  return (
    <div className="h-full overflow-y-auto px-3 py-3 sm:px-8">
      <div className="mx-auto max-w-2xl">
        {fieldOk === false && (
          <div className="mb-3 flex items-start gap-2 rounded-lg bg-ochre-wash px-3 py-2 text-xs text-ochre dark:bg-ochre/10 dark:text-ochre-soft">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              This board is read-only, because it cannot be saved yet. Ask whoever runs this Waypoint to finish setting it up.
              In the meantime you can add a currency block to your notes with <span className="font-mono">/currency</span>, which
              saves with the page.
            </span>
          </div>
        )}
        <CurrencyEditor
          value={value}
          readLive={live}
          onChange={(patch) => {
            if (canEdit) setPageRates(pageId, { ...live(), ...patch });
          }}
          editable={canEdit}
          big
        />
      </div>
    </div>
  );
}
