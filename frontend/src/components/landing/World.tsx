/**
 * The landing world: one WebGL scene whose state is a function of the story clock (story.ts).
 *
 * A daylight flight over the real subcontinent: NASA Blue Marble imagery (shaded relief + bathymetry, public domain, via
 * GIBS) with Maharashtra lifted as a plateau on a sharper tile, real sunlight and soft shadows, aerial haze, cloud banks
 * the camera flies through, dust for depth, and a film pipeline (tilt-shift focus, speed blur, lens fringing, grade,
 * vignette, grain) on capable devices.
 *
 * Real: place positions, crisis scores and populations (/api/public/summary), district rainfall deficits (ERA5, same
 * endpoint), state and district outlines (geoBoundaries, /landing/geo.json).
 * Illustrative (and labelled so on the page): supply arcs and flow particles, the tanker run, the national arcs.
 * Atmosphere (clouds, dust, the current of light) is decoration and carries no data.
 *
 * Every moving thing is a shader uniform or a small per-frame update; nothing here re-renders React on scroll.
 */
import React, { Suspense, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { HorizontalTiltShiftShader } from 'three/examples/jsm/shaders/HorizontalTiltShiftShader.js';
import { VerticalTiltShiftShader } from 'three/examples/jsm/shaders/VerticalTiltShiftShader.js';
import type { PublicSummary } from '../../types';
import { deficitRings, dotField, focusPlace, inAny, project, px as lngX, pz as latZ, ringSegments, supplyArcs, toPlaces, type GeoFile, type Place, plain } from './geo';
import { PHOTO, band, base, cameraKeys, clock, phases, sampleKeys, smooth, stepClock } from './story';
import { live } from './live';
import { Clouds, Ground, M, SUN_OFFSET, SkyDome, groundCamera, setGroundReduce } from './Ground';

export type Quality = 'high' | 'low';
export type Anchors = Record<string, HTMLElement | null>;

export const SKY = '#dfe8ec';
const C = {
  haze: new THREE.Color('#dbe5ea'),
  cliff: new THREE.Color('#5b5240'),
  dot: new THREE.Color('#ffffff'),
  dotHome: new THREE.Color('#ffffff'),
  glow: new THREE.Color('#7ee8ff'),
  water: new THREE.Color('#38d5f5'),
  flow: new THREE.Color('#9ff0ff'),
  arc: new THREE.Color('#d9fbff'),
  amber: new THREE.Color('#ffa630'),
  rust: new THREE.Color('#ff4a1c'),
  chaos: new THREE.Color('#ffc9a0'),
  line: new THREE.Color('#ffffff'),
  lineHome: new THREE.Color('#ffffff'),
  quiet: new THREE.Color('#f2fbfd'),
  ink: new THREE.Color('#13222b'),
};
/** Imagery extents (lng/lat): the wide subcontinent tile and the sharper Maharashtra tile. */
const EARTH = { w: 56, e: 104, s: 0, n: 40 };
const MHB = { w: 72.4, e: 81.0, s: 15.4, n: 22.2 };
const HOME_TOP = 0;       // Maharashtra's plateau
const OTHER_TOP = -0.07;  // every other state sits a little lower

/** Dev aid: ?debug=noclouds,nofilm,... switches layers off to isolate rendering problems. */
const DEBUG = new Set((new URLSearchParams(window.location.search).get('debug') ?? '').split(','));
const shared = { uTime: { value: 0 }, uFade: { value: 1 } };
/** Pixels per world unit at distance 1 (viewport height / (2 tan(fov/2))); point sizes are set in world units. */
const scaleU = { value: 1000 };

// ---------------------------------------------------------------------------- shaders
const DISC = /* glsl */ `
  float disc() { vec2 c = gl_PointCoord - 0.5; float d = dot(c, c); return smoothstep(0.25, 0.12, d); }
`;

const terrainVS = /* glsl */ `
  uniform float uTime, uSweep, uHome, uPx, uCalm, uScale;
  attribute float aSeed, aHome;
  varying float vA; varying vec3 vC;
  uniform vec3 uDot, uDotHome, uWater;
  void main() {
    vec3 p = position;
    float sx = mix(-11.0, 18.0, uSweep);
    float band = uSweep > 0.0 && uSweep < 1.0 ? exp(-pow((p.x - sx) * 0.42, 2.0)) : 0.0;
    // a slow current of colour drifting south-east across the country (atmosphere, not data)
    float cur = pow(0.5 + 0.5 * sin(p.x * 0.42 - p.z * 0.31 - uTime * 0.55 + sin(p.z * 0.6 + uTime * 0.2) * 1.4), 6.0);
    p.y += band * 0.05;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float depth = -mv.z;
    gl_PointSize = clamp(uPx * (0.036 + aSeed * 0.016) * uScale / depth * (1.0 + band * 0.3), 1.3 * uPx, 3.6 * uPx);
    vec3 base = mix(uDot, uDotHome, aHome * uHome);
    vC = mix(base, uWater, clamp(band * 0.85 + cur * 0.55 * (1.0 - uCalm * 0.5), 0.0, 1.0));
    vA = (0.12 + 0.1 * aSeed + band * 0.38 + cur * 0.22 * (1.0 - uCalm * 0.5)) * smoothstep(120.0, 40.0, depth) * smoothstep(0.4, 2.0, depth);
  }
`;
const pointFS = /* glsl */ `
  varying float vA; varying vec3 vC;
  ${DISC}
  uniform float uFade;
  void main() { float a = disc() * vA * uFade; if (a < 0.02) discard; gl_FragColor = vec4(vC, a); }
`;

const placesVS = /* glsl */ `
  uniform float uTime, uAlpha, uChaos, uPx, uScale;
  attribute float aCrisis, aPop, aSeed;
  varying float vA; varying vec3 vC;
  uniform vec3 uCool, uAmber, uRust;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float size = (0.012 + log(max(aPop, 100.0)) * 0.0042 + aCrisis * 0.00022) * (aCrisis >= 40.0 ? 1.0 : 0.7);
    float flick = mix(1.0, 0.3 + 0.7 * step(0.5, fract(aSeed * 13.0 + uTime * (0.6 + aSeed))), uChaos * step(40.0, aCrisis));
    gl_PointSize = clamp(uPx * size * uScale / -mv.z, 1.6 * uPx, 9.0 * uPx);
    vC = aCrisis >= 70.0 ? uRust : aCrisis >= 40.0 ? uAmber : uCool;
    vA = uAlpha * flick * (aCrisis >= 40.0 ? 0.95 : 0.42) * smoothstep(120.0, 20.0, -mv.z);
  }
`;

/** Flow particles travel along a quadratic arc A→B. With uChaos they wander, scatter and lose their colour. */
const flowVS = /* glsl */ `
  uniform float uTime, uChaos, uAlpha, uPx, uDim, uScale, uHot;
  uniform vec3 uWater, uChaosC;
  attribute vec4 aAB; attribute vec4 aMeta; // ax az bx bz | lift seed speed hot
  varying float vA; varying vec3 vC;
  void main() {
    float t = fract(aMeta.y + uTime * aMeta.z);
    vec3 A = vec3(aAB.x, 0.0, aAB.y), B = vec3(aAB.z, 0.0, aAB.w);
    vec3 M = (A + B) * 0.5 + vec3(0.0, aMeta.x, 0.0);
    vec3 ordered = mix(mix(A, M, t), mix(M, B, t), t);
    float s = aMeta.y * 31.0;
    vec3 wander = (A + B) * 0.5 + vec3(sin(s * 1.7) * 2.6 + sin(t * 4.1 + s) * 0.9 + sin(uTime * 0.35 + s) * 0.5,
      0.04 + abs(sin(t * 3.0 + s)) * 0.3, cos(s * 2.3) * 2.2 + cos(t * 3.3 + s * 1.3) * 0.9);
    vec3 p = mix(ordered, wander, uChaos);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(uPx * (0.018 + aMeta.z * 0.22) * uScale / -mv.z, 1.2 * uPx, 5.0 * uPx);
    float ends = sin(3.14159 * t);
    float hot = mix(1.0, aMeta.w > 0.5 ? 1.5 : 0.18, uHot);
    vC = mix(uWater, uChaosC, uChaos);
    vA = clamp(uAlpha * ends * hot * (1.0 - 0.85 * uDim) * mix(0.95, 0.55, uChaos), 0.0, 1.0) * smoothstep(120.0, 6.0, -mv.z);
  }
`;

const arcVS = /* glsl */ `
  attribute float aSeg, aT;
  varying float vSeg, vT; varying float vDepth;
  void main() { vSeg = aSeg; vT = aT; vec4 mv = modelViewMatrix * vec4(position, 1.0); vDepth = -mv.z; gl_Position = projectionMatrix * mv; }
`;
const arcFS = /* glsl */ `
  uniform float uChaos, uAlpha, uTime, uFade; uniform vec3 uColor, uChaosC;
  varying float vSeg, vT; varying float vDepth;
  void main() {
    if (uFade < 0.01) discard;
    if (vSeg < uChaos * 0.8) discard;
    float pulse = 0.35 + 0.65 * smoothstep(0.1, 0.0, abs(fract(vT - uTime * 0.12) - 0.5) - 0.38);
    vec3 c = mix(uColor, uChaosC, uChaos);
    gl_FragColor = vec4(c, uAlpha * uFade * pulse * (1.0 - 0.5 * uChaos) * smoothstep(120.0, 15.0, vDepth));
  }
`;

const fillVS = /* glsl */ `
  varying vec2 vXZ;
  void main() { vec4 w = modelMatrix * vec4(position, 1.0); vXZ = w.xz; gl_Position = projectionMatrix * viewMatrix * w; }
`;
const fillFS = /* glsl */ `
  uniform float uAlpha, uTime, uFade; uniform vec3 uColor; varying vec2 vXZ; uniform vec2 uCentre;
  void main() {
    float r = distance(vXZ, uCentre);
    float ring = 0.5 + 0.5 * sin(r * 9.0 - uTime * 1.6);
    gl_FragColor = vec4(uColor, uAlpha * uFade * (0.5 + 0.3 * ring));
  }
`;

const dustVS = /* glsl */ `
  uniform float uTime, uPx, uScale, uAlpha; attribute float aSeed;
  varying float vA; varying vec3 vC;
  void main() {
    vec3 p = position + vec3(sin(uTime * 0.2 + aSeed * 30.0) * 0.15, sin(uTime * 0.27 + aSeed * 17.0) * 0.08, cos(uTime * 0.18 + aSeed * 11.0) * 0.15);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(uPx * 0.012 * uScale / -mv.z, 0.8 * uPx, 7.0 * uPx);
    vC = vec3(1.0);
    vA = uAlpha * (0.25 + 0.35 * aSeed) * smoothstep(0.2, 1.2, -mv.z) * smoothstep(30.0, 8.0, -mv.z);
  }
`;

const pointsMat = (vs: string, fs: string, uniforms: Record<string, THREE.IUniform>) =>
  new THREE.ShaderMaterial({ vertexShader: vs, fragmentShader: fs, uniforms: { ...uniforms, uTime: shared.uTime, uFade: shared.uFade }, transparent: true, depthWrite: false });

// ---------------------------------------------------------------------------- layers
interface Ctx { geo: GeoFile; places: Place[]; focus: { place: Place; name: string | null; district: string | null }; s: PublicSummary; q: Quality; px: number; run: THREE.Vector3[]; hub: Place }

const toShapes = (rings: [number, number][][]) => rings.filter(r => r.length > 3).map(r => new THREE.Shape(r.map(([lng, lat]) => { const [x, z] = project(lng, lat); return new THREE.Vector2(x, -z); })));

/** The real subcontinent: Blue Marble imagery as the ground, Maharashtra lifted as a plateau on a sharper tile. */
const Earth: React.FC<{ c: Ctx }> = ({ c }) => {
  const { gl } = useThree();
  const [wide, mh] = useLoader(THREE.TextureLoader, ['/landing/earth.jpg', '/landing/earth-mh.jpg']);
  useMemo(() => {
    for (const t of [wide, mh]) { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = gl.capabilities.getMaxAnisotropy(); t.needsUpdate = true; }
  }, [wide, mh, gl]);
  const { ground, groundPos, plateau } = useMemo(() => {
    const x0 = lngX(EARTH.w), x1 = lngX(EARTH.e), z0 = latZ(EARTH.n), z1 = latZ(EARTH.s);
    const ground = new THREE.PlaneGeometry(x1 - x0, z1 - z0);
    ground.rotateX(-Math.PI / 2);
    // the shape plane is (x, -z) = (x, lat - 22.5): map it onto the Maharashtra tile
    const mx0 = lngX(MHB.w), mx1 = lngX(MHB.e), my0 = MHB.s - 22.5, my1 = MHB.n - 22.5;
    const uv = (v: number[], i: number) => new THREE.Vector2((v[i * 3] - mx0) / (mx1 - mx0), (v[i * 3 + 1] - my0) / (my1 - my0));
    const gen = {
      generateTopUV: (_g: THREE.ExtrudeGeometry, v: number[], a: number, b: number, d: number) => [uv(v, a), uv(v, b), uv(v, d)],
      generateSideWallUV: () => [new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2()],
    };
    const depth = HOME_TOP - OTHER_TOP + 0.04;
    const homeRings = c.geo.states.find(s => s.name === c.geo.maharashtra)?.rings ?? [];
    const plateau = new THREE.ExtrudeGeometry(toShapes(homeRings), { depth, bevelEnabled: false, curveSegments: 1, UVGenerator: gen as unknown as THREE.UVGenerator });
    plateau.rotateX(-Math.PI / 2);
    plateau.translate(0, HOME_TOP - depth, 0);
    plateau.computeVertexNormals();
    return { ground, groundPos: [(x0 + x1) / 2, OTHER_TOP, (z0 + z1) / 2] as [number, number, number], plateau };
  }, [c.geo]);
  const edge = useMemo(() => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 256;
    const g = cv.getContext('2d')!;
    g.fillStyle = '#000'; g.fillRect(0, 0, 256, 256);
    g.filter = 'blur(18px)'; g.fillStyle = '#fff'; g.fillRect(34, 30, 188, 196);
    return new THREE.CanvasTexture(cv);
  }, []);
  const capMat = useMemo(() => new THREE.MeshStandardMaterial({ map: mh, roughness: 1, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0 }), [mh]);
  const sideMat = useMemo(() => new THREE.MeshStandardMaterial({ color: C.cliff, roughness: 1 }), []);
  useFrame(() => { capMat.emissiveIntensity = 0.06 * live.ph.places * (1 - live.ph.calm * 0.5); });
  return (
    <group>
      <mesh position={[groundPos[0], OTHER_TOP - 0.02, groundPos[2]]} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[400, 400]} />
        <meshStandardMaterial color={C.haze} roughness={1} />
      </mesh>
      <mesh geometry={ground} position={groundPos} receiveShadow renderOrder={-10}>
        <meshStandardMaterial map={wide} alphaMap={edge} transparent roughness={1} />
      </mesh>
      <mesh geometry={plateau} material={[capMat, sideMat]} castShadow receiveShadow />
    </group>
  );
};

