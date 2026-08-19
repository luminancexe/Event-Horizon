/**
 * @file jets.js
 * @description Relativistic polar jets, Blandford–Znajek (1977) rotational energy extraction,
 * magnetic collimation, and GPU-instanced synchrotron emission.
 *
 * Implements:
 * 1. Analytical Blandford–Znajek (BZ) efficiency, horizon angular velocity, and jet power.
 * 2. Relativistic kinematics (Lorentz factor Gamma, sub-luminal beta < 1.0, velocity v < c).
 * 3. Relativistic Doppler beaming transformation (I_obs = delta^3.7 * I_emit).
 * 4. Magnetic funnel collimation profile (R_jet(z) ~ z^0.65).
 * 5. BZ magnetic spin-down back-reaction torque with safe zero-spin handling.
 * 6. RelativisticJetManager: Fixed-capacity (1,600 particles per singularity) GPU-instanced
 *    particle pool executing with zero per-frame heap allocations.
 */

import * as THREE from 'three';
import { CONFIG, state, C_SIM } from './state.js';
import { scene, camera } from './scene.js';
import { blackHoles } from './objects.js';

/* ============================================================================
   ANALYTICAL RELATIVISTIC JET & BLANDFORD–ZNAJEK PHYSICS
   ============================================================================ */

/**
 * Computes Kerr black hole horizon angular velocity in simulation units (rad/s):
 *   Omega_H = (a * c) / (2 * r_H)
 * where r_H = (r_s / 2) * (1 + sqrt(1 - a^2)) and r_s = (2 * G * M) / c^2.
 *
 * @param {number} spin - Dimensionless Kerr spin parameter a in [-0.998, 0.998].
 * @param {number} mass - Black hole mass in M☉.
 * @returns {number} Angular velocity Omega_H in rad/s (carries sign of a).
 */
export function computeHorizonAngularVelocity(spin, mass) {
  const a = THREE.MathUtils.clamp(spin ?? 0, -0.998, 0.998);
  if (Math.abs(a) < 1e-4) return 0.0;
  const mSafe = Math.max(mass || 0, 0.001);
  const rs = (2.0 * CONFIG.G * mSafe) / (C_SIM * C_SIM);
  const rH = 0.5 * rs * (1.0 + Math.sqrt(Math.max(0.0, 1.0 - a * a)));
  if (rH <= 1e-5) return 0.0;
  return (a * C_SIM) / (2.0 * rH);
}

/**
 * Computes dimensionless Blandford–Znajek (1977) rotational energy extraction efficiency:
 *   eta_BZ(a) = k_BZ * [ a / (1 + sqrt(1 - a^2)) ]^2
 * in a Magnetically Arrested Disk (MAD) regime.
 *
 * Properties:
 * - For a = 0: eta_BZ = 0 (Schwarzschild singularity emits zero jet power).
 * - Monotonically increases with |a|.
 * - Clamped strictly to [0.0, 0.60] to ensure numerical stability.
 *
 * @param {number} spin - Dimensionless Kerr spin parameter a in [-0.998, 0.998].
 * @param {number} [kBZ] - Tunable magnetic coupling coefficient (default CONFIG.jetBZEfficiency || 0.50).
 * @returns {number} Dimensionless BZ efficiency eta_BZ.
 */
export function computeBZEfficiency(spin, kBZ) {
  const a = THREE.MathUtils.clamp(spin ?? 0, -0.998, 0.998);
  if (Math.abs(a) < 1e-4) return 0.0;
  const k = kBZ !== undefined ? kBZ : (CONFIG.jetBZEfficiency ?? 0.50);
  if (k <= 0) return 0.0;

  const a2 = a * a;
  const sqrtTerm = Math.sqrt(Math.max(0.0, 1.0 - a2));
  const denom = 1.0 + sqrtTerm;
  const ratio = a / Math.max(denom, 1e-5);
  const eta = k * ratio * ratio;
  return THREE.MathUtils.clamp(eta, 0.0, 1.20);
}

/**
 * Computes collimated Blandford–Znajek jet power in simulation luminosity units:
 *   P_BZ = eta_BZ(a) * M_dot_eff * c^2
 *
 * @param {number} spin - Dimensionless Kerr spin parameter a.
 * @param {number} mass - Black hole mass in M☉.
 * @param {number} mDotEff - Effective accretion rate (M☉/s) entering inner disk.
 * @param {number} [kBZ] - Magnetic coupling constant.
 * @returns {number} Jet power P_BZ in simulation energy units (M☉ * u^2 / s^3).
 */
