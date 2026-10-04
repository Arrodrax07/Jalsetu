/**
 * The landing world: one WebGL scene whose state is a function of the story clock (story.ts).
 *
 * Real: place positions, crisis scores and populations (/api/public/summary), district rainfall deficits (ERA5, same
 * endpoint), state and district outlines (geoBoundaries, /landing/geo.json).
 * Illustrative (and labelled so on the page): supply arcs and flow particles, the tanker run, the national arcs.
 *
 * Every moving thing is a shader uniform or a small per-frame matrix update; nothing here re-renders React on scroll.
 */
import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import type { PublicSummary } from '../../types';
import { deficitRings, dotField, focusPlace, inAny, project, ringSegments, supplyArcs, toPlaces, type GeoFile, type Place, plain } from './geo';
import { cameraKeys, clock, phases, sampleKeys, type Phases } from './story';

export type Quality = 'high' | 'low';
export type Anchors = Record<string, HTMLElement | null>;

const C = {
  bg: new THREE.Color('#04080c'),
  dot: new THREE.Color('#25394a'),
  dotHome: new THREE.Color('#42687e'),
  water: new THREE.Color('#6cc3d5'),
  waterDeep: new THREE.Color('#2f7f95'),
  amber: new THREE.Color('#d8953f'),
  rust: new THREE.Color('#df5a3b'),
  chaos: new THREE.Color('#8a5a48'),
  line: new THREE.Color('#284050'),
  lineHome: new THREE.Color('#7fb2c3'),
};

const shared = { uTime: { value: 0 } };
/** Pixels per world unit at distance 1 (viewport height / (2 tan(fov/2))); point sizes are set in world units. */
const scaleU = { value: 1000 };

// ---------------------------------------------------------------------------- shaders
const DISC = /* glsl */ `
  float disc() { vec2 c = gl_PointCoord - 0.5; float d = dot(c, c); return smoothstep(0.25, 0.05, d); }
`;

const terrainVS = /* glsl */ `
  uniform float uTime, uSweep, uHome, uPx, uCalm, uScale;
  attribute float aSeed, aHome;
  varying float vA; varying vec3 vC;
  uniform vec3 uDot, uDotHome, uWater;
  void main() {
    vec3 p = position;
    float w = sin(p.x * 0.55 + uTime * 0.35 + aSeed * 2.0) * 0.5 + sin(p.z * 0.7 - uTime * 0.27) * 0.5;
    p.y += w * 0.05 * (1.0 - uCalm * 0.6);
    // the coordination sweep: a band of light that crosses the country west to east
    float sx = mix(-11.0, 18.0, uSweep);
    float band = uSweep > 0.0 && uSweep < 1.0 ? exp(-pow((p.x - sx) * 0.42, 2.0)) : 0.0;
    // a slow current of light drifting south-east across the country (atmosphere, not data)
    float cur = pow(0.5 + 0.5 * sin(p.x * 0.42 - p.z * 0.31 - uTime * 0.55 + sin(p.z * 0.6 + uTime * 0.2) * 1.4), 6.0);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float depth = -mv.z;
    gl_PointSize = clamp(uPx * (0.05 + aSeed * 0.025) * uScale / depth * (1.0 + band * 0.15), 1.9 * uPx, 7.0 * uPx);
    vC = mix(uDot, uDotHome, aHome * uHome) + uWater * (band * 0.3 + cur * 0.5 * (1.0 - uCalm * 0.5));
    vC *= 1.0 + smoothstep(14.0, 36.0, depth) * 0.9; // far away the dots are small: lift them so the country reads
    vA = (0.6 + 0.4 * aSeed) * smoothstep(120.0, 40.0, depth) * smoothstep(0.4, 2.0, depth);
  }
`;
const terrainFS = /* glsl */ `
  varying float vA; varying vec3 vC;
  ${DISC}
  void main() { float a = disc() * vA; if (a < 0.02) discard; gl_FragColor = vec4(vC, a); }
`;

