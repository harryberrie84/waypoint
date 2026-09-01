// Static OSM tile math for the mindmap's place preview. We deliberately don't
// mount Leaflet on the canvas (dozens of live maps would be heavy and fight the
// `isolate` stacking), instead we lay a handful of plain <img> tiles into a
// fixed box, centred on the point, and drop a marker at the centre. This is the
// "static-ish tile" preview; the interactive map / Google Maps is the expand.
//
// Web Mercator slippy-map projection (OSM wiki "Slippy map tilenames"). Pure +
// testable; the view turns each piece into <img src={tileUrl(piece)}>.

export interface TilePiece {
  x: number; // tile column
  y: number; // tile row
  z: number; // zoom
  left: number; // px offset inside the preview box
  top: number;
}

export interface TilePreview {
  tiles: TilePiece[];
  marker: { left: number; top: number };
  tileSize: number;
}

const TILE = 256;

// World-pixel coordinates (top-left origin) of a lon/lat at zoom z.
function project(lat: number, lon: number, z: number): { px: number; py: number } {
  const world = Math.pow(2, z) * TILE;
  const px = ((lon + 180) / 360) * world;
  const latRad = (lat * Math.PI) / 180;
  const py = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * world;
  return { px, py };
}

// The minimal set of tiles covering a w×h box centred on the point, each with
// its pixel offset inside the box, plus the marker position (the box centre).
export function staticTiles(lat: number, lon: number, z: number, w: number, h: number): TilePreview {
  const n = Math.pow(2, z);
  const { px, py } = project(lat, lon, z);
  const originX = px - w / 2; // world px at the box's top-left
  const originY = py - h / 2;
  const i0 = Math.floor(originX / TILE);
  const i1 = Math.floor((originX + w) / TILE);
  const j0 = Math.floor(originY / TILE);
  const j1 = Math.floor((originY + h) / TILE);

  const tiles: TilePiece[] = [];
  for (let j = j0; j <= j1; j++) {
    if (j < 0 || j >= n) continue; // no tiles above/below the world
    for (let i = i0; i <= i1; i++) {
      const col = ((i % n) + n) % n; // wrap horizontally at the date line
      tiles.push({ x: col, y: j, z, left: i * TILE - originX, top: j * TILE - originY });
    }
  }
  return { tiles, marker: { left: w / 2, top: h / 2 }, tileSize: TILE };
}

export function tileUrl(t: TilePiece): string {
  return `https://tile.openstreetmap.org/${t.z}/${t.x}/${t.y}.png`;
}
