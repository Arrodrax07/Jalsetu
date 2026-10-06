/**
 * The film's opening: the satellites behind the imagery, over the real globe.
 *
 * One transparent three.js canvas above the map, drawn in two passes:
 *  1. The Sentinel-2 constellation (2A, 2B, 2C) on their REAL orbits: current mean elements from CelesTrak
 *     (public/landing/satellites.json, backend/scripts/export_landing_satellites.py), propagated here as circular
 *     two-body orbits with the J2 drift of the orbit plane, Earth turning under them (GMST). Each satellite trails the
 *     290 km strip of ground its camera sweeps (MSI swath), drawn only where the sun is up, because that is when it
 *     images. The camera is the map's own (same target, range, bearing, pitch, roll and lens shift), so orbits pass
 *     behind the globe exactly where they should. Motion is a time-lapse; the page says so.
 *  2. A close-up Sentinel-2 (simplified model, not to scale, labelled): its solar wing unfolds when the page opens,
 *     and scroll flies the camera into its instrument's lens; the film continues as the sensor's view.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { FOV, clamp, smoother, type LngLat } from './math';

export interface SatElements {
  name: string; norad: number; epoch: string; mean_motion: number; eccentricity: number; inclination: number;
  ra_of_asc_node: number; arg_of_pericenter: number; mean_anomaly: number;
}
export interface SatFile { generatedAt: string; source: string; satellites: SatElements[] }

const R = 6371008.8, RE = 6378137, MU = 3.986004418e14, J2 = 1.08262668e-3;
const D2R = Math.PI / 180;
const SWATH = 290e3; // Sentinel-2 MSI swath width (m)
const TRAIL_S = 26 * 60; // swath drawn behind each satellite (s of orbit)

/** Greenwich mean sidereal angle (rad) at a time (ms since 1970). */
function gmst(t: number) {
  const d = t / 86400000 + 2440587.5 - 2451545;
  return (((280.46061837 + 360.98564736629 * d) % 360) + 360) % 360 * D2R;
}

/** Unit vector to the sun in Earth-fixed axes (low precision: good to about a degree). */
function sunDir(t: number, out: THREE.Vector3) {
  const d = t / 86400000 + 2440587.5 - 2451545;
  const g = (357.529 + 0.98560028 * d) * D2R, q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * D2R, e = (23.439 - 0.00000036 * d) * D2R;
  const x = Math.cos(L), y = Math.cos(e) * Math.sin(L), z = Math.sin(e) * Math.sin(L);
  const th = gmst(t);
  return out.set(Math.cos(th) * x + Math.sin(th) * y, -Math.sin(th) * x + Math.cos(th) * y, z);
}

/** A near-circular orbit from mean elements: position in Earth-fixed axes (m) at any time. */
export class Orbit {
  readonly name: string; readonly a: number; readonly period: number;
  private i: number; private raan0: number; private raanDot: number; private u0: number; private uDot: number;
  readonly epoch: number; readonly rev0: number;
  constructor(e: SatElements & { rev_at_epoch?: number }) {
    this.name = e.name;
    const n = (e.mean_motion * 2 * Math.PI) / 86400;
    this.a = Math.cbrt(MU / (n * n));
    this.period = (2 * Math.PI) / n;
    this.i = e.inclination * D2R;
    const k = J2 * (RE / this.a) ** 2;
    this.raan0 = e.ra_of_asc_node * D2R;
    this.raanDot = -1.5 * n * k * Math.cos(this.i);
    this.u0 = (e.arg_of_pericenter + e.mean_anomaly) * D2R;
    this.uDot = n + 0.75 * n * k * (5 * Math.cos(this.i) ** 2 - 1);
    this.epoch = Date.parse(e.epoch.endsWith('Z') ? e.epoch : `${e.epoch}Z`);
    this.rev0 = e.rev_at_epoch ?? 0;
  }
  /** Argument of latitude (rad) at t. */
  u(t: number) { return this.u0 + this.uDot * ((t - this.epoch) / 1000); }
  /** Inertial position at t, then turned into Earth-fixed axes. */
  at(t: number, out: THREE.Vector3, du = 0) {
    const dt = (t - this.epoch) / 1000;
    const u = this.u0 + this.uDot * dt + du, O = this.raan0 + this.raanDot * dt;
    const cu = Math.cos(u), su = Math.sin(u), cO = Math.cos(O), sO = Math.sin(O), ci = Math.cos(this.i), si = Math.sin(this.i);
    const x = this.a * (cO * cu - sO * su * ci), y = this.a * (sO * cu + cO * su * ci), z = this.a * su * si;
    const th = gmst(t);
    return out.set(Math.cos(th) * x + Math.sin(th) * y, -Math.sin(th) * x + Math.cos(th) * y, z);
  }
}