const placesVS = /* glsl */ `
  uniform float uTime, uAlpha, uChaos, uPx, uScale;
  attribute float aCrisis, aPop, aSeed;
  varying float vA; varying vec3 vC;
  uniform vec3 uCool, uAmber, uRust;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float size = 0.012 + log(max(aPop, 100.0)) * 0.0042 + aCrisis * 0.00022;
    float flick = mix(1.0, 0.35 + 0.65 * step(0.5, fract(aSeed * 13.0 + uTime * (0.6 + aSeed))), uChaos * step(40.0, aCrisis));
    gl_PointSize = clamp(uPx * size * uScale / -mv.z, 1.5, 9.0 * uPx);
    vC = aCrisis >= 70.0 ? uRust : aCrisis >= 40.0 ? uAmber : uCool;
    vA = uAlpha * flick * (aCrisis >= 40.0 ? 1.0 : 0.55) * smoothstep(95.0, 20.0, -mv.z);
  }
`;
const placesFS = /* glsl */ `
  varying float vA; varying vec3 vC;
  ${DISC}
  void main() { float a = disc() * vA; if (a < 0.02) discard; gl_FragColor = vec4(vC, a); }
`;

/** Flow particles travel along a quadratic arc A→B. With uChaos they wander, scatter and lose their colour. */
const flowVS = /* glsl */ `
  uniform float uTime, uChaos, uAlpha, uPx, uDim, uScale, uHot;
  uniform vec3 uWater, uChaosC, uFocus;
  attribute vec4 aAB; attribute vec4 aMeta; // ax az bx bz | lift seed speed hot
  varying float vA; varying vec3 vC;
  void main() {
    float t = fract(aMeta.y + uTime * aMeta.z);
    vec3 A = vec3(aAB.x, 0.0, aAB.y), B = vec3(aAB.z, 0.0, aAB.w);
    vec3 M = (A + B) * 0.5 + vec3(0.0, aMeta.x, 0.0);
    vec3 ordered = mix(mix(A, M, t), mix(M, B, t), t);
    float s = aMeta.y * 31.0;
    // chaos: scattered over the region, drifting, unrelated to where the water is needed
    vec3 wander = (A + B) * 0.5 + vec3(sin(s * 1.7) * 2.6 + sin(t * 4.1 + s) * 0.9 + sin(uTime * 0.35 + s) * 0.5,
      0.04 + abs(sin(t * 3.0 + s)) * 0.3, cos(s * 2.3) * 2.2 + cos(t * 3.3 + s * 1.3) * 0.9);
    vec3 p = mix(ordered, wander, uChaos);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(uPx * (0.016 + aMeta.z * 0.2) * uScale / -mv.z, 1.0, 4.5 * uPx);
    float ends = sin(3.14159 * t);
    float hot = mix(1.0, aMeta.w > 0.5 ? 1.7 : 0.22, uHot);
    vC = mix(uWater, uChaosC, uChaos);
    vA = uAlpha * ends * hot * (1.0 - 0.82 * uDim) * mix(0.7, 0.4, uChaos) * smoothstep(110.0, 6.0, -mv.z);
  }
`;
const flowFS = placesFS;

/** Arc lines: fragment shader breaks them apart while the network is in chaos. */
const arcVS = /* glsl */ `
  attribute float aSeg, aT;
  varying float vSeg, vT; varying float vDepth;
  void main() { vSeg = aSeg; vT = aT; vec4 mv = modelViewMatrix * vec4(position, 1.0); vDepth = -mv.z; gl_Position = projectionMatrix * mv; }
`;
const arcFS = /* glsl */ `
  uniform float uChaos, uAlpha, uTime; uniform vec3 uColor, uChaosC;
  varying float vSeg, vT; varying float vDepth;
  void main() {
    if (vSeg < uChaos * 0.8) discard;
    float pulse = 0.35 + 0.65 * smoothstep(0.1, 0.0, abs(fract(vT - uTime * 0.12) - 0.5) - 0.38);
    vec3 c = mix(uColor, uChaosC, uChaos);
    gl_FragColor = vec4(c, uAlpha * pulse * (1.0 - 0.5 * uChaos) * smoothstep(95.0, 15.0, vDepth));
  }
`;

