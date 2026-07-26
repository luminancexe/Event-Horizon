import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/* =========================================================================
   CONFIG
   ========================================================================= */
const CONFIG = {
  G: 0.6,
  blackHoleMass: 5000,
  timeScale: 1,
  paused: false,
  asteroidCount: 400,
  diskBrightness: 1.0,
  lensStrength: 1.0,
};

const HORIZON_RADIUS = 9;          // fixed visual radius of the event horizon
const CAPTURE_R      = HORIZON_RADIUS * 1.15;
const TIDAL_R         = HORIZON_RADIUS * 4.2;
const DRAG_R          = HORIZON_RADIUS * 7.5;
const ESCAPE_R        = 480;

let simTime = 0;

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

// lighting: warm point light at the disk to rim-light planets, faint blue fill
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

/* =========================================================================
   BACKGROUND: starfield + nebulae + distant galaxies
   ========================================================================= */
function buildStarfield() {
  const N = 7000;
  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  const palette = [
    [0.6, 0.75, 1.0], [1, 1, 1], [1, 0.92, 0.7], [1, 0.75, 0.55], [1, 0.55, 0.45],
  ];
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
   BLACK HOLE
   ========================================================================= */
const blackHoleGroup = new THREE.Group();
scene.add(blackHoleGroup);

const horizonMesh = new THREE.Mesh(
  new THREE.SphereGeometry(HORIZON_RADIUS, 48, 48),
  new THREE.MeshBasicMaterial({ color: 0x000000 })
);
blackHoleGroup.add(horizonMesh);

// soft dark gravitational shadow
const shadowTex = makeGlowTexture('rgba(4,2,10,0.95)', 'rgba(4,2,10,0)');
const shadowSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
shadowSprite.scale.set(HORIZON_RADIUS * 4.2, HORIZON_RADIUS * 4.2, 1);
blackHoleGroup.add(shadowSprite);

// billboard photon-ring halo (bright thin ring, always facing camera)
const photonTex = makeRingTexture('rgba(255,244,214,0.95)');
const photonSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: photonTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
photonSprite.scale.set(HORIZON_RADIUS * 2.5, HORIZON_RADIUS * 2.5, 1);
blackHoleGroup.add(photonSprite);

// accretion disk shader
const diskGeo = new THREE.RingGeometry(HORIZON_RADIUS * 1.2, HORIZON_RADIUS * 6.5, 256, 16);
const diskMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
  blending: THREE.AdditiveBlending,
  uniforms: {
    uTime: { value: 0 },
    uBrightness: { value: CONFIG.diskBrightness },
    uInner: { value: HORIZON_RADIUS * 1.2 },
    uOuter: { value: HORIZON_RADIUS * 6.5 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main(){
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
    }
  `,
  fragmentShader: `
    varying vec2 vUv;
    uniform float uTime;
    uniform float uBrightness;
    uniform float uInner;
    uniform float uOuter;

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
      float radius = mix(uInner, uOuter, radialFrac);
      float angle = vUv.x * 6.28318530718;

      // differential rotation: inner edge spins much faster
      float angVel = 5.2 / (radialFrac*2.2 + 0.35);
      float rotAngle = angle + uTime * angVel * 0.12;

      float turb = fbm(vec2(rotAngle * 2.4, radialFrac * 5.0 - uTime * 0.08));
      float turb2 = fbm(vec2(rotAngle * 5.5 + 4.0, radialFrac * 9.0 + uTime * 0.05));
      float brightness = turb * 0.65 + turb2 * 0.45;

      // color ramp: white-hot inner -> yellow/orange mid -> deep red outer
      vec3 hot = vec3(1.0, 0.98, 0.92);
      vec3 mid = vec3(1.0, 0.55, 0.15);
      vec3 outer = vec3(0.75, 0.12, 0.05);
      vec3 col = mix(hot, mid, smoothstep(0.0, 0.45, radialFrac));
      col = mix(col, outer, smoothstep(0.45, 1.0, radialFrac));

      // hot turbulent flares
      float flare = pow(max(turb2,0.0), 4.0) * 1.8;
      col += vec3(0.7,0.85,1.0) * flare * (1.0 - radialFrac);

      float edgeFade = smoothstep(0.0, 0.08, radialFrac) * (1.0 - smoothstep(0.82, 1.0, radialFrac));
      float alpha = edgeFade * (0.35 + brightness * 0.9) * uBrightness;

      gl_FragColor = vec4(col * (0.6 + brightness*0.9) * uBrightness, alpha);
    }
  `,
});
const diskMesh = new THREE.Mesh(diskGeo, diskMat);
diskMesh.rotation.x = -Math.PI / 2;
blackHoleGroup.add(diskMesh);

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
  return { line, points: [], geo };
}
function updateTrail(trail, pos) {
  trail.points.push(pos.clone());
  if (trail.points.length > TRAIL_LEN) trail.points.shift();
  const arr = trail.geo.attributes.position.array;
  for (let i = 0; i < trail.points.length; i++) {
    arr[i * 3] = trail.points[i].x;
    arr[i * 3 + 1] = trail.points[i].y;
    arr[i * 3 + 2] = trail.points[i].z;
  }
  trail.geo.attributes.position.needsUpdate = true;
  trail.geo.setDrawRange(0, trail.points.length);
  trail.geo.computeBoundingSphere();
}

// predicted trajectory (single reusable line)
const predictGeo = new THREE.BufferGeometry();
const predictPositions = new Float32Array(80 * 3);
predictGeo.setAttribute('position', new THREE.BufferAttribute(predictPositions, 3));
const predictLine = new THREE.Line(predictGeo, new THREE.LineDashedMaterial({ color: 0x7fd9ff, dashSize: 3, gapSize: 2, transparent: true, opacity: 0.65 }));
predictLine.visible = false;
scene.add(predictLine);

/* =========================================================================
   OBJECT REGISTRIES
   ========================================================================= */
let bodies = []; // stars, planets, comets (individually simulated)
let selected = null;
let followTarget = null;
let idCounter = 1;

const NAME_POOL = {
  planet: ['NOVA', 'KEPLER', 'TERRA', 'VULCAN', 'ORION', 'PYRA', 'AXION'],
  star: ['SOL', 'SIRIUS', 'VEGA', 'ALTAIR', 'RIGEL', 'CASTOR', 'DENEB'],
  comet: ['HALE', 'ENCKE', 'BIELA', 'SWIFT', 'BORREL'],
};
function randomName(type) {
  const pool = NAME_POOL[type] || ['OBJ'];
  const w = pool[(Math.random() * pool.length) | 0];
  const n = String(Math.floor(Math.random() * 90) + 10);
  return `${w}-${n}`;
}

function circularVelocity(pos, speedMul = 1) {
  const r = Math.max(pos.length(), 1);
  const v = Math.sqrt((CONFIG.G * CONFIG.blackHoleMass) / r) * speedMul;
  // tangential direction in XZ plane
  const dir = new THREE.Vector3(-pos.z, 0, pos.x).normalize();
  return dir.multiplyScalar(v);
}

function starColorForTemp(t) {
  // t: 0 (cool/red) .. 1 (hot/blue)
  const stops = [
    [0.0, new THREE.Color(0xff5533)],
    [0.3, new THREE.Color(0xffa447)],
    [0.55, new THREE.Color(0xfff3c2)],
    [0.8, new THREE.Color(0xdcefff)],
    [1.0, new THREE.Color(0x9fd4ff)],
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    if (t >= stops[i][0] && t <= stops[i + 1][0]) {
      const localT = (t - stops[i][0]) / (stops[i + 1][0] - stops[i][0]);
      return stops[i][1].clone().lerp(stops[i + 1][1], localT);
    }
  }
  return stops[stops.length - 1][1].clone();
}

/* ---------- STAR ---------- */
function createStar(opts = {}) {
  const temp = opts.temp ?? Math.random();
  const color = starColorForTemp(temp);
  const size = opts.size ?? (0.8 + temp * 1.6);
  const group = new THREE.Group();
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(size, 24, 24),
    new THREE.MeshBasicMaterial({ color })
  );
  group.add(core);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: starGlowTex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.85,
  }));
  glow.scale.set(size * 7, size * 7, 1);
  group.add(glow);

  const pos = opts.position || randomOrbitPosition(60, 260);
  group.position.copy(pos);
  scene.add(group);

  const obj = {
    id: idCounter++, type: 'star', name: opts.name || randomName('star'),
    mesh: group, core, glow,
    mass: opts.mass ?? (2 + Math.random() * 20),
    radius: size,
    velocity: opts.velocity || circularVelocity(pos, 0.85 + Math.random() * 0.3),
    temp,
    status: 'stable',
    trail: createTrail(color.getHex(), 0.4),
    lastLog: {},
    baseScale: 1,
  };
  bodies.push(obj);
  registerSelectable(core, obj);
  return obj;
}

/* ---------- PLANET ---------- */
function createPlanet(opts = {}) {
  const size = opts.size ?? (1.2 + Math.random() * 2.2);
  const hue = Math.random();
  const color = new THREE.Color().setHSL(hue, 0.55, 0.5 + Math.random() * 0.15);
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(size, 32, 32),
    new THREE.MeshPhongMaterial({ color, emissive: color.clone().multiplyScalar(0.08), shininess: 8 })
  );
  group.add(mesh);

  if (Math.random() < 0.4) {
    const ringGeo = new THREE.RingGeometry(size * 1.5, size * 2.4, 48);
    const ringMat = new THREE.MeshBasicMaterial({ color: color.clone().offsetHSL(0, -0.2, 0.2), side: THREE.DoubleSide, transparent: true, opacity: 0.6 });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2.3;
    group.add(ring);
  }
  let moon = null;
  if (Math.random() < 0.5) {
    moon = new THREE.Mesh(new THREE.SphereGeometry(size * 0.28, 12, 12), new THREE.MeshBasicMaterial({ color: 0xaaaaaa }));
    moon.userData.orbitR = size * 3.2;
    moon.userData.angle = Math.random() * Math.PI * 2;
    group.add(moon);
  }

  const pos = opts.position || randomOrbitPosition(40, 220);
  group.position.copy(pos);
  scene.add(group);

  const obj = {
    id: idCounter++, type: 'planet', name: opts.name || randomName('planet'),
    mesh: group, core: mesh, moon,
    mass: opts.mass ?? (0.5 + Math.random() * 8),
    radius: size,
    velocity: opts.velocity || circularVelocity(pos, 0.9 + Math.random() * 0.25),
    status: 'stable',
    trail: createTrail(color.getHex(), 0.3),
    lastLog: {},
    baseScale: 1,
  };
  bodies.push(obj);
  registerSelectable(mesh, obj);
  return obj;
}

/* ---------- COMET ---------- */
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

  const obj = {
    id: idCounter++, type: 'comet', name: opts.name || randomName('comet'),
    mesh: group, core, glow,
    mass: opts.mass ?? (0.05 + Math.random() * 0.4),
    radius: size,
    velocity: opts.velocity || circularVelocity(pos, 1.1 + Math.random() * 0.5),
    status: 'stable',
    trail: createTrail(0x8fe0ff, 0.6, true),
    lastLog: {},
    baseScale: 1,
  };
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
   ASTEROID FIELD (instanced, pooled)
   ========================================================================= */
let asteroidMesh = null;
let aPos = [], aVel = [], aMass = [], aRadius = [], aAlive = [];
const dummy = new THREE.Object3D();

function initAsteroids(count) {
  if (asteroidMesh) {
    scene.remove(asteroidMesh);
    asteroidMesh.geometry.dispose();
    asteroidMesh.material.dispose();
  }
  aPos = []; aVel = []; aMass = []; aRadius = []; aAlive = [];
  const geo = new THREE.IcosahedronGeometry(1, 0);
  const mat = new THREE.MeshStandardMaterial({ color: 0x8b8378, roughness: 0.95, metalness: 0.05 });
  asteroidMesh = new THREE.InstancedMesh(geo, mat, Math.max(count, 1));
  asteroidMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(asteroidMesh);
  for (let i = 0; i < count; i++) spawnAsteroid(i, true);
}
function spawnAsteroid(i, initial = false) {
  const pos = randomOrbitPosition(HORIZON_RADIUS * 4, 200);
  aPos[i] = pos;
  aVel[i] = circularVelocity(pos, 0.75 + Math.random() * 0.5);
  aMass[i] = 0.05 + Math.random() * 1.5;
  aRadius[i] = 0.3 + Math.random() * 1.1;
  aAlive[i] = 1;
  dummy.position.copy(pos);
  dummy.scale.set(aRadius[i] * (0.7 + Math.random() * 0.6), aRadius[i] * (0.7 + Math.random() * 0.6), aRadius[i] * (0.7 + Math.random() * 0.6));
  dummy.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
  dummy.updateMatrix();
  asteroidMesh.setMatrixAt(i, dummy.matrix);
}
initAsteroids(CONFIG.asteroidCount);

let collisionLogCooldown = 0;
function updateAsteroids(dt) {
  const n = aPos.length;
  // simple spatial grid for coarse collision checks
  const grid = new Map();
  const cellSize = 8;
  for (let i = 0; i < n; i++) {
    if (!aAlive[i]) continue;
    const pos = aPos[i];
    const r = pos.length();

    if (r < CAPTURE_R) { spawnAsteroid(i); continue; }

    const accel = -(CONFIG.G * CONFIG.blackHoleMass) / (r * r);
    const dir = pos.clone().normalize();
    aVel[i].addScaledVector(dir, accel * dt);
    if (r < DRAG_R) {
      const k = (DRAG_R - r) / DRAG_R;
      aVel[i].multiplyScalar(1 - k * 0.015 * dt * 60);
    }
    aPos[i].addScaledVector(aVel[i], dt);

    if (r > ESCAPE_R) spawnAsteroid(i);

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
            logEvent('ASTEROID COLLISION DETECTED', 'info');
            collisionLogCooldown = 4;
          }
        }
      }
    }
  }

  for (let i = 0; i < n; i++) {
    if (!aAlive[i]) continue;
    dummy.position.copy(aPos[i]);
    const s = aRadius[i];
    dummy.scale.set(s, s, s);
    dummy.rotation.y += 0.002;
    dummy.updateMatrix();
    asteroidMesh.setMatrixAt(i, dummy.matrix);
  }
  asteroidMesh.instanceMatrix.needsUpdate = true;
}

/* =========================================================================
   SELECTION / RAYCASTING
   ========================================================================= */
const selectableMap = new Map(); // mesh.uuid -> obj
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
  pointerDownPos = p; pointerDownTime = performance.now();
  if (e.pointerType === 'touch') {
    clearTimeout(longPressTimer);
    longPressTimer = setTimeout(() => openContextMenu(p.x, p.y), 550);
  }
});
renderer.domElement.addEventListener('pointermove', (e) => {
  if (!pointerDownPos) return;
  const t = (e.touches && e.touches[0]) || e;
  const dx = t.clientX - pointerDownPos.x, dy = t.clientY - pointerDownPos.y;
  if (Math.hypot(dx, dy) > 8) clearTimeout(longPressTimer);
});
renderer.domElement.addEventListener('pointerup', (e) => {
  clearTimeout(longPressTimer);
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
  meshes.push(horizonMesh);
  const hits = raycaster.intersectObjects(meshes, false);
  // also test asteroids
  let asteroidHit = null;
  if (asteroidMesh) {
    const ahits = raycaster.intersectObject(asteroidMesh);
    if (ahits.length && (!hits.length || ahits[0].distance < hits[0].distance)) asteroidHit = ahits[0];
  }
  if (asteroidHit && (!hits.length)) {
    selectAsteroid(asteroidHit.instanceId);
    return;
  }
  if (hits.length === 0) { deselect(); return; }
  const mesh = hits[0].object;
  if (mesh === horizonMesh) { selectBlackHole(); return; }
  const obj = selectableMap.get(mesh.uuid);
  if (obj) select(obj);
}

function select(obj) {
  selected = obj;
  document.getElementById('info-panel').classList.remove('hidden');
  document.getElementById('btn-follow').disabled = false;
  document.getElementById('btn-delete-obj').classList.remove('hidden');
  predictLine.visible = true;
}
function selectAsteroid(instanceId) {
  selected = { type: 'asteroid', name: `AST-${instanceId}`, isAsteroid: true, index: instanceId };
  document.getElementById('info-panel').classList.remove('hidden');
  document.getElementById('btn-follow').disabled = true;
  document.getElementById('btn-delete-obj').classList.add('hidden');
  predictLine.visible = false;
}
function selectBlackHole() {
  selected = { type: 'blackhole', name: 'SAGITTARIUS PRIME', isBH: true };
  document.getElementById('info-panel').classList.remove('hidden');
  document.getElementById('btn-follow').disabled = true;
  document.getElementById('btn-delete-obj').classList.add('hidden');
  predictLine.visible = false;
}
function deselect() {
  selected = null;
  document.getElementById('info-panel').classList.add('hidden');
  document.getElementById('btn-follow').disabled = true;
  predictLine.visible = false;
}
document.getElementById('btn-delete-obj').addEventListener('click', () => {
  if (selected && !selected.isAsteroid && !selected.isBH) destroyObject(selected, 'removed', true);
  deselect();
});

/* =========================================================================
   CONTEXT MENU / OBJECT CREATION
   ========================================================================= */
const ctxMenu = document.getElementById('context-menu');
const createDialog = document.getElementById('create-dialog');
let pendingSpawn = null;
const spawnPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

function worldPointFromScreen(x, y) {
  pointerNDC.x = (x / window.innerWidth) * 2 - 1;
  pointerNDC.y = -(y / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointerNDC, camera);
  const out = new THREE.Vector3();
  raycaster.ray.intersectPlane(spawnPlane, out);
  return out || new THREE.Vector3();
}

function openContextMenu(x, y) {
  ctxMenu.style.left = x + 'px';
  ctxMenu.style.top = y + 'px';
  ctxMenu.classList.remove('hidden');
  ctxMenu.dataset.x = x; ctxMenu.dataset.y = y;
}
function closeContextMenu() { ctxMenu.classList.add('hidden'); }

renderer.domElement.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  openContextMenu(e.clientX, e.clientY);
});
document.addEventListener('pointerdown', (e) => {
  if (!ctxMenu.contains(e.target) && !ctxMenu.classList.contains('hidden')) closeContextMenu();
});
ctxMenu.querySelectorAll('.ctx-item').forEach((item) => {
  item.addEventListener('click', () => {
    const type = item.dataset.type;
    const pt = worldPointFromScreen(+ctxMenu.dataset.x, +ctxMenu.dataset.y);
    closeContextMenu();
    pendingSpawn = { type, point: pt };
    document.getElementById('create-title').textContent = 'CREATE ' + type.toUpperCase();
    createDialog.classList.remove('hidden');
  });
});
document.getElementById('btn-c-cancel').addEventListener('click', () => createDialog.classList.add('hidden'));
document.getElementById('btn-c-confirm').addEventListener('click', () => {
  if (!pendingSpawn) return;
  const mass = +document.getElementById('slider-c-mass').value;
  const size = +document.getElementById('slider-c-size').value;
  const speedMul = +document.getElementById('slider-c-speed').value;
  const pos = pendingSpawn.point;
  const vel = circularVelocity(pos, speedMul);
  switch (pendingSpawn.type) {
    case 'planet': createPlanet({ position: pos, mass, size, velocity: vel }); break;
    case 'star': createStar({ position: pos, mass, size, velocity: vel }); break;
    case 'comet': createComet({ position: pos, mass, size, velocity: vel }); break;
    case 'asteroid': {
      // recycle a random slot in the pool to spawn the user-placed asteroid
      const i = aPos.length ? Math.floor(Math.random() * aPos.length) : 0;
      spawnAsteroid(i);
      aPos[i].copy(pos); aVel[i].copy(vel); aMass[i] = Math.max(mass * 0.2, 0.05); aRadius[i] = Math.max(size * 0.5, 0.2);
      break;
    }
    case 'blackhole':
      createStar({ position: pos, mass: mass * 20, size: size * 2.5, velocity: vel, name: 'SINGULARITY-' + idCounter });
      logEvent('A companion mass has entered the system.', 'info');
      break;
  }
  logEvent(`New ${pendingSpawn.type} deployed into the field.`, 'info');
  createDialog.classList.add('hidden');
  pendingSpawn = null;
});
['slider-c-mass', 'slider-c-size', 'slider-c-speed'].forEach((id) => {
  const el = document.getElementById(id);
  const valEl = document.getElementById('val-' + id.replace('slider-', ''));
  el.addEventListener('input', () => { valEl.textContent = (+el.value).toFixed(id === 'slider-c-mass' ? 1 : 2); });
});

/* =========================================================================
   DESTRUCTION / TIDAL EFFECTS
   ========================================================================= */
function burstAtDisk(position) {
  const n = 40;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = position.x + (Math.random() - 0.5) * 4;
    pos[i * 3 + 1] = position.y + (Math.random() - 0.5) * 4;
    pos[i * 3 + 2] = position.z + (Math.random() - 0.5) * 4;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ color: 0xffdca0, size: 1.4, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false });
  const pts = new THREE.Points(geo, mat);
  scene.add(pts);
  const start = performance.now();
  function fade() {
    const t = (performance.now() - start) / 1200;
    mat.opacity = Math.max(0, 1 - t);
    pts.scale.setScalar(1 + t * 3);
    if (t < 1) requestAnimationFrame(fade); else { scene.remove(pts); geo.dispose(); mat.dispose(); }
  }
  fade();
}

function showBanner(text) {
  const el = document.getElementById('notify-banner');
  el.textContent = text;
  el.classList.remove('hidden');
  clearTimeout(showBanner._t);
  showBanner._t = setTimeout(() => el.classList.add('hidden'), 2600);
}

function destroyObject(obj, reason, silent = false) {
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
   EVENT LOG
   ========================================================================= */
function fmtClock(t) {
  const h = String(Math.floor(t / 3600)).padStart(2, '0');
  const m = String(Math.floor((t % 3600) / 60)).padStart(2, '0');
  const s = String(Math.floor(t % 60)).padStart(2, '0');
  return `${h}:${m}:${s}`;
}
function logEvent(text, level = 'info') {
  const body = document.getElementById('log-body');
  const div = document.createElement('div');
  div.className = 'log-entry event-' + level;
  div.innerHTML = `<span class="log-time">[${fmtClock(simTime)}]</span>${text}`;
  body.prepend(div);
  while (body.children.length > 60) body.removeChild(body.lastChild);
}

/* =========================================================================
   PHYSICS STEP FOR MAIN BODIES
   ========================================================================= */
function stepBody(obj, dt) {
  const pos = obj.mesh.position;
  const r = pos.length();

  if (r < CAPTURE_R) {
    destroyObject(obj, 'captured');
    return;
  }

  const accelMag = -(CONFIG.G * CONFIG.blackHoleMass) / (r * r);
  const dir = pos.clone().normalize();
  obj.velocity.addScaledVector(dir, accelMag * dt);

  // artificial inspiral drag near the hole (keeps captures rare but inevitable)
  if (r < DRAG_R) {
    const k = (DRAG_R - r) / DRAG_R;
    obj.velocity.multiplyScalar(1 - k * 0.012 * dt * 60);
  }

  // occasional tiny random perturbation so orbits slowly evolve
  if (Math.random() < 0.004) {
    obj.velocity.x += (Math.random() - 0.5) * 0.05;
    obj.velocity.z += (Math.random() - 0.5) * 0.05;
  }

  pos.addScaledVector(obj.velocity, dt);

  // tidal stretching visuals
  if (r < TIDAL_R) {
    if (obj.status !== 'unstable') {
      obj.status = 'unstable';
      logEvent(`${obj.name} has entered an unstable orbit.`, 'info');
      if (obj.type === 'planet') showBanner('PLANETARY BODY DESTABILIZED');
    }
    const k = 1 - r / TIDAL_R;
    const stretch = 1 + k * 2.2;
    const tangent = new THREE.Vector3(-pos.z, 0, pos.x).normalize();
    obj.mesh.up.copy(tangent);
    obj.core.scale.set(1 / Math.sqrt(stretch), stretch, 1 / Math.sqrt(stretch));
    obj.core.lookAt(pos.clone().add(tangent));
    if (!obj.lastLog.tidal || simTime - obj.lastLog.tidal > 3) {
      logEvent(`Tidal forces increasing on ${obj.name}.`, r < TIDAL_R * 0.4 ? 'critical' : 'info');
      obj.lastLog.tidal = simTime;
    }
  } else if (obj.status === 'unstable' && r > TIDAL_R * 1.15) {
    obj.status = 'stable';
    obj.core.scale.set(1, 1, 1);
    obj.core.rotation.set(0, 0, 0);
  }

  // slingshot / escape detection
  if (obj._prevR !== undefined) {
    if (obj._prevR < r && obj._closestR !== undefined && obj._closestR < 55 && !obj._slingLogged && r > obj._closestR * 1.4) {
      logEvent(`Gravitational slingshot detected: ${obj.name} is accelerating away from the singularity.`, 'info');
      obj._slingLogged = true;
    }
    if (obj._closestR === undefined || r < obj._closestR) obj._closestR = r;
  }
  obj._prevR = r;

  if (r > ESCAPE_R) {
    logEvent(`${obj.name} has escaped the system.`, 'info');
    destroyObject(obj, 'escaped', true);
    return;
  }

  updateTrail(obj.trail, pos);

  if (obj.moon) {
    obj.moon.userData.angle += dt * 1.4;
    const rr = obj.moon.userData.orbitR;
    obj.moon.position.set(Math.cos(obj.moon.userData.angle) * rr, 0, Math.sin(obj.moon.userData.angle) * rr);
  }
  obj.core.rotation.y += dt * 0.3;
}

/* =========================================================================
   INFO PANEL UPDATE
   ========================================================================= */
function updateInfoPanel() {
  if (!selected) return;
  const $ = (id) => document.getElementById(id);
  if (selected.isBH) {
    $('info-name').textContent = selected.name;
    $('info-type').textContent = 'SUPERMASSIVE SINGULARITY';
    $('info-mass').textContent = CONFIG.blackHoleMass.toFixed(0) + ' M☉';
    $('info-distance').textContent = '0.00 AU';
    $('info-velocity').textContent = '—';
    $('info-orbit').textContent = '—';
    $('info-tidal').textContent = 'EXTREME';
    $('info-status').textContent = 'STABLE';
    return;
  }
  if (selected.isAsteroid) {
    const i = selected.index;
    if (!aAlive[i]) { deselect(); return; }
    const r = aPos[i].length();
    $('info-name').textContent = selected.name;
    $('info-type').textContent = 'ASTEROID';
    $('info-mass').textContent = aMass[i].toFixed(2) + ' Mt';
    $('info-distance').textContent = (r / 10).toFixed(2) + ' AU';
    $('info-velocity').textContent = (aVel[i].length() / 60).toFixed(2) + 'c';
    $('info-orbit').textContent = r < TIDAL_R ? 'UNSTABLE' : 'STABLE';
    $('info-tidal').textContent = r < TIDAL_R ? (r < TIDAL_R * 0.4 ? 'CRITICAL' : 'ELEVATED') : 'NOMINAL';
    $('info-status').textContent = 'TRACKED';
    return;
  }
  const obj = selected;
  const r = obj.mesh.position.length();
  const speed = obj.velocity.length();
  $('info-name').textContent = obj.name;
  $('info-type').textContent = obj.type.toUpperCase();
  $('info-mass').textContent = obj.mass.toFixed(2) + (obj.type === 'star' ? ' M☉' : ' Mt');
  $('info-distance').textContent = (r / 10).toFixed(2) + ' AU';
  $('info-velocity').textContent = (speed / 60).toFixed(2) + 'c';
  const period = ((2 * Math.PI * r) / Math.max(speed, 0.001) / 10).toFixed(1);
  $('info-orbit').textContent = `${obj.status.toUpperCase()} (T≈${period}d)`;
  $('info-tidal').textContent = r < TIDAL_R ? (r < TIDAL_R * 0.4 ? 'CRITICAL' : 'ELEVATED') : 'NOMINAL';
  $('info-status').textContent = obj.status === 'unstable' ? 'DESTABILIZING' : 'NOMINAL';

  // predicted trajectory (simple forward integration, doesn't mutate real state)
  const p = obj.mesh.position.clone();
  const v = obj.velocity.clone();
  const arr = predictGeo.attributes.position.array;
  const steps = 80;
  for (let i = 0; i < steps; i++) {
    const rr = Math.max(p.length(), 1);
    const a = -(CONFIG.G * CONFIG.blackHoleMass) / (rr * rr);
    v.addScaledVector(p.clone().normalize(), a * 0.6);
    p.addScaledVector(v, 0.6);
    arr[i * 3] = p.x; arr[i * 3 + 1] = p.y; arr[i * 3 + 2] = p.z;
    if (p.length() < CAPTURE_R) { for (let j = i + 1; j < steps; j++) { arr[j*3]=p.x;arr[j*3+1]=p.y;arr[j*3+2]=p.z; } break; }
  }
  predictGeo.attributes.position.needsUpdate = true;
  predictGeo.computeLineDistances();
}

/* =========================================================================
   UI WIRING
   ========================================================================= */
document.getElementById('time-buttons').addEventListener('click', (e) => {
  const btn = e.target.closest('.tbtn');
  if (!btn) return;
  document.querySelectorAll('.tbtn').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  const speed = +btn.dataset.speed;
  CONFIG.paused = speed === 0;
  if (!CONFIG.paused) CONFIG.timeScale = speed;
});

document.getElementById('btn-reset').addEventListener('click', () => location.reload());

function bindSlider(id, cb) {
  const el = document.getElementById(id);
  el.addEventListener('input', () => cb(+el.value));
}
bindSlider('slider-mass', (v) => { CONFIG.blackHoleMass = v; document.getElementById('val-mass').textContent = v; });
bindSlider('slider-g', (v) => { CONFIG.G = v; document.getElementById('val-g').textContent = v.toFixed(2); });
bindSlider('slider-asteroids', (v) => { document.getElementById('val-asteroids').textContent = v; initAsteroids(v); });
bindSlider('slider-disk', (v) => { CONFIG.diskBrightness = v; diskMat.uniforms.uBrightness.value = v; document.getElementById('val-disk').textContent = v.toFixed(2); });
bindSlider('slider-lens', (v) => { CONFIG.lensStrength = v; document.getElementById('val-lens').textContent = v.toFixed(2); });

document.getElementById('btn-follow').addEventListener('click', () => { if (selected && !selected.isAsteroid && !selected.isBH) followTarget = selected; });
document.getElementById('btn-return').addEventListener('click', () => { followTarget = null; controls.target.set(0, 0, 0); });

document.getElementById('btn-help').addEventListener('click', () => document.getElementById('help-modal').classList.remove('hidden'));
document.getElementById('btn-help-close').addEventListener('click', () => document.getElementById('help-modal').classList.add('hidden'));

/* =========================================================================
   POSTPROCESSING (bloom + gravitational lensing)
   ========================================================================= */
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.15, 0.55, 0.15);
composer.addPass(bloomPass);

const lensShader = {
  uniforms: {
    tDiffuse: { value: null },
    uBH: { value: new THREE.Vector2(0.5, 0.5) },
    uStrength: { value: 1.0 },
    uAspect: { value: window.innerWidth / window.innerHeight },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform vec2 uBH;
    uniform float uStrength;
    uniform float uAspect;
    varying vec2 vUv;
    void main(){
      vec2 diff = vUv - uBH;
      diff.x *= uAspect;
      float dist = length(diff);
      vec2 dirn = dist > 0.0001 ? normalize(diff) : vec2(0.0);
      float bend = uStrength * 0.09 * exp(-dist * 9.0);
      vec2 offset = dirn * bend;
      offset.x /= uAspect;
      vec2 sampleUv = clamp(vUv - offset, 0.0, 1.0);
      gl_FragColor = texture2D(tDiffuse, sampleUv);
    }
  `,
};
const lensPass = new ShaderPass(lensShader);
composer.addPass(lensPass);

/* =========================================================================
   INITIAL POPULATION
   ========================================================================= */
for (let i = 0; i < 5; i++) createStar();
for (let i = 0; i < 8; i++) createPlanet();
for (let i = 0; i < 3; i++) createComet();
logEvent('Observatory systems online. Gravitational field stabilized.', 'info');

/* =========================================================================
   MAIN LOOP
   ========================================================================= */
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const rawDt = Math.min(clock.getDelta(), 0.05);
  controls.update();

  if (!CONFIG.paused) {
    const dt = rawDt * CONFIG.timeScale;
    simTime += dt;
    for (const obj of [...bodies]) stepBody(obj, dt);
    updateAsteroids(dt);
    diskMat.uniforms.uTime.value += dt;
    diskLight.intensity = 5 + Math.sin(simTime * 0.6) * 1.2;
  }

  document.getElementById('clock-value').textContent = fmtClock(simTime);

  if (followTarget) {
    if (!bodies.includes(followTarget)) { followTarget = null; }
    else controls.target.lerp(followTarget.mesh.position, 0.08);
  }

  // billboard the photon ring halo & shadow to always face camera handled by Sprite automatically
  photonSprite.material.rotation += rawDt * 0.05;

  if (selected) updateInfoPanel();

  // project black hole for lensing shader
  const ndc = new THREE.Vector3(0, 0, 0).project(camera);
  lensPass.uniforms.uBH.value.set((ndc.x + 1) / 2, (ndc.y + 1) / 2);
  lensPass.uniforms.uStrength.value = CONFIG.lensStrength * (ndc.z < 1 ? 1 : 0);
  lensPass.uniforms.uAspect.value = window.innerWidth / window.innerHeight;

  composer.render();
}
animate();
