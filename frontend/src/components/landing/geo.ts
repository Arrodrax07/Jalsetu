/**
 * Geography for the landing world: projection, the static boundary file (geoBoundaries, see /landing/geo.json),
 * and the derived buffers the scene draws. Everything here is computed once, off the scroll path.
 */
import type { PublicSummary } from '../../types';

export interface GeoFile {
  source: string; license: string; note: string;
  states: { name: string; rings: [number, number][][] }[];
  maharashtra: string;
  districts: { name: string; key: string; c: [number, number]; rings: [number, number][][] }[];
}

// Equirectangular around the middle of India, x scaled by cos(latitude) so shapes keep their proportions.
const LNG0 = 78.5, LAT0 = 22.5, KX = Math.cos((LAT0 * Math.PI) / 180);
export const px = (lng: number) => (lng - LNG0) * KX;
export const pz = (lat: number) => -(lat - LAT0);
export const project = (lng: number, lat: number): [number, number] => [px(lng), pz(lat)];

export const plain = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

let geoPromise: Promise<GeoFile> | null = null;
export const loadGeo = () => (geoPromise ??= fetch('/landing/geo.json').then(r => {
  if (!r.ok) throw new Error(`geo ${r.status}`);
  return r.json() as Promise<GeoFile>;
}));

export function inRing(x: number, y: number, ring: [number, number][]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Line segments (pairs of points, flat y) for every ring. */
export function ringSegments(rings: [number, number][][], y = 0): Float32Array {
  let n = 0;
  for (const r of rings) n += Math.max(0, r.length - 1);
  const out = new Float32Array(n * 6);
  let k = 0;
  for (const r of rings) for (let i = 0; i < r.length - 1; i++) {
    const [ax, az] = project(r[i][0], r[i][1]), [bx, bz] = project(r[i + 1][0], r[i + 1][1]);
    out[k++] = ax; out[k++] = y; out[k++] = az; out[k++] = bx; out[k++] = y; out[k++] = bz;
  }
  return out;
}

const hash = (x: number, y: number) => {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/** A dot field filling India (the "terrain"): position, a per-dot seed, and 1 inside Maharashtra. */
export function dotField(geo: GeoFile, spacing: number) {
  const mh = geo.states.find(s => s.name === geo.maharashtra)?.rings ?? [];
  const boxes = geo.states.map(s => {
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    for (const r of s.rings) for (const [x, y] of r) { a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x); d = Math.max(d, y); }
    return { s, a, b, c, d };
  });
  const pos: number[] = [], seed: number[] = [], home: number[] = [];
  const stepLat = spacing, stepLng = spacing / KX;
  for (let lat = 6.5; lat <= 37.2; lat += stepLat) {
    for (let lng = 68; lng <= 97.5; lng += stepLng) {
      const jl = lng + (hash(lng, lat) - 0.5) * stepLng * 0.35, jt = lat + (hash(lat, lng) - 0.5) * stepLat * 0.35;
      const hit = boxes.find(b => jl >= b.a && jl <= b.c && jt >= b.b && jt <= b.d && b.s.rings.some(r => inRing(jl, jt, r)));
      if (!hit) continue;
      const [x, z] = project(jl, jt);
      pos.push(x, 0, z);
      seed.push(hash(jl * 3.1, jt * 1.7));
      home.push(mh.some(r => inRing(jl, jt, r)) ? 1 : 0);
    }
  }
  return { pos: new Float32Array(pos), seed: new Float32Array(seed), home: new Float32Array(home) };
}

export interface Place { x: number; z: number; crisis: number; pop: number; lng: number; lat: number }
export const toPlaces = (s: PublicSummary): Place[] => s.points.map(([lng, lat, crisis, pop]) => ({ x: px(lng), z: pz(lat), crisis, pop, lng, lat }));

/** The place the story zooms into: the most critical place, named only when the public list confirms it
 *  (same crisis score, nearest to that place's district centre). */
export function focusPlace(s: PublicSummary, places: Place[], geo: GeoFile) {
  const top = s.criticalPlaces[0];
  if (top) {
    const d = geo.districts.find(x => x.key === plain(top.district));
    const cands = places.filter(p => p.crisis === top.crisis);
    if (d && cands.length) {
      const [cx, cz] = project(d.c[0], d.c[1]);
      const best = cands.reduce((a, b) => (Math.hypot(a.x - cx, a.z - cz) <= Math.hypot(b.x - cx, b.z - cz) ? a : b));
      if (Math.hypot(best.x - cx, best.z - cz) < 1.2) return { place: best, name: top.name, district: top.district };
    }
  }
  const best = places.reduce((a, b) => (b.crisis > a.crisis || (b.crisis === a.crisis && b.pop > a.pop) ? b : a), places[0]);
  return { place: best, name: null as string | null, district: null as string | null };
}

/** Illustrative supply arcs: from well-separated larger towns (stand-in hubs) to places under stress. A visual of
 *  coordinated movement, not real trips; the page labels them as an illustration. */
export function supplyArcs(places: Place[], count: number) {
  const hubs: Place[] = [];
  for (const p of [...places].sort((a, b) => b.pop - a.pop)) {
    if (hubs.every(h => Math.hypot(h.x - p.x, h.z - p.z) > 0.9)) hubs.push(p);
    if (hubs.length >= 22) break;
  }
  const needy = places.filter(p => p.crisis >= 40);
  const dest = needy.length ? needy : places;
  const perHub = new Map<Place, number>();
  const cap = Math.ceil((count / Math.max(1, hubs.length)) * 1.8);
  const arcs: { a: Place; b: Place; w: number }[] = [];
  for (let i = 0; arcs.length < count && i < count * 6; i++) {
    const b = dest[Math.floor(hash(i, 3.3) * dest.length)];
    let a: Place | null = null, best = Infinity;
    for (const h of hubs) {
      const d = Math.hypot(h.x - b.x, h.z - b.z);
      if (d >= 0.35 && d < 3.2 && d < best && (perHub.get(h) ?? 0) < cap) { best = d; a = h; }
    }
    if (!a) continue;
    perHub.set(a, (perHub.get(a) ?? 0) + 1);
    arcs.push({ a, b, w: b.crisis / 100 });
  }
  return arcs;
}

/** Districts with a severe or moderate monsoon deficit (real, from the public summary), as rings in lng/lat. */
export function deficitRings(geo: GeoFile, rainfall: PublicSummary['rainfall']) {
  const keys = new Set(rainfall.filter(r => r.severity === 'Severe' || r.severity === 'Moderate').map(r => plain(r.district)));
  return geo.districts.filter(d => keys.has(d.key)).flatMap(d => d.rings);
}
export const inAny = (lng: number, lat: number, rings: [number, number][][]) => rings.some(r => inRing(lng, lat, r));
