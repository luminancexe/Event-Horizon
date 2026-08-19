/**
 * @file objects.js
 * @description Celestial body class hierarchy, factory builders, orbital kinematics, and motion trails.
 *
 * Defines the core object model (`CelestialBody` and specialized subclasses), factory functions for
 * procedural entity instantiation, Keplerian orbital velocity solvers, and GPU buffer management
 * for dynamic orbital history trails.
 */

import * as THREE from 'three';
import {
  CONFIG,
  state,
  C_SIM,
  BH_MASS_CLASSES,
  BASE_HORIZON,
  BASE_BH_MASS,
  CAPTURE_MULT,
  TIDAL_MULT,
  DRAG_MULT,
  STAR_LIFESPAN_K,
  AGE_YEARS_PER_SIMSECOND,
} from './state.js';
import { scene, createDiskMaterial } from './scene.js';
import { makeGlowTexture, makeRingTexture, starGlowTex } from './textures.js';
import { registerSelectable } from './selection.js';

/* ============================================================================
   ORBITAL TRAIL BUFFER SYSTEM
   ============================================================================ */

/**
 * Creates a circular buffer-backed orbital motion trail.
 *
 * @param {number|THREE.Color} color - Trail line color.
 * @param {number} [opacity=0.35] - Base line opacity.
 * @param {boolean} [additive=false] - Whether to use AdditiveBlending.
 * @returns {object} Trail instance containing GPU geometry and pre-allocated buffer arrays.
 */
export function createTrail(color, opacity = 0.35, additive = false) {
  const maxLen = CONFIG.trailLength;
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(maxLen * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setDrawRange(0, 0);

  const mat = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });

  const line = new THREE.Line(geo, mat);
  scene.add(line);

  // Pre-allocate vector pool to prevent per-frame garbage collection pressure
  const points = new Array(maxLen);
  for (let i = 0; i < maxLen; i++) points[i] = new THREE.Vector3();

  return { line, points, head: 0, count: 0, maxLen, geo, baseOpacity: opacity };
}

/**
 * Updates an orbital trail with the body's latest position.
 * Dynamically modulates line opacity and visible length based on speed.
 *
 * @param {object} trail - Trail data structure returned by createTrail.
 * @param {THREE.Vector3} pos - Current world position.
 * @param {number|null} [speed=null] - Current speed magnitude for dynamic brightness scaling.
 */
export function updateTrail(trail, pos, speed = null) {
  trail.points[trail.head].copy(pos);
  trail.head = (trail.head + 1) % trail.maxLen;
  if (trail.count < trail.maxLen) trail.count++;

  let visibleCount = trail.count;
  const boost = trail.boosted ? 2.2 : 1;

  if (speed !== null && CONFIG.trailsEnabled) {
    const speedFrac = THREE.MathUtils.clamp(speed / 12, 0, 1);
    trail.line.material.opacity = Math.min(
      0.9,
      trail.baseOpacity * THREE.MathUtils.lerp(0.5, 1.6, speedFrac) * boost
    );
    visibleCount = Math.min(
      trail.count,
      Math.max(6, Math.round(trail.count * THREE.MathUtils.lerp(0.35, 1, speedFrac)))
    );
  } else {
    trail.line.material.opacity = Math.min(0.9, trail.baseOpacity * boost);
  }

  const arr = trail.geo.attributes.position.array;
  for (let k = 0; k < visibleCount; k++) {
    const offsetFromNewest = visibleCount - 1 - k;
    const idx = (trail.head - 1 - offsetFromNewest + trail.maxLen * 2) % trail.maxLen;
    const p = trail.points[idx];
    arr[k * 3] = p.x;
    arr[k * 3 + 1] = p.y;
    arr[k * 3 + 2] = p.z;
  }

  trail.geo.attributes.position.needsUpdate = true;
  trail.geo.setDrawRange(0, visibleCount);
  trail.geo.computeBoundingSphere();
}

/**
 * Resizes an individual trail buffer in-place while preserving recent history.
 *
 * @param {object} trail - Trail instance.
 * @param {number} newLen - New maximum sample capacity.
 */
function resizeTrailBuffer(trail, newLen) {
  const keepCount = Math.min(trail.count, newLen);
  const kept = [];
  for (let k = 0; k < keepCount; k++) {
    const offsetFromNewest = keepCount - 1 - k;
    const idx = (trail.head - 1 - offsetFromNewest + trail.maxLen * 2) % trail.maxLen;
    kept.push(trail.points[idx].clone());
  }

  const points = new Array(newLen);
  for (let i = 0; i < newLen; i++) {
    points[i] = i < kept.length ? kept[i] : new THREE.Vector3();
  }

  trail.points = points;
  trail.head = kept.length % newLen;
  trail.count = kept.length;
  trail.maxLen = newLen;

  const positions = new Float32Array(newLen * 3);
  trail.geo.dispose();
  trail.geo = new THREE.BufferGeometry();
  trail.geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  trail.geo.setDrawRange(0, 0);
  trail.line.geometry = trail.geo;
}