const spikeVS = /* glsl */ `
  uniform float uGrow, uTime; attribute float aCrisis, aFocus;
  uniform vec3 uAmber, uRust, uWater;
  varying vec3 vC; varying float vA, vY;
  void main() {
    vec3 p = position; p.y = (p.y + 0.5) * uGrow; vY = p.y + 0.5;
    vec4 mv = modelViewMatrix * instanceMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    vC = aFocus > 0.5 ? uWater : (aCrisis >= 70.0 ? uRust : uAmber);
    vA = (aFocus > 0.5 ? 0.95 : 0.55) * uGrow;
  }
`;
const spikeFS = /* glsl */ `
  varying vec3 vC; varying float vA, vY;
  void main() { gl_FragColor = vec4(vC * (0.55 + 0.6 * vY), vA * (0.35 + 0.65 * vY)); }
`;

const fillFS = /* glsl */ `
  uniform float uAlpha, uTime; uniform vec3 uColor; varying vec2 vXZ; uniform vec2 uCentre;
  void main() {
    float r = distance(vXZ, uCentre);
    float ring = 0.5 + 0.5 * sin(r * 9.0 - uTime * 1.6);
    gl_FragColor = vec4(uColor, uAlpha * (0.45 + 0.35 * ring));
  }
`;
const fillVS = /* glsl */ `
  varying vec2 vXZ;
  void main() { vec4 w = modelMatrix * vec4(position, 1.0); vXZ = w.xz; gl_Position = projectionMatrix * viewMatrix * w; }
`;

const pointsMat = (vs: string, fs: string, uniforms: Record<string, THREE.IUniform>) =>
  new THREE.ShaderMaterial({ vertexShader: vs, fragmentShader: fs, uniforms: { ...uniforms, uTime: shared.uTime }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });

// ---------------------------------------------------------------------------- layers
interface Ctx { geo: GeoFile; places: Place[]; focus: { place: Place; name: string | null; district: string | null }; s: PublicSummary; q: Quality; px: number; run: THREE.Vector3[]; hub: Place }
const live: { ph: Phases } = { ph: phases(0) };

const Terrain: React.FC<{ c: Ctx }> = ({ c }) => {
  const { geo, q, px } = c;
  const { geom, mat } = useMemo(() => {
    const f = dotField(geo, q === 'high' ? 0.15 : 0.27);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(f.pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(f.seed, 1));
    g.setAttribute('aHome', new THREE.BufferAttribute(f.home, 1));
    const m = pointsMat(terrainVS, terrainFS, { uSweep: { value: 0 }, uHome: { value: 0 }, uPx: { value: px }, uCalm: { value: 0 }, uScale: scaleU,
      uDot: { value: C.dot }, uDotHome: { value: C.dotHome }, uWater: { value: C.water } });
    m.blending = THREE.NormalBlending;
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
  const { states, home, districts, dMat } = useMemo(() => {
    const mk = (arr: Float32Array) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(arr, 3)); return g; };
    const other = c.geo.states.filter(s => s.name !== c.geo.maharashtra).flatMap(s => s.rings);
    const mh = c.geo.states.find(s => s.name === c.geo.maharashtra)?.rings ?? [];
    return {
      states: mk(ringSegments(other, 0.01)),
      home: mk(ringSegments(mh, 0.012)),
      districts: mk(ringSegments(c.geo.districts.flatMap(d => d.rings), 0.008)),
      dMat: new THREE.LineBasicMaterial({ color: C.line, transparent: true, opacity: 0 }),
    };
  }, [c.geo]);
  const homeMat = useMemo(() => new THREE.LineBasicMaterial({ color: C.lineHome, transparent: true, opacity: 0.5 }), []);
  useFrame(() => {
    const ph = live.ph;
    dMat.opacity = 0.75 * ph.districts;
    homeMat.opacity = 0.35 + 0.5 * Math.max(ph.places, ph.districts) * (1 - 0.4 * ph.national);
  });
  return (
    <group>
      <lineSegments geometry={states}><lineBasicMaterial color={C.line} transparent opacity={0.85} /></lineSegments>
      <lineSegments geometry={home} material={homeMat} />
      <lineSegments geometry={districts} material={dMat} />
    </group>
  );
};

