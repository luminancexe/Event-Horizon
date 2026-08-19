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
  C_SIM,
  SOFTENING,
  ESCAPE_R,
  AGE_YEARS_PER_SIMSECOND,
  COLLISION_MERGE_SPEED,
  COLLISION_GRACE_MS,
  NUMERICAL_SAFETY_LIMIT,
  FRAME_DRAG_SCALE,
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
  computeTimeDilation,
} from './objects.js';
import { disintegrate, destroyObject, spawnEnergyRing, particleBurst } from './effects.js';
import { cameraShake } from './camera.js';
import { logEvent, showBanner } from './events.js';
import { spawnAsteroid } from './asteroids.js';

/* ============================================================================
   ZERO-ALLOCATION SCRATCH VECTOR POOL
   ============================================================================ */

const _vPred = new THREE.Vector3();
const _vRel = new THREE.Vector3();
const _rRel = new THREE.Vector3();
const _rHat = new THREE.Vector3();
const _bgVec = new THREE.Vector3();
const _ltAcc = new THREE.Vector3();
const _scratchLT = new THREE.Vector3();
const _scratchTidalRel = new THREE.Vector3();
const _scratchTidalTangent = new THREE.Vector3();
const _scratchTidalLook = new THREE.Vector3();

/* ============================================================================
   N-BODY GRAVITATIONAL & RELATIVISTIC ACCELERATION SOLVERS
   ============================================================================ */

/**
 * Computes direct-sum Newtonian gravitational acceleration with Plummer softening:
 *
 *   a_Newt = sum_j ( G * M_j * (r_j - r) / ( |r_j - r|^2 + epsilon^2 )^(3/2) )
 *
 * @param {THREE.Vector3} pos - Target test position.
 * @param {CelestialBody|null} excludeObj - Body to exclude from source sum (e.g. self-interaction).
 * @param {CelestialBody[]} sources - Array of massive celestial bodies.
 * @param {THREE.Vector3} [out] - Optional destination vector to avoid memory allocation.
 * @returns {THREE.Vector3} Net Newtonian acceleration vector.
 */