/**
 * Resizes all active orbital trails across the simulation to match the updated global setting.
 *
 * @param {number} newLen - New trail sample buffer capacity.
 */
export function resizeAllTrails(newLen) {
  CONFIG.trailLength = newLen;
  for (const b of state.bodies) {
    if (b.trail) resizeTrailBuffer(b.trail, newLen);
  }
}

/* ============================================================================
   ASTROPHYSICAL UTILITIES AND ATTRACTOR QUERIES
   ============================================================================ */

const NAME_POOL = {
  blackhole: ['SGR', 'M87', 'CYG-X', 'ABELL'],
  star: ['SOL', 'SIRIUS', 'VEGA', 'ALTAIR', 'RIGEL', 'CASTOR', 'DENEB'],
  planet: ['NOVA', 'KEPLER', 'TERRA', 'VULCAN', 'ORION', 'PYRA', 'AXION'],
  moon: ['LUNA', 'IO', 'TITAN', 'CHARON', 'PHOBOS'],
  comet: ['HALE', 'ENCKE', 'BIELA', 'SWIFT', 'BORREL'],
};

/**
 * Generates a procedural designation for a celestial body.
 *
 * @param {string} type - Body classification.
 * @returns {string} Designation string (e.g. "KEPLER-42").
 */
export function randomName(type) {
  const pool = NAME_POOL[type] || ['OBJ'];
  const w = pool[(Math.random() * pool.length) | 0];
  const n = String(Math.floor(Math.random() * 90) + 10);
  return `${w}-${n}`;
}

/**
 * Computes the characteristic interaction radii for a black hole.
 * Scales with the cube root of mass relative to the base black hole mass.
 *
 * @param {BlackHole} bh - Target black hole.
 * @returns {{ capture: number, tidal: number, drag: number }} Radii in world units.
 */
export function bhRadii(bh) {
  const s = Math.max(Math.cbrt(bh.mass / BASE_BH_MASS), 0.3);
  return {
    capture: BASE_HORIZON * CAPTURE_MULT * s,
    tidal: BASE_HORIZON * TIDAL_MULT * s,
    drag: BASE_HORIZON * DRAG_MULT * s,
  };
}

/**
 * Returns all active black holes in the simulation.
 * @returns {BlackHole[]}
 */
export function blackHoles() {
  return state.bodies.filter((b) => b.type === 'blackhole');
}

/**
 * Finds the nearest black hole to a given world coordinate.
 *
 * @param {THREE.Vector3} pos - Query location.
 * @returns {{ bh: BlackHole|null, dist: number }}
 */
export function nearestBlackHole(pos) {
  let best = null;
  let bestD = Infinity;
  for (const bh of blackHoles()) {
    const d = pos.distanceTo(bh.mesh.position);
    if (d < bestD) {
      bestD = d;
      best = bh;
    }
  }
  return { bh: best, dist: bestD };
}

/**
 * Returns the most massive active black hole in the simulation.
 * @returns {BlackHole|null}
 */
export function dominantBlackHole() {
  let best = null;
  for (const bh of blackHoles()) {
    if (!best || bh.mass > best.mass) best = bh;
  }
  return best;
}

/**
 * Finds the celestial body exerting the strongest instantaneous gravitational force at a position.
 * Uses Newton's law (F ~ M / r^2) to identify the primary local orbital attractor.
 *
 * @param {THREE.Vector3} pos - Query point.
 * @param {CelestialBody|null} [excludeObj=null] - Optional body to exclude (e.g. self-query).
 * @returns {CelestialBody|null} Dominant attractor entity.
 */
export function findDominantAttractor(pos, excludeObj = null) {
  let best = null;
  let bestForce = -1;
  for (const s of state.bodies) {
    if (s === excludeObj) continue;
    const d = Math.max(pos.distanceTo(s.mesh.position), 0.5);
    const force = s.mass / (d * d);
    if (force > bestForce) {
      bestForce = force;
      best = s;
    }
  }
  return best;
}

/**
 * Computes the Keplerian orbital velocity vector for a circular orbit in the XZ plane.
 * Magnitude: v = sqrt(G * M / r) * speedMul.
 * Direction: Tangential counter-clockwise vector orthogonal to the radial displacement.
 *
 * @param {THREE.Vector3} pos - Orbiting body position.
 * @param {THREE.Vector3} center - Attractor center position.
 * @param {number} mass - Attractor mass (M☉).
 * @param {number} [speedMul=1] - Multiplier (e.g. <1 for elliptical decay, >1 for hyperbolic escape).
 * @returns {THREE.Vector3} Tangential velocity vector.
 */