const Places: React.FC<{ c: Ctx; onHover: (p: Place | null, x: number, y: number) => void }> = ({ c, onHover }) => {
  const { geom, mat } = useMemo(() => {
    const n = c.places.length;
    const pos = new Float32Array(n * 3), cr = new Float32Array(n), pop = new Float32Array(n), seed = new Float32Array(n);
    c.places.forEach((p, i) => { pos[i * 3] = p.x; pos[i * 3 + 1] = 0.03; pos[i * 3 + 2] = p.z; cr[i] = p.crisis; pop[i] = p.pop; seed[i] = (Math.sin(i * 12.9898) * 43758.5453) % 1; });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aCrisis', new THREE.BufferAttribute(cr, 1));
    g.setAttribute('aPop', new THREE.BufferAttribute(pop, 1));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed.map(Math.abs), 1));
    g.computeBoundingSphere();
    const m = pointsMat(placesVS, placesFS, { uAlpha: { value: 0 }, uChaos: { value: 0 }, uPx: { value: c.px }, uScale: scaleU, uCool: { value: C.waterDeep }, uAmber: { value: C.amber }, uRust: { value: C.rust } });
    m.blending = THREE.NormalBlending; // dense districts (Nagpur has ~700 places) would otherwise add up to a glow
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
    const m = pointsMat(flowVS, flowFS, { uChaos: { value: 0 }, uAlpha: { value: 0 }, uPx: { value: c.px }, uDim: { value: 0 }, uScale: scaleU, uHot: { value: 0 },
      uWater: { value: C.water }, uChaosC: { value: C.chaos }, uFocus: { value: new THREE.Vector3(c.focus.place.x, 0, c.focus.place.z) } });
    // arc lines
    const SEG = 22;
    const lp = new Float32Array(arcs.length * SEG * 6), ls = new Float32Array(arcs.length * SEG * 2), lt = new Float32Array(arcs.length * SEG * 2);
    arcs.forEach((a, i) => {
      const lift = 0.12 + Math.hypot(a.a.x - a.b.x, a.a.z - a.b.z) * 0.22;
      const at = (t: number) => {
        const mx = (a.a.x + a.b.x) / 2, mz = (a.a.z + a.b.z) / 2;
        const u = 1 - t;
        return [u * u * a.a.x + 2 * u * t * mx + t * t * a.b.x, 2 * u * t * lift, u * u * a.a.z + 2 * u * t * mz + t * t * a.b.z];
      };
      for (let k = 0; k < SEG; k++) {
        const o = (i * SEG + k);
        lp.set([...at(k / SEG), ...at((k + 1) / SEG)], o * 6);
        const h = Math.abs(Math.sin(o * 91.7 + i)) % 1;
        ls.set([h, h], o * 2); lt.set([k / SEG, (k + 1) / SEG], o * 2);
      }
    });
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(lp, 3));
    lg.setAttribute('aSeg', new THREE.BufferAttribute(ls, 1));
    lg.setAttribute('aT', new THREE.BufferAttribute(lt, 1));
    const lm = new THREE.ShaderMaterial({ vertexShader: arcVS, fragmentShader: arcFS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uChaos: { value: 0 }, uAlpha: { value: 0 }, uTime: shared.uTime, uColor: { value: C.waterDeep }, uChaosC: { value: C.chaos } } });
    return { geom: g, mat: m, arcGeom: lg, arcMat: lm };
  }, [c]);
  useFrame(() => {
    const ph = live.ph;
    mat.uniforms.uChaos.value = ph.chaos;
    mat.uniforms.uAlpha.value = 1 - 0.6 * ph.national;
    mat.uniforms.uDim.value = Math.max(ph.spikes * 0.7, ph.ops);
    mat.uniforms.uHot.value = ph.disaster;
    arcMat.uniforms.uChaos.value = ph.chaos;
    arcMat.uniforms.uAlpha.value = 0.5 * ph.routes * (1 - 0.75 * Math.max(ph.spikes, ph.ops)) * (1 - 0.5 * ph.national) * (1 - 0.5 * ph.disaster);
  });
  return <group><lineSegments geometry={arcGeom} material={arcMat} frustumCulled={false} /><points geometry={geom} material={mat} frustumCulled={false} /></group>;
};

