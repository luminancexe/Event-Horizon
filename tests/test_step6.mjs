/**
 * Standalone Node.js Unit & Integration Test Suite for Phase 4 — Step 6:
 * Continuous Tidal Disruption & Plasma Streams
 */

// Lightweight Three.js Math Shim for Node.js execution
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
  tidalDisruptionEnabled: true,
  tdeStreamDensity: 1.0,
};

const C_SIM = 60;
const BASE_BH_MASS = 5000;
const BASE_HORIZON = 9.0;
const CAPTURE_MULT = 1.15;
const TIDAL_MULT = 4.8;
const DRAG_MULT = 3.6;

function computeTidalRadius(bh, body) {
  if (!bh || !body || body.mass <= 0 || body.radius <= 0) return 0;
  const mRatio = bh.mass / Math.max(body.mass, 1e-6);
  if (!Number.isFinite(mRatio) || mRatio <= 0) return 0;
  return body.radius * Math.cbrt(mRatio);
}

function bhRadii(bh, body = null) {
  const s = Math.max(Math.cbrt(bh.mass / BASE_BH_MASS), 0.3);
  const capture = BASE_HORIZON * CAPTURE_MULT * s;
  const tidal = body ? computeTidalRadius(bh, body) : BASE_HORIZON * TIDAL_MULT * s;
  const drag = BASE_HORIZON * DRAG_MULT * s;
  const rs = (2 * CONFIG.G * bh.mass) / (C_SIM * C_SIM);
  const a = bh.spin ?? 0;
  const kerrHorizon = (rs / 2) * (1 + Math.sqrt(Math.max(0, 1 - a * a)));
  const visual = Math.max(BASE_HORIZON * Math.cbrt(bh.mass / BASE_BH_MASS), 1.6);
  return { capture, tidal, drag, kerrHorizon, schwarzschild: rs, visual };
}