export function orbitalVelocity(pos, center, mass, speedMul = 1) {
  const rel = pos.clone().sub(center);
  const r = Math.max(rel.length(), 1);
  const v = Math.sqrt((CONFIG.G * mass) / r) * speedMul;
  const dir = new THREE.Vector3(-rel.z, 0, rel.x).normalize();
  return dir.multiplyScalar(v);
}

/**
 * Interpolates stellar emission color from blackbody temperature fraction.
 * Maps normalized temperature [0, 1] through red dwarf, yellow sun, and blue supergiant hues.
 *
 * @param {number} t - Normalized temperature fraction [0, 1].
 * @returns {THREE.Color}
 */
export function starColorForTemp(t) {
  const stops = [
    [0.0, new THREE.Color(0xff5533)],
    [0.3, new THREE.Color(0xffa447)],
    [0.55, new THREE.Color(0xfff3c2)],
    [0.8, new THREE.Color(0xdcefff)],
    [1.0, new THREE.Color(0x9fd4ff)],
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    if (t >= stops[i][0] && t <= stops[i + 1][0]) {
      const lt = (t - stops[i][0]) / (stops[i + 1][0] - stops[i][0]);
      return stops[i][1].clone().lerp(stops[i + 1][1], lt);
    }
  }
  return stops[stops.length - 1][1].clone();
}

/**
 * Converts a stellar effective surface temperature in Kelvin to a normalized fraction [0, 1].
 * Clamped between 2,500 K (Class M) and 30,000 K (Class O).
 *
 * @param {number} k - Temperature in Kelvin.
 * @returns {number}
 */
export function tempKtoFrac(k) {
  return THREE.MathUtils.clamp((k - 2500) / (30000 - 2500), 0, 1);
}

/**
 * Generates a random position within a planar annular region with a minor vertical variance.
 *
 * @param {number} minR - Inner radius.
 * @param {number} maxR - Outer radius.
 * @returns {THREE.Vector3}
 */
export function randomOrbitPosition(minR, maxR) {
  const r = minR + Math.random() * (maxR - minR);
  const a = Math.random() * Math.PI * 2;
  return new THREE.Vector3(Math.cos(a) * r, (Math.random() - 0.5) * 6, Math.sin(a) * r);
}

/* ============================================================================
   RELATIVISTIC TIME DILATION SOLVER
   ============================================================================ */

const _tdRel = new THREE.Vector3();
const _tdVRel = new THREE.Vector3();

/**
 * Evaluates the relativistic time dilation factor (gamma in [0.0, 1.0]) at a target position and velocity
 * from surrounding black hole singularities.
 *
 * Uses a Kerr-inspired gravitational potential superposition and special-relativistic kinematic dilation:
 *   Phi_net = sum_j ( (G * M_j * r_j) / (r_j^2 + a_len,j^2 * cos^2(theta_j)) )
 *   gamma_grav = sqrt( max( 0, 1 - 2 * Phi_net / C_SIM^2 ) )
 *   gamma_kin  = sqrt( max( 0, 1 - |v_rel|^2 / C_SIM^2 ) )
 *   gamma      = gamma_grav * gamma_kin
 *
 * @param {THREE.Vector3} pos - Target test position.
 * @param {THREE.Vector3|null} [vel] - Target velocity vector.
 * @param {CelestialBody|null} [excludeObj] - Object to exclude (e.g. self).
 * @returns {number} Time dilation factor in [0.0, 1.0].
 */
