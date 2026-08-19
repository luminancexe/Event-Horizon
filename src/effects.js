/**
 * @file effects.js
 * @description Astrophysical visual effects, stellar evolution lifecycles, and entity lifecycle teardown.
 *
 * Implements:
 * 1. Accretion disk brightness pulses and relativistic shockwave rings.
 * 2. Tidal disruption fragment debris physics and singularity accretion spirals.
 * 3. Stellar evolutionary phases (main sequence -> red giant/supergiant -> white dwarf or supernova).
 * 4. Supernova blastwaves, kinetic impulse propagation, and compact remnant formation.
 * 5. Particle burst visual systems and complete GPU resource disposal.
 */

import * as THREE from 'three';
import { CONFIG, state } from './state.js';
import { scene } from './scene.js';
import { logEvent, showBanner } from './events.js';
import { cameraShake } from './camera.js';
import { createBlackHole, createNeutronStar } from './objects.js';
import { spawnAsteroid } from './asteroids.js';
import { unregisterSelectable, deselect } from './selection.js';

/* ============================================================================
   ACCRETION DISK BURSTS & RELATIVISTIC ENERGY RINGS
   ============================================================================ */

/**
 * Triggers a temporary brightness boost on a black hole's accretion disk material.
 *
 * @param {BlackHole} bh - Target black hole.
 * @param {number} magnitude - Brightness impulse value.
 */
export function triggerDiskBurst(bh, magnitude) {
  if (!bh) return;
  bh._burst = Math.min((bh._burst || 0) + magnitude, 3.5);
}

/**
 * Spawns an expanding planar energy ring on the XZ orbital plane.
 *
 * @param {THREE.Vector3} position - Origin in world space.
 * @param {number|THREE.Color} [color=0xfff2c8] - Ring emission color.
 * @param {number} [maxScale=26] - Maximum expansion scale before disposal.
 * @param {number} [duration=1500] - Lifespan in milliseconds.
 */
export function spawnEnergyRing(position, color = 0xfff2c8, maxScale = 26, duration = 1500) {
  const geo = new THREE.RingGeometry(1, 1.4, 80);
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const ring = new THREE.Mesh(geo, mat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.copy(position);
  scene.add(ring);

  const start = performance.now();
  function tick() {
    const t = Math.min((performance.now() - start) / duration, 1);
    const s = 1 + t * maxScale;
    ring.scale.set(s, s, 1);
    mat.opacity = 0.85 * (1 - t);
    if (t < 1) {
      requestAnimationFrame(tick);
    } else {
      scene.remove(ring);
      geo.dispose();
      mat.dispose();
    }
  }
  tick();
}

/* ============================================================================
   TIDAL DISRUPTION FRAGMENTS & ACCRETION SPIRALS
   ============================================================================ */

const FRAG_MAX = 260;

/**
 * Spawns lightweight 3D debris fragments from a disrupted celestial body.
 *
 * @param {CelestialBody} obj - Disrupted body progenitor.
 * @param {BlackHole} bh - Attracting singularity.
 * @param {number} count - Number of fragments to spawn.
 * @param {THREE.Color} color - Debris fragment material color.
 */
function spawnFragments(obj, bh, count, color) {
  for (let i = 0; i < count && state.fragments.length < FRAG_MAX; i++) {
    const size = Math.max(obj.radius * (0.12 + Math.random() * 0.22), 0.15);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 });
    const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(size, 0), mat);
    const offset = new THREE.Vector3(
      (Math.random() - 0.5) * obj.radius * 2,
      (Math.random() - 0.5) * obj.radius * 2,
      (Math.random() - 0.5) * obj.radius * 2
    );
    mesh.position.copy(obj.mesh.position).add(offset);
    scene.add(mesh);

    const scatter = new THREE.Vector3(
      (Math.random() - 0.5) * 6,
      (Math.random() - 0.5) * 3,
      (Math.random() - 0.5) * 6
    );

    state.fragments.push({
      mesh,
      mat,
      bh,
      velocity: obj.velocity.clone().add(scatter),
      spin: new THREE.Vector3(Math.random() * 3, Math.random() * 3, Math.random() * 3),
      life: 0,
      maxLife: 3.5,
    });
  }
}

