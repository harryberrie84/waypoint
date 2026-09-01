import { useEffect, useRef, useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Map as MapIcon, Table2, Copy, Globe, Maximize2, Minimize2 } from 'lucide-react';
import { placeClipboardText, type MapPlace } from '../lib/mapExport';

// sharedMapBlock, a SELF-CONTAINED map card: its places live in the node's attrs,
// so it renders on a public share page (which has no signed-in store, unlike the
// live PageMap). A tab control flips between the map and a places table, styled
// like the recipe/setlist share cards. Read-only; the live map publishes into it.

function readPlaces(attrs: Record<string, unknown>): MapPlace[] {
  const raw = attrs.places;
  return Array.isArray(raw) ? (raw as MapPlace[]) : [];
}

function pinSvg(color: string): string {
  return `<svg width="26" height="34" viewBox="0 0 26 34" xmlns="http://www.w3.org/2000/svg"><path d="M13 0C5.8 0 0 5.8 0 13c0 9.2 13 21 13 21s13-11.8 13-21C26 5.8 20.2 0 13 0z" fill="${color}"/><circle cx="13" cy="13" r="5" fill="#fff"/></svg>`;
}
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}
function popupHtml(p: MapPlace): string {
  const g = `https://www.google.com/maps?q=${p.lat},${p.lon}`;
  return (
    `<strong>${esc(p.name)}</strong>` +
    (p.category ? `<br><span style="color:#7a5663;font-size:11px">${esc(p.category)}</span>` : '') +
    (p.address ? `<br><span style="font-size:11px;color:#5b5854">${esc(p.address)}</span>` : '') +
    `<br><span style="font-size:11px;color:#8a8782">${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}</span>` +
    `<br><a href="${esc(g)}" target="_blank" rel="noopener noreferrer" style="color:#e05a86;font-weight:600;text-decoration:none;font-size:12px">Open in Google Maps ↗</a>`
  );
}

