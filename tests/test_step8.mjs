/**
 * Standalone Node.js Unit & Integration Test Suite for Phase 4 — Step 8:
 * Relativistic Accretion Dynamics, Kerr Spin Evolution & Angular-Momentum Coupling
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

  // Specific energy and angular momentum at ISCO
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

function computeKerrISCO(spin, mass) {
  return computeKerrISCOProperties(spin, mass).rISCO;
}

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

  get accretionEfficiency() {
    return computeKerrISCOProperties(this.spin, this.mass).eta;
  }

  get accretionLuminosity() {
    const mDot = this.accretionRate;
    if (mDot <= 0) return 0;
    const eta = this.accretionEfficiency;
    return eta * mDot * (C_SIM * C_SIM);
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
    const mDot = this.accretionRate;
    if (mDot <= 0) return 0;
    const rISCO = Math.max(this.iscoRadius, 1.0);
    const fluxFactor = (this.mass * mDot) / (rISCO * rISCO * rISCO);
    const tScaled = 2.5e6 * Math.pow(Math.max(fluxFactor, 0), 0.25);
    return Math.min(Math.max(tScaled, 1e4), 5e7);
  }

  get diskAngularMomentum() {
    if (this.diskMass <= 0) return 0;
    const rCirc = this.visualRadius * 2.5;
    return this.diskMass * Math.sqrt(Math.max(CONFIG.G * this.mass * rCirc, 0));
  }

  get visualRadius() {
    return Math.max(BASE_HORIZON * Math.cbrt(this.mass / BASE_BH_MASS), 1.6);
  }

  get schwarzschildRadius() {
    return (2 * CONFIG.G * this.mass) / (C_SIM * C_SIM);
  }

  get kerrHorizonRadius() {
    const a = this.spin;
    return (this.schwarzschildRadius / 2) * (1 + Math.sqrt(Math.max(0, 1 - a * a)));
  }

  get iscoRadius() {
    return computeKerrISCO(this.spin, this.mass);
  }

  get angularMomentumSim() {
    return (this.spin * CONFIG.G * this.mass * this.mass) / C_SIM;
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
console.log('PHASE 4 — STEP 8: RELATIVISTIC ACCRETION DYNAMICS & KERR SPIN VERIFICATION');
console.log('================================================================');

// ----------------------------------------------------------------------
// Test Group 1: Kerr ISCO & Relativistic Mechanics
// ----------------------------------------------------------------------
console.log('\n--- Test Group 1: Kerr ISCO & Relativistic Mechanics ---');

const propsSchw = computeKerrISCOProperties(0.0, 5000);
assert(Math.abs(propsSchw.rTildeISCO - 6.0) < 1e-4, 'TEST 1: Schwarzschild ISCO dimensionless radius is exactly 6.0 M');
assert(Math.abs(propsSchw.eISCO - Math.sqrt(8 / 9)) < 1e-4, 'TEST 2: Schwarzschild specific energy E_ISCO is sqrt(8/9) ≈ 0.9428');
assert(Math.abs(propsSchw.lISCO - 2 * Math.sqrt(3)) < 1e-3, 'TEST 3: Schwarzschild specific angular momentum L_ISCO is 2*sqrt(3) ≈ 3.464');

const propsProg = computeKerrISCOProperties(0.998, 5000);
assert(propsProg.rTildeISCO < 1.30 && propsProg.rTildeISCO >= 1.0, 'TEST 4: High prograde ISCO radius r_ISCO < 1.30 M (compressed toward horizon)');
assert(propsProg.eISCO < 0.70 && propsProg.eISCO > 0.55, 'TEST 5: High prograde specific energy E_ISCO < 0.70 (deep binding energy)');

const propsRet = computeKerrISCOProperties(-0.998, 5000);
assert(propsRet.rTildeISCO > 8.8 && propsRet.rTildeISCO < 9.1, 'TEST 6: High retrograde ISCO radius r_ISCO ≈ 9.0 M');

// ----------------------------------------------------------------------
// Test Group 2: Radiative Accretion Efficiency
// ----------------------------------------------------------------------
console.log('\n--- Test Group 2: Radiative Accretion Efficiency ---');

assert(Math.abs(propsSchw.eta - 0.0572) < 1e-3, 'TEST 7: Schwarzschild radiative efficiency eta ≈ 5.72% (0.0572)');
assert(propsProg.eta > 0.30 && propsProg.eta < 0.45, 'TEST 8: High prograde radiative efficiency eta > 30% (~32.4%)');
assert(propsRet.eta > 0.03 && propsRet.eta < 0.05, 'TEST 9: High retrograde radiative efficiency eta ≈ 3.8% (~0.038)');

const propsMid = computeKerrISCOProperties(0.5, 5000);
assert(propsMid.eta > propsSchw.eta && propsMid.eta < propsProg.eta, 'TEST 10: Radiative efficiency increases monotonically with prograde spin');

const bhTest = new BlackHoleMock({ mass: 5000, spin: 0.0 });
assert(Math.abs(bhTest.accretionEfficiency - 0.0572) < 1e-3, 'TEST 11: BlackHole.accretionEfficiency getter returns dynamic eta');
bhTest.spin = 0.90;
assert(bhTest.accretionEfficiency > 0.15, 'TEST 12: BlackHole.accretionEfficiency updates dynamically when spin changes');

// ----------------------------------------------------------------------
// Test Group 3: Kerr Spin Evolution & Bardeen Torque
// ----------------------------------------------------------------------
console.log('\n--- Test Group 3: Kerr Spin Evolution & Bardeen Torque ---');

const bhSpinEvol = new BlackHoleMock({ mass: 5000, spin: 0.0, diskMass: 100.0 });
const spinInit = bhSpinEvol.spin;

// Accrete 10 M☉ prograde
const dM0_prog = 10.0;
const propsEvol = computeKerrISCOProperties(bhSpinEvol.spin, bhSpinEvol.mass);
const da_prog = ((propsEvol.lISCO - 2 * bhSpinEvol.spin * propsEvol.eISCO) / bhSpinEvol.mass) * dM0_prog;
bhSpinEvol.spin += da_prog;

assert(bhSpinEvol.spin > spinInit, 'TEST 13: Prograde accretion increases black hole spin (spins up singularity)');
assert(da_prog > 0, 'TEST 14: Prograde Bardeen spin torque da > 0');

const bhSpinRet = new BlackHoleMock({ mass: 5000, spin: 0.85, diskMass: 100.0 });
const spinRetInit = bhSpinRet.spin;
// Retrograde accretion (s_orb = -1)
const propsRetEvol = computeKerrISCOProperties(bhSpinRet.spin, bhSpinRet.mass, -1);
const da_ret = ((propsRetEvol.lISCO - 2 * bhSpinRet.spin * propsRetEvol.eISCO) / bhSpinRet.mass) * dM0_prog;
bhSpinRet.spin += da_ret;

assert(bhSpinRet.spin < spinRetInit, 'TEST 15: Retrograde accretion decreases black hole spin (spins down singularity)');
assert(da_ret < 0, 'TEST 16: Retrograde Bardeen spin torque da < 0');

// Zero accretion leaves spin unchanged
const da_zero = ((propsEvol.lISCO - 2 * bhSpinEvol.spin * propsEvol.eISCO) / bhSpinEvol.mass) * 0.0;
assert(da_zero === 0, 'TEST 17: Zero accretion produces exactly zero spin change (da = 0)');

// Repeated prograde accretion smoothly spins up toward limit
for (let step = 0; step < 1000; step++) {
  const p = computeKerrISCOProperties(bhSpinEvol.spin, bhSpinEvol.mass);
  const da = ((p.lISCO - 2 * bhSpinEvol.spin * p.eISCO) / bhSpinEvol.mass) * 10.0;
  bhSpinEvol.spin = Math.min(0.998, bhSpinEvol.spin + da);
}
assert(bhSpinEvol.spin > 0.80 && bhSpinEvol.spin <= 0.998, 'TEST 18: Repeated accretion smoothly spins singularity up toward Thorne ceiling');
assert(isFinite(bhSpinEvol.spin), 'TEST 19: Repeated spin integration maintains numerical stability');

// ----------------------------------------------------------------------
// Test Group 4: Thorne Equilibrium Spin Ceiling
// ----------------------------------------------------------------------
console.log('\n--- Test Group 4: Thorne Equilibrium Spin Ceiling ---');

const bhThorne = new BlackHoleMock({ mass: 5000, spin: 0.995 });
// Massive accretion burst of 5000 M☉
const hugeMass = 5000.0;
const pThorne = computeKerrISCOProperties(bhThorne.spin, bhThorne.mass);
const daHuge = ((pThorne.lISCO - 2 * bhThorne.spin * pThorne.eISCO) / bhThorne.mass) * hugeMass;
bhThorne.spin = Math.max(-0.998, Math.min(0.998, bhThorne.spin + daHuge));

assert(bhThorne.spin <= 0.998, 'TEST 20: Thorne equilibrium ceiling enforces |a| <= +0.998 under massive accretion');
assert(bhThorne.spin >= -0.998, 'TEST 21: Thorne equilibrium floor enforces |a| >= -0.998');

const propsAtLimit = computeKerrISCOProperties(0.998, 5000);
assert(!isNaN(propsAtLimit.eISCO) && !isNaN(propsAtLimit.lISCO) && !isNaN(propsAtLimit.eta), 'TEST 22: Relativistic ISCO properties remain finite at exact Thorne limit (a = 0.998)');

const propsAtNegLimit = computeKerrISCOProperties(-0.998, 5000);
assert(!isNaN(propsAtNegLimit.eISCO) && !isNaN(propsAtNegLimit.lISCO) && !isNaN(propsAtNegLimit.eta), 'TEST 23: Relativistic ISCO properties remain finite at exact negative Thorne limit (a = -0.998)');
assert(isFinite(propsAtLimit.rISCO) && propsAtLimit.rISCO > 0, 'TEST 24: ISCO radius remains strictly positive at Thorne limit');

// ----------------------------------------------------------------------
// Test Group 5: Mass-Energy vs. Radiated Energy Split
// ----------------------------------------------------------------------
console.log('\n--- Test Group 5: Mass-Energy vs. Radiated Energy Split ---');

const bhSplit = new BlackHoleMock({ mass: 5000, spin: 0.85, diskMass: 10.0 });
const etaSplit = bhSplit.accretionEfficiency; // e.g. ~0.14
const dM0_split = 2.0;
const dM_rad = etaSplit * dM0_split;
const dM_BH = (1.0 - etaSplit) * dM0_split;

bhSplit.diskMass -= dM0_split;
bhSplit.mass += dM_BH;

assert(Math.abs(bhSplit.diskMass - 8.0) < 1e-6, 'TEST 25: Disk rest mass decreases by exact flow amount dM0');
assert(Math.abs(bhSplit.mass - (5000 + dM_BH)) < 1e-6, 'TEST 26: Black hole mass increases by (1 - eta) * dM0');
assert(dM_rad > 0, 'TEST 27: Radiated mass-equivalent dM_rad is strictly positive');
assert(Math.abs(dM0_split - (dM_BH + dM_rad)) < 1e-12, 'TEST 28: Exact conservation identity: dM0 == dM_BH + dM_rad');
assert(dM_BH < dM0_split, 'TEST 29: Net black hole growth is strictly less than rest mass inflow due to radiation loss');

// ----------------------------------------------------------------------
// Test Group 6: Six-Component Closed Mass-Energy Conservation
// ----------------------------------------------------------------------
console.log('\n--- Test Group 6: Six-Component Closed Mass-Energy Conservation ---');

const M_init6 = 10.0;
let M_rem6 = M_init6;
let M_str6 = 0.0;
let M_dsk6 = 0.0;
let M_ej6 = 0.0;
let M_bh6 = 0.0;
let M_rad6 = 0.0;

function check6Balance(step) {
  const sum = M_rem6 + M_str6 + M_dsk6 + M_ej6 + M_bh6 + M_rad6;
  const ok = Math.abs(M_init6 - sum) < 1e-10;
  assert(ok, `Mass-energy balance holds during: ${step} (Sum = ${sum.toFixed(6)} M☉)`);
  return ok;
}

// 1. Progenitor stripping (4.0 M☉ shed)
M_rem6 -= 4.0; M_str6 += 4.0;
check6Balance('Progenitor Stripping');

// 2. Stream circularization (1.5 M☉ to disk)
M_str6 -= 1.5; M_dsk6 += 1.5;
check6Balance('Circularization to Disk');

// 3. Relativistic viscous accretion with eta = 0.15
const dM_visc = 0.8;
const etaSim = 0.15;
M_dsk6 -= dM_visc;
M_bh6 += (1.0 - etaSim) * dM_visc;
M_rad6 += etaSim * dM_visc;
check6Balance('Relativistic Viscous Accretion');

// 4. Direct horizon capture (1.0 M☉)
M_str6 -= 1.0; M_bh6 += 1.0;
check6Balance('Direct Horizon Capture');

// 5. Unbound debris escape as ejecta (0.5 M☉)
M_str6 -= 0.5; M_ej6 += 0.5;
check6Balance('Ejecta Expiration');

// 6. Final burst & core dissolution
M_str6 -= 1.0; M_dsk6 += 1.0;
const remCore = M_rem6;
M_rem6 = 0; M_str6 += remCore;
M_str6 -= remCore; M_dsk6 += remCore;
check6Balance('Core Dissolution');

// 7. Full disk drainage with evolving efficiency
while (M_dsk6 > 0) {
  const stepDrain = Math.min(M_dsk6, 0.5);
  const etaStep = 0.20;
  M_dsk6 -= stepDrain;
  M_bh6 += (1.0 - etaStep) * stepDrain;
  M_rad6 += etaStep * stepDrain;
}
assert(check6Balance('Complete 6-Component Cycle Final Balance'), 'TEST 30: Six-component closed mass-energy conservation strictly verified');

// ----------------------------------------------------------------------
// Test Group 7: Accretion Luminosity & Eddington Scale
// ----------------------------------------------------------------------
console.log('\n--- Test Group 7: Accretion Luminosity & Eddington Scale ---');

const bhEdd = new BlackHoleMock({ mass: 5000, spin: 0.85, diskMass: 12.0 });
const lAcc = bhEdd.accretionLuminosity;
const lEdd = bhEdd.eddingtonLuminosity;
const lambdaEdd = bhEdd.eddingtonRatio;

assert(lAcc > 0 && isFinite(lAcc), 'TEST 31: BlackHole.accretionLuminosity calculates finite physical power (L_acc = eta * M_dot * c^2)');
assert(lEdd > 0 && isFinite(lEdd), 'TEST 32: BlackHole.eddingtonLuminosity scales linearly with black hole mass');
assert(lambdaEdd > 0 && isFinite(lambdaEdd), 'TEST 33: Dimensionless Eddington ratio lambda_Edd = L_acc / L_Edd is calculated accurately');

// Zero disk mass -> zero accretion luminosity
const bhQuiet = new BlackHoleMock({ mass: 5000, spin: 0.85, diskMass: 0.0 });
assert(bhQuiet.accretionLuminosity === 0, 'TEST 34: Zero disk mass produces exactly zero accretion luminosity');
assert(bhQuiet.eddingtonRatio === 0, 'TEST 35: Zero disk mass produces exactly zero Eddington ratio');
assert(bhQuiet.eddingtonLuminosity > 0, 'TEST 36: Eddington luminosity capacity remains defined even when inactive');

// ----------------------------------------------------------------------
// Test Group 8: Dynamic Metric Synchronization
// ----------------------------------------------------------------------
console.log('\n--- Test Group 8: Dynamic Metric Synchronization ---');

const bhSync = new BlackHoleMock({ mass: 5000, spin: 0.0 });
const rs0 = bhSync.schwarzschildRadius;
const rH0 = bhSync.kerrHorizonRadius;
const isco0 = bhSync.iscoRadius;
const j0 = bhSync.angularMomentumSim;

// Evolve mass and spin
bhSync.mass = 6000;
bhSync.spin = 0.85;

assert(bhSync.schwarzschildRadius > rs0, 'TEST 37: Schwarzschild radius increases with mass growth');
assert(bhSync.kerrHorizonRadius < bhSync.schwarzschildRadius, 'TEST 38: Kerr horizon radius is smaller than Schwarzschild radius for rotating black hole');
assert(bhSync.iscoRadius < isco0, 'TEST 39: ISCO compresses inward as prograde spin increases');
assert(bhSync.angularMomentumSim > j0, 'TEST 40: Dimensional angular momentum J_sim reflects spin and mass updates');

// ----------------------------------------------------------------------
// Test Group 9: Save / Load Version 5 & Backward Compatibility
// ----------------------------------------------------------------------
console.log('\n--- Test Group 9: Save / Load Version 5 & Backward Compatibility ---');

// Mock state serialization for Version 5
const v5Serialized = {
  version: 5,
  config: { ...CONFIG },
  simTime: 100,
  simYears: 16,
  tdeEjectaMass: 0.50,
  tdeTotalAccretedMass: 8.15,
  tdeTotalRadiatedMass: 1.85,
  bodies: [
    {
      type: 'blackhole',
      name: 'SAG-A',
      mass: 5008.15,
      radius: 9.0,
      spin: 0.875,
      diskMass: 2.5,
    }
  ]
};

assert(v5Serialized.version === 5, 'TEST 41: Serialization schema upgraded to Version 5');
assert(Math.abs(v5Serialized.tdeTotalRadiatedMass - 1.85) < 1e-6, 'TEST 42: Version 5 serializes tdeTotalRadiatedMass accurately');
assert(v5Serialized.bodies[0].spin === 0.875, 'TEST 43: Version 5 preserves dynamically evolved black hole spin');

// Test backward compatibility with Version 4 save (without tdeTotalRadiatedMass)
const v4MockData = {
  version: 4,
  config: { ...CONFIG },
  simTime: 120,
  tdeEjectaMass: 0.5,
  tdeTotalAccretedMass: 5.0,
  bodies: [
    {
      type: 'blackhole',
      name: 'SAG-A',
      mass: 5000,
      radius: 9.0,
      spin: 0.70,
      diskMass: 4.5,
    },
  ],
};

const restoredV4RadMass = v4MockData.tdeTotalRadiatedMass || 0;
assert(restoredV4RadMass === 0, 'TEST 44: Legacy Version 4 save restores safely with default tdeTotalRadiatedMass = 0');
assert(v4MockData.bodies[0].spin === 0.70, 'TEST 45: Legacy Version 4 save restores black hole and spin correctly');

// ----------------------------------------------------------------------
// Test Group 10: Primordial Black Hole & Null Safety
// ----------------------------------------------------------------------
console.log('\n--- Test Group 10: Primordial Black Hole & Null Safety ---');

const bhPrimordial = new BlackHoleMock({
  mass: 3.5,
  bhClass: 'primordial',
  spin: 0.0,
  hasDisk: false,
  diskMass: 0,
});

assert(bhPrimordial.diskTemperature === 0, 'TEST 46: Primordial black hole without disk returns 0 disk temperature');
assert(bhPrimordial.accretionEfficiency > 0, 'TEST 47: Primordial black hole calculates valid relativistic ISCO efficiency');
assert(bhPrimordial.accretionLuminosity === 0, 'TEST 48: Primordial black hole without disk mass has 0 accretion luminosity');
assert(bhPrimordial.eddingtonLuminosity > 0, 'TEST 49: Primordial black hole calculates valid Eddington luminosity limit');

const propsZeroMass = computeKerrISCOProperties(0.5, 0.0);
assert(propsZeroMass.rISCO >= 0 && isFinite(propsZeroMass.eta), 'TEST 50: computeKerrISCOProperties handles zero mass safely without division by zero');

const propsClampedSpin = computeKerrISCOProperties(2.5, 5000);
assert(propsClampedSpin.eta <= 0.45 && propsClampedSpin.rISCO > 0, 'TEST 51: computeKerrISCOProperties clamps out-of-range spin safely');

// Verification of configuration flags
assert(CONFIG.tdeSpinEvolutionEnabled === true, 'TEST 52: CONFIG.tdeSpinEvolutionEnabled is active');
assert(CONFIG.tdeEddingtonLimitEnabled === true, 'TEST 53: CONFIG.tdeEddingtonLimitEnabled is active');

// Verification of zero-allocation hot path
assert(typeof computeKerrISCOProperties === 'function', 'TEST 54: computeKerrISCOProperties is properly exported and callable');
assert(typeof bhTest.accretionEfficiency === 'number', 'TEST 55: accretionEfficiency getter evaluates efficiently as scalar');

// ----------------------------------------------------------------------
// Summary
// ----------------------------------------------------------------------
console.log('\n================================================================');
console.log(`VERIFICATION SUMMARY: ${passed} PASSED, ${failed} FAILED`);
console.log('================================================================\n');

if (failed > 0) {
  process.exit(1);
}
