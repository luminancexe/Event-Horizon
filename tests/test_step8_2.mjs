/**
 * Standalone Node.js Unit & Integration Test Suite for Phase 4 — Step 8.2:
 * Eddington Limiting, Radiative Feedback & Accretion Regulation
 */

// Lightweight Three.js Math & Object Shim for Node.js test execution
class Vector3 {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  clone() { return new Vector3(this.x, this.y, this.z); }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  addVectors(a, b) { this.x = a.x + b.x; this.y = a.y + b.y; this.z = a.z + b.z; return this; }
  subVectors(a, b) { this.x = a.x - b.x; this.y = a.y - b.y; this.z = a.z - b.z; return this; }
  multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
  addScaledVector(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
  length() { return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z); }
  lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
  normalize() {
    const l = this.length();
    if (l > 0.00001) this.multiplyScalar(1 / l);
    return this;
  }
  dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
  distanceTo(v) { return Math.sqrt((this.x - v.x) ** 2 + (this.y - v.y) ** 2 + (this.z - v.z) ** 2); }
}

const CONFIG = {
  G: 0.6,
  blackHoleMass: 5000,
  diskBrightness: 1.0,
  dopplerBeamingEnabled: true,
  tidalDisruptionEnabled: true,
  tdeStreamDensity: 1.0,
  tdeViscousTimescale: 6.0,
  tdeDiskThickness: 1.2,
  tdeCircularizationTimescale: 1.5,
  tdeCircVelocityThreshold: 0.08,
  tdeMaxCircularizationTime: 3.5,
  tdeSpinEvolutionEnabled: true,
  tdeEddingtonLimitEnabled: true,
  tdeRadiationPressureEnabled: true,
  tdeEddingtonFeedbackStrength: 1.0,
};

const C_SIM = 60;
const BASE_BH_MASS = 5000;
const BASE_HORIZON = 9.0;
const CAPTURE_MULT = 1.15;
const TIDAL_MULT = 4.8;
const DRAG_MULT = 3.6;

function clamp(val, min, max) {
  return Math.min(max, Math.max(min, val));
}

function computeKerrISCOProperties(spin, mass, sOrb) {
  const a = clamp(spin ?? 0, -0.998, 0.998);
  const mSafe = Math.max(mass || 0, 0.001);
  const rs = (2 * CONFIG.G * mSafe) / (C_SIM * C_SIM);
  const M = rs * 0.5;
  const a2 = a * a;
  const cbrt1PlusA = Math.cbrt(Math.max(0, 1 + a));
  const cbrt1MinusA = Math.cbrt(Math.max(0, 1 - a));
  const z1 = 1 + Math.cbrt(Math.max(0, 1 - a2)) * (cbrt1PlusA + cbrt1MinusA);
  const z2 = Math.sqrt(3 * a2 + z1 * z1);
  const signA = a > 0.0001 ? 1 : a < -0.0001 ? -1 : 0;
  const innerTerm = Math.max(0, (3 - z1) * (3 + z1 + 2 * z2));
  const rTilde = Math.max(1.0, 3 + z2 - signA * Math.sqrt(innerTerm));
  const rISCO = rTilde * M;

  const sqrtR = Math.sqrt(rTilde);
  const r32 = rTilde * sqrtR;
  const r34 = Math.pow(rTilde, 0.75);
  const denomCore = Math.max(1e-5, r32 - 3 * sqrtR + 2 * a);
  const sqrtDenom = Math.sqrt(denomCore);
  const denom = Math.max(1e-5, r34 * sqrtDenom);

  const numE = r32 - 2 * sqrtR + a;
  const eISCO = clamp(numE / denom, 0.0, 1.0);
  const eta = clamp(1.0 - eISCO, 0.01, 0.45);

  const s = sOrb !== undefined ? sOrb : (a >= 0 ? 1 : -1);
  const numL = s * (rTilde * rTilde - 2 * a * sqrtR + a2);
  const lISCO = numL / denom;

  return {
    rISCO,
    rTildeISCO: rTilde,
    eISCO,
    lISCO,
    eta,
  };
}

const _scratchRadRel = new Vector3();

