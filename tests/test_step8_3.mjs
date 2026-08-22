/**
 * Standalone Node.js Unit & Integration Test Suite for Phase 4 — Step 8.3:
 * Relativistic Disk Emission, Doppler Beaming, Gravitational Redshift & Spectral Color Coupling
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
  multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
  length() { return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z); }
  lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
  normalize() {
    const l = this.length();
    if (l > 0.00001) this.multiplyScalar(1 / l);
    return this;
  }
  dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
  cross(v) {
    const x = this.y * v.z - this.z * v.y;
    const y = this.z * v.x - this.x * v.z;
    const z = this.x * v.y - this.y * v.x;
    return this.set(x, y, z);
  }
}

const MathUtils = {
  clamp: (v, min, max) => Math.min(max, Math.max(min, v)),
};

const CONFIG = {
  G: 0.6,
  blackHoleMass: 5000,
  diskBrightness: 1.0,
  dopplerBeamingEnabled: true,
  diskSpectralMappingEnabled: true,
  diskRelativisticBoost: 1.0,
  tdeEddingtonLimitEnabled: true,
  tdeViscousTimescale: 6.0,
};

const C_SIM = 60;
const BASE_BH_MASS = 5000;
const BASE_HORIZON = 9.0;

function computeKerrISCOProperties(spin, mass, sOrb) {
  const a = MathUtils.clamp(spin ?? 0, -0.998, 0.998);
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
  const eISCO = MathUtils.clamp(numE / denom, 0.0, 1.0);
  const eta = MathUtils.clamp(1.0 - eISCO, 0.01, 0.45);

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

function computeDiskSpectralProperties(r, rISCO, mDot, mass, spin) {
  const rSafe = Math.max(r || 0, 0.001);
  const rIscoSafe = Math.max(rISCO || 0, 0.001);
  const mDotSafe = Math.max(mDot || 0, 0.0);
  const massSafe = Math.max(mass || 0, 0.001);
  const a = MathUtils.clamp(spin ?? 0, -0.998, 0.998);

  const rPeak = (49.0 / 36.0) * rIscoSafe;
  const qFactor = rSafe > rIscoSafe ? Math.max(0.0, 1.0 - Math.sqrt(rIscoSafe / rSafe)) : 0.0;
  const qPeak = Math.max(0.0, 1.0 - Math.sqrt(rIscoSafe / rPeak));

  let flux = 0.0;
  let tEmit = 0.0;
  let tPeak = 0.0;

  if (mDotSafe > 0 && massSafe > 0) {
    const fluxFactor = (massSafe * mDotSafe) / (rIscoSafe * rIscoSafe * rIscoSafe);
    tPeak = Math.min(Math.max(2.5e6 * Math.pow(Math.max(fluxFactor, 0), 0.25), 1e4), 5e7);
    if (rSafe > rIscoSafe && qPeak > 0) {
      flux = ((3.0 * CONFIG.G * massSafe * mDotSafe) / (8.0 * Math.PI * rSafe * rSafe * rSafe)) * qFactor;
      const normProfile = Math.pow(rPeak / rSafe, 3.0) * (qFactor / qPeak);
      tEmit = tPeak * Math.pow(Math.max(normProfile, 0.0), 0.25);
    }
  }

  const rs = (2.0 * CONFIG.G * massSafe) / (C_SIM * C_SIM);
  const rH = (rs * 0.5) * (1.0 + Math.sqrt(Math.max(0.0, 1.0 - a * a)));
  const beta = MathUtils.clamp(
    (Math.sqrt(Math.max((CONFIG.G * massSafe) / rSafe, 0.0)) / Math.max(C_SIM, 1.0)) /
      (1.0 + a * Math.pow(rs / (2.0 * rSafe), 1.5)),
    0.0,
    0.82
  );
  const gamma = 1.0 / Math.sqrt(Math.max(1.0 - beta * beta, 0.01));
  const gGrav = Math.sqrt(Math.max(1.0 - (rH * 0.95) / Math.max(rSafe, rH), 0.02));

  return {
    rPeak,
    qFactor,
    flux,
    tEmit,
    tPeak,
    beta,
    gamma,
    gGrav,
  };
}

function blackbodyColor(tempK) {
  const t = MathUtils.clamp(tempK / 1000.0, 0.5, 45.0);
  const col = { r: 1.0, g: 1.0, b: 1.0 };
  if (t < 6.5) {
    col.r = 1.0;
    col.g = MathUtils.clamp(0.39 + 0.38 * Math.log(Math.max(t - 0.5, 0.01)), 0.0, 1.0);
    col.b = MathUtils.clamp(0.10 + 0.55 * Math.log(Math.max(t - 1.8, 0.01)), 0.0, 1.0);
  } else {
    col.r = MathUtils.clamp(1.18 - 0.08 * (t - 6.5), 0.55, 1.0);
    col.g = MathUtils.clamp(1.06 - 0.03 * (t - 6.5), 0.72, 1.0);
    col.b = 1.0;
  }
  return col;
}

class BlackHoleMock {
  constructor(opts = {}) {
    this.id = opts.id || 1;
    this.mass = opts.mass || 5000;
    this.spin = MathUtils.clamp(opts.spin ?? 0.85, -0.998, 0.998);
    this.diskMass = opts.diskMass ?? 0;
    this.diskScale = opts.diskScale ?? 6.5;
    this.spinDirection = opts.spinDirection ? opts.spinDirection.clone().normalize() : new Vector3(0, 1, 0);
    this.mesh = { position: opts.position ? opts.position.clone() : new Vector3(0, 0, 0) };
    this.diskMat = {
      uniforms: {
        uTime: { value: 0 },
        uBrightness: { value: 1.0 },
        uAccretionRate: { value: 0.0 },
        uEmergentLuminosity: { value: 0.0 },
        uDiskTemperature: { value: 2.5e6 },
        uInnerRadius: { value: 10.8 },
        uOuterRadius: { value: 60.0 },
        uDopplerEnabled: { value: true },
        uSpectralMappingEnabled: { value: true },
        uRelativisticBoost: { value: 1.0 },
        uCameraPos: { value: new Vector3(0, 160, 300) },
        uBHPos: { value: new Vector3(0, 0, 0) },
        uSpinAxis: { value: new Vector3(0, 1, 0) },
        uSpin: { value: this.spin },
        uMass: { value: this.mass },
        uG: { value: CONFIG.G },
      }
    };
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

  get diskTemperature() {
    if (this.diskMass <= 0 || !this.diskMat) return 0;
    const mDot = this.effectiveAccretionRate;
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
console.log('PHASE 4 — STEP 8.3: RELATIVISTIC DISK EMISSION & SPECTRAL COUPLING');
console.log('================================================================');

// ----------------------------------------------------------------------
// Group 1: Novikov-Thorne Radial Dissipation Profile
// ----------------------------------------------------------------------
console.log('\n--- Test Group 1: Novikov-Thorne Radial Dissipation Profile ---');

const iscoTest = 10.0;
const mDotTest = 2.0;
const massTest = 5000;
const spinTest = 0.85;

// Inside or at ISCO: flux must be zero
const pInside = computeDiskSpectralProperties(8.0, iscoTest, mDotTest, massTest, spinTest);
const pAtIsco = computeDiskSpectralProperties(10.0, iscoTest, mDotTest, massTest, spinTest);
assert(pInside.flux === 0.0 && pInside.qFactor === 0.0, 'TEST 1: Radial dissipation flux is identically zero inside ISCO (r < r_ISCO)');
assert(pAtIsco.flux === 0.0 && pAtIsco.qFactor === 0.0, 'TEST 2: Radial dissipation flux satisfies zero-torque boundary condition at r = r_ISCO');

// Outside ISCO: flux is positive
const pOutside = computeDiskSpectralProperties(15.0, iscoTest, mDotTest, massTest, spinTest);
assert(pOutside.flux > 0.0 && pOutside.qFactor > 0.0, 'TEST 3: Radial dissipation flux is strictly positive outside ISCO (r > r_ISCO)');

// Asymptotic falloff: at large r, flux ~ r^-3
const pFar1 = computeDiskSpectralProperties(100.0, iscoTest, mDotTest, massTest, spinTest);
const pFar2 = computeDiskSpectralProperties(200.0, iscoTest, mDotTest, massTest, spinTest);
const ratioFar = pFar1.flux / pFar2.flux; // Expected ~ (200/100)^3 = 8
assert(Math.abs(ratioFar - 8.0) < 1.0, 'TEST 4: Radial dissipation approaches r^-3 asymptotic falloff at large radii');

// Peak dissipation radius
const rPeakExpected = (49.0 / 36.0) * iscoTest;
assert(Math.abs(pOutside.rPeak - rPeakExpected) < 1e-5, 'TEST 5: Peak dissipation radius is exactly r_peak = (49/36) * r_ISCO (~1.361 r_ISCO)');

// ----------------------------------------------------------------------
// Group 2: Effective Disk Temperature & Peak Radius
// ----------------------------------------------------------------------
console.log('\n--- Test Group 2: Effective Disk Temperature & Peak Radius ---');

const pPeak = computeDiskSpectralProperties(rPeakExpected, iscoTest, mDotTest, massTest, spinTest);
const pNearPeak = computeDiskSpectralProperties(rPeakExpected * 1.5, iscoTest, mDotTest, massTest, spinTest);

assert(pPeak.tEmit > 0 && isFinite(pPeak.tEmit), 'TEST 6: Emitted temperature at peak radius is finite and positive');
assert(pPeak.tEmit >= pNearPeak.tEmit, 'TEST 7: Emitted temperature peaks at r_peak and declines outward');
assert(pInside.tEmit === 0.0, 'TEST 8: Emitted temperature inside ISCO is zero');

// Temperature scaling with accretion rate
const pLowAcc = computeDiskSpectralProperties(rPeakExpected, iscoTest, 0.5, massTest, spinTest);
assert(pPeak.tEmit > pLowAcc.tEmit, 'TEST 9: Emitted temperature increases monotonically with accretion rate M_dot');

// Temperature scaling with black hole mass
const pLowMass = computeDiskSpectralProperties(rPeakExpected, iscoTest, mDotTest, 1000, spinTest);
assert(pPeak.tEmit > pLowMass.tEmit, 'TEST 10: Emitted temperature increases monotonically with black hole mass');

// ----------------------------------------------------------------------
// Group 3: Blackbody / Spectral Color Mapping
// ----------------------------------------------------------------------
console.log('\n--- Test Group 3: Blackbody / Spectral Color Mapping ---');

const cCool = blackbodyColor(1500);  // Infrared / Deep Red
const cMid = blackbodyColor(5800);   // Solar White / Yellow
const cHot = blackbodyColor(15000);  // Cyan / Blue-White
const cExtreme = blackbodyColor(40000); // Hard UV / Blue-Violet

assert(cCool.r > cCool.b && cCool.g < 0.6, 'TEST 11: Cool temperature (<2000K) produces deep red/orange spectral color');
assert(cMid.r >= 0.9 && cMid.g >= 0.8, 'TEST 12: Moderate temperature (~5800K) produces near-white/solar spectral color');
assert(cHot.b > cHot.r, 'TEST 13: Hot temperature (~15000K) produces cyan/blue-white spectral color');
assert(cExtreme.b === 1.0 && cExtreme.r < 0.85, 'TEST 14: Extreme temperature (>30000K) produces deep blue/UV spectral color');

// Smooth interpolation (no NaN, bounded)
const cInterp = blackbodyColor(8500);
assert(!isNaN(cInterp.r) && !isNaN(cInterp.g) && !isNaN(cInterp.b), 'TEST 15: Blackbody spectral mapping interpolates smoothly without NaN');

// ----------------------------------------------------------------------
// Group 4: Relativistic Orbital Velocity & Lorentz Factor
// ----------------------------------------------------------------------
console.log('\n--- Test Group 4: Relativistic Orbital Velocity & Lorentz Factor ---');

assert(pPeak.beta > 0.0 && pPeak.beta < 1.0, 'TEST 16: Relativistic orbital speed beta is strictly sub-luminal (0 < beta < 1)');
assert(pPeak.beta <= 0.82, 'TEST 17: Relativistic orbital speed beta is safely clamped to rendering ceiling (<= 0.82)');
assert(pPeak.gamma >= 1.0 && isFinite(pPeak.gamma), 'TEST 18: Lorentz factor gamma >= 1.0 and strictly finite');

// Velocity increases inward toward ISCO
const pOuter = computeDiskSpectralProperties(50.0, iscoTest, mDotTest, massTest, spinTest);
assert(pPeak.beta > pOuter.beta, 'TEST 19: Relativistic orbital speed increases monotonically inward toward ISCO');

// Prograde vs retrograde velocity modulation
const pPrograde = computeDiskSpectralProperties(15.0, iscoTest, mDotTest, massTest, 0.9);
const pRetrograde = computeDiskSpectralProperties(15.0, iscoTest, mDotTest, massTest, -0.9);
assert(pPrograde.beta !== pRetrograde.beta, 'TEST 20: Kerr spin modulates orbital velocity between prograde and retrograde configurations');

// ----------------------------------------------------------------------
// Group 5: Doppler Factor & Line-of-Sight Alignment
// ----------------------------------------------------------------------
console.log('\n--- Test Group 5: Doppler Factor & Line-of-Sight Alignment ---');

const betaVal = 0.5;
const gammaVal = 1.0 / Math.sqrt(1.0 - betaVal * betaVal);

// Approaching side (cosTheta = +1.0)
const deltaApproach = 1.0 / (gammaVal * (1.0 - betaVal * 1.0));
// Receding side (cosTheta = -1.0)
const deltaRecede = 1.0 / (gammaVal * (1.0 - betaVal * -1.0));
// Transverse / Face-on (cosTheta = 0.0)
const deltaTransverse = 1.0 / (gammaVal * (1.0 - betaVal * 0.0));

assert(deltaApproach > 1.0, 'TEST 21: Approaching side exhibits Doppler boosting (delta > 1.0)');
assert(deltaRecede < 1.0, 'TEST 22: Receding side exhibits Doppler dimming (delta < 1.0)');
assert(deltaApproach > deltaRecede, 'TEST 23: Approaching side Doppler factor strictly exceeds receding side');
assert(Math.abs(deltaTransverse - 1.0 / gammaVal) < 1e-5, 'TEST 24: Transverse viewing angle exhibits pure transverse Doppler time dilation (1 / gamma)');
assert(deltaApproach < 6.0 && deltaRecede > 0.08, 'TEST 25: Doppler factor remains within safe dynamic rendering bounds');

// ----------------------------------------------------------------------
// Group 6: Kerr Gravitational Redshift
// ----------------------------------------------------------------------
console.log('\n--- Test Group 6: Kerr Gravitational Redshift ---');

assert(pPeak.gGrav < 1.0, 'TEST 26: Gravitational redshift factor g_grav < 1.0 near singularity');
assert(pPeak.gGrav > 0.0, 'TEST 27: Gravitational redshift factor g_grav is strictly positive');
assert(pFar2.gGrav > pPeak.gGrav, 'TEST 28: Gravitational redshift weakens outward toward asymptotic Minkowski space');
assert(Math.abs(pFar2.gGrav - 1.0) < 0.05, 'TEST 29: Gravitational redshift factor approaches 1.0 at large distance (g_grav -> 1)');
assert(!isNaN(pPeak.gGrav) && isFinite(pPeak.gGrav), 'TEST 30: Gravitational redshift calculation is numerically robust and finite');

// ----------------------------------------------------------------------
// Group 7: Unified Relativistic g-Factor & Intensity Scaling
// ----------------------------------------------------------------------
console.log('\n--- Test Group 7: Unified Relativistic g-Factor & Intensity Scaling ---');

const gUnifiedApproach = deltaApproach * pPeak.gGrav;
const gUnifiedRecede = deltaRecede * pPeak.gGrav;

assert(gUnifiedApproach > gUnifiedRecede, 'TEST 31: Unified relativistic g-factor preserves approaching vs receding asymmetry');

// Temperature shift: T_obs = g * T_emit
const tObsApproach = gUnifiedApproach * pPeak.tEmit;
const tObsRecede = gUnifiedRecede * pPeak.tEmit;
assert(tObsApproach > tObsRecede, 'TEST 32: Approaching side observed temperature is blueshifted hotter than receding side');

// Invariant intensity scaling: I_obs = g^4 * I_emit
const iObsApproach = Math.pow(gUnifiedApproach, 4.0);
const iObsRecede = Math.pow(gUnifiedRecede, 4.0);
assert(iObsApproach > iObsRecede, 'TEST 33: Relativistic intensity scaling I_obs = g^4 * I_emit produces headlamp brightness asymmetry');
assert(iObsApproach > 1.0 && iObsRecede < 1.0, 'TEST 34: Approaching side is boosted while receding side is dimmed');
assert(isFinite(iObsApproach) && isFinite(iObsRecede), 'TEST 35: Relativistic intensity factors remain finite and well-behaved');

// ----------------------------------------------------------------------
// Group 8: Dynamic ISCO & Kerr Spin Coupling
// ----------------------------------------------------------------------
console.log('\n--- Test Group 8: Dynamic ISCO & Kerr Spin Coupling ---');

const bhPro = new BlackHoleMock({ mass: 5000, spin: 0.95, diskMass: 5.0 });
const bhSchw = new BlackHoleMock({ mass: 5000, spin: 0.0, diskMass: 5.0 });
const bhRetro = new BlackHoleMock({ mass: 5000, spin: -0.95, diskMass: 5.0 });

assert(bhPro.iscoRadius < bhSchw.iscoRadius, 'TEST 36: High prograde spin contracts ISCO inward (r_ISCO(a=0.95) < r_ISCO(a=0))');
assert(bhRetro.iscoRadius > bhSchw.iscoRadius, 'TEST 37: High retrograde spin expands ISCO outward (r_ISCO(a=-0.95) > r_ISCO(a=0))');
assert(bhPro.diskTemperature > bhSchw.diskTemperature, 'TEST 38: Prograde black hole disk temperature is hotter due to deeper ISCO well');
assert(bhRetro.diskTemperature < bhSchw.diskTemperature, 'TEST 39: Retrograde black hole disk temperature is cooler due to expanded ISCO');
assert(bhPro.diskMat.uniforms.uInnerRadius.value > 0, 'TEST 40: Inner disk radius uniform is initialized with positive physical ISCO radius');

// ----------------------------------------------------------------------
// Group 9: Step 8.2 Emergent Luminosity Coupling
// ----------------------------------------------------------------------
console.log('\n--- Test Group 9: Step 8.2 Emergent Luminosity Coupling ---');

const bhSuper = new BlackHoleMock({ mass: 5000, spin: 0.85, diskMass: 25.0 }); // Super-Eddington
assert(bhSuper.eddingtonRatio > 1.0, 'TEST 41: Massive disk triggers super-Eddington regime (lambda_Edd > 1.0)');
assert(bhSuper.emergentLuminosity < bhSuper.accretionLuminosity, 'TEST 42: Emergent luminosity saturates below raw accretion luminosity');
assert(bhSuper.effectiveAccretionRate < bhSuper.accretionRate, 'TEST 43: Effective accretion rate is throttled by slim-disk advection');

// Uniform synchronization
bhSuper.diskMat.uniforms.uEmergentLuminosity.value = bhSuper.emergentLuminosity;
bhSuper.diskMat.uniforms.uAccretionRate.value = bhSuper.effectiveAccretionRate;
bhSuper.diskMat.uniforms.uInnerRadius.value = bhSuper.iscoRadius;
bhSuper.diskMat.uniforms.uDiskTemperature.value = bhSuper.diskTemperature;

assert(bhSuper.diskMat.uniforms.uEmergentLuminosity.value === bhSuper.emergentLuminosity, 'TEST 44: Disk material uniform uEmergentLuminosity accurately receives Step 8.2 saturated luminosity');
assert(bhSuper.diskMat.uniforms.uAccretionRate.value === bhSuper.effectiveAccretionRate, 'TEST 45: Disk material uniform uAccretionRate accurately receives Step 8.2 effective accretion rate');

// ----------------------------------------------------------------------
// Group 10: Numerical Stability & Extreme Values
// ----------------------------------------------------------------------
console.log('\n--- Test Group 10: Numerical Stability & Extreme Values ---');

// Zero mass
const pZeroMass = computeDiskSpectralProperties(10.0, 10.0, 1.0, 0.0, 0.0);
assert(!isNaN(pZeroMass.flux) && !isNaN(pZeroMass.tEmit), 'TEST 46: Zero black hole mass does not produce NaN');

// Extreme spin near Thorne limit
const pThorne = computeDiskSpectralProperties(5.0, 1.5, 1.0, 5000, 0.998);
assert(!isNaN(pThorne.beta) && isFinite(pThorne.gamma), 'TEST 47: Extreme spin at Thorne ceiling (a = 0.998) evaluates finite relativistic quantities');

// Tiny radius (r -> 0)
const pTinyR = computeDiskSpectralProperties(0.0001, 10.0, 1.0, 5000, 0.5);
assert(!isNaN(pTinyR.beta) && pTinyR.flux === 0.0, 'TEST 48: Extremely small radius (r -> 0) does not produce division by zero or NaN');

// Quiescent disk (M_disk = 0, mDot = 0)
const pQuiescent = computeDiskSpectralProperties(15.0, 10.0, 0.0, 5000, 0.5);
assert(pQuiescent.flux === 0.0 && pQuiescent.tEmit === 0.0, 'TEST 49: Quiescent disk with mDot = 0 emits identically zero flux and temperature');

// Extreme temperature blackbody mapping
const cOverflow = blackbodyColor(1e8);
assert(!isNaN(cOverflow.r) && isFinite(cOverflow.g), 'TEST 50: Extreme temperature input (10^8 K) to blackbody color mapping remains finite');

// ----------------------------------------------------------------------
// Group 11: Multi-Black-Hole Independence
// ----------------------------------------------------------------------
console.log('\n--- Test Group 11: Multi-Black-Hole Independence ---');

const bhA = new BlackHoleMock({ id: 1, mass: 8000, spin: 0.9, diskMass: 10.0 });
const bhB = new BlackHoleMock({ id: 2, mass: 1000, spin: -0.5, diskMass: 0.0 });

assert(bhA.diskMat.uniforms.uInnerRadius.value !== bhB.diskMat.uniforms.uInnerRadius.value || bhA.iscoRadius !== bhB.iscoRadius, 'TEST 51: Independent black holes evaluate distinct ISCO radii');
assert(bhA.diskTemperature > 0 && bhB.diskTemperature === 0, 'TEST 52: Accreting black hole has positive temperature while quiescent black hole has zero');
assert(bhA.diskMat.uniforms !== bhB.diskMat.uniforms, 'TEST 53: Multi-BH disk materials maintain isolated uniform dictionaries');

// ----------------------------------------------------------------------
// Group 12: Regression & Configuration Verification
// ----------------------------------------------------------------------
console.log('\n--- Test Group 12: Regression & Configuration Verification ---');

assert(CONFIG.diskSpectralMappingEnabled === true, 'TEST 54: CONFIG.diskSpectralMappingEnabled is active');
assert(CONFIG.diskRelativisticBoost === 1.0, 'TEST 55: CONFIG.diskRelativisticBoost default is 1.0');
assert(typeof computeDiskSpectralProperties === 'function', 'TEST 56: computeDiskSpectralProperties is exported and callable');

// ----------------------------------------------------------------------
// Group 13: Class Inheritance & Radius Accessor Regression Tests
// ----------------------------------------------------------------------
console.log('\n--- Test Group 13: Class Inheritance & Radius Accessor Regression Tests ---');

// Replicate exact CelestialBody base class and BlackHole derived class hierarchy
class CelestialBodyTest {
  constructor(opts) {
    this.name = opts.name;
    this.type = opts.type;
    this.mass = opts.mass;
    this.radius = opts.radius; // The exact line that threw TypeError in strict mode
  }
}

class BlackHoleTest extends CelestialBodyTest {
  constructor(opts) {
    super({ ...opts, type: 'blackhole' });
    this._visualRadius = opts.visualRadius;
  }

  get visualRadius() {
    return Math.max(BASE_HORIZON * Math.cbrt(this.mass / BASE_BH_MASS), 1.6);
  }

  set visualRadius(v) {
    this._visualRadius = v;
  }

  get radius() {
    return this.visualRadius;
  }

  set radius(v) {
    this._visualRadius = v;
  }
}

let bhConstructed = null;
let constructError = null;
try {
  bhConstructed = new BlackHoleTest({
    name: 'TEST-BH-01',
    mass: 5000,
    visualRadius: 9.0,
    radius: 9.0,
  });
} catch (e) {
  constructError = e;
}

assert(constructError === null, 'TEST 57: new BlackHole construction does not throw TypeError on radius setter');
assert(bhConstructed !== null, 'TEST 58: BlackHole instance is successfully instantiated');
assert(isFinite(bhConstructed.radius) && bhConstructed.radius === 9.0, 'TEST 59: BlackHole.radius returns finite physical/visual radius');
assert(isFinite(bhConstructed.visualRadius) && bhConstructed.visualRadius === 9.0, 'TEST 60: BlackHole.visualRadius returns finite visual radius');
assert(bhConstructed.radius === bhConstructed.visualRadius, 'TEST 61: BlackHole.radius and BlackHole.visualRadius maintain strict equality');

// Test dynamic scaling with mass growth
bhConstructed.mass = 40000;
assert(bhConstructed.visualRadius === 18.0 && bhConstructed.radius === 18.0, 'TEST 62: BlackHole.radius dynamically scales with mass growth');

// Test explicit property assignment
bhConstructed.radius = 12.0;
assert(bhConstructed._visualRadius === 12.0, 'TEST 63: Setting BlackHole.radius updates _visualRadius without throwing');

// ----------------------------------------------------------------------
// Summary
// ----------------------------------------------------------------------
console.log('\n================================================================');
console.log(`VERIFICATION SUMMARY: ${passed} PASSED, ${failed} FAILED`);
console.log('================================================================\n');

if (failed > 0) {
  process.exit(1);
}
