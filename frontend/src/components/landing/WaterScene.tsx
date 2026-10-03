/**
 * Hero sculpture: a glass water drop hovering over a living water surface.
 *
 * - Water: a GPU shader. Ripples spread from every impact (the drop kissing the surface, falling droplets,
 *   or the visitor clicking the water) and decay with time and distance; lit with diffuse, specular and
 *   fresnel terms, and faded at the edges into the paper background.
 * - Drop: a teardrop mesh with physical transmission (ior 1.33, like water), refracting a studio environment.
 * - Pointer tilts the drop; `progress` (0..1, page scroll) lowers the camera toward the water.
 * Lazy-loaded so the control room never pays for three.js.
 */
import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Canvas, ThreeEvent, useFrame, useThree } from '@react-three/fiber';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const MAX_RIPPLES = 8;

const vertex = /* glsl */ `
  uniform float uTime;
  uniform vec3 uRipples[${MAX_RIPPLES}]; // x, z, start time
  varying vec3 vNormalW;
  varying vec3 vWorld;
  varying float vH;

  float heightAt(vec2 p) {
    float h = 0.035 * sin(p.x * 0.55 + uTime * 0.6) + 0.025 * sin(p.y * 0.8 - uTime * 0.45) + 0.012 * sin((p.x + p.y) * 1.7 + uTime);
    for (int i = 0; i < ${MAX_RIPPLES}; i++) {
      float age = uTime - uRipples[i].z;
      if (age < 0.0 || age > 7.0) continue;
      float r = distance(p, uRipples[i].xy);
      float front = age * 2.1;
      float env = exp(-age * 0.62) * smoothstep(front + 0.5, front - 0.4, r) * exp(-r * 0.12);
      h += 0.42 * env * sin(r * 3.6 - age * 8.0);
    }
    return h;
  }

  void main() {
    vec3 p = position;
    float h = heightAt(p.xz);
    float e = 0.05;
    float hx = heightAt(p.xz + vec2(e, 0.0));
    float hz = heightAt(p.xz + vec2(0.0, e));
    vNormalW = normalize(vec3(h - hx, e, h - hz));
    p.y += h;
    vH = h;
    vec4 w = modelMatrix * vec4(p, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const fragment = /* glsl */ `
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  varying vec3 vNormalW;
  varying vec3 vWorld;
  varying float vH;

  void main() {
    vec3 n = normalize(vNormalW);
    vec3 v = normalize(cameraPosition - vWorld);
    vec3 l = normalize(vec3(-0.35, 1.0, 0.45));
    float diff = clamp(dot(n, l), 0.0, 1.0);
    vec3 hv = normalize(l + v);
    float spec = pow(max(dot(n, hv), 0.0), 120.0);
    float fres = pow(1.0 - max(dot(n, v), 0.0), 2.5);
    vec3 col = mix(uDeep, uShallow, 0.45 + 0.55 * diff);
    col = mix(col, vec3(0.96, 0.95, 0.93), 0.25 + fres * 0.5);   // reflect the paper sky
    col += spec * 0.9 + vH * 1.15;
    // soft elliptical pool that dissolves into the page
    float d = length((vWorld.xz - vec2(0.6, 0.4)) * vec2(0.62, 1.0));
    float a = smoothstep(5.2, 1.2, d) * (0.82 + 0.18 * fres);
    gl_FragColor = vec4(col, a);
  }