export function computeTimeDilation(pos, vel, excludeObj) {
  if (!CONFIG.timeDilationEnabled) return 1.0;
  const bhs = blackHoles();
  if (!bhs.length) return 1.0;

  let phiNet = 0;
  let maxKinDilation = 1.0;

  for (const bh of bhs) {
    if (bh === excludeObj || bh._destroyed) continue;

    _tdRel.set(
      pos.x - bh.mesh.position.x,
      pos.y - bh.mesh.position.y,
      pos.z - bh.mesh.position.z
    );
    const r = _tdRel.length();
    const rs = bh.schwarzschildRadius || (2 * CONFIG.G * bh.mass) / (C_SIM * C_SIM);
    const rInfluence = Math.max(60 * rs, 75.0);
    if (r > rInfluence) continue;

    // Kerr angular momentum length scale: a_len = a * (r_s / 2)
    const spin = bh.spin ?? 0;
    const aLen = spin * (rs * 0.5);

    // Colatitude angle relative to black hole spin axis
    let cosTheta = 0;
    if (r > 0.0001 && bh.spinDirection) {
      cosTheta = (_tdRel.x * bh.spinDirection.x + _tdRel.y * bh.spinDirection.y + _tdRel.z * bh.spinDirection.z) / r;
    }

    // Kerr-inspired effective gravitational potential: Phi_eff = (G * M * r) / (r^2 + a_len^2 * cos^2(theta))
    const denom = r * r + aLen * aLen * cosTheta * cosTheta;
    const phiEff = denom > 0.0001 ? (CONFIG.G * bh.mass * r) / denom : (CONFIG.G * bh.mass) / (rs * 0.5);
    phiNet += phiEff;

    // Special-relativistic kinematic velocity dilation relative to local attractor
    if (vel) {
      _tdVRel.copy(vel).sub(bh.velocity);
      const speedSq = Math.min(_tdVRel.lengthSq(), 0.999 * C_SIM * C_SIM);
      const kinFactor = Math.sqrt(Math.max(0, 1 - speedSq / (C_SIM * C_SIM)));
      if (kinFactor < maxKinDilation) maxKinDilation = kinFactor;
    }
  }

  const gravArg = Math.max(0, 1 - (2 * phiNet) / (C_SIM * C_SIM));
  const gammaGrav = Math.sqrt(gravArg);
  const gamma = THREE.MathUtils.clamp(gammaGrav * maxKinDilation, 0.0, 1.0);

  return gamma;
}

/* ============================================================================
   OBJECT ARCHITECTURE & ENTITY CLASS HIERARCHY
   ============================================================================ */

/**
 * Base class representing any simulated, gravitationally-active entity.
 */
export class CelestialBody {
  constructor(opts) {
    this.id = state.idCounter++;
    this.name = opts.name;
    this.type = opts.type;
    this.mass = opts.mass;
    this.radius = opts.radius;
    this.mesh = opts.mesh;                  // THREE.Group or Mesh root
    this.core = opts.core;                  // Selectable / raycastable mesh
    this.velocity = opts.velocity ? opts.velocity.clone() : new THREE.Vector3();
    this.acceleration = new THREE.Vector3();
    this._newAcceleration = new THREE.Vector3(); // Scratch buffer for Verlet integration
    this.rotationSpeed = opts.rotationSpeed ?? 0.3;
    this.temperature = opts.temperature ?? null;
    this.trail = opts.trail ?? null;
    this.parent = opts.parent ?? null;      // Direct gravitational parent (e.g. planet for a moon)
    this.children = [];
    if (this.parent) this.parent.children.push(this);
    this.status = 'stable';
    this.age = opts.age ?? 0;
    this.properTime = opts.properTime ?? (opts.age ? opts.age / AGE_YEARS_PER_SIMSECOND : 0);
    this.timeDilation = 1.0;
    this.lifecycleScale = 1;
    this.lastLog = {};
    this._destroyed = false;
    this._createdAt = performance.now();
  }

  get position() {
    return this.mesh.position;
  }

  /**
   * Local proper time rate multiplier relative to universal coordinate time.
   * @returns {number}
   */
  get localTimeRate() {
    return this.timeDilation;
  }

  /**
   * Computes classical kinetic energy: E_k = 0.5 * m * v^2.
   * @returns {number}
   */
  kineticEnergy() {
    return 0.5 * this.mass * this.velocity.lengthSq();
  }
}

/**
 * Star entity with thermal emission, spectral classification, and evolutionary lifecycle tracking.
 */
export class Star extends CelestialBody {
  constructor(opts) {
    super({ ...opts, type: 'star' });
    this.glow = opts.glow;
    this.tempK = opts.tempK;
    this.lifespan = opts.lifespan;
    this.isHighMass = opts.isHighMass;
    this.stage = 'main_sequence';
  }
}

/**
 * Terrestrial or gas giant planetary body.
 */
export class Planet extends CelestialBody {
  constructor(opts) {
    super({ ...opts, type: 'planet' });
  }
}

/**
 * Natural satellite orbiting a parent planetary body.
 */
export class Moon extends CelestialBody {
  constructor(opts) {
    super({ ...opts, type: 'moon' });
  }
}

/**
 * Highly eccentric icy body with volatile tail glow.
 */
export class Comet extends CelestialBody {
  constructor(opts) {
    super({ ...opts, type: 'comet' });
    this.glow = opts.glow;
  }
}

/**
 * Dense stellar remnant born from core-collapse supernovae.
 */
export class NeutronStar extends CelestialBody {
  constructor(opts) {
    super({ ...opts, type: 'neutron' });
    this.glow = opts.glow;
  }
}

/**
 * Infers the closest standard black hole mass classification based on mass.
 *
 * @param {number} mass - Mass in solar masses (M☉).
 * @returns {string} Classification identifier ('supermassive' | 'intermediate' | 'stellar' | 'primordial').
 */