function SharedMapView({ node }: NodeViewProps) {
  const title = (node.attrs.title as string) || 'Map';
  const places = readPlaces(node.attrs);
  const [tab, setTab] = useState<'map' | 'places'>('map');
  const [copied, setCopied] = useState('');
  const [full, setFull] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);

  // Build the Leaflet map only while the Map tab is showing (a hidden container
  // has no size). Tearing it down on tab switch keeps sizing correct.
  useEffect(() => {
    if (tab !== 'map' || !containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { scrollWheelZoom: false }).setView([20, 0], 2);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
    const latlngs: L.LatLngExpression[] = [];
    for (const p of places) {
      if (typeof p.lat !== 'number' || typeof p.lon !== 'number') continue;
      const icon = L.divIcon({ html: pinSvg('#e05a86'), className: 'waypoint-pin', iconSize: [26, 34], iconAnchor: [13, 34], popupAnchor: [0, -30] });
      L.marker([p.lat, p.lon], { icon }).addTo(map).bindPopup(popupHtml(p));
      latlngs.push([p.lat, p.lon]);
    }
    if (latlngs.length === 1) map.setView(latlngs[0], 12);
    else if (latlngs.length) map.fitBounds(L.latLngBounds(latlngs).pad(0.2));
    mapRef.current = map;
    const t = setTimeout(() => map.invalidateSize(), 60);
    return () => {
      clearTimeout(t);
      map.remove();
      mapRef.current = null;
    };
    // Re-create (not just invalidateSize) when fullscreen toggles: the container
    // resizes, and a fresh map reliably paints its tiles, whereas invalidateSize
    // alone left them blank until the map was re-mounted (via the tab switch).
  }, [tab, places, full]);

  const copyPlace = (p: MapPlace) => {
    try {
      void navigator.clipboard?.writeText(placeClipboardText(p));
    } catch {
      /* clipboard blocked */
    }
    setCopied(p.name);
    setTimeout(() => setCopied((c) => (c === p.name ? '' : c)), 1200);
  };

  return (
    <NodeViewWrapper className="my-3" contentEditable={false}>
      <div className={['flex flex-col overflow-hidden rounded-xl border border-paper-line bg-paper dark:border-coal-line dark:bg-coal-panel', full ? 'fixed inset-0 z-[2000] my-0 rounded-none' : ''].join(' ')}>
        <div className="flex items-center gap-2 border-b border-paper-line px-3 py-2 dark:border-coal-line">
          <Globe className="h-4 w-4 shrink-0 text-clay" />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink dark:text-coal-text">{title}</span>
          <span className="shrink-0 text-[11px] text-ink-faint dark:text-coal-soft">{places.length} place{places.length === 1 ? '' : 's'}</span>
          <div className="flex shrink-0 overflow-hidden rounded-lg border border-paper-line dark:border-coal-line">
            {(['map', 'places'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={[
                  'flex items-center gap-1 px-2 py-1 text-xs font-medium',
                  tab === t ? 'bg-clay text-white' : 'text-ink-soft hover:bg-paper-panel dark:text-coal-soft dark:hover:bg-coal-line',
                ].join(' ')}
              >
                {t === 'map' ? <MapIcon className="h-3.5 w-3.5" /> : <Table2 className="h-3.5 w-3.5" />}
                {t === 'map' ? 'Map' : 'Places'}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setFull((f) => !f)} title={full ? 'Exit fullscreen' : 'Fullscreen'} className="shrink-0 rounded p-1 text-ink-faint hover:bg-paper-panel hover:text-clay dark:hover:bg-coal-line">
            {full ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>
        </div>

        {tab === 'map' ? (
          <div ref={containerRef} className={full ? 'min-h-0 w-full flex-1' : 'h-[22rem] w-full'} style={{ background: '#aadaff' }} />
        ) : (
          <div className={full ? 'min-h-0 flex-1 overflow-auto' : 'max-h-[22rem] overflow-auto'}>
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-paper-panel/80 text-[11px] uppercase tracking-wide text-ink-faint backdrop-blur dark:bg-coal-line/60 dark:text-coal-soft">
                <tr>
                  <th className="px-3 py-1.5 font-medium">Name</th>
                  <th className="px-3 py-1.5 font-medium">Coordinates</th>
                  <th className="px-3 py-1.5 font-medium">Address</th>
                  <th className="px-2 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {places.map((p, i) => (
                  <tr key={i} className="border-t border-paper-line dark:border-coal-line">
                    <td className="px-3 py-1.5 text-ink dark:text-coal-text">{p.name}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs text-ink-soft dark:text-coal-soft">{p.lat.toFixed(5)}, {p.lon.toFixed(5)}</td>
                    <td className="px-3 py-1.5 text-ink-soft dark:text-coal-soft">{p.address || ''}</td>
                    <td className="px-2 py-1.5">
                      <button
                        type="button"
                        onClick={() => copyPlace(p)}
                        title="Copy name, coordinates and address"
                        className="rounded p-1 text-ink-faint hover:bg-paper-panel hover:text-clay dark:hover:bg-coal-line"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
                {places.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-4 text-center text-xs text-ink-faint dark:text-coal-soft">No places.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        {copied && <div className="border-t border-paper-line px-3 py-1 text-[11px] text-clay dark:border-coal-line">Copied “{copied}”.</div>}
      </div>
    </NodeViewWrapper>
  );
}

export const SharedMapBlock = Node.create({
  name: 'sharedMapBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      title: { default: '' },
      places: {
        default: [],
        parseHTML: (el: HTMLElement) => {
          try {
            return JSON.parse(el.getAttribute('data-places') || '[]');
          } catch {
            return [];
          }
        },
        renderHTML: (attrs: { places?: MapPlace[] }) => ({ 'data-places': JSON.stringify(attrs.places || []) }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-shared-map]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-shared-map': '' })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(SharedMapView);
  },
});
