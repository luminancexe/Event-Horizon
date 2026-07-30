import * as THREE from 'three';
import { CONFIG, state, BASE_HORIZON, BASE_BH_MASS, CAPTURE_MULT, TIDAL_MULT, DRAG_MULT, STAR_LIFESPAN_K } from './state.js';
import { scene, createDiskMaterial } from './scene.js';
import { makeGlowTexture, makeRingTexture, starGlowTex } from './textures.js';
import { registerSelectable } from './selection.js';

/* =========================================================================
   TRAIL SYSTEM — every moving body drags one of these behind it
   ========================================================================= */
const TRAIL_LEN = 140;
export function createTrail(color, opacity = 0.35, additive = false) {
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(TRAIL_LEN * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setDrawRange(0, 0);
  const mat = new THREE.LineBasicMaterial({
    color, transparent: true, opacity, depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const line = new THREE.Line(geo, mat);
  scene.add(line);
  return { line, points: [], geo, baseOpacity: opacity };
}
export function updateTrail(trail, pos) {
  trail.points.push(pos.clone());
  if (trail.points.length > TRAIL_LEN) trail.points.shift();
  const arr = trail.geo.attributes.position.array;
  for (let i = 0; i < trail.points.length; i++) {
    arr[i * 3] = trail.points[i].x; arr[i * 3 + 1] = trail.points[i].y; arr[i * 3 + 2] = trail.points[i].z;
  }
  trail.geo.attributes.position.needsUpdate = true;
  trail.geo.setDrawRange(0, trail.points.length);
  trail.geo.computeBoundingSphere();
}

/* =========================================================================
   BODY REGISTRY HELPERS
   All gravitationally-massive, individually-simulated bodies (black holes,
   stars, planets, moons, comets) live in state.bodies so that N-body
   gravity, nested orbits (moon -> planet -> star -> black hole), and
   selection all work uniformly.
   ========================================================================= */
const NAME_POOL = {
  blackhole: ['SGR', 'M87', 'CYG-X', 'ABELL'],
  star: ['SOL', 'SIRIUS', 'VEGA', 'ALTAIR', 'RIGEL', 'CASTOR', 'DENEB'],
  planet: ['NOVA', 'KEPLER', 'TERRA', 'VULCAN', 'ORION', 'PYRA', 'AXION'],
  moon: ['LUNA', 'IO', 'TITAN', 'CHARON', 'PHOBOS'],
  comet: ['HALE', 'ENCKE', 'BIELA', 'SWIFT', 'BORREL'],
};
export function randomName(type) {
  const pool = NAME_POOL[type] || ['OBJ'];
  const w = pool[(Math.random() * pool.length) | 0];
  const n = String(Math.floor(Math.random() * 90) + 10);
  return `${w}-${n}`;
}

export function bhRadii(bh) {
  const s = Math.max(Math.cbrt(bh.mass / BASE_BH_MASS), 0.3);
  return { capture: BASE_HORIZON * CAPTURE_MULT * s, tidal: BASE_HORIZON * TIDAL_MULT * s, drag: BASE_HORIZON * DRAG_MULT * s };
}
export function blackHoles() { return state.bodies.filter((b) => b.type === 'blackhole'); }
export function nearestBlackHole(pos) {
  let best = null, bestD = Infinity;
  for (const bh of blackHoles()) {
    const d = pos.distanceTo(bh.mesh.position);
    if (d < bestD) { bestD = d; best = bh; }
  }
  return { bh: best, dist: bestD };
}
export function dominantBlackHole() {
  let best = null;
  for (const bh of blackHoles()) if (!best || bh.mass > best.mass) best = bh;
  return best;
}
// the body that exerts the strongest gravitational pull at a given point
export function findDominantAttractor(pos, excludeObj) {
  let best = null, bestForce = -1;
  for (const s of state.bodies) {
    if (s === excludeObj) continue;
    const d = Math.max(pos.distanceTo(s.mesh.position), 0.5);
    const force = s.mass / (d * d);
    if (force > bestForce) { bestForce = force; best = s; }
  }
  return best;
}
export function orbitalVelocity(pos, center, mass, speedMul = 1) {
  const rel = pos.clone().sub(center);
  const r = Math.max(rel.length(), 1);
  const v = Math.sqrt((CONFIG.G * mass) / r) * speedMul;
  const dir = new THREE.Vector3(-rel.z, 0, rel.x).normalize();
  return dir.multiplyScalar(v);
}
export function starColorForTemp(t) {
  const stops = [
    [0.0, new THREE.Color(0xff5533)], [0.3, new THREE.Color(0xffa447)],
    [0.55, new THREE.Color(0xfff3c2)], [0.8, new THREE.Color(0xdcefff)], [1.0, new THREE.Color(0x9fd4ff)],
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    if (t >= stops[i][0] && t <= stops[i + 1][0]) {
      const lt = (t - stops[i][0]) / (stops[i + 1][0] - stops[i][0]);
      return stops[i][1].clone().lerp(stops[i + 1][1], lt);
    }
  }
  return stops[stops.length - 1][1].clone();
}
export function tempKtoFrac(k) { return THREE.MathUtils.clamp((k - 2500) / (30000 - 2500), 0, 1); }

export function randomOrbitPosition(minR, maxR) {
  const r = minR + Math.random() * (maxR - minR);
  const a = Math.random() * Math.PI * 2;
  return new THREE.Vector3(Math.cos(a) * r, (Math.random() - 0.5) * 6, Math.sin(a) * r);
}

/* =========================================================================
   OBJECT ARCHITECTURE — class hierarchy for every simulated body.
   The factory functions below build the Three.js visuals (mesh, glow,
   disk, etc.) exactly as before, then hand them to one of these classes.
   Everything else in the app (physics, selection, UI, effects) only ever
   touches the common fields defined here (mass, mesh, velocity,
   acceleration, trail, ...).
   ========================================================================= */
export class CelestialBody {
  constructor(opts) {
    this.id = state.idCounter++;
    this.name = opts.name;
    this.type = opts.type;
    this.mass = opts.mass;
    this.radius = opts.radius;
    this.mesh = opts.mesh;         // THREE.Group / Mesh — world position lives here
    this.core = opts.core;         // the raycastable/selectable mesh
    this.velocity = opts.velocity ? opts.velocity.clone() : new THREE.Vector3();
    this.acceleration = new THREE.Vector3(); // persisted for Velocity Verlet integration
    this.rotationSpeed = opts.rotationSpeed ?? 0.3;
    this.temperature = opts.temperature ?? null;
    this.trail = opts.trail ?? null;
    this.parent = opts.parent ?? null;   // e.g. the planet a moon orbits, if known
    this.children = [];
    if (this.parent) this.parent.children.push(this);
    this.status = 'stable';
    this.age = opts.age ?? 0;
    this.lifecycleScale = 1;
    this.lastLog = {};
    this._destroyed = false;
    this._createdAt = performance.now(); // grace period before this body can collide with anything
  }
  // convenience accessor — most existing code still reads obj.mesh.position
  // directly, but this satisfies the "Position (x,y,z)" field expectation
  get position() { return this.mesh.position; }
  kineticEnergy() { return 0.5 * this.mass * this.velocity.lengthSq(); }
}
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
export class Planet extends CelestialBody {
  constructor(opts) { super({ ...opts, type: 'planet' }); }
}
export class Moon extends CelestialBody {
  constructor(opts) { super({ ...opts, type: 'moon' }); }
}
export class Comet extends CelestialBody {
  constructor(opts) { super({ ...opts, type: 'comet' }); this.glow = opts.glow; }
}
export class NeutronStar extends CelestialBody {
  constructor(opts) { super({ ...opts, type: 'neutron' }); this.glow = opts.glow; }
}
export class BlackHole extends CelestialBody {
  constructor(opts) {
    super({ ...opts, type: 'blackhole' });
    this.visualRadius = opts.visualRadius;
    this.diskMat = opts.diskMat;
    this.photonSprite = opts.photonSprite;
  }
}

/* =========================================================================
   BLACK HOLE FACTORY
   ========================================================================= */
export function createBlackHole(opts = {}) {
  const mass = opts.mass ?? 5000;
  const visualRadius = Math.max(BASE_HORIZON * Math.cbrt(mass / BASE_BH_MASS), 2.5);
  const group = new THREE.Group();

  const horizonMesh = new THREE.Mesh(new THREE.SphereGeometry(visualRadius, 48, 48), new THREE.MeshBasicMaterial({ color: 0x000000 }));
  group.add(horizonMesh);

  const shadowTex = makeGlowTexture('rgba(4,2,10,0.95)', 'rgba(4,2,10,0)');
  const shadowSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
  shadowSprite.scale.set(visualRadius * 4.2, visualRadius * 4.2, 1);
  group.add(shadowSprite);

  const photonTex = makeRingTexture('rgba(255,244,214,0.95)');
  const photonSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: photonTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  photonSprite.scale.set(visualRadius * 2.5, visualRadius * 2.5, 1);
  group.add(photonSprite);

  const diskMat = createDiskMaterial(CONFIG.diskBrightness);
  const diskGeo = new THREE.RingGeometry(visualRadius * 1.2, visualRadius * 6.5, 256, 16);
  const diskMesh = new THREE.Mesh(diskGeo, diskMat);
  diskMesh.rotation.x = -Math.PI / 2;
  group.add(diskMesh);

  const pos = opts.position || new THREE.Vector3();
  group.position.copy(pos);
  scene.add(group);

  const obj = new BlackHole({
    name: opts.name || randomName('blackhole') + '-PRIME',
    mesh: group, core: horizonMesh, diskMat, photonSprite, visualRadius,
    mass, radius: visualRadius,
    velocity: opts.velocity,
    trail: createTrail(0x554466, 0.2),
  });
  state.bodies.push(obj);
  registerSelectable(horizonMesh, obj);
  return obj;
}

/* =========================================================================
   STAR / PLANET / MOON / COMET FACTORIES
   ========================================================================= */
export function createStar(opts = {}) {
  const tempK = opts.tempK ?? THREE.MathUtils.lerp(3200, 22000, Math.random());
  const tFrac = tempKtoFrac(tempK);
  const color = starColorForTemp(tFrac);
  const size = opts.size ?? (0.8 + tFrac * 1.6);
  const group = new THREE.Group();
  const core = new THREE.Mesh(new THREE.SphereGeometry(size, 24, 24), new THREE.MeshBasicMaterial({ color }));
  group.add(core);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: starGlowTex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.85 }));
  glow.scale.set(size * 7, size * 7, 1);
  group.add(glow);

  const pos = opts.position || randomOrbitPosition(60, 260);
  group.position.copy(pos);
  scene.add(group);

  const mass = opts.mass ?? (2 + Math.random() * 20);
  const isHighMass = mass > 11;
  const lifespan = STAR_LIFESPAN_K / Math.pow(mass, 1.6) + 3000; // heavier stars burn out much faster

  const obj = new Star({
    name: opts.name || randomName('star'),
    mesh: group, core, glow,
    mass, radius: size,
    velocity: opts.velocity || orbitalVelocity(pos, new THREE.Vector3(), CONFIG.blackHoleMass, 0.85 + Math.random() * 0.3),
    tempK, age: opts.age ?? 0,
    trail: createTrail(color.getHex(), 0.4),
    lifespan, isHighMass,
  });
  state.bodies.push(obj);
  registerSelectable(core, obj);
  return obj;
}