export function inferBHClass(mass) {
  if (mass >= 1000) return 'supermassive';
  if (mass >= 100) return 'intermediate';
  if (mass >= 10) return 'stellar';
  return 'primordial';
}

/**
 * Computes the physical Kerr Innermost Stable Circular Orbit (ISCO) radius in simulation distance units:
 *   Z1 = 1 + (1 - a^2)^(1/3) * ((1 + a)^(1/3) + (1 - a)^(1/3))
 *   Z2 = sqrt(3*a^2 + Z1^2)
 *   r_ISCO/M = 3 + Z2 - sign(a) * sqrt((3 - Z1) * (3 + Z1 + 2*Z2))
 *   r_ISCO = (r_ISCO/M) * (r_s / 2)
 *
 * @param {number} spin - Dimensionless Kerr spin parameter a in [-1, 1].
 * @param {number} mass - Black hole mass in solar masses (M☉).
 * @returns {number} Physical ISCO radius in simulation distance units.
 */
export function computeKerrISCO(spin, mass) {
  const a = THREE.MathUtils.clamp(spin ?? 0, -1, 1);
  const rs = (2 * CONFIG.G * mass) / (C_SIM * C_SIM);
  const M = rs * 0.5;
  const a2 = a * a;
  const cbrt1PlusA = Math.cbrt(1 + a);
  const cbrt1MinusA = Math.cbrt(Math.max(0, 1 - a));
  const z1 = 1 + Math.cbrt(Math.max(0, 1 - a2)) * (cbrt1PlusA + cbrt1MinusA);
  const z2 = Math.sqrt(3 * a2 + z1 * z1);
  const signA = a > 0.0001 ? 1 : a < -0.0001 ? -1 : 0;
  const innerTerm = Math.max(0, (3 - z1) * (3 + z1 + 2 * z2));
  const rISCO_M = 3 + z2 - signA * Math.sqrt(innerTerm);
  return rISCO_M * M;
}

// Persistent module scratch objects for zero-allocation orientation updates
const _scratchErgoQuat = new THREE.Quaternion();
const _scratchDiskQuat = new THREE.Quaternion();
const _scratchNormalY = new THREE.Vector3(0, 1, 0);
const _scratchSpinDir = new THREE.Vector3();

/**
 * Gravitational singularity with event horizon, photon ring, optional accretion disk,
 * and Kerr-inspired spin / ergosphere parameters.
 */
export class BlackHole extends CelestialBody {
  constructor(opts) {
    super({ ...opts, type: 'blackhole' });
    this.bhClass = opts.bhClass || 'supermassive';
    this.spin = THREE.MathUtils.clamp(
      opts.spin ?? (BH_MASS_CLASSES[this.bhClass]?.defaultSpin ?? 0.85),
      -1,
      1
    );
    this.spinDirection = opts.spinDirection
      ? (opts.spinDirection instanceof THREE.Vector3
          ? opts.spinDirection.clone()
          : new THREE.Vector3(opts.spinDirection.x, opts.spinDirection.y, opts.spinDirection.z)
        ).normalize()
      : new THREE.Vector3(0, 1, 0);

    this.visualRadius = opts.visualRadius;
    this.diskMesh = opts.diskMesh || null;
    this.diskMat = opts.diskMat || null;
    this.photonSprite = opts.photonSprite;
    this.ergosphereMesh = opts.ergosphereMesh || null;
    this.primordialGlow = opts.primordialGlow || null;
  }

  /**
   * Rotation model classification ('schwarzschild' for a ~ 0, 'kerr' for rotating).
   * @returns {'schwarzschild'|'kerr'}
   */
  get rotationModel() {
    return Math.abs(this.spin) < 0.001 ? 'schwarzschild' : 'kerr';
  }

  /**
   * Relativistic Schwarzschild radius in simulation distance units:
   *   r_s = (2 * G * M) / C_SIM^2
   * @returns {number}
   */
  get schwarzschildRadius() {
    return (2 * CONFIG.G * this.mass) / (C_SIM * C_SIM);
  }

  /**
   * Kerr outer event horizon radius in simulation distance units:
   *   r_H = (r_s / 2) * (1 + sqrt(1 - a^2))
   * @returns {number}
   */
  get kerrHorizonRadius() {
    const a = this.spin;
    return (this.schwarzschildRadius / 2) * (1 + Math.sqrt(Math.max(0, 1 - a * a)));
  }

  /**
   * Physical Kerr ISCO radius in simulation distance units:
   * @returns {number}
   */
  get iscoRadius() {
    return computeKerrISCO(this.spin, this.mass);
  }