/** The map's camera, as OpenEarth sets it. */
export interface GlobeView { target: LngLat; range: number; bearing: number; pitch: number; roll: number; shift: [number, number] }

// ------------------------------------------------------------------------------------------------ textures
function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Crinkled multi-layer insulation: a normal map from a few octaves of value noise. */
function crinkle(size = 256) {
  const h = new Float32Array(size * size);
  const rnd = (x: number, y: number, s: number) => { const v = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453; return v - Math.floor(v); };
  for (let o = 0, amp = 1, cell = 32; o < 4; o++, amp *= 0.5, cell /= 2) {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const gx = x / cell, gy = y / cell, ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy;
      const n = size / cell, w = (a: number) => ((a % n) + n) % n;
      const a = rnd(w(ix), w(iy), o), b = rnd(w(ix + 1), w(iy), o), c = rnd(w(ix), w(iy + 1), o), d = rnd(w(ix + 1), w(iy + 1), o);
      const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
      h[y * size + x] += amp * (a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy);
    }
  }
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const H = (xx: number, yy: number) => h[((yy + size) % size) * size + ((xx + size) % size)];
    const dx = (H(x + 1, y) - H(x - 1, y)) * 2.2, dy = (H(x, y + 1) - H(x, y - 1)) * 2.2;
    const l = Math.hypot(dx, dy, 1), i = (y * size + x) * 4;
    data[i] = ((-dx / l) * 0.5 + 0.5) * 255; data[i + 1] = ((-dy / l) * 0.5 + 0.5) * 255; data[i + 2] = (1 / l) * 0.5 * 255 + 127; data[i + 3] = 255;
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true;
  return t;
}

/** Solar cells: dark blue cells in a silver grid. */
const cellsTex = () => canvasTex(512, 512, g => {
  g.fillStyle = '#c9cfd4'; g.fillRect(0, 0, 512, 512);
  const n = 16, s = 512 / n;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const grd = g.createLinearGradient(x * s, y * s, x * s + s, y * s + s);
    grd.addColorStop(0, '#22356b'); grd.addColorStop(1, '#13204a');
    g.fillStyle = grd; g.fillRect(x * s + 1.5, y * s + 1.5, s - 3, s - 3);
    g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(x * s + 1.5, y * s + s / 2 - 0.5, s - 3, 1);
  }
});

/** The baffle's inside: dark rings that catch a little light (the camera flies down it). */
const baffleTex = () => canvasTex(64, 512, g => {
  g.fillStyle = '#0d1418'; g.fillRect(0, 0, 64, 512);
  for (let i = 0; i < 18; i++) { g.fillStyle = i % 2 ? '#1b2a31' : '#2a3d45'; g.fillRect(0, i * 28 + 6, 64, 4); }
});

const roundDot = () => canvasTex(64, 64, g => {
  g.beginPath(); g.arc(32, 32, 26, 0, Math.PI * 2); g.fillStyle = '#0a7f99'; g.fill();
  g.beginPath(); g.arc(32, 32, 16, 0, Math.PI * 2); g.fillStyle = '#ffffff'; g.fill();
});

// ------------------------------------------------------------------------------------------------ the satellite
/** Sentinel-2, simplified: a 3.4 x 1.8 x 2.35 m bus in insulation foil, the multispectral instrument looking down
 *  (its baffle and lens are drawn round here), star trackers, an X-band antenna, and one wing of three solar panels.
 *  Frame: +y away from Earth, -y nadir, +z flight direction, the wing along +x. */
