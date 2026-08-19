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
import { createBlackHole, createNeutronStar, computeTimeDilation, blackHoles, bhRadii } from './objects.js';
import { computeTotalAcceleration } from './physics.js';
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
   CONTINUOUS TIDAL DISRUPTION & PLASMA STREAM MANAGER (PHASE 4: STEP 6)
   ============================================================================ */

export const MAX_STREAM_PARTICLES = 1600;
export const MAX_ACTIVE_TDES = 4;

// Persistent module-level scratch objects for zero runtime allocations
const _scratchTdePos = new THREE.Vector3();
const _scratchTdeVel = new THREE.Vector3();
const _scratchTdeAcc = new THREE.Vector3();
const _scratchTdeRVec = new THREE.Vector3();
const _scratchTdeRHat = new THREE.Vector3();
const _scratchTdeVHat = new THREE.Vector3();
const _scratchTdeTHat = new THREE.Vector3();
const _scratchTdeLeadPos = new THREE.Vector3();
const _scratchTdeTrailPos = new THREE.Vector3();
const _scratchTdeLeadVel = new THREE.Vector3();
const _scratchTdeTrailVel = new THREE.Vector3();
const _scratchTdeColor = new THREE.Color();
const _scratchTdeDummy = new THREE.Object3D();
const _scratchColorLead = new THREE.Color();
const _scratchColorTrail = new THREE.Color();
const _scratchDiskNormal = new THREE.Vector3();
const _scratchDiskRel = new THREE.Vector3();

/**
 * High-performance GPU-instanced stream manager for continuous relativistic
 * tidal disruption events (TDE) and plasma debris streams.
 *
 * Implements:
 * 1. Fixed-capacity pre-allocated InstancedMesh (1600 particles max).
 * 2. Deterministic FIFO ring-buffer recycling upon pool exhaustion (zero runtime allocations).
 * 3. Symplectic multi-black-hole gravitational and Lense-Thirring integration.
 * 4. Relativistic proper time rate (dTau/dt) governing particle aging and thermal cooling.
 * 5. Swept disk-plane intersection and circularization with atomic mass transfer to disk reservoir.
 * 6. Single-transfer atomic mass accretion to singularities + accretion flaring.
 * 7. Ejecta mass tracking for uncaptured particles to maintain 5-component conservation.
 */