  /**
   * Equatorial ergosphere static limit radius in simulation distance units:
   *   r_E(pi/2) = r_s
   * @returns {number}
   */
  get equatorialErgoRadius() {
    return this.schwarzschildRadius;
  }

  /**
   * Polar ergosphere radius in simulation distance units (coincides with Kerr horizon):
   *   r_E(0) = r_H
   * @returns {number}
   */
  get polarErgoRadius() {
    return this.kerrHorizonRadius;
  }

  /**
   * Simulation-scaled Kerr angular momentum:
   *   J_sim = a * (G * M^2) / C_SIM
   * @returns {number}
   */
  get angularMomentumSim() {
    return (this.spin * CONFIG.G * this.mass * this.mass) / C_SIM;
  }

  /**
   * Alias for angularMomentumSim.
   * @returns {number}
   */
  get angularMomentum() {
    return this.angularMomentumSim;
  }

  /**
   * Updates ergosphere geometry scaling and spatial orientation based on current spin and spinDirection.
   * Aligns the polar symmetry axis of the oblate spheroid with spinDirection.
   */
  updateErgosphere() {
    if (!this.ergosphereMesh) return;
    const a = this.spin;
    const hasErgo = Math.abs(a) >= 0.05;
    this.ergosphereMesh.visible = hasErgo;
    if (!hasErgo) return;

    const polarFrac = (1 + Math.sqrt(Math.max(0, 1 - a * a))) / 2;
    this.ergosphereMesh.scale.set(
      this.visualRadius,
      this.visualRadius * polarFrac,
      this.visualRadius
    );

    _scratchSpinDir.copy(this.spinDirection).normalize();
    _scratchErgoQuat.setFromUnitVectors(_scratchNormalY, _scratchSpinDir);
    this.ergosphereMesh.quaternion.copy(_scratchErgoQuat);
  }

  /**
   * Updates accretion disk spatial orientation based on current spinDirection.
   * Aligns the disk normal with spinDirection using persistent zero-allocation scratch objects.
   */
  updateDiskOrientation() {
    if (!this.diskMesh) return;
    _scratchSpinDir.copy(this.spinDirection).normalize();
    _scratchDiskQuat.setFromUnitVectors(_scratchNormalY, _scratchSpinDir);
    this.diskMesh.quaternion.copy(_scratchDiskQuat);
  }
}

/* ============================================================================
   PROCEDURAL ENTITY FACTORIES
   ============================================================================ */

/**
 * Instantiates and registers a BlackHole entity in the scene and physics registry.
 *
 * @param {object} [opts={}] - Configuration options.
 * @returns {BlackHole}
 */