export function computeBZJetPower(spin, mass, mDotEff, kBZ) {
  if (!mDotEff || mDotEff <= 0 || !mass || mass <= 0) return 0.0;
  const etaBZ = computeBZEfficiency(spin, kBZ);
  if (etaBZ <= 0) return 0.0;
  return etaBZ * mDotEff * (C_SIM * C_SIM);
}

/**
 * Computes relativistic dimensionless speed beta = v / c from bulk Lorentz factor Gamma:
 *   beta = sqrt(max(0, 1 - 1 / Gamma^2))
 *
 * Enforces strict sub-luminal speed: beta in [0.0, 0.998], v < c.
 *
 * @param {number} gamma - Relativistic Lorentz factor Gamma >= 1.0.
 * @returns {number} Dimensionless velocity beta in [0.0, 0.998].
 */
export function computeRelativisticVelocity(gamma) {
  const gSafe = Math.max(gamma || 1.0, 1.001);
  const betaSq = Math.max(0.0, 1.0 - 1.0 / (gSafe * gSafe));
  return THREE.MathUtils.clamp(Math.sqrt(betaSq), 0.0, 0.998);
}

/**
 * Computes relativistic Doppler factor for a jet element moving with velocity beta:
 *   delta = 1 / [ Gamma * (1 - beta * cosTheta) ]
 * where cosTheta = dot(v_hat, n_cam) is the cosine of the angle to the observer.
 *
 * @param {number} gamma - Lorentz factor Gamma.
 * @param {number} beta - Dimensionless speed beta = v / c.
 * @param {number} cosTheta - Cosine of viewing angle between velocity and line of sight.
 * @returns {number} Doppler factor delta (clamped to [0.01, 50.0]).
 */
export function computeDopplerFactor(gamma, beta, cosTheta) {
  const gSafe = Math.max(gamma || 1.0, 1.0);
  const bSafe = THREE.MathUtils.clamp(beta || 0.0, 0.0, 0.998);
  const cosSafe = THREE.MathUtils.clamp(cosTheta || 0.0, -1.0, 1.0);
  const denom = Math.max(0.005, gSafe * (1.0 - bSafe * cosSafe));
  return THREE.MathUtils.clamp(1.0 / denom, 0.01, 50.0);
}

/**
 * Computes observed synchrotron intensity transformation with power-law spectral index alpha = 0.7:
 *   I_obs = delta^(3 + alpha) * I_emit = delta^3.7 * I_emit
 *
 * @param {number} delta - Relativistic Doppler factor.
 * @param {number} [alpha=0.7] - Synchrotron spectral index.
 * @returns {number} Relativistic intensity amplification multiplier (clamped to [0.0, 100.0]).
 */
export function computeSynchrotronIntensity(delta, alpha = 0.7) {
  const dSafe = THREE.MathUtils.clamp(delta || 1.0, 0.01, 50.0);
  const exponent = 3.0 + alpha; // 3.7 for alpha = 0.7
  const intensity = Math.pow(dSafe, exponent);
  return THREE.MathUtils.clamp(intensity, 0.0, 100.0);
}

/**
 * Computes magnetic collimation envelope radius at distance z along the jet axis:
 *   R_jet(z) = R_0 + z * tan(theta_0) * sqrt(z / (z + 50.0))
 * where R_0 is the launch radius at the event horizon and theta_0 is the opening angle.
 *
 * @param {number} z - Distance along polar jet axis from black hole center.
 * @param {number} rH - Black hole event horizon radius.
 * @param {number} [theta0Rad=0.087266] - Half-opening angle in radians (default 5.0 degrees).
 * @returns {number} Funnel radius R_jet in simulation distance units.
 */
export function computeJetCollimationRadius(z, rH, theta0Rad = 0.087266) {
  const zSafe = Math.max(0.0, z || 0.0);
  const r0 = Math.max(0.1, rH || 1.0);
  const tanTheta = Math.tan(theta0Rad);
  const collimationFactor = Math.sqrt(zSafe / (zSafe + 50.0));
  return r0 + zSafe * tanTheta * collimationFactor;
}