const Terrain: React.FC<{ c: Ctx }> = ({ c }) => {
  const { geo, q, px } = c;
  const { geom, mat } = useMemo(() => {
    const f = dotField(geo, q === 'high' ? 0.15 : 0.26);
    for (let i = 0; i < f.home.length; i++) f.pos[i * 3 + 1] = (f.home[i] ? HOME_TOP : OTHER_TOP) + 0.004;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(f.pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(f.seed, 1));
    g.setAttribute('aHome', new THREE.BufferAttribute(f.home, 1));
    const m = pointsMat(terrainVS, pointFS, { uSweep: { value: 0 }, uHome: { value: 0 }, uPx: { value: px }, uCalm: { value: 0 }, uScale: scaleU,
      uDot: { value: C.dot }, uDotHome: { value: C.dotHome }, uWater: { value: C.glow } });
    return { geom: g, mat: m };
  }, [geo, q, px]);
  useFrame(() => {
    const ph = live.ph;
    mat.uniforms.uSweep.value = ph.sweep;
    mat.uniforms.uHome.value = Math.max(ph.places, 0.4);
    mat.uniforms.uCalm.value = ph.calm;
  });
  return <points geometry={geom} material={mat} frustumCulled={false} />;
};

const Lines: React.FC<{ c: Ctx }> = ({ c }) => {
  const { states, home, districts, dMat, homeMat } = useMemo(() => {
    const mk = (arr: Float32Array) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(arr, 3)); return g; };
    const other = c.geo.states.filter(s => s.name !== c.geo.maharashtra).flatMap(s => s.rings);
    const mh = c.geo.states.find(s => s.name === c.geo.maharashtra)?.rings ?? [];
    return {
      states: mk(ringSegments(other, OTHER_TOP + 0.006)),
      home: mk(ringSegments(mh, HOME_TOP + 0.008)),
      districts: mk(ringSegments(c.geo.districts.flatMap(d => d.rings), HOME_TOP + 0.006)),
      dMat: new THREE.LineBasicMaterial({ color: C.line, transparent: true, opacity: 0 }),
      homeMat: new THREE.LineBasicMaterial({ color: C.lineHome, transparent: true, opacity: 0.85 }),
    };
  }, [c.geo]);
  useFrame(() => {
    const ph = live.ph;
    dMat.opacity = 0.55 * ph.districts;
    homeMat.opacity = 0.7 + 0.3 * Math.max(ph.places, ph.districts) * (1 - 0.4 * ph.national);
  });
  return (
    <group>
      <lineSegments geometry={states}><lineBasicMaterial color={C.line} transparent opacity={0.42} /></lineSegments>
      <lineSegments geometry={home} material={homeMat} />
      <lineSegments geometry={districts} material={dMat} />
    </group>
  );
};