export function createBlackHole(opts = {}) {
  const bhClass = opts.bhClass || (opts.mass !== undefined ? inferBHClass(opts.mass) : 'supermassive');
  const classConfig = BH_MASS_CLASSES[bhClass] || BH_MASS_CLASSES.supermassive;
  const mass = opts.mass ?? classConfig.defaultMass;
  const spin = opts.spin !== undefined ? THREE.MathUtils.clamp(opts.spin, -1, 1) : classConfig.defaultSpin;
  const spinDirection = (
    opts.spinDirection instanceof THREE.Vector3
      ? opts.spinDirection.clone()
      : opts.spinDirection
      ? new THREE.Vector3(opts.spinDirection.x, opts.spinDirection.y, opts.spinDirection.z)
      : new THREE.Vector3(0, 1, 0)
  ).normalize();

  const visualRadius = Math.max(BASE_HORIZON * Math.cbrt(mass / BASE_BH_MASS), 1.6);
  const group = new THREE.Group();

  // Dark spherical event horizon
  const horizonMesh = new THREE.Mesh(
    new THREE.SphereGeometry(visualRadius, 48, 48),
    new THREE.MeshBasicMaterial({ color: 0x000000 })
  );
  group.add(horizonMesh);

  // Gravitational shadow sprite
  const shadowTex = makeGlowTexture('rgba(4,2,10,0.95)', 'rgba(4,2,10,0)');
  const shadowSprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: shadowTex, transparent: true, depthWrite: false })
  );
  shadowSprite.scale.set(visualRadius * 4.2, visualRadius * 4.2, 1);
  group.add(shadowSprite);

  // Relativistic photon sphere ring (omitted or compact on primordial)
  let photonSprite = null;
  if (bhClass !== 'primordial') {
    const photonTex = makeRingTexture('rgba(255,244,214,0.95)');
    photonSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: photonTex,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    photonSprite.scale.set(visualRadius * 2.5, visualRadius * 2.5, 1);
    group.add(photonSprite);
  }

  // Primordial high-energy evaporation micro-glow
  let primordialGlow = null;
  if (bhClass === 'primordial') {
    const pTex = makeGlowTexture('rgba(160,90,255,0.95)', 'rgba(0,210,255,0)');
    primordialGlow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: pTex,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    primordialGlow.scale.set(visualRadius * 4.0, visualRadius * 4.0, 1);
    group.add(primordialGlow);
  }

  // Planar turbulent accretion disk (scaled by classification and Kerr ISCO)
  let diskMat = null;
  let diskMesh = null;
  if (classConfig.hasDisk && opts.hasDisk !== false) {
    const diskScale = opts.diskScale ?? classConfig.diskScale;
    const rs = (2 * CONFIG.G * mass) / (C_SIM * C_SIM);
    const rISCO = computeKerrISCO(spin, mass);
    const iscoNorm = rs > 0 ? rISCO / (3 * rs) : 1.0;
    const innerRadius = visualRadius * (1.0 + 0.20 * iscoNorm);
    const outerRadius = visualRadius * diskScale;

    diskMat = createDiskMaterial(CONFIG.diskBrightness, {
      spin,
      mass,
      innerRadius,
    });
    const diskGeo = new THREE.RingGeometry(innerRadius, outerRadius, 256, 16);
    diskGeo.rotateX(-Math.PI / 2); // Base normal aligned with +Y
    diskMesh = new THREE.Mesh(diskGeo, diskMat);
    group.add(diskMesh);
  }

  // Oblate Ergosphere wireframe visualization for rotating singularities
  const ergoGeo = new THREE.SphereGeometry(1, 32, 24);
  const ergoMat = new THREE.MeshBasicMaterial({
    color: 0x00e5ff,
    wireframe: true,
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
  });
  const ergosphereMesh = new THREE.Mesh(ergoGeo, ergoMat);
  group.add(ergosphereMesh);

  const pos = opts.position || new THREE.Vector3();
  group.position.copy(pos);
  scene.add(group);

  const obj = new BlackHole({
    name: opts.name || randomName('blackhole') + '-PRIME',
    mesh: group,
    core: horizonMesh,
    diskMesh,
    diskMat,
    photonSprite,
    ergosphereMesh,
    primordialGlow,
    visualRadius,
    mass,
    radius: visualRadius,
    velocity: opts.velocity,
    bhClass,
    spin,
    spinDirection,
    trail: createTrail(0x554466, 0.2),
  });

  obj.updateErgosphere();
  obj.updateDiskOrientation();

  state.bodies.push(obj);
  registerSelectable(horizonMesh, obj);
  return obj;
}

/**
 * Instantiates and registers a Star entity with thermal blackbody characteristics.
 *
 * @param {object} [opts={}] - Configuration options.
 * @returns {Star}
 */
export function createStar(opts = {}) {
  const tempK = opts.tempK ?? THREE.MathUtils.lerp(3200, 22000, Math.random());
  const tFrac = tempKtoFrac(tempK);
  const color = starColorForTemp(tFrac);
  const size = opts.size ?? (0.8 + tFrac * 1.6);
  const group = new THREE.Group();

  const core = new THREE.Mesh(
    new THREE.SphereGeometry(size, 24, 24),
    new THREE.MeshBasicMaterial({ color })
  );
  group.add(core);

  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: starGlowTex,
      color,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 0.85,
    })
  );
  glow.scale.set(size * 7, size * 7, 1);
  group.add(glow);

  const pos = opts.position || randomOrbitPosition(60, 260);
  group.position.copy(pos);
  scene.add(group);

  const mass = opts.mass ?? (2 + Math.random() * 20);
  const isHighMass = mass > 11;
  // Stellar lifespan decreases non-linearly with mass: t ~ M^-1.6
  const lifespan = STAR_LIFESPAN_K / Math.pow(mass, 1.6) + 3000;

  const obj = new Star({
    name: opts.name || randomName('star'),
    mesh: group,
    core,
    glow,
    mass,
    radius: size,
    velocity:
      opts.velocity ||
      orbitalVelocity(pos, new THREE.Vector3(), CONFIG.blackHoleMass, 0.85 + Math.random() * 0.3),
    tempK,
    age: opts.age ?? 0,
    trail: createTrail(color.getHex(), 0.4),
    lifespan,
    isHighMass,
  });

  state.bodies.push(obj);
  registerSelectable(core, obj);
  return obj;
}

/**
 * Instantiates and registers a Planet entity with optional planetary rings.
 *
 * @param {object} [opts={}] - Configuration options.
 * @returns {Planet}
 */