export class TDEStreamManager {
  constructor() {
    this.capacity = MAX_STREAM_PARTICLES;
    this.pPositions = new Float32Array(this.capacity * 3);
    this.pVelocities = new Float32Array(this.capacity * 3);
    this.pColors = new Float32Array(this.capacity * 3);
    this.pScales = new Float32Array(this.capacity);
    this.pAges = new Float32Array(this.capacity);
    this.pMaxLifes = new Float32Array(this.capacity);
    this.pMasses = new Float32Array(this.capacity);
    this.pAlive = new Uint8Array(this.capacity);
    this.pBHIndex = new Int32Array(this.capacity);
    this.pPrevH = new Float32Array(this.capacity);

    this.activeCount = 0;
    this.nextRecycleIdx = 0;

    // Instanced mesh geometry and bloom-compatible additive material
    const geo = new THREE.IcosahedronGeometry(0.35, 1);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.mesh = new THREE.InstancedMesh(geo, mat, this.capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (this.mesh.instanceColor) {
      this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    }
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);

    // Initialize all instances outside camera frustum
    _scratchTdeDummy.position.set(0, -99999, 0);
    _scratchTdeDummy.scale.set(0.0001, 0.0001, 0.0001);
    _scratchTdeDummy.updateMatrix();
    for (let i = 0; i < this.capacity; i++) {
      this.mesh.setMatrixAt(i, _scratchTdeDummy.matrix);
      if (this.mesh.instanceColor) {
        this.mesh.setColorAt(i, _scratchTdeColor.setHex(0xffffff));
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /**
   * Finds an available particle index using priority:
   * 1. Inactive slot (pAlive === 0)
   * 2. Faded particle (pAges / pMaxLifes > 0.85)
   * 3. Deterministic FIFO ring-buffer recycling
   *
   * @returns {number} Particle index in [0, capacity - 1].
   */
  allocateSlot() {
    // 1. Search for dead slot
    for (let i = 0; i < this.capacity; i++) {
      if (this.pAlive[i] === 0) {
        this.pPrevH[i] = 0;
        return i;
      }
    }
    // 2. Search for faded particle
    for (let i = 0; i < this.capacity; i++) {
      const idx = (this.nextRecycleIdx + i) % this.capacity;
      if (this.pAges[idx] / Math.max(this.pMaxLifes[idx], 0.001) > 0.85) {
        this.nextRecycleIdx = (idx + 1) % this.capacity;
        this.pPrevH[idx] = 0;
        return idx;
      }
    }
    // 3. FIFO recycling
    const idx = this.nextRecycleIdx;
    this.nextRecycleIdx = (this.nextRecycleIdx + 1) % this.capacity;
    this.pPrevH[idx] = 0;
    return idx;
  }

  /**
   * Emits a leading and trailing plasma packet pair from a stripping progenitor.
   *
   * @param {CelestialBody} body - Stripping celestial body.
   * @param {BlackHole} bh - Attracting singularity.
   * @param {number} dM - Stripped mass packet in simulation mass units.
   */
  emit(body, bh, dM) {
    if (!CONFIG.tidalDisruptionEnabled || dM <= 0) return;

    const pBody = body.mesh.position;
    const vBody = body.velocity;
    const pBH = bh.mesh.position;

    _scratchTdeRVec.subVectors(pBody, pBH);
    const r = _scratchTdeRVec.length();
    if (r < 0.001) return;
    _scratchTdeRHat.copy(_scratchTdeRVec).multiplyScalar(1 / r);

    const speed = vBody.length();
    if (speed > 0.001) {
      _scratchTdeVHat.copy(vBody).multiplyScalar(1 / speed);
      const vDotR = _scratchTdeVHat.dot(_scratchTdeRHat);
      _scratchTdeTHat.copy(_scratchTdeVHat).addScaledVector(_scratchTdeRHat, -vDotR);
      const tLen = _scratchTdeTHat.length();
      if (tLen > 0.0001) {
        _scratchTdeTHat.multiplyScalar(1 / tLen);
      } else if (bh.spinDirection) {
        _scratchTdeTHat.crossVectors(bh.spinDirection, _scratchTdeRHat).normalize();
      } else {
        _scratchTdeTHat.set(-_scratchTdeRHat.z, 0, _scratchTdeRHat.x).normalize();
      }
    } else if (bh.spinDirection) {
      _scratchTdeTHat.crossVectors(bh.spinDirection, _scratchTdeRHat).normalize();
    } else {
      _scratchTdeTHat.set(-_scratchTdeRHat.z, 0, _scratchTdeRHat.x).normalize();
    }

    // Differential Keplerian orbital velocity dispersion across progenitor diameter
    const dVTidal = 0.5 * Math.sqrt(Math.max((CONFIG.G * bh.mass) / r, 0)) * (body.radius / Math.max(r, 0.1));

    // Leading packet: inner limb (closer to BH, lower energy -> leads orbit)
    _scratchTdeLeadPos.copy(pBody).addScaledVector(_scratchTdeRHat, -0.8 * body.radius);
    _scratchTdeLeadVel.copy(vBody).addScaledVector(_scratchTdeTHat, -dVTidal);

    // Trailing packet: outer limb (farther from BH, higher energy -> lags orbit)
    _scratchTdeTrailPos.copy(pBody).addScaledVector(_scratchTdeRHat, 0.8 * body.radius);
    _scratchTdeTrailVel.copy(vBody).addScaledVector(_scratchTdeTHat, dVTidal);

    const massPerParticle = dM * 0.5;
    const densityMult = THREE.MathUtils.clamp(CONFIG.tdeStreamDensity || 1.0, 0.5, 2.0);
    const maxLife = 5.5 * densityMult;

    // Progenitor color base
    const baseColorHex = body.core?.material?.color ? body.core.material.color.getHex() : (body.type === 'star' ? 0xfff2c0 : 0x88ccff);
    _scratchColorLead.setHex(baseColorHex);
    _scratchColorTrail.setHex(baseColorHex);

    _scratchDiskNormal.copy(bh.spinDirection || _scratchNormalY).normalize();

    // Spawn Leading Packet
    const iLead = this.allocateSlot();
    this.pPositions[iLead * 3] = _scratchTdeLeadPos.x;
    this.pPositions[iLead * 3 + 1] = _scratchTdeLeadPos.y;
    this.pPositions[iLead * 3 + 2] = _scratchTdeLeadPos.z;
    this.pVelocities[iLead * 3] = _scratchTdeLeadVel.x;
    this.pVelocities[iLead * 3 + 1] = _scratchTdeLeadVel.y;
    this.pVelocities[iLead * 3 + 2] = _scratchTdeLeadVel.z;
    this.pColors[iLead * 3] = _scratchColorLead.r;
    this.pColors[iLead * 3 + 1] = _scratchColorLead.g;
    this.pColors[iLead * 3 + 2] = _scratchColorLead.b;
    this.pScales[iLead] = Math.max(body.radius * 0.35, 0.25);
    this.pAges[iLead] = 0;
    this.pMaxLifes[iLead] = maxLife;
    this.pMasses[iLead] = massPerParticle;
    this.pAlive[iLead] = 1;
    this.pBHIndex[iLead] = bh.id;
    _scratchDiskRel.subVectors(_scratchTdeLeadPos, pBH);
    this.pPrevH[iLead] = _scratchDiskRel.dot(_scratchDiskNormal);

    // Spawn Trailing Packet
    const iTrail = this.allocateSlot();
    this.pPositions[iTrail * 3] = _scratchTdeTrailPos.x;
    this.pPositions[iTrail * 3 + 1] = _scratchTdeTrailPos.y;
    this.pPositions[iTrail * 3 + 2] = _scratchTdeTrailPos.z;
    this.pVelocities[iTrail * 3] = _scratchTdeTrailVel.x;
    this.pVelocities[iTrail * 3 + 1] = _scratchTdeTrailVel.y;
    this.pVelocities[iTrail * 3 + 2] = _scratchTdeTrailVel.z;
    this.pColors[iTrail * 3] = _scratchColorTrail.r;
    this.pColors[iTrail * 3 + 1] = _scratchColorTrail.g;
    this.pColors[iTrail * 3 + 2] = _scratchColorTrail.b;
    this.pScales[iTrail] = Math.max(body.radius * 0.35, 0.25);
    this.pAges[iTrail] = 0;
    this.pMaxLifes[iTrail] = maxLife;
    this.pMasses[iTrail] = massPerParticle;
    this.pAlive[iTrail] = 1;
    this.pBHIndex[iTrail] = bh.id;
    _scratchDiskRel.subVectors(_scratchTdeTrailPos, pBH);
    this.pPrevH[iTrail] = _scratchDiskRel.dot(_scratchDiskNormal);
  }

  /**
   * Emits a multi-particle burst when a progenitor core completely dissolves (Phase 2).
   *
   * @param {CelestialBody} body - Disrupted body.
   * @param {BlackHole} bh - Attracting singularity.
   */
  emitFinalBurst(body, bh) {
    const burstCount = 14;
    const remainingMass = Math.max(body.mass, 0.001);
    const dM = remainingMass / burstCount;
    for (let k = 0; k < burstCount / 2; k++) {
      this.emit(body, bh, dM * 2);
    }
    triggerDiskBurst(bh, 0.40 + body.mass * 0.01);
    spawnEnergyRing(bh.mesh.position, body.type === 'star' ? 0xfff2c8 : 0x88ccff);
  }

  /**
   * Advances all active stream particles over timestep dt.
   * Handles multi-singularity gravity, proper time aging, swept disk intersection,
   * atomic disk mass transfer, horizon capture, and ejecta tracking.
   *
   * @param {number} dt - Timestep in simulation seconds.
   */
  update(dt) {
    if (!CONFIG.tidalDisruptionEnabled && this.activeCount === 0) return;

    let active = 0;
    const bhs = blackHoles();
    let matrixNeedsUpdate = false;
    let colorNeedsUpdate = false;

    for (let i = 0; i < this.capacity; i++) {
      if (this.pAlive[i] === 0) continue;

      const i3 = i * 3;
      _scratchTdePos.set(this.pPositions[i3], this.pPositions[i3 + 1], this.pPositions[i3 + 2]);
      _scratchTdeVel.set(this.pVelocities[i3], this.pVelocities[i3 + 1], this.pVelocities[i3 + 2]);

      // Relativistic time dilation rate dTau/dt
      const properTimeRate = computeTimeDilation(_scratchTdePos, _scratchTdeVel, null);
      this.pAges[i] += dt * Math.max(properTimeRate, 0.001);

      // 1. Check horizon capture against all active black holes
      let captured = false;
      for (const bh of bhs) {
        const dist = _scratchTdePos.distanceTo(bh.mesh.position);
        const radii = bhRadii(bh);
        if (dist < radii.capture) {
          // Atomic direct horizon accretion
          this.pAlive[i] = 0;
          const dm = this.pMasses[i];
          this.pMasses[i] = 0;
          bh.mass += dm;
          state.tdeTotalAccretedMass = (state.tdeTotalAccretedMass || 0) + dm;
          triggerDiskBurst(bh, 0.04 + dm * 0.02);
          _scratchTdeDummy.position.set(0, -99999, 0);
          _scratchTdeDummy.scale.set(0.0001, 0.0001, 0.0001);
          _scratchTdeDummy.updateMatrix();
          this.mesh.setMatrixAt(i, _scratchTdeDummy.matrix);
          matrixNeedsUpdate = true;
          captured = true;
          break;
        }
      }
      if (captured) continue;

      // 2. Check swept accretion disk plane intersection & circularization
      let targetBh = null;
      for (const b of bhs) {
        if (b.id === this.pBHIndex[i]) {
          targetBh = b;
          break;
        }
      }
      if (!targetBh && bhs.length > 0) targetBh = bhs[0];

      if (targetBh && targetBh.spinDirection && targetBh.diskMesh) {
        _scratchDiskNormal.copy(targetBh.spinDirection).normalize();
        _scratchDiskRel.subVectors(_scratchTdePos, targetBh.mesh.position);
        const hCurr = _scratchDiskRel.dot(_scratchDiskNormal);
        const hPrev = this.pPrevH[i];
        const hThick = CONFIG.tdeDiskThickness || 1.2;
        const rPlaneSq = Math.max(0, _scratchDiskRel.lengthSq() - hCurr * hCurr);
        const rPlane = Math.sqrt(rPlaneSq);

        const radii = bhRadii(targetBh);
        const iscoNorm = radii.schwarzschild > 0 ? targetBh.iscoRadius / (3 * radii.schwarzschild) : 1.0;
        const rInner = targetBh.visualRadius * (1.0 + 0.20 * iscoNorm);
        const rOuter = targetBh.visualRadius * (targetBh.diskScale || 6.5);

        // Swept crossing test across disk plane within disk radial annulus
        const sweptCrossing =
          (hPrev * hCurr <= 0 && (Math.abs(hPrev) > 0.0001 || Math.abs(hCurr) > 0.0001)) ||
          Math.abs(hCurr) <= hThick;

        if (sweptCrossing && rPlane >= rInner && rPlane <= rOuter) {
          // Stream -> Disk atomic transfer with shock dissipation
          this.pAlive[i] = 0;
          const dm = this.pMasses[i];
          this.pMasses[i] = 0;
          targetBh.diskMass = (targetBh.diskMass || 0) + dm;
          triggerDiskBurst(targetBh, 0.08 + dm * 0.05);

          _scratchTdeDummy.position.set(0, -99999, 0);
          _scratchTdeDummy.scale.set(0.0001, 0.0001, 0.0001);
          _scratchTdeDummy.updateMatrix();
          this.mesh.setMatrixAt(i, _scratchTdeDummy.matrix);
          matrixNeedsUpdate = true;
          continue;
        }
        this.pPrevH[i] = hCurr;
      }

      // 3. Check expiration / ejecta escape
      if (this.pAges[i] >= this.pMaxLifes[i]) {
        this.pAlive[i] = 0;
        const dm = this.pMasses[i];
        this.pMasses[i] = 0;
        state.tdeEjectaMass = (state.tdeEjectaMass || 0) + dm;
        _scratchTdeDummy.position.set(0, -99999, 0);
        _scratchTdeDummy.scale.set(0.0001, 0.0001, 0.0001);
        _scratchTdeDummy.updateMatrix();
        this.mesh.setMatrixAt(i, _scratchTdeDummy.matrix);
        matrixNeedsUpdate = true;
        continue;
      }

      // 4. Gravitational acceleration (Newtonian direct-sum + Lense-Thirring)
      computeTotalAcceleration(_scratchTdePos, _scratchTdeVel, null, state.bodies, _scratchTdeAcc);

      // Symplectic velocity & position integration
      _scratchTdeVel.addScaledVector(_scratchTdeAcc, dt);
      _scratchTdePos.addScaledVector(_scratchTdeVel, dt);

      this.pPositions[i3] = _scratchTdePos.x;
      this.pPositions[i3 + 1] = _scratchTdePos.y;
      this.pPositions[i3 + 2] = _scratchTdePos.z;
      this.pVelocities[i3] = _scratchTdeVel.x;
      this.pVelocities[i3 + 1] = _scratchTdeVel.y;
      this.pVelocities[i3 + 2] = _scratchTdeVel.z;

      // Thermal evolution: white/cyan -> orange/red -> fade
      const lifeFrac = this.pAges[i] / this.pMaxLifes[i];
      const baseR = this.pColors[i3];
      const baseG = this.pColors[i3 + 1];
      const baseB = this.pColors[i3 + 2];

      if (lifeFrac < 0.25) {
        // High-energy initial state: white-hot boost
        _scratchTdeColor.setRGB(
          Math.min(1.0, baseR * 1.3 + 0.3),
          Math.min(1.0, baseG * 1.3 + 0.3),
          Math.min(1.0, baseB * 1.3 + 0.4)
        );
      } else if (lifeFrac < 0.65) {
        // Radiative cooling: warm orange/gold
        const t = (lifeFrac - 0.25) / 0.40;
        _scratchTdeColor.setRGB(
          baseR * (1 - t * 0.2),
          baseG * (1 - t * 0.5),
          baseB * (1 - t * 0.8)
        );
      } else {
        // Dissipating tail: deep red cooling
        const t = (lifeFrac - 0.65) / 0.35;
        _scratchTdeColor.setRGB(
          baseR * (0.8 - t * 0.5),
          baseG * (0.5 - t * 0.4),
          baseB * (0.2 - t * 0.2)
        );
      }

      const scale = this.pScales[i] * (1.0 - lifeFrac * 0.45);
      _scratchTdeDummy.position.copy(_scratchTdePos);
      _scratchTdeDummy.scale.set(scale, scale, scale);
      _scratchTdeDummy.updateMatrix();
      this.mesh.setMatrixAt(i, _scratchTdeDummy.matrix);
      if (this.mesh.instanceColor) {
        this.mesh.setColorAt(i, _scratchTdeColor);
        colorNeedsUpdate = true;
      }
      matrixNeedsUpdate = true;
      active++;
    }

    this.activeCount = active;
    if (matrixNeedsUpdate) this.mesh.instanceMatrix.needsUpdate = true;
    if (colorNeedsUpdate && this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /**
   * Advances viscous accretion flow from disk reservoirs into black hole singularities.
   *
   * @param {number} dt - Timestep in simulation seconds.
   */
  updateViscousAccretion(dt) {
    const bhs = blackHoles();
    for (const bh of bhs) {
      if (bh.diskMass > 0) {
        const tau = CONFIG.tdeViscousTimescale || 6.0;
        const mDot = tau > 0 ? bh.diskMass / tau : 0;
        const dM = Math.min(bh.diskMass, mDot * dt);
        if (dM > 0) {
          bh.diskMass = Math.max(0, bh.diskMass - dM);
          bh.mass += dM;
          state.tdeTotalAccretedMass = (state.tdeTotalAccretedMass || 0) + dM;
        }
      }
    }
  }

  /**
   * Resets all particle states and clears instances.
   */
  clear() {
    this.pAlive.fill(0);
    this.pAges.fill(0);
    this.pMasses.fill(0);
    this.pPrevH.fill(0);
    this.activeCount = 0;
    _scratchTdeDummy.position.set(0, -99999, 0);
    _scratchTdeDummy.scale.set(0.0001, 0.0001, 0.0001);
    _scratchTdeDummy.updateMatrix();
    for (let i = 0; i < this.capacity; i++) {
      this.mesh.setMatrixAt(i, _scratchTdeDummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
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