const Places: React.FC<{ c: Ctx; onHover: (p: Place | null, x: number, y: number) => void }> = ({ c, onHover }) => {
  const { geom, mat } = useMemo(() => {
    const n = c.places.length;
    const pos = new Float32Array(n * 3), cr = new Float32Array(n), pop = new Float32Array(n), seed = new Float32Array(n);
    c.places.forEach((p, i) => { pos[i * 3] = p.x; pos[i * 3 + 1] = HOME_TOP + 0.02; pos[i * 3 + 2] = p.z; cr[i] = p.crisis; pop[i] = p.pop; seed[i] = Math.abs((Math.sin(i * 12.9898) * 43758.5453) % 1); });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aCrisis', new THREE.BufferAttribute(cr, 1));
    g.setAttribute('aPop', new THREE.BufferAttribute(pop, 1));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    g.computeBoundingSphere();
    const m = pointsMat(placesVS, pointFS, { uAlpha: { value: 0 }, uChaos: { value: 0 }, uPx: { value: c.px }, uScale: scaleU, uCool: { value: C.quiet }, uAmber: { value: C.amber }, uRust: { value: C.rust } });
    return { geom: g, mat: m };
  }, [c.places, c.px]);
  useFrame(() => { mat.uniforms.uAlpha.value = live.ph.places; mat.uniforms.uChaos.value = live.ph.chaos; });
  return (
    <points geometry={geom} material={mat}
      onPointerMove={e => { if (live.ph.places < 0.5 || e.index == null) return; e.stopPropagation(); onHover(c.places[e.index], e.nativeEvent.clientX, e.nativeEvent.clientY); }}
      onPointerOut={() => onHover(null, 0, 0)} />
  );
};