/**
 * Advances tidal debris fragments through gravity integration toward their capturing black hole.
 *
 * @param {number} dt - Timestep in simulation seconds.
 */
export function updateFragments(dt) {
  for (let i = state.fragments.length - 1; i >= 0; i--) {
    const f = state.fragments[i];
    f.life += dt;
    const bh = f.bh;

    if (!bh || !state.bodies.includes(bh) || f.life > f.maxLife) {
      removeFragment(i);
      continue;
    }

    const toCenter = bh.mesh.position.clone().sub(f.mesh.position);
    const dist = Math.max(toCenter.length(), 1);
    // Enhanced gravitational acceleration to ensure inward spiral into the singularity
    const accel = toCenter.normalize().multiplyScalar((CONFIG.G * bh.mass) / (dist * dist) + 4);
    f.velocity.addScaledVector(accel, dt);
    f.mesh.position.addScaledVector(f.velocity, dt);
    f.mesh.rotation.x += f.spin.x * dt;
    f.mesh.rotation.y += f.spin.y * dt;
    f.mat.opacity = Math.max(0, 1 - f.life / f.maxLife);

    // Horizon crossing: feed accretion disk and consume fragment
    if (dist < bh.visualRadius * 1.05) {
      triggerDiskBurst(bh, 0.12);
      removeFragment(i);
    }
  }
}

/**
 * Disposes geometry/material and removes a single fragment from active tracking.
 *
 * @param {number} i - Array index of target fragment.
 */
function removeFragment(i) {
  const f = state.fragments[i];
  scene.remove(f.mesh);
  f.mesh.geometry.dispose();
  f.mat.dispose();
  state.fragments.splice(i, 1);
}

/**
 * Clears all active debris fragments from the scene.
 */
export function clearFragments() {
  for (let i = state.fragments.length - 1; i >= 0; i--) removeFragment(i);
}

/**
 * Executes a full tidal disruption event on a celestial body captured by a black hole.
 * Converts progenitor mass into an expanding fragment spiral and flares the accretion disk.
 *
 * @param {CelestialBody} obj - Disrupted body.
 * @param {BlackHole} bh - Capturing black hole.
 */
export function disintegrate(obj, bh) {
  const fragColor =
    {
      star: new THREE.Color(0xfff2c0),
      planet: obj.core.material.color ? obj.core.material.color.clone() : new THREE.Color(0xaaaaaa),
      moon: new THREE.Color(0xaaaaaa),
      comet: new THREE.Color(0xbfe9ff),
    }[obj.type] || new THREE.Color(0xffcc88);

  const count = { star: 16, planet: 11, moon: 6, comet: 5 }[obj.type] || 6;

  spawnFragments(obj, bh, count, fragColor);
  triggerDiskBurst(bh, 0.35 + obj.mass * 0.01);
  spawnEnergyRing(bh.mesh.position, obj.type === 'star' ? 0xfff2c8 : 0xffb066);

  logEvent(`${obj.name} has fragmented under extreme tidal stress.`, 'critical', obj.mesh.position);
  logEvent(`${obj.name} has been consumed by the black hole.`, 'critical', obj.mesh.position);
  showBanner(
    obj.type === 'planet'
      ? 'PLANETARY BODY DESTROYED'
      : obj.type === 'star'
      ? 'TIDAL DISRUPTION COMPLETE'
      : `${obj.name} CONSUMED`
  );

  destroyObject(obj);
}

/* ============================================================================
   STELLAR EVOLUTION LIFECYCLE (MAIN SEQUENCE -> RED GIANT -> SUPERNOVA / WHITE DWARF)
   ============================================================================ */

