/**
 * The ground the landing story descends to, and the sky it descends through.
 *
 * Real: the terrain around Beed (Mapzen/SRTM elevation, Sentinel-2 cloudless 2016 imagery by EOX, CC BY 4.0), fetched
 * by backend/scripts/fetch_landing_ground.py into /landing. Trees stand where the satellite image is green.
 * Illustration (labelled on the page): the village water point, the people waiting with pots, the tanker's arrival.
 * Atmosphere: raymarched cumulus at real altitude (1.8-3.3 km) that the camera flies through, a sky dome, cloud shadows.
 *
 * Local frame: metres, origin at the village (x east, y up, z south), mapped into the world by one group transform
 * (1 world unit = 1 degree of latitude = 110.7 km). The camera never leaves double precision on the CPU side, so a
 * person at the water point renders as steadily as the country does.
 */
import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useLoader, useThree } from '@react-three/fiber';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { px, pz } from './geo';
import { G, clamp01, groundState, smooth } from './story';
import { live } from './live';

export const M = 110700;                 // metres per world unit
export const KM = M / 1000;
const EXAG = 1.3;                        // relief exaggeration, so the Deccan's low hills read from a drone
const FLAT_IN = 480, FLAT_OUT = 900;     // the village sits on a levelled clearing
const CLOUD = { bottom: 1.8, top: 3.3 }; // km above the plateau

interface Bounds { w: number; e: number; s: number; n: number }
interface GroundMeta { centre: [number, number]; imagery: string; elevation: string; mid: { bounds: Bounds; heightMin: number; heightMax: number }; hi: { bounds: Bounds; heightMin: number; heightMax: number } }
interface HeightGrid { w: number; h: number; data: Float32Array; b: Bounds }
interface GroundData { meta: GroundMeta; mid: HeightGrid; hi: HeightGrid; vx: number; vz: number; lift: number; hV: number }

// ---------------------------------------------------------------------------- data (suspends until loaded)
function loadImage(url: string) {
  return new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
}
async function heightGrid(url: string, b: Bounds, lo: number, hi: number): Promise<HeightGrid> {
  const img = await loadImage(url);
  const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
  const g = cv.getContext('2d')!; g.drawImage(img, 0, 0);
  const px8 = g.getImageData(0, 0, img.width, img.height).data;
  const data = new Float32Array(img.width * img.height);
  for (let i = 0; i < data.length; i++) data[i] = lo + (px8[i * 4] / 255) * (hi - lo);
  return { w: img.width, h: img.height, data, b };
}
let groundPromise: Promise<GroundData> | null = null;
let groundData: GroundData | null = null;
function useGroundData(): GroundData {
  if (groundData) return groundData;
  groundPromise ??= (async () => {
    const meta: GroundMeta = await fetch('/landing/ground.json').then(r => r.json());
    const [mid, hi] = await Promise.all([
      heightGrid('/landing/height-mid.png', meta.mid.bounds, meta.mid.heightMin, meta.mid.heightMax),
      heightGrid('/landing/height-hi.png', meta.hi.bounds, meta.hi.heightMin, meta.hi.heightMax),
    ]);
    const [lng, lat] = meta.centre;
    const d: GroundData = { meta, mid, hi, vx: px(lng), vz: pz(lat), lift: 0, hV: 0 };
    d.hV = elevation(d, lng, lat);
    // lift the patch so its lowest valley still clears the plateau surface it is laid on
    d.lift = ((d.hV - meta.mid.heightMin) * EXAG + 40) / M;
    groundData = d;
    return d;
  })();
  throw groundPromise;
}

function sample(g: HeightGrid, lng: number, lat: number) {
  const u = clamp01((lng - g.b.w) / (g.b.e - g.b.w)) * (g.w - 1), v = clamp01((g.b.n - lat) / (g.b.n - g.b.s)) * (g.h - 1);
  const x0 = Math.floor(u), y0 = Math.floor(v), x1 = Math.min(g.w - 1, x0 + 1), y1 = Math.min(g.h - 1, y0 + 1), fx = u - x0, fy = v - y0;
  const a = g.data[y0 * g.w + x0], b = g.data[y0 * g.w + x1], c = g.data[y1 * g.w + x0], e = g.data[y1 * g.w + x1];
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + e * fx) * fy;
}
function inside(b: Bounds, lng: number, lat: number, margin: number) {
  const fx = Math.min(lng - b.w, b.e - lng) / (b.e - b.w), fy = Math.min(lat - b.s, b.n - lat) / (b.n - b.s);
  return smooth(Math.min(fx, fy) / margin);
}
function elevation(d: GroundData, lng: number, lat: number) {
  const m = sample(d.mid, lng, lat), w = inside(d.hi.b, lng, lat, 0.12);
  return w > 0 ? m + (sample(d.hi, lng, lat) - m) * w : m;
}
const toLngLat = (d: GroundData, x: number, z: number): [number, number] => [(d.vx + x / M) / Math.cos((22.5 * Math.PI) / 180) + 78.5, 22.5 - (d.vz + z / M)];
const toLocal = (d: GroundData, lng: number, lat: number): [number, number] => [(px(lng) - d.vx) * M, (pz(lat) - d.vz) * M];
/** Local surface height (metres) of the analytic ground, before triangulation. */
function surface(d: GroundData, x: number, z: number) {
  const [lng, lat] = toLngLat(d, x, z);
  const f = smooth((Math.hypot(x, z) - FLAT_IN) / (FLAT_OUT - FLAT_IN));
  return (elevation(d, lng, lat) - d.hV) * EXAG * f;
}

