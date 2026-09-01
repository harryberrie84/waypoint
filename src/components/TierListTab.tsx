import { useData } from '../store/useData';
import { TierListEditor } from '../editor/TierListBlock';
import { defaultTierList, type TierListData } from '../lib/tierList';

// The page-level Tier list tab: the same editor the /tier-list widget uses, but
// backed by pages.tierlist (page-scoped, synced) instead of a node's attrs.
export function TierListTab({ pageId, editable }: { pageId: string; editable: boolean }) {
  const page = useData((s) => s.pages[pageId]);
  const setPageTierlist = useData((s) => s.setPageTierlist);
  const value: TierListData = page?.tierlist ?? defaultTierList();

  // Read the store at WRITE time, not the value this render closed over. An image
  // upload settles hundreds of milliseconds after the click that started it, and
  // merging a patch into the older snapshot writes that snapshot back: the picture
  // shows, then our own next write removes it, and it is only right again after a
  // refetch. The widget has the same guard against its node prop.
  const live = (): TierListData => useData.getState().pages[pageId]?.tierlist ?? defaultTierList();

  return (
    <div className="h-full overflow-y-auto px-3 py-3 sm:px-8">
      <TierListEditor
        value={value}
        readLive={live}
        onChange={(patch) => {
          if (editable) setPageTierlist(pageId, { ...live(), ...patch });
        }}
        editable={editable}
        big
      />
    </div>
  );
}