function sentinel2() {
  const env = { envMapIntensity: 1.1 };
  const crink = crinkle();
  const silver = new THREE.MeshStandardMaterial({ color: '#e3e6e8', metalness: 1, roughness: 0.3, normalMap: crink, normalScale: new THREE.Vector2(0.55, 0.55), ...env });
  const gold = new THREE.MeshStandardMaterial({ color: '#dcae52', metalness: 1, roughness: 0.28, normalMap: crink, normalScale: new THREE.Vector2(0.65, 0.65), ...env });
  const white = new THREE.MeshStandardMaterial({ color: '#f1f3f4', metalness: 0, roughness: 0.55, ...env });
  const black = new THREE.MeshStandardMaterial({ color: '#1c2226', metalness: 0.35, roughness: 0.45, ...env });
  const strut = new THREE.MeshStandardMaterial({ color: '#9aa3a8', metalness: 0.9, roughness: 0.35, ...env });
  const sat = new THREE.Group();

  // bus: gold on the flanks, a white radiator facing away from the sun, silver elsewhere
  const bus = new THREE.Mesh(new RoundedBoxGeometry(1.8, 2.35, 3.4, 3, 0.06), [gold, white, silver, silver, gold, silver]);
  sat.add(bus);
  // seams of the foil blankets
  for (const z of [-0.85, 0.85]) {
    const seam = new THREE.Mesh(new THREE.BoxGeometry(1.82, 2.37, 0.025), black); seam.position.z = z; sat.add(seam);
  }

  // multispectral instrument on the nadir face: housing, baffle (outside + its dark ringed inside), lens
  const housing = new THREE.Mesh(new RoundedBoxGeometry(1.3, 0.55, 1.45, 2, 0.05), black);
  housing.position.set(0, -1.175 - 0.275, 0.6); sat.add(housing);
  const BAFFLE_R = 0.34, BAFFLE_L = 0.6, top = -1.725;
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(BAFFLE_R + 0.03, BAFFLE_R + 0.06, BAFFLE_L, 40, 1, true), silver);
  barrel.position.set(0, top - BAFFLE_L / 2, 0.6); sat.add(barrel);
  const inner = new THREE.Mesh(new THREE.CylinderGeometry(BAFFLE_R, BAFFLE_R, BAFFLE_L, 40, 1, true),
    new THREE.MeshStandardMaterial({ map: baffleTex(), side: THREE.BackSide, roughness: 0.7, metalness: 0.2 }));
  inner.position.copy(barrel.position); sat.add(inner);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(BAFFLE_R + 0.045, 0.03, 10, 48), strut);
  rim.rotation.x = Math.PI / 2; rim.position.set(0, top - BAFFLE_L, 0.6); sat.add(rim);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(BAFFLE_R, 48), new THREE.MeshPhysicalMaterial({
    color: '#0c2f3a', metalness: 0.1, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.03, iridescence: 0.7, iridescenceIOR: 1.6, envMapIntensity: 1.6 }));
  lens.rotation.x = Math.PI / 2; lens.position.set(0, top - 0.04, 0.6); sat.add(lens);

  // star trackers (hooded cylinders) and the X-band antenna
  for (const [x, z, rx] of [[-0.45, -1.2, 0.5], [0.0, -1.35, 0.35], [0.45, -1.2, 0.5]] as const) {
    const st = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.15, 0.32, 20), black);
    st.position.set(x, 1.3, z); st.rotation.x = -rx; sat.add(st);
  }
  const dish = new THREE.Mesh(new THREE.LatheGeometry(Array.from({ length: 9 }, (_, i) => new THREE.Vector2((i / 8) * 0.26, ((i / 8) ** 2) * 0.12)), 28), white);
  dish.rotation.x = Math.PI; dish.position.set(-0.4, -1.3, -1.2); sat.add(dish);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.2, 8), strut); mast.position.set(-0.4, -1.25, -1.2); sat.add(mast);

  // the solar wing: yoke, then three panels on hinges (accordion-folded against the bus until deployed)
  const PW = 1.9, PH = 1.75, PT = 0.045, YOKE = 0.85;
  const cells = new THREE.MeshStandardMaterial({ map: cellsTex(), metalness: 0.55, roughness: 0.28, envMapIntensity: 1.3 });
  const back = new THREE.MeshStandardMaterial({ color: '#d9dde0', metalness: 0.2, roughness: 0.7 });
  const root = new THREE.Group(); root.position.set(0.9, 0.25, -0.2); sat.add(root);
  for (const z of [-0.45, 0.45]) {
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, YOKE, 8), strut);
    rod.rotation.z = Math.PI / 2; rod.position.set(YOKE / 2, 0, z); root.add(rod);
  }
  const hinges: THREE.Group[] = [];
  let parent: THREE.Object3D = root, at = YOKE;
  for (let i = 0; i < 3; i++) {
    const h = new THREE.Group(); h.position.set(at, 0, 0); parent.add(h); hinges.push(h);
    // panel: cells face the sun (+y), white backs
    const panel = new THREE.Mesh(new THREE.BoxGeometry(PW - 0.04, PT, PH), [back, back, cells, back, back, back]);
    panel.position.set(PW / 2, 0, 0); h.add(panel);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(PW - 0.02, PT * 0.6, 0.03), strut); frame.position.set(PW / 2, 0, PH / 2); h.add(frame);
    parent = h; at = PW;
  }
  const deploy = (d: number) => {
    // each hinge opens in turn; folded, the panels stack against the bus flank
    const e = (k: number) => smoother(clamp(d * 1.6 - k * 0.3, 0, 1));
    hinges[0].rotation.z = (1 - e(0)) * (Math.PI / 2);
    hinges[1].rotation.z = -(1 - e(1)) * Math.PI;
    hinges[2].rotation.z = (1 - e(2)) * Math.PI;
    hinges[0].position.x = YOKE * (0.25 + 0.75 * e(0));
  };
  deploy(1);
  // where the lens mouth is, in the satellite's frame (the fly-in aims at it)
  const lensMouth = new THREE.Vector3(0, top - BAFFLE_L, 0.6);
  return { sat, root, deploy, lensMouth };
}

