/**
 * The tanker as a three.js model inside MapLibre's own 3D pass (custom layer): same camera, same depth buffer as the
 * map. Built in metres as a Maharashtra water tanker (an 8 m, 10,000 L truck, the tank lettered "पिण्याचे पाणी" —
 * drinking water — as the real ones are), drawn at twice its size so it stays readable from drone height.
 * Motion comes from the film (no clock): the wheels turn with the distance driven, the body sways a little at
 * speed, and a dust trail rises behind it while it moves.
 */
import * as THREE from 'three';
import type { CustomLayerInterface, CustomRenderMethodInput, Map as MLMap } from 'maplibre-gl';
import type { LngLat } from './math';

export interface TankerState {
  at: LngLat; heading: number; visible: boolean;
  /** metres driven so far along the road (turns the wheels) and speed now, 0..1 (sway and dust) */
  dist?: number; speed?: number;
}

const DUST = 70;

/** The tank's side lettering, as painted on real tankers: drinking water, in Marathi and English. */
function letteringTexture() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0a6f87'; g.fillRect(0, 0, 1024, 256);
  g.fillStyle = '#f4f7f6'; g.fillRect(0, 196, 1024, 18); g.fillRect(0, 42, 1024, 10);
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#ffffff';
  // the lettering repeats around the cylinder: once on each side of the truck
  for (const x of [256, 768]) {
    g.font = '700 74px "Mukta", "Noto Sans Devanagari", sans-serif'; g.fillText('पिण्याचे पाणी', x, 106);
    g.font = '600 34px "Geist Variable", sans-serif'; g.fillText('DRINKING WATER · JALSETU', x, 160);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

function model() {
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const paint = (c: string, rough = 0.6, metal = 0.1) => new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: metal });
  const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(geo, m); mesh.position.set(x, y, z); parent.add(mesh); return mesh;
  };
  const box = (w: number, l: number, h: number, x: number, y: number, z: number, m: THREE.Material, parent: THREE.Object3D = body) => add(parent, new THREE.BoxGeometry(w, l, h), m, x, y, z);
  const white = paint('#eef1f0', 0.45), dark = paint('#1f262b', 0.7), steel = paint('#a9b1b6', 0.35, 0.6), glass = paint('#1b2a33', 0.15, 0.4);
  // chassis + bumpers (forward = +y)
  box(2.3, 8.0, 0.4, 0, 0, 0.95, dark);
  box(2.45, 0.25, 0.4, 0, 4.1, 0.75, steel);
  box(2.4, 0.2, 0.35, 0, -4.05, 0.75, paint('#c23b1b', 0.5));
  // cab: body, windscreen, side windows, grille, mirrors, roof marker lights
  box(2.4, 2.1, 2.2, 0, 2.95, 2.25, white);
  box(2.42, 0.06, 0.95, 0, 4.0, 2.65, glass);
  box(2.44, 1.0, 0.7, 0, 3.2, 2.75, glass);
  box(1.6, 0.06, 0.55, 0, 4.03, 1.55, dark);
  for (const x of [-1.38, 1.38]) { box(0.08, 0.12, 0.45, x, 3.95, 2.6, dark); box(0.2, 0.05, 0.35, x, 3.98, 2.6, steel); }
  for (const x of [-0.7, 0, 0.7]) box(0.18, 0.1, 0.08, x, 3.95, 3.38, paint('#f2a33a', 0.4));
  // tank: lettered cylinder (axis along the truck) with domed ends, ribs, manhole lids, ladder, rear outlet
  const tank = add(body, new THREE.CylinderGeometry(1.1, 1.1, 5.0, 40, 1, true), new THREE.MeshStandardMaterial({ map: letteringTexture(), roughness: 0.38, metalness: 0.15 }), 0, -1.1, 2.25);
  tank.rotation.y = Math.PI / 2; // turns the lettering to face the sides
  const capM = paint('#0a6f87', 0.38, 0.15);
  for (const y of [1.4, -3.6]) { const cap = add(body, new THREE.SphereGeometry(1.1, 32, 16), capM, 0, y, 2.25); cap.scale.set(1, 0.22, 1); }
  for (const y of [-0.1, -2.1]) add(body, new THREE.CylinderGeometry(1.13, 1.13, 0.1, 40), white, 0, y, 2.25);
  for (const y of [0.2, -2.4]) { const lid = add(body, new THREE.CylinderGeometry(0.32, 0.32, 0.1, 20), steel, 0, y, 3.37); lid.rotation.x = Math.PI / 2; }
  for (const x of [-0.25, 0.25]) box(0.05, 0.05, 1.9, x, -3.85, 2.1, steel);
  for (let i = 0; i < 5; i++) box(0.55, 0.05, 0.05, 0, -3.85, 1.3 + i * 0.38, steel);
  const pipe = add(body, new THREE.CylinderGeometry(0.09, 0.09, 0.6, 12), steel, 0.5, -3.95, 1.05); pipe.rotation.x = Math.PI / 2;
  // wheels: tyre + hub + a spoke (so the turning shows), three axles
  const wheels: THREE.Group[] = [];
  const tyre = new THREE.CylinderGeometry(0.52, 0.52, 0.42, 22), hubG = new THREE.CylinderGeometry(0.26, 0.26, 0.44, 10);
  const tyreM = paint('#15191c', 0.9), hubM = paint('#8f979c', 0.4, 0.5);
  for (const y of [2.9, -1.6, -2.9]) for (const x of [-1.15, 1.15]) {
    const w = new THREE.Group(); w.position.set(x, y, 0.52); g.add(w);
    const t = new THREE.Mesh(tyre, tyreM), h = new THREE.Mesh(hubG, hubM);
    t.rotation.z = Math.PI / 2; h.rotation.z = Math.PI / 2; w.add(t, h);
    box(0.05, 0.14, 0.36, x > 0 ? 0.23 : -0.23, 0, 0, hubM, w);
    wheels.push(w);
  }
  // soft contact shadow so it sits on the road
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 32), new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.3, depthWrite: false }));
  shadow.scale.set(1.9, 4.8, 1); shadow.position.set(0, 0, 0.06); g.add(shadow);
  // dust kicked up behind it: soft round sprites, placed each frame from the distance driven
  const dc = document.createElement('canvas'); dc.width = dc.height = 64;
  const dg = dc.getContext('2d')!, grad = dg.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(214,190,150,0.9)'); grad.addColorStop(1, 'rgba(214,190,150,0)');
  dg.fillStyle = grad; dg.fillRect(0, 0, 64, 64);
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DUST * 3), 3));
  const dustM = new THREE.PointsMaterial({ map: new THREE.CanvasTexture(dc), size: 3.2, sizeAttenuation: true, transparent: true, depthWrite: false, opacity: 0 });
  const dust = new THREE.Points(dustGeo, dustM); dust.frustumCulled = false; g.add(dust);
  return { g, body, wheels, dust, dustM };
}

