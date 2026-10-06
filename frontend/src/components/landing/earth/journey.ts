/**
 * The film as one deterministic timeline over real geography.
 *
 * Progress p (0..1, from the story clock) -> a camera shot (what it looks at, from how far, pitch, bearing) and the
 * scene state (what the world shows). Nothing here depends on time or on what happened in earlier frames: the same p
 * always gives the same frame, so scrolling back plays the film backwards and a scrollbar jump lands exactly.
 *
 * Moves between distant shots follow a flight path: when the camera has to travel far for its altitude it climbs
 * first and descends onto the destination (street -> city -> region -> India -> atmosphere -> the next place). On
 * the road the camera rides behind the tanker along the real OSRM route.
 */
import { Path, angleDelta, clamp, haversine, lerp, lerpAngle, slerp, smooth, smoother, type LngLat } from './math';

export interface JourneyData {
  generatedAt: string;
  focus: Place; next: Place;
  depot: { name: string; lat: number; lng: number };
  depots: { name: string; lat: number; lng: number }[];
  route: { source: string; km: number; minutes: number; lngLat: LngLat[] };
  attribution: string;
}
export interface Place { id: string; name: string; lat: number; lng: number; crisis: number; population: number; district: string | null; type: string | null }

export interface Shot { target: LngLat; range: number; pitch: number; bearing: number; pad: number }
interface Key extends Shot { p: number; follow?: { from: number; to: number; side: number } }

/** Chapter windows (page progress). Kept in step with story.CHAPTERS. */
const INDIA: LngLat = [79.6, 21.4];
const MH: LngLat = [76.4, 19.25];
/** On the road the camera looks this far ahead (m) and averages the road's heading over this window (m). */
const LOOK = 60, HEAD = 220;

/** Where the tanker is on the road (m from the depot) at progress p: parked, a time-lapse across the district, then
 *  real speed with the camera behind it into Beed, stopping at the water point. */
export function tankerAt(p: number, road: Path) {
  const L = road.length, near = Math.max(0, L - 4200);
  if (p < 0.455) return 0;
  if (p < 0.525) return near * smooth((p - 0.455) / (0.525 - 0.455));
  if (p < 0.6) return lerp(near, L - 40, cruise((p - 0.525) / (0.6 - 0.525)));
  return L - 40;
}

/** Accelerate, cruise, brake: a vehicle's speed profile, not an animation curve. */
function cruise(t: number, k = 0.22) {
  const x = clamp(t, 0, 1), v = 1 / (1 - k); // peak speed so the distance comes out at 1
  if (x < k) return (v * x * x) / (2 * k);
  if (x > 1 - k) return 1 - (v * (1 - x) * (1 - x)) / (2 * k);
  return v * (x - k / 2);
}

export function buildKeys(j: JourneyData, road: Path, portrait: boolean): Key[] {
  const F: LngLat = [j.focus.lng, j.focus.lat], N: LngLat = [j.next.lng, j.next.lat];
  const L = road.length, near = Math.max(0, L - 4200);
  const mid = road.at(L * 0.5), routeBearing = road.heading(L * 0.5, L * 0.6);
  // portrait: the camera stands further back and the subject sits low, under the type (see OpenEarth padding)
  const back = portrait ? 1.45 : 1, pad = portrait ? 0.75 : 1;
  const k = (p: number, target: LngLat, range: number, pitch: number, bearing: number, padL = 0): Key =>
    ({ p, target, range: range * back, pitch: portrait ? Math.min(pitch, 70) : pitch, bearing, pad: padL * pad });
  const onRoad = (p: number, d: number, range: number, pitch: number, side: number): Key =>
    ({ ...k(p, road.at(Math.min(L, d + LOOK)), range, pitch, road.heading(d, HEAD) + side), follow: undefined });
  const follow = (key: Key, from: number, to: number, side: number): Key => ({ ...key, follow: { from, to, side } });
  return [
    // 01 scale: the whole Earth beside the satellite that images it; scroll flies into its lens (orbit.ts), and the
    // film goes on as the sensor's view, straight down onto the Deccan, Maharashtra's places lighting up
    k(0, INDIA, 30_000e3, 0, 0, 0.95),
    k(0.024, [79.2, 21.2], 21_000e3, 0, 0, 0.8),
    k(0.042, [76.6, 19.3], 1_500e3, 0, 0, 0),
    k(0.09, [76.5, 19.25], 1_380e3, 10, -6, 0.08),
    // 02 the problem: down through the atmosphere onto Maharashtra, crisis places and dry districts
    k(0.125, MH, 1_350e3, 30, -14, 0.3),
    k(0.18, [76.1, 19.15], 1_150e3, 36, -6, 0.3),
    // 03 JalSetu: depots reach out to the places they serve; the name lies across the Deccan plateau
    k(0.225, [76.5, 19.05], 640e3, 50, 10, 0.12),
    k(0.275, [76.1, 19.0], 470e3, 57, 26, 0.12),
    // 04 intelligence: Beed's district rises out of the map, the camera dives to it
    k(0.33, F, 215e3, 50, 18, 0.32),
    k(0.385, F, 175e3, 55, 40, 0.32),
    // 05 live operations: the real road from the depot that serves Beed draws itself
    k(0.425, mid, 112e3, 46, routeBearing - 90, 0.3),
    k(0.475, mid, 98e3, 50, routeBearing - 70, 0.3),
    // 06 on the ground: down the road, through the cloud deck, onto Beed's streets behind the tanker
    // (closer than before: ~1.6 km behind the tanker on the road, ~320 m at the water point)
    onRoad(0.525, near + 120, 1_600, 62, 14),
    follow(onRoad(0.525, near + 120, 1_600, 62, 14), near + 120, L - 10, 14),
    onRoad(0.6, L - 10, 320, 70, 26),
    k(0.625, F, 420, 72, road.heading(L - 10, HEAD) + 70),
    // 07 disaster response: back up, street -> city -> region, the districts the monsoon failed
    k(0.68, [75.95, 18.95], 300e3, 34, 8, 0.32),
    k(0.745, [76.0, 19.0], 255e3, 38, 20, 0.32),
    // 08 the network: up through the atmosphere, India whole
    // (looking a little north of India so the country sits below the headline)
    k(0.805, [79.6, 30.5], 17_000e3, 0, 0),
    k(0.845, [79.2, 30.0], 15_500e3, 3, 5),
    // 09 impact: back down onto Maharashtra, every place feeding the numbers
    k(0.885, MH, 950e3, 26, -10),
    k(0.925, MH, 880e3, 30, -4),
    // 10 return: dive into the next place on the planner's list
    k(0.97, N, 2_600, 66, 30),
    k(1, N, 1_500, 72, 58),
  ];
}

