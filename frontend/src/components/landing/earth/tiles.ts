/**
 * The open geographic provider: where the film's real-world data comes from. Swap this module to change provider;
 * the journey, camera and scene code only see MapLibre sources named s2 / dem / osm.
 *
 *   s2   imagery    Sentinel-2 cloudless 2016 by EOX IT Services (contains modified Copernicus Sentinel data), CC BY 4.0
 *   dem  elevation  Mapzen Terrarium tiles on AWS Open Data (SRTM and other public sources)
 *   osm  vectors    OpenStreetMap via OpenFreeMap (buildings with heights, roads, water, names), ODbL
 *
 * All three are licensed for redistribution, so the tiles on the film's path ship with the site
 * (`public/landing/earth`, made by `backend/scripts/fetch_landing_earth.py`): `earth://<source>/<key>` serves the
 * packed copy when there is one and the public server otherwise. No keys, nothing proprietary cached.
 *
 *   hires imagery   Esri World Imagery (Maxar, Earthstar Geographics), ~0.3 m per pixel, ONLY where the camera comes
 *                   down to the streets (the tanker's last kilometres into Beed, Parbhani). Proprietary: never packed,
 *                   loaded live from Esri, with the free ArcGIS key from VITE_ESRI_KEY when one is set.
 */
import maplibregl, { type SourceSpecification } from 'maplibre-gl';

const PACK = '/landing/earth/';
const REMOTE: Record<string, (key: string[]) => string> = {
  s2: ([z, y, x]) => `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/${z}/${y}/${x}.jpg`,
  dem: ([z, x, y]) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`,
  fonts: ([stack, range]) => `https://tiles.openfreemap.org/fonts/${encodeURIComponent(stack)}/${range}.pbf`,
};
const EXT: Record<string, string> = { s2: '.jpg', dem: '.png', osm: '.pbf', fonts: '.pbf' };
let packIndex: Promise<Record<string, Set<string>>> | null = null;
let osmTemplate: Promise<string> | null = null;
const loadPack = () => packIndex ??= fetch(`${PACK}index.json`)
  .then(r => (r.ok ? r.json() : {}) as Promise<Record<string, string[]>>).catch(() => ({} as Record<string, string[]>))
  .then(j => Object.fromEntries(Object.entries(j).map(([k, v]) => [k, new Set(v)])));
// OpenFreeMap tile URLs are versioned; ask its TileJSON for the current one only when a tile is not packed
const loadOsmTemplate = () => osmTemplate ??= fetch('https://tiles.openfreemap.org/planet').then(r => r.json()).then(j => j.tiles[0] as string);

let protocolAdded = false;
export function addPackProtocol() {
  if (protocolAdded) return;
  protocolAdded = true;
  // the film descends fast: let the browser fetch many tiles at once (the default is 16)
  maplibregl.setMaxParallelImageRequests(48);
  maplibregl.addProtocol('earth', async (params, abort) => {
    const [source, ...parts] = params.url.slice('earth://'.length).split('/').map(decodeURIComponent);
    const key = parts.join('/');
    const packed = (await loadPack())[source]?.has(key);
    const url = packed ? PACK + source + '/' + parts.map(encodeURIComponent).join('/') + EXT[source]
      : source === 'osm' ? (await loadOsmTemplate()).replace('{z}', parts[0]).replace('{x}', parts[1]).replace('{y}', parts[2])
      : REMOTE[source](parts);
    const r = await fetch(url, { signal: abort.signal });
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    return { data: await r.arrayBuffer() };
  });
}

export const GLYPHS = 'earth://fonts/{fontstack}/{range}';
export const SOURCES: Record<string, SourceSpecification> = {
  s2: {
    type: 'raster', tileSize: 256, maxzoom: 15,
    tiles: ['earth://s2/{z}/{y}/{x}'],
    attribution: 'Sentinel-2 cloudless 2016 by <a href="https://s2maps.eu">EOX IT Services</a> (contains modified Copernicus Sentinel data 2016), CC BY 4.0',
  },
  dem: {
    type: 'raster-dem', encoding: 'terrarium', tileSize: 256, maxzoom: 13,
    tiles: ['earth://dem/{z}/{x}/{y}'],
    attribution: 'Elevation: Mapzen Terrarium (SRTM and others), AWS Open Data',
  },
  osm: {
    type: 'vector', minzoom: 0, maxzoom: 14,
    tiles: ['earth://osm/{z}/{x}/{y}'],
    attribution: '<a href="https://openfreemap.org">OpenFreeMap</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
};

/** Esri World Imagery, sharp enough for streets (real roofs, trees, cars): only inside `bounds` and only from zoom 12,
 *  so it is requested just where the film comes down to the ground. With VITE_ESRI_KEY (a free ArcGIS Location
 *  Platform key) tiles come from the keyed basemap service; without one, from Esri's public tile server (testing). */
const ESRI_KEY = (import.meta.env.VITE_ESRI_KEY as string | undefined)?.trim();
export const HIRES_URL = ESRI_KEY
  ? `https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?token=${encodeURIComponent(ESRI_KEY)}`
  : 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
export const hiresSource = (bounds: [number, number, number, number]): SourceSpecification => ({
  type: 'raster', tileSize: 256, minzoom: 12, maxzoom: 18, bounds, tiles: [HIRES_URL],
  attribution: 'Street imagery: Esri World Imagery (Maxar, Earthstar Geographics)',
});

/** Warm the browser cache with the street imagery along the film's low-altitude path, a few tiles at a time, after the
 *  first view is up, so the streets arrive sharp instead of sharpening in front of the viewer. Same URLs MapLibre asks
 *  for. Returns the number of tiles queued. */
export function prefetchHires(points: [number, number][], zooms: number[], signal: AbortSignal) {
  const keys = new Set<string>();
  for (const [lng, lat] of points) for (const z of zooms) {
    const n = 2 ** z, x = Math.floor(((lng + 180) / 360) * n);
    const y = Math.floor(((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) keys.add(`${z}/${y + dy}/${x + dx}`);
  }
  const queue = [...keys];
  const next = async (): Promise<void> => {
    const k = queue.shift();
    if (!k || signal.aborted) return;
    const [z, y, x] = k.split('/');
    try { await fetch(HIRES_URL.replace('{z}', z).replace('{y}', y).replace('{x}', x), { signal, mode: 'cors' }); } catch { /* best effort */ }
    return next();
  };
  for (let i = 0; i < 8; i++) void next();
  return keys.size;
}
