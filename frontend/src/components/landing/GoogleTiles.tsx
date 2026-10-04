/**
 * Google Photorealistic 3D Tiles for the descent, mounted in the same local frame as our own ground (metres, origin at
 * the water point), so they share the camera, clouds, sun and fog with the rest of the world.
 *
 * Never visible unless it is healthy: our SRTM + Sentinel-2 ground stays underneath and is what the visitor sees until
 * Google has loaded the view. Any failure (no key, bad key, quota or billing errors, network, tiles too slow, a weak
 * device) leaves `googleState.mode = 'fallback'` and nothing on screen changes. The decision is only switched while the
 * camera is inside the cloud layer, so a swap is never seen.
 *
 * Terms: tiles are streamed live and never cached or recorded by us; the Google logo and data attributions are shown
 * whenever Google content is on screen (see Landing.tsx).
 */
import React, { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { TilesRenderer } from '3d-tiles-renderer';
import { GoogleCloudAuthPlugin, ReorientationPlugin, TileCompressionPlugin, TilesFadePlugin, UnloadTilesPlugin } from '3d-tiles-renderer/plugins';
import { live } from './live';
import { G, clock, googleState, type GoogleMode } from './story';

const KEY = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined)?.trim() || '';

googleState.mode = KEY ? 'probing' : 'off'; googleState.reason = KEY ? '' : 'no key';

export const googleConfigured = () => !!KEY;

/** Where the street shot happens; a prefetch camera waits there so the street tiles are ready before we arrive. */
const PREFETCH: { pos: [number, number, number]; target: [number, number, number] }[] = [
  { pos: [-230, 120, 200], target: [-80, 0, 30] },
  { pos: [-55, 16, 62], target: [-8, 1, 3] },
];

export const GoogleTiles: React.FC<{ lat: number; lon: number; enabled: boolean }> = ({ lat, lon, enabled }) => {
  const { gl, camera, size } = useThree();

  const setup = useMemo(() => {
    if (!KEY || !enabled) return null;
    const tiles = new TilesRenderer();
    tiles.registerPlugin(new GoogleCloudAuthPlugin({ apiToken: KEY, autoRefreshToken: true }));
    tiles.registerPlugin(new ReorientationPlugin({ lat: lat * THREE.MathUtils.DEG2RAD, lon: lon * THREE.MathUtils.DEG2RAD, height: 0, recenter: true }));
    tiles.registerPlugin(new TileCompressionPlugin());
    tiles.registerPlugin(new UnloadTilesPlugin());
    tiles.registerPlugin(new TilesFadePlugin({ fadeDuration: 400 }));
    tiles.errorTarget = 12;
    // plugin frame is +X west, +Z north; ours is +X east, +Z south: a half turn about the vertical
    const holder = new THREE.Group();
    holder.rotation.y = Math.PI;
    holder.add(tiles.group);
    const prefetch = PREFETCH.map(() => new THREE.PerspectiveCamera(44, 16 / 9, 1, 60000));
    const health = { loaded: 0, errors: 0, authFailed: false, rootOk: false, since: performance.now(), heightFix: NaN, raycaster: new THREE.Raycaster() };
    tiles.addEventListener('load-root-tileset', () => { health.rootOk = true; });
    tiles.addEventListener('load-model', ({ scene }) => {
      health.loaded++;
      scene.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.receiveShadow = true; m.castShadow = true; } });
    });
    tiles.addEventListener('load-error', ({ error }) => {
      health.errors++;
      const msg = String((error as Error)?.message ?? error);
      if (/40[0-3]|429|quota|billing|API key|PERMISSION/i.test(msg)) health.authFailed = true;
    });
    return { tiles, holder, prefetch, health };
  }, [lat, lon, enabled]);

  useEffect(() => {
    if (!setup) { googleState.mode = KEY ? 'fallback' : 'off'; return; }
    const { tiles, prefetch } = setup;
    tiles.setCamera(camera);
    for (const c of prefetch) tiles.setCamera(c);
    return () => { tiles.dispose(); googleState.active = false; };
  }, [setup, camera]);

  useEffect(() => {
    if (!setup) return;
    setup.tiles.setResolutionFromRenderer(camera, gl);
    for (const c of setup.prefetch) setup.tiles.setResolution(c, Math.min(1280, size.width), Math.min(720, size.height));
  }, [setup, camera, gl, size]);

  const tmp = useMemo(() => ({ o: new THREE.Vector3(), d: new THREE.Vector3(0, -1, 0) }), []);
  useFrame(() => {
    if (!setup) return;
    const { tiles, holder, prefetch, health } = setup;
    const parent = holder.parent;
    const wanted = live.ph.inGround > 0 || live.dist < 2.4;
    if (!wanted || !parent) { holder.visible = false; return; }

    // prefetch cameras live in the same local frame (parent = the ground group)
    PREFETCH.forEach((s, i) => {
      const c = prefetch[i];
      c.position.set(...s.pos); c.lookAt(new THREE.Vector3(...s.target));
      c.updateMatrixWorld();
      c.matrixWorld.premultiply(parent.matrixWorld); c.matrixWorldInverse.copy(c.matrixWorld).invert();
    });
    tiles.update();

    // snap the photogrammetry's ground to our origin (ellipsoid vs. orthometric heights differ by tens of metres)
    if (!Number.isFinite(health.heightFix) || health.loaded % 20 === 0) {
      // raycast in world space from 4 km above the origin
      const o = tmp.o.set(0, 4000, 0).applyMatrix4(parent.matrixWorld);
      health.raycaster.set(o, tmp.d.set(0, -1, 0));
      holder.updateMatrixWorld(true);
      const hit = health.raycaster.intersectObject(tiles.group, true)[0];
      if (hit) {
        const yLocal = hit.point.clone().applyMatrix4(parent.matrixWorld.clone().invert()).y;
        const fix = holder.position.y - yLocal;
        health.heightFix = Number.isFinite(health.heightFix) ? health.heightFix * 0.7 + fix * 0.3 : fix;
        holder.position.y = health.heightFix;
      }
    }

    // decide, but only switch while the camera is in the cloud layer (or before the descent starts)
    const t = (performance.now() - health.since) / 1000;
    let next: GoogleMode = googleState.mode;
    if (health.authFailed || health.errors > 25) { next = 'fallback'; googleState.reason = health.authFailed ? 'auth/quota' : 'errors'; }
    else if (health.rootOk && health.loaded > 30 && tiles.loadProgress > 0.85 && Number.isFinite(health.heightFix)) next = 'ready';
    else if (t > 25 && !health.rootOk) { next = 'fallback'; googleState.reason = 'timeout'; }
    if (live.lowPower) { next = 'fallback'; googleState.reason = 'device'; }
    const p = clock.p;
    const hidden = p < G.start + 0.006 || (p > G.start + 0.012 && p < G.start + 0.03) || p > G.end - 0.004 || live.dist > 0.6;
    if (next !== googleState.mode && (hidden || next === 'fallback')) googleState.mode = next;
    googleState.active = googleState.mode === 'ready';
    holder.visible = googleState.active;
    if (googleState.active) {
      const a = (tiles as unknown as { getAttributions?: (t: { value: string; type: string }[]) => { value: string; type: string }[] }).getAttributions?.([]) ?? [];
      googleState.attribution = a.filter(x => x.type === 'string').map(x => x.value).join('; ');
    }
  });

  return setup ? <primitive object={setup.holder} /> : null;
};