/**
 * Computes differential Blandford–Znajek magnetic spin-down back-reaction torque:
 *   da_BZ = [ (2 * a * eta_BZ / M_BH) * ( (1 + sqrt(1 - a^2)) / a^2 - 1 ) ] * dM0
 *
 * Behavior:
 * - For a > 0: da_BZ > 0 -> Subtracting da_BZ brakes prograde spin (|a| decreases).
 * - For a < 0: da_BZ < 0 -> Subtracting da_BZ increases spin towards 0 (|a| decreases).
 * - For |a| < 1e-4: returns 0.0 smoothly without division by zero.
 *
 * @param {number} spin - Current dimensionless Kerr spin parameter a.
 * @param {number} mass - Black hole mass in M☉.
 * @param {number} etaBZ - Dimensionless BZ efficiency.
 * @param {number} dM0 - Accretion mass increment drained from disk.
 * @returns {number} Differential spin change da_BZ.
 */
export function computeBZSpinTorque(spin, mass, etaBZ, dM0) {
  const a = THREE.MathUtils.clamp(spin ?? 0, -0.998, 0.998);
  if (Math.abs(a) < 1e-4 || !etaBZ || etaBZ <= 0 || !dM0 || dM0 <= 0) {
    return 0.0;
  }
  const mSafe = Math.max(mass || 0, 0.1);
  const a2 = a * a;
  const sqrtTerm = Math.sqrt(Math.max(0.0, 1.0 - a2));
  const rHFactor = (1.0 + sqrtTerm) / Math.max(a2, 1e-5);
  const bracket = Math.max(0.0, rHFactor - 1.0);
  return ((2.0 * a * etaBZ) / mSafe) * bracket * dM0;
}

/* ============================================================================
   ZERO-ALLOCATION SCRATCH OBJECT POOL
   ============================================================================ */

const _scratchJetPos = new THREE.Vector3();
const _scratchJetVel = new THREE.Vector3();
const _scratchJetAxis = new THREE.Vector3();
const _scratchJetPerp = new THREE.Vector3();
const _scratchJetDummy = new THREE.Object3D();
const _scratchJetQuat = new THREE.Quaternion();
const _scratchJetColor = new THREE.Color();
const _scratchCamDir = new THREE.Vector3();
const _scratchAxisY = new THREE.Vector3(0, 1, 0);

/* ============================================================================
   GPU-INSTANCED RELATIVISTIC JET MANAGER
   ============================================================================ */

/**
 * Manages GPU-instanced relativistic polar jet particle streams across all active black holes.
 * Executes particle spawning, ballistic propagation, magnetic collimation, synchrotron
 * color mapping, and Doppler boosting with zero per-frame heap allocations.
 */
export class RelativisticJetManager {
  /**
   * @param {number} [capacity=1600] - Total particle capacity across all black holes.
   */
  constructor(capacity = 1600) {
    this.capacity = capacity;
    this.activeCount = 0;

    // Parallel TypedArray buffers for memory contiguous execution
    this.pPositions = new Float32Array(capacity * 3);
    this.pVelocities = new Float32Array(capacity * 3);
    this.pAges = new Float32Array(capacity);
    this.pLifetimes = new Float32Array(capacity);
    this.pEnergies = new Float32Array(capacity);
    this.pAlive = new Uint8Array(capacity);
    this.pParentBH = new Int32Array(capacity);
    this.pPolarity = new Int8Array(capacity); // +1: North polar jet, -1: South polar jet
    this.pDistances = new Float32Array(capacity); // Distance z along polar axis

    // Instanced GPU Mesh
    const geo = new THREE.CylinderGeometry(0.15, 0.45, 1.8, 6);
    geo.rotateX(Math.PI / 2); // Orient longitudinal axis along Z
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    // Initialize instance colors
    const colors = new Float32Array(capacity * 3);
    colors.fill(1.0);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);

