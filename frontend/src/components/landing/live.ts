/** Per-frame world state shared by the scene's layers (lives in the lazy 3D chunk, never in the page bundle). */
import * as THREE from 'three';
import { phases, type Phases } from './story';

export const live: {
  ph: Phases; speed: number; dist: number; lowPower: boolean; fade: number;
  tankerLocal: THREE.Vector3; tankerWorld: THREE.Vector3;
} = { ph: phases(0), speed: 0, dist: 30, lowPower: false, fade: 1, tankerLocal: new THREE.Vector3(), tankerWorld: new THREE.Vector3() };
