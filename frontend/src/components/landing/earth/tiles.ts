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
