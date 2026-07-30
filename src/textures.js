import * as THREE from 'three';

/* =========================================================================
   TEXTURE HELPERS — small canvas-generated glow/ring sprites reused all
   over the app (star glows, selection rings, photon rings, nebulae, ...).
   ========================================================================= */
export function makeGlowTexture(inner, outer, size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}
export function makeRingTexture(color, size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.30, size / 2, size / 2, size * 0.5);
  g.addColorStop(0.0, 'rgba(0,0,0,0)');
  g.addColorStop(0.42, 'rgba(0,0,0,0)');
  g.addColorStop(0.5, color);
  g.addColorStop(0.58, 'rgba(0,0,0,0)');
  g.addColorStop(1.0, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}
export const starGlowTex = makeGlowTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)');
export const selectionRingTex = makeRingTexture('rgba(127,217,255,0.95)');