export function createPlanet(opts = {}) {
  const size = opts.size ?? (1.2 + Math.random() * 2.2);
  const hue = opts.hue ?? Math.random();
  const color = new THREE.Color().setHSL(hue, 0.55, 0.5 + Math.random() * 0.15);
  const group = new THREE.Group();

  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(size, 32, 32),
    new THREE.MeshPhongMaterial({
      color,
      emissive: color.clone().multiplyScalar(0.08),
      shininess: 8,
    })
  );
  group.add(mesh);

  // 40% probability of procedural planetary ring formation
  if (Math.random() < 0.4) {
    const ringGeo = new THREE.RingGeometry(size * 1.5, size * 2.4, 48);
    const ringMat = new THREE.MeshBasicMaterial({
      color: color.clone().offsetHSL(0, -0.2, 0.2),
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.6,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2.3;
    group.add(ring);
  }

  const pos = opts.position || randomOrbitPosition(40, 220);
  group.position.copy(pos);
  scene.add(group);

  const obj = new Planet({
    name: opts.name || randomName('planet'),
    mesh: group,
    core: mesh,
    mass: opts.mass ?? (0.5 + Math.random() * 8),
    radius: size,
    velocity:
      opts.velocity ||
      orbitalVelocity(pos, new THREE.Vector3(), CONFIG.blackHoleMass, 0.9 + Math.random() * 0.25),
    trail: createTrail(color.getHex(), 0.3),
  });

  state.bodies.push(obj);
  registerSelectable(mesh, obj);
  return obj;
}

/**
 * Instantiates and registers a natural satellite (Moon) orbiting a parent body.
 *
 * @param {object} [opts={}] - Configuration options.
 * @returns {Moon}
 */
export function createMoon(opts = {}) {
  const size = opts.size ?? (0.3 + Math.random() * 0.7);
  const color = new THREE.Color(0xaaaaaa).offsetHSL(0, 0, (Math.random() - 0.5) * 0.2);
  const group = new THREE.Group();

  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(size, 20, 20),
    new THREE.MeshPhongMaterial({ color, shininess: 4 })
  );
  group.add(mesh);

  const pos = opts.position || randomOrbitPosition(6, 14);
  group.position.copy(pos);
  scene.add(group);

  const obj = new Moon({
    name: opts.name || randomName('moon'),
    mesh: group,
    core: mesh,
    mass: opts.mass ?? (0.02 + Math.random() * 0.3),
    radius: size,
    velocity: opts.velocity || new THREE.Vector3(),
    trail: createTrail(color.getHex(), 0.3),
    parent: opts.parent || null,
  });

  state.bodies.push(obj);
  registerSelectable(mesh, obj);
  return obj;
}

/**
 * Instantiates and registers a Comet entity with a high-eccentricity orbit.
 *
 * @param {object} [opts={}] - Configuration options.
 * @returns {Comet}
 */
export function createComet(opts = {}) {
  const size = opts.size ?? 0.6;
  const color = 0xbfe9ff;
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(size, 12, 12),
    new THREE.MeshBasicMaterial({ color })
  );
  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: starGlowTex,
      color,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 0.9,
    })
  );
  glow.scale.set(size * 8, size * 8, 1);
  const group = new THREE.Group();
  group.add(core);
  group.add(glow);

  const pos = opts.position || randomOrbitPosition(150, 340);
  group.position.copy(pos);
  scene.add(group);

  const obj = new Comet({
    name: opts.name || randomName('comet'),
    mesh: group,
    core,
    glow,
    mass: opts.mass ?? (0.05 + Math.random() * 0.4),
    radius: size,
    velocity:
      opts.velocity ||
      orbitalVelocity(pos, new THREE.Vector3(), CONFIG.blackHoleMass, 1.1 + Math.random() * 0.5),
    trail: createTrail(0x8fe0ff, 0.6, true),
  });

  state.bodies.push(obj);
  registerSelectable(core, obj);
  return obj;
}

/**
 * Instantiates and registers a NeutronStar entity (compact post-supernova remnant).
 *
 * @param {object} [opts={}] - Configuration options.
 * @returns {NeutronStar}
 */
export function createNeutronStar(opts = {}) {
  const size = opts.size ?? 0.55;
  const color = 0xdff2ff;
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(size, 16, 16),
    new THREE.MeshBasicMaterial({ color })
  );
  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: starGlowTex,
      color,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 1,
    })
  );
  glow.scale.set(size * 11, size * 11, 1);
  const group = new THREE.Group();
  group.add(core);
  group.add(glow);

  const pos = opts.position || new THREE.Vector3();
  group.position.copy(pos);
  scene.add(group);

  const obj = new NeutronStar({
    name: opts.name || randomName('star') + '-NS',
    mesh: group,
    core,
    glow,
    mass: opts.mass ?? 6,
    radius: size,
    velocity: opts.velocity || new THREE.Vector3(),
    trail: createTrail(color, 0.5, true),
  });

  state.bodies.push(obj);
  registerSelectable(core, obj);
  return obj;
}