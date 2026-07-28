import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/* =========================================================================
   CONFIG  (Phase 1: selection, N-body gravity, object creation / drag-launch)
   ========================================================================= */
const CONFIG = {
  G: 0.6,
  blackHoleMass: 5000,       // mirrors the primary black hole's mass, kept for the slider
  timeScale: 1,
  paused: false,
  asteroidCount: 400,
  diskBrightness: 1.0,
  lensStrength: 1.0,
  gravityEnabled: true,      // can be switched off for performance A/B testing
  debugMode: false,
};

const BASE_HORIZON   = 9;      // visual radius of a "reference mass" black hole
const BASE_BH_MASS    = 5000;
const CAPTURE_MULT    = 1.15;
const TIDAL_MULT      = 4.2;
const DRAG_MULT       = 7.5;
const ESCAPE_R        = 480;
const SOFTENING       = 2.2;   // gravitational softening to avoid singular blow-ups
const VELOCITY_DRAG_SCALE = 0.26; // world-units-of-velocity per world-unit of drag
const AGE_YEARS_PER_SIMSECOND = 6;
const STAR_LIFESPAN_K = 60000; // heavier stars burn through this much faster (see createStar)

// at high time-scales a single frame can represent many sim-seconds; integrating
// the whole thing in one Euler step would let fast-moving bodies tunnel through
// capture radii or blow up numerically, so we always split big steps into
// bounded sub-steps instead.
const MAX_SUBSTEP_BODY      = 0.12;
const MAX_SUBSTEPS_BODY     = 40;
const MAX_SUBSTEPS_ASTEROID = 8;

let simTime = 0;
let simYears = 0;
let gravityCalcCount = 0; // reset each frame, used by the debug overlay

/* =========================================================================
   RENDERER / SCENE / CAMERA
   ========================================================================= */
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020306);

const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.5, 4000);
camera.position.set(0, 160, 300);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 20;
controls.maxDistance = 1400;
controls.target.set(0, 0, 0);
controls.autoRotateSpeed = 1.1;

/* ---- camera modes: free / follow / orbit, plus one-shot smooth "fly to"
   transitions used for the system/black-hole views -------------------- */
let cameraMode = 'free';
function setCameraMode(mode) {
  cameraMode = mode;
  controls.autoRotate = mode === 'orbit';
  document.getElementById('btn-follow').classList.toggle('active', mode === 'follow');
  document.getElementById('btn-orbit').classList.toggle('active', mode === 'orbit');
}
function easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
let cameraTween = null;
function flyCameraTo(targetPos, distance, duration = 1300) {
  const startPos = camera.position.clone();
  const startTarget = controls.target.clone();
  let dir = camera.position.clone().sub(controls.target);
  if (dir.lengthSq() < 0.01) dir.set(0.4, 0.5, 0.8);
  dir.normalize();
  const endPos = targetPos.clone().addScaledVector(dir, distance);
  cameraTween = { startPos, startTarget, endPos, endTarget: targetPos.clone(), start: performance.now(), duration };
  controls.enabled = false;
}

let shakeState = null;
function cameraShake(intensity = 1, duration = 700) { shakeState = { intensity, start: performance.now(), duration }; }

const diskLight = new THREE.PointLight(0xffb066, 6, 900, 1.6);
scene.add(diskLight);
scene.add(new THREE.AmbientLight(0x1a2a44, 0.9));

window.addEventListener('resize', onResize);
function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
}

/* =========================================================================
   TEXTURE HELPERS
   ========================================================================= */
function makeGlowTexture(inner, outer, size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}
function makeRingTexture(color, size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.30, size / 2, size / 2, size * 0.5);
  g.addColorStop(0.0, 'rgba(0,0,0,0)');
  g.addColorStop(0.42, 'rgba(0,0,0,0)');
  g.addColorStop(0.5, color);
  g.addColorStop(0.58, 'rgba(0,0,0,0)');
  g.addColorStop(1.0, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}
const starGlowTex = makeGlowTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)');
const selectionRingTex = makeRingTexture('rgba(127,217,255,0.95)');

/* =========================================================================
   BACKGROUND: starfield + nebulae
   ========================================================================= */
function buildStarfield() {
  const N = 7000;
  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  const palette = [[0.6, 0.75, 1.0], [1, 1, 1], [1, 0.92, 0.7], [1, 0.75, 0.55], [1, 0.55, 0.45]];
  for (let i = 0; i < N; i++) {
    const r = 900 + Math.random() * 1400;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    pos[i * 3 + 1] = r * Math.cos(phi);
    pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    const p = palette[(Math.random() * palette.length) | 0];
    col[i * 3] = p[0]; col[i * 3 + 1] = p[1]; col[i * 3 + 2] = p[2];
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({
    size: 1.6, map: starGlowTex, transparent: true, depthWrite: false,
    vertexColors: true, blending: THREE.AdditiveBlending, sizeAttenuation: true,
  });
  scene.add(new THREE.Points(geo, mat));
}
buildStarfield();

function buildNebulae() {
  const colors = ['rgba(120,80,200,0.35)', 'rgba(60,120,200,0.3)', 'rgba(200,90,140,0.28)'];
  for (let i = 0; i < 6; i++) {
    const tex = makeGlowTexture(colors[i % colors.length], 'rgba(0,0,0,0)', 256);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.5 });
    const sprite = new THREE.Sprite(mat);
    const r = 1000 + Math.random() * 900;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    sprite.position.set(r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi) * 0.4, r * Math.sin(phi) * Math.sin(theta));
    const s = 400 + Math.random() * 500;
    sprite.scale.set(s, s, 1);
    scene.add(sprite);
  }
}
buildNebulae();

/* =========================================================================
   ACCRETION DISK SHADER (factory — every black hole gets its own instance)
   ========================================================================= */
function createDiskMaterial(brightness) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: Math.random() * 100 }, uBrightness: { value: brightness } },
    vertexShader: `
      varying vec2 vUv;
      void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
    `,
    fragmentShader: `
      varying vec2 vUv;
      uniform float uTime;
      uniform float uBrightness;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453123); }
      float noise(vec2 p){
        vec2 i = floor(p); vec2 f = fract(p);
        float a = hash(i), b = hash(i+vec2(1.0,0.0)), c = hash(i+vec2(0.0,1.0)), d = hash(i+vec2(1.0,1.0));
        vec2 u = f*f*(3.0-2.0*f);
        return mix(a,b,u.x) + (c-a)*u.y*(1.0-u.x) + (d-b)*u.x*u.y;
      }
      float fbm(vec2 p){
        float v = 0.0; float amp = 0.55;
        for(int i=0;i<4;i++){ v += amp*noise(p); p *= 2.05; amp *= 0.55; }
        return v;
      }
      void main(){
        float radialFrac = clamp(vUv.y, 0.0, 1.0);
        float angle = vUv.x * 6.28318530718;
        float angVel = 5.2 / (radialFrac*2.2 + 0.35);
        float rotAngle = angle + uTime * angVel * 0.12;
        float turb = fbm(vec2(rotAngle * 2.4, radialFrac * 5.0 - uTime * 0.08));
        float turb2 = fbm(vec2(rotAngle * 5.5 + 4.0, radialFrac * 9.0 + uTime * 0.05));
        float brightness = turb * 0.65 + turb2 * 0.45;
        vec3 hot = vec3(1.0, 0.98, 0.92);
        vec3 mid = vec3(1.0, 0.55, 0.15);
        vec3 outer = vec3(0.75, 0.12, 0.05);
        vec3 col = mix(hot, mid, smoothstep(0.0, 0.45, radialFrac));
        col = mix(col, outer, smoothstep(0.45, 1.0, radialFrac));
        float flare = pow(max(turb2,0.0), 4.0) * 1.8;
        col += vec3(0.7,0.85,1.0) * flare * (1.0 - radialFrac);
        float edgeFade = smoothstep(0.0, 0.08, radialFrac) * (1.0 - smoothstep(0.82, 1.0, radialFrac));
        float alpha = edgeFade * (0.35 + brightness * 0.9) * uBrightness;
        gl_FragColor = vec4(col * (0.6 + brightness*0.9) * uBrightness, alpha);
      }
    `,
  });
}

/* =========================================================================
   BODY REGISTRY
   All gravitationally-massive, individually-simulated bodies (black holes,
   stars, planets, moons, comets) live in one flat array so that N-body
   gravity, nested orbits (moon -> planet -> star -> black hole), and
   selection all work uniformly.
   ========================================================================= */
let bodies = [];
let idCounter = 1;
let selected = null;
let followTarget = null;

const NAME_POOL = {
  blackhole: ['SGR', 'M87', 'CYG-X', 'ABELL'],
  star: ['SOL', 'SIRIUS', 'VEGA', 'ALTAIR', 'RIGEL', 'CASTOR', 'DENEB'],
  planet: ['NOVA', 'KEPLER', 'TERRA', 'VULCAN', 'ORION', 'PYRA', 'AXION'],
  moon: ['LUNA', 'IO', 'TITAN', 'CHARON', 'PHOBOS'],
  comet: ['HALE', 'ENCKE', 'BIELA', 'SWIFT', 'BORREL'],
};
function randomName(type) {
  const pool = NAME_POOL[type] || ['OBJ'];
  const w = pool[(Math.random() * pool.length) | 0];
  const n = String(Math.floor(Math.random() * 90) + 10);
  return `${w}-${n}`;
}