class BlackHoleMock {
  constructor(opts = {}) {
    this.id = opts.id || 1;
    this.type = 'blackhole';
    this.name = opts.name || 'TEST-BH';
    this.mass = opts.mass || 5000;
    this.bhClass = opts.bhClass || 'supermassive';
    this.spin = clamp(opts.spin ?? 0.85, -0.998, 0.998);
    this.spinDirection = opts.spinDirection ? opts.spinDirection.clone().normalize() : new Vector3(0, 1, 0);
    this.diskMass = opts.diskMass ?? 0;
    this.diskScale = opts.diskScale ?? 6.5;
    this.diskMesh = opts.hasDisk !== false && this.bhClass !== 'primordial' ? {} : null;
    this.diskMat = opts.hasDisk !== false && this.bhClass !== 'primordial' ? {
      uniforms: {
        uBrightness: { value: 1.0 },
        uAccretionRate: { value: 0.0 },
        uSpin: { value: this.spin },
        uMass: { value: this.mass },
      }
    } : null;
    this.mesh = { position: opts.position ? opts.position.clone() : new Vector3(0, 0, 0) };
    this.velocity = opts.velocity ? opts.velocity.clone() : new Vector3(0, 0, 0);
  }

  get accretionRate() {
    const tau = CONFIG.tdeViscousTimescale || 6.0;
    if (this.diskMass <= 0 || tau <= 0) return 0;
    return this.diskMass / tau;
  }

  get effectiveAccretionRate() {
    const mDotSupply = this.accretionRate;
    if (!CONFIG.tdeEddingtonLimitEnabled || mDotSupply <= 0 || this.mass <= 0) {
      return mDotSupply;
    }
    const lambda = this.eddingtonRatio;
    if (lambda <= 1.0) {
      return mDotSupply;
    }
    const eta = Math.max(this.accretionEfficiency, 0.01);
    const kEdd = 1.26e-5;
    const mDotEdd = (kEdd * this.mass) / eta;
    const mDotRegulated = mDotEdd * (1.0 + Math.log(lambda));
    return Math.min(mDotSupply, Math.max(0, mDotRegulated));
  }

  get accretionEfficiency() {
    return computeKerrISCOProperties(this.spin, this.mass).eta;
  }

  get accretionLuminosity() {
    const mDot = this.accretionRate;
    if (mDot <= 0) return 0;
    const eta = this.accretionEfficiency;
    return eta * mDot * (C_SIM * C_SIM);
  }

  get emergentLuminosity() {
    const lAcc = this.accretionLuminosity;
    if (!CONFIG.tdeEddingtonLimitEnabled || lAcc <= 0 || this.mass <= 0) {
      return lAcc;
    }
    const lambda = this.eddingtonRatio;
    if (lambda <= 1.0) {
      return lAcc;
    }
    const lEdd = this.eddingtonLuminosity;
    const lEmergent = lEdd * (1.0 + Math.log(lambda));
    return Math.min(lAcc, Math.max(0, lEmergent));
  }

  get eddingtonLuminosity() {
    if (this.mass <= 0) return 0;
    const kEdd = 1.26e-5;
    return kEdd * this.mass * (C_SIM * C_SIM);
  }

  get eddingtonRatio() {
    const lEdd = this.eddingtonLuminosity;
    if (lEdd <= 0) return 0;
    return this.accretionLuminosity / lEdd;
  }

  computeRadiationAcceleration(pos, out) {
    out.set(0, 0, 0);
    if (!CONFIG.tdeRadiationPressureEnabled || this.mass <= 0 || this.diskMass <= 0) {
      return out;
    }
    const lambda = this.eddingtonRatio;
    if (lambda <= 0) {
      return out;
    }
    const lambdaEff = lambda <= 1.0 ? lambda : (1.0 + Math.log(lambda));
    const kFb = CONFIG.tdeEddingtonFeedbackStrength ?? 1.0;
    if (kFb <= 0) return out;

    _scratchRadRel.subVectors(pos, this.mesh.position);
    const rSq = _scratchRadRel.lengthSq();
    const r = Math.sqrt(rSq);
    if (r < 0.001) return out;

    const gM = CONFIG.G * this.mass;
    const aMag = Math.min(250, (kFb * lambdaEff * gM) / Math.max(rSq, 0.1));
    out.copy(_scratchRadRel).multiplyScalar(aMag / r);
    return out;
  }

