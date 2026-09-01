import { useEffect, useRef, useState } from 'react';
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useData } from '../store/useData';
import type { Column, TableData, TableRow } from '../types';
import { titleColumn, cellText, geoOf, type ViewConfig } from '../lib/tableQuery';
import {
  fetchLeg,
  formatDistance,
  formatDuration,
  PROFILE_LABEL,
  type Leg,
  type RouteProfile,
} from '../lib/routing';

// RouteView, an itinerary map. Stops are pinned by a Place column and ordered
// by an Arrival date; consecutive stops are joined by the real road route from
// OSRM, each labelled with its drive/walk time and distance. When the router is
// unreachable a leg falls back to a dashed straight line + a rough estimate, so
// the map always draws. Clicking a pin opens that stop; clicking the map drops one.

const ACCENT = '#e05a86';

function fmtShort(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return '';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[Number(m[2]) - 1]} ${Number(m[3])}`;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

interface Stop {
  row: TableRow;
  lat: number;
  lon: number;
  name: string;
  arrive: string;
  depart: string;
  num: number; // 0 = unscheduled (no arrival date)
}

export function buildStops(
  rows: TableRow[],
  placeCol: Column | undefined,
  title: Column | undefined,
  arrivalCol: Column | undefined,
  departureCol: Column | undefined,
): Stop[] {
  if (!placeCol) return [];
  const raw = rows
    .map((r) => {
      const g = geoOf(r.cells[placeCol.id] ?? null);
      if (!g) return null;
      const name = (title ? cellText(r.cells[title.id] ?? null, title) : '') || g.name || 'Stop';
      const arrive = arrivalCol ? String(r.cells[arrivalCol.id] ?? '') : '';
      const depart = departureCol ? String(r.cells[departureCol.id] ?? '') : '';
      return { row: r, lat: g.lat, lon: g.lon, name, arrive, depart, num: 0 };
    })
    .filter((s): s is Stop => s !== null);
  // Scheduled stops (have an arrival) sort by date and get sequence numbers.
  const scheduled = raw.filter((s) => s.arrive).sort((a, b) => a.arrive.localeCompare(b.arrive));
  scheduled.forEach((s, i) => (s.num = i + 1));
  const unscheduled = raw.filter((s) => !s.arrive);
  return [...scheduled, ...unscheduled];
}

function stopIcon(stop: Stop): L.DivIcon {
  const dates =
    stop.arrive && stop.depart
      ? `${fmtShort(stop.arrive)} → ${fmtShort(stop.depart)}`
      : stop.arrive
        ? `from ${fmtShort(stop.arrive)}`
        : 'no dates';
  const badge =
    stop.num > 0
      ? `<span style="background:${ACCENT};color:#fff;border-radius:50%;width:17px;height:17px;display:inline-flex;align-items:center;justify-content:center;font-size:10px;flex:0 0 auto">${stop.num}</span>`
      : `<span style="background:#b8a7ad;color:#fff;border-radius:50%;width:17px;height:17px;display:inline-flex;align-items:center;justify-content:center;font-size:10px;flex:0 0 auto">•</span>`;
  const html = `
    <div style="display:flex;flex-direction:column;align-items:center;width:160px">
      <div style="white-space:nowrap;background:#fff;border:1px solid #ecd9e0;border-radius:9px;box-shadow:0 3px 8px rgba(0,0,0,.16);padding:3px 8px 3px 5px;display:flex;align-items:center;gap:6px;font-family:system-ui,-apple-system,sans-serif">
        ${badge}
        <span style="text-align:left">
          <span style="display:block;font-weight:600;font-size:11.5px;color:#34322f;line-height:1.15">${esc(stop.name)}</span>
          <span style="display:block;font-weight:500;font-size:10px;color:#a8959b;line-height:1.15">${esc(dates)}</span>
        </span>
      </div>
      <div style="width:2px;height:7px;background:${ACCENT}"></div>
      <svg width="18" height="22" viewBox="0 0 18 22" xmlns="http://www.w3.org/2000/svg"><path d="M9 0C4 0 0 4 0 9c0 6.5 9 13 9 13s9-6.5 9-13C18 4 14 0 9 0z" fill="${ACCENT}"/><circle cx="9" cy="9" r="3.4" fill="#fff"/></svg>
    </div>`;
  return L.divIcon({ html, className: 'waypoint-route-stop', iconSize: [160, 70], iconAnchor: [80, 70] });
}

function legLabelIcon(leg: Leg): L.DivIcon {
  const text = `${formatDuration(leg.durationS)} · ${formatDistance(leg.distanceM)}`;
  const dim = leg.estimated ? 'opacity:.7;font-style:italic' : '';
  const html = `<span style="white-space:nowrap;background:#fff;border:1px solid #ecd9e0;border-radius:999px;box-shadow:0 1px 4px rgba(0,0,0,.14);padding:1px 7px;font-size:10px;font-weight:600;color:#7a5663;font-family:system-ui,-apple-system,sans-serif;${dim}">${esc(text)}</span>`;
  return L.divIcon({ html, className: 'waypoint-leg-label', iconSize: [10, 10], iconAnchor: [5, 5] });
}

export function RouteView({
  tableId,
  table,
  rows,
  view,
}: {
  tableId: string;
  table: TableData;
  rows: TableRow[];
  view: ViewConfig;
}) {
  const openRow = useData((s) => s.openRow);
  const addRow = useData((s) => s.addRow);
  const placeCol = table.columns.find((c) => c.id === view.placeColumnId && c.type === 'place');
  const arrivalCol = table.columns.find((c) => c.id === view.arrivalColumnId && (c.type === 'date' || c.type === 'datetime'));
  const departureCol = table.columns.find((c) => c.id === view.departureColumnId && (c.type === 'date' || c.type === 'datetime'));
  const title = titleColumn(table.columns);
  const stops = buildStops(rows, placeCol, title, arrivalCol, departureCol);
  const scheduled = stops.filter((s) => s.num > 0);
  const profile: RouteProfile = view.routeProfile ?? 'driving';

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const fittedRef = useRef(false);

  const [legs, setLegs] = useState<Leg[]>([]);

  const onMapClickRef = useRef<(latlng: L.LatLng) => void>(() => {});
  onMapClickRef.current = (latlng: L.LatLng) => {
    if (!placeCol) return;
    const name = `📍 ${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}`;
    void addRow(tableId, { [placeCol.id]: { name, lat: latlng.lat, lon: latlng.lng } }).then((id) => id && openRow(id));
  };

  // Keys derived from the scheduled coords so effects only re-run on real change.
  const schedKey = JSON.stringify(scheduled.map((s) => [s.lat, s.lon]));
  const stopsKey = JSON.stringify(stops.map((s) => [s.row.id, s.lat, s.lon, s.name, s.arrive, s.depart, s.num]));

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { scrollWheelZoom: false }).setView([20, 0], 2);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    map.on('click', (e: L.LeafletMouseEvent) => onMapClickRef.current(e.latlng));
    mapRef.current = map;
    setTimeout(() => map.invalidateSize(), 50);
    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
      fittedRef.current = false;
    };
  }, []);

  // Fetch real routes between consecutive scheduled stops; draw progressively.
  useEffect(() => {
    let cancelled = false;
    if (scheduled.length < 2) {
      setLegs([]);
      return;
    }
    setLegs([]);
    (async () => {
      const out: Leg[] = [];
      for (let i = 0; i < scheduled.length - 1; i++) {
        const leg = await fetchLeg([scheduled[i].lat, scheduled[i].lon], [scheduled[i + 1].lat, scheduled[i + 1].lon], profile);
        if (cancelled) return;
        out.push(leg);
        setLegs([...out]);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedKey, profile]);

  const legsSig = legs.map((l) => `${Math.round(l.distanceM)}:${Math.round(l.durationS)}:${l.estimated}:${l.coords.length}`).join('|');

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();

    // Real (or fallback) connectors between consecutive scheduled stops.
    legs.forEach((leg) => {
      L.polyline(leg.coords, {
        color: ACCENT,
        weight: leg.estimated ? 2.5 : 4,
        opacity: leg.estimated ? 0.75 : 0.85,
        dashArray: leg.estimated ? '7 7' : undefined,
      }).addTo(layer);
      const mid = leg.coords[Math.floor(leg.coords.length / 2)];
      if (mid) L.marker(mid, { icon: legLabelIcon(leg), interactive: false }).addTo(layer);
    });

    const latlngs: L.LatLngExpression[] = [];
    for (const s of stops) {
      const marker = L.marker([s.lat, s.lon], { icon: stopIcon(s) }).addTo(layer);
      marker.on('click', () => openRow(s.row.id));
      latlngs.push([s.lat, s.lon]);
    }
    if (!fittedRef.current && latlngs.length) {
      if (latlngs.length === 1) map.setView(latlngs[0], 9);
      else map.fitBounds(L.latLngBounds(latlngs).pad(0.25));
      fittedRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopsKey, legsSig]);

  if (!placeCol) {
    return (
      <div className="p-6 text-center text-sm text-ink-faint dark:text-coal-soft">
        Pick a <span className="font-medium">Place</span> column and an <span className="font-medium">Arrival</span> date in the toolbar to draw your route.
      </div>
    );
  }

  const totalDist = legs.reduce((a, l) => a + l.distanceM, 0);
  const totalTime = legs.reduce((a, l) => a + l.durationS, 0);
  const anyEstimated = legs.some((l) => l.estimated);

  return (
    <div className="p-3">
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-faint dark:text-coal-soft">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: ACCENT }} /> {scheduled.length} stops
        </span>
        {legs.length > 0 && (
          <span>
            {PROFILE_LABEL[profile]} · {formatDuration(totalTime)} · {formatDistance(totalDist)}
            {anyEstimated && <span className="text-clay"> (some legs estimated)</span>}
          </span>
        )}
        {!arrivalCol && <span className="text-clay">Set an Arrival date column to order &amp; connect stops</span>}
        <span>Click the map to drop a stop</span>
      </div>
      <div
        ref={containerRef}
        className="isolate h-[320px] w-full overflow-hidden rounded-lg border border-paper-line dark:border-coal-line sm:h-[440px]"
        style={{ background: '#aadaff' }}
      />
      {stops.length === 0 && (
        <p className="mt-2 text-center text-xs text-ink-faint dark:text-coal-soft">
          No stops yet, click the map, or give entries a Place and an Arrival date.
        </p>
      )}
    </div>
  );
}