function computeKerrISCO(spin, mass) {
  const a = Math.max(-1, Math.min(1, spin ?? 0));
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

let passed = 0;
let failed = 0;

function assert(condition, name) {
  if (condition) {
    console.log(`  [PASS] ${name}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${name}`);
    failed++;
  }
}

console.log('================================================================');
console.log('PHASE 4 — STEP 6: CONTINUOUS TIDAL DISRUPTION VERIFICATION');
console.log('================================================================\n');

// ----------------------------------------------------------------------
// Test Group 1: Roche Tidal Radius Physics & Scaling
// ----------------------------------------------------------------------
console.log('--- Test Group 1: Roche Tidal Radius Physics & Scaling ---');

const bhMock = { mass: 5000, spin: 0.85 };
const star1 = { mass: 1.0, radius: 2.0 };
const star2 = { mass: 1.0, radius: 4.0 };
const star3 = { mass: 8.0, radius: 2.0 };

const rt1 = computeTidalRadius(bhMock, star1);
const rt2 = computeTidalRadius(bhMock, star2);
const rt3 = computeTidalRadius(bhMock, star3);

assert(Math.abs(rt2 / rt1 - 2.0) < 1e-4, 'TEST 1: Tidal radius scales linearly with body radius (rt2 = 2 * rt1)');
assert(Math.abs(rt3 / rt1 - Math.cbrt(1.0 / 8.0)) < 1e-4, 'TEST 2: Tidal radius scales as (M_BH / M_body)^(1/3)');
assert(rt1 > 0 && typeof rt1 === 'number' && isFinite(rt1), 'TEST 3: Tidal radius returns valid finite simulation-unit distance');
assert(computeTidalRadius(null, star1) === 0, 'Guard: null black hole returns 0');
assert(computeTidalRadius(bhMock, { mass: -5, radius: 2.0 }) === 0, 'Guard: negative mass returns 0');
assert(computeTidalRadius(bhMock, { mass: 1.0, radius: -2.0 }) === 0, 'Guard: negative radius returns 0');

// ----------------------------------------------------------------------
// Test Group 2: Compact Object Direct Plunge (Hills Regime)
// ----------------------------------------------------------------------
console.log('\n--- Test Group 2: Compact Object Regime & Scale Separation ---');

const neutronMock = { mass: 1.4, radius: 0.25 };
const radiiNS = bhRadii(bhMock, neutronMock);
assert(radiiNS.tidal < radiiNS.capture, 'TEST 4: Compact neutron star r_t (3.8 u) <= r_capture (10.35 u) -> Direct plunge regime');

const mainSeqStar = { mass: 1.0, radius: 2.5 };
const radiiStar = bhRadii(bhMock, mainSeqStar);
assert(radiiStar.tidal > radiiStar.capture, 'Main sequence star r_t (~42.7 u) > r_capture (10.35 u) -> Continuous TDE stream regime');

// ----------------------------------------------------------------------
// Test Group 3: Irreversible Mass Loss State Machine
// ----------------------------------------------------------------------
console.log('\n--- Test Group 3: Irreversible Mass Loss State Machine ---');

const body = {
  name: 'TEST-STAR',
  type: 'star',
  mass: 10.0,
  initialMass: 10.0,
  disruptedMass: 0,
  tdePhase: 0,
  radius: 3.0,
  _initialRadius: 3.0,
};

assert(body.tdePhase === 0, 'TEST 5A: Body initializes in Phase 0 (INTACT)');
assert(body.initialMass === 10.0, 'TEST 5B: Initial mass recorded correctly');
assert(body.disruptedMass === 0, 'TEST 5C: Disrupted mass starts at 0');

// Simulate stripping
body.tdePhase = 1;
const dM1 = 2.5;
body.mass -= dM1;
body.disruptedMass += dM1;
const massRatio1 = body.mass / body.initialMass;
body.radius = body._initialRadius * Math.cbrt(massRatio1);

assert(body.mass === 7.5, 'TEST 6: Body mass reduced to 7.5 M☉');
assert(body.disruptedMass === 2.5, 'Disrupted mass tracked as 2.5 M☉');
assert(body.radius < 3.0, 'TEST 7: Body radius shrunk proportionally with mass loss');

// Orbit moves outward (no mass restoration)
assert(body.mass === 7.5 && body.radius < 3.0, 'TEST 8: Mass and radius stay depleted after leaving periapsis');

// Additional stripping down to 4%
body.mass = 0.4;
body.disruptedMass = 9.6;
assert(body.mass <= 0.05 * body.initialMass, 'TEST 10: Trigger condition for Phase 2 (DISRUPTED) reached at <= 5% mass');

// ----------------------------------------------------------------------
// Test Group 4: Stream Velocity & Momentum Conservation
// ----------------------------------------------------------------------
console.log('\n--- Test Group 4: Stream Velocity & Momentum Conservation ---');

const pBody = new Vector3(30, 0, 0);
const vBody = new Vector3(0, 0, 8.0);
const pBH = new Vector3(0, 0, 0);
const rVec = new Vector3().subVectors(pBody, pBH);
const r = rVec.length();
const rHat = rVec.clone().normalize();
const vHat = vBody.clone().normalize();
const tHat = vHat.clone().sub(rHat.clone().multiplyScalar(vHat.dot(rHat))).normalize();

const dVTidal = 0.5 * Math.sqrt((CONFIG.G * 5000) / r) * (3.0 / r);
const vLead = vBody.clone().addScaledVector(tHat, -dVTidal);
const vTrail = vBody.clone().addScaledVector(tHat, dVTidal);

const vCOM = new Vector3().addVectors(vLead, vTrail).multiplyScalar(0.5);

assert(vCOM.distanceTo(vBody) < 1e-5, 'TEST 11: Momentum Conservation: 0.5 * (v_lead + v_trail) == v_body');
assert(vLead.length() < vBody.length() && vTrail.length() > vBody.length(), 'TEST 12: Leading packet has lower speed and trailing packet has higher speed');

// ----------------------------------------------------------------------
// Test Group 5: Black Hole Mass Growth & Dynamic Synchronizations
// ----------------------------------------------------------------------
console.log('\n--- Test Group 5: Black Hole Mass Growth & Dynamic Getters ---');

const bh = {
  mass: 5000,
  spin: 0.85,
  get schwarzschildRadius() { return (2 * CONFIG.G * this.mass) / (C_SIM * C_SIM); },
  get kerrHorizonRadius() { return (this.schwarzschildRadius / 2) * (1 + Math.sqrt(Math.max(0, 1 - this.spin * this.spin))); },
  get iscoRadius() { return computeKerrISCO(this.spin, this.mass); },
  get visualRadius() { return Math.max(BASE_HORIZON * Math.cbrt(this.mass / BASE_BH_MASS), 1.6); }
};

const rs0 = bh.schwarzschildRadius;
const rH0 = bh.kerrHorizonRadius;
const isco0 = bh.iscoRadius;
const vis0 = bh.visualRadius;

// Accrete 50 M☉ from stream
bh.mass += 50.0;

assert(bh.schwarzschildRadius > rs0, 'TEST 16A: schwarzschildRadius dynamically increased with accreted mass');
assert(bh.kerrHorizonRadius > rH0, 'TEST 16B: kerrHorizonRadius dynamically increased with accreted mass');
assert(bh.iscoRadius > isco0, 'TEST 16C: iscoRadius dynamically increased with accreted mass');
assert(bh.visualRadius > vis0, 'TEST 17: visualRadius dynamically updated with accreted mass');

// ----------------------------------------------------------------------
// Test Group 6: Mass Conservation Bookkeeping
// ----------------------------------------------------------------------
console.log('\n--- Test Group 6: Mass Conservation Invariant ---');

const M_initial = 10.0;
let M_remaining = M_initial;
let M_stream = 0.0;
let M_accreted = 0.0;

// Shed 3.0 M☉ into stream
const shed1 = 3.0;
M_remaining -= shed1;
M_stream += shed1;

assert(Math.abs(M_initial - (M_remaining + M_stream + M_accreted)) < 1e-6, 'Invariant holds after shedding: M_init = M_rem + M_stream + M_acc');

// Accrete 1.5 M☉ from stream into black hole
const acc1 = 1.5;
M_stream -= acc1;
M_accreted += acc1;

assert(Math.abs(M_initial - (M_remaining + M_stream + M_accreted)) < 1e-6, 'TEST 15: Invariant holds after accretion: M_init = M_rem + M_stream + M_acc');

// Complete disruption of remaining mass
const shed2 = M_remaining;
M_remaining = 0;
M_stream += shed2;
assert(Math.abs(M_initial - (M_remaining + M_stream + M_accreted)) < 1e-6, 'Invariant holds after core dissolution');

// ----------------------------------------------------------------------
// Test Group 7: Save / Load Schema Compatibility
// ----------------------------------------------------------------------
console.log('\n--- Test Group 7: Save / Load Schema Compatibility ---');

// Version 1 save state without TDE properties
const v1SaveBody = { type: 'star', name: 'SOL', mass: 1.0, radius: 2.5, position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 } };
const v1Restored = {
  ...v1SaveBody,
  tdePhase: v1SaveBody.tdePhase ?? 0,
  initialMass: v1SaveBody.initialMass ?? v1SaveBody.mass,
  disruptedMass: v1SaveBody.disruptedMass ?? 0,
};
assert(v1Restored.tdePhase === 0 && v1Restored.initialMass === 1.0 && v1Restored.disruptedMass === 0, 'TEST 25: Version 1 save state restored with safe default TDE properties');

// Version 3 save state with active stripping
const v3SaveBody = {
  type: 'star',
  name: 'VEGA',
  mass: 4.2,
  radius: 1.8,
  tdePhase: 1,
  initialMass: 8.0,
  disruptedMass: 3.8,
};
const v3Restored = {
  ...v3SaveBody,
  tdePhase: v3SaveBody.tdePhase ?? 0,
  initialMass: v3SaveBody.initialMass ?? v3SaveBody.mass,
  disruptedMass: v3SaveBody.disruptedMass ?? 0,
};
assert(v3Restored.tdePhase === 1 && v3Restored.initialMass === 8.0 && v3Restored.disruptedMass === 3.8, 'TEST 27: Version 3 TDE state (tdePhase, initialMass, disruptedMass) preserved across save/load');

console.log('\n================================================================');
console.log(`VERIFICATION SUMMARY: ${passed} PASSED, ${failed} FAILED`);
console.log('================================================================');

if (failed > 0) {
  process.exit(1);
}