`;

function teardrop(): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 160, 160);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y > 0) {
      const k = 1 - Math.pow(y, 1.7) * 0.9;
      pos.setXYZ(i, pos.getX(i) * k, y * 1.6, pos.getZ(i) * k);
    }
  }
  g.computeVertexNormals();
  return g;
}

const Environment: React.FC = () => {
  const { gl, scene } = useThree();
  useEffect(() => {
    const pm = new THREE.PMREMGenerator(gl);
    const env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    return () => { scene.environment = null; env.dispose(); pm.dispose(); };
  }, [gl, scene]);
  return null;
};

const Sculpture: React.FC<{ progress: React.MutableRefObject<number>; reduce: boolean }> = ({ progress, reduce }) => {
  const drop = useRef<THREE.Mesh>(null);
  const small = useRef<THREE.Group>(null);
  const { pointer, camera } = useThree();
  const ripples = useMemo(() => Array.from({ length: MAX_RIPPLES }, () => new THREE.Vector3(0, 0, -100)), []);
  const next = useRef(0);
  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uRipples: { value: ripples },
    uDeep: { value: new THREE.Color('#1f7fa6') },
    uShallow: { value: new THREE.Color('#b9e1ee') },
  }), [ripples]);
  const water = useMemo(() => { const g = new THREE.PlaneGeometry(26, 18, 220, 160); g.rotateX(-Math.PI / 2); return g; }, []);
  const dropGeom = useMemo(teardrop, []);
  const falling = useRef([0, 1, 2].map(i => ({ x: 0, z: 0, y: 0, active: false, start: 1.6 + i * 1.9 })));
  const lastKiss = useRef(-10);

  const ripple = (x: number, z: number, t: number) => {
    ripples[next.current].set(x, z, t);
    next.current = (next.current + 1) % MAX_RIPPLES;
  };

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime * (reduce ? 0.6 : 1);
    uniforms.uTime.value = t;
    // the big drop bobs and, every 5 s, dips to kiss the water
    const cycle = t % 5;
    const dip = cycle > 4.2 ? Math.sin(((cycle - 4.2) / 0.8) * Math.PI) * 0.55 : 0;
    if (cycle > 4.55 && t - lastKiss.current > 2) { lastKiss.current = t; ripple(0.6, 0, t); }
    const d = drop.current;
    if (d) {
      d.position.y = 1.85 + Math.sin(t * 1.1) * 0.12 - dip;
      d.rotation.y += dt * 0.25;
      d.rotation.z = THREE.MathUtils.damp(d.rotation.z, -pointer.x * 0.18, 3, dt);
      d.rotation.x = THREE.MathUtils.damp(d.rotation.x, pointer.y * 0.12, 3, dt);
      const squash = 1 + dip * 0.18;
      d.scale.set(1.05 * squash, 1.05 / squash, 1.05 * squash);
    }
    // small droplets fall and strike the water
    if (!reduce && small.current) {
      falling.current.forEach((f, i) => {
        const m = small.current!.children[i] as THREE.Mesh;
        const age = t - f.start;
        if (age < 0) { m.visible = false; return; }
        if (!f.active) { f.active = true; f.x = (Math.random() - 0.5) * 9; f.z = (Math.random() - 0.5) * 4 + 0.5; }
        f.y = 6.5 - 2.7 * age * age;
        if (f.y <= 0) {
          ripple(f.x, f.z, t);
          f.start = t + 2.2 + Math.random() * 2.5;
          f.active = false;
          m.visible = false;
          return;
        }
        m.visible = true;
        m.position.set(f.x, f.y, f.z);
      });
    }
    // scroll lowers the camera toward the surface
    const p = progress.current;
    camera.position.lerp(new THREE.Vector3(pointer.x * 0.35, 4.9 - p * 1.6 + pointer.y * 0.15, 8.4 - p * 2.4), 0.06);
    camera.lookAt(0.6, 1.2 - p * 0.4, 0);
  });

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); ripple(e.point.x, e.point.z, uniforms.uTime.value); };

  return (
    <>
      <mesh geometry={water} onPointerDown={onPointerDown}>
        <shaderMaterial vertexShader={vertex} fragmentShader={fragment} uniforms={uniforms} transparent depthWrite={false} />
      </mesh>
      <mesh ref={drop} geometry={dropGeom} position={[0.6, 2.15, 0]}>
        <meshPhysicalMaterial transmission={1} thickness={1.6} roughness={0.03} ior={1.33} color="#e3f4fa" attenuationColor="#2f9bc6"
          attenuationDistance={2.6} clearcoat={1} clearcoatRoughness={0.04} envMapIntensity={1.35} specularIntensity={1} />
      </mesh>
      <group ref={small}>
        {falling.current.map((_, i) => (
          <mesh key={i} visible={false} scale={0.09}>
            <sphereGeometry args={[1, 24, 24]} />
            <meshPhysicalMaterial transmission={1} thickness={0.4} roughness={0.05} ior={1.33} color="#d9f0f8" envMapIntensity={1.4} />
          </mesh>
        ))}
      </group>
    </>
  );
};

const WaterScene: React.FC<{ progress: React.MutableRefObject<number>; reduce?: boolean; className?: string }> = ({ progress, reduce = false, className }) => (
  <Canvas className={className} dpr={[1, 1.75]} camera={{ position: [0, 4.9, 8.4], fov: 36 }}
    gl={{ antialias: true, alpha: true, powerPreference: 'high-performance', toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}>
    <Environment />
    <ambientLight intensity={0.4} />
    <directionalLight position={[-4, 8, 5]} intensity={1.4} />
    <Sculpture progress={progress} reduce={reduce} />
  </Canvas>
);

export default WaterScene;
