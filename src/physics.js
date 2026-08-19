/**
 * @file physics.js
 * @description N-body gravitational physics engine, symplectic Velocity Verlet numerical integrator,
 * relativistic tidal interactions, binary black hole mergers, and collision dynamics.
 *
 * Implements:
 * 1. Direct-sum N-body gravitational acceleration with Plummer softening.
 * 2. Second-order Velocity Verlet numerical integration for symplectic energy conservation.
 * 3. Proximity-based astrophysical effects (hydrodynamic disk drag, Roche limit tidal elongation,
 *    gravitational capture, and periapsis slingshot logging).
 * 4. Binary black hole orbital decay and momentum-conserving coalescence.
 * 5. Inelastic mass accretion and high-velocity fragmentation collisions between celestial bodies.
 */

import * as THREE from 'three';
import {
  CONFIG,
  state,
  SOFTENING,
  ESCAPE_R,
  AGE_YEARS_PER_SIMSECOND,
  COLLISION_MERGE_SPEED,
  COLLISION_GRACE_MS,
} from './state.js';
import {
  updateTrail,
  nearestBlackHole,
  bhRadii,
  blackHoles,
  createBlackHole,
  createStar,
  createPlanet,
  createMoon,
  createComet,
  createNeutronStar,
} from './objects.js';
import { disintegrate, destroyObject, spawnEnergyRing, particleBurst } from './effects.js';
import { cameraShake } from './camera.js';
import { logEvent, showBanner } from './events.js';
import { spawnAsteroid } from './asteroids.js';

/* ============================================================================
   N-BODY GRAVITATIONAL ACCELERATION
   ============================================================================ */

/**
 * Computes net gravitational acceleration at a target point from an array of source bodies.
 * Uses Newton's universal law of gravitation with Plummer softening:
 *
 *   a = sum_j ( G * M_j * (r_j - r) / ( |r_j - r|^2 + epsilon^2 )^(3/2) )
 *
 * The softening factor (epsilon = SOFTENING) prevents infinite force singularities
 * during close encounters without altering long-range orbital trajectories.
 *
 * @param {THREE.Vector3} pos - Target test position.
 * @param {CelestialBody|null} excludeObj - Body to exclude from source sum (e.g. self-interaction).
 * @param {CelestialBody[]} sources - Array of massive celestial bodies.
 * @param {THREE.Vector3} [out] - Optional destination vector to avoid memory allocation.
 * @returns {THREE.Vector3} Net acceleration vector.
 */
export function computeAcceleration(pos, excludeObj, sources, out) {
  const accel = out ? out.set(0, 0, 0) : new THREE.Vector3();
  if (!CONFIG.gravityEnabled) return accel;

  for (const s of sources) {
    if (s === excludeObj) continue;
    const dx = s.mesh.position.x - pos.x;
    const dy = s.mesh.position.y - pos.y;
    const dz = s.mesh.position.z - pos.z;

    const distSq = dx * dx + dy * dy + dz * dz + SOFTENING * SOFTENING;
    const distSoft = Math.sqrt(distSq);
    const f = (CONFIG.G * s.mass) / (distSq * distSoft);

    accel.x += f * dx;
    accel.y += f * dy;
    accel.z += f * dz;

    state.gravityCalcCount++;
  }
  return accel;
}

/* ============================================================================
   NUMERICAL INTEGRATION (VELOCITY VERLET)
   ============================================================================ */

/**
 * Advances the positions and velocities of all active massive bodies over a timestep dt
 * using the second-order symplectic Velocity Verlet integration scheme:
 *
 *   1. x(t + dt) = x(t) + v(t) * dt + 0.5 * a(t) * dt^2
 *   2. a(t + dt) = F(x(t + dt)) / m
 *   3. v(t + dt) = v(t) + 0.5 * (a(t) + a(t + dt)) * dt
 *
 * Unlike explicit Euler integration, Velocity Verlet preserves phase space volume (symplectic),
 * preventing artificial orbital drift and maintaining long-term energy conservation.
 *
 * @param {number} dt - Timestep in simulation seconds.
 */
export function integrateBodiesVerlet(dt) {
  const list = state.bodies.filter((b) => !b._destroyed);

  // Step 1: Update positions using current velocity and acceleration
  for (const b of list) {
    b.mesh.position.addScaledVector(b.velocity, dt);
    b.mesh.position.addScaledVector(b.acceleration, 0.5 * dt * dt);
  }

  // Step 2: Evaluate new accelerations at the advanced positions
  for (const b of list) {
    computeAcceleration(b.mesh.position, b, state.bodies, b._newAcceleration);
  }

  // Step 3: Complete velocity update using trapezoidal acceleration average
  for (const b of list) {
    b.velocity.addScaledVector(b.acceleration, 0.5 * dt);
    b.velocity.addScaledVector(b._newAcceleration, 0.5 * dt);

    // Swap scratch buffers to retain current acceleration for the next sub-step without reallocation
    const tmp = b.acceleration;
    b.acceleration = b._newAcceleration;
    b._newAcceleration = tmp;
  }
}