export function createPlanet(opts = {}) {
  const size = opts.size ?? (1.2 + Math.random() * 2.2);
  const hue = opts.hue ?? Math.random();
  const color = new THREE.Color().setHSL(hue, 0.55, 0.5 + Math.random() * 0.15);
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(size, 32, 32), new THREE.MeshPhongMaterial({ color, emissive: color.clone().multiplyScalar(0.08), shininess: 8 }));
  group.add(mesh);

  if (Math.random() < 0.4) {
    const ringGeo = new THREE.RingGeometry(size * 1.5, size * 2.4, 48);
    const ringMat = new THREE.MeshBasicMaterial({ color: color.clone().offsetHSL(0, -0.2, 0.2), side: THREE.DoubleSide, transparent: true, opacity: 0.6 });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2.3;
    group.add(ring);
  }

  const pos = opts.position || randomOrbitPosition(40, 220);
  group.position.copy(pos);
  scene.add(group);

  const obj = new Planet({
    name: opts.name || randomName('planet'),
    mesh: group, core: mesh,
    mass: opts.mass ?? (0.5 + Math.random() * 8), radius: size,
    velocity: opts.velocity || orbitalVelocity(pos, new THREE.Vector3(), CONFIG.blackHoleMass, 0.9 + Math.random() * 0.25),
    trail: createTrail(color.getHex(), 0.3),
  });
  state.bodies.push(obj);
  registerSelectable(mesh, obj);
  return obj;
}

