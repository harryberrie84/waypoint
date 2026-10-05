// The parts of the app that load on first use rather than with it: every page
// tab but the notes, and the map views. One list, so the views that show them and
// the warm-up below agree on what exists.
export const lazyParts = {
  MindmapView: () => import('../components/MindmapView'),
  KanbanView: () => import('../components/KanbanView'),
  TierListTab: () => import('../components/TierListTab'),
  SheetTab: () => import('../components/SheetTab'),
  FlashcardsTab: () => import('../components/FlashcardsTab'),
  RotaTab: () => import('../components/RotaTab'),
  BracketTab: () => import('../components/BracketTab'),
  CurrencyTab: () => import('../components/CurrencyTab'),
  ItineraryTab: () => import('../components/ItineraryTab'),
  CalendarTab: () => import('../components/CalendarTab'),
  BudgetTab: () => import('../components/BudgetTab'),
  MoodboardTab: () => import('../components/MoodboardTab'),
  FilesTab: () => import('../components/FilesTab'),
  PhotosTab: () => import('../components/PhotosTab'),
  FlowView: () => import('../components/FlowView'),
  PeopleTab: () => import('../components/PeopleTab'),
  WeatherTab: () => import('../components/WeatherTab'),
  PageMap: () => import('../components/PageMap'),
  TableMapView: () => import('../components/TableMapView'),
  TableRouteView: () => import('../components/TableRouteView'),
  leaflet: () => import('leaflet'),
};

// Fetch every part in the background a little after the app has started, while
// online. The service worker keeps what was fetched, so a tab never opened before
// still opens with no signal, which it did when everything came in one file.
export function warmLazyParts(): void {
  const run = () => {
    if (!navigator.onLine) return;
    for (const load of Object.values(lazyParts)) void load().catch(() => {});
  };
  window.setTimeout(run, 5000);
}