const Flows: React.FC<{ c: Ctx }> = ({ c }) => {
  const { geom, mat, arcGeom, arcMat } = useMemo(() => {
    const arcs = supplyArcs(c.places, c.q === 'high' ? 240 : 110);
    const per = c.q === 'high' ? 34 : 18;
    const n = arcs.length * per;
    const hotRings = deficitRings(c.geo, c.s.rainfall);
    const ab = new Float32Array(n * 4), meta = new Float32Array(n * 4), pos = new Float32Array(n * 3);
    arcs.forEach((a, i) => {
      const d = Math.hypot(a.a.x - a.b.x, a.a.z - a.b.z);
      const hot = inAny(a.b.lng, a.b.lat, hotRings) ? 1 : 0;
      for (let k = 0; k < per; k++) {
        const j = i * per + k;
        ab.set([a.a.x, a.a.z, a.b.x, a.b.z], j * 4);
        meta.set([0.12 + d * 0.22, (k / per + Math.abs(Math.sin(j * 7.13)) * 0.07) % 1, 0.025 + 0.035 * Math.abs(Math.sin(j * 3.7)), hot], j * 4);
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aAB', new THREE.BufferAttribute(ab, 4));
    g.setAttribute('aMeta', new THREE.BufferAttribute(meta, 4));
    const m = pointsMat(flowVS, pointFS, { uChaos: { value: 0 }, uAlpha: { value: 0 }, uPx: { value: c.px }, uDim: { value: 0 }, uScale: scaleU, uHot: { value: 0 },
      uWater: { value: C.flow }, uChaosC: { value: C.chaos } });
    const SEG = 22;
    const lp = new Float32Array(arcs.length * SEG * 6), ls = new Float32Array(arcs.length * SEG * 2), lt = new Float32Array(arcs.length * SEG * 2);
    arcs.forEach((a, i) => {
      const lift = 0.12 + Math.hypot(a.a.x - a.b.x, a.a.z - a.b.z) * 0.22;
      const at = (t: number) => {
        const mx = (a.a.x + a.b.x) / 2, mz = (a.a.z + a.b.z) / 2, u = 1 - t;
        return [u * u * a.a.x + 2 * u * t * mx + t * t * a.b.x, 2 * u * t * lift, u * u * a.a.z + 2 * u * t * mz + t * t * a.b.z];
      };
      for (let k = 0; k < SEG; k++) {
        const o = i * SEG + k;
        lp.set([...at(k / SEG), ...at((k + 1) / SEG)], o * 6);
        const h = Math.abs(Math.sin(o * 91.7 + i)) % 1;
        ls.set([h, h], o * 2); lt.set([k / SEG, (k + 1) / SEG], o * 2);
      }
    });
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(lp, 3));
    lg.setAttribute('aSeg', new THREE.BufferAttribute(ls, 1));
    lg.setAttribute('aT', new THREE.BufferAttribute(lt, 1));
    const lm = new THREE.ShaderMaterial({ vertexShader: arcVS, fragmentShader: arcFS, transparent: true, depthWrite: false,
      uniforms: { uChaos: { value: 0 }, uAlpha: { value: 0 }, uTime: shared.uTime, uFade: shared.uFade, uColor: { value: C.arc }, uChaosC: { value: C.chaos } } });
    return { geom: g, mat: m, arcGeom: lg, arcMat: lm };
  }, [c]);
  useFrame(() => {
    const ph = live.ph;
    mat.uniforms.uChaos.value = ph.chaos;
    mat.uniforms.uAlpha.value = 1 - 0.6 * ph.national;
    mat.uniforms.uDim.value = Math.max(ph.spikes * 0.7, ph.ops);
    mat.uniforms.uHot.value = ph.disaster;
    arcMat.uniforms.uChaos.value = ph.chaos;
    arcMat.uniforms.uAlpha.value = 0.55 * ph.routes * (1 - 0.75 * Math.max(ph.spikes, ph.ops)) * (1 - 0.5 * ph.national) * (1 - 0.5 * ph.disaster);
  });
  return <group><lineSegments geometry={arcGeom} material={arcMat} frustumCulled={false} /><points geometry={geom} material={mat} frustumCulled={false} /></group>;
};

/** Crisis columns: solid, lit, casting shadows; they grow out of the plateau. */
const Spikes: React.FC<{ c: Ctx }> = ({ c }) => {
  const { mesh, list, base } = useMemo(() => {
    const list = c.places.filter(p => p.crisis >= 40 || p === c.focus.place);
    const geo = new THREE.BoxGeometry(1, 1, 1); geo.translate(0, 0.5, 0);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.05 });
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
    const base = list.map(p => {
      const focus = p === c.focus.place;
      return { p, h: focus ? 1.15 : 0.12 + (p.crisis / 100) * 0.55, w: focus ? 0.04 : 0.016 + Math.min(0.02, Math.log10(Math.max(p.pop, 100)) * 0.003) };
    });
    base.forEach(({ p }, i) => mesh.setColorAt(i, p === c.focus.place ? C.water : p.crisis >= 70 ? C.rust : C.amber));
    mat.emissive = new THREE.Color('#1a0d00'); mat.emissiveIntensity = 0.4;
    return { mesh, list, base };
  }, [c]);
  const last = useRef(-1);
  const m = useMemo(() => new THREE.Matrix4(), []);
  useFrame(() => {
    const g = live.ph.spikes;
    mesh.visible = g > 0.001;
    if (Math.abs(g - last.current) < 0.0005) return;
    last.current = g;
    for (let i = 0; i < list.length; i++) {
      const { p, h, w } = base[i];
      // stagger: taller (more critical) columns rise first
      const k = THREE.MathUtils.clamp(g * 1.35 - (1 - h / 1.2) * 0.35, 0, 1);
      m.makeScale(w, Math.max(0.0001, h * k * k * (3 - 2 * k)), w).setPosition(p.x, HOME_TOP, p.z);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });
  return <primitive object={mesh} />;
};

const Focus: React.FC<{ c: Ctx }> = ({ c }) => {
  const ring = useRef<THREE.Mesh>(null);
  const fence = useRef<THREE.Mesh>(null);
  useFrame(({ clock: t }) => {
    const ph = live.ph;
    if (ring.current) {
      const f = (t.elapsedTime * 0.6) % 1;
      ring.current.scale.setScalar((1 + f * 2.2) * 0.09);
      (ring.current.material as THREE.MeshBasicMaterial).opacity = ph.focus * (1 - f) * 0.9;
    }
    if (fence.current) {
      const arrive = ph.ops * THREE.MathUtils.smoothstep(ph.tanker, 0.72, 0.9);
      (fence.current.material as THREE.MeshBasicMaterial).opacity = ph.ops * (0.35 + 0.6 * arrive);
      fence.current.scale.setScalar(0.16 * (1 + 0.08 * Math.sin(t.elapsedTime * 3) * arrive));
    }
  });
  const { x, z } = c.focus.place;
  return (
    <group position={[x, HOME_TOP + 0.012, z]}>
      <mesh ref={ring} rotation-x={-Math.PI / 2}><ringGeometry args={[0.88, 1, 64]} /><meshBasicMaterial color={C.water} transparent opacity={0} depthWrite={false} /></mesh>
      <mesh ref={fence} rotation-x={-Math.PI / 2}><ringGeometry args={[0.94, 1, 96]} /><meshBasicMaterial color={C.water} transparent opacity={0} depthWrite={false} /></mesh>
    </group>
  );
};

/** Illustration of the tracking workflow: one tanker, real terminology, no real telemetry. */
const Run: React.FC<{ c: Ctx }> = ({ c }) => {
  const truck = useRef<THREE.Group>(null);
  const { trail, trailMat, trailLine, fixes, fixMat, total } = useMemo(() => {
    const pts = c.run;
    const tg = new THREE.BufferGeometry().setFromPoints(pts);
    const fg = new THREE.BufferGeometry().setFromPoints(pts.filter((_, i) => i % 6 === 0));
    const tm = new THREE.LineBasicMaterial({ color: C.water, transparent: true, opacity: 0 });
    return {
      trail: tg, trailMat: tm, trailLine: new THREE.Line(tg, tm),
      fixes: fg, fixMat: new THREE.PointsMaterial({ color: C.water, size: 0.05, transparent: true, opacity: 0, depthWrite: false }),
      total: pts.length,
    };
  }, [c.run]);
  const tmp = useMemo(() => ({ a: new THREE.Vector3(), b: new THREE.Vector3() }), []);
  useFrame(() => {
    const ph = live.ph;
    const t = ph.tanker;
    const idx = Math.min(total - 2, Math.floor(t * (total - 1)));
    trail.setDrawRange(0, Math.max(2, idx + 2));
    fixes.setDrawRange(0, Math.floor(idx / 6) + 1);
    trailMat.opacity = ph.ops;
    fixMat.opacity = ph.ops;
    if (truck.current) {
      const f = t * (total - 1) - idx;
      tmp.a.copy(c.run[idx]).lerp(c.run[idx + 1], f);
      tmp.b.copy(c.run[Math.min(total - 1, idx + 3)]);
      truck.current.position.set(tmp.a.x, HOME_TOP, tmp.a.z);
      truck.current.lookAt(tmp.b.x, HOME_TOP, tmp.b.z);
      truck.current.visible = ph.ops > 0.02;
      truck.current.scale.setScalar(1.5 * (0.6 + 0.4 * ph.ops));
    }
  });
  return (
    <group>
      <primitive object={trailLine} />
      <points geometry={fixes} material={fixMat} />
      <group ref={truck} visible={false}>
        {/* cab in front (+z faces the direction of travel), tank behind */}
        <mesh position={[0, 0.022, 0.042]} castShadow><boxGeometry args={[0.04, 0.036, 0.026]} /><meshStandardMaterial color={C.ink} roughness={0.5} /></mesh>
        <mesh position={[0, 0.024, -0.008]} rotation-x={Math.PI / 2} castShadow><cylinderGeometry args={[0.019, 0.019, 0.07, 20]} /><meshStandardMaterial color={C.water} roughness={0.35} metalness={0.2} /></mesh>
        <mesh position={[0, 0.003, 0]} rotation-x={-Math.PI / 2}><circleGeometry args={[0.09, 40]} /><meshBasicMaterial color={C.water} transparent opacity={0.18} depthWrite={false} /></mesh>
      </group>
    </group>
  );
};

/** Real: districts whose monsoon rainfall is far below their 10-year mean (ERA5, from the public summary). */
const Deficit: React.FC<{ c: Ctx }> = ({ c }) => {
  const items = useMemo(() => {
    const byKey = new Map(c.geo.districts.map(d => [d.key, d]));
    return c.s.rainfall.filter(r => r.severity === 'Severe' || r.severity === 'Moderate').map(r => {
      const d = byKey.get(plain(r.district));
      if (!d) return null;
      const [cx, cz] = project(d.c[0], d.c[1]);
      const g = new THREE.ShapeGeometry(toShapes(d.rings));
      g.rotateX(-Math.PI / 2);
      const mat = new THREE.ShaderMaterial({ vertexShader: fillVS, fragmentShader: fillFS, transparent: true, depthWrite: false, side: THREE.DoubleSide,
        uniforms: { uAlpha: { value: 0 }, uTime: shared.uTime, uFade: shared.uFade, uColor: { value: r.severity === 'Severe' ? C.rust : C.amber }, uCentre: { value: new THREE.Vector2(cx, cz) } } });
      return { g, mat, weight: Math.min(1, Math.abs(r.deviation) / 45) };
    }).filter(Boolean) as { g: THREE.BufferGeometry; mat: THREE.ShaderMaterial; weight: number }[];
  }, [c]);
  useFrame(() => { for (const it of items) it.mat.uniforms.uAlpha.value = live.ph.disaster * 0.62 * it.weight; });
  return <group position={[0, HOME_TOP + 0.003, 0]}>{items.map((it, i) => <mesh key={i} geometry={it.g} material={it.mat} />)}</group>;
};

/** Illustration of national scale: arcs from Maharashtra to every mainland state. */
const National: React.FC<{ c: Ctx }> = ({ c }) => {
  const { geom, mat } = useMemo(() => {
    const centre = (rings: [number, number][][]) => {
      let sx = 0, sz = 0, n = 0;
      for (const r of rings) for (const [lng, lat] of r) { const [x, z] = project(lng, lat); sx += x; sz += z; n++; }
      return [sx / n, sz / n];
    };
    const mh = centre(c.geo.states.find(s => s.name === c.geo.maharashtra)?.rings ?? []);
    // mainland states only: arcs to the island territories would cross open sea and dominate the frame
    const targets = c.geo.states.filter(s => s.name !== c.geo.maharashtra && s.rings.length).map(s => centre(s.rings)).filter(([x, z]) => x < 13 && z < 13);
    const SEG = 40;
    const pos = new Float32Array(targets.length * SEG * 6), seg = new Float32Array(targets.length * SEG * 2), tt = new Float32Array(targets.length * SEG * 2);
    targets.forEach(([bx, bz], i) => {
      const d = Math.hypot(bx - mh[0], bz - mh[1]);
      const at = (t: number) => { const u = 1 - t, mx = (mh[0] + bx) / 2, mz = (mh[1] + bz) / 2; return [u * u * mh[0] + 2 * u * t * mx + t * t * bx, 2 * u * t * (0.6 + d * 0.18), u * u * mh[1] + 2 * u * t * mz + t * t * bz]; };
      for (let k = 0; k < SEG; k++) {
        const o = i * SEG + k;
        pos.set([...at(k / SEG), ...at((k + 1) / SEG)], o * 6);
        seg.set([1, 1], o * 2); tt.set([k / SEG, (k + 1) / SEG], o * 2);
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeg', new THREE.BufferAttribute(seg, 1));
    g.setAttribute('aT', new THREE.BufferAttribute(tt, 1));
    const m = new THREE.ShaderMaterial({ vertexShader: arcVS, fragmentShader: arcFS, transparent: true, depthWrite: false,
      uniforms: { uChaos: { value: 0 }, uAlpha: { value: 0 }, uTime: shared.uTime, uFade: shared.uFade, uColor: { value: C.arc }, uChaosC: { value: C.chaos } } });
    return { geom: g, mat: m };
  }, [c.geo]);
  useFrame(() => { mat.uniforms.uAlpha.value = live.ph.national * 0.95; });
  return <lineSegments geometry={geom} material={mat} frustumCulled={false} />;
};

/** Atmosphere: dust in the air above Maharashtra, for depth. Decoration only. */
const Atmosphere: React.FC<{ c: Ctx }> = ({ c }) => {
  const { dust, dustMat } = useMemo(() => {
    const rnd = (i: number, k: number) => Math.abs((Math.sin(i * 12.9898 + k * 78.233) * 43758.5453) % 1);
    const dn = c.q === 'high' ? 2600 : 900;
    const dp = new Float32Array(dn * 3), ds = new Float32Array(dn);
    for (let i = 0; i < dn; i++) { dp.set([-9 + rnd(i, 7) * 15, 0.1 + rnd(i, 8) * 4.5, -2 + rnd(i, 9) * 11], i * 3); ds[i] = rnd(i, 10); }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(dp, 3));
    dg.setAttribute('aSeed', new THREE.BufferAttribute(ds, 1));
    const dm = pointsMat(dustVS, pointFS, { uPx: { value: c.px }, uScale: scaleU, uAlpha: { value: 1 } });
    return { dust: dg, dustMat: dm };
  }, [c.q, c.px]);
  useFrame(() => {
    const ph = live.ph;
    dustMat.uniforms.uAlpha.value = 0.6 + 0.4 * Math.max(ph.spikes, ph.ops);
  });
  return <points geometry={dust} material={dustMat} frustumCulled={false} />;
};

// ---------------------------------------------------------------------------- film pipeline
/** Last pass: speed (zoom) blur, lens fringing toward the edges, a gentle filmic grade, vignette and moving grain. */
const CinemaShader = {
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 }, uZoom: { value: 0 }, uAberr: { value: 0.004 },
    uGrain: { value: 0.03 }, uVignette: { value: 0.32 }, uRes: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime, uZoom, uAberr, uGrain, uVignette; uniform vec2 uRes; varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    vec3 samp(vec2 uv, vec2 d) {
      float k = uAberr * dot(d, d) * 4.0;
      return vec3(texture2D(tDiffuse, uv + d * k).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - d * k).b);
    }
    void main() {
      vec2 d = vUv - 0.5;
      vec3 col;
      if (uZoom > 0.0005) {
        col = vec3(0.0);
        for (int i = 0; i < 8; i++) { float t = float(i) / 7.0; col += samp(0.5 + d * (1.0 - uZoom * t), d); }
        col /= 8.0;
      } else col = samp(vUv, d);
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, col * col * (3.0 - 2.0 * col), 0.16);
      col += vec3(-0.01, 0.0, 0.016) * (1.0 - l) + vec3(0.018, 0.008, -0.01) * l;
      float v = smoothstep(0.95, 0.25, length(d * vec2(uRes.x / uRes.y, 1.0) * 0.75));
      col *= mix(1.0, v, uVignette);
      col += (hash(vUv * uRes + fract(uTime * 7.0) * 100.0) - 0.5) * uGrain;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

const Film: React.FC = () => {
  const { gl, scene, camera, size } = useThree();
  const { composer, tiltH, tiltV, cine } = useMemo(() => {
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 2 });
    const composer = new EffectComposer(gl, rt);
    composer.addPass(new RenderPass(scene, camera));
    const tiltH = new ShaderPass(HorizontalTiltShiftShader), tiltV = new ShaderPass(VerticalTiltShiftShader);
    tiltH.uniforms.r.value = 0.5; tiltV.uniforms.r.value = 0.5;
    composer.addPass(tiltH); composer.addPass(tiltV);
    composer.addPass(new OutputPass());
    const cine = new ShaderPass(CinemaShader);
    composer.addPass(cine);
    return { composer, tiltH, tiltV, cine };
  }, [gl, scene, camera]);
  useEffect(() => {
    composer.setPixelRatio(gl.getPixelRatio());
    composer.setSize(size.width, size.height);
    (cine.uniforms.uRes.value as THREE.Vector2).set(size.width, size.height);
  }, [composer, cine, size, gl]);
  useEffect(() => () => composer.dispose(), [composer]);
  // if this device cannot hold ~45 fps with the film pipeline, drop it and render the scene directly
  const perf = useMemo(() => ({ n: 0, sum: 0, off: false }), []);
  useFrame((_, dt) => {
    if (perf.off) { gl.render(scene, camera); return; }
    if (perf.n < 240) { perf.n++; if (perf.n > 60) perf.sum += dt; if (perf.n === 240 && perf.sum / 180 > 1 / 45) { perf.off = true; live.lowPower = true; console.info('Landing: film effects off for smoothness'); } }
    const ph = live.ph, reduce = clock.reduce;
    // tilt-shift: close to the ground the world reads as a miniature; from altitude only a whisper of it
    const tilt = reduce ? 0.6 : 1.1 + 2.8 * Math.max(ph.spikes, ph.ops, ph.focus * 0.7);
    const blur = 0.45 + (tilt - 0.45) * smooth((live.dist - 0.02) / 0.4);   // drone and street shots stay optically real
    tiltH.uniforms.h.value = blur / size.width;
    tiltV.uniforms.v.value = blur / size.height;
    cine.uniforms.uTime.value += dt;
    cine.uniforms.uZoom.value = reduce ? 0 : Math.min(0.03, live.speed * 0.0011);
    cine.uniforms.uAberr.value = 0.003 + (reduce ? 0 : Math.min(0.008, live.speed * 0.0003));
    composer.render(dt);
  }, 1);
  return null;
};