// ---------------------------------------------------------------------------- shared shader pieces
/** Tileable 3D noise (R: perlin-worley billows, G: fine worley erosion), generated once. */
let noiseTex: THREE.Data3DTexture | null = null;
function cloudNoise() {
  if (noiseTex) return noiseTex;
  const N = 64, data = new Uint8Array(N * N * N * 2);
  const rnd = (i: number) => { const s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
  const worley = (cells: number, seed: number) => {
    const pts = new Float32Array(cells * cells * cells * 3);
    for (let i = 0; i < cells ** 3; i++) for (let k = 0; k < 3; k++) pts[i * 3 + k] = rnd(i * 3 + k + seed);
    return (x: number, y: number, z: number) => {
      const cx = x * cells, cy = y * cells, cz = z * cells, ix = Math.floor(cx), iy = Math.floor(cy), iz = Math.floor(cz);
      let best = 9;
      for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const gx = ix + dx, gy = iy + dy, gz = iz + dz;
        const wx = ((gx % cells) + cells) % cells, wy = ((gy % cells) + cells) % cells, wz = ((gz % cells) + cells) % cells;
        const o = (wx + wy * cells + wz * cells * cells) * 3;
        const ddx = gx + pts[o] - cx, ddy = gy + pts[o + 1] - cy, ddz = gz + pts[o + 2] - cz;
        const dd = ddx * ddx + ddy * ddy + ddz * ddz;
        if (dd < best) best = dd;
      }
      return 1 - Math.min(1, Math.sqrt(best));
    };
  };
  const w1 = worley(4, 1), w2 = worley(8, 50), w3 = worley(16, 900), w4 = worley(24, 3000);
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N, t = z / N, i = (x + y * N + z * N * N) * 2;
    const billow = w1(u, v, t) * 0.62 + w2(u, v, t) * 0.27 + w3(u, v, t) * 0.11;
    data[i] = Math.round(255 * Math.min(1, Math.max(0, billow * 1.25 - 0.18)));
    data[i + 1] = Math.round(255 * (w3(u, v, t) * 0.6 + w4(u, v, t) * 0.4));
  }
  const tex = new THREE.Data3DTexture(data, N, N, N);
  tex.format = THREE.RGFormat; tex.type = THREE.UnsignedByteType;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  noiseTex = tex;
  return tex;
}

/** Afternoon sun from the north-west (cartographic convention): relief reads from orbit, shadows fall toward the viewer on the ground. */
export const SUN_OFFSET = new THREE.Vector3(-10, 9, -5);
const sun = { dir: SUN_OFFSET.clone().normalize() };

/** Cloud density in km space; shared by the clouds and the shadows they cast. */
const DENSITY = /* glsl */ `
  uniform sampler3D uNoise; uniform float uTime, uBottom, uTop; uniform vec2 uVkm;
  float cloudLod = 0.0;   // 0: cumulus detail, 1: what a satellite resolves (set per ray from the pixel footprint)
  float cloudDensity(vec3 p) {
    float hf = (p.y - uBottom) / (uTop - uBottom);
    if (hf <= 0.0 || hf >= 1.0) return 0.0;
    float cov = texture(uNoise, vec3(p.xz * 0.0024, 0.37)).r * 0.65 + texture(uNoise, vec3(p.xz * 0.011, 0.71)).r * 0.35;
    cov = clamp(cov * 1.9 - 0.95, 0.0, 1.0);   // a dry season: mostly clear, with organised fields
    vec2 dv = p.xz - uVkm;
    cov = max(cov, 0.7 * exp(-dot(dv, dv) / 220.0));        // a cumulus field over Beed for the descent to pass through
    float prof = smoothstep(0.0, 0.08, hf) * smoothstep(1.0, 0.4, hf);
    vec3 q = p * vec3(0.075, 0.16, 0.075) + vec3(uTime * 0.0035, 0.0, uTime * 0.0018);
    float b = mix(texture(uNoise, q).r, texture(uNoise, q * vec3(0.18, 1.0, 0.18) + 0.3).r, cloudLod);
    float d = clamp((b * prof - (1.0 - cov)) / max(cov, 0.05), 0.0, 1.0);
    if (d <= 0.0) return 0.0;
    if (cloudLod > 0.95) return d;
    float det = texture(uNoise, p * 0.45 + vec3(uTime * 0.01, 0.0, 0.0)).g;
    return clamp(d - det * 0.36 * (1.0 - d) * (1.0 - cloudLod), 0.0, 1.0);
  }
`;

