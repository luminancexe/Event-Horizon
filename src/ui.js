import * as THREE from 'three';
import { CONFIG, state } from './state.js';
import { scene } from './scene.js';
import { makeRingTexture } from './textures.js';
import { findDominantAttractor, blackHoles, dominantBlackHole, resizeAllTrails } from './objects.js';
import { initAsteroids } from './asteroids.js';
import { select, updateBreadcrumb } from './selection.js';
import { flyCameraTo, setCameraMode } from './camera.js';
import { logEvent } from './events.js';

/* =========================================================================
   PHYSICS DEBUG HUD
   ========================================================================= */
export function updateDebugHud() {
  const $ = (id) => document.getElementById(id);
  const selected = state.selected;
  $('dbg-fps').textContent = Math.round(state.fpsSmoothed);
  $('dbg-phys-ms').textContent = state.lastPhysicsMs.toFixed(2) + ' ms';
  $('dbg-ms-gravity').textContent = state.lastGravityMs.toFixed(2) + ' ms';
  $('dbg-ms-collision').textContent = state.lastCollisionMs.toFixed(2) + ' ms';
  $('dbg-ms-asteroids').textContent = state.lastAsteroidMs.toFixed(2) + ' ms';
  $('dbg-objects').textContent = state.bodies.length;
  $('dbg-asteroids').textContent = state.aPos.length;
  $('dbg-fragments').textContent = state.fragments.length;
  $('dbg-gravcalcs').textContent = state.gravityCalcCount.toLocaleString();
  $('dbg-speed').textContent = CONFIG.paused ? 'PAUSED' : CONFIG.timeScale + 'x';
  $('dbg-substeps').textContent = state.lastSubsteps;

  let vel = null, acc = null, mass = null, pos = null;
  if (selected && selected.isAsteroid && state.aAlive[selected.index]) {
    vel = state.aVel[selected.index]; acc = null; mass = state.aMass[selected.index]; pos = state.aPos[selected.index];
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
   DEBUG VISUAL OVERLAYS — velocity/force/acceleration vectors, orbital
   paths, center of mass, collision radii. Each helper is created lazily on
   the body itself the first time it's needed, then just shown/hidden.
   ========================================================================= */
const comMarkerTex = makeRingTexture('rgba(180,255,150,0.95)');
const comMarker = new THREE.Sprite(new THREE.SpriteMaterial({ map: comMarkerTex, color: 0xb4ff96, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending }));
comMarker.scale.set(10, 10, 1);
comMarker.visible = false;
scene.add(comMarker);

function ensureDebugHelpers(obj) {
  if (!obj._velArrow) {
    obj._velArrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 1, 0xffe066, 1.6, 0.9);
    obj._velArrow.visible = false;
    scene.add(obj._velArrow);
  }
  if (!obj._forceArrow) {
    obj._forceArrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 1, 0xff5d5d, 1.6, 0.9);
    obj._forceArrow.visible = false;
    scene.add(obj._forceArrow);
  }
  if (!obj._accArrow) {
    obj._accArrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 1, 0x7fd9ff, 1.6, 0.9);
    obj._accArrow.visible = false;
    scene.add(obj._accArrow);
  }
  if (!obj._collisionSphere) {
    obj._collisionSphere = new THREE.Mesh(
      new THREE.SphereGeometry(1, 14, 10),
      new THREE.MeshBasicMaterial({ color: 0xff9d4d, wireframe: true, transparent: true, opacity: 0.4, depthWrite: false })
    );
    obj._collisionSphere.visible = false;
    scene.add(obj._collisionSphere);
  }
}
function hideDebugHelpers(obj) {
  if (obj._velArrow) obj._velArrow.visible = false;
  if (obj._forceArrow) obj._forceArrow.visible = false;
  if (obj._accArrow) obj._accArrow.visible = false;
  if (obj._collisionSphere) obj._collisionSphere.visible = false;
}