/** Compile every shader and upload every texture once, while the page fades in, so nothing stalls the first time it
 *  comes into view mid-flight (the columns, the village, the clouds each cost 150-650 ms to compile on first sight). */
const Prewarm: React.FC = () => {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    const hidden: THREE.Object3D[] = [], culled: THREE.Object3D[] = [];
    scene.traverse(o => { if (!o.visible) { hidden.push(o); o.visible = true; } if (o.frustumCulled) { culled.push(o); o.frustumCulled = false; } });
    const rt = new THREE.WebGLRenderTarget(8, 8);
    try {
      gl.compile(scene, camera);
      // one tiny off-screen frame with nothing culled also builds the shadow-pass (depth) programs and buffers
      const prev = gl.getRenderTarget(), auto = gl.shadowMap.autoUpdate;
      gl.shadowMap.needsUpdate = true;
      gl.setRenderTarget(rt); gl.render(scene, camera); gl.setRenderTarget(prev);
      gl.shadowMap.autoUpdate = auto;
      scene.traverse(o => {
        const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        for (const mm of m ? (Array.isArray(m) ? m : [m]) : []) for (const v of Object.values(mm as unknown as Record<string, unknown>)) if (v instanceof THREE.Texture) gl.initTexture(v);
      });
    } finally { for (const o of hidden) o.visible = false; for (const o of culled) o.frustumCulled = true; rt.dispose(); }
  }, [gl, scene, camera]);
  return null;
};

