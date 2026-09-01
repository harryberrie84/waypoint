import { useData } from '../store/useData';
import type { PresenceRecord } from '../types';

type Tab = 'notes' | 'kanban' | 'map' | 'mindmap' | 'links' | 'flow' | 'itinerary' | 'calendar' | 'budget' | 'moodboard' | 'files';
const TABS: Tab[] = ['notes', 'kanban', 'map', 'mindmap', 'links', 'flow', 'itinerary', 'calendar', 'budget', 'moodboard', 'files'];

// Warp to where a collaborator is: open their page, switch to their tab, and if
// they're inside a card row, open that row too. Pin/node targets just land you on
// the right tab (we can't force-select someone else's pin/node remotely). Fed by
// the presence `focus` we broadcast as "tab:kind:id".
export function jumpToPresence(p: PresenceRecord): void {
  if (!p.page) return;
  const st = useData.getState();
  const parts = (p.focus || '').split(':');
  const tab = (TABS.includes(parts[0] as Tab) ? parts[0] : 'notes') as Tab;
  st.requestPageTab(p.page, tab); // navigates to the page AND selects the tab
  if (parts[1] === 'row' && parts[2]) st.openRow(parts.slice(2).join(':'));
}