function bhRadii(bh) {
  const s = Math.max(Math.cbrt(bh.mass / BASE_BH_MASS), 0.3);
  return { capture: BASE_HORIZON * CAPTURE_MULT * s, tidal: BASE_HORIZON * TIDAL_MULT * s, drag: BASE_HORIZON * DRAG_MULT * s };
}
function blackHoles() { return bodies.filter((b) => b.type === 'blackhole'); }
function nearestBlackHole(pos) {
  let best = null, bestD = Infinity;
  for (const bh of blackHoles()) {
    const d = pos.distanceTo(bh.mesh.position);
    if (d < bestD) { bestD = d; best = bh; }
  }
  return { bh: best, dist: bestD };
}
function dominantBlackHole() {
  let best = null;
  for (const bh of blackHoles()) if (!best || bh.mass > best.mass) best = bh;
  return best;
}
// the body that exerts the strongest gravitational pull at a given point
function findDominantAttractor(pos, excludeObj) {
  let best = null, bestForce = -1;
  for (const s of bodies) {
    if (s === excludeObj) continue;
    const d = Math.max(pos.distanceTo(s.mesh.position), 0.5);
    const force = s.mass / (d * d);
    if (force > bestForce) { bestForce = force; best = s; }
  }
  return best;
}
function orbitalVelocity(pos, center, mass, speedMul = 1) {
  const rel = pos.clone().sub(center);
  const r = Math.max(rel.length(), 1);
  const v = Math.sqrt((CONFIG.G * mass) / r) * speedMul;
  const dir = new THREE.Vector3(-rel.z, 0, rel.x).normalize();
  return dir.multiplyScalar(v);
}
function starColorForTemp(t) {
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
function tempKtoFrac(k) { return THREE.MathUtils.clamp((k - 2500) / (30000 - 2500), 0, 1); }

/* =========================================================================
   TRAIL SYSTEM
   ========================================================================= */
const TRAIL_LEN = 140;
function createTrail(color, opacity = 0.35, additive = false) {
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
function updateTrail(trail, pos) {
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

// predicted trajectory (single reusable dashed line, approximated against the
// single strongest local attractor at each simulated step)
const predictGeo = new THREE.BufferGeometry();
const predictPositions = new Float32Array(80 * 3);
predictGeo.setAttribute('position', new THREE.BufferAttribute(predictPositions, 3));
const predictLine = new THREE.Line(predictGeo, new THREE.LineDashedMaterial({ color: 0x7fd9ff, dashSize: 3, gapSize: 2, transparent: true, opacity: 0.65 }));
predictLine.visible = false;
scene.add(predictLine);

// a second, independent predicted-path line used only while aiming a
// drag-to-launch throw, so it never fights with the selection prediction above
const dragPredictGeo = new THREE.BufferGeometry();
const dragPredictPositions = new Float32Array(80 * 3);
dragPredictGeo.setAttribute('position', new THREE.BufferAttribute(dragPredictPositions, 3));
const dragPredictLine = new THREE.Line(dragPredictGeo, new THREE.LineBasicMaterial({ color: 0x9be8ff, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false }));
dragPredictLine.visible = false;
scene.add(dragPredictLine);

// shared forward-integration used by both prediction lines: cheap "dominant
// single attractor" approximation, recomputed every step so it still bends
// correctly around whichever body currently matters most
const PREDICT_STEPS = 80, PREDICT_DT = 0.6;
function fillPredictedPath(geo, startPos, startVel) {
  const p = startPos.clone();
  const v = startVel.clone();
  const arr = geo.attributes.position.array;
  for (let i = 0; i < PREDICT_STEPS; i++) {
    const dominant = findDominantAttractor(p, null);
    if (dominant) {
      const rel = dominant.mesh.position.clone().sub(p);
      const dist = Math.max(rel.length(), 1);
      const a = (CONFIG.G * dominant.mass) / (dist * dist);
      v.addScaledVector(rel.normalize(), a * PREDICT_DT);
    }
    p.addScaledVector(v, PREDICT_DT);
    arr[i * 3] = p.x; arr[i * 3 + 1] = p.y; arr[i * 3 + 2] = p.z;
    const { bh: pbh, dist: pr } = nearestBlackHole(p);
    if (pbh && pr < bhRadii(pbh).capture) { for (let j = i + 1; j < PREDICT_STEPS; j++) { arr[j*3]=p.x;arr[j*3+1]=p.y;arr[j*3+2]=p.z; } break; }
  }
  geo.attributes.position.needsUpdate = true;
  geo.computeBoundingSphere();
  geo.computeLineDistances();
}

/* =========================================================================
   SELECTION VISUALS (shared, repositioned to whichever object is selected)
   ========================================================================= */
const selectionRing = new THREE.Sprite(new THREE.SpriteMaterial({ map: selectionRingTex, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending }));
selectionRing.visible = false;
scene.add(selectionRing);

const velocityArrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 1, 0xffe066, 2.2, 1.3);
velocityArrow.visible = false;
scene.add(velocityArrow);

const dragArrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 1, 0x7fd9ff, 3, 1.6);
dragArrow.visible = false;
scene.add(dragArrow);

const influenceSphere = new THREE.Mesh(
  new THREE.SphereGeometry(1, 24, 16),
  new THREE.MeshBasicMaterial({ color: 0x7fd9ff, wireframe: true, transparent: true, opacity: 0.16, depthWrite: false })
);
influenceSphere.visible = false;
scene.add(influenceSphere);

/* =========================================================================
   OBJECT ARCHITECTURE — class hierarchy for every simulated body.
   The factory functions below build the Three.js visuals (mesh, glow,
   disk, etc.) exactly as before, then hand them to one of these classes.
   Everything else in the file (physics, selection, UI, effects) only ever
   touches the common fields defined here (mass, mesh, velocity,
   acceleration, trail, ...), so swapping plain objects for real classes
   required no changes anywhere else.
   ========================================================================= */
class CelestialBody {
  constructor(opts) {
    this.id = idCounter++;
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
class Star extends CelestialBody {
  constructor(opts) {
    super({ ...opts, type: 'star' });
    this.glow = opts.glow;
    this.tempK = opts.tempK;
    this.lifespan = opts.lifespan;
    this.isHighMass = opts.isHighMass;
    this.stage = 'main_sequence';
  }
}
class Planet extends CelestialBody {
  constructor(opts) { super({ ...opts, type: 'planet' }); }
}
class Moon extends CelestialBody {
  constructor(opts) { super({ ...opts, type: 'moon' }); }
}
class Comet extends CelestialBody {
  constructor(opts) { super({ ...opts, type: 'comet' }); this.glow = opts.glow; }
}
class NeutronStar extends CelestialBody {
  constructor(opts) { super({ ...opts, type: 'neutron' }); this.glow = opts.glow; }
}
class BlackHole extends CelestialBody {
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
function createBlackHole(opts = {}) {
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
  bodies.push(obj);
  registerSelectable(horizonMesh, obj);
  return obj;
}

/* =========================================================================
   STAR / PLANET / MOON / COMET FACTORIES
   ========================================================================= */
function createStar(opts = {}) {
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
  bodies.push(obj);
  registerSelectable(core, obj);
  return obj;
}

function createPlanet(opts = {}) {
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
  bodies.push(obj);
  registerSelectable(mesh, obj);
  return obj;
}

// moons are physically identical to planets, just smaller and always spawned
// relative to an existing parent planet's position/velocity
function createMoon(opts = {}) {
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
  bodies.push(obj);
  registerSelectable(mesh, obj);
  return obj;
}

function createComet(opts = {}) {
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
  bodies.push(obj);
  registerSelectable(core, obj);
  return obj;
}

// neutron star: the compact remnant left behind when a high-mass star's core
// collapses without quite enough mass to form a new black hole
function createNeutronStar(opts = {}) {
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
  bodies.push(obj);
  registerSelectable(core, obj);
  return obj;
}

function randomOrbitPosition(minR, maxR) {
  const r = minR + Math.random() * (maxR - minR);
  const a = Math.random() * Math.PI * 2;
  return new THREE.Vector3(Math.cos(a) * r, (Math.random() - 0.5) * 6, Math.sin(a) * r);
}

/* =========================================================================
   ASTEROID FIELD (instanced test-particles, pooled, feel every massive body)
   ========================================================================= */
let asteroidMesh = null;
let aPos = [], aVel = [], aMass = [], aRadius = [], aAlive = [];
const dummy = new THREE.Object3D();

function initAsteroids(count) {
  if (asteroidMesh) { scene.remove(asteroidMesh); asteroidMesh.geometry.dispose(); asteroidMesh.material.dispose(); }
  aPos = []; aVel = []; aMass = []; aRadius = []; aAlive = [];
  const geo = new THREE.IcosahedronGeometry(1, 0);
  const mat = new THREE.MeshStandardMaterial({ color: 0x8b8378, roughness: 0.95, metalness: 0.05 });
  asteroidMesh = new THREE.InstancedMesh(geo, mat, Math.max(count, 1));
  asteroidMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(asteroidMesh);
  for (let i = 0; i < count; i++) spawnAsteroid(i);
}
function spawnAsteroid(i, pos, vel, mass, size) {
  aPos[i] = pos || randomOrbitPosition(BASE_HORIZON * 4, 200);
  aVel[i] = vel || orbitalVelocity(aPos[i], new THREE.Vector3(), CONFIG.blackHoleMass, 0.75 + Math.random() * 0.5);
  aMass[i] = mass ?? (0.05 + Math.random() * 1.5);
  aRadius[i] = size ?? (0.3 + Math.random() * 1.1);
  aAlive[i] = 1;
  dummy.position.copy(aPos[i]);
  dummy.scale.setScalar(aRadius[i]);
  dummy.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
  dummy.updateMatrix();
  asteroidMesh.setMatrixAt(i, dummy.matrix);
}
initAsteroids(CONFIG.asteroidCount);

let collisionLogCooldown = 0;
let asteroidCaptureFxCooldown = 0;
function updateAsteroids(dt) {
  asteroidCaptureFxCooldown -= dt;
  const n = aPos.length;
  const grid = new Map();
  const cellSize = 8;
  for (let i = 0; i < n; i++) {
    if (!aAlive[i]) continue;
    const pos = aPos[i];
    const { bh, dist: r } = nearestBlackHole(pos);
    if (bh && r < bhRadii(bh).capture) {
      if (asteroidCaptureFxCooldown <= 0) {
        triggerDiskBurst(bh, 0.08);
        burstAtDisk(pos.clone());
        logEvent('An asteroid has been consumed by the black hole.', 'info', pos);
        asteroidCaptureFxCooldown = 1.5;
      }
      spawnAsteroid(i);
      continue;
    }

    const accel = computeAcceleration(pos, null, bodies);
    aVel[i].addScaledVector(accel, dt);
    if (bh) {
      const radii = bhRadii(bh);
      if (r < radii.drag) {
        const k = (radii.drag - r) / radii.drag;
        aVel[i].multiplyScalar(1 - k * 0.015 * dt * 60);
      }
    }
    aPos[i].addScaledVector(aVel[i], dt);
    if (pos.length() > ESCAPE_R) spawnAsteroid(i);

    const key = `${Math.floor(aPos[i].x / cellSize)}_${Math.floor(aPos[i].z / cellSize)}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(i);
  }

  collisionLogCooldown -= dt;
  for (const cell of grid.values()) {
    for (let a = 0; a < cell.length; a++) {
      for (let b = a + 1; b < cell.length; b++) {
        const i = cell[a], j = cell[b];
        const d = aPos[i].distanceTo(aPos[j]);
        if (d < (aRadius[i] + aRadius[j]) * 0.9) {
          const n1 = aPos[i].clone().sub(aPos[j]).normalize();
          aVel[i].addScaledVector(n1, 0.6);
          aVel[j].addScaledVector(n1, -0.6);
          aPos[i].addScaledVector(n1, 0.15);
          aPos[j].addScaledVector(n1, -0.15);
          if (collisionLogCooldown <= 0) {
            logEvent('ASTEROID COLLISION DETECTED', 'info', aPos[i]);
            particleBurst(aPos[i], { count: 18, color: 0xcabaa0, spread: 2, size: 0.8, duration: 700, growth: 2 });
            collisionLogCooldown = 4;
          }
        }
      }
    }
  }

  for (let i = 0; i < n; i++) {
    if (!aAlive[i]) continue;
    dummy.position.copy(aPos[i]);
    dummy.scale.setScalar(aRadius[i]);
    dummy.rotation.y += 0.002;
    dummy.updateMatrix();
    asteroidMesh.setMatrixAt(i, dummy.matrix);
  }
  asteroidMesh.instanceMatrix.needsUpdate = true;
}

/* =========================================================================
   N-BODY GRAVITY
   ========================================================================= */
function computeAcceleration(pos, excludeObj, sources) {
  const accel = new THREE.Vector3();
  if (!CONFIG.gravityEnabled) return accel;
  for (const s of sources) {
    if (s === excludeObj) continue;
    const dx = s.mesh.position.x - pos.x, dy = s.mesh.position.y - pos.y, dz = s.mesh.position.z - pos.z;
    const distSq = dx * dx + dy * dy + dz * dz + SOFTENING * SOFTENING;
    const distSoft = Math.sqrt(distSq);
    const f = (CONFIG.G * s.mass) / (distSq * distSoft);
    accel.x += f * dx; accel.y += f * dy; accel.z += f * dz;
    gravityCalcCount++;
  }
  return accel;
}

/* =========================================================================
   SELECTION / RAYCASTING
   ========================================================================= */
const selectableMap = new Map();
function registerSelectable(mesh, obj) { selectableMap.set(mesh.uuid, obj); }
function unregisterSelectable(mesh) { selectableMap.delete(mesh.uuid); }

const raycaster = new THREE.Raycaster();
const pointerNDC = new THREE.Vector2();
let pointerDownPos = null, pointerDownTime = 0;
let longPressTimer = null;

function getPointer(e) {
  const t = (e.touches && e.touches[0]) || e;
  pointerNDC.x = (t.clientX / window.innerWidth) * 2 - 1;
  pointerNDC.y = -(t.clientY / window.innerHeight) * 2 + 1;
  return { x: t.clientX, y: t.clientY };
}

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.button === 2) return;
  const p = getPointer(e);
  if (placement) { beginPlacementDrag(p); return; }
  pointerDownPos = p; pointerDownTime = performance.now();
  if (e.pointerType === 'touch') {
    clearTimeout(longPressTimer);
    longPressTimer = setTimeout(() => openContextMenu(p.x, p.y), 550);
  }
});
renderer.domElement.addEventListener('pointermove', (e) => {
  const t = (e.touches && e.touches[0]) || e;
  if (placement) { updatePlacementPointer(t.clientX, t.clientY); return; }
  if (!pointerDownPos) return;
  const dx = t.clientX - pointerDownPos.x, dy = t.clientY - pointerDownPos.y;
  if (Math.hypot(dx, dy) > 8) clearTimeout(longPressTimer);
});
renderer.domElement.addEventListener('pointerup', (e) => {
  clearTimeout(longPressTimer);
  if (placement) { const p = getPointer(e); endPlacementDrag(p); return; }
  if (e.button === 2 || !pointerDownPos) return;
  const p = getPointer(e);
  const dx = p.x - pointerDownPos.x, dy = p.y - pointerDownPos.y;
  const dt = performance.now() - pointerDownTime;
  pointerDownPos = null;
  if (Math.hypot(dx, dy) < 8 && dt < 450) handleClick();
});

function handleClick() {
  raycaster.setFromCamera(pointerNDC, camera);
  const meshes = [...selectableMap.keys()].map((uuid) => scene.getObjectByProperty('uuid', uuid)).filter(Boolean);
  const hits = raycaster.intersectObjects(meshes, false);
  let asteroidHit = null;
  if (asteroidMesh) {
    const ahits = raycaster.intersectObject(asteroidMesh);
    if (ahits.length && (!hits.length || ahits[0].distance < hits[0].distance)) asteroidHit = ahits[0];
  }
  if (asteroidHit && !hits.length) { selectAsteroid(asteroidHit.instanceId); return; }
  if (hits.length === 0) { deselect(); return; }
  const obj = selectableMap.get(hits[0].object.uuid);
  if (obj) select(obj);
}

function updateBreadcrumb(parts) {
  document.getElementById('breadcrumb-bar').textContent = parts.join(' \u203a ');
}
function breadcrumbChainFor(obj) {
  const chain = [];
  let current = obj;
  let guard = 0;
  while (current && guard++ < 6) {
    chain.unshift(current.name);
    if (current.type === 'blackhole') break;
    current = findDominantAttractor(current.mesh.position, current);
  }
  return ['UNIVERSE', ...chain];
}

function select(obj) {
  if (selected && selected.trail) selected.trail.line.material.opacity = selected.trail.baseOpacity;
  selected = obj;
  if (obj.trail) obj.trail.line.material.opacity = Math.min(0.9, obj.trail.baseOpacity * 2.2);
  document.getElementById('info-panel').classList.remove('hidden');
  document.getElementById('btn-follow').disabled = false;
  document.getElementById('btn-orbit').disabled = false;
  document.getElementById('btn-delete-obj').classList.toggle('hidden', obj.type === 'blackhole');
  document.getElementById('btn-enter-system').classList.toggle('hidden', obj.type !== 'star');
  predictLine.visible = obj.type !== 'blackhole';
  updateBreadcrumb(breadcrumbChainFor(obj));
}
function selectAsteroid(instanceId) {
  if (selected && selected.trail) selected.trail.line.material.opacity = selected.trail.baseOpacity;
  selected = { type: 'asteroid', name: `AST-${instanceId}`, isAsteroid: true, index: instanceId };
  document.getElementById('info-panel').classList.remove('hidden');
  document.getElementById('btn-follow').disabled = true;
  document.getElementById('btn-orbit').disabled = true;
  document.getElementById('btn-delete-obj').classList.add('hidden');
  document.getElementById('btn-enter-system').classList.add('hidden');
  predictLine.visible = false;
  const dom = findDominantAttractor(aPos[instanceId], null);
  updateBreadcrumb(dom ? [...breadcrumbChainFor(dom), selected.name] : ['UNIVERSE', selected.name]);
}
function deselect() {
  if (selected && selected.trail) selected.trail.line.material.opacity = selected.trail.baseOpacity;
  selected = null;
  document.getElementById('info-panel').classList.add('hidden');
  document.getElementById('btn-follow').disabled = true;
  document.getElementById('btn-orbit').disabled = true;
  document.getElementById('btn-enter-system').classList.add('hidden');
  predictLine.visible = false;
  selectionRing.visible = velocityArrow.visible = influenceSphere.visible = false;
  updateBreadcrumb(['UNIVERSE']);
}
document.getElementById('btn-delete-obj').addEventListener('click', () => {
  if (selected && !selected.isAsteroid && selected.type !== 'blackhole') destroyObject(selected, 'removed', true);
  deselect();
});
document.getElementById('btn-enter-system').addEventListener('click', () => {
  if (!selected || selected.type !== 'star') return;
  const star = selected;
  const members = bodies.filter((b) => b !== star && findDominantAttractor(b.mesh.position, b) === star);
  let radius = 35;
  for (const m of members) radius = Math.max(radius, m.mesh.position.distanceTo(star.mesh.position) + m.radius * 3);
  flyCameraTo(star.mesh.position, radius * 1.5 + 30, 1400);
  followTarget = star;
  setCameraMode('follow');
  logEvent(`Entering the ${star.name} system.`, 'info', star.mesh.position);
});

/* =========================================================================
   CONTEXT MENU / CREATE-OBJECT BUTTON / DRAG-TO-LAUNCH PLACEMENT
   ========================================================================= */
const ctxMenu = document.getElementById('context-menu');
const placementPanel = document.getElementById('placement-panel');
const spawnPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

// placement state: { type, parentBody?, dragStart?, dragging }
let placement = null;
let ghostMarker = null;
function getGhostMarker() {
  if (!ghostMarker) {
    ghostMarker = new THREE.Mesh(
      new THREE.IcosahedronGeometry(2, 0),
      new THREE.MeshBasicMaterial({ color: 0x7fd9ff, wireframe: true, transparent: true, opacity: 0.7 })
    );
    ghostMarker.visible = false;
    scene.add(ghostMarker);
  }
  return ghostMarker;
}

function worldPointFromScreen(x, y) {
  pointerNDC.x = (x / window.innerWidth) * 2 - 1;
  pointerNDC.y = -(y / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointerNDC, camera);
  const out = new THREE.Vector3();
  raycaster.ray.intersectPlane(spawnPlane, out);
  return out;
}

function openContextMenu(x, y) {
  ctxMenu.style.left = Math.min(x, window.innerWidth - 210) + 'px';
  ctxMenu.style.top = Math.min(y, window.innerHeight - 200) + 'px';
  ctxMenu.classList.remove('hidden');
}
function closeContextMenu() { ctxMenu.classList.add('hidden'); }

renderer.domElement.addEventListener('contextmenu', (e) => { e.preventDefault(); if (!placement) openContextMenu(e.clientX, e.clientY); });
document.getElementById('btn-create').addEventListener('click', (e) => {
  const r = e.target.getBoundingClientRect();
  openContextMenu(r.right + 8, r.top);
});
document.addEventListener('pointerdown', (e) => { if (!ctxMenu.contains(e.target) && !ctxMenu.classList.contains('hidden')) closeContextMenu(); });

ctxMenu.querySelectorAll('.ctx-item').forEach((item) => {
  item.addEventListener('click', () => { startPlacement(item.dataset.type); closeContextMenu(); });
});

function startPlacement(type) {
  let parentBody = null;
  if (type === 'moon') {
    if (!selected || selected.type !== 'planet') {
      showBanner('SELECT A PLANET FIRST');
      logEvent('Moon creation requires a selected planet to orbit.', 'info');
      return;
    }
    parentBody = selected;
  }
  placement = { type, parentBody, dragging: false, dragStart: null };
  controls.enabled = true; // camera stays usable until the user actually starts dragging on empty space
  document.getElementById('placement-title').textContent = 'PLACING ' + type.toUpperCase() + (parentBody ? ` (ORBITS ${parentBody.name})` : '');
  document.getElementById('input-p-name').value = randomName(type);
  document.getElementById('row-p-temp').classList.toggle('hidden', type !== 'star');
  placementPanel.classList.remove('hidden');
  getGhostMarker().visible = true;
}
function cancelPlacement() {
  placement = null;
  placementPanel.classList.add('hidden');
  if (ghostMarker) ghostMarker.visible = false;
  dragArrow.visible = false;
  dragPredictLine.visible = false;
  controls.enabled = true;
}
document.getElementById('btn-p-cancel').addEventListener('click', cancelPlacement);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && placement) cancelPlacement(); });

function updatePlacementPointer(x, y) {
  const pt = worldPointFromScreen(x, y);
  if (!placement.dragging) {
    getGhostMarker().position.copy(pt);
  } else {
    const drag = pt.clone().sub(placement.dragStart);
    dragArrow.position.copy(placement.dragStart);
    if (drag.length() > 0.4) {
      dragArrow.visible = true;
      dragArrow.setDirection(drag.clone().normalize());
      dragArrow.setLength(Math.min(drag.length(), 220), 3, 1.6);
      let previewVel;
      if (placement.type === 'moon' && placement.parentBody) previewVel = drag.clone().multiplyScalar(VELOCITY_DRAG_SCALE).add(placement.parentBody.velocity);
      else previewVel = drag.clone().multiplyScalar(VELOCITY_DRAG_SCALE);
      fillPredictedPath(dragPredictGeo, placement.dragStart, previewVel);
      dragPredictLine.visible = true;
    } else { dragArrow.visible = false; dragPredictLine.visible = false; }
    ghostMarker.position.copy(placement.dragStart);
  }
}
function beginPlacementDrag(p) {
  placement.dragging = true;
  placement.dragStart = worldPointFromScreen(p.x, p.y);
  controls.enabled = false;
}
function endPlacementDrag(p) {
  if (!placement || !placement.dragging) return;
  const endPt = worldPointFromScreen(p.x, p.y);
  const dragStart = placement.dragStart;
  const dragVec = endPt.clone().sub(dragStart);
  const name = document.getElementById('input-p-name').value.trim() || randomName(placement.type);
  const mass = +document.getElementById('slider-p-mass').value;
  const size = +document.getElementById('slider-p-size').value;
  const tempK = +document.getElementById('slider-p-temp').value;

  let velocity;
  if (placement.type === 'moon') {
    const parent = placement.parentBody;
    if (dragVec.length() > 2) velocity = dragVec.clone().multiplyScalar(VELOCITY_DRAG_SCALE).add(parent.velocity);
    else velocity = orbitalVelocity(dragStart, parent.mesh.position, parent.mass, 1).add(parent.velocity);
  } else if (dragVec.length() > 2) {
    velocity = dragVec.clone().multiplyScalar(VELOCITY_DRAG_SCALE);
  } else {
    const dominant = findDominantAttractor(dragStart, null);
    velocity = dominant ? orbitalVelocity(dragStart, dominant.mesh.position, dominant.mass, 1).add(dominant.velocity) : new THREE.Vector3();
  }

  spawnFromPlacement(placement.type, dragStart, velocity, { name, mass, size, tempK, parentBody: placement.parentBody });
  logEvent(`New ${placement.type} "${name}" deployed into the field.`, 'info', dragStart);
  cancelPlacement();
}
function spawnFromPlacement(type, pos, vel, props) {
  switch (type) {
    case 'star': createStar({ position: pos, velocity: vel, mass: props.mass, size: props.size, tempK: props.tempK, name: props.name }); break;
    case 'planet': createPlanet({ position: pos, velocity: vel, mass: props.mass, size: props.size, name: props.name }); break;
    case 'moon': createMoon({ position: pos, velocity: vel, mass: Math.min(props.mass, 30), size: Math.min(props.size, 1.5), name: props.name, parent: props.parentBody }); break;
    case 'comet': createComet({ position: pos, velocity: vel, mass: Math.min(props.mass, 2), size: Math.min(props.size, 1.2), name: props.name }); break;
    case 'blackhole': createBlackHole({ position: pos, velocity: vel, mass: Math.max(props.mass * 30, 400), name: props.name }); break;
    case 'asteroid': {
      const i = aPos.length ? Math.floor(Math.random() * aPos.length) : 0;
      spawnAsteroid(i, pos, vel, Math.max(props.mass * 0.15, 0.05), Math.max(props.size * 0.5, 0.2));
      break;
    }
  }
}
['slider-p-mass', 'slider-p-size', 'slider-p-temp'].forEach((id) => {
  const el = document.getElementById(id);
  const valId = 'val-' + id.replace('slider-', '');
  el.addEventListener('input', () => { document.getElementById(valId).textContent = id === 'slider-p-temp' ? (+el.value).toFixed(0) : (+el.value).toFixed(1); });
});

/* =========================================================================
   DYNAMIC ACCRETION DISK — black holes react to objects falling in
   ========================================================================= */
function triggerDiskBurst(bh, magnitude) {
  if (!bh) return;
  bh._burst = Math.min((bh._burst || 0) + magnitude, 3.5);
}
function spawnEnergyRing(position, color = 0xfff2c8, maxScale = 26, duration = 1500) {
  const geo = new THREE.RingGeometry(1, 1.4, 80);
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false });
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
    if (t < 1) requestAnimationFrame(tick); else { scene.remove(ring); geo.dispose(); mat.dispose(); }
  }
  tick();
}

/* =========================================================================
   FRAGMENTS — lightweight debris spawned by tidal disintegration, spirals
   into the black hole that consumed the parent body and feeds the disk
   ========================================================================= */
let fragments = [];
const FRAG_MAX = 260;
function spawnFragments(obj, bh, count, color) {
  for (let i = 0; i < count && fragments.length < FRAG_MAX; i++) {
    const size = Math.max(obj.radius * (0.12 + Math.random() * 0.22), 0.15);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 });
    const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(size, 0), mat);
    const offset = new THREE.Vector3((Math.random() - 0.5) * obj.radius * 2, (Math.random() - 0.5) * obj.radius * 2, (Math.random() - 0.5) * obj.radius * 2);
    mesh.position.copy(obj.mesh.position).add(offset);
    scene.add(mesh);
    const scatter = new THREE.Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 6);
    fragments.push({
      mesh, mat, bh,
      velocity: obj.velocity.clone().add(scatter),
      spin: new THREE.Vector3(Math.random() * 3, Math.random() * 3, Math.random() * 3),
      life: 0, maxLife: 3.5,
    });
  }
}
function updateFragments(dt) {
  for (let i = fragments.length - 1; i >= 0; i--) {
    const f = fragments[i];
    f.life += dt;
    const bh = f.bh;
    if (!bh || !bodies.includes(bh) || f.life > f.maxLife) { removeFragment(i); continue; }
    const toCenter = bh.mesh.position.clone().sub(f.mesh.position);
    const dist = Math.max(toCenter.length(), 1);
    const accel = toCenter.normalize().multiplyScalar((CONFIG.G * bh.mass) / (dist * dist) + 4); // extra pull so debris reliably spirals in
    f.velocity.addScaledVector(accel, dt);
    f.mesh.position.addScaledVector(f.velocity, dt);
    f.mesh.rotation.x += f.spin.x * dt;
    f.mesh.rotation.y += f.spin.y * dt;
    f.mat.opacity = Math.max(0, 1 - f.life / f.maxLife);
    if (dist < bh.visualRadius * 1.05) {
      triggerDiskBurst(bh, 0.12);
      removeFragment(i);
    }
  }
}
function removeFragment(i) {
  const f = fragments[i];
  scene.remove(f.mesh);
  f.mesh.geometry.dispose();
  f.mat.dispose();
  fragments.splice(i, 1);
}

// gradual tidal disintegration: replaces the destroyed body with a scatter of
// fragments that spiral into the black hole and pulse the accretion disk,
// rather than the object simply vanishing on contact
function disintegrate(obj, bh) {
  const fragColor = {
    star: new THREE.Color(0xfff2c0), planet: obj.core.material.color ? obj.core.material.color.clone() : new THREE.Color(0xaaaaaa),
    moon: new THREE.Color(0xaaaaaa), comet: new THREE.Color(0xbfe9ff),
  }[obj.type] || new THREE.Color(0xffcc88);
  const count = { star: 16, planet: 11, moon: 6, comet: 5 }[obj.type] || 6;

  spawnFragments(obj, bh, count, fragColor);
  triggerDiskBurst(bh, 0.35 + obj.mass * 0.01);
  spawnEnergyRing(bh.mesh.position, obj.type === 'star' ? 0xfff2c8 : 0xffb066);

  logEvent(`${obj.name} has fragmented under extreme tidal stress.`, 'critical', obj.mesh.position);
  logEvent(`${obj.name} has been consumed by the black hole.`, 'critical', obj.mesh.position);
  showBanner(obj.type === 'planet' ? 'PLANETARY BODY DESTROYED' : obj.type === 'star' ? 'TIDAL DISRUPTION COMPLETE' : `${obj.name} CONSUMED`);

  destroyObject(obj, 'captured', true); // true: skip the generic burst/log, we already did a bespoke one above
}

/* =========================================================================
   STAR EVOLUTION — main sequence -> giant phase -> white dwarf / supernova
   ========================================================================= */
function updateStarLifecycle(obj) {
  if (obj.status === 'unstable') return; // tidal stretch already owns the mesh scale right now
  const frac = obj.age / obj.lifespan;

  if (frac >= 1 && obj.stage !== 'remnant') { triggerSupernova(obj); return; }

  if (frac >= 0.75 && obj.stage === 'main_sequence') {
    obj.stage = 'giant';
    obj.lifecycleScale = obj.isHighMass ? 2.6 : 1.9;
    obj.core.scale.setScalar(obj.lifecycleScale);
    const giantColor = obj.isHighMass ? 0xff5a3c : 0xff8a5c;
    obj.core.material.color.set(giantColor);
    obj.glow.material.color.set(giantColor);
    obj.glow.scale.set(obj.radius * 7 * obj.lifecycleScale * 1.3, obj.radius * 7 * obj.lifecycleScale * 1.3, 1);
    logEvent(`${obj.name} has swelled into a ${obj.isHighMass ? 'red supergiant' : 'red giant'}.`, 'info', obj.mesh.position);
    showBanner(`${obj.name}: ${obj.isHighMass ? 'RED SUPERGIANT' : 'RED GIANT'} PHASE`);
  }
}

function triggerSupernova(obj) {
  if (!obj.isHighMass) {
    // low-mass stars end quietly as a white dwarf rather than exploding
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

  obj.stage = 'remnant';
  logEvent('SUPERNOVA DETECTED', 'critical', obj.mesh.position);
  logEvent(`STAR ${obj.name} HAS COLLAPSED.`, 'critical', obj.mesh.position);
  showBanner('SUPERNOVA DETECTED');
  cameraShake(1.1, 900);

  particleBurst(obj.mesh.position, { count: 180, color: 0xfff2d0, spread: 6, size: 2.6, duration: 2400, growth: 10 });
  particleBurst(obj.mesh.position, { count: 90, color: 0x9fd4ff, spread: 4, size: 1.8, duration: 2000, growth: 7 });
  spawnEnergyRing(obj.mesh.position, 0xfff6e0, 55, 2200);

  // the blast wave nudges anything nearby outward
  for (const b of bodies) {
    if (b === obj) continue;
    const diff = b.mesh.position.clone().sub(obj.mesh.position);
    const d = diff.length();
    if (d < 150 && d > 0.01) b.velocity.addScaledVector(diff.normalize(), (1 - d / 150) * 22);
  }
  // scatter a small debris field of asteroids outward from the blast
  for (let k = 0; k < 6; k++) {
    if (!aPos.length) break;
    const idx = Math.floor(Math.random() * aPos.length);
    const dir = new THREE.Vector3(Math.random() - 0.5, (Math.random() - 0.5) * 0.4, Math.random() - 0.5).normalize();
    const p = obj.mesh.position.clone().addScaledVector(dir, 8 + Math.random() * 20);
    const v = obj.velocity.clone().addScaledVector(dir, 15 + Math.random() * 25);
    spawnAsteroid(idx, p, v, 0.3 + Math.random() * 1.2, 0.6 + Math.random() * 1.3);
  }

  const remnantMass = obj.mass * 0.35;
  if (obj.mass > 17) {
    createBlackHole({ position: obj.mesh.position.clone(), velocity: obj.velocity.clone(), mass: Math.max(remnantMass * 40, 350), name: obj.name + ' REMNANT' });
    logEvent(`${obj.name} has collapsed into a new black hole.`, 'critical', obj.mesh.position);
  } else {
    createNeutronStar({ position: obj.mesh.position.clone(), velocity: obj.velocity.clone(), mass: remnantMass, name: obj.name + '-NS' });
    logEvent(`${obj.name} has collapsed into a neutron star.`, 'info', obj.mesh.position);
  }

  destroyObject(obj, 'supernova', true);
}

/* =========================================================================
   DESTRUCTION / TIDAL EFFECTS / BANNERS
   ========================================================================= */
function particleBurst(position, opts = {}) {
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
  const mat = new THREE.PointsMaterial({ color: opts.color ?? 0xffdca0, size: opts.size ?? 1.4, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false });
  const pts = new THREE.Points(geo, mat);
  scene.add(pts);
  const start = performance.now();
  const duration = opts.duration ?? 1200;
  const growth = opts.growth ?? 3;
  function fade() {
    const t = (performance.now() - start) / duration;
    mat.opacity = Math.max(0, 1 - t);
    pts.scale.setScalar(1 + t * growth);
    if (t < 1) requestAnimationFrame(fade); else { scene.remove(pts); geo.dispose(); mat.dispose(); }
  }
  fade();
}
function burstAtDisk(position) { particleBurst(position); }
function showBanner(text) {
  const el = document.getElementById('notify-banner');
  el.textContent = text;
  el.classList.remove('hidden');
  clearTimeout(showBanner._t);
  showBanner._t = setTimeout(() => el.classList.add('hidden'), 2600);
}
function destroyObject(obj, reason, silent = false) {
  obj._destroyed = true;
  scene.remove(obj.mesh);
  scene.remove(obj.trail.line);
  obj.trail.geo.dispose();
  unregisterSelectable(obj.core);
  bodies = bodies.filter((b) => b !== obj);
  if (selected === obj) deselect();
  if (!silent) {
    burstAtDisk(obj.mesh.position);
    if (reason === 'captured') {
      logEvent(`${obj.name} has been consumed by the black hole.`, 'critical');
      showBanner(obj.type === 'planet' ? 'PLANETARY BODY DESTROYED' : 'TIDAL DISRUPTION COMPLETE');
    }
  }
}

/* =========================================================================
   BLACK HOLE INTERACTIONS — pairs that stray close orbit, decay, and merge
   ========================================================================= */
function updateBlackHoleInteractions(dt) {
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
      if (d < mergeR) { mergeBlackHoles(a, b); return; }
      if (d < decayR) {
        // no natural dissipation exists in simple two-body gravity, so a close
        // pair gets a gentle artificial drag that shrinks their mutual orbit
        // over time until they finally spiral together
        const k = (decayR - d) / decayR;
        const drag = 1 - k * 0.01 * Math.min(dt, MAX_SUBSTEP_BODY) * 60;
        a.velocity.multiplyScalar(drag);
        b.velocity.multiplyScalar(drag);
      }
    }
  }
}

function mergeBlackHoles(a, b) {
  if (a._destroyed || b._destroyed) return;
  const totalMass = a.mass + b.mass;
  const pos = a.mesh.position.clone().multiplyScalar(a.mass).add(b.mesh.position.clone().multiplyScalar(b.mass)).divideScalar(totalMass);
  const vel = a.velocity.clone().multiplyScalar(a.mass).add(b.velocity.clone().multiplyScalar(b.mass)).divideScalar(totalMass);
  const name = 'SGR-' + Math.floor(100 + Math.random() * 900) + ' MERGED';

  logEvent('BLACK HOLE MERGER DETECTED', 'critical', pos);
  logEvent(`${a.name} and ${b.name} have merged into a single, more massive black hole.`, 'critical', pos);
  showBanner('BLACK HOLE MERGER DETECTED');
  cameraShake(1.7, 1300);

  particleBurst(pos, { count: 200, color: 0xd8c8ff, spread: 8, size: 2.8, duration: 2600, growth: 12 });
  particleBurst(pos, { count: 110, color: 0x9fd4ff, spread: 6, size: 2, duration: 2200, growth: 9 });
  // a staggered set of rings reads as a rippling gravitational wave, distinct
  // from the single warm burst used for ordinary tidal disintegration
  spawnEnergyRing(pos, 0xd8c8ff, 60, 2400);
  setTimeout(() => spawnEnergyRing(pos, 0x9fd4ff, 72, 2600), 220);
  setTimeout(() => spawnEnergyRing(pos, 0xffffff, 50, 2000), 440);

  for (const body of bodies) {
    if (body === a || body === b) continue;
    const diff = body.mesh.position.clone().sub(pos);
    const d = diff.length();
    if (d < 220 && d > 0.01) body.velocity.addScaledVector(diff.normalize(), (1 - d / 220) * 16);
  }

  destroyObject(a, 'merged', true);
  destroyObject(b, 'merged', true);
  createBlackHole({ position: pos, velocity: vel, mass: totalMass, name });
}

/* =========================================================================
   COLLISION SYSTEM — any two non-black-hole massive bodies that touch
   either merge (low relative speed) or shatter into debris (high speed).
   Black-hole collisions are already handled by the tidal capture system;
   asteroid-asteroid collisions have their own lightweight bounce below.
   ========================================================================= */
const COLLISION_MERGE_SPEED = 12; // relative speed below which bodies merge instead of fragmenting
const COLLISION_GRACE_MS = 900;   // newly spawned bodies are briefly immune (e.g. a moon placed close to its planet)

function checkBodyCollisions() {
  const now = performance.now();
  const massive = bodies.filter((b) => !b._destroyed && b.type !== 'blackhole' && now - b._createdAt > COLLISION_GRACE_MS);
  for (let i = 0; i < massive.length; i++) {
    const a = massive[i];
    if (a._destroyed) continue;
    for (let j = i + 1; j < massive.length; j++) {
      const b = massive[j];
      if (b._destroyed) continue;
      const d = a.mesh.position.distanceTo(b.mesh.position);
      if (d < (a.radius + b.radius) * 0.85) { handleCollision(a, b); return; }
    }
  }
}

function spawnMergedBody(type, pos, vel, mass, radius, name, flavor) {
  const opts = { position: pos, velocity: vel, mass, size: radius, name };
  let obj;
  switch (type) {
    case 'star': obj = createStar({ ...opts, tempK: flavor?.tempK }); break;
    case 'moon': obj = createMoon(opts); break;
    case 'comet': obj = createComet(opts); break;
    case 'neutron': obj = createNeutronStar(opts); break;
    default: obj = createPlanet(opts); break;
  }
  if (type === 'star' && flavor) {
    obj.age = flavor.age; obj.stage = flavor.stage; obj.lifecycleScale = flavor.lifecycleScale;
    obj.isHighMass = mass > 11;
    if (obj.stage !== 'main_sequence') obj.core.scale.setScalar(obj.lifecycleScale);
  }
  return obj;
}

function handleCollision(a, b) {
  if (a._destroyed || b._destroyed) return;
  const relSpeed = a.velocity.clone().sub(b.velocity).length();
  const totalMass = a.mass + b.mass;
  const mergedPos = a.mesh.position.clone().multiplyScalar(a.mass).add(b.mesh.position.clone().multiplyScalar(b.mass)).divideScalar(totalMass);
  const mergedVel = a.velocity.clone().multiplyScalar(a.mass).add(b.velocity.clone().multiplyScalar(b.mass)).divideScalar(totalMass);
  const big = a.mass >= b.mass ? a : b;
  const small = a.mass >= b.mass ? b : a;

  if (relSpeed < COLLISION_MERGE_SPEED) {
    // gentle encounter: the larger body absorbs the smaller one, conserving momentum and mass
    const newRadius = Math.cbrt(Math.pow(a.radius, 3) + Math.pow(b.radius, 3));
    logEvent(`${small.name} has merged into ${big.name}.`, 'critical', mergedPos);
    showBanner(`${big.name}: MASS ABSORBED`);
    particleBurst(mergedPos, { count: 60, color: 0xffe6b0, spread: a.radius + b.radius, size: 1.6, duration: 1400, growth: 4 });
    const name = big.name, type = big.type, flavor = big.type === 'star' ? big : null;
    destroyObject(a, 'merged', true);
    destroyObject(b, 'merged', true);
    spawnMergedBody(type, mergedPos, mergedVel, totalMass, newRadius, name, flavor);
  } else {
    // violent impact: both bodies shatter into a debris field
    logEvent(`${a.name} and ${b.name} collided at high velocity and shattered.`, 'critical', mergedPos);
    showBanner('HIGH-VELOCITY COLLISION');
    cameraShake(0.8, 500);
    particleBurst(mergedPos, { count: 140, color: 0xffcf9e, spread: (a.radius + b.radius) * 2, size: 2.2, duration: 2000, growth: 8 });
    spawnEnergyRing(mergedPos, 0xffb066, 30, 1400);

    const debrisCount = THREE.MathUtils.clamp(Math.floor(totalMass / 3), 3, 10);
    for (let k = 0; k < debrisCount; k++) {
      if (!aPos.length) break;
      const idx = Math.floor(Math.random() * aPos.length);
      const dir = new THREE.Vector3(Math.random() - 0.5, (Math.random() - 0.5) * 0.3, Math.random() - 0.5).normalize();
      const p = mergedPos.clone().addScaledVector(dir, (a.radius + b.radius) * (0.5 + Math.random()));
      const v = mergedVel.clone().addScaledVector(dir, relSpeed * 0.4 + Math.random() * 8);
      spawnAsteroid(idx, p, v, Math.max((totalMass / debrisCount) * 0.3, 0.1), Math.max((a.radius + b.radius) / debrisCount, 0.3));
    }
    destroyObject(a, 'collided', true);
    destroyObject(b, 'collided', true);
  }
}

/* =========================================================================
   EVENT LOG
   ========================================================================= */
function fmtClock(t) {
  const h = String(Math.floor(t / 3600)).padStart(2, '0');
  const m = String(Math.floor((t % 3600) / 60)).padStart(2, '0');
  const s = String(Math.floor(t % 60)).padStart(2, '0');
  return `${h}:${m}:${s}`;
}
function logEvent(text, level = 'info', position = null) {
  const body = document.getElementById('log-body');
  const div = document.createElement('div');
  div.className = 'log-entry event-' + level + (position ? ' clickable' : '');
  const yearLabel = 'YEAR ' + Math.max(0, Math.floor(simYears)).toLocaleString();
  div.innerHTML = `<span class="log-time">${yearLabel}${position ? ' \u2197' : ''}</span>${text}`;
  if (position) {
    const p = position.clone();
    div.title = 'Click to jump to this location';
    div.addEventListener('click', () => flyCameraTo(p, 55, 1200));
  }
  body.prepend(div);
  while (body.children.length > 80) body.removeChild(body.lastChild);
}

/* =========================================================================
   PHYSICS STEP FOR MASSIVE BODIES (stars / planets / moons / comets / black holes)
   ========================================================================= */
/* Velocity Verlet integration, run once per sub-step across every massive
   body together:
     x(t+dt) = x(t) + v(t)*dt + 0.5*a(t)*dt^2
     a(t+dt) = f(x(t+dt)) / m            (recomputed at the new positions)
     v(t+dt) = v(t) + 0.5*(a(t)+a(t+dt))*dt
   This conserves energy far better than the plain "accel, then velocity,
   then position" Euler step it replaces, especially at the larger sub-step
   sizes used when the simulation is heavily time-accelerated. */
function integrateBodiesVerlet(dt) {
  const list = bodies.filter((b) => !b._destroyed);
  for (const b of list) {
    b.mesh.position.addScaledVector(b.velocity, dt);
    b.mesh.position.addScaledVector(b.acceleration, 0.5 * dt * dt);
  }
  const newAccel = list.map((b) => computeAcceleration(b.mesh.position, b, bodies));
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    b.velocity.addScaledVector(b.acceleration, 0.5 * dt);
    b.velocity.addScaledVector(newAccel[i], 0.5 * dt);
    b.acceleration = newAccel[i];
  }
}

// everything besides raw integration: aging, black-hole tidal effects,
// disintegration, slingshot/escape detection, trails, rotation. Runs after
// integrateBodiesVerlet has already moved this frame's positions.
function postStepBody(obj, dt) {
  if (obj._destroyed) return;
  obj.age += dt * AGE_YEARS_PER_SIMSECOND;

  if (obj.type === 'blackhole') { updateTrail(obj.trail, obj.mesh.position); return; }

  const pos = obj.mesh.position;
  const { bh, dist: r } = nearestBlackHole(pos);
  if (bh) {
    const radii = bhRadii(bh);
    if (r < radii.capture) { disintegrate(obj, bh); return; }

    if (r < radii.drag) {
      const k = (radii.drag - r) / radii.drag;
      obj.velocity.multiplyScalar(1 - k * 0.012 * dt * 60);
    }
    if (Math.random() < 0.004) { obj.velocity.x += (Math.random() - 0.5) * 0.05; obj.velocity.z += (Math.random() - 0.5) * 0.05; }

    if (r < radii.tidal) {
      obj.tidalPercent = THREE.MathUtils.clamp((100 * (radii.tidal - r)) / (radii.tidal - radii.capture), 0, 100);
      if (obj.status !== 'unstable') {
        obj.status = 'unstable';
        logEvent(`${obj.name} has entered an unstable orbit.`, 'info', pos);
        if (obj.type === 'planet') showBanner('PLANETARY BODY DESTABILIZED');
      }
      const k = 1 - r / radii.tidal;
      const stretch = 1 + k * 2.2;
      const base = obj.lifecycleScale || 1;
      const rel = pos.clone().sub(bh.mesh.position);
      const tangent = new THREE.Vector3(-rel.z, 0, rel.x).normalize();
      obj.mesh.up.copy(tangent);
      obj.core.scale.set(base / Math.sqrt(stretch), base * stretch, base / Math.sqrt(stretch));
      obj.core.lookAt(pos.clone().add(tangent));
      if (!obj.lastLog.tidal || simTime - obj.lastLog.tidal > 3) {
        logEvent(`Tidal forces increasing on ${obj.name}.`, r < radii.tidal * 0.4 ? 'critical' : 'info', pos);
        obj.lastLog.tidal = simTime;
      }
    } else {
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

  if (obj._prevR !== undefined && bh) {
    if (obj._closestR !== undefined && obj._closestR < 55 && !obj._slingLogged && r > obj._closestR * 1.4 && obj._prevR < r) {
      logEvent(`Gravitational slingshot detected: ${obj.name} is accelerating away from the singularity.`, 'info', pos);
      showBanner('GRAVITATIONAL SLINGSHOT DETECTED');
      obj._slingLogged = true;
    }
    if (obj._closestR === undefined || r < obj._closestR) obj._closestR = r;
  }
  obj._prevR = r;

  if (pos.length() > ESCAPE_R) {
    logEvent(`${obj.name} has escaped the system.`, 'info', pos);
    destroyObject(obj, 'escaped', true);
    return;
  }

  updateTrail(obj.trail, pos);
  obj.core.rotation.y += dt * obj.rotationSpeed;
}

/* =========================================================================
   INFO PANEL
   ========================================================================= */
function hillRadius(obj) {
  const dom = findDominantAttractor(obj.mesh.position, obj);
  if (!dom) return null;
  const r = obj.mesh.position.distanceTo(dom.mesh.position);
  const hr = r * Math.cbrt(obj.mass / (3 * Math.max(dom.mass, 0.01)));
  return { hr, dom };
}

function updateInfoPanel() {
  if (!selected) return;
  const $ = (id) => document.getElementById(id);

  if (selected.type === 'blackhole') {
    $('info-name').textContent = selected.name;
    $('info-type').textContent = 'SUPERMASSIVE SINGULARITY';
    $('info-parent').textContent = '—';
    $('info-mass').textContent = selected.mass.toFixed(0) + ' M☉';
    $('info-distance').textContent = (selected.mesh.position.length() / 10).toFixed(2) + ' AU';
    $('info-velocity').textContent = (selected.velocity.length() / 60).toFixed(2) + 'c';
    $('info-orbit').textContent = '—';
    $('info-temp').textContent = '—';
    $('info-age').textContent = Math.floor(selected.age).toLocaleString() + ' yrs';
    $('info-lifecycle').textContent = '—';
    $('info-tidal').textContent = 'EXTREME';
    $('info-influence').textContent = 'SYSTEM-WIDE';
    $('info-status').textContent = 'STABLE';
    positionSelectionVisuals(selected.mesh.position, selected.velocity, selected.visualRadius * 2.6, null);
    return;
  }

  if (selected.isAsteroid) {
    const i = selected.index;
    if (!aAlive[i]) { deselect(); return; }
    const r = aPos[i].length();
    const dom = findDominantAttractor(aPos[i], null);
    $('info-name').textContent = selected.name;
    $('info-type').textContent = 'ASTEROID';
    $('info-parent').textContent = dom ? dom.name : '—';
    $('info-mass').textContent = aMass[i].toFixed(2) + ' Mt';
    $('info-distance').textContent = (r / 10).toFixed(2) + ' AU';
    $('info-velocity').textContent = (aVel[i].length() / 60).toFixed(2) + 'c';
    const { bh } = nearestBlackHole(aPos[i]);
    const tidal = bh ? r < bhRadii(bh).tidal : false;
    $('info-orbit').textContent = tidal ? 'UNSTABLE' : 'STABLE';
    $('info-temp').textContent = '—';
    $('info-age').textContent = '—';
    $('info-lifecycle').textContent = '—';
    $('info-tidal').textContent = tidal ? 'ELEVATED' : 'NOMINAL';
    $('info-influence').textContent = '—';
    $('info-status').textContent = 'TRACKED';
    positionSelectionVisuals(aPos[i], aVel[i], aRadius[i] * 3.5, null);
    return;
  }

  const obj = selected;
  const r = obj.mesh.position.length();
  const speed = obj.velocity.length();
  const dom = findDominantAttractor(obj.mesh.position, obj);
  $('info-name').textContent = obj.name;
  $('info-type').textContent = obj.type.toUpperCase();
  $('info-parent').textContent = dom ? dom.name : '—';
  $('info-mass').textContent = obj.mass.toFixed(2) + (obj.type === 'star' || obj.type === 'neutron' ? ' M☉' : ' Mt');
  $('info-distance').textContent = (r / 10).toFixed(2) + ' AU';
  $('info-velocity').textContent = (speed / 60).toFixed(2) + 'c';
  const period = ((2 * Math.PI * r) / Math.max(speed, 0.001) / 10).toFixed(1);
  $('info-orbit').textContent = `${obj.status.toUpperCase()} (T≈${period}d)`;
  $('info-temp').textContent = obj.type === 'star' ? Math.round(obj.tempK).toLocaleString() + ' K' : obj.type === 'neutron' ? '~1,000,000,000 K' : '—';
  $('info-age').textContent = Math.floor(obj.age).toLocaleString() + ' yrs';
  if (obj.type === 'star') {
    const pct = Math.min(100, (obj.age / obj.lifespan) * 100).toFixed(0);
    const stageLabel = { main_sequence: 'MAIN SEQUENCE', giant: obj.isHighMass ? 'RED SUPERGIANT' : 'RED GIANT', remnant: 'REMNANT' }[obj.stage];
    $('info-lifecycle').textContent = `${stageLabel} (${pct}%)`;
  } else if (obj.type === 'neutron') {
    $('info-lifecycle').textContent = 'STELLAR REMNANT';
  } else {
    $('info-lifecycle').textContent = '—';
  }
  $('info-tidal').textContent = (obj.tidalPercent ?? 0).toFixed(1) + '%';
  const hs = hillRadius(obj);
  $('info-influence').textContent = hs ? (hs.hr / 10).toFixed(2) + ' AU' : '—';
  $('info-status').textContent = obj.status === 'unstable' ? 'DESTABILIZING' : 'NOMINAL';

  positionSelectionVisuals(obj.mesh.position, obj.velocity, obj.radius * 4, hs);
  fillPredictedPath(predictGeo, obj.mesh.position, obj.velocity);
}

function positionSelectionVisuals(pos, vel, ringScale, hs) {
  selectionRing.visible = true;
  selectionRing.position.copy(pos);
  selectionRing.scale.set(ringScale, ringScale, 1);
  const speed = vel.length();
  if (speed > 0.05) {
    velocityArrow.visible = true;
    velocityArrow.position.copy(pos);
    velocityArrow.setDirection(vel.clone().normalize());
    velocityArrow.setLength(Math.min(speed * 1.8 + 2, 90), 2.4, 1.3);
  } else velocityArrow.visible = false;
  if (hs && hs.hr > 0.5) {
    influenceSphere.visible = true;
    influenceSphere.position.copy(pos);
    influenceSphere.scale.setScalar(hs.hr);
  } else influenceSphere.visible = false;
}

/* =========================================================================
   PHYSICS DEBUG HUD
   ========================================================================= */
function updateDebugHud() {
  const $ = (id) => document.getElementById(id);
  $('dbg-fps').textContent = Math.round(fpsSmoothed);
  $('dbg-phys-ms').textContent = lastPhysicsMs.toFixed(2) + ' ms';
  $('dbg-objects').textContent = bodies.length;
  $('dbg-asteroids').textContent = aPos.length;
  $('dbg-gravcalcs').textContent = gravityCalcCount.toLocaleString();
  $('dbg-speed').textContent = CONFIG.paused ? 'PAUSED' : CONFIG.timeScale + 'x';
  $('dbg-substeps').textContent = lastSubsteps;

  let vel = null, acc = null, mass = null, pos = null;
  if (selected && selected.isAsteroid && aAlive[selected.index]) {
    vel = aVel[selected.index]; acc = null; mass = aMass[selected.index]; pos = aPos[selected.index];
  } else if (selected && selected.mesh) {
    vel = selected.velocity; acc = selected.acceleration; mass = selected.mass; pos = selected.mesh.position;
  }
  if (vel && pos) {
    $('dbg-sel-vel').textContent = `${vel.length().toFixed(3)} u/s`;
    $('dbg-sel-acc').textContent = acc ? `${acc.length().toFixed(4)} u/s\u00b2` : '\u2014';
    $('dbg-sel-ke').textContent = (0.5 * mass * vel.lengthSq()).toFixed(2);
    const dom = findDominantAttractor(pos, selected.isAsteroid ? null : selected);
    if (dom) {
      const r = Math.max(pos.distanceTo(dom.mesh.position), 1);
      $('dbg-sel-pe').textContent = (-(CONFIG.G * dom.mass * mass) / r).toFixed(2);
    } else $('dbg-sel-pe').textContent = '\u2014';
  } else {
    $('dbg-sel-vel').textContent = '\u2014';
    $('dbg-sel-acc').textContent = '\u2014';
    $('dbg-sel-ke').textContent = '\u2014';
    $('dbg-sel-pe').textContent = '\u2014';
  }
}

/* =========================================================================
   OBJECT BROWSER — a searchable-by-eye list of every body in the sim
   ========================================================================= */
let browserCollapsed = true;
const BROWSER_LABELS = { blackhole: 'BLACK HOLES', star: 'STARS', planet: 'PLANETS', moon: 'MOONS', comet: 'COMETS', neutron: 'NEUTRON STARS' };
function refreshObjectBrowser() {
  document.getElementById('browser-count').textContent = bodies.length ? `(${bodies.length})` : '';
  if (browserCollapsed) return;
  const groups = { blackhole: [], star: [], planet: [], moon: [], comet: [], neutron: [] };
  for (const b of bodies) if (groups[b.type]) groups[b.type].push(b);
  let html = '';
  for (const key of ['blackhole', 'star', 'planet', 'moon', 'comet', 'neutron']) {
    const list = groups[key];
    if (!list.length) continue;
    html += `<div class="browser-group">${BROWSER_LABELS[key]} (${list.length})</div>`;
    for (const b of list) html += `<div class="browser-item" data-id="${b.id}">${b.name}</div>`;
  }
  document.getElementById('browser-body').innerHTML = html || '<div class="browser-empty">No objects yet — try Generate New Universe.</div>';
}
document.getElementById('browser-head-toggle').addEventListener('click', () => {
  browserCollapsed = !browserCollapsed;
  document.getElementById('browser-panel').classList.toggle('collapsed', browserCollapsed);
  refreshObjectBrowser();
});
document.getElementById('browser-body').addEventListener('click', (e) => {
  const item = e.target.closest('.browser-item');
  if (!item) return;
  const obj = bodies.find((b) => b.id === +item.dataset.id);
  if (!obj) return;
  select(obj);
  flyCameraTo(obj.mesh.position, Math.max(obj.radius * 8, 40), 1200);
});
setInterval(refreshObjectBrowser, 1500);

/* =========================================================================
   UI WIRING
   ========================================================================= */
document.getElementById('time-buttons').addEventListener('click', (e) => {
  const btn = e.target.closest('.tbtn');
  if (!btn) return;
  document.querySelectorAll('#time-buttons .tbtn').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  const speed = +btn.dataset.speed;
  CONFIG.paused = speed === 0;
  if (!CONFIG.paused) CONFIG.timeScale = speed;
});
document.getElementById('btn-reset').addEventListener('click', () => location.reload());

function bindSlider(id, cb) { const el = document.getElementById(id); el.addEventListener('input', () => cb(+el.value)); }
bindSlider('slider-mass', (v) => {
  CONFIG.blackHoleMass = v;
  const primary = dominantBlackHole();
  if (primary) primary.mass = v;
  document.getElementById('val-mass').textContent = v;
});
bindSlider('slider-g', (v) => { CONFIG.G = v; document.getElementById('val-g').textContent = v.toFixed(2); });
bindSlider('slider-asteroids', (v) => { document.getElementById('val-asteroids').textContent = v; initAsteroids(v); });
bindSlider('slider-disk', (v) => {
  CONFIG.diskBrightness = v;
  for (const bh of blackHoles()) bh.diskMat.uniforms.uBrightness.value = v;
  document.getElementById('val-disk').textContent = v.toFixed(2);
});
bindSlider('slider-lens', (v) => { CONFIG.lensStrength = v; document.getElementById('val-lens').textContent = v.toFixed(2); });

document.getElementById('btn-follow').addEventListener('click', () => {
  if (!selected || selected.isAsteroid) return;
  if (cameraMode === 'follow' && followTarget === selected) { setCameraMode('free'); followTarget = null; return; }
  followTarget = selected; setCameraMode('follow');
});
document.getElementById('btn-orbit').addEventListener('click', () => {
  if (!selected || selected.isAsteroid) return;
  if (cameraMode === 'orbit' && followTarget === selected) { setCameraMode('free'); followTarget = null; return; }
  followTarget = selected; setCameraMode('orbit');
});
document.getElementById('btn-return').addEventListener('click', () => {
  followTarget = null;
  setCameraMode('free');
  const primary = dominantBlackHole();
  if (primary) flyCameraTo(primary.mesh.position, Math.max(primary.visualRadius * 14, 160), 1400);
  updateBreadcrumb(['UNIVERSE']);
});
document.getElementById('btn-help').addEventListener('click', () => document.getElementById('help-modal').classList.remove('hidden'));
document.getElementById('btn-help-close').addEventListener('click', () => document.getElementById('help-modal').classList.add('hidden'));

document.getElementById('btn-gravity-toggle').addEventListener('click', () => {
  CONFIG.gravityEnabled = !CONFIG.gravityEnabled;
  const btn = document.getElementById('btn-gravity-toggle');
  btn.textContent = CONFIG.gravityEnabled ? '\u25cf GRAVITY: ON' : '\u25cb GRAVITY: OFF';
  btn.classList.toggle('off', !CONFIG.gravityEnabled);
  logEvent(`Gravity simulation ${CONFIG.gravityEnabled ? 'enabled' : 'disabled'}.`, 'info');
});
document.getElementById('btn-debug').addEventListener('click', () => {
  CONFIG.debugMode = !CONFIG.debugMode;
  document.getElementById('debug-hud').classList.toggle('hidden', !CONFIG.debugMode);
});

/* =========================================================================
   POSTPROCESSING (bloom + gravitational lensing)
   ========================================================================= */
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.15, 0.55, 0.15);
composer.addPass(bloomPass);

const lensShader = {
  uniforms: { tDiffuse: { value: null }, uBH: { value: new THREE.Vector2(0.5, 0.5) }, uStrength: { value: 1.0 }, uAspect: { value: window.innerWidth / window.innerHeight } },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec2 uBH; uniform float uStrength; uniform float uAspect;
    varying vec2 vUv;
    void main(){
      vec2 diff = vUv - uBH; diff.x *= uAspect;
      float dist = length(diff);
      vec2 dirn = dist > 0.0001 ? normalize(diff) : vec2(0.0);
      float bend = uStrength * 0.09 * exp(-dist * 9.0);
      vec2 offset = dirn * bend; offset.x /= uAspect;
      gl_FragColor = texture2D(tDiffuse, clamp(vUv - offset, 0.0, 1.0));
    }
  `,
};
const lensPass = new ShaderPass(lensShader);
composer.addPass(lensPass);

/* =========================================================================
   INITIAL POPULATION
   ========================================================================= */
createBlackHole({ position: new THREE.Vector3(), velocity: new THREE.Vector3(), mass: CONFIG.blackHoleMass, name: 'SAGITTARIUS PRIME' });
for (let i = 0; i < 5; i++) createStar();
const initialPlanets = [];
for (let i = 0; i < 8; i++) initialPlanets.push(createPlanet());
for (let i = 0; i < 3; i++) createComet();
// demonstrate a nested orbit: attach a moon to one of the starting planets
{
  const parent = initialPlanets[Math.floor(Math.random() * initialPlanets.length)];
  const offset = new THREE.Vector3(parent.radius * 5, 0, 0);
  const moonPos = parent.mesh.position.clone().add(offset);
  const moonVel = orbitalVelocity(moonPos, parent.mesh.position, parent.mass, 1).add(parent.velocity);
  createMoon({ position: moonPos, velocity: moonVel, name: 'LUNA-01', parent });
}
logEvent('Observatory systems online. Gravitational field stabilized.', 'info');

/* =========================================================================
   UNIVERSE MANAGEMENT — clear / procedurally generate / save / load / export
   ========================================================================= */
function clearUniverse() {
  for (const b of [...bodies]) destroyObject(b, 'reset', true);
  for (let i = fragments.length - 1; i >= 0; i--) removeFragment(i);
  initAsteroids(0);
  deselect();
  followTarget = null;
  setCameraMode('free');
  cameraTween = null;
  controls.enabled = true;
  camera.position.set(0, 160, 300);
  controls.target.set(0, 0, 0);
  simTime = 0;
  simYears = 0;
  document.getElementById('log-body').innerHTML = '';
  updateBreadcrumb(['UNIVERSE']);
}

function generateUniverse() {
  clearUniverse();

  const numBH = Math.random() < 0.8 ? 1 : 2;
  const primaryMass = 2500 + Math.random() * 6000;
  const primary = createBlackHole({ mass: primaryMass, name: 'SAGITTARIUS PRIME' });
  if (numBH === 2) {
    const ang = Math.random() * Math.PI * 2;
    const dist = 260 + Math.random() * 180;
    const pos2 = new THREE.Vector3(Math.cos(ang) * dist, (Math.random() - 0.5) * 12, Math.sin(ang) * dist);
    const mass2 = primaryMass * (0.25 + Math.random() * 0.5);
    const vel2 = orbitalVelocity(pos2, primary.mesh.position, primary.mass, 0.75 + Math.random() * 0.4);
    createBlackHole({ mass: mass2, position: pos2, velocity: vel2, name: 'COMPANION-' + Math.floor(10 + Math.random() * 90) });
  }

  const numStars = 3 + Math.floor(Math.random() * 7);
  for (let i = 0; i < numStars; i++) createStar();

  const numPlanets = 5 + Math.floor(Math.random() * 10);
  const planetsCreated = [];
  for (let i = 0; i < numPlanets; i++) planetsCreated.push(createPlanet());

  let numMoons = 0;
  if (planetsCreated.length) {
    numMoons = Math.floor(Math.random() * 4);
    for (let i = 0; i < numMoons; i++) {
      const parent = planetsCreated[Math.floor(Math.random() * planetsCreated.length)];
      const offset = new THREE.Vector3(parent.radius * (3 + Math.random() * 3), 0, 0)
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI * 2);
      const moonPos = parent.mesh.position.clone().add(offset);
      const moonVel = orbitalVelocity(moonPos, parent.mesh.position, parent.mass, 0.9 + Math.random() * 0.3).add(parent.velocity);
      createMoon({ position: moonPos, velocity: moonVel, parent });
    }
  }

  const numComets = 1 + Math.floor(Math.random() * 5);
  for (let i = 0; i < numComets; i++) createComet();

  const asteroidCount = 200 + Math.floor(Math.random() * 700);
  CONFIG.asteroidCount = asteroidCount;
  document.getElementById('slider-asteroids').value = asteroidCount;
  document.getElementById('val-asteroids').textContent = asteroidCount;
  initAsteroids(asteroidCount);

  logEvent(`New universe generated: ${numBH} black hole${numBH > 1 ? 's' : ''}, ${numStars} stars, ${numPlanets} planets, ${numMoons} moons, ${numComets} comets, ${asteroidCount} asteroids.`, 'info');
  showBanner('NEW UNIVERSE GENERATED');
  refreshObjectBrowser();
}

function serializeUniverse() {
  return {
    version: 1,
    config: { G: CONFIG.G, blackHoleMass: CONFIG.blackHoleMass, diskBrightness: CONFIG.diskBrightness, lensStrength: CONFIG.lensStrength, asteroidCount: CONFIG.asteroidCount },
    simTime, simYears,
    bodies: bodies.map((b) => ({
      type: b.type, name: b.name, mass: b.mass, radius: b.radius,
      position: { x: b.mesh.position.x, y: b.mesh.position.y, z: b.mesh.position.z },
      velocity: { x: b.velocity.x, y: b.velocity.y, z: b.velocity.z },
      tempK: b.tempK, age: b.age, lifespan: b.lifespan, isHighMass: b.isHighMass,
      stage: b.stage, lifecycleScale: b.lifecycleScale,
      color: b.core?.material?.color ? b.core.material.color.getHex() : undefined,
      glowColor: b.glow?.material?.color ? b.glow.material.color.getHex() : undefined,
    })),
    asteroids: { pos: aPos.map((p) => [p.x, p.y, p.z]), vel: aVel.map((v) => [v.x, v.y, v.z]), mass: aMass.slice(), radius: aRadius.slice() },
  };
}

function restoreBody(bd) {
  const position = new THREE.Vector3(bd.position.x, bd.position.y, bd.position.z);
  const velocity = new THREE.Vector3(bd.velocity.x, bd.velocity.y, bd.velocity.z);
  const opts = { position, velocity, mass: bd.mass, size: bd.radius, name: bd.name, tempK: bd.tempK };
  let obj = null;
  if (bd.type === 'blackhole') obj = createBlackHole(opts);
  else if (bd.type === 'star') obj = createStar(opts);
  else if (bd.type === 'planet') obj = createPlanet(opts);
  else if (bd.type === 'moon') obj = createMoon(opts);
  else if (bd.type === 'comet') obj = createComet(opts);
  else if (bd.type === 'neutron') obj = createNeutronStar(opts);
  if (!obj) return;
  obj.age = bd.age ?? 0;
  if (bd.type === 'star') {
    obj.stage = bd.stage || 'main_sequence';
    obj.lifecycleScale = bd.lifecycleScale ?? 1;
    obj.lifespan = bd.lifespan ?? obj.lifespan;
    obj.isHighMass = bd.isHighMass ?? obj.isHighMass;
    if (obj.stage !== 'main_sequence') obj.core.scale.setScalar(obj.lifecycleScale);
  }
  if (bd.color !== undefined && obj.core?.material?.color) obj.core.material.color.setHex(bd.color);
  if (bd.glowColor !== undefined && obj.glow?.material?.color) obj.glow.material.color.setHex(bd.glowColor);
}

function deserializeUniverse(data) {
  clearUniverse();
  if (data.config) {
    Object.assign(CONFIG, data.config);
    document.getElementById('slider-mass').value = CONFIG.blackHoleMass;
    document.getElementById('val-mass').textContent = CONFIG.blackHoleMass;
    document.getElementById('slider-g').value = CONFIG.G;
    document.getElementById('val-g').textContent = CONFIG.G.toFixed(2);
    document.getElementById('slider-disk').value = CONFIG.diskBrightness;
    document.getElementById('val-disk').textContent = CONFIG.diskBrightness.toFixed(2);
    document.getElementById('slider-lens').value = CONFIG.lensStrength;
    document.getElementById('val-lens').textContent = CONFIG.lensStrength.toFixed(2);
  }
  simTime = data.simTime || 0;
  simYears = data.simYears || 0;

  const sorted = [...(data.bodies || [])].sort((a, b) => (a.type === 'blackhole' ? -1 : 0) - (b.type === 'blackhole' ? -1 : 0));
  for (const bd of sorted) restoreBody(bd);

  if (data.asteroids?.pos?.length) {
    const count = data.asteroids.pos.length;
    initAsteroids(count);
    for (let i = 0; i < count; i++) {
      aPos[i].set(...data.asteroids.pos[i]);
      aVel[i].set(...data.asteroids.vel[i]);
      aMass[i] = data.asteroids.mass[i];
      aRadius[i] = data.asteroids.radius[i];
    }
    CONFIG.asteroidCount = count;
    document.getElementById('slider-asteroids').value = count;
    document.getElementById('val-asteroids').textContent = count;
  } else {
    initAsteroids(CONFIG.asteroidCount || 400);
  }

  logEvent('Universe loaded from saved data.', 'info');
  showBanner('UNIVERSE LOADED');
  refreshObjectBrowser();
}

const SAVE_KEY = 'eventHorizonSave_v1';
function saveStatus(text) {
  const el = document.getElementById('save-status');
  el.textContent = text;
  clearTimeout(saveStatus._t);
  saveStatus._t = setTimeout(() => { el.textContent = ''; }, 3500);
}
document.getElementById('btn-generate').addEventListener('click', generateUniverse);
document.getElementById('btn-save').addEventListener('click', () => {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(serializeUniverse()));
    saveStatus('Universe saved.');
    logEvent('Universe state saved.', 'info');
  } catch (e) {
    saveStatus('Save failed (storage unavailable).');
  }
});
document.getElementById('btn-load').addEventListener('click', () => {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) { saveStatus('No saved universe found.'); return; }
    deserializeUniverse(JSON.parse(raw));
    saveStatus('Universe loaded.');
  } catch (e) {
    saveStatus('Load failed (corrupt save data).');
  }
});
document.getElementById('btn-export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(serializeUniverse(), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'event-horizon-universe.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  saveStatus('Universe data exported.');
});