// ---------------------------------------------------------------------------- clouds
const cloudVS = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const cloudFS = /* glsl */ `
  precision highp float; precision highp sampler3D;
  ${DENSITY}
  uniform mat4 uProjInv, uCamWorld, uViewProj; uniform vec3 uSun, uHaze; uniform float uMax, uKm, uAlpha, uPixAng;
  varying vec2 vUv;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  float hg(float mu, float g) { float g2 = g * g; return (1.0 - g2) / (4.0 * 3.14159 * pow(1.0 + g2 - 2.0 * g * mu, 1.5)); }
  void main() {
    vec4 v = uProjInv * vec4(vUv * 2.0 - 1.0, -1.0, 1.0); v /= v.w;
    vec3 rd = normalize(mat3(uCamWorld) * v.xyz);
    vec3 ro = cameraPosition * uKm;
    if (abs(rd.y) < 1e-5) rd.y = 1e-5;
    float t0 = (uBottom - ro.y) / rd.y, t1 = (uTop - ro.y) / rd.y;
    float tmin = max(min(t0, t1), 0.0), tmax = min(max(t0, t1), tmin + 70.0);
    if (tmax <= tmin) discard;
    float len = tmax - tmin;
    float n = clamp(ceil(len / 0.07), 6.0, uMax), dt = len / n;
    float t = tmin + dt * (0.25 + 0.5 * hash(gl_FragCoord.xy + fract(uTime) * 61.0));
    cloudLod = smoothstep(0.25, 2.5, tmin * uPixAng);   // km per pixel where the ray meets the layer
    bool below = ro.y < uBottom;
    float mu = dot(rd, uSun), phase = mix(hg(mu, 0.55), hg(mu, -0.25), 0.35) * 4.0;
    vec3 L = vec3(0.0); float T = 1.0, hit = -1.0;
    for (int i = 0; i < 64; i++) {
      if (float(i) >= n || T < 0.02) break;
      vec3 p = ro + rd * t;
      float d = cloudDensity(p);
      if (d > 0.002) {
        if (hit < 0.0) hit = t;
        float ld = cloudDensity(p + uSun * 0.15) + cloudDensity(p + uSun * 0.45) + (below ? 0.0 : cloudDensity(p + uSun * 0.9));
        float sig = 9.0;
        float Tl = exp(-ld * 0.3 * sig);
        float powder = 1.0 - exp(-d * sig * 0.5);
        float hf = (p.y - uBottom) / (uTop - uBottom);
        vec3 amb = mix(vec3(0.46, 0.53, 0.62), vec3(0.9, 0.94, 1.0), hf);
        vec3 col = vec3(1.0, 0.97, 0.92) * Tl * phase * mix(1.0, powder * 2.0, 0.55) * 2.4 + amb * 0.62;
        float a = 1.0 - exp(-d * sig * dt);
        L += T * a * col; T *= 1.0 - a;
      }
      t += dt;
    }
    float alpha = (1.0 - T) * uAlpha;
    if (alpha < 0.003) discard;
    // from inside the atmosphere, far clouds melt into the haze like real aerial perspective
    float fade = ro.y < 15.0 ? exp(-max(hit - 6.0, 0.0) / 32.0) : 1.0;
    L = mix(uHaze * (1.0 - T), L, fade) * uAlpha;
    vec4 clip = uViewProj * vec4((ro + rd * max(hit, tmin)) / uKm, 1.0);
    gl_FragDepth = clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 0.99999);
    gl_FragColor = vec4(L, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const shared = { uTime: { value: 0 }, uBottom: { value: CLOUD.bottom }, uTop: { value: CLOUD.top }, uVkm: { value: new THREE.Vector2() } };

export const Clouds: React.FC<{ q: 'high' | 'low'; haze: THREE.Color }> = ({ q, haze }) => {
  const d = useGroundData();
  const { camera, gl } = useThree();
  const quad = useRef<THREE.Mesh>(null);
  const mat = useMemo(() => {
    shared.uVkm.value.set(d.vx * KM, d.vz * KM);
    shared.uBottom.value = CLOUD.bottom + d.lift * KM; shared.uTop.value = CLOUD.top + d.lift * KM;
    return new THREE.ShaderMaterial({
      vertexShader: cloudVS, fragmentShader: cloudFS, transparent: true, depthWrite: false, depthTest: true,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      uniforms: { ...shared, uNoise: { value: cloudNoise() }, uProjInv: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() },
        uViewProj: { value: new THREE.Matrix4() }, uSun: { value: sun.dir }, uHaze: { value: haze }, uMax: { value: q === 'high' ? 40 : 20 }, uKm: { value: KM }, uAlpha: { value: 1 }, uPixAng: { value: 0.001 } },
    });
  }, [d, q, haze]);
  useFrame((_, dt) => {
    shared.uTime.value += clockReduce() ? 0 : dt;
    mat.uniforms.uProjInv.value.copy(camera.projectionMatrixInverse);
    mat.uniforms.uCamWorld.value.copy(camera.matrixWorld);
    mat.uniforms.uViewProj.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    // a full-screen raymarch is the most expensive thing on the page: only while the shot is near the cloud layer
    if (quad.current) quad.current.visible = live.ph.inGround > 0 || live.dist < 0.6;
    mat.uniforms.uMax.value = live.lowPower ? 18 : q === 'high' ? 40 : 20;
    const cam = camera as THREE.PerspectiveCamera;
    mat.uniforms.uPixAng.value = (2 * Math.tan((cam.fov * Math.PI) / 360)) / Math.max(1, gl.domElement.height / gl.getPixelRatio());
  }, -1);
  return <mesh ref={quad} material={mat} frustumCulled={false} renderOrder={-2}><planeGeometry args={[2, 2]} /></mesh>;
};
let reduceFlag = false;
const clockReduce = () => reduceFlag;
export const setGroundReduce = (r: boolean) => { reduceFlag = r; };

/** A gradient sky behind everything: deep blue overhead, haze at the horizon. */
export const SkyDome: React.FC<{ haze: THREE.Color }> = ({ haze }) => {
  const ref = useRef<THREE.Mesh>(null);
  const mat = useMemo(() => new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    uniforms: { uHaze: { value: haze }, uZenith: { value: new THREE.Color('#6f9cc0') }, uSun: { value: sun.dir } },
    vertexShader: /* glsl */ `varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `uniform vec3 uHaze, uZenith, uSun; varying vec3 vDir;
      void main() {
        float h = max(vDir.y, 0.0);
        vec3 c = mix(uHaze, uZenith, pow(h, 0.55));
        c += vec3(1.0, 0.92, 0.8) * pow(max(dot(normalize(vDir), uSun), 0.0), 48.0) * 0.6;
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }), [haze]);
  useFrame(({ camera }) => {
    const m = ref.current; if (!m) return;
    const cam = camera as THREE.PerspectiveCamera;
    m.position.copy(cam.position);
    m.scale.setScalar((cam.near + cam.far) * 0.5);
  });
  return <mesh ref={ref} material={mat} frustumCulled={false} renderOrder={-100}><sphereGeometry args={[1, 32, 16]} /></mesh>;
};

// ---------------------------------------------------------------------------- terrain
const DETAIL = /* glsl */ `
  float vhash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(vhash(i), vhash(i + vec2(1, 0)), f.x), mix(vhash(i + vec2(0, 1)), vhash(i + vec2(1, 1)), f.x), f.y); }
  float vfbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p *= 2.07; a *= 0.5; } return s; }
`;

function useTerrain(d: GroundData, q: 'high' | 'low') {
  const { gl } = useThree();
  const [midTex, hiTex] = useLoader(THREE.TextureLoader, ['/landing/ground-mid.jpg', '/landing/ground-hi.jpg']);
  return useMemo(() => {
    for (const t of [midTex, hiTex]) { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = gl.capabilities.getMaxAnisotropy(); t.needsUpdate = true; }
    const b = d.meta.mid.bounds, hb = d.meta.hi.bounds;
    const [x0, z0] = toLocal(d, b.w, b.n), [x1, z1] = toLocal(d, b.e, b.s);
    const seg = q === 'high' ? 280 : 160;
    const geo = new THREE.PlaneGeometry(x1 - x0, z1 - z0, seg, seg);
    geo.rotateX(-Math.PI / 2);
    geo.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute, uv = geo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      pos.setY(i, surface(d, x, z));
      const [lng, lat] = toLngLat(d, x, z);
      uv.setXY(i, (lng - b.w) / (b.e - b.w), (lat - b.s) / (b.n - b.s));
    }
    geo.computeVertexNormals();
    const edge = (() => {
      const cv = document.createElement('canvas'); cv.width = cv.height = 256;
      const g = cv.getContext('2d')!; g.fillStyle = '#000'; g.fillRect(0, 0, 256, 256);
      g.filter = 'blur(22px)'; g.fillStyle = '#fff'; g.fillRect(40, 40, 176, 176);
      return new THREE.CanvasTexture(cv);
    })();
    const mat = new THREE.MeshStandardMaterial({ map: midTex, alphaMap: edge, transparent: true, roughness: 1, metalness: 0 });
    const uniforms = {
      uHi: { value: hiTex },
      uHiRect: { value: new THREE.Vector4((hb.w - b.w) / (b.e - b.w), (hb.s - b.s) / (b.n - b.s), (hb.e - hb.w) / (b.e - b.w), (hb.n - hb.s) / (b.n - b.s)) },
      uM: { value: M }, uCamM: { value: new THREE.Vector3() }, uShadowOn: { value: 1 },
      uNoise: { value: cloudNoise() }, uSun: { value: sun.dir }, uTime: shared.uTime, uBottom: shared.uBottom, uTop: shared.uTop, uVkm: shared.uVkm,
      uLift: { value: d.lift * KM },
    };
    mat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, uniforms);
      // cloud shadows are kilometres wide: evaluate them per vertex (150 m grid), not per pixel
      sh.vertexShader = `precision highp sampler3D;