/** Camera shot at progress p. */
export function shotAt(keys: Key[], road: Path, p: number, out: Shot): Shot {
  let i = 0;
  while (i < keys.length - 2 && p > keys[i + 1].p) i++;
  const a = keys[i], b = keys[i + 1];
  const span = Math.max(1e-6, b.p - a.p), t = clamp((p - a.p) / span, 0, 1);

  if (a.follow) {
    // riding the road: target and heading come from the road itself, ahead of the tanker
    const e = cruise(t);
    const d = lerp(a.follow.from, a.follow.to, e);
    out.target = road.at(Math.min(road.length, d + LOOK));
    out.bearing = road.heading(d, HEAD) + lerp(a.follow.side, angleDelta(road.heading(a.follow.to, HEAD), b.bearing), smoother(t));
    out.range = Math.exp(lerp(Math.log(a.range), Math.log(b.range), smooth(t)));
    out.pitch = lerp(a.pitch, b.pitch, smooth(t));
    out.pad = lerp(a.pad, b.pad, smooth(t));
    return out;
  }

  const e = smoother(t);
  const dist = haversine(a.target, b.target);
  const descending = b.range < a.range;
  // descend: arrive over the destination first, then drop onto it; climb: rise first, then travel
  const pe = descending ? smoother(t / 0.78) : smoother((t - 0.22) / 0.78);
  out.target = slerp(a.target, b.target, pe);
  // altitude in log space, with a climb when the hop is long for the altitude (flight-path shape)
  const hump = Math.log(1 + dist / (2.2 * Math.max(a.range, b.range))) * Math.sin(Math.PI * e);
  out.range = Math.exp(lerp(Math.log(a.range), Math.log(b.range), e) + hump);
  out.pitch = lerp(a.pitch, b.pitch, e) * (1 - 0.6 * Math.min(1, hump * 3));
  out.bearing = lerpAngle(a.bearing, b.bearing, e);
  out.pad = lerp(a.pad, b.pad, e);
  return out;
}

/** Bearing change per unit of progress at p (for banking: the camera leans into turns). */
export function turnRate(keys: Key[], road: Path, p: number) {
  const h = 0.0015, s1 = shotAt(keys, road, p - h, blank()), s2 = shotAt(keys, road, p + h, blank());
  return angleDelta(s1.bearing, s2.bearing) / (2 * h);
}
export const blank = (): Shot => ({ target: [0, 0], range: 1, pitch: 0, bearing: 0, pad: 0 });

const band = (p: number, a: number, b: number, c: number, d: number) => Math.min(smooth((p - a) / (b - a)), 1 - smooth((p - c) / (d - c)));
const ramp = (p: number, a: number, b: number) => smooth((p - a) / (b - a));

/** What the world shows at progress p (0..1 each). */
export function sceneAt(p: number) {
  return {
    places: ramp(p, 0.015, 0.07) * (1 - 0.6 * band(p, 0.5, 0.52, 0.64, 0.67)),
    crisis: Math.max(band(p, 0.09, 0.125, 0.18, 0.215), 0.6 * band(p, 0.86, 0.885, 0.92, 0.94)),
    deficit: Math.max(0.45 * band(p, 0.1, 0.13, 0.18, 0.21), band(p, 0.665, 0.695, 0.75, 0.78)),
    depots: band(p, 0.19, 0.215, 0.3, 0.335),
    links: ramp(p, 0.205, 0.262) * (1 - ramp(p, 0.3, 0.335)),
    word: band(p, 0.18, 0.2, 0.262, 0.292),
    rise: band(p, 0.285, 0.33, 0.39, 0.425),
    column: band(p, 0.3, 0.345, 0.405, 0.44),
    route: ramp(p, 0.405, 0.455) * (1 - ramp(p, 0.655, 0.69)),
    routeDraw: ramp(p, 0.405, 0.455),
    tanker: band(p, 0.44, 0.455, 0.635, 0.66),
    national: band(p, 0.77, 0.8, 0.845, 0.87),
    impact: band(p, 0.86, 0.885, 0.92, 0.94),
    next: ramp(p, 0.935, 0.975),
  };
}
export type Scene = ReturnType<typeof sceneAt>;