const Spikes: React.FC<{ c: Ctx }> = ({ c }) => {
  const { mesh } = useMemo(() => {
    const list = c.places.filter(p => p.crisis >= 40 || p === c.focus.place);
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const cr = new Float32Array(list.length), fo = new Float32Array(list.length);
    const mat = new THREE.ShaderMaterial({ vertexShader: spikeVS, fragmentShader: spikeFS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uGrow: { value: 0 }, uTime: shared.uTime, uAmber: { value: C.amber }, uRust: { value: C.rust }, uWater: { value: C.water } } });
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    const m = new THREE.Matrix4();
    list.forEach((p, i) => {
      const focus = p === c.focus.place;
      const h = focus ? 1.15 : 0.12 + (p.crisis / 100) * 0.55;
      const w = focus ? 0.035 : 0.014 + Math.min(0.02, Math.log10(Math.max(p.pop, 100)) * 0.003);
      m.compose(new THREE.Vector3(p.x, 0, p.z), new THREE.Quaternion(), new THREE.Vector3(w, h, w));
      mesh.setMatrixAt(i, m);
      cr[i] = p.crisis; fo[i] = focus ? 1 : 0;
    });
    geo.setAttribute('aCrisis', new THREE.InstancedBufferAttribute(cr, 1));
    geo.setAttribute('aFocus', new THREE.InstancedBufferAttribute(fo, 1));
    mesh.frustumCulled = false;
    return { mesh };
  }, [c]);
  useFrame(() => { (mesh.material as THREE.ShaderMaterial).uniforms.uGrow.value = Math.max(live.ph.spikes, live.ph.focus * 0.0001); mesh.visible = live.ph.spikes > 0.001; });
  return <primitive object={mesh} />;
};