/**
 * Executes post-integration dynamics for a celestial body:
 * - Accumulates chronological age
 * - Evaluates proximity to the nearest black hole (capture, drag, tidal deformation)
 * - Detects high-speed gravitational slingshot maneuvers
 * - Checks for escape beyond the maximum simulation boundary
 * - Advances orbital trail history and intrinsic rotational spin
 *
 * @param {CelestialBody} obj - Target celestial body.
 * @param {number} dt - Sub-step timestep in simulation seconds.
 */
export function postStepBody(obj, dt) {
  if (obj._destroyed) return;
  obj.age += dt * AGE_YEARS_PER_SIMSECOND;

  if (obj.type === 'blackhole') {
    updateTrail(obj.trail, obj.mesh.position, obj.velocity.length());
    return;
  }

  const pos = obj.mesh.position;
  const { bh, dist: r } = nearestBlackHole(pos);

  if (bh) {
    const radii = bhRadii(bh);

    // 1. Event horizon crossing -> Tidal disruption and consumption
    if (r < radii.capture) {
      disintegrate(obj, bh);
      return;
    }

    // 2. Accretion disk hydrodynamic drag
    if (r < radii.drag) {
      const k = (radii.drag - r) / radii.drag;
      obj.velocity.multiplyScalar(1 - k * 0.012 * dt * 60);
    }
    // Minor stochastic velocity perturbation from disk gas turbulence
    if (Math.random() < 0.004) {
      obj.velocity.x += (Math.random() - 0.5) * 0.05;
      obj.velocity.z += (Math.random() - 0.5) * 0.05;
    }

    // 3. Roche limit tidal stress and physical elongation
    if (r < radii.tidal) {
      obj.tidalPercent = THREE.MathUtils.clamp(
        (100 * (radii.tidal - r)) / (radii.tidal - radii.capture),
        0,
        100
      );

      if (obj.status !== 'unstable') {
        obj.status = 'unstable';
        logEvent(`${obj.name} has entered an unstable orbit.`, 'info', pos);
        if (obj.type === 'planet') showBanner('PLANETARY BODY DESTABILIZED');
      }

      // Deform mesh along tangential trajectory to simulate tidal stretching
      const k = 1 - r / radii.tidal;
      const stretch = 1 + k * 2.2;
      const base = obj.lifecycleScale || 1;
      const rel = pos.clone().sub(bh.mesh.position);
      const tangent = new THREE.Vector3(-rel.z, 0, rel.x).normalize();

      obj.mesh.up.copy(tangent);
      obj.core.scale.set(base / Math.sqrt(stretch), base * stretch, base / Math.sqrt(stretch));
      obj.core.lookAt(pos.clone().add(tangent));

      if (!obj.lastLog.tidal || state.simTime - obj.lastLog.tidal > 3) {
        logEvent(
          `Tidal forces increasing on ${obj.name}.`,
          r < radii.tidal * 0.4 ? 'critical' : 'info',
          pos
        );
        obj.lastLog.tidal = state.simTime;
      }
    } else {
      // Nominal tidal stress calculation (falls off with inverse cube of distance: F_tidal ~ 1/r^3)
      obj.tidalPercent = Math.min(100 * Math.pow(radii.tidal / Math.max(r, 1), 3), 20);

      if (obj.status === 'unstable' && r > radii.tidal * 1.15) {
        obj.status = 'stable';
        obj.core.scale.setScalar(obj.lifecycleScale || 1);
        obj.core.rotation.set(0, 0, 0);
      }
    }
  } else {
    obj.tidalPercent = 0;
  }

  // Slingshot detection: flags high-speed periapsis acceleration away from the singularity
  if (obj._prevR !== undefined && bh) {
    if (
      obj._closestR !== undefined &&
      obj._closestR < 55 &&
      !obj._slingLogged &&
      r > obj._closestR * 1.4 &&
      obj._prevR < r
    ) {
      logEvent(
        `Gravitational slingshot detected: ${obj.name} is accelerating away from the singularity.`,
        'info',
        pos
      );
      showBanner('GRAVITATIONAL SLINGSHOT DETECTED');
      obj._slingLogged = true;
    }
    if (obj._closestR === undefined || r < obj._closestR) obj._closestR = r;
  }
  obj._prevR = r;

  // Check escape boundary threshold
  if (pos.length() > ESCAPE_R) {
    logEvent(`${obj.name} has escaped the system.`, 'info', pos);
    destroyObject(obj);
    return;
  }

  updateTrail(obj.trail, pos, obj.velocity.length());
  obj.core.rotation.y += dt * obj.rotationSpeed;
}