// moons are physically identical to planets, just smaller and always spawned
// relative to an existing parent planet's position/velocity
export function createMoon(opts = {}) {
  const size = opts.size ?? (0.3 + Math.random() * 0.7);
  const color = new THREE.Color(0xaaaaaa).offsetHSL(0, 0, (Math.random() - 0.5) * 0.2);
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(size, 20, 20), new THREE.MeshPhongMaterial({ color, shininess: 4 }));
  group.add(mesh);

  const pos = opts.position || randomOrbitPosition(6, 14);
  group.position.copy(pos);
  scene.add(group);

  const obj = new Moon({
    name: opts.name || randomName('moon'),
    mesh: group, core: mesh,
    mass: opts.mass ?? (0.02 + Math.random() * 0.3), radius: size,
    velocity: opts.velocity || new THREE.Vector3(),
    trail: createTrail(color.getHex(), 0.3),
    parent: opts.parent || null,
  });
  state.bodies.push(obj);
  registerSelectable(mesh, obj);
  return obj;
}

export function createComet(opts = {}) {
  const size = opts.size ?? 0.6;
  const color = 0xbfe9ff;
  const core = new THREE.Mesh(new THREE.SphereGeometry(size, 12, 12), new THREE.MeshBasicMaterial({ color }));
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: starGlowTex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.9 }));
  glow.scale.set(size * 8, size * 8, 1);
  const group = new THREE.Group();
  group.add(core); group.add(glow);

  const pos = opts.position || randomOrbitPosition(150, 340);
  group.position.copy(pos);
  scene.add(group);

  const obj = new Comet({
    name: opts.name || randomName('comet'),
    mesh: group, core, glow,
    mass: opts.mass ?? (0.05 + Math.random() * 0.4), radius: size,
    velocity: opts.velocity || orbitalVelocity(pos, new THREE.Vector3(), CONFIG.blackHoleMass, 1.1 + Math.random() * 0.5),
    trail: createTrail(0x8fe0ff, 0.6, true),
  });
  state.bodies.push(obj);
  registerSelectable(core, obj);
  return obj;
}

// neutron star: the compact remnant left behind when a high-mass star's core
// collapses without quite enough mass to form a new black hole
export function createNeutronStar(opts = {}) {
  const size = opts.size ?? 0.55;
  const color = 0xdff2ff;
  const core = new THREE.Mesh(new THREE.SphereGeometry(size, 16, 16), new THREE.MeshBasicMaterial({ color }));
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: starGlowTex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 1 }));
  glow.scale.set(size * 11, size * 11, 1);
  const group = new THREE.Group();
  group.add(core); group.add(glow);

  const pos = opts.position || new THREE.Vector3();
  group.position.copy(pos);
  scene.add(group);

  const obj = new NeutronStar({
    name: opts.name || randomName('star') + '-NS',
    mesh: group, core, glow,
    mass: opts.mass ?? 6, radius: size,
    velocity: opts.velocity || new THREE.Vector3(),
    trail: createTrail(color, 0.5, true),
  });
  state.bodies.push(obj);
  registerSelectable(core, obj);
  return obj;
}