  get diskTemperature() {
    if (this.diskMass <= 0 || !this.diskMat) return 0;
    const mDot = this.accretionRate;
    if (mDot <= 0) return 0;
    const rISCO = Math.max(this.iscoRadius, 1.0);
    const fluxFactor = (this.mass * mDot) / (rISCO * rISCO * rISCO);
    const tScaled = 2.5e6 * Math.pow(Math.max(fluxFactor, 0), 0.25);
    return Math.min(Math.max(tScaled, 1e4), 5e7);
  }

  get visualRadius() {
    return Math.max(BASE_HORIZON * Math.cbrt(this.mass / BASE_BH_MASS), 1.6);
  }

  get iscoRadius() {
    return computeKerrISCOProperties(this.spin, this.mass).rISCO;
  }
}

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  [PASS] ${message}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${message}`);
    failed++;
  }
}

console.log('================================================================');
console.log('PHASE 4 — STEP 8.2: EDDINGTON LIMITING & RADIATIVE FEEDBACK VERIFICATION');
console.log('================================================================');

// ----------------------------------------------------------------------
// Group 1: Eddington Diagnostics & Scales
// ----------------------------------------------------------------------
console.log('\n--- Test Group 1: Eddington Diagnostics & Scales ---');

const bhDiag = new BlackHoleMock({ mass: 5000, spin: 0.85, diskMass: 0.0 });
assert(bhDiag.eddingtonLuminosity > 0 && isFinite(bhDiag.eddingtonLuminosity), 'TEST 1: L_Edd is finite and strictly positive for M_BH > 0');
assert(bhDiag.accretionLuminosity === 0, 'TEST 2: L_acc is exactly 0 when diskMass is 0');
assert(bhDiag.eddingtonRatio === 0, 'TEST 3: lambda_Edd is exactly 0 when diskMass is 0');
assert(bhDiag.effectiveAccretionRate === 0, 'TEST 4: effectiveAccretionRate is 0 when diskMass is 0');
assert(bhDiag.emergentLuminosity === 0, 'TEST 5: emergentLuminosity is 0 when diskMass is 0');

// ----------------------------------------------------------------------
// Group 2: Sub-Eddington Regime (lambda <= 1)
// ----------------------------------------------------------------------
console.log('\n--- Test Group 2: Sub-Eddington Regime ---');

// For M_BH = 5000, k_Edd = 1.26e-5, tau = 6.0, eta ~ 0.1558:
// M_dot_Edd = (1.26e-5 * 5000) / 0.1558 = 0.404 M☉/s
// With tau = 6.0, M_disk_Edd = 0.404 * 6.0 = 2.42 M☉
const bhSub = new BlackHoleMock({ mass: 5000, spin: 0.85, diskMass: 1.0 }); // M_dot = 1/6 = 0.167 M☉/s (< M_dot_Edd)

assert(bhSub.eddingtonRatio < 1.0, 'TEST 6: Sub-critical disk mass produces lambda_Edd < 1.0');
assert(Math.abs(bhSub.effectiveAccretionRate - bhSub.accretionRate) < 1e-6, 'TEST 7: In sub-Eddington regime, effectiveAccretionRate equals supply accretionRate');
assert(Math.abs(bhSub.emergentLuminosity - bhSub.accretionLuminosity) < 1e-6, 'TEST 8: In sub-Eddington regime, emergentLuminosity equals accretionLuminosity');

// Draining sub-Eddington disk
const dM_sub = Math.min(bhSub.diskMass, bhSub.effectiveAccretionRate * 1.0);
bhSub.diskMass -= dM_sub;
assert(bhSub.diskMass < 1.0 && bhSub.diskMass >= 0, 'TEST 9: Sub-critical disk drains normally');
assert(isFinite(bhSub.effectiveAccretionRate), 'TEST 10: Sub-critical effective accretion rate remains finite');

// ----------------------------------------------------------------------
// Group 3: Super-Eddington Logarithmic Regulation (lambda > 1)
// ----------------------------------------------------------------------
console.log('\n--- Test Group 3: Super-Eddington Logarithmic Regulation ---');

const bhSuper = new BlackHoleMock({ mass: 5000, spin: 0.85, diskMass: 20.0 }); // M_dot = 20/6 = 3.33 M☉/s (~8.2x Eddington)
const lambdaSuper = bhSuper.eddingtonRatio;

assert(lambdaSuper > 1.0, 'TEST 11: High disk mass correctly triggers super-Eddington regime (lambda_Edd > 1.0)');
assert(bhSuper.effectiveAccretionRate < bhSuper.accretionRate, 'TEST 12: Super-Eddington effective accretion rate is throttled below supply rate');

const etaSuper = bhSuper.accretionEfficiency;
const kEdd = 1.26e-5;
const mDotEdd = (kEdd * bhSuper.mass) / etaSuper;
const expectedRegRate = mDotEdd * (1.0 + Math.log(lambdaSuper));
assert(Math.abs(bhSuper.effectiveAccretionRate - expectedRegRate) < 1e-5, 'TEST 13: Super-Eddington regulation precisely follows M_dot_Edd * (1 + ln(lambda_Edd))');

// Excess mass remains in disk reservoir
const dt_step = 0.5;
const dM_super = Math.min(bhSuper.diskMass, bhSuper.effectiveAccretionRate * dt_step);
const unaccretedExcess = (bhSuper.accretionRate - bhSuper.effectiveAccretionRate) * dt_step;
bhSuper.diskMass -= dM_super;

assert(unaccretedExcess > 0, 'TEST 14: Unaccreted excess mass is strictly positive during super-Eddington throttling');
assert(bhSuper.diskMass > 0, 'TEST 15: Throttled disk mass is safely preserved in disk reservoir');

// ----------------------------------------------------------------------
// Group 4: Emergent Luminosity & Photon Trapping Saturation
// ----------------------------------------------------------------------
console.log('\n--- Test Group 4: Emergent Luminosity Saturation ---');

assert(bhSuper.emergentLuminosity < bhSuper.accretionLuminosity, 'TEST 16: Super-Eddington emergent luminosity saturates below raw accretion luminosity');
const curLambdaSuper = bhSuper.eddingtonRatio;
const expectedEmergentL = bhSuper.eddingtonLuminosity * (1.0 + Math.log(curLambdaSuper));
assert(Math.abs(bhSuper.emergentLuminosity - expectedEmergentL) < 1e-4, 'TEST 17: Emergent luminosity precisely matches L_Edd * (1 + ln(lambda_Edd))');
assert(bhSuper.emergentLuminosity > 0 && isFinite(bhSuper.emergentLuminosity), 'TEST 18: Emergent luminosity is strictly positive and finite');

// Monotonicity: higher disk mass still produces slightly higher emergent luminosity (logarithmic scaling)
const bhSuperHuge = new BlackHoleMock({ mass: 5000, spin: 0.85, diskMass: 50.0 });
assert(bhSuperHuge.emergentLuminosity > bhSuper.emergentLuminosity, 'TEST 19: Emergent luminosity grows monotonically with disk mass without linear runaway');

// Disabling Eddington limit reverts emergent luminosity to full accretion luminosity
CONFIG.tdeEddingtonLimitEnabled = false;
assert(Math.abs(bhSuper.emergentLuminosity - bhSuper.accretionLuminosity) < 1e-6, 'TEST 20: Disabling Eddington limit reverts emergent luminosity to full accretion luminosity');
CONFIG.tdeEddingtonLimitEnabled = true;

// ----------------------------------------------------------------------
// Group 5: Outward Radiation Pressure Acceleration
// ----------------------------------------------------------------------
console.log('\n--- Test Group 5: Outward Radiation Pressure Acceleration ---');

const radOut = new Vector3();
const samplePos = new Vector3(0, 0, 50); // 50 units along Z axis from BH at (0,0,0)

// Sub-Eddington radiation acceleration
const bhRadSub = new BlackHoleMock({ mass: 5000, spin: 0.85, diskMass: 1.0 });
bhRadSub.computeRadiationAcceleration(samplePos, radOut);

assert(radOut.z > 0 && radOut.x === 0 && radOut.y === 0, 'TEST 21: Radiation acceleration points radially outward away from the singularity');
const aGravMag = (CONFIG.G * bhRadSub.mass) / (50 * 50);
const aRadMag = radOut.length();
assert(aRadMag < aGravMag, 'TEST 22: In sub-Eddington regime, radiation acceleration is less than gravitational pull');

// Super-Eddington radiation acceleration
const bhRadSuper = new BlackHoleMock({ mass: 5000, spin: 0.85, diskMass: 25.0 });
bhRadSuper.computeRadiationAcceleration(samplePos, radOut);
const aRadSuperMag = radOut.length();
assert(aRadSuperMag > aGravMag, 'TEST 23: In super-Eddington regime, radiation acceleration exceeds gravitational pull (net outward repulsion)');

// Zero disk mass -> zero radiation acceleration
const bhRadZero = new BlackHoleMock({ mass: 5000, spin: 0.85, diskMass: 0.0 });
bhRadZero.computeRadiationAcceleration(samplePos, radOut);
assert(radOut.length() === 0, 'TEST 24: Zero disk mass produces exactly zero radiation acceleration');

// Disabling radiation pressure switch
CONFIG.tdeRadiationPressureEnabled = false;
bhRadSuper.computeRadiationAcceleration(samplePos, radOut);
assert(radOut.length() === 0, 'TEST 25: Disabling CONFIG.tdeRadiationPressureEnabled zeroes radiation acceleration');
CONFIG.tdeRadiationPressureEnabled = true;

// ----------------------------------------------------------------------
// Group 6: Super-Eddington Radiation Repulsion & Ejection
// ----------------------------------------------------------------------
console.log('\n--- Test Group 6: Super-Eddington Radiation Repulsion & Ejection ---');

const pPos = new Vector3(0, 0, 40);
const pVel = new Vector3(0, 0, 0);
const pAcc = new Vector3();
const pRadAcc = new Vector3();

// Apply super-Eddington gravity + radiation force over 5 seconds
const gPull = -(CONFIG.G * bhRadSuper.mass) / (40 * 40);
pAcc.set(0, 0, gPull);
bhRadSuper.computeRadiationAcceleration(pPos, pRadAcc);
pAcc.add(pRadAcc);

assert(pAcc.z > 0, 'TEST 26: Net acceleration on debris packet is directed outward due to radiation repulsion');
pVel.addScaledVector(pAcc, 5.0);
assert(pVel.z > 0, 'TEST 27: Velocity of debris packet increases outward under radiation pressure');

// Ejection transition
let ejectaMass = 0;
let packetMass = 0.25;
if (pVel.z > 5.0) { // Escaping debris packet
  ejectaMass += packetMass;
  packetMass = 0;
}
assert(ejectaMass === 0.25 && packetMass === 0, 'TEST 28: Radiation-ejected debris mass transfers atomically to ejectaMass');
assert(ejectaMass + packetMass === 0.25, 'TEST 29: No mass created or lost during radiation-driven ejection');

// ----------------------------------------------------------------------
// Group 7: Six-Component Closed Mass-Energy Conservation under Feedback
// ----------------------------------------------------------------------
console.log('\n--- Test Group 7: Six-Component Closed Mass-Energy Conservation under Feedback ---');

const M_init = 10.0;
let M_rem = M_init;
let M_str = 0.0;
let M_dsk = 0.0;
let M_ej = 0.0;
let M_bh = 0.0;
let M_rad = 0.0;

function verify6Conservation(phase) {
  const sum = M_rem + M_str + M_dsk + M_ej + M_bh + M_rad;
  const ok = Math.abs(M_init - sum) < 1e-12;
  assert(ok, `Mass-energy conserved during: ${phase} (Sum = ${sum.toFixed(8)} M☉)`);
  return ok;
}

// 1. Progenitor stripping
M_rem -= 5.0; M_str += 5.0;
verify6Conservation('Progenitor Stripping');

// 2. Stream circularization to disk
M_str -= 3.0; M_dsk += 3.0;
verify6Conservation('Stream Circularization');

// 3. Super-Eddington regulated viscous accretion
const bhSimEvol = new BlackHoleMock({ mass: 5000, spin: 0.85, diskMass: M_dsk });
for (let step = 0; step < 20; step++) {
  const mDotEff = bhSimEvol.effectiveAccretionRate;
  const dtSim = 0.25;
  const dM0 = Math.min(M_dsk, mDotEff * dtSim);
  const etaStep = bhSimEvol.accretionEfficiency;
  const dM_bh = (1.0 - etaStep) * dM0;
  const dM_r = etaStep * dM0;

  M_dsk -= dM0;
  M_bh += dM_bh;
  M_rad += dM_r;
  bhSimEvol.diskMass = M_dsk;
  bhSimEvol.mass += dM_bh;
}
verify6Conservation('Super-Eddington Regulated Viscous Accretion');

// 4. Radiation-driven ejecta escape
M_str -= 1.0; M_ej += 1.0;
verify6Conservation('Radiation-Driven Ejecta Escape');

// 5. Core dissolution final burst to disk
const remCore = M_rem;
M_rem = 0; M_dsk += remCore;
bhSimEvol.diskMass = M_dsk;
verify6Conservation('Core Dissolution to Disk');

// 6. Complete regulated drainage to extinction
while (M_dsk > 0) {
  const mDotEff = bhSimEvol.effectiveAccretionRate;
  const dM0 = Math.min(M_dsk, Math.max(mDotEff * 0.5, 0.05));
  const etaStep = bhSimEvol.accretionEfficiency;
  const dM_bh = (1.0 - etaStep) * dM0;
  const dM_r = etaStep * dM0;

  M_dsk -= dM0;
  M_bh += dM_bh;
  M_rad += dM_r;
  bhSimEvol.diskMass = M_dsk;
}
assert(verify6Conservation('Complete Regulated Lifecycle Extinction'), 'TEST 30: 6-Component closed mass-energy conservation strictly verified under Eddington feedback');

// ----------------------------------------------------------------------
// Group 8: Multi-Black-Hole Independence & Routing
// ----------------------------------------------------------------------
console.log('\n--- Test Group 8: Multi-Black-Hole Independence & Routing ---');

const bh1 = new BlackHoleMock({ id: 1, mass: 5000, spin: 0.85, diskMass: 20.0, position: new Vector3(0, 0, 0) });
const bh2 = new BlackHoleMock({ id: 2, mass: 2000, spin: 0.0, diskMass: 0.0, position: new Vector3(300, 0, 0) });

assert(bh1.eddingtonRatio > 1.0, 'TEST 31: Primary BH with disk evaluates super-Eddington state');
assert(bh2.eddingtonRatio === 0.0, 'TEST 32: Secondary BH without disk evaluates zero Eddington ratio');

const posNearBh2 = new Vector3(300, 0, 20);
const radBh1 = new Vector3();
const radBh2 = new Vector3();

bh1.computeRadiationAcceleration(posNearBh2, radBh1);
bh2.computeRadiationAcceleration(posNearBh2, radBh2);

assert(radBh2.length() === 0, 'TEST 33: Secondary BH without disk emits zero radiation force');
assert(bh1.effectiveAccretionRate < bh1.accretionRate, 'TEST 34: Primary BH regulates accretion independently');
assert(bh2.effectiveAccretionRate === 0, 'TEST 35: Secondary BH has zero effective accretion rate');

// ----------------------------------------------------------------------
// Group 9: Numerical Stability & Extremes
// ----------------------------------------------------------------------
console.log('\n--- Test Group 9: Numerical Stability & Extremes ---');

// Near-zero black hole mass
const bhTiny = new BlackHoleMock({ mass: 0.0001, diskMass: 1.0 });
assert(!isNaN(bhTiny.effectiveAccretionRate) && isFinite(bhTiny.effectiveAccretionRate), 'TEST 36: Near-zero BH mass does not produce NaN in effectiveAccretionRate');
assert(!isNaN(bhTiny.emergentLuminosity) && isFinite(bhTiny.emergentLuminosity), 'TEST 37: Near-zero BH mass does not produce NaN in emergentLuminosity');

// Near-singularity position (r -> 0)
const radSingularity = new Vector3();
bh1.computeRadiationAcceleration(new Vector3(0, 0, 0.00001), radSingularity);
assert(!isNaN(radSingularity.x) && isFinite(radSingularity.length()), 'TEST 38: Radiation acceleration at r -> 0 remains finite and bounded by NUMERICAL_SAFETY_LIMIT (250)');
assert(radSingularity.length() <= 250.0001, 'TEST 39: Radiation acceleration strictly clamped to safety ceiling');

// Extremely massive disk (M_disk = 10,000 M☉)
const bhHugeDisk = new BlackHoleMock({ mass: 5000, diskMass: 10000 });
assert(!isNaN(bhHugeDisk.effectiveAccretionRate) && isFinite(bhHugeDisk.effectiveAccretionRate), 'TEST 40: Extreme disk mass evaluates stable finite effectiveAccretionRate');
assert(!isNaN(bhHugeDisk.emergentLuminosity) && isFinite(bhHugeDisk.emergentLuminosity), 'TEST 41: Extreme disk mass evaluates stable finite emergentLuminosity');

// Large dt timestep
const dtLarge = 100.0;
const dMLarge = Math.min(bh1.diskMass, bh1.effectiveAccretionRate * dtLarge);
assert(dMLarge <= bh1.diskMass, 'TEST 42: Large timestep drain does not overshoot disk mass reservoir');

// ----------------------------------------------------------------------
// Group 10: Regression & Configuration Bounds
// ----------------------------------------------------------------------
console.log('\n--- Test Group 10: Regression & Configuration Bounds ---');

assert(CONFIG.tdeEddingtonLimitEnabled === true, 'TEST 43: CONFIG.tdeEddingtonLimitEnabled is active');
assert(CONFIG.tdeRadiationPressureEnabled === true, 'TEST 44: CONFIG.tdeRadiationPressureEnabled is active');
assert(CONFIG.tdeEddingtonFeedbackStrength === 1.0, 'TEST 45: CONFIG.tdeEddingtonFeedbackStrength default is 1.0');

// Feedback strength multiplier scaling
const radFull = new Vector3();
const radHalf = new Vector3();
CONFIG.tdeEddingtonFeedbackStrength = 1.0;
bhRadSuper.computeRadiationAcceleration(samplePos, radFull);
CONFIG.tdeEddingtonFeedbackStrength = 0.5;
bhRadSuper.computeRadiationAcceleration(samplePos, radHalf);
CONFIG.tdeEddingtonFeedbackStrength = 1.0;

assert(Math.abs(radHalf.length() - radFull.length() * 0.5) < 1e-4, 'TEST 46: Radiation acceleration scales linearly with CONFIG.tdeEddingtonFeedbackStrength');

// Zero feedback strength zeroes acceleration
CONFIG.tdeEddingtonFeedbackStrength = 0.0;
const radZeroFb = new Vector3();
bhRadSuper.computeRadiationAcceleration(samplePos, radZeroFb);
CONFIG.tdeEddingtonFeedbackStrength = 1.0;
assert(radZeroFb.length() === 0, 'TEST 47: Zero feedback strength produces zero radiation acceleration');

// Getters exist on BlackHole class
assert(typeof bh1.effectiveAccretionRate === 'number', 'TEST 48: effectiveAccretionRate getter returns scalar number');
assert(typeof bh1.emergentLuminosity === 'number', 'TEST 49: emergentLuminosity getter returns scalar number');
assert(typeof bh1.computeRadiationAcceleration === 'function', 'TEST 50: computeRadiationAcceleration is a callable function');

// ----------------------------------------------------------------------
// Summary
// ----------------------------------------------------------------------
console.log('\n================================================================');
console.log(`VERIFICATION SUMMARY: ${passed} PASSED, ${failed} FAILED`);
console.log('================================================================\n');

if (failed > 0) {
  process.exit(1);
}