/* ============================================================================
   BINARY BLACK HOLE DYNAMICS AND MERGERS
   ============================================================================ */

/**
 * Checks for close encounters between binary black holes.
 * Applies artificial orbital decay (approximating energy dissipation via gravitational waves)
 * and triggers a full coalescence when horizons touch.
 *
 * @param {number} dt - Timestep in simulation seconds.
 */
export function updateBlackHoleInteractions(dt) {
  const now = performance.now();
  const bhs = blackHoles();

  for (let i = 0; i < bhs.length; i++) {
    const a = bhs[i];
    if (a._destroyed || now - a._createdAt < COLLISION_GRACE_MS) continue;

    for (let j = i + 1; j < bhs.length; j++) {
      const b = bhs[j];
      if (b._destroyed || now - b._createdAt < COLLISION_GRACE_MS) continue;

      const d = a.mesh.position.distanceTo(b.mesh.position);
      const mergeR = (a.visualRadius + b.visualRadius) * 1.15;
      const decayR = (a.visualRadius + b.visualRadius) * 9;

      if (d < mergeR) {
        mergeBlackHoles(a, b);
        return;
      }

      if (d < decayR) {
        // Gravitational wave inspiral approximation: slow drag damping mutual orbital energy
        const k = (decayR - d) / decayR;
        const drag = 1 - k * 0.01 * Math.min(dt, CONFIG.maxSubstep) * 60;
        a.velocity.multiplyScalar(drag);
        b.velocity.multiplyScalar(drag);
      }
    }
  }
}

/**
 * Resolves the relativistic merger of two black holes into a single remnant.
 * Conserves total mass and center-of-mass momentum, triggers gravitational wave shockwave FX,
 * and imparts an outward kinetic impulse to nearby celestial bodies.
 *
 * @param {BlackHole} a - First black hole.
 * @param {BlackHole} b - Second black hole.
 */
function mergeBlackHoles(a, b) {
  if (a._destroyed || b._destroyed) return;

  const totalMass = a.mass + b.mass;
  // Center-of-mass position and velocity
  const pos = a.mesh.position
    .clone()
    .multiplyScalar(a.mass)
    .add(b.mesh.position.clone().multiplyScalar(b.mass))
    .divideScalar(totalMass);

  const vel = a.velocity
    .clone()
    .multiplyScalar(a.mass)
    .add(b.velocity.clone().multiplyScalar(b.mass))
    .divideScalar(totalMass);

  const name = 'SGR-' + Math.floor(100 + Math.random() * 900) + ' MERGED';

  logEvent('BLACK HOLE MERGER DETECTED', 'critical', pos);
  logEvent(
    `${a.name} and ${b.name} have merged into a single, more massive black hole.`,
    'critical',
    pos
  );
  showBanner('BLACK HOLE MERGER DETECTED');
  cameraShake(1.7, 1300);

  // High-energy particle bursts and expanding gravitational wave energy rings
  particleBurst(pos, { count: 200, color: 0xd8c8ff, spread: 8, size: 2.8, duration: 2600, growth: 12 });
  particleBurst(pos, { count: 110, color: 0x9fd4ff, spread: 6, size: 2, duration: 2200, growth: 9 });
  spawnEnergyRing(pos, 0xd8c8ff, 60, 2400);
  setTimeout(() => spawnEnergyRing(pos, 0x9fd4ff, 72, 2600), 220);
  setTimeout(() => spawnEnergyRing(pos, 0xffffff, 50, 2000), 440);

  // Gravitational wave impulse on surrounding bodies
  for (const body of state.bodies) {
    if (body === a || body === b) continue;
    const diff = body.mesh.position.clone().sub(pos);
    const d = diff.length();
    if (d < 220 && d > 0.01) {
      body.velocity.addScaledVector(diff.normalize(), (1 - d / 220) * 16);
    }
  }

  destroyObject(a);
  destroyObject(b);
  createBlackHole({ position: pos, velocity: vel, mass: totalMass, name });
}

/* ============================================================================
   CELESTIAL BODY COLLISION DETECTION AND RESOLUTION
   ============================================================================ */

/**
 * Performs pairwise sphere-overlap collision checks across all active massive non-singularity bodies.
 */
export function checkBodyCollisions() {
  const now = performance.now();
  const massive = state.bodies.filter(
    (b) => !b._destroyed && b.type !== 'blackhole' && now - b._createdAt > COLLISION_GRACE_MS
  );

  for (let i = 0; i < massive.length; i++) {
    const a = massive[i];
    if (a._destroyed) continue;

    for (let j = i + 1; j < massive.length; j++) {
      const b = massive[j];
      if (b._destroyed) continue;

      const d = a.mesh.position.distanceTo(b.mesh.position);
      if (d < (a.radius + b.radius) * 0.85) {
        handleCollision(a, b);
        return;
      }
    }
  }
}