/** Dynamic resolution: holds the frame rate on any machine by trading pixels, never by dropping the story. */
const Adaptive: React.FC<{ max: number }> = ({ max }) => {
  const { setDpr } = useThree();
  const st = useMemo(() => ({ acc: 0, n: 0, dpr: Math.min(window.devicePixelRatio || 1, max), cool: 0 }), [max]);
  useFrame((_, dt) => {
    st.acc += Math.min(dt, 0.2); st.n++;
    if (st.acc < 1.2) return;
    const fps = st.n / st.acc; st.acc = 0; st.n = 0;
    if (st.cool > 0) { st.cool--; return; }
    const floor = 0.6, top = Math.min(window.devicePixelRatio || 1, max);
    let next = st.dpr;
    if (fps < 42 && st.dpr > floor) next = Math.max(floor, st.dpr * 0.82);
    else if (fps > 57 && st.dpr < top) next = Math.min(top, st.dpr * 1.1);
    if (Math.abs(next - st.dpr) > 0.01) { st.dpr = next; setDpr(next); st.cool = 1; live.lowPower = next < 0.85; }
  });
  return null;
};

// ---------------------------------------------------------------------------- light, camera, anchors
const Sun: React.FC<{ q: Quality }> = ({ q }) => {
  const light = useRef<THREE.DirectionalLight>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  useEffect(() => {
    const l = light.current;
    if (!l) return;
    l.shadow.bias = -0.0004; l.shadow.normalBias = 0.02;
  }, [q]);
  useFrame(({ camera }) => {
    // the sun follows the camera's target so shadows stay crisp from country scale down to one village
    const l = light.current;
    if (!l) return;
    const t = rigTarget, dist = camera.position.distanceTo(t);
    const half = dist < 0.05 ? dist * 1.15 + 2 / M : dist * 0.95 + 1;
    // the sun sits a scale-proportional distance up its own direction, so the shadow frustum fits every shot
    const D = half * 4;
    l.position.copy(t).addScaledVector(sunDir, D);
    l.target.position.copy(t);
    l.target.updateMatrixWorld();
    // a stronger, warmer sun near the ground: real daylight contrast instead of the map's soft studio light
    const g = 1 - smooth((dist - 0.01) / 0.2);
    l.intensity = 1.7 + 1.1 * g; if (hemi.current) hemi.current.intensity = 1.15 - 0.45 * g;
    const cam = l.shadow.camera;
    if (Math.abs(cam.right - half) > half * 0.01) {
      cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half; cam.near = D * 0.2; cam.far = D * 2;
      cam.updateProjectionMatrix();
      l.shadow.normalBias = half * 0.003;
    }
  });
  return (
    <>
      <hemisphereLight ref={hemi} args={['#ffffff', '#a9bcc4', 1.15]} />
      <directionalLight ref={light} intensity={1.7} color="#fff3e2" castShadow={q === 'high' && !DEBUG.has('noshadow')}
        shadow-mapSize-width={2048} shadow-mapSize-height={2048} />
    </>
  );
};
const rigTarget = new THREE.Vector3();
const sunDir = SUN_OFFSET.clone().normalize();

