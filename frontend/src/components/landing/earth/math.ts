/**
 * Geographic maths for the film's camera: great-circle paths, camera range <-> map zoom, distances along a road.
 * Pure functions, no map instance: the whole journey is computed from the timeline, deterministically.
 */
export type LngLat = [number, number];

const R = 6371008.8; // mean Earth radius, m
const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const EQUATOR = 40075016.686;
/** MapLibre's default vertical field of view (degrees) and tile size. */
export const FOV = 36.86989764584402;
const TILE = 512;

export const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Ease in and out with zero velocity and zero acceleration at both ends: shots arrive and leave with weight. */
export const smoother = (x: number) => { const t = clamp(x, 0, 1); return t * t * t * (t * (t * 6 - 15) + 10); };
export const smooth = (x: number) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };
/** Shortest signed difference b - a in degrees. */
export const angleDelta = (a: number, b: number) => ((((b - a) % 360) + 540) % 360) - 180;
export const lerpAngle = (a: number, b: number, t: number) => a + angleDelta(a, b) * t;

export function haversine(a: LngLat, b: LngLat) {
  const dLat = (b[1] - a[1]) * D2R, dLng = (b[0] - a[0]) * D2R;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * D2R) * Math.cos(b[1] * D2R) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing a -> b (degrees clockwise from north). */
export function bearingTo(a: LngLat, b: LngLat) {
  const φ1 = a[1] * D2R, φ2 = b[1] * D2R, Δλ = (b[0] - a[0]) * D2R;
  const y = Math.sin(Δλ) * Math.cos(φ2), x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * R2D + 360) % 360;
}

/** Point a fraction t along the great circle a -> b. */
export function slerp(a: LngLat, b: LngLat, t: number): LngLat {
  const φ1 = a[1] * D2R, λ1 = a[0] * D2R, φ2 = b[1] * D2R, λ2 = b[0] * D2R;
  const d = haversine(a, b) / R;
  if (d < 1e-9) return [a[0], a[1]];
  const A = Math.sin((1 - t) * d) / Math.sin(d), B = Math.sin(t * d) / Math.sin(d);
  const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
  const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
  const z = A * Math.sin(φ1) + B * Math.sin(φ2);
  return [Math.atan2(y, x) * R2D, Math.atan2(z, Math.sqrt(x * x + y * y)) * R2D];
}

/** Point at a distance (m) and bearing from an origin. */
export function offset(o: LngLat, distance: number, bearing: number): LngLat {
  const δ = distance / R, θ = bearing * D2R, φ1 = o[1] * D2R, λ1 = o[0] * D2R;
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return [λ2 * R2D, φ2 * R2D];
}

/** Distance from the camera to the point it looks at (m) -> MapLibre zoom, for a viewport height in CSS px. */
export function rangeToZoom(range: number, lat: number, height: number) {
  const toCenterPx = (0.5 / Math.tan((FOV * D2R) / 2)) * height;
  return Math.log2((EQUATOR * Math.cos(lat * D2R) * toCenterPx) / (TILE * Math.max(1, range)));
}

/** Local east/north metres of p relative to an origin (good to a few hundred km). */
export function enu(origin: LngLat, p: LngLat): [number, number] {
  return [(p[0] - origin[0]) * D2R * R * Math.cos(origin[1] * D2R), (p[1] - origin[1]) * D2R * R];
}

/** A road as a measured polyline: position and heading at any distance along it. */
export class Path {
  readonly pts: LngLat[];
  readonly cum: number[];
  readonly length: number;
  constructor(pts: LngLat[]) {
    this.pts = pts;
    this.cum = [0];
    for (let i = 1; i < pts.length; i++) this.cum.push(this.cum[i - 1] + haversine(pts[i - 1], pts[i]));
    this.length = this.cum[this.cum.length - 1];
  }
  private seg(d: number) {
    let lo = 0, hi = this.cum.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (this.cum[m] <= d) lo = m; else hi = m; }
    return lo;
  }
  at(d: number): LngLat {
    const x = clamp(d, 0, this.length), i = this.seg(x);
    const a = this.pts[i], b = this.pts[Math.min(i + 1, this.pts.length - 1)];
    const L = this.cum[Math.min(i + 1, this.cum.length - 1)] - this.cum[i];
    const t = L > 0 ? (x - this.cum[i]) / L : 0;
    return [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
  }
  /** Heading smoothed over a window (m), so a camera following the road never snaps at a corner. */
  heading(d: number, window = 160) {
    return bearingTo(this.at(d - window / 2), this.at(d + window / 2));
  }
  /** The part of the road from 0 to d, for drawing it as it is travelled. */
  slice(d: number): LngLat[] {
    const x = clamp(d, 0, this.length), i = this.seg(x);
    return [...this.pts.slice(0, i + 1), this.at(x)];
  }
}