const Focus: React.FC<{ c: Ctx }> = ({ c }) => {
  const ring = useRef<THREE.Mesh>(null);
  const fence = useRef<THREE.Mesh>(null);
  useFrame(({ clock: t }) => {
    const ph = live.ph;
    if (ring.current) {
      const s = 1 + ((t.elapsedTime * 0.6) % 1) * 2.2;
      ring.current.scale.setScalar(s * 0.09);
      (ring.current.material as THREE.MeshBasicMaterial).opacity = ph.focus * (1 - ((t.elapsedTime * 0.6) % 1)) * 0.9;
    }
    if (fence.current) {
      const arrive = ph.ops * THREE.MathUtils.smoothstep(ph.tanker, 0.72, 0.9);
      (fence.current.material as THREE.MeshBasicMaterial).opacity = ph.ops * (0.25 + 0.55 * arrive);
      fence.current.scale.setScalar(0.16 * (1 + 0.08 * Math.sin(t.elapsedTime * 3) * arrive));
    }
  });
  const { x, z } = c.focus.place;
  return (
    <group position={[x, 0.02, z]}>
      <mesh ref={ring} rotation-x={-Math.PI / 2}><ringGeometry args={[0.9, 1, 64]} /><meshBasicMaterial color={C.water} transparent opacity={0} depthWrite={false} /></mesh>
      <mesh ref={fence} rotation-x={-Math.PI / 2}><ringGeometry args={[0.96, 1, 96]} /><meshBasicMaterial color={C.water} transparent opacity={0} depthWrite={false} /></mesh>
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
    trailMat.opacity = ph.ops * 0.95;
    fixMat.opacity = ph.ops;
    if (truck.current) {
      const f = t * (total - 1) - idx;
      tmp.a.copy(c.run[idx]).lerp(c.run[idx + 1], f);
      tmp.b.copy(c.run[Math.min(total - 1, idx + 2)]);
      truck.current.position.copy(tmp.a);
      truck.current.lookAt(tmp.b.x, tmp.a.y, tmp.b.z);
      truck.current.visible = ph.ops > 0.02;
      truck.current.scale.setScalar(0.6 + 0.4 * ph.ops);
    }
  });
  return (
    <group>
      <primitive object={trailLine} />
      <points geometry={fixes} material={fixMat} />
      <group ref={truck} visible={false}>
        <mesh position={[0, 0.035, 0]}><boxGeometry args={[0.055, 0.05, 0.12]} /><meshBasicMaterial color="#e9f4f6" /></mesh>
        <mesh position={[0, 0.002, 0]} rotation-x={-Math.PI / 2}><circleGeometry args={[0.12, 40]} /><meshBasicMaterial color={C.water} transparent opacity={0.25} depthWrite={false} /></mesh>
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
      const shapes = d.rings.map(ring => new THREE.Shape(ring.map(([lng, lat]) => { const [x, z] = project(lng, lat); return new THREE.Vector2(x, -z); })));
      const g = new THREE.ShapeGeometry(shapes);
      g.rotateX(-Math.PI / 2);
      const mat = new THREE.ShaderMaterial({ vertexShader: fillVS, fragmentShader: fillFS, transparent: true, depthWrite: false, side: THREE.DoubleSide,
        uniforms: { uAlpha: { value: 0 }, uTime: shared.uTime, uColor: { value: r.severity === 'Severe' ? C.rust : C.amber }, uCentre: { value: new THREE.Vector2(cx, cz) } } });
      return { g, mat, weight: Math.min(1, Math.abs(r.deviation) / 45) };
    }).filter(Boolean) as { g: THREE.BufferGeometry; mat: THREE.ShaderMaterial; weight: number }[];
  }, [c]);
  useFrame(() => { for (const it of items) it.mat.uniforms.uAlpha.value = live.ph.disaster * 0.42 * it.weight; });
  return <group position={[0, 0.004, 0]}>{items.map((it, i) => <mesh key={i} geometry={it.g} material={it.mat} />)}</group>;
};

/** Illustration of national scale: arcs from Maharashtra to every state. */
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
      const at = (t: number) => { const u = 1 - t; const mx = (mh[0] + bx) / 2, mz = (mh[1] + bz) / 2; return [u * u * mh[0] + 2 * u * t * mx + t * t * bx, 2 * u * t * (0.6 + d * 0.18), u * u * mh[1] + 2 * u * t * mz + t * t * bz]; };
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
    const m = new THREE.ShaderMaterial({ vertexShader: arcVS, fragmentShader: arcFS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uChaos: { value: 0 }, uAlpha: { value: 0 }, uTime: shared.uTime, uColor: { value: C.water }, uChaosC: { value: C.chaos } } });
    return { geom: g, mat: m };
  }, [c.geo]);
  useFrame(() => { mat.uniforms.uAlpha.value = live.ph.national * 0.9; });
  return <lineSegments geometry={geom} material={mat} frustumCulled={false} />;
};