/**
 * Helper factory to instantiate a coalesced celestial body following an inelastic merger.
 */
function spawnMergedBody(type, pos, vel, mass, radius, name, flavor) {
  const opts = { position: pos, velocity: vel, mass, size: radius, name };
  let obj;
  switch (type) {
    case 'star':
      obj = createStar({ ...opts, tempK: flavor?.tempK });
      break;
    case 'moon':
      obj = createMoon(opts);
      break;
    case 'comet':
      obj = createComet(opts);
      break;
    case 'neutron':
      obj = createNeutronStar(opts);
      break;
    default:
      obj = createPlanet(opts);
      break;
  }
  if (type === 'star' && flavor) {
    obj.age = flavor.age;
    obj.stage = flavor.stage;
    obj.lifecycleScale = flavor.lifecycleScale;
    obj.isHighMass = mass > 11;
    if (obj.stage !== 'main_sequence') obj.core.scale.setScalar(obj.lifecycleScale);
  }
  return obj;
}

/**
 * Resolves a physical collision between two massive bodies.
 *
 * Inelastic regime (|v_rel| < COLLISION_MERGE_SPEED):
 *   Bodies coalesce into a single combined mass, conserving volume (R = (R_1^3 + R_2^3)^(1/3))
 *   and linear momentum.
 *
 * Disruptive regime (|v_rel| >= COLLISION_MERGE_SPEED):
 *   High-velocity impact shatters both progenitors into an expanding debris cloud of asteroids.
 *
 * @param {CelestialBody} a - First colliding body.
 * @param {CelestialBody} b - Second colliding body.
 */
function handleCollision(a, b) {
  if (a._destroyed || b._destroyed) return;

  const relSpeed = a.velocity.clone().sub(b.velocity).length();
  const totalMass = a.mass + b.mass;
  const mergedPos = a.mesh.position
    .clone()
    .multiplyScalar(a.mass)
    .add(b.mesh.position.clone().multiplyScalar(b.mass))
    .divideScalar(totalMass);

  const mergedVel = a.velocity
    .clone()
    .multiplyScalar(a.mass)
    .add(b.velocity.clone().multiplyScalar(b.mass))
    .divideScalar(totalMass);

  const big = a.mass >= b.mass ? a : b;
  const small = a.mass >= b.mass ? b : a;

  if (relSpeed < COLLISION_MERGE_SPEED) {
    // Inelastic coalescence: volume conservation (R_new = (R_a^3 + R_b^3)^(1/3))
    const newRadius = Math.cbrt(Math.pow(a.radius, 3) + Math.pow(b.radius, 3));
    logEvent(`${small.name} has merged into ${big.name}.`, 'critical', mergedPos);
    showBanner(`${big.name}: MASS ABSORBED`);

    particleBurst(mergedPos, {
      count: 60,
      color: 0xffe6b0,
      spread: a.radius + b.radius,
      size: 1.6,
      duration: 1400,
      growth: 4,
    });

    const name = big.name;
    const type = big.type;
    const flavor = big.type === 'star' ? big : null;

    destroyObject(a);
    destroyObject(b);
    spawnMergedBody(type, mergedPos, mergedVel, totalMass, newRadius, name, flavor);
  } else {
    // Catastrophic disruptive fragmentation
    logEvent(`${a.name} and ${b.name} collided at high velocity and shattered.`, 'critical', mergedPos);
    showBanner('HIGH-VELOCITY COLLISION');
    cameraShake(0.8, 500);

    particleBurst(mergedPos, {
      count: 140,
      color: 0xffcf9e,
      spread: (a.radius + b.radius) * 2,
      size: 2.2,
      duration: 2000,
      growth: 8,
    });
    spawnEnergyRing(mergedPos, 0xffb066, 30, 1400);

    // Eject fragmented asteroid debris
    const debrisCount = THREE.MathUtils.clamp(Math.floor(totalMass / 3), 3, 10);
    for (let k = 0; k < debrisCount; k++) {
      if (!state.aPos.length) break;
      const idx = Math.floor(Math.random() * state.aPos.length);
      const dir = new THREE.Vector3(
        Math.random() - 0.5,
        (Math.random() - 0.5) * 0.3,
        Math.random() - 0.5
      ).normalize();
      const p = mergedPos.clone().addScaledVector(dir, (a.radius + b.radius) * (0.5 + Math.random()));
      const v = mergedVel.clone().addScaledVector(dir, relSpeed * 0.4 + Math.random() * 8);
      spawnAsteroid(
        idx,
        p,
        v,
        Math.max((totalMass / debrisCount) * 0.3, 0.1),
        Math.max((a.radius + b.radius) / debrisCount, 0.3)
      );
    }

    destroyObject(a);
    destroyObject(b);
  }
}