/**
 * Evaluates stellar age and advances evolutionary phase (red giant expansion or supernova collapse).
 *
 * @param {Star} obj - Target star entity.
 */
export function updateStarLifecycle(obj) {
  if (obj.status === 'unstable') return;
  const frac = obj.age / obj.lifespan;

  // Reached end of nuclear burning lifetime
  if (frac >= 1 && obj.stage !== 'remnant') {
    triggerSupernova(obj);
    return;
  }

  // Late-stage hydrogen exhaustion: transition to red giant / supergiant phase
  if (frac >= 0.75 && obj.stage === 'main_sequence') {
    obj.stage = 'giant';
    obj.lifecycleScale = obj.isHighMass ? 2.6 : 1.9;
    obj.core.scale.setScalar(obj.lifecycleScale);
    const giantColor = obj.isHighMass ? 0xff5a3c : 0xff8a5c;
    obj.core.material.color.set(giantColor);
    obj.glow.material.color.set(giantColor);
    obj.glow.scale.set(
      obj.radius * 7 * obj.lifecycleScale * 1.3,
      obj.radius * 7 * obj.lifecycleScale * 1.3,
      1
    );
    logEvent(
      `${obj.name} has swelled into a ${obj.isHighMass ? 'red supergiant' : 'red giant'}.`,
      'info',
      obj.mesh.position
    );
    showBanner(`${obj.name}: ${obj.isHighMass ? 'RED SUPERGIANT' : 'RED GIANT'} PHASE`);
  }
}

/**
 * Triggers stellar death sequence:
 * - Low-mass stars shed outer envelopes to form degenerate white dwarfs.
 * - High-mass stars undergo core-collapse supernovae, ejecting debris and collapsing
 *   into neutron stars or stellar-mass black holes.
 *
 * @param {Star} obj - Collapsing star.
 */
function triggerSupernova(obj) {
  if (!obj.isHighMass) {
    // Low-mass stellar death: Non-explosive white dwarf cooling remnant
    obj.stage = 'remnant';
    obj.lifecycleScale = 0.35;
    obj.core.scale.setScalar(obj.lifecycleScale);
    obj.core.material.color.set(0xeaf6ff);
    obj.glow.material.color.set(0xeaf6ff);
    obj.glow.scale.set(obj.radius * 3, obj.radius * 3, 1);
    obj.status = 'stable';
    logEvent(`${obj.name} has shed its outer layers and collapsed into a white dwarf.`, 'info', obj.mesh.position);
    showBanner(`${obj.name}: WHITE DWARF FORMED`);
    return;
  }

  // Core-collapse supernova
  obj.stage = 'remnant';
  logEvent('SUPERNOVA DETECTED', 'critical', obj.mesh.position);
  logEvent(`STAR ${obj.name} HAS COLLAPSED.`, 'critical', obj.mesh.position);
  showBanner('SUPERNOVA DETECTED');
  cameraShake(1.1, 900);

  // Explosive particle bursts and blast shockwaves
  particleBurst(obj.mesh.position, { count: 180, color: 0xfff2d0, spread: 6, size: 2.6, duration: 2400, growth: 10 });
  particleBurst(obj.mesh.position, { count: 90, color: 0x9fd4ff, spread: 4, size: 1.8, duration: 2000, growth: 7 });
  spawnEnergyRing(obj.mesh.position, 0xfff6e0, 55, 2200);

  // Radial blast wave impulse on neighboring celestial bodies
  for (const b of state.bodies) {
    if (b === obj) continue;
    const diff = b.mesh.position.clone().sub(obj.mesh.position);
    const d = diff.length();
    if (d < 150 && d > 0.01) {
      b.velocity.addScaledVector(diff.normalize(), (1 - d / 150) * 22);
    }
  }

  // Eject high-velocity asteroid debris field
  for (let k = 0; k < 6; k++) {
    if (!state.aPos.length) break;
    const idx = Math.floor(Math.random() * state.aPos.length);
    const dir = new THREE.Vector3(
      Math.random() - 0.5,
      (Math.random() - 0.5) * 0.4,
      Math.random() - 0.5
    ).normalize();
    const p = obj.mesh.position.clone().addScaledVector(dir, 8 + Math.random() * 20);
    const v = obj.velocity.clone().addScaledVector(dir, 15 + Math.random() * 25);
    spawnAsteroid(idx, p, v, 0.3 + Math.random() * 1.2, 0.6 + Math.random() * 1.3);
  }

  const remnantMass = obj.mass * 0.35;
  if (obj.mass > 17) {
    createBlackHole({
      position: obj.mesh.position.clone(),
      velocity: obj.velocity.clone(),
      mass: Math.max(remnantMass * 40, 350),
      name: obj.name + ' REMNANT',
    });
    logEvent(`${obj.name} has collapsed into a new black hole.`, 'critical', obj.mesh.position);
  } else {
    createNeutronStar({
      position: obj.mesh.position.clone(),
      velocity: obj.velocity.clone(),
      mass: remnantMass,
      name: obj.name + '-NS',
    });
    logEvent(`${obj.name} has collapsed into a neutron star.`, 'info', obj.mesh.position);
  }

  destroyObject(obj);
}