const Rig: React.FC<{ c: Ctx; anchors: React.MutableRefObject<Anchors>; onChapterFrame?: (p: number) => void }> = ({ c, anchors, onChapterFrame }) => {
  const { camera, size, scene } = useThree();
  const cam = camera as THREE.PerspectiveCamera;
  const portrait = size.height > size.width * 1.1;
  const keys = useMemo(() => cameraKeys(c.focus.place, c.hub, portrait), [c, portrait]);
  const s = useMemo(() => ({ pos: [0, 0, 0] as [number, number, number], target: [0, 0, 0] as [number, number, number], fov: 38 }), []);
  const v = useMemo(() => ({ look: new THREE.Vector3(), w: new THREE.Vector3(), par: new THREE.Vector2(), prev: new THREE.Vector3(), right: new THREE.Vector3(), roll: 0, kick: 0, init: false }), []);
  const anchorPts = useMemo(() => {
    const byKey = new Map(c.geo.districts.map(d => [d.key, d]));
    const out: Record<string, THREE.Vector3> = { focus: new THREE.Vector3(c.focus.place.x, 0.62, c.focus.place.z) };
    c.s.rainfall.slice(0, 3).forEach((r, i) => {
      const d = byKey.get(plain(r.district));
      if (d) { const [x, z] = project(d.c[0], d.c[1]); out[`d${i}`] = new THREE.Vector3(x, 0.05, z); }
    });
    return out;
  }, [c]);
  const truckPos = useMemo(() => new THREE.Vector3(), []);
  const gv = useMemo(() => ({ mp: new THREE.Vector3(), mt: new THREE.Vector3(), gp: new THREE.Vector3(), gt: new THREE.Vector3() }), []);
  const placed = useMemo<[number, number][]>(() => [], []);

  useFrame((st, dt) => {
    dt = Math.min(dt, 0.1);
    // the story clock follows the scrollbar on a critically damped spring (short and direct with reduced motion)
    stepClock(dt);
    live.ph = phases(clock.p);
    if (!clock.reduce) shared.uTime.value += dt;
    onChapterFrame?.(clock.p);

    sampleKeys(keys, base(clock.p), s);
    gv.mp.set(s.pos[0], s.pos[1], s.pos[2]); gv.mt.set(s.target[0], s.target[1], s.target[2]);
    if (groundCamera(clock.p, gv.mp, gv.mt, gv.gp, gv.gt)) {
      const w = live.ph.descend * (1 - live.ph.ascend);
      s.pos[0] = gv.gp.x; s.pos[1] = gv.gp.y; s.pos[2] = gv.gp.z;
      s.target[0] = gv.gt.x; s.target[1] = gv.gt.y; s.target[2] = gv.gt.z;
      s.fov += (44 - s.fov) * w;
    }
    rigTarget.set(s.target[0], s.target[1], s.target[2]);
    const dist = Math.hypot(s.pos[0] - s.target[0], s.pos[1] - s.target[1], s.pos[2] - s.target[2]);
    live.dist = dist;
    // map overlays (country-scale models: a 'tanker' there is 13 km long) leave as the dive to the ground begins
    const ph0 = live.ph;
    const groundFade = ph0.inGround ? Math.max(1 - smooth(ph0.descend / 0.3), smooth((ph0.ascend - 0.7) / 0.3)) : 1;
    live.fade = Math.min(smooth((dist - 0.05) / 0.45), groundFade);
    shared.uFade.value = live.fade;
    const t = st.clock.elapsedTime;
    v.par.lerp(new THREE.Vector2(clock.pointerX, clock.pointerY), clock.reduce ? 1 : 0.04);
    const par = clock.reduce ? 0 : dist * 0.03;
    // flight feel: a hand-held drift that grows with speed
    const shake = clock.reduce ? 0 : dist * (0.0018 + Math.min(0.006, live.speed * 0.00025));
    cam.position.set(
      s.pos[0] + v.par.x * par + Math.sin(t * 0.9) * shake + Math.sin(t * 2.3) * shake * 0.35,
      s.pos[1] - v.par.y * par * 0.5 + Math.sin(t * 1.3 + 1) * shake * 0.6,
      s.pos[2] + Math.cos(t * 0.7) * shake);
    if (!v.init) { v.prev.copy(cam.position); v.init = true; }
    // speed: widens the lens; sideways speed banks the camera into the turn
    const vel = v.w.copy(cam.position).sub(v.prev).divideScalar(Math.max(dt, 1e-3));
    v.prev.copy(cam.position);
    const speed = vel.length();
    live.speed += (speed - live.speed) * (1 - Math.exp(-dt * 4));
    v.look.copy(rigTarget);
    cam.lookAt(v.look);
    v.right.setFromMatrixColumn(cam.matrixWorld, 0);
    const lateral = clock.reduce ? 0 : THREE.MathUtils.clamp(-vel.dot(v.right) * 0.004, -0.09, 0.09);
    v.roll += (lateral - v.roll) * (1 - Math.exp(-dt * 3));
    cam.rotateZ(v.roll);
    const kick = clock.reduce ? 0 : Math.min(9, live.speed * 0.32);
    v.kick += (kick - v.kick) * (1 - Math.exp(-dt * 3));
    const fov = s.fov + v.kick;
    // clip planes and haze follow the scale of the shot: a subcontinent, a district, a road, a person
    const near = THREE.MathUtils.clamp(dist * 0.004, 3e-7, 0.05), far = THREE.MathUtils.clamp(dist * 600, 0.09, 220);
    if (Math.abs(cam.fov - fov) > 0.01 || Math.abs(cam.near - near) > near * 0.05 || Math.abs(cam.far - far) > far * 0.05) {
      cam.fov = fov; cam.near = near; cam.far = far; cam.updateProjectionMatrix();
    }
    if (scene.fog instanceof THREE.Fog) { scene.fog.far = THREE.MathUtils.clamp(dist * 12, 0.035, 105); scene.fog.near = scene.fog.far * (dist < 0.5 ? 0.28 : 0.3); }
    scaleU.value = size.height / (2 * Math.tan((cam.fov * Math.PI) / 360));

    // anchored labels: project world points to the screen and move the DOM labels there; later labels give way
    placed.length = 0;
    const ph = live.ph;
    const run = c.run, i = Math.min(run.length - 1, Math.floor(ph.tanker * (run.length - 1)));
    truckPos.copy(run[i]).setY(0.1);
    const place = (key: string, p: THREE.Vector3 | undefined, alpha: number) => {
      const el = anchors.current[key];
      if (!el || !p) return;
      v.w.copy(p).project(cam);
      const behind = v.w.z > 1;
      const x = (v.w.x * 0.5 + 0.5) * size.width, y = (-v.w.y * 0.5 + 0.5) * size.height;
      const clash = alpha > 0.01 && placed.some(q => Math.abs(q[0] - x) < 120 && Math.abs(q[1] - y) < 44);
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      el.style.opacity = behind || clash ? '0' : alpha.toFixed(3);
      el.style.visibility = alpha < 0.01 || behind || clash ? 'hidden' : 'visible';
      if (alpha > 0.01 && !behind && !clash) placed.push([x, y]);
    };
    const photoOn = band(clock.p, PHOTO.in0 - 0.004, PHOTO.in0, PHOTO.out1, PHOTO.out1 + 0.006);
    const groundLabel = ph.inGround * clamp01((700 - dist * M) / 350) * (1 - ph.ascend) * (1 - photoOn);
    place('gtruck', live.tankerWorld, groundLabel);
    place('focus', anchorPts.focus, Math.max(ph.focus * (1 - ph.ops), 0) * live.fade);
    place('truck', truckPos, ph.ops * live.fade);
    place('d0', anchorPts.d0, ph.disaster);
    place('d1', anchorPts.d1, ph.disaster * clamp01((ph.disaster - 0.3) / 0.7));
    place('d2', anchorPts.d2, ph.disaster * clamp01((ph.disaster - 0.5) / 0.5));
  });
  return null;
};
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

