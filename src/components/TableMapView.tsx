import { useEffect, useRef, useState } from 'react';
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MousePointerClick } from 'lucide-react';
import { useData } from '../store/useData';
import type { Column, TableData, TableRow } from '../types';
import { titleColumn, cellText, geoOf, type ViewConfig } from '../lib/tableQuery';
import { geoDetailLines } from '../lib/poi';

// MapView, a database view that pins each entry by a Place column. Pins can be
// coloured + filtered by a category column, you can click the map to drop a new
// entry, and clicking a pin opens that entry. The map is `isolate`d so its panes
// never paint over modals, and it auto-fits once (then leaves your panning be).

export interface Pin {
  row: TableRow;
  lat: number;
  lon: number;
  label: string;
  category: string;
  color: string;
  details: string[]; // POI lines from the place value (hours, category, …)
}

const DEFAULT_PIN = '#e05a86';

export function pinsFor(
  rows: TableRow[],
  placeCol: Column | undefined,
  title: Column | undefined,
  categoryCol: Column | undefined,
): Pin[] {
  if (!placeCol) return [];
  const colorOf = (optLabel: string): string => categoryCol?.options?.find((o) => o.label === optLabel)?.color ?? DEFAULT_PIN;
  const pins: Pin[] = [];
  for (const r of rows) {
    const g = geoOf(r.cells[placeCol.id] ?? null);
    if (!g) continue;
    const label = (title ? cellText(r.cells[title.id] ?? null, title) : '') || g.name || 'Untitled';
    const category = categoryCol ? cellText(r.cells[categoryCol.id] ?? null, categoryCol) : '';
    pins.push({ row: r, lat: g.lat, lon: g.lon, label, category, color: category ? colorOf(category) : DEFAULT_PIN, details: geoDetailLines(g) });
  }
  return pins;
}

function pinSvg(color: string): string {
  return `<svg width="26" height="34" viewBox="0 0 26 34" xmlns="http://www.w3.org/2000/svg"><path d="M13 0C5.8 0 0 5.8 0 13c0 9.2 13 21 13 21s13-11.8 13-21C26 5.8 20.2 0 13 0z" fill="${color}"/><circle cx="13" cy="13" r="5" fill="#fff"/></svg>`;
}

export function MapView({
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
  const categoryCol = table.columns.find((c) => c.id === view.categoryColumnId && c.type === 'select');
  const title = titleColumn(table.columns);
  const allPins = pinsFor(rows, placeCol, title, categoryCol);

  const categories = categoryCol ? Array.from(new Set(allPins.map((p) => p.category).filter(Boolean))) : [];
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const pins = allPins.filter((p) => !hidden.has(p.category));

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const fittedRef = useRef(false);

  // Keep a live click handler so the (once-created) map can drop pins with the
  // latest place column + handlers.
  const onMapClickRef = useRef<(latlng: L.LatLng) => void>(() => {});
  onMapClickRef.current = (latlng: L.LatLng) => {
    if (!placeCol) return;
    const name = `📍 ${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}`;
    void addRow(tableId, { [placeCol.id]: { name, lat: latlng.lat, lon: latlng.lng } }).then((id) => id && openRow(id));
  };

  // Create the map once.
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

  // Sync markers when pins change. Fit bounds only ONCE (first markers); after
  // that we never move the map for you, panning/zoom stays put.
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const latlngs: L.LatLngExpression[] = [];
    for (const p of pins) {
      const icon = L.divIcon({ html: pinSvg(p.color), className: 'waypoint-pin', iconSize: [26, 34], iconAnchor: [13, 34], popupAnchor: [0, -30] });
      const marker = L.marker([p.lat, p.lon], { icon }).addTo(layer);
      const detailHtml = p.details.length
        ? `<br><span style="color:#8a8782">${p.details.map(escapeHtml).join('<br>')}</span>`
        : '';
      marker.bindPopup(`<strong>${escapeHtml(p.label)}</strong>${p.category ? `<br><span style="color:${p.color}">● ${escapeHtml(p.category)}</span>` : ''}${detailHtml}`);
      marker.on('click', () => openRow(p.row.id));
      latlngs.push([p.lat, p.lon]);
    }
    if (!fittedRef.current && latlngs.length) {
      if (latlngs.length === 1) map.setView(latlngs[0], 10);
      else map.fitBounds(L.latLngBounds(latlngs).pad(0.2));
      fittedRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(pins.map((p) => [p.row.id, p.lat, p.lon, p.label, p.color, p.details.join('|')]))]);

  if (!placeCol) {
    return (
      <div className="p-6 text-center text-sm text-ink-faint dark:text-coal-soft">
        Pick a <span className="font-medium">Place</span> column to pin by (top-left of the toolbar).
        <br />
        Add a Place column in the Grid view, then set a city on each entry.
      </div>
    );
  }

  return (
    <div className="p-3">
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <span className="flex items-center gap-1 text-[11px] text-ink-faint dark:text-coal-soft">
          <MousePointerClick className="h-3.5 w-3.5 text-clay" /> Click the map to drop a pin
        </span>
        {categories.map((c) => {
          const color = allPins.find((p) => p.category === c)?.color ?? DEFAULT_PIN;
          const off = hidden.has(c);
          return (
            <button
              key={c}
              type="button"
              onClick={() =>
                setHidden((h) => {
                  const next = new Set(h);
                  if (next.has(c)) next.delete(c);
                  else next.add(c);
                  return next;
                })
              }
              className={`flex items-center gap-1 rounded-full border border-paper-line px-2 py-0.5 text-[11px] transition-opacity dark:border-coal-line ${off ? 'opacity-40' : ''}`}
            >
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
              {c}
            </button>
          );
        })}
      </div>
      <div
        ref={containerRef}
        className="isolate h-[300px] w-full overflow-hidden rounded-lg border border-paper-line dark:border-coal-line sm:h-[380px]"
        style={{ background: '#aadaff' }}
      />
      {allPins.length === 0 && (
        <p className="mt-2 text-center text-xs text-ink-faint dark:text-coal-soft">
          No pins yet, click the map to drop one, or set a Place on an entry.
        </p>
      )}
    </div>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}