/* =========================================================================
   MAIN LOOP
   ========================================================================= */
const clock = new THREE.Clock();
let perfAccum = 0, perfSamples = 0, perfScaled = false;
let lastPhysicsMs = 0, lastSubsteps = 1, fpsSmoothed = 60;
function animate() {
  requestAnimationFrame(animate);
  const rawDt = Math.min(clock.getDelta(), 0.05);
  fpsSmoothed = fpsSmoothed * 0.92 + (rawDt > 0 ? 1 / rawDt : fpsSmoothed) * 0.08;

  // automatic performance scaling: if the framerate stays low for a
  // sustained stretch, quietly thin out the most expensive layer (the
  // asteroid field) once, rather than letting the whole sim bog down
  perfAccum += rawDt; perfSamples++;
  if (perfSamples >= 90) {
    const avgDt = perfAccum / perfSamples;
    if (!perfScaled && avgDt > 0.033 && aPos.length > 150) {
      perfScaled = true;
      const newCount = Math.max(150, Math.floor(aPos.length * 0.6));
      initAsteroids(newCount);
      CONFIG.asteroidCount = newCount;
      document.getElementById('slider-asteroids').value = newCount;
      document.getElementById('val-asteroids').textContent = newCount;
      logEvent('Performance mode engaged — asteroid density reduced automatically for a smoother framerate.', 'info');
    }
    perfAccum = 0; perfSamples = 0;
  }

  if (cameraTween) {
    const t = Math.min((performance.now() - cameraTween.start) / cameraTween.duration, 1);
    const e = easeInOutCubic(t);
    camera.position.lerpVectors(cameraTween.startPos, cameraTween.endPos, e);
    controls.target.lerpVectors(cameraTween.startTarget, cameraTween.endTarget, e);
    camera.lookAt(controls.target);
    if (t >= 1) { cameraTween = null; controls.enabled = true; }
  } else {
    controls.update();
  }

  gravityCalcCount = 0;
  const physicsStart = performance.now();
  if (!CONFIG.paused) {
    const dt = rawDt * CONFIG.timeScale;
    simTime += dt;
    simYears += dt * AGE_YEARS_PER_SIMSECOND;

    // split large steps (high time-scale) into bounded sub-steps so nothing
    // tunnels through a capture radius or blows up numerically
    const nBody = Math.min(Math.max(Math.ceil(dt / MAX_SUBSTEP_BODY), 1), MAX_SUBSTEPS_BODY);
    lastSubsteps = nBody;
    const subDtBody = dt / nBody;
    for (let s = 0; s < nBody; s++) {
      integrateBodiesVerlet(subDtBody);
      for (const obj of [...bodies]) postStepBody(obj, subDtBody);
      updateBlackHoleInteractions(subDtBody);
      checkBodyCollisions();
    }

    const nAst = Math.min(nBody, MAX_SUBSTEPS_ASTEROID);
    const subDtAst = dt / nAst;
    for (let s = 0; s < nAst; s++) { updateAsteroids(subDtAst); updateFragments(subDtAst); }

    for (const b of [...bodies]) if (b.type === 'star') updateStarLifecycle(b);
    for (const b of bodies) if (b.type === 'neutron') { const pulse = 1 + 0.3 * Math.sin(simTime * 8 + b.id); b.core.scale.setScalar(pulse); }

    for (const bh of blackHoles()) {
      bh.diskMat.uniforms.uTime.value += dt;
      bh._burst = Math.max(0, (bh._burst || 0) - dt * 0.7);
      bh.diskMat.uniforms.uBrightness.value = CONFIG.diskBrightness + bh._burst;
    }
    diskLight.intensity = 5 + Math.sin(simTime * 0.6) * 1.2 + (dominantBlackHole()?._burst || 0) * 4;
  }
  lastPhysicsMs = performance.now() - physicsStart;

  const dominantForLight = dominantBlackHole();
  if (dominantForLight) diskLight.position.copy(dominantForLight.mesh.position);

  if (shakeState) {
    const st = Math.min((performance.now() - shakeState.start) / shakeState.duration, 1);
    if (st >= 1) shakeState = null;
    else {
      const decay = (1 - st) * shakeState.intensity;
      camera.position.x += (Math.random() - 0.5) * decay;
      camera.position.y += (Math.random() - 0.5) * decay;
      camera.position.z += (Math.random() - 0.5) * decay;
    }
  }

  document.getElementById('clock-value').textContent = fmtClock(simTime);
  document.getElementById('sim-years-value').textContent = Math.floor(simYears).toLocaleString() + ' YEARS';

  if (followTarget) {
    const stillExists = bodies.includes(followTarget) || (followTarget.isAsteroid && aAlive[followTarget.index]);
    if (!stillExists) followTarget = null;
    else controls.target.lerp(followTarget.isAsteroid ? aPos[followTarget.index] : followTarget.mesh.position, 0.08);
  }

  for (const bh of blackHoles()) bh.photonSprite.material.rotation += rawDt * 0.05;

  if (selected) updateInfoPanel();
  else { selectionRing.visible = velocityArrow.visible = influenceSphere.visible = false; }

  const dominant = dominantBlackHole();
  if (dominant) {
    const ndc = dominant.mesh.position.clone().project(camera);
    lensPass.uniforms.uBH.value.set((ndc.x + 1) / 2, (ndc.y + 1) / 2);
    lensPass.uniforms.uStrength.value = CONFIG.lensStrength * (ndc.z < 1 ? 1 : 0);
  }
  lensPass.uniforms.uAspect.value = window.innerWidth / window.innerHeight;

  if (CONFIG.debugMode) updateDebugHud();

  composer.render();
}
animate();