export function tankerLayer(map: MLMap, state: () => TankerState): CustomLayerInterface {
  const camera = new THREE.Camera();
  const scene = new THREE.Scene();
  const truck = model();
  scene.add(truck.g);
  scene.add(new THREE.HemisphereLight('#eef4ff', '#6b5a44', 1.6));
  const sun = new THREE.DirectionalLight('#fff3df', 2.4); sun.position.set(0.5, -0.6, 1); scene.add(sun);
  let renderer: THREE.WebGLRenderer | null = null;
  const proj = new THREE.Matrix4(), place = new THREE.Matrix4(), pose = new THREE.Matrix4();
  const upright = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
  const SCALE = 2;
  const rnd = (i: number, k: number) => { const v = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return v - Math.floor(v); };
  return {
    id: 'tanker', type: 'custom', renderingMode: '3d',
    onAdd(_m, gl) {
      renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl as WebGL2RenderingContext, antialias: true });
      renderer.autoClear = false;
      renderer.compile(scene, camera); // compile now, not when the tanker first comes into view
    },
    render(_gl, args: CustomRenderMethodInput) {
      const s = state();
      if (!renderer || !s.visible) return;
      const dist = s.dist ?? 0, speed = s.speed ?? 0;
      // wheels turn with the distance driven (radius 0.52 m); the body sways a little at speed
      for (const w of truck.wheels) w.rotation.x = -dist / 0.52;
      truck.body.rotation.y = Math.sin(dist / 9) * 0.012 * speed;
      truck.body.position.z = Math.abs(Math.sin(dist / 3.1)) * 0.03 * speed;
      // dust: a trail of puffs behind the truck, older ones higher, wider and fainter (all from the distance driven)
      const P = truck.dust.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < DUST; i++) {
        const age = (i / DUST + (dist / 14) % 1) % 1; // 0 = just kicked up, 1 = about to fade
        P.setXYZ(i, (rnd(i, 1) - 0.5) * (1.6 + age * 3.5), -4.3 - age * 16 - rnd(i, 2) * 2, 0.3 + age * 2.6 + rnd(i, 3) * 0.6);
      }
      P.needsUpdate = true;
      truck.dustM.opacity = 0.45 * Math.min(1, speed * 1.6);
      truck.dust.visible = speed > 0.02;
      const elev = map.queryTerrainElevation(s.at) ?? 0;
      proj.fromArray(args.defaultProjectionData.mainMatrix as unknown as number[]);
      place.fromArray(map.transform.getMatrixForModel(s.at, elev) as unknown as number[]);
      // MapLibre's model frame is y-up (x east, z south); the truck is built z-up, forward = north
      pose.makeRotationY((-s.heading * Math.PI) / 180).multiply(upright).scale(new THREE.Vector3(SCALE, SCALE, SCALE));
      camera.projectionMatrix = proj.multiply(place).multiply(pose);
      renderer.resetState();
      renderer.render(scene, camera);
    },
    onRemove() { renderer?.dispose(); renderer = null; },
  };
}
