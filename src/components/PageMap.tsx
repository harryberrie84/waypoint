import { useEffect, useMemo, useRef, useState } from 'react';
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Plane, Car, Footprints, Bike, Plus, Trash2, Wand2, MapPin, MousePointerClick, Search, X, ExternalLink, Layers, Check, Copy, Link2, Upload, FileDown, Download, FileJson, Share2, RefreshCw } from 'lucide-react';
import { useData } from '../store/useData';
import type { PageMapData, PageMapMode, PageMapPin, PageMapRoute, PresenceRecord } from '../types';
import { PagePresence } from './PagePresence';
import { PinWeather } from './PinWeather';
import { buildDayRoute, orderByNearest, formatDistance as formatDayDistance, formatMinutes } from '../lib/dayRoute';
import { geoOf, curvePoints } from '../lib/tableQuery';
import { derivePagePins, placeTablesForWorkspace, placeRowCells, nextSourceColor, SOURCE_COLORS, type PlaceTableRef } from '../lib/mapPins';
import { toast } from '../store/useToast';
import { uid } from '../lib/id';
import { searchPlaces, tabelogSearchUrl, googleMapsUrl, type PlaceResult } from '../lib/places';
import { AREA_CATEGORIES, searchAreaPois, AreaTooBigError, type AreaCategory } from '../lib/overpass';
import { parsePlacesImport, MAP_IMPORT_EXAMPLE, type ImportedPlace } from '../lib/placesImport';
import { placesToJson, placesToCsv, placesToGpx, placeClipboardText, type MapPlace } from '../lib/mapExport';
import {
  fetchLeg,
  haversineMeters,
  estimateFlightDurationS,
  autoLegMode,
  formatDistance,
  formatDuration,
  type Leg,
  type RouteProfile,
} from '../lib/routing';

// PageMap, a page-level map. It auto-pins every place the page can "see" (the
// place columns of the tables embedded on it, derived live so they track the
// data), lets you search OpenStreetMap to drop or save real places, drop/drag
// your own pins, and joins pins with routes: real OSRM road geometry for
// drive/walk/cycle, a dotted great-circle arc for flights. Place pins link out
// to Tabelog and Google Maps for reviews (OSM has no ratings of its own). The
// container is `isolate`d and bounds fit once, same as the table map views.

const EMPTY_MAP: PageMapData = { pins: [], routes: [] };

const MODE_COLOR: Record<PageMapMode, string> = {
  flight: '#6b7cff',
  drive: '#e05a86',
  walk: '#34d399',
  cycle: '#f59e0b',
};
const MODE_LABEL: Record<PageMapMode, string> = { flight: 'Flight', drive: 'Drive', walk: 'Walk', cycle: 'Cycle' };
const GROUND_PROFILE: Record<'drive' | 'walk' | 'cycle', RouteProfile> = {
  drive: 'driving',
  walk: 'walking',
  cycle: 'cycling',
};
const MODE_ICON: Record<PageMapMode, typeof Plane> = { flight: Plane, drive: Car, walk: Footprints, cycle: Bike };

// Place pins are derived (live, from the store) off the page's own embedded
// tables plus any linked source tables, in lib/mapPins.ts so the logic is pure
// and unit-tested. Manual pins are pink, plain place pins blue, and a linked
// source's pins take that source's colour.
const MANUAL_COLOR = '#e05a86';
const DEFAULT_PLACE_COLOR = '#2f7dd1';
const pinColor = (p: PageMapPin): string => p.color ?? (p.kind === 'manual' ? MANUAL_COLOR : DEFAULT_PLACE_COLOR);

function download(name: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function pinSvg(color: string): string {
  return `<svg width="26" height="34" viewBox="0 0 26 34" xmlns="http://www.w3.org/2000/svg"><path d="M13 0C5.8 0 0 5.8 0 13c0 9.2 13 21 13 21s13-11.8 13-21C26 5.8 20.2 0 13 0z" fill="${color}"/><circle cx="13" cy="13" r="5" fill="#fff"/></svg>`;
}

// "Find nearby" preview pins: a coloured teardrop with a little SVG glyph drawn
// in the white head, one per category. The glyph is plain geometry (no emoji),
// designed centred on (14,14) inside an r=8 circle. Colour doubles as the legend.
const CATEGORY_PIN: Record<string, { color: string; glyph: string }> = {
  restaurant: { // fork + knife
    color: '#e05a86',
    glyph: '<path d="M11.4 8.4v3.2M13 8.4v3.2M12.2 8.4v11M11.4 11.6h1.6" /><path d="M16.6 8.4c1.1 0 1.8 1.4 1.8 3s-.7 2.5-1.8 2.8v5.2" />',
  },
  cafe: { // cup + saucer
    color: '#a8672f',
    glyph: '<path d="M9.8 9.6h7.1v3.6a3.55 3.55 0 0 1-3.55 3.55 3.55 3.55 0 0 1-3.55-3.55z" /><path d="M16.9 10.8h1.1a1.7 1.7 0 0 1 0 3.4h-.4" /><path d="M10.4 18.8h6.2" />',
  },
  bar: { // martini glass
    color: '#7c5cff',
    glyph: '<path d="M8.7 9.3h10.6L14 15z" fill="currentGlyph" stroke="none" /><path d="M14 15v3.6M11.2 18.8h5.6" />',
  },
  fast_food: { // burger
    color: '#e0870f',
    glyph: '<rect x="8.7" y="9.2" width="10.6" height="3" rx="1.5" fill="currentGlyph" stroke="none" /><path d="M8.9 13.7h10.2" /><rect x="8.7" y="15.6" width="10.6" height="3" rx="1.5" fill="currentGlyph" stroke="none" />',
  },
  hotel: { // bed
    color: '#2f7dd1',
    glyph: '<path d="M8.7 10.6v8" /><path d="M8.7 14.6h10.6v4" /><path d="M19.3 15.4v3.2" /><path d="M9.1 14.6a2.4 2.4 0 0 1 2.4-2.4h2.6a1.8 1.8 0 0 1 1.8 1.8v.6" />',
  },
  sight: { // star
    color: '#d94a8c',
    glyph: '<path d="M14 8.1l1.63 3.42 3.77.5-2.75 2.62.68 3.76L14 16.62l-3.33 1.79.68-3.76-2.75-2.62 3.77-.5z" fill="currentGlyph" stroke="none" />',
  },
  shop: { // shopping bag
    color: '#2fa36b',
    glyph: '<path d="M10 11.3h8l-.7 7.5h-6.6z" /><path d="M11.8 11.3a2.2 2.2 0 0 1 4.4 0" />',
  },
};
const PREVIEW_FALLBACK = { color: '#f59e0b', glyph: '<circle cx="14" cy="14" r="3.2" fill="currentGlyph" stroke="none" />' };

// The provisional pin for a picked search result: a dashed, hollow teardrop so
// it reads as "not saved yet". It becomes a real pin only on "Add as pin".
function tempPinSvg(): string {
  const c = '#e05a86';
  return (
    `<svg width="28" height="38" viewBox="0 0 28 38" xmlns="http://www.w3.org/2000/svg">` +
    `<path d="M14 1C6.8 1 1 6.8 1 14c0 9.5 13 23 13 23s13-13.5 13-23C27 6.8 21.2 1 14 1z" fill="#fff" fill-opacity="0.92" stroke="${c}" stroke-width="2" stroke-dasharray="3 2.5"/>` +
    `<circle cx="14" cy="14" r="4.5" fill="${c}"/>` +
    `</svg>`
  );
}

function previewPinSvg(color: string, glyph: string): string {
  // currentGlyph is a placeholder we swap for the colour, so filled and stroked
  // parts of a glyph share one source of truth.
  const g = glyph.replace(/currentGlyph/g, color);
  return (
    `<svg width="28" height="38" viewBox="0 0 28 38" xmlns="http://www.w3.org/2000/svg">` +
    `<path d="M14 0C6.3 0 0 6.3 0 14c0 9.9 14 24 14 24s14-14.1 14-24C28 6.3 21.7 0 14 0z" fill="${color}"/>` +
    `<circle cx="14" cy="14" r="8" fill="#fff"/>` +
    `<g fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${g}</g>` +
    `</svg>`
  );
}
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}
function labelIcon(text: string, color: string): L.DivIcon {
  const html = `<span style="white-space:nowrap;background:#fff;border:1px solid #ecd9e0;border-radius:999px;box-shadow:0 1px 4px rgba(0,0,0,.14);padding:1px 7px;font-size:10px;font-weight:600;color:${color};font-family:system-ui,-apple-system,sans-serif">${esc(text)}</span>`;
  return L.divIcon({ html, className: 'waypoint-leg-label', iconSize: [10, 10], iconAnchor: [5, 5] });
}

// Marker popup. Place pins (whether saved from search or derived from a table)
// link out for reviews, OSM has no ratings, so this is how you read them. The
// popup has no address, so the Tabelog link falls back to the pin name alone.
function pinPopupHtml(p: PageMapPin, fromTable: boolean): string {
  const name = `<strong>${esc(p.name)}</strong>`;
  if (p.kind !== 'place') return name;
  const tag = fromTable ? `<br><span style="color:#2f7dd1;font-size:11px">● from a table</span>` : '';
  const link = (href: string, text: string) =>
    `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer" style="color:#e05a86;font-weight:600;text-decoration:none">${text} ↗</a>`;
  const links =
    `<div style="margin-top:6px;display:flex;flex-direction:column;gap:3px;font-size:12px">` +
    link(tabelogSearchUrl(p.name), 'Search on Tabelog') +
    link(googleMapsUrl(p.name, p.lat, p.lon), 'Open in Google Maps') +
    `</div>`;
  return `${name}${tag}${links}`;
}

