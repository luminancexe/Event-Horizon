import * as THREE from 'three';
import { CONFIG, state, BASE_HORIZON, ESCAPE_R } from './state.js';
import { scene } from './scene.js';
import { randomOrbitPosition, orbitalVelocity, nearestBlackHole, bhRadii } from './objects.js';
import { computeAcceleration } from './physics.js';
import { triggerDiskBurst, burstAtDisk, particleBurst } from './effects.js';
import { logEvent } from './events.js';

/* =========================================================================
   ASTEROID FIELD (instanced test-particles, pooled, feel every massive body)
   ========================================================================= */
const dummy = new THREE.Object3D();

export function initAsteroids(count) {
  if (state.asteroidMesh) { scene.remove(state.asteroidMesh); state.asteroidMesh.geometry.dispose(); state.asteroidMesh.material.dispose(); }
  state.aPos = []; state.aVel = []; state.aAcc = []; state.aNewAcc = []; state.aMass = []; state.aRadius = []; state.aAlive = [];
  const geo = new THREE.IcosahedronGeometry(1, 0);
  const mat = new THREE.MeshStandardMaterial({ color: 0x8b8378, roughness: 0.95, metalness: 0.05 });
  state.asteroidMesh = new THREE.InstancedMesh(geo, mat, Math.max(count, 1));
  state.asteroidMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(state.asteroidMesh);
  for (let i = 0; i < count; i++) spawnAsteroid(i);
}
export function spawnAsteroid(i, pos, vel, mass, size) {
  state.aPos[i] = pos || randomOrbitPosition(BASE_HORIZON * 4, 200);
  state.aVel[i] = vel || orbitalVelocity(state.aPos[i], new THREE.Vector3(), CONFIG.blackHoleMass, 0.75 + Math.random() * 0.5);
  state.aAcc[i] = new THREE.Vector3();
  state.aNewAcc[i] = new THREE.Vector3();
  state.aMass[i] = mass ?? (0.05 + Math.random() * 1.5);
  state.aRadius[i] = size ?? (0.3 + Math.random() * 1.1);
  state.aAlive[i] = 1;
  dummy.position.copy(state.aPos[i]);
  dummy.scale.setScalar(state.aRadius[i]);
  dummy.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
  dummy.updateMatrix();
  state.asteroidMesh.setMatrixAt(i, dummy.matrix);
}
// NOTE: initAsteroids() is intentionally NOT auto-invoked here at module
// top level. asteroids.js sits inside a circular import chain (objects.js
// -> selection.js -> effects.js -> asteroids.js -> objects.js), and calling
// into objects.js's exports (randomOrbitPosition/orbitalVelocity) before
// objects.js has finished its own evaluation throws a ReferenceError that
// silently aborts the entire module graph. main.js (which is never part of
// a cycle) calls initAsteroids() explicitly once everything is loaded.

let collisionLogCooldown = 0;
let asteroidCaptureFxCooldown = 0;
export function updateAsteroids(dt) {
  asteroidCaptureFxCooldown -= dt;
  const { aPos, aVel, aAcc, aNewAcc, aRadius, aAlive, asteroidMesh } = state;
  const n = aPos.length;
  const grid = new Map();
  const cellSize = 8;
  const live = [];

  // pass 1: capture check (using last known position), then Verlet position
  // update for everything that survives — same integration scheme used for
  // the named bodies, so asteroids behave consistently under the same gravity
  for (let i = 0; i < n; i++) {
    if (!aAlive[i]) continue;
    const pos = aPos[i];
    const { bh, dist: r } = nearestBlackHole(pos);
    if (bh && r < bhRadii(bh).capture) {
      if (asteroidCaptureFxCooldown <= 0) {
        triggerDiskBurst(bh, 0.08);
        burstAtDisk(pos.clone());
        logEvent('An asteroid has been consumed by the black hole.', 'info', pos);
        asteroidCaptureFxCooldown = 1.5;
      }
      spawnAsteroid(i);
      live.push(i);
      continue;
    }
    pos.addScaledVector(aVel[i], dt);
    pos.addScaledVector(aAcc[i], 0.5 * dt * dt);
    live.push(i);
  }

  // pass 2: recompute acceleration at the new positions, then update velocity
  // using the average of the old and new acceleration (Velocity Verlet)
  for (const i of live) {
    const pos = aPos[i];
    computeAcceleration(pos, null, state.bodies, aNewAcc[i]);
    aVel[i].addScaledVector(aAcc[i], 0.5 * dt);
    aVel[i].addScaledVector(aNewAcc[i], 0.5 * dt);
    // swap references instead of allocating a fresh vector — with up to
    // thousands of asteroids this was the single biggest per-frame
    // allocation source in the whole app
    const tmp = aAcc[i]; aAcc[i] = aNewAcc[i]; aNewAcc[i] = tmp;

    const { bh, dist: r } = nearestBlackHole(pos);
    if (bh) {
      const radii = bhRadii(bh);
      if (r < radii.drag) {
        const k = (radii.drag - r) / radii.drag;
        aVel[i].multiplyScalar(1 - k * 0.015 * dt * 60);
      }
    }
    if (pos.length() > ESCAPE_R) { spawnAsteroid(i); continue; }

    const key = `${Math.floor(pos.x / cellSize)}_${Math.floor(pos.z / cellSize)}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(i);
  }

  collisionLogCooldown -= dt;
  for (const cell of grid.values()) {
    for (let a = 0; a < cell.length; a++) {
      for (let b = a + 1; b < cell.length; b++) {
        const i = cell[a], j = cell[b];
        const d = aPos[i].distanceTo(aPos[j]);
        if (d < (aRadius[i] + aRadius[j]) * 0.9) {
          const n1 = aPos[i].clone().sub(aPos[j]).normalize();
          aVel[i].addScaledVector(n1, 0.6);
          aVel[j].addScaledVector(n1, -0.6);
          aPos[i].addScaledVector(n1, 0.15);
          aPos[j].addScaledVector(n1, -0.15);
          if (collisionLogCooldown <= 0) {
            logEvent('ASTEROID COLLISION DETECTED', 'info', aPos[i]);
            particleBurst(aPos[i], { count: 18, color: 0xcabaa0, spread: 2, size: 0.8, duration: 700, growth: 2 });
            collisionLogCooldown = 4;
          }
        }
      }
    }
  }

  for (let i = 0; i < n; i++) {
    if (!aAlive[i]) continue;
    dummy.position.copy(aPos[i]);
    dummy.scale.setScalar(aRadius[i]);
    dummy.rotation.y += 0.002;
    dummy.updateMatrix();
    asteroidMesh.setMatrixAt(i, dummy.matrix);
  }
  asteroidMesh.instanceMatrix.needsUpdate = true;
}