varying vec3 vLoc; varying float vCloudShade; uniform float uShadowOn, uLift; uniform vec3 uSun;
${DENSITY}
`
        + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
          vLoc = transformed;
          vCloudShade = 1.0;
          if (uShadowOn > 0.5) {
            vec3 pk = vec3(transformed.x / 1000.0 + uVkm.x, uLift + transformed.y / 1000.0, transformed.z / 1000.0 + uVkm.y);
            vec3 pc = pk + uSun * ((uBottom + 0.55 * (uTop - uBottom) - pk.y) / uSun.y);
            float cs = cloudDensity(pc) + cloudDensity(pc + vec3(0.0, 0.35, 0.0));
            vCloudShade = 1.0 - 0.5 * smoothstep(0.05, 0.6, cs);
          }`);
      sh.fragmentShader = `varying vec3 vLoc; varying float vCloudShade; uniform sampler2D uHi; uniform vec4 uHiRect; uniform vec3 uCamM;
${DETAIL}
`
        + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
        {
          vec2 huv = (vMapUv - uHiRect.xy) / uHiRect.zw;
          vec2 e = min(huv, 1.0 - huv);
          float wHi = smoothstep(0.0, 0.08, min(e.x, e.y));
          if (wHi > 0.0) diffuseColor.rgb = mix(diffuseColor.rgb, texture2D(uHi, huv).rgb, wHi);
          float dist = distance(vLoc, uCamM);
          float near = 1.0 - smoothstep(120.0, 900.0, dist);
          if (near > 0.0) {
            // only what 10 m pixels cannot show: soil grain, stones, a trodden yard around the water point
            float n2 = vfbm(vLoc.xz * 0.7), n3 = vnoise(vLoc.xz * 5.0);
            // cracked clay: distance to the nearest cell edge of a jittered grid (~1.3 m plates)
            vec2 cp = vLoc.xz * 0.78, ci = floor(cp), cf = fract(cp); float d1 = 8.0, d2 = 8.0;
            for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
              vec2 o = vec2(float(i), float(j)); vec2 h = vec2(vhash(ci + o), vhash(ci + o + 17.3));
              float dd = length(o + h - cf); if (dd < d1) { d2 = d1; d1 = dd; } else if (dd < d2) d2 = dd; }
            float crack = 1.0 - smoothstep(0.0, 0.06, d2 - d1);
            float crackFade = 1.0 - smoothstep(10.0, 60.0, dist);
            vec3 detail = diffuseColor.rgb * (0.86 + 0.26 * n2) * (0.94 + 0.12 * n3);
            float r = length(vLoc.xz);
            float yard = 1.0 - smoothstep(14.0, 46.0, r + (n2 - 0.5) * 18.0);
            detail = mix(detail, vec3(0.36, 0.27, 0.19) * (0.9 + 0.2 * n2 + 0.08 * n3), yard * 0.75);
            detail *= 1.0 - crack * 0.45 * crackFade * (0.5 + 0.5 * smoothstep(0.35, 0.65, n2));
            diffuseColor.rgb = mix(diffuseColor.rgb, detail, near);
          }
          diffuseColor.rgb *= vCloudShade;
        }`);
    };
    return { geo, mat, uniforms, midTex, hiTex };
  }, [d, q, midTex, hiTex, gl]);
}

// ---------------------------------------------------------------------------- village models (metres)
function paint(g: THREE.BufferGeometry, color: string) {
  const c = new THREE.Color(color), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  return g;
}
const merge = (parts: THREE.BufferGeometry[]) => {
  // polyhedra (crowns) are non-indexed, everything else is indexed: merge them all non-indexed
  const g = mergeGeometries(parts.map(p => (p.index ? p.toNonIndexed() : p)), false)!;
  g.computeBoundingSphere();
  return g;
};
const at = (g: THREE.BufferGeometry, x: number, y: number, z: number, ry = 0, rx = 0, rz = 0) => {
  g.rotateX(rx); g.rotateZ(rz); g.rotateY(ry); g.translate(x, y, z); return g;
};
const lathe = (pts: [number, number][], seg = 18) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
const potShape = (s = 1): [number, number][] => [[0.02, 0], [0.12, 0.02], [0.17, 0.1], [0.18, 0.18], [0.15, 0.27], [0.08, 0.32], [0.07, 0.36], [0.09, 0.38]].map(([r, y]) => [r * s, y * s]);

const SARI = ['#c2185b', '#e65100', '#2e7d32', '#1565c0', '#f9a825', '#6a1b9a', '#d84315', '#00838f', '#ad1457', '#558b2f'];
const SKIN = ['#8d5a3b', '#7a4a2f', '#9c6644', '#6e4229'];
function person(i: number) {
  const r = (k: number) => { const s = Math.sin((i + 1) * 91.7 * k) * 43758.5; return s - Math.floor(s); };
  const skin = SKIN[Math.floor(r(1) * SKIN.length)], kid = r(2) < 0.18, man = !kid && r(3) < 0.25;
  const s = kid ? 0.66 : 1, parts: THREE.BufferGeometry[] = [];
  const cloth = SARI[Math.floor(r(4) * SARI.length)], blouse = SARI[Math.floor(r(5) * SARI.length)];
  if (man) {
    parts.push(paint(at(new THREE.CylinderGeometry(0.075, 0.07, 0.86, 8), -0.1, 0.43, 0), '#e8e2d4'), paint(at(new THREE.CylinderGeometry(0.075, 0.07, 0.86, 8), 0.1, 0.43, 0), '#e8e2d4'));
    parts.push(paint(at(new THREE.CylinderGeometry(0.2, 0.18, 0.62, 10), 0, 1.16, 0), ['#f1efe8', '#7b8fa6', '#a1887f'][Math.floor(r(6) * 3)]));
  } else {
    parts.push(paint(lathe([[0.0, 0], [0.27, 0.02], [0.24, 0.45], [0.19, 0.95], [0.0, 0.97]].map(([a, b]) => [a * s, b * s] as [number, number])), cloth));
    parts.push(paint(at(new THREE.CylinderGeometry(0.15 * s, 0.17 * s, 0.5 * s, 10), 0, 1.2 * s, 0), blouse));
    parts.push(paint(at(new THREE.BoxGeometry(0.09 * s, 0.62 * s, 0.36 * s), 0.07 * s, 1.2 * s, 0, 0, 0, 0.55), cloth)); // pallu over the shoulder
  }
  parts.push(paint(at(new THREE.SphereGeometry(0.105 * s, 12, 10), 0, 1.6 * s, 0), skin));
  parts.push(paint(at(new THREE.SphereGeometry(0.11 * s, 12, 10, 0, Math.PI * 2, 0, Math.PI / 2), 0, 1.62 * s, -0.012), '#1b1410'));
  const carry = !kid && !man && r(7) < 0.5;
  for (const side of [-1, 1]) {
    const up = carry && side === 1;
    parts.push(paint(at(new THREE.CylinderGeometry(0.035 * s, 0.03 * s, up ? 0.42 * s : 0.6 * s, 6), up ? 0.13 : side * 0.21 * s, up ? 1.56 * s : 1.12 * s, up ? 0.02 : 0, 0, 0, up ? 0.45 : side * 0.08), skin));
  }
  if (carry) parts.push(paint(at(lathe(potShape(0.95)), 0, 1.71, 0), r(8) < 0.5 ? '#b08d57' : '#c9cbcf'));
  return { geo: merge(parts), kid, seed: r(9) };
}

function tankerModel() {
  const body: THREE.BufferGeometry[] = [];
  body.push(paint(at(new THREE.BoxGeometry(2.3, 0.35, 8.2), 0, 0.85, 0), '#2b2f33'));                      // chassis
  body.push(paint(at(new THREE.BoxGeometry(2.4, 1.75, 1.9), 0, 1.85, 3.15), '#f2f4f5'));                   // cab
  body.push(paint(at(new THREE.BoxGeometry(2.42, 0.75, 0.06), 0, 2.25, 4.11, 0, -0.12), '#1d2a33'));      // windscreen
  body.push(paint(at(new THREE.BoxGeometry(2.42, 0.6, 1.2), 0, 2.3, 3.0), '#1d2a33'));                    // side windows band
  body.push(paint(at(new THREE.BoxGeometry(2.5, 0.28, 0.25), 0, 1.02, 4.15), '#41474d'));                  // bumper
  body.push(paint(at(new THREE.BoxGeometry(2.42, 0.18, 1.9), 0, 2.78, 3.15), '#0a7f99'));                  // cab stripe
  body.push(paint(at(new THREE.CylinderGeometry(1.08, 1.08, 5.6, 28), 0, 2.15, -1.05, 0, Math.PI / 2), '#2f8fb5'));   // tank
  for (const z of [-3.85, 1.75]) body.push(paint(at(new THREE.SphereGeometry(1.08, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), 0, 2.15, z, 0, z < 0 ? -Math.PI / 2 : Math.PI / 2), '#2a85a8'));
  for (const z of [-2.9, -1.05, 0.8]) body.push(paint(at(new THREE.TorusGeometry(1.1, 0.04, 6, 32), 0, 2.15, z), '#1f6a86'));
  body.push(paint(at(new THREE.CylinderGeometry(0.28, 0.28, 0.25, 16), 0, 3.3, -1.05), '#c9cbcf'));       // manhole
  body.push(paint(at(new THREE.CylinderGeometry(0.07, 0.07, 1.3, 8), 1.05, 1.15, -3.6, 0, 0, Math.PI / 2), '#b0b5ba')); // outlet
  const wheels: THREE.BufferGeometry[] = [];
  for (const z of [3.0, -1.9, -3.1]) for (const x of [-1.08, 1.08]) wheels.push(paint(at(new THREE.CylinderGeometry(0.52, 0.52, 0.36, 20), x, 0.52, z, 0, 0, Math.PI / 2), '#16181a'));
  const lights = [paint(at(new THREE.BoxGeometry(0.34, 0.16, 0.05), -0.85, 1.25, 4.12), '#fffbe8'), paint(at(new THREE.BoxGeometry(0.34, 0.16, 0.05), 0.85, 1.25, 4.12), '#fffbe8')];
  return { body: merge(body), wheels: merge(wheels), lights: merge(lights) };
}

function decal() {
  const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 220;
  const g = cv.getContext('2d')!;
  g.fillStyle = 'rgba(0,0,0,0)'; g.fillRect(0, 0, 1024, 220);
  g.fillStyle = '#ffffff'; g.textBaseline = 'middle';
  g.font = '600 104px Mukta, "Nirmala UI", "Noto Sans Devanagari", sans-serif'; g.fillText('पिण्याचे पाणी', 30, 82);
  g.font = '600 52px "Mona Sans", "Geist Variable", system-ui, sans-serif'; g.fillText('DRINKING WATER  ·  JalSetu', 34, 172);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

function villageModel(d: GroundData) {
  const parts: THREE.BufferGeometry[] = [];
  // water point: brick platform, black storage tank, tap stand
  parts.push(paint(at(new THREE.BoxGeometry(3.4, 0.7, 3.4), 7, 0.35, -4), '#a0583d'));
  parts.push(paint(at(new THREE.CylinderGeometry(1.15, 1.15, 1.7, 28), 7, 1.55, -4), '#1c1d1f'));
  parts.push(paint(at(new THREE.CylinderGeometry(0.4, 0.4, 0.14, 20), 7, 2.45, -4), '#2a2b2e'));
  parts.push(paint(at(new THREE.BoxGeometry(0.5, 0.9, 0.5), 5.3, 0.45, -1.9), '#8c8f93'));
  parts.push(paint(at(new THREE.CylinderGeometry(0.035, 0.035, 0.5, 8), 5.3, 0.95, -1.75, 0, Math.PI / 2), '#b0b5ba'));
  // houses: whitewash, ochre, blue; tin roofs
  const homes: [number, number, number, string][] = [[24, -22, 0.2, '#ece6da'], [36, -8, -0.1, '#d9a35b'], [-26, -30, 0.35, '#ece6da'], [-40, -12, 0.1, '#8fb6c9'],
    [46, 18, -0.3, '#ece6da'], [-18, 34, 0.15, '#d9b07a'], [30, 40, 0.5, '#ece6da'], [-52, 22, -0.2, '#c98b5a'], [58, -30, 0.1, '#ece6da'], [10, -42, -0.15, '#d9a35b']];
  for (const [x, z, ry, wall] of homes) {
    const w = 6 + ((x * 7) % 3), dd = 4.5 + ((z * 3) % 2), h = 2.7;
    parts.push(paint(at(new THREE.BoxGeometry(w, h, dd), x, h / 2, z, ry), wall));
    const roof = new THREE.CylinderGeometry(0.01, (dd / 2) * 1.25, w + 0.6, 3, 1); roof.rotateZ(Math.PI / 2); roof.scale(1, 0.38, 1);
    parts.push(paint(at(roof, x, h + 0.3, z, ry), '#8a8f94'));
    parts.push(paint(at(new THREE.BoxGeometry(0.95, 1.9, 0.08), x + Math.sin(ry) * (dd / 2 + 0.02), 0.95, z + Math.cos(ry) * (dd / 2 + 0.02), ry), '#3b2a1e'));
  }
  // electricity poles along the road
  for (let i = 0; i < 6; i++) parts.push(paint(at(new THREE.CylinderGeometry(0.09, 0.12, 8, 6), -40 - i * 42, 4, 8 + i * 14), '#9a9a92'));
  // the pots people brought: two rows beside the queue (instanced separately for colour)
  return merge(parts);
}

const ROAD: [number, number][] = [[-640, 250], [-460, 160], [-300, 92], [-160, 40], [-60, 6], [-16, -6], [-2, -7]];
const QUEUE = (i: number): [number, number] => [9.6 + i * 0.85 + Math.sin(i * 0.7) * 0.15, -1.2 + i * 0.62 + Math.cos(i * 1.3) * 0.12];

// ---------------------------------------------------------------------------- the ground layer
export const Ground: React.FC<{ q: 'high' | 'low'; haze: THREE.Color }> = ({ q, haze }) => {
  const d = useGroundData();
  const t = useTerrain(d, q);
  const group = useRef<THREE.Group>(null);
  const village = useRef<THREE.Group>(null);
  const terrainRef = useRef<THREE.Mesh>(null);
  const villageMesh = useRef<THREE.Mesh>(null);
  const tanker = useRef<THREE.Group>(null);
  const peopleRefs = useRef<(THREE.Mesh | null)[]>([]);

  const model = useMemo(() => {
    const curve = new THREE.CatmullRomCurve3(ROAD.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal', 0.5);
    // road ribbon: dusty, soft-edged, draped on the ground
    const N = 220, rp: number[] = [], ru: number[] = [], idx: number[] = [];
    for (let i = 0; i <= N; i++) {
      const u = i / N, p = curve.getPointAt(u), tg = curve.getTangentAt(u), nx = -tg.z, nz = tg.x;
      for (const s of [-1, 1]) {
        const x = p.x + nx * s * 3.4, z = p.z + nz * s * 3.4;
        rp.push(x, surface(d, x, z) + 0.06, z); ru.push(s < 0 ? 0 : 1, u * 40);
      }
      if (i < N) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const road = new THREE.BufferGeometry();
    road.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
    road.setAttribute('uv', new THREE.Float32BufferAttribute(ru, 2));
    road.setIndex(idx); road.computeVertexNormals();
    const roadAlpha = (() => { const cv = document.createElement('canvas'); cv.width = 64; cv.height = 4; const g = cv.getContext('2d')!;
      const gr = g.createLinearGradient(0, 0, 64, 0); gr.addColorStop(0, '#000'); gr.addColorStop(0.25, '#fff'); gr.addColorStop(0.75, '#fff'); gr.addColorStop(1, '#000');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 4); return new THREE.CanvasTexture(cv); })();

    const tk = tankerModel();
    const people = Array.from({ length: q === 'high' ? 17 : 11 }, (_, i) => person(i));
    // pots in rows beside the queue
    const potGeo = lathe(potShape(1.15), 14);
    const nPots = q === 'high' ? 46 : 26;
    const pots = new THREE.InstancedMesh(potGeo, new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.1 }), nPots);
    const PC = ['#1e88e5', '#fdd835', '#e53935', '#43a047', '#fb8c00', '#c9cbcf', '#b08d57', '#8e24aa'];
    const m4 = new THREE.Matrix4(), col = new THREE.Color();
    for (let i = 0; i < nPots; i++) {
      const row = i % 2, k = Math.floor(i / 2), [qx, qz] = QUEUE(k * 0.75);
      m4.makeRotationY(i * 1.7).setPosition(qx - 1.0 - row * 0.45, 0, qz + 0.9 + row * 0.25);
      pots.setMatrixAt(i, m4); pots.setColorAt(i, col.set(PC[(i * 5) % PC.length]));
    }
    pots.castShadow = true; pots.receiveShadow = true;

    // trees where the Sentinel-2 image is green, within 2.4 km of the village
    const img = t.hiTex.image as HTMLImageElement;
    const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
    const g2 = cv.getContext('2d')!; g2.drawImage(img, 0, 0);
    const pix = g2.getImageData(0, 0, img.width, img.height).data;
    const hb = d.meta.hi.bounds;
    const trunk = paint(new THREE.CylinderGeometry(0.14, 0.24, 2.6, 6).translate(0, 1.3, 0), '#4a3628');
    const crown = [paint(new THREE.IcosahedronGeometry(2.2, 1).scale(1.25, 0.72, 1.25).translate(0, 3.6, 0), '#ffffff'),
      paint(new THREE.IcosahedronGeometry(1.5, 1).scale(1.2, 0.7, 1.2).translate(1.2, 3.2, 0.4), '#ffffff'),
      paint(new THREE.IcosahedronGeometry(1.4, 1).scale(1.2, 0.7, 1.2).translate(-1.0, 3.3, -0.6), '#ffffff')];
    const treeGeo = merge([trunk, ...crown]);
    // trunk stays brown: tint instance colour only on the crown via a per-vertex mask in the colour attribute
    const tc = treeGeo.attributes.color as THREE.BufferAttribute;
    for (let i = 0; i < tc.count; i++) if (tc.getX(i) < 0.9) tc.setXYZ(i, 0.42, 0.33, 0.27);
    const want = q === 'high' ? 1000 : 400, trees: THREE.Matrix4[] = [], tcol: THREE.Color[] = [];
    let seed = 1;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let n = 0; n < want * 30 && trees.length < want; n++) {
      const r = 60 + Math.sqrt(rnd()) * 2400, a = rnd() * Math.PI * 2, x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (Math.abs(z - (x * -0.38 - 10)) < 14 && x < 0) continue; // keep the road clear
      const [lng, lat] = toLngLat(d, x, z);
      const u = Math.floor(((lng - hb.w) / (hb.e - hb.w)) * img.width), v = Math.floor(((hb.n - lat) / (hb.n - hb.s)) * img.height);
      if (u < 0 || v < 0 || u >= img.width || v >= img.height) continue;
      const o = (v * img.width + u) * 4, R = pix[o], Gc = pix[o + 1], B = pix[o + 2];
      const green = (Gc - (R + B) / 2) / 255;
      if (rnd() > Math.min(0.9, Math.max(0.02, green * 9 + 0.04))) continue;
      const s = 0.7 + rnd() * 0.75;
      trees.push(new THREE.Matrix4().compose(new THREE.Vector3(x, surface(d, x, z) - 0.2, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6.3), new THREE.Vector3(s, s * (0.85 + rnd() * 0.4), s)));
      tcol.push(new THREE.Color().setHSL(0.19 + rnd() * 0.08, 0.22 + rnd() * 0.14, 0.11 + rnd() * 0.06));
    }
    // a big neem shading the queue
    trees.push(new THREE.Matrix4().compose(new THREE.Vector3(27, 0, -13), new THREE.Quaternion(), new THREE.Vector3(1.9, 1.7, 1.9)));
    tcol.push(new THREE.Color().setHSL(0.23, 0.3, 0.13));
    const forest = new THREE.InstancedMesh(treeGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), trees.length);
    trees.forEach((m, i) => { forest.setMatrixAt(i, m); forest.setColorAt(i, tcol[i]); });
    forest.castShadow = true; forest.receiveShadow = true;

    // dry grass tufts around the village
    const tuftN = q === 'high' ? 3000 : 1000;
    const tuft = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.16, 0).scale(1.3, 0.55, 1.1).translate(0, 0.05, 0), new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true }), tuftN);
    for (let i = 0; i < tuftN; i++) {
      const r = 32 + Math.pow(rnd(), 0.9) * 150, a = rnd() * Math.PI * 2, x = Math.cos(a) * r, z = Math.sin(a) * r;
      const s = 0.4 + rnd() * 1.4;
      tuft.setMatrixAt(i, m4.compose(new THREE.Vector3(x, surface(d, x, z), z), new THREE.Quaternion(), new THREE.Vector3(s, s * (0.6 + rnd()), s)));
      tuft.setColorAt(i, rnd() < 0.15 ? col.setHSL(0.08, 0.07, 0.2 + rnd() * 0.08) : col.setHSL(0.1 + rnd() * 0.06, 0.32, 0.13 + rnd() * 0.09));
    }
    tuft.receiveShadow = true;

    const dustN = 180, dustPos = new Float32Array(dustN * 3), dustSeed = Array.from({ length: dustN }, () => [rnd(), rnd(), rnd()]);
    const dustGeo = new THREE.BufferGeometry(); dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
    const dustTex = (() => { const c2 = document.createElement('canvas'); c2.width = c2.height = 64; const g = c2.getContext('2d')!;
      const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c2); })();

    return { curve, road, roadAlpha, tk, people, pots, forest, tuft, village: villageModel(d), decal: decal(), dustGeo, dustPos, dustSeed, dustTex };
  }, [d, q, t.hiTex]);

  const vmat = useMemo(() => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }), []);
  const lightMat = useMemo(() => new THREE.MeshStandardMaterial({ vertexColors: true, emissive: new THREE.Color('#fff4d0'), emissiveIntensity: 1.2 }), []);
  const fenceMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#38d5f5', transparent: true, opacity: 0, depthWrite: false }), []);
  const dustMat = useMemo(() => new THREE.PointsMaterial({ map: model.dustTex, color: '#cdb393', size: 3 / M, transparent: true, opacity: 0.55, depthWrite: false }), [model.dustTex]);

  const tmp = useMemo(() => ({ p: new THREE.Vector3(), t: new THREE.Vector3(), cam: new THREE.Vector3(), w: new THREE.Vector3() }), []);
  useFrame(({ camera }) => {
    const ph = live.ph;
    const grp = group.current;
    if (!grp) return;
    // camera in local metres, for the terrain's distance-based detail
    tmp.cam.copy(camera.position); grp.worldToLocal(tmp.cam);
    t.uniforms.uCamM.value.copy(tmp.cam);
    t.uniforms.uShadowOn.value = live.dist < 1.5 ? 1 : 0;
    const near = live.dist < 0.25;
    grp.visible = live.ph.inGround > 0 || live.dist < 0.9;
    if (village.current) village.current.visible = near;

    // the tanker's drive: eases to a stop at the water point
    const u = 1 - Math.pow(1 - ph.drive, 2.3);
    const pos = model.curve.getPointAt(Math.min(0.9999, u)), tan = model.curve.getTangentAt(Math.min(0.9999, u));
    const tankerEl = tanker.current;
    if (tankerEl) {
      tankerEl.position.set(pos.x, surface(d, pos.x, pos.z), pos.z);
      tankerEl.rotation.y = Math.atan2(tan.x, tan.z);
    }
    const len = model.curve.getLength(), toGo = (1 - u) * len;
    groundState.arrived = toGo < 150;
    groundState.stopped = ph.drive > 0.985;
    groundState.delivering = ph.drive >= 1;
    live.tankerLocal.set(pos.x, surface(d, pos.x, pos.z) + 5.2, pos.z);
    live.tankerWorld.copy(live.tankerLocal); grp.localToWorld(live.tankerWorld);

    // people: a little life, and they turn toward the arriving tanker
    peopleRefs.current.forEach((m, i) => {
      if (!m) return;
      const [qx, qz] = QUEUE(i), seed = model.people[i].seed;
      const look = Math.atan2(pos.x - qx, pos.z - qz), idle = Math.atan2(-1, -0.6);
      const turn = smooth(1 - toGo / 260);
      m.rotation.y = idle + (((look - idle + Math.PI) % (Math.PI * 2)) - Math.PI) * turn * 0.85 + Math.sin(shared.uTime.value * 0.6 + seed * 9) * 0.05;
      const step = groundState.stopped ? Math.min(0.6, (ph.drive - 0.985) * 40) : 0;
      m.position.set(qx - step * 0.8, Math.abs(Math.sin(shared.uTime.value * 1.4 + seed * 6)) * 0.01, qz - step * 0.55);
    });
    // the 150 m arrival geofence: visible from the drone, it brightens when the tanker crosses it
    fenceMat.opacity = smooth((live.dist * M - 40) / 160) * (groundState.arrived ? 0.6 : 0.28) * (1 - ph.ascend);
    // dust behind the moving tanker
    const moving = ph.drive > 0 && ph.drive < 0.985;
    const arr = model.dustPos;
    for (let i = 0; i < model.dustSeed.length; i++) {
      const [a, b, c] = model.dustSeed[i];
      const age = (a + shared.uTime.value * 0.35) % 1;
      const back = Math.max(0, u - 0.004 - age * 0.05);
      const pp = model.curve.getPointAt(back);
      arr[i * 3] = pp.x + (b - 0.5) * (2 + age * 9); arr[i * 3 + 1] = surface(d, pp.x, pp.z) + 0.4 + age * 4.5 * c; arr[i * 3 + 2] = pp.z + (c - 0.5) * (2 + age * 9);
    }
    model.dustGeo.attributes.position.needsUpdate = true;
    dustMat.opacity = moving ? 0.5 : Math.max(0, dustMat.opacity - 0.01);
  });

  useEffect(() => () => { t.geo.dispose(); }, [t.geo]);

  return (
    <group ref={group} position={[d.vx, d.lift, d.vz]} scale={1 / M}>
      <mesh ref={terrainRef} geometry={t.geo} material={t.mat} receiveShadow renderOrder={-8} />
      <group ref={village}>
        <mesh geometry={model.road} renderOrder={-7} receiveShadow>
          <meshStandardMaterial color="#9c7c5a" roughness={1} alphaMap={model.roadAlpha} transparent depthWrite={false} polygonOffset polygonOffsetFactor={-2} />
        </mesh>
        <primitive object={model.forest} />
        <primitive object={model.tuft} />
        {/* People are not modelled: the close-up is a real photograph from this district (Landing.tsx). */}
        {/* modelled houses read as toys from a drone: the real terrain and imagery carry the place */}
        <mesh ref={villageMesh} geometry={model.village} material={vmat} castShadow receiveShadow visible={false} />
        <group ref={tanker}>
          <mesh geometry={model.tk.body} material={vmat} castShadow receiveShadow />
          <mesh geometry={model.tk.wheels} material={vmat} castShadow />
          <mesh geometry={model.tk.lights} material={lightMat} />
          {[-1, 1].map(s => (
            <mesh key={s} position={[s * 1.1, 2.15, -1.05]} rotation-y={s * Math.PI / 2}>
              <planeGeometry args={[4.4, 0.95]} />
              <meshStandardMaterial map={model.decal} transparent roughness={0.6} polygonOffset polygonOffsetFactor={-4} />
            </mesh>
          ))}
        </group>
        <points geometry={model.dustGeo} material={dustMat} frustumCulled={false} />
        <mesh position={[7, 0.4, -4]} rotation-x={-Math.PI / 2} material={fenceMat} renderOrder={-6}><ringGeometry args={[149, 151, 192]} /></mesh>
      </group>
    </group>
  );
};

// ---------------------------------------------------------------------------- the ground camera
/** Shots in local metres: drone over the road, then low beside the queue as the tanker pulls in. */
const SHOTS: { pos: [number, number, number]; target: [number, number, number] }[] = [
  { pos: [-230, 120, 200], target: [-80, 0, 30] },
  { pos: [-130, 48, 120], target: [-45, 0, 15] },
  { pos: [-62, 26, 58], target: [-6, 1, 2] },
  // the last metres are a real photograph (Landing.tsx): the camera dives toward the water point, never to street level
  { pos: [-44, 34, 40], target: [2, 0, -2] },
];
const shotPos = new THREE.CatmullRomCurve3(SHOTS.map(s => new THREE.Vector3(...s.pos)), false, 'centripetal');
const shotTgt = new THREE.CatmullRomCurve3(SHOTS.map(s => new THREE.Vector3(...s.target)), false, 'centripetal');

const toWorld = (d: GroundData, v: THREE.Vector3, out: THREE.Vector3) => out.set(d.vx + v.x / M, d.lift + v.y / M, d.vz + v.z / M);
const g = { a: new THREE.Vector3(), b: new THREE.Vector3(), relA: new THREE.Vector3(), relB: new THREE.Vector3(), q: new THREE.Quaternion(), qa: new THREE.Quaternion() };

/** Fly between the map camera and the first/last ground shot: direction slerps, distance moves in log space, so the
 *  plunge feels uniform from 400 km down to 200 m. Returns false when the ground camera is not in charge. */
export function groundCamera(pp: number, mapPos: THREE.Vector3, mapTarget: THREE.Vector3, outPos: THREE.Vector3, outTarget: THREE.Vector3): boolean {
  const d = groundData;
  if (!d || pp <= G.start || pp >= G.end) return false;
  const leg = (s: number, fromMap: boolean) => {
    const e = smooth(s);
    toWorld(d, fromMap ? shotPos.points[0] : shotPos.points[shotPos.points.length - 1], g.a);
    toWorld(d, fromMap ? shotTgt.points[0] : shotTgt.points[shotTgt.points.length - 1], g.b);
    const relA = g.relA.copy(mapPos).sub(mapTarget), relB = g.relB.copy(g.a).sub(g.b);
    const la = relA.length(), lb = relB.length();
    const k = fromMap ? e : 1 - e;           // 0 = map, 1 = ground shot
    const len = Math.exp(Math.log(la) + (Math.log(lb) - Math.log(la)) * k);
    g.qa.setFromUnitVectors(relA.normalize(), relB.normalize());
    g.q.identity().slerp(g.qa, k);
    const dir = relA.applyQuaternion(g.q);
    // the pivot hands over to the ground early on the way down and late on the way up, while the camera is high
    const pk = smooth(fromMap ? e / 0.55 : (e - 0.45) / 0.55);
    outTarget.copy(mapTarget).lerp(g.b, fromMap ? pk : 1 - pk);
    outPos.copy(outTarget).addScaledVector(dir, len);
  };
  if (pp < G.drone) leg((pp - G.start) / (G.drone - G.start), true);
  else if (pp < G.hold) {
    const s = smooth((pp - G.drone) / (G.hold - G.drone));
    toWorld(d, shotPos.getPoint(s), outPos);
    toWorld(d, shotTgt.getPoint(s), outTarget);
  } else leg((pp - G.hold) / (G.end - G.hold), false);
  return true;
}
export const groundReady = () => !!groundData;
export const GROUND_ATTRIBUTION = 'Sentinel-2 cloudless 2016 by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2016), CC BY 4.0; elevation: Mapzen terrain tiles (SRTM)';