export function updateDebugOverlays() {
  const active = CONFIG.debugMode;
  const wantBodyOverlay = active && (CONFIG.overlayVelocity || CONFIG.overlayForce || CONFIG.overlayAccel || CONFIG.overlayCollision);

  for (const b of state.bodies) {
    if (!wantBodyOverlay) { hideDebugHelpers(b); continue; }
    ensureDebugHelpers(b);
    const pos = b.mesh.position;

    if (CONFIG.overlayVelocity && b.velocity.length() > 0.05) {
      b._velArrow.visible = true;
      b._velArrow.position.copy(pos);
      b._velArrow.setDirection(b.velocity.clone().normalize());
      b._velArrow.setLength(Math.min(b.velocity.length() * 1.3 + 1, 70), 1.6, 0.8);
    } else b._velArrow.visible = false;

    const acc = b.acceleration || new THREE.Vector3();
    const accLen = acc.length();
    if (CONFIG.overlayAccel && accLen > 0.0005) {
      b._accArrow.visible = true;
      b._accArrow.position.copy(pos);
      b._accArrow.setDirection(acc.clone().normalize());
      b._accArrow.setLength(Math.min(accLen * 45 + 1, 70), 1.6, 0.8);
    } else b._accArrow.visible = false;

    if (CONFIG.overlayForce && accLen > 0.0005) {
      const force = accLen * b.mass; // F = m*a
      b._forceArrow.visible = true;
      b._forceArrow.position.copy(pos);
      b._forceArrow.setDirection(acc.clone().normalize()); // same direction as acceleration
      b._forceArrow.setLength(THREE.MathUtils.clamp(Math.log10(force + 1) * 16, 2, 80), 1.6, 0.8);
    } else b._forceArrow.visible = false;

    if (CONFIG.overlayCollision && b.type !== 'blackhole') {
      b._collisionSphere.visible = true;
      b._collisionSphere.position.copy(pos);
      b._collisionSphere.scale.setScalar(b.radius * 0.85);
    } else b._collisionSphere.visible = false;
  }

  if (active && CONFIG.overlayCOM && state.bodies.length) {
    let totalMass = 0;
    const com = new THREE.Vector3();
    for (const b of state.bodies) { com.addScaledVector(b.mesh.position, b.mass); totalMass += b.mass; }
    if (totalMass > 0) com.divideScalar(totalMass);
    comMarker.visible = true;
    comMarker.position.copy(com);
  } else {
    comMarker.visible = false;
  }

  // orbital-path visibility: only overridden while actively debugging, so
  // the default (always-on) trail behavior is untouched outside debug mode
  const showPaths = CONFIG.trailsEnabled && (!active || CONFIG.overlayPaths);
  for (const b of state.bodies) if (b.trail) b.trail.line.visible = showPaths;
}

/* =========================================================================
   OBJECT BROWSER — a searchable-by-eye list of every body in the sim
   ========================================================================= */
const BROWSER_LABELS = { blackhole: 'BLACK HOLES', star: 'STARS', planet: 'PLANETS', moon: 'MOONS', comet: 'COMETS', neutron: 'NEUTRON STARS' };
export function refreshObjectBrowser() {
  document.getElementById('browser-count').textContent = state.bodies.length ? `(${state.bodies.length})` : '';
  if (state.browserCollapsed) return;
  const groups = { blackhole: [], star: [], planet: [], moon: [], comet: [], neutron: [] };
  for (const b of state.bodies) if (groups[b.type]) groups[b.type].push(b);
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
  state.browserCollapsed = !state.browserCollapsed;
  document.getElementById('browser-panel').classList.toggle('collapsed', state.browserCollapsed);
  refreshObjectBrowser();
});
document.getElementById('browser-body').addEventListener('click', (e) => {
  const item = e.target.closest('.browser-item');
  if (!item) return;
  const obj = state.bodies.find((b) => b.id === +item.dataset.id);
  if (!obj) return;
  select(obj);
  flyCameraTo(obj.mesh.position, Math.max(obj.radius * 8, 40), 1200);
});
setInterval(refreshObjectBrowser, 1500);