// ---------------------------------------------------------------------------- scene root
export interface WorldProps {
  geo: GeoFile; summary: PublicSummary; quality: Quality;
  anchors: React.MutableRefObject<Anchors>;
  onHover: (p: Place | null, x: number, y: number) => void;
  onReady?: (info: { focusName: string | null; focusDistrict: string | null; focusCrisis: number; focusPop: number }) => void;
  onFrame?: (p: number) => void;
}

function buildRun(focus: Place, places: Place[]): { hub: Place; run: THREE.Vector3[] } {
  // start from the nearest sizeable town at a believable distance; the road wiggles a little
  const towns = places.filter(p => p.pop > 40000 && p !== focus).map(p => ({ p, d: Math.hypot(p.x - focus.x, p.z - focus.z) })).filter(o => o.d > 0.45 && o.d < 2.2);
  const hub = (towns.sort((a, b) => a.d - b.d)[0]?.p) ?? places.reduce((a, b) => (b.pop > a.pop ? b : a));
  const n = 140, run: THREE.Vector3[] = [];
  const dx = focus.x - hub.x, dz = focus.z - hub.z, len = Math.hypot(dx, dz), nx = -dz / len, nz = dx / len;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const bend = Math.sin(t * Math.PI) * 0.18 * len + Math.sin(t * 17.0) * 0.012 + Math.sin(t * 41.0) * 0.005;
    run.push(new THREE.Vector3(hub.x + dx * t + nx * bend, HOME_TOP + 0.012, hub.z + dz * t + nz * bend));
  }
  return { hub, run };
}

const SceneRoot: React.FC<WorldProps & { px: number }> = ({ geo, summary, quality, anchors, onHover, onReady, onFrame, px }) => {
  const ctx = useMemo<Ctx>(() => {
    const places = toPlaces(summary);
    const focus = focusPlace(summary, places, geo);
    const { hub, run } = buildRun(focus.place, places);
    return { geo, places, focus, s: summary, q: quality, px, run, hub };
  }, [geo, summary, quality, px]);
  const overlay = useRef<THREE.Group>(null);
  const three = useThree();
  useEffect(() => { if (DEBUG.has('expose')) Object.assign(window as unknown as Record<string, unknown>, { __three: three, __clock: clock }); }, [three]);
  useFrame(() => { if (overlay.current) overlay.current.visible = live.fade > 0.01; });
  useEffect(() => { setGroundReduce(clock.reduce); }, []);
  useEffect(() => { onReady?.({ focusName: ctx.focus.name, focusDistrict: ctx.focus.district, focusCrisis: ctx.focus.place.crisis, focusPop: ctx.focus.place.pop }); }, [ctx, onReady]);
  return (
    <>
      <color attach="background" args={[C.haze]} />
      <fog attach="fog" args={[C.haze, 30, 105]} />
      <Sun q={quality} />
      <Earth c={ctx} />
      {!DEBUG.has('nosky') && <SkyDome haze={C.haze} />}
      <group ref={overlay}>
        <Terrain c={ctx} />
        <Lines c={ctx} />
        <Deficit c={ctx} />
        <Flows c={ctx} />
        <National c={ctx} />
        <Places c={ctx} onHover={onHover} />
        <Spikes c={ctx} />
        <Focus c={ctx} />
        <Run c={ctx} />
        <Atmosphere c={ctx} />
      </group>
      <Suspense fallback={null}>
        {!DEBUG.has('noground') && <Ground q={quality} haze={C.haze} />}
        {!DEBUG.has('noclouds') && <Clouds q={quality} haze={C.haze} />}
        <Prewarm />
      </Suspense>
      <Rig c={ctx} anchors={anchors} onChapterFrame={onFrame} />
      {quality === 'high' && !DEBUG.has('nofilm') && <Film />}
      {!DEBUG.has('fixeddpr') && <Adaptive max={quality === 'high' ? 1.5 : 1.25} />}
    </>
  );
};

function World(props: WorldProps) {
  const dpr: [number, number] = props.quality === 'high' ? [1, 1.5] : [1, 1.25];
  const px = Math.min(window.devicePixelRatio || 1, dpr[1]);
  return (
    <Canvas dpr={dpr} shadows={props.quality === 'high' ? 'soft' : false}
      gl={{ antialias: props.quality === 'high', powerPreference: 'high-performance', alpha: false }}
      onCreated={({ gl }) => { gl.toneMapping = THREE.ACESFilmicToneMapping; gl.toneMappingExposure = 1.12; }}
      camera={{ fov: 36, near: 0.05, far: 220, position: [0, 36, 23] }}
      raycaster={{ params: { Points: { threshold: 0.06 } } as THREE.RaycasterParameters }}
      onPointerMove={e => { clock.pointerX = (e.clientX / window.innerWidth) * 2 - 1; clock.pointerY = (e.clientY / window.innerHeight) * 2 - 1; }}>
      <SceneRoot {...props} px={px} />
    </Canvas>
  );
}

// The page re-renders on chapter changes; the world never needs to.
export default React.memo(World);
