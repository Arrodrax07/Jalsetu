/**
 * The tanker as a three.js model inside MapLibre's own 3D pass (custom layer): same camera, same depth buffer as the
 * terrain and the OSM buildings, so it is hidden behind a building exactly when a real truck would be. Built in
 * metres (an 8 m, 10,000 L water tanker), drawn at three times its size so it stays readable from drone height.
 */
import * as THREE from 'three';
import type { CustomLayerInterface, CustomRenderMethodInput, Map as MLMap } from 'maplibre-gl';
import type { LngLat } from './math';

export interface TankerState { at: LngLat; heading: number; visible: boolean }

function model() {
  const g = new THREE.Group();
  const paint = (c: string, rough = 0.6, metal = 0.1) => new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: metal });
  const box = (w: number, l: number, h: number, x: number, y: number, z: number, m: THREE.Material) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, l, h), m); b.position.set(x, y, z); g.add(b); return b;
  };
  // chassis, cab (forward = +y), tank
  box(2.3, 8.0, 0.45, 0, 0, 0.95, paint('#2a3136'));
  box(2.4, 2.1, 2.2, 0, 2.95, 2.25, paint('#f2f4f3', 0.45));
  box(2.42, 0.08, 0.9, 0, 4.02, 2.55, paint('#1b2a33', 0.2, 0.3)); // windscreen
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.08, 1.08, 5.3, 28), paint('#0a7f99', 0.4, 0.2));
  tank.rotation.x = 0; tank.position.set(0, -1.1, 2.2); g.add(tank); // cylinder axis is y: lies along the truck
  const band = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.35, 28), paint('#f2f4f3', 0.5));
  band.position.set(0, -1.1, 2.2); g.add(band);
  const wheel = new THREE.CylinderGeometry(0.52, 0.52, 0.42, 18);
  const tyre = paint('#15191c', 0.9);
  for (const y of [2.9, -1.6, -2.9]) for (const x of [-1.15, 1.15]) {
    const w = new THREE.Mesh(wheel, tyre); w.rotation.z = Math.PI / 2; w.position.set(x, y, 0.52); g.add(w);
  }
  // soft contact shadow so it sits on the road
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 32), new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.28, depthWrite: false }));
  shadow.scale.set(1.9, 4.8, 1); shadow.position.set(0, 0, 0.06); g.add(shadow);
  return g;
}

export function tankerLayer(map: MLMap, state: () => TankerState): CustomLayerInterface {
  const camera = new THREE.Camera();
  const scene = new THREE.Scene();
  const truck = model();
  scene.add(truck);
  scene.add(new THREE.HemisphereLight('#eef4ff', '#6b5a44', 1.6));
  const sun = new THREE.DirectionalLight('#fff3df', 2.4); sun.position.set(0.5, -0.6, 1); scene.add(sun);
  let renderer: THREE.WebGLRenderer | null = null;
  const proj = new THREE.Matrix4(), place = new THREE.Matrix4(), pose = new THREE.Matrix4();
  const upright = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
  const SCALE = 3;
  return {
    id: 'tanker', type: 'custom', renderingMode: '3d',
    onAdd(_m, gl) {
      renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl as WebGL2RenderingContext, antialias: true });
      renderer.autoClear = false;
    },
    render(_gl, args: CustomRenderMethodInput) {
      const s = state();
      if (!renderer || !s.visible) return;
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