/* =========================================================================
   UI WIRING — control-deck sliders/buttons, time controls, help modal
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
bindSlider('slider-substep', (v) => { CONFIG.maxSubstep = v; document.getElementById('val-substep').textContent = v.toFixed(2); });
bindSlider('slider-traillen', (v) => { document.getElementById('val-traillen').textContent = v; resizeAllTrails(Math.round(v)); });

document.getElementById('btn-trails-toggle').addEventListener('click', () => {
  CONFIG.trailsEnabled = !CONFIG.trailsEnabled;
  const btn = document.getElementById('btn-trails-toggle');
  btn.textContent = CONFIG.trailsEnabled ? '\u25cf TRAILS: ON' : '\u25cb TRAILS: OFF';
  btn.classList.toggle('off', !CONFIG.trailsEnabled);
});

document.getElementById('btn-follow').addEventListener('click', () => {
  if (!state.selected || state.selected.isAsteroid) return;
  if (state.cameraMode === 'follow' && state.followTarget === state.selected) { setCameraMode('free'); state.followTarget = null; return; }
  state.followTarget = state.selected; setCameraMode('follow');
});
document.getElementById('btn-orbit').addEventListener('click', () => {
  if (!state.selected || state.selected.isAsteroid) return;
  if (state.cameraMode === 'orbit' && state.followTarget === state.selected) { setCameraMode('free'); state.followTarget = null; return; }
  state.followTarget = state.selected; setCameraMode('orbit');
});
document.getElementById('btn-return').addEventListener('click', () => {
  state.followTarget = null;
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
const OVERLAY_CHECKBOXES = {
  'ov-velocity': 'overlayVelocity', 'ov-force': 'overlayForce', 'ov-accel': 'overlayAccel',
  'ov-paths': 'overlayPaths', 'ov-com': 'overlayCOM', 'ov-collision': 'overlayCollision',
};
for (const [id, key] of Object.entries(OVERLAY_CHECKBOXES)) {
  const el = document.getElementById(id);
  el.checked = CONFIG[key];
  el.addEventListener('change', () => { CONFIG[key] = el.checked; });
}

/* =========================================================================
   CONFIG -> UI SYNC — applies every CONFIG value to its on-screen control.
   Used after loading a saved universe (or generating a new one) so sliders,
   toggles, and the debug HUD all reflect exactly what was restored, rather
   than silently drifting out of sync with the underlying CONFIG object.
   ========================================================================= */
export function syncUIFromConfig() {
  const setSlider = (id, valId, v, digits) => {
    document.getElementById(id).value = v;
    document.getElementById(valId).textContent = digits === 0 ? v : v.toFixed(digits);
  };
  setSlider('slider-mass', 'val-mass', CONFIG.blackHoleMass, 0);
  setSlider('slider-g', 'val-g', CONFIG.G, 2);
  setSlider('slider-asteroids', 'val-asteroids', CONFIG.asteroidCount, 0);
  setSlider('slider-disk', 'val-disk', CONFIG.diskBrightness, 2);
  setSlider('slider-lens', 'val-lens', CONFIG.lensStrength, 2);
  setSlider('slider-substep', 'val-substep', CONFIG.maxSubstep, 2);
  setSlider('slider-traillen', 'val-traillen', CONFIG.trailLength, 0);

  const gravBtn = document.getElementById('btn-gravity-toggle');
  gravBtn.textContent = CONFIG.gravityEnabled ? '\u25cf GRAVITY: ON' : '\u25cb GRAVITY: OFF';
  gravBtn.classList.toggle('off', !CONFIG.gravityEnabled);

  const trailBtn = document.getElementById('btn-trails-toggle');
  trailBtn.textContent = CONFIG.trailsEnabled ? '\u25cf TRAILS: ON' : '\u25cb TRAILS: OFF';
  trailBtn.classList.toggle('off', !CONFIG.trailsEnabled);

  document.getElementById('debug-hud').classList.toggle('hidden', !CONFIG.debugMode);
  for (const [id, key] of Object.entries(OVERLAY_CHECKBOXES)) document.getElementById(id).checked = CONFIG[key];
}