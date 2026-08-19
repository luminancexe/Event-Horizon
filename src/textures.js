/**
 * @file textures.js
 * @description Procedural texture generators for canvas-backed sprites and materials.
 *
 * Generates radial gradient textures and ring sprites in offscreen canvas elements,
 * converting them into Three.js CanvasTexture instances for point lights, glows,
 * photon rings, and UI selection rings.
 */

import * as THREE from 'three';

/* ============================================================================
   PROCEDURAL TEXTURE FACTORIES
   ============================================================================ */

/**
 * Creates a radial gradient glow texture on an offscreen 2D canvas.
 *
 * @param {string} inner - Inner color stop CSS color string.
 * @param {string} outer - Outer color stop CSS color string (typically transparent).
 * @param {number} [size=128] - Canvas width and height in pixels.
 * @returns {THREE.CanvasTexture} Texture suitable for additive particle and sprite blending.
 */
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

/**
 * Creates an annular ring texture on an offscreen 2D canvas.
 *
 * @param {string} color - Ring peak color CSS string.
 * @param {number} [size=256] - Canvas width and height in pixels.
 * @returns {THREE.CanvasTexture} Texture suitable for UI selection rings and photon spheres.
 */
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

/* Pre-allocated shared procedural textures */
export const starGlowTex = makeGlowTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)');
export const selectionRingTex = makeRingTexture('rgba(127,217,255,0.95)');