/* ============================================================================
   PARTICLE BURST VISUALS AND ENTITY TEARDOWN
   ============================================================================ */

/**
 * Spawns an expanding, fading Three.js Points particle burst.
 *
 * @param {THREE.Vector3} position - World-space center.
 * @param {object} [opts={}] - Customization options.
 */
export function particleBurst(position, opts = {}) {
  const n = opts.count ?? 40;
  const spread = opts.spread ?? 4;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3);

  for (let i = 0; i < n; i++) {
    pos[i * 3] = position.x + (Math.random() - 0.5) * spread;
    pos[i * 3 + 1] = position.y + (Math.random() - 0.5) * spread;
    pos[i * 3 + 2] = position.z + (Math.random() - 0.5) * spread;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));

  const mat = new THREE.PointsMaterial({
    color: opts.color ?? 0xffdca0,
    size: opts.size ?? 1.4,
    transparent: true,
    opacity: 1,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const pts = new THREE.Points(geo, mat);
  scene.add(pts);

  const start = performance.now();
  const duration = opts.duration ?? 1200;
  const growth = opts.growth ?? 3;

  function fade() {
    const t = (performance.now() - start) / duration;
    mat.opacity = Math.max(0, 1 - t);
    pts.scale.setScalar(1 + t * growth);
    if (t < 1) {
      requestAnimationFrame(fade);
    } else {
      scene.remove(pts);
      geo.dispose();
      mat.dispose();
    }
  }
  fade();
}

/**
 * Convenience wrapper to trigger particle bursts at black hole accretion boundaries.
 * @param {THREE.Vector3} position - World position.
 */
export function burstAtDisk(position) {
  particleBurst(position);
}

/**
 * Unregisters and disposes all Three.js GPU resources and scene graph nodes associated with a body.
 *
 * @param {CelestialBody} obj - Celestial body to destroy.
 */
export function destroyObject(obj) {
  obj._destroyed = true;
  scene.remove(obj.mesh);
  scene.remove(obj.trail.line);
  obj.trail.geo.dispose();

  if (obj._velArrow) scene.remove(obj._velArrow);
  if (obj._forceArrow) scene.remove(obj._forceArrow);
  if (obj._accArrow) scene.remove(obj._accArrow);
  if (obj._collisionSphere) {
    scene.remove(obj._collisionSphere);
    obj._collisionSphere.geometry.dispose();
    obj._collisionSphere.material.dispose();
  }

  unregisterSelectable(obj.core);
  state.bodies = state.bodies.filter((b) => b !== obj);
  if (state.selected === obj) deselect();
}