// ------------------------------------------------------------------------------------------------ the layer
export interface HeroPose { approach: number; on: number; portrait: boolean }

export class OrbitLayer {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(FOV, 1, 1e3, 1e8);
  private hero = new THREE.Scene();
  private heroCam = new THREE.PerspectiveCamera(30, 1, 0.01, 400);
  private orbits: Orbit[] = [];
  private rings: THREE.Line[] = [];
  private swaths: THREE.Mesh[] = [];
  private dots: THREE.Points;
  private haze: THREE.Mesh; private halo: THREE.Mesh;
  private model: ReturnType<typeof sentinel2>;
  private start = performance.now();
  private t0 = Date.now();
  private deployT = 0;
  private reduce: boolean;
  /** Simulated time runs this many times faster than the clock (the page labels it). */
  readonly timeLapse: number;
  /** Screen positions (CSS px) for labels: each satellite (null when behind the Earth or off screen) and the close-up. */
  readonly satScreen: ([number, number] | null)[] = [];
  heroScreen: [number, number] | null = null;
  private w = 1; private h = 1;
  private tmp = new THREE.Vector3(); private tmp2 = new THREE.Vector3(); private sun = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement, file: SatFile | null, opts: { quality: 'high' | 'low'; reduce: boolean }) {
    this.canvas = canvas;
    this.reduce = opts.reduce;
    this.timeLapse = opts.reduce ? 1 : 60;
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance', premultipliedAlpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, opts.quality === 'high' ? 2 : 1.25));
    this.renderer.autoClear = false;
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.camera.matrixAutoUpdate = false;

    // ---- globe pass: an invisible Earth for depth, the air's glow, orbits, swaths, satellites
    const earth = new THREE.Mesh(new THREE.SphereGeometry(R * 0.9985, 64, 40), new THREE.MeshBasicMaterial({ colorWrite: false }));
    earth.renderOrder = -1; this.scene.add(earth);
    // daylight air: a pale veil over the disc that thickens to the limb, and a soft halo around it
    this.haze = new THREE.Mesh(new THREE.SphereGeometry(R * 1.002, 64, 40), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, toneMapped: false,
      vertexShader: `varying vec3 vN; varying vec3 vV; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `uniform float uOn; varying vec3 vN; varying vec3 vV; void main(){ float f = 1.0 - max(dot(vN, vV), 0.0); float a = (0.07 + 0.62 * pow(f, 2.6)) * uOn; gl_FragColor = vec4(mix(vec3(0.93,0.97,1.0), vec3(0.72,0.88,0.98), f), a); }`,
      uniforms: { uOn: { value: 1 } },
    }));
    this.scene.add(this.haze);
    this.halo = new THREE.Mesh(new THREE.SphereGeometry(R * 1.07, 64, 40), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.BackSide, toneMapped: false,
      vertexShader: `varying vec3 vN; varying vec3 vV; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `uniform float uOn; varying vec3 vN; varying vec3 vV; void main(){ float d = max(dot(-vN, vV), 0.0); float a = pow(smoothstep(0.0, 0.42, d), 2.0) * (1.0 - smoothstep(0.42, 0.5, d)) * 0.55 * uOn; gl_FragColor = vec4(0.55, 0.80, 0.95, a); }`,
      uniforms: { uOn: { value: 1 } },
    }));
    this.scene.add(this.halo);

    for (const e of file?.satellites ?? []) {
      const o = new Orbit(e as SatElements & { rev_at_epoch?: number }); this.orbits.push(o);
      const N = 240, ring = new THREE.BufferGeometry();
      ring.setAttribute('position', new THREE.BufferAttribute(new Float32Array((N + 1) * 3), 3));
      ring.setAttribute('color', new THREE.BufferAttribute(new Float32Array((N + 1) * 4), 4));
      const line = new THREE.Line(ring, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, toneMapped: false }));
      line.frustumCulled = false; this.rings.push(line); this.scene.add(line);
      const S = 90, sw = new THREE.BufferGeometry();
      sw.setAttribute('position', new THREE.BufferAttribute(new Float32Array(S * 2 * 3), 3));
      sw.setAttribute('color', new THREE.BufferAttribute(new Float32Array(S * 2 * 4), 4));
      const idx: number[] = [];
      for (let k = 0; k < S - 1; k++) idx.push(2 * k, 2 * k + 1, 2 * k + 2, 2 * k + 1, 2 * k + 3, 2 * k + 2);
      sw.setIndex(idx);
      const strip = new THREE.Mesh(sw, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
      strip.frustumCulled = false; this.swaths.push(strip); this.scene.add(strip);
      this.satScreen.push(null);
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(Math.max(1, this.orbits.length) * 3), 3));
    this.dots = new THREE.Points(dg, new THREE.PointsMaterial({ size: 13, sizeAttenuation: false, map: roundDot(), transparent: true, depthWrite: false, toneMapped: false }));
    this.dots.frustumCulled = false; this.scene.add(this.dots);

    // ---- close-up pass: Sentinel-2 in studio-clean daylight
    const pm = new THREE.PMREMGenerator(this.renderer);
    this.hero.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    pm.dispose();
    this.hero.add(new THREE.HemisphereLight('#ffffff', '#8fb6c8', 0.9));
    const key = new THREE.DirectionalLight('#fff6e8', 2.6); key.position.set(-6, 9, 7); this.hero.add(key);
    const rimL = new THREE.DirectionalLight('#bfe6f5', 1.2); rimL.position.set(8, -3, -6); this.hero.add(rimL);
    this.model = sentinel2();
    this.hero.add(this.model.sat);
    this.deployT = opts.reduce ? 1 : 0;
    this.model.deploy(this.deployT);
    // compile both passes now (the driver would otherwise do it on the first frame they are drawn)
    this.renderer.compile(this.scene, this.camera);
    this.renderer.compile(this.hero, this.heroCam);
  }

  resize(w: number, h: number) {
    if (w === this.w && h === this.h) return;
    this.w = w; this.h = h;
    this.renderer.setSize(w, h, false);
    this.heroCam.aspect = w / h; this.heroCam.updateProjectionMatrix();
  }

  /** Simulated time (ms since 1970): the real now when the page opened, then time-lapse. */
  simTime(now = performance.now()) { return this.t0 + (now - this.start) * this.timeLapse; }
  /** Current orbit number of the first satellite (orbits completed since launch), at simulated time. */
  revolution(now?: number) {
    const o = this.orbits[0];
    return o && o.rev0 ? Math.floor(o.rev0 + (o.u(this.simTime(now)) - o.u(o.epoch)) / (2 * Math.PI)) : null;
  }

  /** The first satellite now (simulated time): sub-satellite point, altitude above the mean sphere, orbital speed. */
  satNow(now = performance.now()) {
    const o = this.orbits[0];
    if (!o) return null;
    const p = o.at(this.simTime(now), new THREE.Vector3()), r = p.length();
    return { name: o.name, lat: Math.asin(p.z / r) / D2R, lng: Math.atan2(p.y, p.x) / D2R, altKm: (r - R) / 1000, speedKms: (2 * Math.PI * o.a) / o.period / 1000 };
  }

  /** The next DAYLIGHT pass of any satellite over a box [west, south, east, north], in real time (ms), searched up to 3 days
   *  ahead in 20 s steps; null when none. Sentinel-2 images only in daylight, so night passes do not count. */
  nextPass(box: [number, number, number, number], from = Date.now()) {
    const v = new THREE.Vector3(), sun = new THREE.Vector3();
    let best: { t: number; name: string } | null = null;
    for (const o of this.orbits) {
      for (let t = from; t < from + 3 * 864e5 && (!best || t < best.t); t += 20000) {
        o.at(t, v);
        const r = v.length(), lat = Math.asin(v.z / r) / D2R, lng = Math.atan2(v.y, v.x) / D2R;
        if (lat < box[1] || lat > box[3] || lng < box[0] || lng > box[2]) continue;
        if (v.normalize().dot(sunDir(t, sun)) > 0.15) { best = { t, name: o.name }; break; }
      }
    }
    return best;
  }

  /**
   * Draws one frame. `globe` is the map's camera and how much of the constellation to show (0 hides it);
   * `pose` the close-up's scroll state. Returns false when nothing is drawn (the caller can hide the canvas).
   */
  render(view: GlobeView, globeOn: number, pose: HeroPose, now: number, dt: number) {
    const r = this.renderer;
    r.clear();
    const heroOn = pose.on;
    if (globeOn <= 0.001 && heroOn <= 0.001) return false;
    const t = this.simTime(now);

    if (globeOn > 0.001) {
      this.placeCamera(view);
      (this.haze.material as THREE.ShaderMaterial).uniforms.uOn.value = globeOn;
      (this.halo.material as THREE.ShaderMaterial).uniforms.uOn.value = globeOn;
      sunDir(t, this.sun);
      const dotPos = this.dots.geometry.getAttribute('position') as THREE.BufferAttribute;
      const camPos = this.camera.position;
      this.orbits.forEach((o, i) => {
        // the orbit: brightest just behind the satellite, fading round the ring
        const ring = this.rings[i].geometry, P = ring.getAttribute('position') as THREE.BufferAttribute, C = ring.getAttribute('color') as THREE.BufferAttribute;
        const N = P.count - 1;
        for (let k = 0; k <= N; k++) {
          const du = -(k / N) * Math.PI * 2;
          o.at(t, this.tmp, du);
          P.setXYZ(k, this.tmp.x, this.tmp.y, this.tmp.z);
          const a = (0.16 + 0.7 * Math.pow(1 - k / N, 3)) * globeOn;
          C.setXYZW(k, 0.04, 0.62, 0.78, a);
        }
        P.needsUpdate = true; C.needsUpdate = true;
        // the swath it has just imaged: the ground under it, 290 km wide, where the sun is up
        const sw = this.swaths[i].geometry, SP = sw.getAttribute('position') as THREE.BufferAttribute, SC = sw.getAttribute('color') as THREE.BufferAttribute;
        const S = SP.count / 2, prev = new THREE.Vector3();
        for (let k = 0; k < S; k++) {
          const tk = t - (k / (S - 1)) * TRAIL_S * 1000;
          const g = o.at(tk, this.tmp).normalize();
          const g2 = o.at(tk + 20000, this.tmp2).normalize();
          const along = g2.sub(g).normalize();
          const across = prev.crossVectors(along, g).normalize().multiplyScalar(SWATH / 2 / R);
          const lift = (R + 6000);
          const lx = g.x + across.x, ly = g.y + across.y, lz = g.z + across.z;
          const rx = g.x - across.x, ry = g.y - across.y, rz = g.z - across.z;
          const ll = Math.hypot(lx, ly, lz), rl = Math.hypot(rx, ry, rz);
          SP.setXYZ(2 * k, (lx / ll) * lift, (ly / ll) * lift, (lz / ll) * lift);
          SP.setXYZ(2 * k + 1, (rx / rl) * lift, (ry / rl) * lift, (rz / rl) * lift);
          const day = clamp((g.dot(this.sun) + 0.02) / 0.12, 0, 1);
          const a = 0.42 * Math.pow(1 - k / (S - 1), 1.4) * day * globeOn;
          SC.setXYZW(2 * k, 0.12, 0.78, 0.9, a); SC.setXYZW(2 * k + 1, 0.12, 0.78, 0.9, a);
        }
        SP.needsUpdate = true; SC.needsUpdate = true;
        // the satellite itself, and where its label goes
        o.at(t, this.tmp);
        dotPos.setXYZ(i, this.tmp.x, this.tmp.y, this.tmp.z);
        this.satScreen[i] = this.visible(this.tmp, camPos) ? this.toScreen(this.tmp, this.camera) : null;
      });
      dotPos.needsUpdate = true;
      (this.dots.material as THREE.PointsMaterial).opacity = globeOn;
      r.render(this.scene, this.camera);
    } else this.satScreen.fill(null);

    this.heroScreen = null;
    if (heroOn > 0.001) {
      if (this.deployT < 1) this.deployT = Math.min(1, this.deployT + dt / 3.4);
      this.model.deploy(this.deployT);
      this.poseHero(pose, now);
      r.clearDepth();
      r.render(this.hero, this.heroCam);
      this.tmp.set(0, 0, 0).applyMatrix4(this.model.sat.matrixWorld);
      this.heroScreen = this.toScreen(this.tmp, this.heroCam);
    }
    return true;
  }

  /** The map's camera in Earth-fixed axes: target on the sphere, eye `range` back along the view direction. */
  private placeCamera(v: GlobeView) {
    const lon = v.target[0] * D2R, lat = v.target[1] * D2R;
    const E = new THREE.Vector3(-Math.sin(lon), Math.cos(lon), 0);
    const Nn = new THREE.Vector3(-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat));
    const U = new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat));
    const b = v.bearing * D2R, p = v.pitch * D2R, rl = v.roll * D2R;
    const enu = (x: number, y: number, z: number) => new THREE.Vector3().addScaledVector(E, x).addScaledVector(Nn, y).addScaledVector(U, z);
    const f = enu(Math.sin(p) * Math.sin(b), Math.sin(p) * Math.cos(b), -Math.cos(p));
    const rt0 = enu(Math.cos(b), -Math.sin(b), 0);
    const up0 = new THREE.Vector3().crossVectors(rt0, f);
    const c = Math.cos(rl), s = Math.sin(rl);
    const rt = rt0.clone().multiplyScalar(c).addScaledVector(up0, s), up = up0.clone().multiplyScalar(c).addScaledVector(rt0, -s);
    const eye = U.clone().multiplyScalar(R).addScaledVector(f, -v.range);
    const cam = this.camera;
    cam.matrix.makeBasis(rt, up, f.clone().negate()).setPosition(eye);
    cam.matrix.decompose(cam.position, cam.quaternion, cam.scale);
    cam.updateMatrixWorld(true);
    const D = eye.length();
    cam.near = Math.max(500, (D - R - 1.2e6) * 0.5);
    cam.far = D + R * 1.3;
    cam.fov = FOV; cam.aspect = this.w / this.h;
    cam.updateProjectionMatrix();
    // map padding moves the lens centre: shift the projection the same way
    cam.projectionMatrix.elements[8] = -v.shift[0];
    cam.projectionMatrix.elements[9] = -v.shift[1];
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
  }

  /** In front of the Earth from the camera's point of view (the line of sight does not cross the globe first). */
  private visible(p: THREE.Vector3, eye: THREE.Vector3) {
    const d = this.tmp2.subVectors(p, eye), L = d.length();
    d.divideScalar(L);
    const b = eye.dot(d), c = eye.lengthSq() - R * R, disc = b * b - c;
    if (disc < 0) return true;
    const tHit = -b - Math.sqrt(disc);
    return tHit < 0 || tHit > L;
  }

  private toScreen(p: THREE.Vector3, cam: THREE.Camera): [number, number] | null {
    const v = this.tmp2.copy(p).project(cam);
    if (v.z > 1 || v.z < -1 || Math.abs(v.x) > 1.2 || Math.abs(v.y) > 1.2) return null;
    return [(v.x * 0.5 + 0.5) * this.w, (-v.y * 0.5 + 0.5) * this.h];
  }

  /** The close-up: hangs beside the globe, drifting on its orbit; scroll brings its lens to the camera. */
  private poseHero(pose: HeroPose, now: number) {
    const sat = this.model.sat, L = this.model.lensMouth;
    const cam = this.heroCam, th = Math.tan((cam.fov * D2R) / 2);
    const time = this.reduce ? 0 : (now - this.start) / 1000;
    // resting pose: seen a little from above (the cells catch the light), wing reaching right and away
    const D0 = pose.portrait ? 62 : 34;
    const [sx, sy] = pose.portrait ? [0.42, -0.36] : [0.2, 0.36];
    const rest = new THREE.Quaternion().setFromEuler(new THREE.Euler(
      0.42 + 0.035 * Math.sin(time * 0.31), 0.55 + 0.06 * Math.sin(time * 0.23), -0.1 + 0.025 * Math.sin(time * 0.19), 'YXZ'));
    // final pose: the lens looks straight at the camera (nadir axis -y turned to +z), with a turn of roll
    const end = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0.6, 'ZYX'));
    const a = pose.approach;
    const turn = smoother(clamp(a / 0.7, 0, 1));
    const q = rest.clone().slerp(end, turn);
    // the dolly: gathering pace up to where the baffle frames the lens (FRAME_AT), then on through it while the iris
    // opens; the lens mouth slides to dead centre on the way
    const FRAME_AT = 0.72, FRAME_D = 1.25, END_D = 0.1;
    const dist = a < FRAME_AT
      ? Math.exp(Math.log(D0) + (Math.log(FRAME_D) - Math.log(D0)) * Math.pow(smoother(a / FRAME_AT), 1.8))
      : Math.exp(Math.log(FRAME_D) + (Math.log(END_D) - Math.log(FRAME_D)) * Math.pow((a - FRAME_AT) / (1 - FRAME_AT), 1.6));
    const centre = smoother(clamp(a / 0.62, 0, 1));
    const bob = 0.012 * Math.sin(time * 0.4);
    const lensNow = new THREE.Vector3(sx * (1 - centre) * dist * th * cam.aspect, (sy + bob) * (1 - centre) * dist * th, -dist);
    sat.quaternion.copy(q);
    sat.position.copy(lensNow).sub(L.clone().applyQuaternion(q));
    // the wing turns slowly to keep its cells on the sun
    this.model.root.rotation.x = 0.22 * Math.sin(time * 0.12);
    sat.updateMatrixWorld(true);
  }

  dispose() {
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