// A route resolved against the current pin set, with the geometry + label to
// draw. Ground legs come from `legs`; flights are computed here from the arc.
interface RouteDraw {
  id: string;
  mode: PageMapMode;
  from: PageMapPin;
  to: PageMapPin;
  coords: [number, number][];
  color: string;
  dashed: boolean;
  label: string; // '' until a ground leg has loaded
}

export function PageMap({ pageId, presence, onFocusPin, body }: { pageId: string; presence?: Map<string, PresenceRecord[]>; onFocusPin?: (id: string | null) => void; body?: object | null }) {
  const page = useData((s) => s.pages[pageId]);
  const pages = useData((s) => s.pages);
  const tables = useData((s) => s.tables);
  const rows = useData((s) => s.rows);
  const setPageMap = useData((s) => s.setPageMap);
  const setCell = useData((s) => s.setCell);
  const addRow = useData((s) => s.addRow);
  const publishShared = useData((s) => s.publishShared);
  const updateShared = useData((s) => s.updateShared);
  const unpublishShared = useData((s) => s.unpublishShared);

  const mapData = page?.map ?? EMPTY_MAP;
  const sources = useMemo(() => mapData.sources ?? [], [mapData.sources]);
  // On an encrypted page the store holds the body as an enc:v1: envelope, so
  // reading it raw yields no embedded tables and every derived place pin quietly
  // disappears. PageView keeps a decrypted copy for the editor; prefer it.
  const placePins = useMemo(
    () => derivePagePins(body ?? page?.content ?? null, sources, tables, rows),
    [body, page?.content, sources, tables, rows],
  );
  const allPins = useMemo(() => [...mapData.pins, ...placePins], [mapData.pins, placePins]);
  const pinById = useMemo(() => new Map(allPins.map((p) => [p.id, p])), [allPins]);
  // Stored pins (manual drops + saved search places) are editable/deletable;
  // pins derived from a table are read-only. Provenance, not kind, decides this.
  const storedIds = useMemo(() => new Set(mapData.pins.map((p) => p.id)), [mapData.pins]);

  // Ground legs (OSRM) keyed by route id, with the signature they were fetched
  // for so we only refetch when an endpoint or mode actually changes.
  const [legs, setLegs] = useState<Record<string, { sig: string; leg: Leg }>>({});
  const legsRef = useRef(legs);
  legsRef.current = legs;

  const groundSigOf = (r: PageMapRoute, from: PageMapPin, to: PageMapPin) =>
    `${r.id}|${from.lat},${from.lon}|${to.lat},${to.lon}|${r.mode}`;

  const groundRoutes = useMemo(
    () =>
      mapData.routes
        .filter((r) => r.mode !== 'flight')
        .map((r) => ({ r, from: pinById.get(r.fromPinId), to: pinById.get(r.toPinId) }))
        .filter((x): x is { r: PageMapRoute; from: PageMapPin; to: PageMapPin } => !!x.from && !!x.to),
    [mapData.routes, pinById],
  );
  const groundSig = groundRoutes.map(({ r, from, to }) => groundSigOf(r, from, to)).join('~');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const { r, from, to } of groundRoutes) {
        const sig = groundSigOf(r, from, to);
        if (legsRef.current[r.id]?.sig === sig) continue;
        const leg = await fetchLeg([from.lat, from.lon], [to.lat, to.lon], GROUND_PROFILE[r.mode as 'drive' | 'walk' | 'cycle']);
        if (cancelled) return;
        setLegs((prev) => ({ ...prev, [r.id]: { sig, leg } }));
      }
      // Drop legs for routes that no longer exist or turned into flights.
      const keep = new Set(groundRoutes.map(({ r }) => r.id));
      setLegs((prev) => {
        const next: typeof prev = {};
        for (const id of Object.keys(prev)) if (keep.has(id)) next[id] = prev[id];
        return Object.keys(next).length === Object.keys(prev).length ? prev : next;
      });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groundSig]);

  const routeDraws = useMemo<RouteDraw[]>(() => {
    const out: RouteDraw[] = [];
    for (const r of mapData.routes) {
      const from = pinById.get(r.fromPinId);
      const to = pinById.get(r.toPinId);
      if (!from || !to) continue; // dangling endpoint (row deleted), skip
      if (r.mode === 'flight') {
        const dist = haversineMeters([from.lat, from.lon], [to.lat, to.lon]);
        const label = `${formatDuration(estimateFlightDurationS(dist))} · ${formatDistance(dist)}`;
        out.push({ id: r.id, mode: r.mode, from, to, coords: curvePoints([from.lat, from.lon], [to.lat, to.lon]), color: MODE_COLOR.flight, dashed: true, label });
      } else {
        const entry = legs[r.id];
        const coords = entry ? entry.leg.coords : [[from.lat, from.lon], [to.lat, to.lon]] as [number, number][];
        const label = entry ? `${formatDuration(entry.leg.durationS)} · ${formatDistance(entry.leg.distanceM)}` : '';
        out.push({ id: r.id, mode: r.mode, from, to, coords, color: MODE_COLOR[r.mode], dashed: !!entry?.leg.estimated, label });
      }
    }
    return out;
  }, [mapData.routes, pinById, legs]);

  // --- Leaflet ---------------------------------------------------------------

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  // A separate layer for "find nearby" preview markers, so scattering restaurant
  // dots never disturbs the real pins / routes / fit-bounds logic.
  const previewLayerRef = useRef<L.LayerGroup | null>(null);
  // And a layer for the single provisional pin of a picked search result.
  const tempLayerRef = useRef<L.LayerGroup | null>(null);
  // The day-route line gets its own layer too, so drawing it never disturbs the
  // pins, the saved routes, or the one-time fit-bounds.
  const dayLayerRef = useRef<L.LayerGroup | null>(null);
  const fittedRef = useRef(false);

  const [pending, setPending] = useState<{ lat: number; lon: number } | null>(null);
  const [pendingName, setPendingName] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pinEditorId, setPinEditorId] = useState<string | null>(null); // the pin whose editor window is open
  // Tell presence which pin I'm editing, so collaborators see my avatar on it.
  useEffect(() => {
    onFocusPin?.(pinEditorId);
    return () => onFocusPin?.(null);
  }, [pinEditorId, onFocusPin]);
  // Right-click menu: map-specific actions anchored at the cursor, over the
  // coordinate under it. `copied` briefly confirms a clipboard write.
  const [mapMenu, setMapMenu] = useState<{ x: number; y: number; lat: number; lon: number } | null>(null);
  const [copied, setCopied] = useState('');
  const [menuOpen, setMenuOpen] = useState(false); // the export menu (top-right)
  const [shareOpen, setShareOpen] = useState(false); // the public-share popover
  const [shareBusy, setShareBusy] = useState(false);

  // Clicking a marker selects its pin; bring that row into view so the rename
  // field is reachable from the map even when the list has scrolled.
  const selectedRowRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (selectedId) selectedRowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  // Latest handlers behind refs so the once-bound map click / marker callbacks
  // always see current state.
  const onMapContextRef = useRef<(lat: number, lon: number, x: number, y: number) => void>(() => {});
  onMapContextRef.current = (lat, lon, x, y) => setMapMenu({ lat, lon, x, y });
  const onMapClickRef = useRef<(latlng: L.LatLng) => void>(() => {});
  onMapClickRef.current = (latlng) => {
    setMapMenu(null);
    setPending({ lat: latlng.lat, lon: latlng.lng });
    setPendingName('');
  };
  const movePinRef = useRef<(id: string, lat: number, lon: number) => void>(() => {});
  const commit = (next: PageMapData) => setPageMap(pageId, next);
  movePinRef.current = (id, lat, lon) =>
    commit({ ...mapData, pins: mapData.pins.map((p) => (p.id === id ? { ...p, lat, lon } : p)) });

  const allPinsRef = useRef(allPins);
  allPinsRef.current = allPins;
  const storedIdsRef = useRef(storedIds);
  storedIdsRef.current = storedIds;
  const routeDrawsRef = useRef(routeDraws);
  routeDrawsRef.current = routeDraws;

  // Create the map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { scrollWheelZoom: true, zoomControl: false }).setView([20, 0], 2);
    // Default zoom control sits top-left, under the search box, move it clear.
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    previewLayerRef.current = L.layerGroup().addTo(map);
    tempLayerRef.current = L.layerGroup().addTo(map);
    dayLayerRef.current = L.layerGroup().addTo(map);
    map.on('click', (e: L.LeafletMouseEvent) => onMapClickRef.current(e.latlng));
    map.on('contextmenu', (e: L.LeafletMouseEvent) => {
      e.originalEvent.preventDefault();
      onMapContextRef.current(e.latlng.lat, e.latlng.lng, e.originalEvent.clientX, e.originalEvent.clientY);
    });
    mapRef.current = map;
    setTimeout(() => map.invalidateSize(), 50);
    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
      previewLayerRef.current = null;
      tempLayerRef.current = null;
      dayLayerRef.current = null;
      fittedRef.current = false;
    };
  }, []);

  const pinsKey = JSON.stringify(allPins.map((p) => [p.id, p.lat, p.lon, p.name, p.kind]));
  const drawKey = JSON.stringify(routeDraws.map((d) => [d.id, d.mode, d.label, d.dashed, d.coords.length, d.from.lat, d.from.lon, d.to.lat, d.to.lon]));

  // Redraw markers + routes when anything changes. Fit bounds only once.
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();

    for (const d of routeDrawsRef.current) {
      L.polyline(d.coords, { color: d.color, weight: d.mode === 'flight' ? 2.5 : 4, opacity: 0.85, dashArray: d.mode === 'flight' ? '6 8' : d.dashed ? '7 7' : undefined }).addTo(layer);
      if (d.label) {
        const mid = d.coords[Math.floor(d.coords.length / 2)];
        if (mid) L.marker(mid, { icon: labelIcon(d.label, d.color), interactive: false }).addTo(layer);
      }
    }

    const latlngs: L.LatLngExpression[] = [];
    for (const p of allPinsRef.current) {
      const color = pinColor(p);
      const icon = L.divIcon({ html: pinSvg(color), className: 'waypoint-pin', iconSize: [26, 34], iconAnchor: [13, 34], popupAnchor: [0, -30] });
      const marker = L.marker([p.lat, p.lon], { icon, draggable: p.kind === 'manual' }).addTo(layer);
      marker.bindPopup(pinPopupHtml(p, p.kind === 'place' && !storedIdsRef.current.has(p.id)));
      marker.on('click', () => {
        setSelectedId(p.id);
        setPinEditorId(p.id);
      });
      if (p.kind === 'manual') {
        marker.on('dragend', () => {
          const ll = marker.getLatLng();
          movePinRef.current(p.id, ll.lat, ll.lng);
        });
      }
      latlngs.push([p.lat, p.lon]);
    }

    if (!fittedRef.current && latlngs.length) {
      if (latlngs.length === 1) map.setView(latlngs[0], 10);
      else map.fitBounds(L.latLngBounds(latlngs).pad(0.2));
      fittedRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinsKey, drawKey]);

  // --- Mutations -------------------------------------------------------------

  const addPin = (lat: number, lon: number, name: string) =>
    commit({ ...mapData, pins: [...mapData.pins, { id: uid('pin'), lat, lon, name: name.trim() || 'Pin', kind: 'manual' }] });
  // A place saved from search. Stored as kind 'place' (blue, links out for
  // reviews) but it lives in mapData.pins, so it's deletable like any user pin.
  const addSearchPin = (r: PlaceResult) =>
    commit({ ...mapData, pins: [...mapData.pins, { id: uid('pin'), lat: r.lat, lon: r.lon, name: r.name, kind: 'place' }] });
  // Save a searched place as a ROW in a chosen table (not just a map pin), so it
  // flows into the Budget / Itinerary tabs and any view of that table. addRow
  // handles encryption + workspace stamping; the place re-derives as a pin from
  // the new row on the next render.
  const addPlaceToTable = (r: PlaceResult, tableId: string) => {
    const t = tables[tableId];
    if (!t) return;
    const cells = placeRowCells(t.columns, { name: r.name, lat: r.lat, lon: r.lon, address: r.address, category: r.category });
    if (!cells) return;
    void addRow(tableId, cells).then((id) => {
      if (id) toast(`Added ${r.name} to ${t.name || 'the table'}`);
    });
  };
  // Add every result of the current search / Nearby sweep to a table at once.
  // Same create-only path as the single add, just looped.
  const addAllToTable = async (rs: PlaceResult[], tableId: string) => {
    const t = tables[tableId];
    if (!t) return;
    let n = 0;
    for (const r of rs) {
      const cells = placeRowCells(t.columns, { name: r.name, lat: r.lat, lon: r.lon, address: r.address, category: r.category });
      if (!cells) continue;
      if (await addRow(tableId, cells)) n++;
    }
    if (n) toast(`Added ${n} place${n === 1 ? '' : 's'} to ${t.name || 'the table'}`);
  };
  const renamePin = (id: string, name: string) =>
    commit({ ...mapData, pins: mapData.pins.map((p) => (p.id === id ? { ...p, name } : p)) });
  // Rename any pin from the side list. Stored pins (manual drops + saved
  // searches) update mapData directly; derived place pins (`place:<rowId>:<colId>`)
  // have no record of their own, so we write the new name back onto the source
  // table cell. The pin re-derives with that name on the next render, keeping the
  // map and the table in sync. We spread the existing GeoValue so lat/lon and the
  // OSM detail fields survive.
  const renameAnyPin = (p: PageMapPin, name: string) => {
    if (storedIds.has(p.id)) {
      renamePin(p.id, name);
      return;
    }
    const m = /^place:([^:]+):(.+)$/.exec(p.id);
    if (!m) return;
    const [, rowId, colId] = m;
    const geo = geoOf(rows[rowId]?.cells[colId] ?? null);
    if (!geo) return;
    setCell(rowId, colId, { ...geo, name });
  };
  const deletePin = (id: string) =>
    commit({ ...mapData, pins: mapData.pins.filter((p) => p.id !== id), routes: mapData.routes.filter((r) => r.fromPinId !== id && r.toPinId !== id) });
  // Recolour a STORED pin (manual drop / saved search). Derived pins take their
  // colour from the source table, so this is a no-op for them (nothing matches).
  const setPinColor = (id: string, color: string) =>
    commit({ ...mapData, pins: mapData.pins.map((p) => (p.id === id ? { ...p, color } : p)) });
  const addRoute = (fromPinId: string, toPinId: string, mode: PageMapMode) =>
    commit({ ...mapData, routes: [...mapData.routes, { id: uid('route'), fromPinId, toPinId, mode }] });
  const setRouteMode = (id: string, mode: PageMapMode) =>
    commit({ ...mapData, routes: mapData.routes.map((r) => (r.id === id ? { ...r, mode } : r)) });
  const deleteRoute = (id: string) => commit({ ...mapData, routes: mapData.routes.filter((r) => r.id !== id) });

  // Chain the place pins into a path, flying the long legs and driving the rest.
  // Additive: pairs already joined by a route (either direction) are left alone.
  const autoRouteStops = () => {
    if (placePins.length < 2) return;
    const has = (a: string, b: string) => mapData.routes.some((r) => (r.fromPinId === a && r.toPinId === b) || (r.fromPinId === b && r.toPinId === a));
    const added: PageMapRoute[] = [];
    for (let i = 0; i < placePins.length - 1; i++) {
      const a = placePins[i];
      const b = placePins[i + 1];
      if (has(a.id, b.id)) continue;
      const mode = autoLegMode(haversineMeters([a.lat, a.lon], [b.lat, b.lon]));
      added.push({ id: uid('route'), fromPinId: a.id, toPinId: b.id, mode });
    }
    if (added.length) commit({ ...mapData, routes: [...mapData.routes, ...added] });
  };

  // A day's shape: the pins currently on the map, in order, as one line with a
  // total. No day model is needed and none is invented: "the pins you are looking
  // at" is the selection, which is why this could ship before the time-aware
  // itinerary it was waiting on. Great-circle, so it is honest that it estimates
  // rather than pretending to be a routed answer, and it needs no network.
  const [dayRouteMode, setDayRouteMode] = useState<'walking' | 'cycling' | 'driving' | null>(null);
  const dayRoute = useMemo(
    () =>
      dayRouteMode && placePins.length >= 2
        ? buildDayRoute(placePins.map((p) => ({ id: p.id, name: p.name, lat: p.lat, lon: p.lon })), dayRouteMode)
        : null,
    [dayRouteMode, placePins],
  );

  // Draw (and clear) the day line. Dashed, because it is a straight-line estimate
  // and should not be mistaken for the solid saved routes beside it.
  useEffect(() => {
    const layer = dayLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    if (!dayRoute || dayRoute.stops.length < 2) return;
    L.polyline(
      dayRoute.stops.map((s) => [s.lat, s.lon] as [number, number]),
      { color: 'rgb(224 90 134)', weight: 3, opacity: 0.9, dashArray: '6 6' },
    ).addTo(layer);
    dayRoute.stops.forEach((s, i) => {
      L.marker([s.lat, s.lon], {
        interactive: false,
        icon: L.divIcon({
          className: '',
          html: `<div style="background:rgb(224 90 134);color:#fff;font:600 10px/16px system-ui;width:16px;height:16px;border-radius:9999px;text-align:center;box-shadow:0 0 0 2px #fff">${i + 1}</div>`,
          iconSize: [16, 16],
          iconAnchor: [8, 8],
        }),
      }).addTo(layer);
    });
  }, [dayRoute]);

  // Reorder the map's own stored pins nearest-neighbour from the first, which is
  // usually where you start. Only stored pins move; a derived pin's order belongs
  // to its source table, so it is left alone.
  const reorderNearest = () => {
    if (mapData.pins.length < 3) return;
    const ordered = orderByNearest(mapData.pins.map((p) => ({ id: p.id, name: p.name, lat: p.lat, lon: p.lon })));
    const byId = new Map(mapData.pins.map((p) => [p.id, p]));
    commit({ ...mapData, pins: ordered.map((s) => byId.get(s.id)!).filter(Boolean) });
  };

  // --- Linked table sources --------------------------------------------------
  // Pull the place rows of any table in the workspace onto this map, live and
  // coloured, so a parent page's map can show several child lists at once and
  // tell them apart. The pins derive from the store, so editing a row on its own
  // page updates here with no copy kept.
  const wsId = page?.workspace ?? '';
  const candidates = useMemo(() => placeTablesForWorkspace(pages, tables, wsId), [pages, tables, wsId]);
  const candidatesByPage = useMemo(() => {
    const m = new Map<string, PlaceTableRef[]>();
    for (const c of candidates) m.set(c.pageTitle, [...(m.get(c.pageTitle) ?? []), c]);
    return [...m.entries()];
  }, [candidates]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [colorPickFor, setColorPickFor] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  // Add a batch of imported places as stored 'place' pins (blue, deletable, and
  // linked out for reviews like a saved search result). Refit so they show.
  const addImportedPins = (places: ImportedPlace[]) => {
    if (!places.length) return;
    const pins = places.slice(0, 1000).map((p) => ({ id: uid('pin'), lat: p.lat, lon: p.lon, name: p.name, kind: 'place' as const }));
    fittedRef.current = false; // let the redraw refit bounds to include them
    commit({ ...mapData, pins: [...mapData.pins, ...pins] });
  };

  const addSource = (tableId: string) => {
    if (sources.some((s) => s.tableId === tableId)) return;
    const color = nextSourceColor(sources.map((s) => s.color));
    commit({ ...mapData, sources: [...sources, { tableId, color }] });
  };
  const removeSource = (tableId: string) =>
    commit({ ...mapData, sources: sources.filter((s) => s.tableId !== tableId) });
  const setSourceColor = (tableId: string, color: string) => {
    commit({ ...mapData, sources: sources.map((s) => (s.tableId === tableId ? { ...s, color } : s)) });
    setColorPickFor(null);
  };

  // --- OSM search ------------------------------------------------------------
  // Type a place or city, debounced, then pick a result to fly there and read
  // its links. searchPlaces handles caching + Nominatim's rate limit; the 450ms
  // debounce keeps us from firing on every keystroke.
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<PlaceResult | null>(null);
  const [bulkPickOpen, setBulkPickOpen] = useState(false);
  const [pinFilter, setPinFilter] = useState('');
  // "Only this area": hard-limit the text search to the box currently in view.
  const [boundToArea, setBoundToArea] = useState(false);
  // "Find nearby": query Overpass for every POI of a category inside the current
  // viewport. `areaPins` are the transient dots on the map; `results` shows the
  // same list in the search dropdown so either can be picked and saved.
  const [areaPins, setAreaPins] = useState<PlaceResult[]>([]);
  const [areaCat, setAreaCat] = useState<string | null>(null);
  const [areaBusy, setAreaBusy] = useState(false);
  const [areaErr, setAreaErr] = useState('');

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    let cancelled = false;
    const t = setTimeout(async () => {
      const map = mapRef.current;
      const c = map?.getCenter();
      const near = c ? { lat: c.lat, lon: c.lng } : undefined;
      // When "only this area" is on, pass the live viewport as a hard bound.
      const opts =
        boundToArea && map
          ? (() => {
              const b = map.getBounds();
              return { viewbox: { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() }, bounded: true };
            })()
          : undefined;
      const found = await searchPlaces(q, near, opts);
      if (cancelled) return;
      setResults(found);
      setSearching(false);
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, boundToArea]);

  const pickResult = (r: PlaceResult) => {
    setPicked(r);
    mapRef.current?.setView([r.lat, r.lon], 14);
  };
  const clearArea = () => {
    setAreaPins([]); // pins off the map
    setResults([]); // and the list under the search box
    setAreaCat(null);
    setAreaErr('');
  };
  const clearSearch = () => {
    setQuery('');
    setResults([]);
    setPicked(null);
    clearArea();
  };

  // Search the *currently viewed* box for a whole category of places. Reads the
  // live map bounds, so you pan/zoom to the area then tap a category. Results
  // scatter as dots and fill the list; picking one flies to it and offers "add".
  const searchArea = async (cat: AreaCategory) => {
    const map = mapRef.current;
    if (!map) return;
    const b = map.getBounds();
    const bounds = { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() };
    setQuery('');
    setPicked(null);
    setResults([]);
    setAreaErr('');
    setAreaPins([]); // drop the previous category's pins right away
    setAreaCat(cat.key);
    setAreaBusy(true);
    try {
      const found = await searchAreaPois(cat, bounds);
      setAreaPins(found);
      setResults(found);
      if (found.length === 0) setAreaErr('Nothing tagged here. Try another category or pan the map.');
    } catch (e) {
      setAreaPins([]);
      setAreaErr(e instanceof AreaTooBigError ? e.message : 'Search failed, try again in a moment.');
    }
    setAreaBusy(false);
  };

  // Latest values behind refs for the once-bound Leaflet marker callbacks.
  const areaPinsRef = useRef(areaPins);
  areaPinsRef.current = areaPins;
  const areaCatRef = useRef(areaCat);
  areaCatRef.current = areaCat;
  const pickResultRef = useRef(pickResult);
  pickResultRef.current = pickResult;

  // Draw the "find nearby" results as category pins on their own layer: a
  // coloured teardrop with the category's SVG glyph in the head. Cleared and
  // redrawn whenever the results or category change, so a new search or a
  // de-selected chip (areaPins -> []) wipes the old pins off their coordinates.
  const areaKey = JSON.stringify([areaCat, areaPins.map((p) => [p.id, p.lat, p.lon])]);
  useEffect(() => {
    const layer = previewLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    const style = CATEGORY_PIN[areaCatRef.current ?? ''] ?? PREVIEW_FALLBACK;
    const icon = L.divIcon({
      html: previewPinSvg(style.color, style.glyph),
      className: 'waypoint-pin',
      iconSize: [28, 38],
      iconAnchor: [14, 38],
      popupAnchor: [0, -32],
    });
    for (const r of areaPinsRef.current) {
      const m = L.marker([r.lat, r.lon], { icon });
      m.bindTooltip(r.name, { direction: 'top', offset: [0, -30] });
      m.on('click', () => pickResultRef.current(r));
      m.addTo(layer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areaKey]);

  // A provisional pin wherever a search result is picked, so you SEE the spot
  // before committing. It lives on its own layer and is cleared the moment the
  // pick is closed, saved ("Add as pin" -> a real pin), or the search is reset.
  useEffect(() => {
    const layer = tempLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    if (picked) {
      const icon = L.divIcon({ html: tempPinSvg(), className: 'waypoint-pin', iconSize: [28, 38], iconAnchor: [14, 38], popupAnchor: [0, -32] });
      L.marker([picked.lat, picked.lon], { icon }).bindTooltip(picked.name, { direction: 'top', offset: [0, -30] }).addTo(layer);
    }
  }, [picked]);

  // --- New-route form --------------------------------------------------------

  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [newMode, setNewMode] = useState<PageMapMode>('flight');
  const canAddRoute = fromId && toId && fromId !== toId;

  const labelFor = (id: string) => routeDraws.find((d) => d.id === id)?.label ?? '';

  // --- Right-click menu helpers ---------------------------------------------
  const fmtCoord = (lat: number, lon: number) => `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
  const gmapUrl = (lat: number, lon: number) => `https://www.google.com/maps?q=${lat},${lon}`;
  const copyText = (text: string, msg: string) => {
    try {
      void navigator.clipboard?.writeText(text);
    } catch {
      /* clipboard blocked (insecure context); nothing else to do */
    }
    setCopied(msg);
    setTimeout(() => setCopied((c) => (c === msg ? '' : c)), 1300);
  };

  // Every place on the map as portable data. Derived pins (place:<rowId>:<colId>)
  // carry the source cell's address/category when it has them; manual + saved
  // search pins are just name + coordinates.
  const placeOf = (p: PageMapPin): MapPlace => {
    const m = /^place:([^:]+):(.+)$/.exec(p.id);
    const g = m ? geoOf(rows[m[1]]?.cells[m[2]] ?? null) : null;
    const place: MapPlace = { name: p.name || 'Pin', lat: p.lat, lon: p.lon };
    if (g?.address) place.address = g.address;
    if (g?.category) place.category = g.category;
    return place;
  };
  const mapPlaces = (): MapPlace[] => allPins.map(placeOf);
  const exportMap = (fmt: 'json' | 'csv' | 'gpx') => {
    const places = mapPlaces();
    const safe = (page?.title || 'map').replace(/[^\w-]+/g, '_');
    const title = page?.title || 'Map';
    if (fmt === 'json') download(`${safe}.map.json`, placesToJson(places, title), 'application/json');
    else if (fmt === 'gpx') download(`${safe}.gpx`, placesToGpx(places, title), 'application/gpx+xml');
    else download(`${safe}.map.csv`, placesToCsv(places), 'text/csv');
    setMenuOpen(false);
  };
  const copyAllCsv = () => {
    copyText(placesToCsv(mapPlaces()), `Copied ${allPins.length} place${allPins.length === 1 ? '' : 's'}`);
    setMenuOpen(false);
  };

  // Read-only public share, exactly like the recipe/setlist share: publish a
  // separate PLAINTEXT copy of just this map (a self-contained sharedMapBlock
  // whose data rides in its attrs, so it renders account-less), keep the token in
  // page.map so the link persists and can be updated or revoked. The rest of the
  // workspace stays private; this is a deliberate public copy, not E2E.
  const shareToken = mapData.shareToken || '';
  const shareId = mapData.shareId || '';
  const shareLink = shareToken ? `${window.location.origin}${window.location.pathname}?share=${shareToken}` : '';
  const sharedDoc = () => ({ type: 'doc', content: [{ type: 'sharedMapBlock', attrs: { title: page?.title || 'Map', places: mapPlaces() } }] });
  const createShare = async () => {
    setShareBusy(true);
    const res = await publishShared(wsId, page?.title || 'Map', sharedDoc());
    setShareBusy(false);
    if (res) commit({ ...mapData, shareId: res.pageId, shareToken: res.token });
    else copyText('', 'Could not create the link');
  };
  const refreshShare = async () => {
    if (!shareId) return;
    await updateShared(shareId, page?.title || 'Map', sharedDoc());
    setCopied('Shared copy updated');
    setTimeout(() => setCopied((c) => (c === 'Shared copy updated' ? '' : c)), 1300);
  };
  const stopShare = async () => {
    if (shareId) await unpublishShared(shareId);
    commit({ ...mapData, shareId: undefined, shareToken: undefined });
    setShareOpen(false);
  };

  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      {/* isolate: contain the map's high z-index overlays (search/toolbar at
          z-[1200], to clear Leaflet's controls) to this box, so they don't escape
          above the mobile sidebar drawer (App.tsx, z-40). */}
      <div className="relative isolate min-h-0 flex-1">
        <div
          ref={containerRef}
          className="isolate h-[55vh] w-full md:h-full"
          style={{ background: '#aadaff' }}
        />
        {/* OSM search: find a place/city, fly to it, read its links, save it. */}
        <div className="absolute left-2 top-2 z-[1200] w-[min(20rem,calc(100%-1rem))]">
          <div className="flex items-center gap-1.5 rounded-lg border border-paper-line bg-paper px-2 py-1.5 shadow-sm dark:border-coal-line dark:bg-coal-panel">
            <Search className="h-4 w-4 shrink-0 text-ink-faint dark:text-coal-soft" />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                if (e.target.value) clearArea(); // a text search hides the nearby dots
              }}
              onKeyDown={(e) => e.key === 'Escape' && clearSearch()}
              placeholder="search the map (place, city, address)"
              className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint/70 dark:text-coal-text"
            />
            {(query || picked || areaCat) && (
              <button
                type="button"
                onClick={clearSearch}
                className="rounded p-0.5 text-ink-faint hover:bg-paper-panel hover:text-ink dark:text-coal-soft dark:hover:bg-coal-line"
                title="Clear"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Limit the text search to the visible map box (Nominatim bounded=1). */}
          <label className="mt-1 flex w-max cursor-pointer items-center gap-1.5 rounded-lg border border-paper-line bg-paper/95 px-2 py-1 text-[11px] text-ink-soft shadow-sm dark:border-coal-line dark:bg-coal-panel/95 dark:text-coal-soft">
            <input type="checkbox" checked={boundToArea} onChange={(e) => setBoundToArea(e.target.checked)} className="accent-clay" />
            Search only this map area
          </label>

          {/* Find nearby: search the box you're looking at for a whole category
              (restaurants, cafés, ...) via Overpass. Pan/zoom first, then tap. */}
          <div className="mt-1 flex flex-wrap items-center gap-1 rounded-lg border border-paper-line bg-paper/95 px-1.5 py-1 shadow-sm dark:border-coal-line dark:bg-coal-panel/95">
            <span className="pl-0.5 pr-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-faint dark:text-coal-soft">Nearby</span>
            {AREA_CATEGORIES.map((c) => {
              const on = areaCat === c.key;
              return (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => (on ? clearArea() : void searchArea(c))}
                  disabled={areaBusy && !on}
                  title={on ? `Hide the ${c.label.toLowerCase()}` : `Find ${c.label.toLowerCase()} in the area shown`}
                  className={[
                    'rounded-full px-2 py-0.5 text-[11px] disabled:opacity-50',
                    on
                      ? 'bg-clay text-white'
                      : 'border border-paper-line text-ink-soft hover:bg-paper-panel dark:border-coal-line dark:text-coal-soft dark:hover:bg-coal-line',
                  ].join(' ')}
                >
                  {c.label}
                </button>
              );
            })}
            {areaBusy && <span className="pl-0.5 text-[11px] text-ink-faint dark:text-coal-soft">searching…</span>}
          </div>

          {!picked && results.length > 1 && candidates.length > 0 && (
            <div className="relative mt-1">
              <button
                type="button"
                onClick={() => setBulkPickOpen((o) => !o)}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-paper-line px-2 py-1 text-xs font-medium text-ink-soft hover:bg-paper-panel dark:border-coal-line dark:text-coal-soft dark:hover:bg-coal-line"
                title="Save every result here as rows in a table"
              >
                <Plus className="h-3.5 w-3.5" /> Add all {results.length} to trip
              </button>
              {bulkPickOpen && (
                <div className="absolute left-0 right-0 top-full z-[1400] mt-1 max-h-48 overflow-y-auto rounded-md border border-paper-line bg-paper py-1 shadow-lg dark:border-coal-line dark:bg-coal-panel">
                  {candidates.map((ref) => (
                    <button
                      key={ref.tableId}
                      type="button"
                      onClick={() => {
                        void addAllToTable(results, ref.tableId);
                        setBulkPickOpen(false);
                      }}
                      className="flex w-full flex-col items-start px-2 py-1 text-left hover:bg-paper-panel dark:hover:bg-coal-line"
                    >
                      <span className="truncate text-xs text-ink dark:text-coal-text">{ref.tableName}</span>
                      <span className="truncate text-[10px] text-ink-faint dark:text-coal-soft">{ref.pageTitle}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {picked ? (
            <PlaceCard
              place={picked}
              onAdd={() => {
                addSearchPin(picked);
                setPicked(null);
              }}
              tripTables={candidates}
              onAddToTable={(tableId) => {
                addPlaceToTable(picked, tableId);
                setPicked(null);
              }}
              onClose={() => setPicked(null)}
            />
          ) : (
            (searching || areaBusy || results.length > 0 || areaErr) && (
              <ul className="mt-1 max-h-64 overflow-y-auto rounded-lg border border-paper-line bg-paper py-1 shadow-lg dark:border-coal-line dark:bg-coal-panel">
                {(searching || areaBusy) && results.length === 0 && (
                  <li className="px-2.5 py-1.5 text-xs text-ink-faint dark:text-coal-soft">searching…</li>
                )}
                {!searching && !areaBusy && results.length === 0 && (
                  <li className="px-2.5 py-1.5 text-xs text-ink-faint dark:text-coal-soft">{areaErr || 'no matches'}</li>
                )}
                {results.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => pickResult(r)}
                      className="flex w-full flex-col items-start gap-0.5 px-2.5 py-1.5 text-left hover:bg-paper-panel dark:hover:bg-coal-line"
                    >
                      <span className="text-sm text-ink dark:text-coal-text">{r.name}</span>
                      {(r.category || r.address) && (
                        <span className="line-clamp-1 text-[11px] text-ink-faint dark:text-coal-soft">
                          {[r.category, r.address].filter(Boolean).join(' · ')}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )
          )}
        </div>

        {/* Export + Share (top-right). */}
        <div className="absolute right-2 top-2 z-[1200] flex items-center gap-1.5">
          <div className="relative">
            <button
              type="button"
              onClick={() => { setShareOpen((o) => !o); setMenuOpen(false); }}
              title="Share a read-only link"
              className={[
                'flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium shadow-sm',
                shareToken
                  ? 'border-clay bg-clay text-white hover:bg-clay/90'
                  : 'border-paper-line bg-paper text-ink-soft hover:bg-paper-panel dark:border-coal-line dark:bg-coal-panel dark:text-coal-soft dark:hover:bg-coal-line',
              ].join(' ')}
            >
              <Share2 className="h-3.5 w-3.5" /> Share
            </button>
            {shareOpen && (
              <>
                <div className="fixed inset-0 z-[1200]" onMouseDown={() => setShareOpen(false)} />
                <div className="absolute right-0 top-full z-[1201] mt-1 w-72 rounded-lg border border-paper-line bg-paper p-3 shadow-2xl dark:border-coal-line dark:bg-coal-panel">
                  {shareToken ? (
                    <>
                      <div className="mb-2 text-xs text-ink-soft dark:text-coal-soft">
                        Anyone with this link can view this map + its places, read-only, on a map/table toggle. No account; nothing else of yours is shown.
                      </div>
                      <div className="flex items-center gap-1.5">
                        <input
                          readOnly
                          value={shareLink}
                          onFocus={(e) => e.currentTarget.select()}
                          className="min-w-0 flex-1 rounded border border-paper-line bg-paper-panel px-2 py-1 text-xs text-ink-soft outline-none dark:border-coal-line dark:bg-coal dark:text-coal-soft"
                        />
                        <button type="button" onClick={() => copyText(shareLink, 'Link copied')} className="shrink-0 rounded bg-clay px-2 py-1 text-xs font-medium text-white hover:bg-clay/90" title="Copy link">
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <div className="mt-2 flex items-center gap-2 text-xs">
                        <button type="button" onClick={() => void refreshShare()} className="flex items-center gap-1 text-ink-soft hover:text-clay dark:text-coal-soft">
                          <RefreshCw className="h-3 w-3" /> Update shared copy
                        </button>
                        <button type="button" onClick={() => void stopShare()} className="ml-auto flex items-center gap-1 text-ink-faint hover:text-rose-500">
                          <Trash2 className="h-3 w-3" /> Stop sharing
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="mb-2 text-xs text-ink-soft dark:text-coal-soft">
                        Create a read-only link to show this map to anyone, on a map/table toggle like the recipe share. It is a separate public copy; the rest of your workspace stays private.
                      </div>
                      <button
                        type="button"
                        onClick={() => void createShare()}
                        disabled={shareBusy}
                        className="flex w-full items-center justify-center gap-1.5 rounded-md bg-clay px-3 py-1.5 text-xs font-medium text-white hover:bg-clay/90 disabled:opacity-50"
                      >
                        <Share2 className="h-3.5 w-3.5" /> {shareBusy ? 'Creating…' : 'Create a read-only link'}
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
          <div className="relative">
          <button
            type="button"
            onClick={() => { setMenuOpen((o) => !o); setShareOpen(false); }}
            title="Export the map"
            className="flex items-center gap-1.5 rounded-lg border border-paper-line bg-paper px-2.5 py-1.5 text-xs font-medium text-ink-soft shadow-sm hover:bg-paper-panel dark:border-coal-line dark:bg-coal-panel dark:text-coal-soft dark:hover:bg-coal-line"
          >
            <Download className="h-3.5 w-3.5" /> Export
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-[1200]" onMouseDown={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-full z-[1201] mt-1 w-52 overflow-hidden rounded-lg border border-paper-line bg-paper py-1 shadow-2xl dark:border-coal-line dark:bg-coal-panel">
                <div className="px-3 pb-1 pt-0.5 text-[10px] uppercase tracking-wide text-ink-faint dark:text-coal-soft">{allPins.length} place{allPins.length === 1 ? '' : 's'}</div>
                <button type="button" onClick={() => exportMap('json')} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-ink hover:bg-paper-panel dark:text-coal-text dark:hover:bg-coal-line">
                  <FileJson className="h-4 w-4 text-ink-faint" /> Export as JSON
                </button>
                <button type="button" onClick={() => exportMap('csv')} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-ink hover:bg-paper-panel dark:text-coal-text dark:hover:bg-coal-line">
                  <FileDown className="h-4 w-4 text-ink-faint" /> Export as CSV
                </button>
                <button type="button" onClick={() => exportMap('gpx')} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-ink hover:bg-paper-panel dark:text-coal-text dark:hover:bg-coal-line">
                  <MapPin className="h-4 w-4 text-ink-faint" /> Export as GPX
                </button>
                <button type="button" onClick={copyAllCsv} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-ink hover:bg-paper-panel dark:text-coal-text dark:hover:bg-coal-line">
                  <Copy className="h-4 w-4 text-ink-faint" /> Copy all as CSV
                </button>
              </div>
            </>
          )}
          </div>
        </div>

        <div className="pointer-events-none absolute bottom-2 left-2 z-[1000] flex items-center gap-1 rounded-full bg-paper/90 px-2 py-1 text-[11px] text-ink-faint shadow-sm dark:bg-coal-panel/90 dark:text-coal-soft">
          <MousePointerClick className="h-3.5 w-3.5 text-clay" /> click the map to drop a pin
        </div>

        {pending && (
          <div className="absolute left-1/2 top-3 z-[1200] flex -translate-x-1/2 items-center gap-1.5 rounded-lg border border-paper-line bg-paper p-1.5 shadow-xl dark:border-coal-line dark:bg-coal-panel">
            <input
              autoFocus
              value={pendingName}
              onChange={(e) => setPendingName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  addPin(pending.lat, pending.lon, pendingName);
                  setPending(null);
                } else if (e.key === 'Escape') setPending(null);
              }}
              placeholder="name this pin"
              className="w-44 rounded-md border border-paper-line bg-paper px-2 py-1 text-sm text-ink outline-none dark:border-coal-line dark:bg-coal dark:text-coal-text"
            />
            <button
              type="button"
              onClick={() => {
                addPin(pending.lat, pending.lon, pendingName);
                setPending(null);
              }}
              className="rounded-md bg-clay px-2 py-1 text-xs font-medium text-white hover:bg-clay/90"
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => setPending(null)}
              className="rounded-md px-1.5 py-1 text-xs text-ink-faint hover:bg-paper-panel dark:text-coal-soft dark:hover:bg-coal-line"
            >
              Cancel
            </button>
          </div>
        )}

        {/* Pin editor: press a pin to open a window with its name, colour, and
            copyable coordinates + address. */}
        {pinEditorId && (() => {
          const p = pinById.get(pinEditorId);
          if (!p) return null;
          const stored = storedIds.has(p.id);
          const pl = placeOf(p);
          const coords = `${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}`;
          const palette = [MANUAL_COLOR, DEFAULT_PLACE_COLOR, ...SOURCE_COLORS].filter((c, i, a) => a.findIndex((x) => x.toLowerCase() === c.toLowerCase()) === i);
          return (
            <>
              <div className="fixed inset-0 z-[1290]" onMouseDown={() => setPinEditorId(null)} />
              <div className="absolute left-1/2 top-3 z-[1300] w-[min(20rem,calc(100%-1rem))] -translate-x-1/2 rounded-xl border border-paper-line bg-paper p-3 shadow-2xl dark:border-coal-line dark:bg-coal-panel">
                <div className="mb-2 flex items-center gap-2">
                  <MapPin className="h-4 w-4 shrink-0" style={{ color: pinColor(p) }} />
                  <input
                    autoFocus
                    value={p.name}
                    onChange={(e) => renameAnyPin(p, e.target.value)}
                    placeholder="Pin name"
                    className="min-w-0 flex-1 rounded-md border border-paper-line bg-paper px-2 py-1 text-sm text-ink outline-none focus:border-clay dark:border-coal-line dark:bg-coal dark:text-coal-text"
                  />
                  <button type="button" onClick={() => setPinEditorId(null)} className="rounded p-1 text-ink-faint hover:bg-paper-panel hover:text-ink dark:hover:bg-coal-line" title="Close">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="mb-2">
                  <div className="mb-1 text-[11px] text-ink-faint dark:text-coal-soft">Colour{stored ? '' : ' (set on the source table)'}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {palette.map((c) => (
                      <button
                        key={c}
                        type="button"
                        disabled={!stored}
                        onClick={() => setPinColor(p.id, c)}
                        title={c}
                        className={`h-5 w-5 rounded-full ring-1 ring-black/10 disabled:cursor-default disabled:opacity-40 ${pinColor(p).toLowerCase() === c.toLowerCase() ? 'outline outline-2 outline-offset-1 outline-ink dark:outline-coal-text' : ''}`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                </div>
                {/* What it will be like there, for deciding whether this pin is a
                    Tuesday or a stay-inside day. */}
                <PinWeather lat={p.lat} lon={p.lon} />
                <button type="button" onClick={() => copyText(coords, 'Coordinates copied')} className="mb-1.5 flex w-full items-center justify-between gap-2 rounded-md border border-paper-line px-2 py-1 text-left hover:bg-paper-panel dark:border-coal-line dark:hover:bg-coal-line" title="Copy coordinates">
                  <span className="font-mono text-xs text-ink-soft dark:text-coal-soft">{coords}</span>
                  <Copy className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
                </button>
                {pl.address && (
                  <button type="button" onClick={() => copyText(pl.address as string, 'Address copied')} className="mb-1.5 flex w-full items-center justify-between gap-2 rounded-md border border-paper-line px-2 py-1 text-left hover:bg-paper-panel dark:border-coal-line dark:hover:bg-coal-line" title="Copy address">
                    <span className="min-w-0 flex-1 truncate text-xs text-ink-soft dark:text-coal-soft">{pl.address}</span>
                    <Copy className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
                  </button>
                )}
                <div className="mt-1 flex items-center gap-2">
                  <button type="button" onClick={() => copyText(placeClipboardText(pl), pl.address ? 'Place + address copied' : 'Coordinates copied')} className="flex items-center gap-1 rounded-md bg-clay px-2 py-1 text-xs font-medium text-white hover:bg-clay/90">
                    <Copy className="h-3 w-3" /> Copy all
                  </button>
                  <a href={gmapUrl(p.lat, p.lon)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-ink-soft hover:text-clay dark:text-coal-soft">
                    <ExternalLink className="h-3 w-3" /> Google Maps
                  </a>
                  {stored && (
                    <button type="button" onClick={() => { deletePin(p.id); setPinEditorId(null); }} className="ml-auto flex items-center gap-1 text-xs text-ink-faint hover:text-rose-500">
                      <Trash2 className="h-3 w-3" /> Delete
                    </button>
                  )}
                </div>
              </div>
            </>
          );
        })()}

        {/* Copy confirmation toast. */}
        {copied && (
          <div className="pointer-events-none absolute bottom-2 left-1/2 z-[1300] -translate-x-1/2 rounded-full bg-ink/85 px-3 py-1 text-xs font-medium text-white shadow-lg dark:bg-coal-text/90 dark:text-coal">
            {copied}
          </div>
        )}

        {/* Right-click menu: map-specific actions over the coordinate you clicked. */}
        {mapMenu && (
          <>
            <div
              className="fixed inset-0 z-[1400]"
              onMouseDown={() => setMapMenu(null)}
              onContextMenu={(e) => {
                e.preventDefault();
                setMapMenu(null);
              }}
            />
            <div
              className="fixed z-[1401] w-56 overflow-hidden rounded-lg border border-paper-line bg-paper py-1 shadow-2xl dark:border-coal-line dark:bg-coal-panel"
              style={{ left: Math.min(mapMenu.x, window.innerWidth - 232), top: Math.min(mapMenu.y, window.innerHeight - 190) }}
            >
              <div className="select-all px-3 py-1.5 font-mono text-[11px] text-ink-faint dark:text-coal-soft">{fmtCoord(mapMenu.lat, mapMenu.lon)}</div>
              <div className="my-1 h-px bg-paper-line dark:bg-coal-line" />
              <button
                type="button"
                onClick={() => {
                  copyText(fmtCoord(mapMenu.lat, mapMenu.lon), 'Coordinates copied');
                  setMapMenu(null);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-ink hover:bg-paper-panel dark:text-coal-text dark:hover:bg-coal-line"
              >
                <Copy className="h-4 w-4 text-ink-faint" /> Copy coordinates
              </button>
              <button
                type="button"
                onClick={() => {
                  copyText(gmapUrl(mapMenu.lat, mapMenu.lon), 'Link copied');
                  setMapMenu(null);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-ink hover:bg-paper-panel dark:text-coal-text dark:hover:bg-coal-line"
              >
                <Link2 className="h-4 w-4 text-ink-faint" /> Copy Google Maps link
              </button>
              <button
                type="button"
                onClick={() => {
                  setPending({ lat: mapMenu.lat, lon: mapMenu.lon });
                  setPendingName('');
                  setMapMenu(null);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-ink hover:bg-paper-panel dark:text-coal-text dark:hover:bg-coal-line"
              >
                <MapPin className="h-4 w-4 text-ink-faint" /> Drop a pin here
              </button>
              <button
                type="button"
                onClick={() => {
                  window.open(gmapUrl(mapMenu.lat, mapMenu.lon), '_blank', 'noopener');
                  setMapMenu(null);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-ink hover:bg-paper-panel dark:text-coal-text dark:hover:bg-coal-line"
              >
                <ExternalLink className="h-4 w-4 text-ink-faint" /> Open in Google Maps
              </button>
            </div>
          </>
        )}
      </div>

      <aside className="flex max-h-[45vh] w-full shrink-0 flex-col overflow-y-auto border-t border-paper-line p-3 dark:border-coal-line md:max-h-none md:w-80 md:border-l md:border-t-0">
        {/* Sources: tables from anywhere in the workspace, pinned live and colour-
            coded, so one map can hold several lists (Tokyo, Fukuoka) at once. */}
        <div className="mb-1 flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-faint dark:text-coal-soft">Sources</h3>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setImportOpen(true)}
              className="flex items-center gap-1 rounded-md border border-paper-line px-1.5 py-0.5 text-[11px] text-ink-soft hover:bg-paper-panel dark:border-coal-line dark:text-coal-soft dark:hover:bg-coal-line"
              title="Import places by name + coordinates (or Google Maps links)"
            >
              <Upload className="h-3 w-3" /> Import
            </button>
            <button
              type="button"
              onClick={() => setPickerOpen((o) => !o)}
              className="flex items-center gap-1 rounded-md border border-paper-line px-1.5 py-0.5 text-[11px] text-ink-soft hover:bg-paper-panel dark:border-coal-line dark:text-coal-soft dark:hover:bg-coal-line"
              title="Pin the places from a table on another page"
            >
              <Layers className="h-3 w-3" /> Add places from table
            </button>
          </div>
        </div>

        {pickerOpen && (
          <div className="mb-2 max-h-56 overflow-y-auto rounded-md border border-paper-line py-1 dark:border-coal-line">
            {candidatesByPage.length === 0 ? (
              <p className="px-2 py-1.5 text-xs text-ink-faint dark:text-coal-soft">No tables with a place column in this workspace yet.</p>
            ) : (
              candidatesByPage.map(([pageTitle, refs]) => (
                <div key={pageTitle} className="mb-0.5">
                  <div className="px-2 pt-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-faint dark:text-coal-soft">{pageTitle}</div>
                  {refs.map((ref) => {
                    const linked = sources.some((s) => s.tableId === ref.tableId);
                    return (
                      <button
                        key={ref.tableId}
                        type="button"
                        disabled={linked}
                        onClick={() => addSource(ref.tableId)}
                        className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-sm text-ink hover:bg-paper-panel disabled:cursor-default disabled:text-ink-faint dark:text-coal-text dark:hover:bg-coal-line dark:disabled:text-coal-soft"
                      >
                        <span className="min-w-0 flex-1 truncate">{ref.tableName}</span>
                        {linked ? <Check className="h-3.5 w-3.5 shrink-0 text-ochre" /> : <Plus className="h-3.5 w-3.5 shrink-0 text-ink-faint dark:text-coal-soft" />}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        )}

        {sources.length > 0 && (
          <ul className="mb-3 space-y-1">
            {sources.map((s) => {
              const t = tables[s.tableId];
              const count = placePins.filter((p) => p.color === s.color).length;
              return (
                <li key={s.tableId} className="relative flex items-center gap-1.5 rounded-md px-1.5 py-1">
                  <button
                    type="button"
                    onClick={() => setColorPickFor(colorPickFor === s.tableId ? null : s.tableId)}
                    className="h-3.5 w-3.5 shrink-0 rounded-full ring-1 ring-black/10"
                    style={{ backgroundColor: s.color }}
                    title="Change colour"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm text-ink dark:text-coal-text" title={t ? `on “${candidates.find((c) => c.tableId === s.tableId)?.pageTitle ?? ''}”` : 'source table deleted'}>
                    {s.label || t?.name || 'missing table'}
                  </span>
                  <span className="text-[11px] text-ink-faint dark:text-coal-soft">{count}</span>
                  <button
                    type="button"
                    onClick={() => removeSource(s.tableId)}
                    className="rounded p-0.5 text-ink-faint hover:bg-paper-line hover:text-red-500 dark:hover:bg-coal-line"
                    title="Unlink this table"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                  {colorPickFor === s.tableId && (
                    <div className="absolute left-0 top-7 z-[1300] flex flex-wrap gap-1 rounded-md border border-paper-line bg-paper p-1.5 shadow-lg dark:border-coal-line dark:bg-coal-panel">
                      {SOURCE_COLORS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setSourceColor(s.tableId, c)}
                          className={`h-4 w-4 rounded-full ring-1 ring-black/10 ${c.toLowerCase() === s.color.toLowerCase() ? 'outline outline-2 outline-offset-1 outline-ink dark:outline-coal-text' : ''}`}
                          style={{ backgroundColor: c }}
                          title={c}
                        />
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {/* Pins */}
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-faint dark:text-coal-soft">Pins</h3>
          <span className="text-[11px] text-ink-faint dark:text-coal-soft">{allPins.length}</span>
        </div>
        {allPins.length > 5 && (
          <div className="mb-1.5 flex items-center gap-1.5 rounded-lg border border-paper-line bg-paper px-2 dark:border-coal-line dark:bg-coal-panel">
            <Search className="h-3 w-3 text-ink-faint" />
            <input
              value={pinFilter}
              onChange={(e) => setPinFilter(e.target.value)}
              placeholder="Filter pins"
              className="flex-1 bg-transparent py-1 text-xs text-ink outline-none dark:text-coal-text"
            />
            {pinFilter && (
              <button type="button" onClick={() => setPinFilter('')} className="rounded p-0.5 text-ink-faint hover:text-ink dark:hover:text-coal-text" title="Clear filter">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        )}
        {allPins.length === 0 && (
          <div className="mb-3 flex items-start gap-2 rounded-md bg-ochre-wash/60 px-2 py-1.5 dark:bg-ochre/10">
            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ochre dark:text-ochre-soft" />
            <p className="text-xs text-ink-soft dark:text-coal-soft">Click the map to drop a pin, embed a table with a place column, or use “Add places from table” to pin another page's list here.</p>
          </div>
        )}
        <ul className="mb-3 space-y-1">
          {allPins
            .filter((p) => !pinFilter.trim() || p.name.toLowerCase().includes(pinFilter.trim().toLowerCase()))
            .map((p) => (
            <li
              key={p.id}
              ref={selectedId === p.id ? selectedRowRef : undefined}
              className={`flex items-center gap-1.5 rounded-md px-1.5 py-1 ${selectedId === p.id ? 'bg-clay-wash dark:bg-clay/20' : ''}`}
            >
              <button
                type="button"
                onClick={() => { setSelectedId(p.id); setPinEditorId(p.id); }}
                title="Open pin (name, colour, coordinates, address)"
                className="shrink-0 rounded p-0.5 hover:bg-paper-line dark:hover:bg-coal-line"
              >
                <MapPin className="h-3.5 w-3.5" style={{ color: pinColor(p) }} />
              </button>
              <input
                value={p.name}
                onChange={(e) => renameAnyPin(p, e.target.value)}
                onFocus={() => setSelectedId(p.id)}
                onDoubleClick={() => setPinEditorId(p.id)}
                title={p.kind === 'manual' ? 'manual pin' : storedIds.has(p.id) ? 'saved from search' : 'from a table'}
                className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none dark:text-coal-text"
              />
              {presence?.get(p.id)?.length ? <PagePresence people={presence.get(p.id)!} /> : null}
              <button
                type="button"
                onClick={() => {
                  const pl = placeOf(p);
                  copyText(placeClipboardText(pl), pl.address ? 'Place + address copied' : 'Coordinates copied');
                }}
                className="rounded p-0.5 text-ink-faint hover:bg-paper-line hover:text-clay dark:hover:bg-coal-line"
                title="Copy name, coordinates and address"
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
              {storedIds.has(p.id) && (
                <button
                  type="button"
                  onClick={() => deletePin(p.id)}
                  className="rounded p-0.5 text-ink-faint hover:bg-paper-line hover:text-red-500 dark:hover:bg-coal-line"
                  title="Delete pin"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>

        {/* Routes */}
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-faint dark:text-coal-soft">Routes</h3>
          <button
            type="button"
            onClick={autoRouteStops}
            disabled={placePins.length < 2}
            className="flex items-center gap-1 rounded-md border border-paper-line px-1.5 py-0.5 text-[11px] text-ink-soft hover:bg-paper-panel disabled:opacity-40 dark:border-coal-line dark:text-coal-soft dark:hover:bg-coal-line"
            title="Connect the place pins into a trip path"
          >
            <Wand2 className="h-3 w-3" /> Auto-route stops
          </button>
        </div>

        {/* This day at a glance: how far the stops are and roughly how long you
            spend moving between them, which is what answers "is this day too much". */}
        <div className="mb-2 rounded-lg border border-paper-line p-2 dark:border-coal-line">
          <div className="mb-1.5 flex flex-wrap items-center gap-1">
            <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint dark:text-coal-soft">Day route</span>
            {(['walking', 'cycling', 'driving'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setDayRouteMode((cur) => (cur === m ? null : m))}
                disabled={placePins.length < 2}
                className={[
                  'rounded-full border px-2 py-0.5 text-[11px] capitalize disabled:opacity-40',
                  dayRouteMode === m
                    ? 'border-clay/40 bg-clay/15 text-clay'
                    : 'border-paper-line text-ink-soft hover:bg-paper-panel dark:border-coal-line dark:text-coal-soft dark:hover:bg-coal-line',
                ].join(' ')}
              >
                {m}
              </button>
            ))}
            <button
              type="button"
              onClick={reorderNearest}
              disabled={mapData.pins.length < 3}
              className="ml-auto rounded-md border border-paper-line px-1.5 py-0.5 text-[11px] text-ink-soft hover:bg-paper-panel disabled:opacity-40 dark:border-coal-line dark:text-coal-soft dark:hover:bg-coal-line"
              title="Reorder your own pins so each is next to the closest remaining one, starting from the first"
            >
              Order by nearest
            </button>
          </div>
          {dayRoute ? (
            <p className="text-[11px] text-ink-soft dark:text-coal-soft">
              {dayRoute.stops.length} stops &middot; <span className="font-medium text-ink dark:text-coal-text">{formatDayDistance(dayRoute.totalMeters)}</span>{' '}
              &middot; about <span className="font-medium text-ink dark:text-coal-text">{formatMinutes(dayRoute.totalMinutes)}</span> moving
              <span className="block text-ink-faint dark:text-coal-soft/80">straight-line estimate, not a road route</span>
            </p>
          ) : (
            <p className="text-[11px] text-ink-faint dark:text-coal-soft">
              {placePins.length < 2 ? 'Two or more place pins to measure a day.' : 'Pick a mode to see the distance and time.'}
            </p>
          )}
        </div>

        <ul className="mb-2 space-y-1.5">
          {mapData.routes.map((r) => {
            const from = pinById.get(r.fromPinId);
            const to = pinById.get(r.toPinId);
            return (
              <li key={r.id} className="rounded-md border border-paper-line p-1.5 dark:border-coal-line">
                <div className="flex items-center gap-1 text-xs text-ink dark:text-coal-text">
                  <span className="min-w-0 flex-1 truncate">{from?.name ?? 'missing'}</span>
                  <span className="text-ink-faint dark:text-coal-soft">→</span>
                  <span className="min-w-0 flex-1 truncate">{to?.name ?? 'missing'}</span>
                  <button
                    type="button"
                    onClick={() => deleteRoute(r.id)}
                    className="rounded p-0.5 text-ink-faint hover:bg-paper-line hover:text-red-500 dark:hover:bg-coal-line"
                    title="Delete route"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="mt-1 flex items-center gap-1">
                  {(Object.keys(MODE_LABEL) as PageMapMode[]).map((m) => {
                    const Icon = MODE_ICON[m];
                    const on = r.mode === m;
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setRouteMode(r.id, m)}
                        className={`rounded p-1 ${on ? 'text-white' : 'text-ink-faint hover:bg-paper-panel dark:text-coal-soft dark:hover:bg-coal-line'}`}
                        style={on ? { backgroundColor: MODE_COLOR[m] } : undefined}
                        title={MODE_LABEL[m]}
                      >
                        <Icon className="h-3.5 w-3.5" />
                      </button>
                    );
                  })}
                  <span className="ml-auto text-[11px] text-ink-faint dark:text-coal-soft">{labelFor(r.id) || '…'}</span>
                </div>
              </li>
            );
          })}
        </ul>

        {/* New route */}
        {allPins.length >= 2 && (
          <div className="rounded-md border border-dashed border-paper-line p-1.5 dark:border-coal-line">
            <div className="flex items-center gap-1">
              <select
                value={fromId}
                onChange={(e) => setFromId(e.target.value)}
                className="min-w-0 flex-1 rounded border border-paper-line bg-paper px-1 py-1 text-xs text-ink dark:border-coal-line dark:bg-coal dark:text-coal-text"
              >
                <option value="">from…</option>
                {allPins.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <select
                value={toId}
                onChange={(e) => setToId(e.target.value)}
                className="min-w-0 flex-1 rounded border border-paper-line bg-paper px-1 py-1 text-xs text-ink dark:border-coal-line dark:bg-coal dark:text-coal-text"
              >
                <option value="">to…</option>
                {allPins.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="mt-1 flex items-center gap-1">
              <select
                value={newMode}
                onChange={(e) => setNewMode(e.target.value as PageMapMode)}
                className="flex-1 rounded border border-paper-line bg-paper px-1 py-1 text-xs text-ink dark:border-coal-line dark:bg-coal dark:text-coal-text"
              >
                {(Object.keys(MODE_LABEL) as PageMapMode[]).map((m) => (
                  <option key={m} value={m}>
                    {MODE_LABEL[m]}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!canAddRoute}
                onClick={() => {
                  if (!canAddRoute) return;
                  addRoute(fromId, toId, newMode);
                  setFromId('');
                  setToId('');
                }}
                className="flex items-center gap-1 rounded bg-clay px-2 py-1 text-xs font-medium text-white hover:bg-clay/90 disabled:opacity-40"
              >
                <Plus className="h-3.5 w-3.5" /> Route
              </button>
            </div>
          </div>
        )}
      </aside>

      {importOpen && <PlacesImportModal onClose={() => setImportOpen(false)} onAdd={addImportedPins} />}
    </div>
  );
}

// Detail for a picked search result. OSM carries no rating, so there is no star
// area, just address + category and the two outbound review links. Tabelog uses
// the result's city when known; Google Maps uses its coordinates.
function PlaceCard({
  place,
  onAdd,
  onClose,
  tripTables,
  onAddToTable,
}: {
  place: PlaceResult;
  onAdd: () => void;
  onClose: () => void;
  tripTables: PlaceTableRef[];
  onAddToTable: (tableId: string) => void;
}) {
  const linkClass =
    'flex items-center gap-1.5 rounded-md border border-paper-line px-2 py-1 text-xs font-medium text-ink-soft hover:bg-paper-panel dark:border-coal-line dark:text-coal-soft dark:hover:bg-coal-line';
  const [tripOpen, setTripOpen] = useState(false);
  return (
    <div className="mt-1 rounded-lg border border-paper-line bg-paper p-2.5 shadow-lg dark:border-coal-line dark:bg-coal-panel">
      <div className="flex items-start gap-1.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink dark:text-coal-text">{place.name}</p>
          {place.category && (
            <p className="text-[11px] uppercase tracking-wide text-ink-faint dark:text-coal-soft">{place.category}</p>
          )}
          {place.address && <p className="mt-0.5 text-xs text-ink-soft dark:text-coal-soft">{place.address}</p>}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-0.5 text-ink-faint hover:bg-paper-panel hover:text-ink dark:text-coal-soft dark:hover:bg-coal-line"
          title="Close"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="mt-2 flex flex-col gap-1">
        <a href={tabelogSearchUrl(place.name, place.city)} target="_blank" rel="noopener noreferrer" className={linkClass}>
          <ExternalLink className="h-3.5 w-3.5" /> Search on Tabelog
        </a>
        <a href={googleMapsUrl(place.name, place.lat, place.lon)} target="_blank" rel="noopener noreferrer" className={linkClass}>
          <ExternalLink className="h-3.5 w-3.5" /> Open in Google Maps
        </a>
        <button
          type="button"
          onClick={onAdd}
          className="mt-0.5 flex items-center justify-center gap-1.5 rounded-md bg-clay px-2 py-1 text-xs font-medium text-white hover:bg-clay/90"
        >
          <Plus className="h-3.5 w-3.5" /> Add as pin
        </button>
        {tripTables.length > 0 && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setTripOpen((o) => !o)}
              className={`w-full ${linkClass} justify-center`}
              title="Save this place as a row in a table, so it flows into Budget, Itinerary and the like"
            >
              <Plus className="h-3.5 w-3.5" /> Add to trip
            </button>
            {tripOpen && (
              <div className="absolute left-0 right-0 top-full z-[1400] mt-1 max-h-48 overflow-y-auto rounded-md border border-paper-line bg-paper py-1 shadow-lg dark:border-coal-line dark:bg-coal-panel">
                {tripTables.map((ref) => (
                  <button
                    key={ref.tableId}
                    type="button"
                    onClick={() => {
                      onAddToTable(ref.tableId);
                      setTripOpen(false);
                    }}
                    className="flex w-full flex-col items-start px-2 py-1 text-left hover:bg-paper-panel dark:hover:bg-coal-line"
                  >
                    <span className="truncate text-xs text-ink dark:text-coal-text">{ref.tableName}</span>
                    <span className="truncate text-[10px] text-ink-faint dark:text-coal-soft">{ref.pageTitle}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Paste or upload places (name + coordinates, or Google Maps links) and drop
// them all on the map as pins. The parse lives in lib/placesImport (tested); this
// is just the paste box, a file picker, and an honest added/skipped readout.
const IMPORT_EXAMPLE = MAP_IMPORT_EXAMPLE;

function PlacesImportModal({ onClose, onAdd }: { onClose: () => void; onAdd: (places: ImportedPlace[]) => void }) {
  const [text, setText] = useState('');
  const [msg, setMsg] = useState('');

  const onFile = async (file: File) => {
    setText(await file.text());
    setMsg('');
  };

  const doImport = () => {
    const { places, skipped } = parsePlacesImport(text);
    if (!places.length) {
      setMsg(skipped ? `No coordinates found (${skipped} line${skipped === 1 ? '' : 's'} skipped). Check the format.` : 'Nothing to import yet.');
      return;
    }
    onAdd(places);
    setMsg(`Added ${places.length} pin${places.length === 1 ? '' : 's'}${skipped ? `, skipped ${skipped}` : ''}.`);
    setTimeout(onClose, 900);
  };

  return (
    <div className="fixed inset-0 z-[1500] flex items-center justify-center bg-ink/40 p-4" onMouseDown={onClose}>
      <div className="w-full max-w-lg rounded-xl border border-paper-line bg-paper p-4 shadow-2xl dark:border-coal-line dark:bg-coal-panel" onMouseDown={(e) => e.stopPropagation()}>
        <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-ink dark:text-coal-text">
          <MapPin className="h-4 w-4 text-clay" /> Import places
        </h3>
        <p className="mb-2 text-xs text-ink-faint dark:text-coal-soft">
          One place per line: <span className="font-mono">Name, latitude, longitude</span>. Comma or tab separated; a
          plain <span className="font-mono">lat, lon</span> or a Google Maps link works too. Lines starting with # are ignored.
        </p>
        <textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={9}
          placeholder={IMPORT_EXAMPLE}
          className="w-full rounded-lg border border-paper-line bg-paper px-2 py-1.5 font-mono text-xs text-ink outline-none focus:border-clay dark:border-coal-line dark:bg-coal dark:text-coal-text"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <label className="cursor-pointer text-xs text-clay hover:underline">
              Choose a file…
              <input
                type="file"
                accept=".csv,.txt,text/csv,text/plain"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onFile(f);
                }}
              />
            </label>
            <button type="button" onClick={() => setText(IMPORT_EXAMPLE)} className="flex items-center gap-1 text-xs text-ink-faint hover:text-ink-soft dark:text-coal-soft dark:hover:text-coal-text">
              <FileDown className="h-3 w-3" /> Paste example
            </button>
          </div>
          <span className="flex-1 truncate text-right text-xs text-clay">{msg}</span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-paper-line px-3 py-1.5 text-sm text-ink-soft dark:border-coal-line dark:text-coal-soft">Cancel</button>
            <button type="button" onClick={doImport} disabled={!text.trim()} className="rounded-lg bg-clay px-3 py-1.5 text-sm font-medium text-white hover:bg-clay/90 disabled:opacity-60">Import</button>
          </div>
        </div>
      </div>
    </div>
  );
}