export function computeNewtonianAcceleration(pos, excludeObj, sources, out) {
  const accel = out ? out.set(0, 0, 0) : new THREE.Vector3();
  if (!CONFIG.gravityEnabled) return accel;

  for (const s of sources) {
    if (s === excludeObj || s._destroyed) continue;
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

/**
 * Computes weak-field Kerr/Lense-Thirring frame-dragging acceleration:
 *
 *   B_g = (G / (C_SIM^2 * r_soft^3)) * [ 3*(J . r_hat)*r_hat - J ]
 *   a_LT = 2 * (v_rel x B_g)
 *
 * Evaluates additive contributions from all active rotating singularities (s.spin != 0).
 * Bypasses calculation beyond the physical influence cutoff (r > max(60 * r_s, 75)).
 *
 * @param {THREE.Vector3} pos - Target test position.
 * @param {THREE.Vector3} vel - Target test velocity.
 * @param {CelestialBody|null} excludeObj - Body to exclude from source sum.
 * @param {CelestialBody[]} sources - Array of massive celestial bodies.
 * @param {THREE.Vector3} [out] - Optional destination vector.
 * @returns {THREE.Vector3} Net Lense-Thirring acceleration vector.
 */
export function computeLenseThirringAcceleration(pos, vel, excludeObj, sources, out) {
  const accel = out ? out.set(0, 0, 0) : new THREE.Vector3();
  if (!CONFIG.frameDragging || !CONFIG.gravityEnabled || !vel) return accel;

  for (const s of sources) {
    if (s === excludeObj || s._destroyed || s.type !== 'blackhole') continue;
    const spin = s.spin;
    if (Math.abs(spin) < 0.001) continue;

    // Relative displacement vector pointing from black hole to test position
    _rRel.set(
      pos.x - s.mesh.position.x,
      pos.y - s.mesh.position.y,
      pos.z - s.mesh.position.z
    );
    const r = _rRel.length();

    // Influence radius derived from relativistic Schwarzschild scale
    const rs = s.schwarzschildRadius || (2 * CONFIG.G * s.mass) / (C_SIM * C_SIM);
    const rInfluence = Math.max(60 * rs, 75.0);
    if (r > rInfluence) continue;

    // Relative velocity: v_rel = v_body - v_bh
    _vRel.copy(vel).sub(s.velocity);

    // Normalized radial direction
    if (r > 0.0001) {
      _rHat.copy(_rRel).multiplyScalar(1 / r);
    } else {
      _rHat.set(0, 1, 0);
    }

    // Singularity angular momentum vector: J = J_sim * S_hat
    const J_mag = s.angularMomentumSim !== undefined
      ? s.angularMomentumSim
      : (spin * CONFIG.G * s.mass * s.mass) / C_SIM;
    const S_hat = s.spinDirection || new THREE.Vector3(0, 1, 0);
    const Jx = S_hat.x * J_mag;
    const Jy = S_hat.y * J_mag;
    const Jz = S_hat.z * J_mag;

    // Softened distance to prevent infinite force spikes near coordinate singularities
    const distSq = r * r + SOFTENING * SOFTENING;
    const distSoft = Math.sqrt(distSq);
    const distSoft3 = distSq * distSoft;

    // Gravito-magnetic dipole field: B_g = (G / (C_SIM^2 * r_soft^3)) * [ 3*(J . r_hat)*r_hat - J ]
    const jDotR = Jx * _rHat.x + Jy * _rHat.y + Jz * _rHat.z;
    const factor = (CONFIG.G * FRAME_DRAG_SCALE) / (C_SIM * C_SIM * distSoft3);

    _bgVec.set(
      factor * (3 * jDotR * _rHat.x - Jx),
      factor * (3 * jDotR * _rHat.y - Jy),
      factor * (3 * jDotR * _rHat.z - Jz)
    );

    // Gravito-Lorentz acceleration: a_LT = 2 * (v_rel x B_g)
    _ltAcc.set(
      2 * (_vRel.y * _bgVec.z - _vRel.z * _bgVec.y),
      2 * (_vRel.z * _bgVec.x - _vRel.x * _bgVec.z),
      2 * (_vRel.x * _bgVec.y - _vRel.y * _bgVec.x)
    );

    // Emergency numerical safety limit (engine crash prevention guard)
    const ltLen = _ltAcc.length();
    if (ltLen > NUMERICAL_SAFETY_LIMIT) {
      _ltAcc.multiplyScalar(NUMERICAL_SAFETY_LIMIT / ltLen);
    }

    accel.add(_ltAcc);
  }
  return accel;
}

/**
 * Evaluates the total combined acceleration:
 *   a_total = a_Newtonian + a_LenseThirring
 *
 * @param {THREE.Vector3} pos - Target position.
 * @param {THREE.Vector3|null} vel - Target velocity (optional for frame-dragging).
 * @param {CelestialBody|null} excludeObj - Excluded body instance.
 * @param {CelestialBody[]} sources - Source bodies.
 * @param {THREE.Vector3} [out] - Output vector.
 * @returns {THREE.Vector3}
 */
export function computeTotalAcceleration(pos, vel, excludeObj, sources, out) {
  const accel = out ? out.set(0, 0, 0) : new THREE.Vector3();
  computeNewtonianAcceleration(pos, excludeObj, sources, accel);
  if (CONFIG.frameDragging && vel) {
    computeLenseThirringAcceleration(pos, vel, excludeObj, sources, _scratchLT);
    accel.add(_scratchLT);
  }
  return accel;
}

/**
 * Backward-compatible acceleration solver wrapper.
 *
 * @param {THREE.Vector3} pos - Target test position.
 * @param {CelestialBody|null} excludeObj - Excluded body.
 * @param {CelestialBody[]} sources - Source bodies.
 * @param {THREE.Vector3} [out] - Destination vector.
 * @param {THREE.Vector3} [vel] - Optional velocity for frame-dragging.
 * @returns {THREE.Vector3}
 */
export function computeAcceleration(pos, excludeObj, sources, out, vel) {
  return computeTotalAcceleration(pos, vel, excludeObj, sources, out);
}

/* ============================================================================
   NUMERICAL INTEGRATION (ADAPTED PREDICTOR-CORRECTOR VERLET)
   ============================================================================ */

/**
 * Advances the positions and velocities of all active massive bodies over a timestep dt
 * using an adapted second-order velocity-predictor/corrector Verlet scheme:
 *
 *   1. x(t + dt) = x(t) + v(t) * dt + 0.5 * a(t) * dt^2
 *   2. v_pred = v(t) + 0.5 * a(t) * dt
 *   3. a(t + dt) = a_Newtonian(x(t + dt)) + a_LT(x(t + dt), v_pred)
 *   4. v(t + dt) = v_pred + 0.5 * a(t + dt) * dt
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

  // Step 2 & 3: Evaluate predicted velocity and calculate new total acceleration
  for (const b of list) {
    _vPred.copy(b.velocity).addScaledVector(b.acceleration, 0.5 * dt);
    computeTotalAcceleration(b.mesh.position, _vPred, b, state.bodies, b._newAcceleration);
  }

  // Step 4: Complete velocity corrector step using trapezoidal acceleration average
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

  if (obj.type === 'blackhole') {
    obj.timeDilation = 0.0;
    obj.age += dt * AGE_YEARS_PER_SIMSECOND;
    updateTrail(obj.trail, obj.mesh.position, obj.velocity.length());
    return;
  }

  const pos = obj.mesh.position;
  obj.timeDilation = computeTimeDilation(pos, obj.velocity, obj);
  obj.properTime = (obj.properTime || 0) + dt * obj.timeDilation;
  obj.age += dt * obj.timeDilation * AGE_YEARS_PER_SIMSECOND;

  const { bh, dist: r } = nearestBlackHole(pos);

  if (bh) {
    const radii = bhRadii(bh, obj);

    // 1. Hills compact-object plunge limit / TDE-disabled fallback vs Continuous TDE
    const isCompactPlunge = radii.tidal <= radii.capture;

    if (!CONFIG.tidalDisruptionEnabled || isCompactPlunge) {
      // Direct horizon crossing -> catastrophic destruction
      if (r < radii.capture) {
        disintegrate(obj, bh);
        return;
      }
    } else {
      // Continuous TDE regime (r_t > r_capture)
      // Core dissolution (Phase 2) or direct plunge
      if (r < radii.capture || obj.mass <= 0.05 * (obj.initialMass || obj.mass)) {
        if (obj.tdePhase === 1) {
          obj.tdePhase = 2;
          state.tdeManager?.emitFinalBurst(obj, bh);
          logEvent(`Tidal disruption complete: ${obj.name} fully dissolved into plasma streams.`, 'critical', pos);
          showBanner(`TIDAL DISRUPTION COMPLETE: ${obj.name}`);
          destroyObject(obj);
          return;
        } else if (r < radii.capture) {
          disintegrate(obj, bh);
          return;
        }
      }
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

    // 3. Roche limit tidal stress, mass shedding, and physical elongation
    if (r < radii.tidal) {
      obj.tidalPercent = THREE.MathUtils.clamp(
        (100 * (radii.tidal - r)) / Math.max(radii.tidal - radii.capture, 0.001),
        0,
        100
      );

      // Continuous TDE mass loss and stream emission (Phase 1: STRIPPING)
      if (CONFIG.tidalDisruptionEnabled && !isCompactPlunge) {
        if (obj.tdePhase === 0) {
          obj.tdePhase = 1;
          obj.initialMass = obj.initialMass || obj.mass;
          obj.disruptedMass = obj.disruptedMass || 0;
          obj._initialRadius = obj._initialRadius || obj.radius;
          logEvent(`Tidal disruption event initiated: ${obj.name} is shedding outer layers.`, 'critical', pos);
          showBanner(`TIDAL DISRUPTION INITIATED: ${obj.name}`);
        }

        const kStrip = 0.45;
        const properTimeRate = obj.timeDilation !== undefined ? obj.timeDilation : 1.0;
        const frac = (radii.tidal - r) / radii.tidal;
        const dM = Math.min(
          obj.mass,
          (obj.initialMass || obj.mass) * kStrip * (frac * frac) * properTimeRate * dt * (CONFIG.tdeStreamDensity || 1.0)
        );

        if (dM > 0) {
          obj.mass = Math.max(0, obj.mass - dM);
          obj.disruptedMass = (obj.disruptedMass || 0) + dM;
          const massRatio = Math.max(0.01, obj.mass / (obj.initialMass || obj.mass));
          obj.radius = (obj._initialRadius || obj.radius) * Math.cbrt(massRatio);
          state.tdeManager?.emit(obj, bh, dM);
        }
      }

      if (obj.status !== 'unstable') {
        obj.status = 'unstable';
        logEvent(`${obj.name} has entered an unstable orbit.`, 'info', pos);
        if (obj.type === 'planet') showBanner('PLANETARY BODY DESTABILIZED');
      }

      // Deform mesh along tangential trajectory using persistent zero-allocation scratch vectors
      const k = 1 - r / radii.tidal;
      const stretch = 1 + k * 2.2;
      const massRatio = obj.initialMass ? obj.mass / obj.initialMass : 1.0;
      const base = (obj.lifecycleScale || 1) * Math.cbrt(Math.max(massRatio, 0.05));
      _scratchTidalRel.subVectors(pos, bh.mesh.position);
      _scratchTidalTangent.set(-_scratchTidalRel.z, 0, _scratchTidalRel.x).normalize();

      obj.mesh.up.copy(_scratchTidalTangent);
      obj.core.scale.set(base / Math.sqrt(stretch), base * stretch, base / Math.sqrt(stretch));
      _scratchTidalLook.addVectors(pos, _scratchTidalTangent);
      obj.core.lookAt(_scratchTidalLook);

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
        const massRatio = obj.initialMass ? obj.mass / obj.initialMass : 1.0;
        const base = (obj.lifecycleScale || 1) * Math.cbrt(Math.max(massRatio, 0.05));
        obj.core.scale.setScalar(base);
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
  obj.core.rotation.y += dt * obj.timeDilation * obj.rotationSpeed;
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