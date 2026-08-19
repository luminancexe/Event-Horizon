import * as THREE from 'three';
import { CONFIG, state } from './state.js';
import { camera, controls } from './scene.js';
import { setCameraMode } from './camera.js';
import { deselect, select, selectAsteroid, updateBreadcrumb } from './selection.js';
import { createBlackHole, createStar, createPlanet, createMoon, createComet, createNeutronStar, orbitalVelocity } from './objects.js';
import { initAsteroids } from './asteroids.js';
import { destroyObject, clearFragments } from './effects.js';
import { logEvent, showBanner } from './events.js';
import { refreshObjectBrowser, syncUIFromConfig } from './ui.js';

/* =========================================================================
   UNIVERSE MANAGEMENT — clear / procedurally generate / save / load / export
   ========================================================================= */
function clearUniverse() {
  for (const b of [...state.bodies]) destroyObject(b);
  clearFragments();
  initAsteroids(0);
  deselect();
  state.followTarget = null;
  setCameraMode('free');
  state.cameraTween = null;
  controls.enabled = true;
  camera.position.set(0, 160, 300);
  controls.target.set(0, 0, 0);
  state.simTime = 0;
  state.simYears = 0;
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
  let selectedMarker = null;
  if (state.selected?.isAsteroid) selectedMarker = { kind: 'asteroid', index: state.selected.index };
  else if (state.selected) selectedMarker = { kind: 'body' }; // which body gets tagged below via __wasSelected

  // build a lookup from body reference → index-in-save-array so that
  // parent/child relationships can be stored as stable integer indices
  const bodyIndex = new Map();
  state.bodies.forEach((b, i) => bodyIndex.set(b, i));

  return {
    version: 3,
    config: { ...CONFIG },
    simTime: state.simTime, simYears: state.simYears,
    cameraMode: state.cameraMode,
    cameraPosition: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
    cameraTarget: { x: controls.target.x, y: controls.target.y, z: controls.target.z },
    selected: selectedMarker,
    bodies: state.bodies.map((b) => ({
      type: b.type, name: b.name, mass: b.mass, radius: b.radius,
      position: { x: b.mesh.position.x, y: b.mesh.position.y, z: b.mesh.position.z },
      velocity: { x: b.velocity.x, y: b.velocity.y, z: b.velocity.z },
      tempK: b.tempK, age: b.age, lifespan: b.lifespan, isHighMass: b.isHighMass,
      stage: b.stage, lifecycleScale: b.lifecycleScale,
      color: b.core?.material?.color ? b.core.material.color.getHex() : undefined,
      glowColor: b.glow?.material?.color ? b.glow.material.color.getHex() : undefined,
      __wasSelected: b === state.selected || undefined,
      // parent/child relationship: saved as the parent's index in this
      // same bodies array (-1 or absent means no parent). Children are
      // derived from parentIndex on load, so they don't need storing.
      parentIndex: b.parent ? bodyIndex.get(b.parent) ?? -1 : -1,
    })),
    asteroids: { pos: state.aPos.map((p) => [p.x, p.y, p.z]), vel: state.aVel.map((v) => [v.x, v.y, v.z]), mass: state.aMass.slice(), radius: state.aRadius.slice() },
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
  if (!obj) return null;
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
  return obj;
}

// guards against a corrupted or hand-edited save file putting the sim in a
// broken/unstable state — mirrors the min/max already enforced by each
// control's slider in index.html
const CONFIG_BOUNDS = {
  G: [0.05, 2], blackHoleMass: [500, 20000], asteroidCount: [0, 2000],
  diskBrightness: [0.2, 2.5], lensStrength: [0, 2],
  trailLength: [20, 400], maxSubstep: [0.02, 0.3], timeScale: [0.1, 1000],
};
function clampConfigToSafeRanges() {
  for (const [key, [min, max]] of Object.entries(CONFIG_BOUNDS)) {
    if (typeof CONFIG[key] === 'number' && isFinite(CONFIG[key])) {
      CONFIG[key] = Math.min(max, Math.max(min, CONFIG[key]));
    } else if (key in CONFIG) {
      CONFIG[key] = min; // non-numeric/NaN garbage in the save file — fall back to a safe floor
    }
  }
}

function deserializeUniverse(data) {
  clearUniverse();
  if (data.config) {
    Object.assign(CONFIG, data.config);
    clampConfigToSafeRanges();
    syncUIFromConfig();
  }
  state.simTime = data.simTime || 0;
  state.simYears = data.simYears || 0;

  // --- Phase 1: recreate every body (black holes first so gravity is stable) ---
  // Tag each entry with its original position in the save array *before*
  // sorting, so parentIndex references (which use original positions) resolve
  // correctly regardless of creation order.
  const rawBodies = data.bodies || [];
  rawBodies.forEach((bd, i) => { bd._origIndex = i; });
  const sorted = [...rawBodies].sort((a, b) => (a.type === 'blackhole' ? -1 : 0) - (b.type === 'blackhole' ? -1 : 0));
  // Keep a map from original save-array index → restored object so that
  // parent/child links can be reconnected in a second pass.
  const origIndexToObj = new Map();
  let restoredSelection = null;
  for (const bd of sorted) {
    const obj = restoreBody(bd);
    if (!obj) continue;
    origIndexToObj.set(bd._origIndex, obj);
    if (bd.__wasSelected) restoredSelection = obj;
  }

  // --- Phase 2: restore parent/child relationships ---
  // parentIndex values reference positions in the original (unsorted) bodies
  // array. We tagged each entry with _origIndex before sorting so the lookup
  // works regardless of creation order.
  for (const bd of sorted) {
    const parentIdx = bd.parentIndex ?? -1;
    if (parentIdx < 0) continue;
    const child = origIndexToObj.get(bd._origIndex);
    const parent = origIndexToObj.get(parentIdx);
    if (!child || !parent || child === parent) continue;
    // guard against duplicates (constructor may have already linked if
    // parent was passed at creation time — it wasn't, but be safe)
    if (child.parent) continue;
    child.parent = parent;
    if (!parent.children.includes(child)) parent.children.push(child);
  }

  if (data.asteroids?.pos?.length) {
    const count = data.asteroids.pos.length;
    initAsteroids(count);
    for (let i = 0; i < count; i++) {
      state.aPos[i].set(...data.asteroids.pos[i]);
      state.aVel[i].set(...data.asteroids.vel[i]);
      state.aMass[i] = data.asteroids.mass[i];
      state.aRadius[i] = data.asteroids.radius[i];
    }
    CONFIG.asteroidCount = count;
    document.getElementById('slider-asteroids').value = count;
    document.getElementById('val-asteroids').textContent = count;
  } else {
    initAsteroids(CONFIG.asteroidCount || 400);
  }

  // restore camera framing and mode
  if (data.cameraPosition) camera.position.set(data.cameraPosition.x, data.cameraPosition.y, data.cameraPosition.z);
  if (data.cameraTarget) controls.target.set(data.cameraTarget.x, data.cameraTarget.y, data.cameraTarget.z);

  // restore selection: a named body (matched via the __wasSelected flag baked
  // into its save entry, since ids aren't stable across a reload) or an asteroid
  if (restoredSelection) {
    select(restoredSelection);
  } else if (data.selected?.kind === 'asteroid' && state.aAlive[data.selected.index]) {
    selectAsteroid(data.selected.index);
  }
  if (data.cameraMode && data.cameraMode !== 'free') {
    setCameraMode(data.cameraMode);
    if (restoredSelection) state.followTarget = restoredSelection;
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