// ---------------------------------------------------------------------------- camera + anchors
const Rig: React.FC<{ c: Ctx; anchors: React.MutableRefObject<Anchors>; onChapterFrame?: (p: number) => void }> = ({ c, anchors, onChapterFrame }) => {
  const { camera, size } = useThree();
  const cam = camera as THREE.PerspectiveCamera;
  const portrait = size.height > size.width * 1.1;
  const keys = useMemo(() => cameraKeys(c.focus.place, c.hub, portrait), [c, portrait]);
  const s = useMemo(() => ({ pos: [0, 0, 0] as [number, number, number], target: [0, 0, 0] as [number, number, number], fov: 38 }), []);
  const v = useMemo(() => ({ look: new THREE.Vector3(), w: new THREE.Vector3(), par: new THREE.Vector2() }), []);
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
  const placed = useMemo<[number, number][]>(() => [], []);

  useFrame((_, dt) => {
    // ease the story clock toward the scrollbar; a reduced-motion visitor gets a short, direct settle
    const k = clock.reduce ? 14 : 3.2;
    clock.p += (clock.target - clock.p) * (1 - Math.exp(-Math.min(dt, 0.1) * k));
    if (Math.abs(clock.target - clock.p) < 1e-5) clock.p = clock.target;
    live.ph = phases(clock.p);
    if (!clock.reduce) shared.uTime.value += Math.min(dt, 0.1);
    onChapterFrame?.(clock.p);

    sampleKeys(keys, clock.p, s);
    const dist = Math.hypot(s.pos[0] - s.target[0], s.pos[1] - s.target[1], s.pos[2] - s.target[2]);
    // a little depth response to the pointer, proportional to how far away the camera is
    v.par.lerp(new THREE.Vector2(clock.pointerX, clock.pointerY), clock.reduce ? 1 : 0.04);
    const par = clock.reduce ? 0 : dist * 0.03;
    cam.position.set(s.pos[0] + v.par.x * par, s.pos[1] - v.par.y * par * 0.5, s.pos[2]);
    v.look.set(s.target[0], s.target[1], s.target[2]);
    cam.lookAt(v.look);
    if (Math.abs(cam.fov - s.fov) > 0.01) { cam.fov = s.fov; cam.updateProjectionMatrix(); }

    scaleU.value = size.height / (2 * Math.tan((cam.fov * Math.PI) / 360));
    // anchored labels: project world points to the screen and move the DOM labels there; later labels give way
    placed.length = 0;
    const ph = live.ph;
    const t = ph.tanker, run = c.run, i = Math.min(run.length - 1, Math.floor(t * (run.length - 1)));
    truckPos.copy(run[i]).setY(0.08);
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
    place('focus', anchorPts.focus, Math.max(ph.focus * (1 - ph.ops), 0));
    place('truck', truckPos, ph.ops);
    place('d0', anchorPts.d0, ph.disaster);
    place('d1', anchorPts.d1, ph.disaster * ramp01((ph.disaster - 0.3) / 0.7));
    place('d2', anchorPts.d2, ph.disaster * ramp01((ph.disaster - 0.5) / 0.5));
  });
  return null;
};
const ramp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

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
    run.push(new THREE.Vector3(hub.x + dx * t + nx * bend, 0.03, hub.z + dz * t + nz * bend));
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
  useEffect(() => { onReady?.({ focusName: ctx.focus.name, focusDistrict: ctx.focus.district, focusCrisis: ctx.focus.place.crisis, focusPop: ctx.focus.place.pop }); }, [ctx, onReady]);
  return (
    <>
      <color attach="background" args={[C.bg]} />
      <Terrain c={ctx} />
      <Lines c={ctx} />
      <Deficit c={ctx} />
      <Flows c={ctx} />
      <National c={ctx} />
      <Places c={ctx} onHover={onHover} />
      <Spikes c={ctx} />
      <Focus c={ctx} />
      <Run c={ctx} />
      <Rig c={ctx} anchors={anchors} onChapterFrame={onFrame} />
    </>
  );
};

export default function World(props: WorldProps) {
  const dpr: [number, number] = props.quality === 'high' ? [1, 1.75] : [1, 1.25];
  const px = Math.min(window.devicePixelRatio || 1, dpr[1]);
  return (
    <Canvas dpr={dpr} gl={{ antialias: props.quality === 'high', powerPreference: 'high-performance', alpha: false }}
      camera={{ fov: 36, near: 0.05, far: 200, position: [0, 36, 23] }}
      raycaster={{ params: { Points: { threshold: 0.06 } } as THREE.RaycasterParameters }}
      onPointerMove={e => { clock.pointerX = (e.clientX / window.innerWidth) * 2 - 1; clock.pointerY = (e.clientY / window.innerHeight) * 2 - 1; }}>
      <SceneRoot {...props} px={px} />
    </Canvas>
  );
}