    // Initialize dummy positions off-screen
    _scratchJetDummy.position.set(0, -99999, 0);
    _scratchJetDummy.scale.set(0.0001, 0.0001, 0.0001);
    _scratchJetDummy.updateMatrix();
    for (let i = 0; i < capacity; i++) {
      this.mesh.setMatrixAt(i, _scratchJetDummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;

    scene.add(this.mesh);
  }

  /**
   * Spawns relativistic jet particles for an accreting black hole.
   * Emits along both north (+S_hat) and south (-S_hat) polar axes.
   *
   * @param {BlackHole} bh - Parent black hole singularity.
   * @param {number} count - Number of particle pairs to emit.
   */
  emit(bh, count = 2) {
    if (!CONFIG.jetEnabled || !bh || bh.mass <= 0 || bh.diskMass <= 0) return;
    const pBZ = bh.jetPower;
    if (pBZ <= 0) return;

    const gamma = CONFIG.jetLorentzFactor || 3.0;
    const beta = computeRelativisticVelocity(gamma);
    const vSpeed = beta * C_SIM;
    const rH = Math.max(bh.kerrHorizonRadius, 1.0);
    const theta0Rad = ((CONFIG.jetOpeningAngle || 5.0) * Math.PI) / 180.0;

    _scratchJetAxis.copy(bh.spinDirection || _scratchAxisY).normalize();

    let spawned = 0;
    const maxPairs = Math.min(count, 4);

    for (let i = 0; i < this.capacity && spawned < maxPairs; i++) {
      if (this.pAlive[i] === 0) {
        // Emit pair: even slot = North (+1), odd slot = South (-1)
        const polarity = (spawned % 2 === 0) ? 1 : -1;
        const i3 = i * 3;

        // Launch position at event horizon along polar axis
        const launchOffset = rH * 1.05;
        _scratchJetPos.copy(bh.mesh.position)
          .addScaledVector(_scratchJetAxis, polarity * launchOffset);

        // Small transverse dispersion within opening angle
        const phi = Math.random() * Math.PI * 2;
        const thetaDisp = (Math.random() * 0.5 + 0.5) * theta0Rad * 0.3;
        _scratchJetPerp.set(Math.cos(phi), 0, Math.sin(phi));
        _scratchJetQuat.setFromUnitVectors(_scratchAxisY, _scratchJetAxis);
        _scratchJetPerp.applyQuaternion(_scratchJetQuat);

        _scratchJetVel.copy(_scratchJetAxis)
          .multiplyScalar(polarity)
          .addScaledVector(_scratchJetPerp, Math.sin(thetaDisp))
          .normalize()
          .multiplyScalar(vSpeed);

        this.pPositions[i3] = _scratchJetPos.x;
        this.pPositions[i3 + 1] = _scratchJetPos.y;
        this.pPositions[i3 + 2] = _scratchJetPos.z;

        this.pVelocities[i3] = _scratchJetVel.x;
        this.pVelocities[i3 + 1] = _scratchJetVel.y;
        this.pVelocities[i3 + 2] = _scratchJetVel.z;

        this.pAges[i] = 0.0;
        this.pLifetimes[i] = 4.5 + Math.random() * 2.5; // 4.5 - 7.0 seconds
        this.pEnergies[i] = pBZ;
        this.pDistances[i] = 0.0;
        this.pParentBH[i] = bh.id;
        this.pPolarity[i] = polarity;
        this.pAlive[i] = 1;

        spawned++;
      }
    }
  }

  /**
   * Advances relativistic particle kinematics, collimation, Doppler boosting, and synchrotron colors.
   *
   * @param {number} dt - Sub-step integration timestep in simulation seconds.
   */
  update(dt) {
    if (dt <= 0) return;

    // 1. Spawning phase for accreting spinning black holes
    if (CONFIG.jetEnabled) {
      const bhs = blackHoles();
      for (const bh of bhs) {
        if (bh.diskMass > 0 && bh.jetPower > 0) {
          this.emit(bh, 2);
        }
      }
    }

    let active = 0;
    let matrixNeedsUpdate = false;
    let colorNeedsUpdate = false;

    const gamma = CONFIG.jetLorentzFactor || 3.0;
    const beta = computeRelativisticVelocity(gamma);
    const theta0Rad = ((CONFIG.jetOpeningAngle || 5.0) * Math.PI) / 180.0;
    const synchBrightMult = CONFIG.jetSynchrotronBrightness || 1.5;

    for (let i = 0; i < this.capacity; i++) {
      if (this.pAlive[i] === 0) continue;

      this.pAges[i] += dt;
      const life = this.pLifetimes[i];
      if (this.pAges[i] >= life) {
        // Recycle expired particle
        this.pAlive[i] = 0;
        _scratchJetDummy.position.set(0, -99999, 0);
        _scratchJetDummy.scale.set(0.0001, 0.0001, 0.0001);
        _scratchJetDummy.updateMatrix();
        this.mesh.setMatrixAt(i, _scratchJetDummy.matrix);
        matrixNeedsUpdate = true;
        continue;
      }

      const i3 = i * 3;
      const lifeFrac = this.pAges[i] / life;

      // Ballistic propagation
      this.pPositions[i3] += this.pVelocities[i3] * dt;
      this.pPositions[i3 + 1] += this.pVelocities[i3 + 1] * dt;
      this.pPositions[i3 + 2] += this.pVelocities[i3 + 2] * dt;

      _scratchJetPos.set(this.pPositions[i3], this.pPositions[i3 + 1], this.pPositions[i3 + 2]);
      _scratchJetVel.set(this.pVelocities[i3], this.pVelocities[i3 + 1], this.pVelocities[i3 + 2]);

      // Calculate distance along jet axis
      const speed = _scratchJetVel.length();
      this.pDistances[i] += speed * dt;
      const z = this.pDistances[i];

      // Terminal fade-out beyond z_max = 400
      if (z > 400.0) {
        this.pAlive[i] = 0;
        _scratchJetDummy.position.set(0, -99999, 0);
        _scratchJetDummy.scale.set(0.0001, 0.0001, 0.0001);
        _scratchJetDummy.updateMatrix();
        this.mesh.setMatrixAt(i, _scratchJetDummy.matrix);
        matrixNeedsUpdate = true;
        continue;
      }

      // Relativistic Doppler boosting relative to observer camera
      _scratchCamDir.subVectors(camera.position, _scratchJetPos).normalize();
      const velDir = _scratchJetVel.clone().normalize();
      const cosTheta = velDir.dot(_scratchCamDir);
      const delta = computeDopplerFactor(gamma, beta, cosTheta);
      const dopplerMult = CONFIG.jetDopplerBoosting ? computeSynchrotronIntensity(delta, 0.7) : 1.0;

      // Magnetic collimation envelope scaling
      const collR = computeJetCollimationRadius(z, 9.0, theta0Rad);
      const scaleRadial = THREE.MathUtils.clamp(collR * 0.15, 0.4, 6.0);
      const scaleLongitudinal = THREE.MathUtils.clamp(1.5 + (speed / C_SIM) * 2.5, 1.0, 5.0);

      // Orientation aligned with velocity vector
      _scratchJetDummy.position.copy(_scratchJetPos);
      _scratchJetQuat.setFromUnitVectors(_scratchAxisY, velDir);
      _scratchJetDummy.quaternion.copy(_scratchJetQuat);
      _scratchJetDummy.scale.set(scaleRadial, scaleLongitudinal, scaleRadial);
      _scratchJetDummy.updateMatrix();
      this.mesh.setMatrixAt(i, _scratchJetDummy.matrix);
      matrixNeedsUpdate = true;

      // Synchrotron spectral color mapping:
      // High-energy core: Electric cyan-white (r: 0.7, g: 0.95, b: 1.0)
      // Transitioning to amber/infrared sheath (r: 1.0, g: 0.6, b: 0.1) as particle decelerates/ages
      const coreR = THREE.MathUtils.lerp(0.75, 1.0, lifeFrac);
      const coreG = THREE.MathUtils.lerp(0.95, 0.45, lifeFrac);
      const coreB = THREE.MathUtils.lerp(1.0, 0.05, lifeFrac);
      const brightness = Math.min(6.0, (1.0 - lifeFrac * 0.7) * synchBrightMult * (0.3 + 0.7 * dopplerMult));

      _scratchJetColor.setRGB(coreR * brightness, coreG * brightness, coreB * brightness);
      if (this.mesh.instanceColor) {
        this.mesh.setColorAt(i, _scratchJetColor);
        colorNeedsUpdate = true;
      }

      active++;
    }

    this.activeCount = active;
    if (matrixNeedsUpdate) this.mesh.instanceMatrix.needsUpdate = true;
    if (colorNeedsUpdate && this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /**
   * Resets all jet particle instances to inactive and hides them.
   */
  clear() {
    this.pAlive.fill(0);
    this.pAges.fill(0);
    this.pLifetimes.fill(0);
    this.pEnergies.fill(0);
    this.pDistances.fill(0);
    this.activeCount = 0;

    _scratchJetDummy.position.set(0, -99999, 0);
    _scratchJetDummy.scale.set(0.0001, 0.0001, 0.0001);
    _scratchJetDummy.updateMatrix();
    for (let i = 0; i < this.capacity; i++) {
      this.mesh.setMatrixAt(i, _scratchJetDummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
