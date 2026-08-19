/**
 * @file ui.js
 * @description Physics telemetry HUD, visual debug overlays, object browser tree, and control deck wiring.
 *
 * Implements:
 * 1. Real-time physics telemetry HUD (FPS, integration time, sub-step counts, energy profiles).
 * 2. Visual debug overlays (velocity/force/acceleration vectors, system center-of-mass, collision bounds).
 * 3. Categorized hierarchical object browser with direct camera focus navigation.
 * 4. Control deck slider and button bindings with bi-directional CONFIG synchronization.
 */

import * as THREE from 'three';
import { CONFIG, state } from './state.js';
import { scene } from './scene.js';
import { makeRingTexture } from './textures.js';
import {
  findDominantAttractor,
  blackHoles,
  dominantBlackHole,
  resizeAllTrails,
  computeTimeDilation,
} from './objects.js';
import { initAsteroids } from './asteroids.js';
import { select, updateBreadcrumb } from './selection.js';
import { flyCameraTo, setCameraMode } from './camera.js';
import { logEvent } from './events.js';
import { computeLenseThirringAcceleration } from './physics.js';

/* ============================================================================
   PHYSICS TELEMETRY DEBUG HUD
   ============================================================================ */

/**
 * Updates real-time performance telemetry and orbital energy statistics in the debug HUD.
 */
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
  const elLenses = $('dbg-lenses');
  if (elLenses) elLenses.textContent = state.activeLensesCount ?? 0;
  $('dbg-speed').textContent = CONFIG.paused ? 'PAUSED' : CONFIG.timeScale + 'x';
  $('dbg-substeps').textContent = state.lastSubsteps;

  let vel = null;
  let acc = null;
  let mass = null;
  let pos = null;

  if (selected && selected.isAsteroid && state.aAlive[selected.index]) {
    vel = state.aVel[selected.index];
    acc = null;
    mass = state.aMass[selected.index];
    pos = state.aPos[selected.index];
  } else if (selected && selected.mesh) {
    vel = selected.velocity;
    acc = selected.acceleration;
    mass = selected.mass;
    pos = selected.mesh.position;
  }

  if (selected && selected.type === 'blackhole') {
    $('dbg-sel-framedrag').textContent =
      selected.rotationModel === 'kerr'
        ? `KERR (a=${selected.spin >= 0 ? '+' : ''}${selected.spin.toFixed(2)})`
        : 'STATIC (SCHWARZSCHILD)';
  } else if (vel && pos) {
    computeLenseThirringAcceleration(
      pos,
      vel,
      selected.isAsteroid ? null : selected,
      state.bodies,
      _scratchLTOverlay
    );
    const ltMag = _scratchLTOverlay.length();
    $('dbg-sel-framedrag').textContent =
      ltMag > 0.00001 ? `${ltMag.toFixed(4)} u/s\u00b2` : '0.0000 (STATIC)';
  } else {
    $('dbg-sel-framedrag').textContent = '\u2014';
  }

  const elDbgDil = $('dbg-sel-dilation');
  if (elDbgDil) {
    if (selected && selected.type === 'blackhole') {
      elDbgDil.textContent = '0.0000\u00d7 (HORIZON FROZEN)';
    } else if (selected && selected.isAsteroid && pos && vel) {
      const gamma = computeTimeDilation(pos, vel, null);
      elDbgDil.textContent = `${(gamma * 100).toFixed(1)}% (${gamma.toFixed(4)}\u00d7)`;
    } else if (selected && selected.timeDilation !== undefined) {
      elDbgDil.textContent = `${(selected.timeDilation * 100).toFixed(1)}% (${selected.timeDilation.toFixed(4)}\u00d7)`;
    } else if (pos && vel) {
      const gamma = computeTimeDilation(pos, vel, selected);
      elDbgDil.textContent = `${(gamma * 100).toFixed(1)}% (${gamma.toFixed(4)}\u00d7)`;
    } else {
      elDbgDil.textContent = '\u2014';
    }
  }

  if (vel && pos) {
    $('dbg-sel-vel').textContent = `${vel.length().toFixed(3)} u/s`;
    $('dbg-sel-acc').textContent = acc ? `${acc.length().toFixed(4)} u/s\u00b2` : '\u2014';
    // Classical kinetic energy: E_k = 0.5 * m * v^2
    $('dbg-sel-ke').textContent = (0.5 * mass * vel.lengthSq()).toFixed(2);

    const dom = findDominantAttractor(pos, selected.isAsteroid ? null : selected);
    if (dom) {
      const r = Math.max(pos.distanceTo(dom.mesh.position), 1);
      // Gravitational potential energy relative to primary local attractor: U = -G * M * m / r
      $('dbg-sel-pe').textContent = (-(CONFIG.G * dom.mass * mass) / r).toFixed(2);
    } else {
      $('dbg-sel-pe').textContent = '\u2014';
    }
  } else {
    $('dbg-sel-vel').textContent = '\u2014';
    $('dbg-sel-acc').textContent = '\u2014';
    $('dbg-sel-ke').textContent = '\u2014';
    $('dbg-sel-pe').textContent = '\u2014';
  }
}

/* ============================================================================
   VISUAL DEBUG OVERLAYS (VECTORS, CENTER OF MASS, COLLISION BOUNDS)
   ============================================================================ */

const _scratchLTOverlay = new THREE.Vector3();
const comMarkerTex = makeRingTexture('rgba(180,255,150,0.95)');
const comMarker = new THREE.Sprite(
  new THREE.SpriteMaterial({
    map: comMarkerTex,
    color: 0xb4ff96,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  })
);
comMarker.scale.set(10, 10, 1);
comMarker.visible = false;
scene.add(comMarker);

/**
 * Lazily allocates vector arrow helpers and collision boundary meshes on a celestial body.
 * @param {CelestialBody} obj - Target celestial body.
 */
function ensureDebugHelpers(obj) {
  if (!obj._velArrow) {
    obj._velArrow = new THREE.ArrowHelper(
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(),
      1,
      0xffe066,
      1.6,
      0.9
    );
    obj._velArrow.visible = false;
    scene.add(obj._velArrow);
  }
  if (!obj._forceArrow) {
    obj._forceArrow = new THREE.ArrowHelper(
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(),
      1,
      0xff5d5d,
      1.6,
      0.9
    );
    obj._forceArrow.visible = false;
    scene.add(obj._forceArrow);
  }
  if (!obj._accArrow) {
    obj._accArrow = new THREE.ArrowHelper(
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(),
      1,
      0x7fd9ff,
      1.6,
      0.9
    );
    obj._accArrow.visible = false;
    scene.add(obj._accArrow);
  }
  if (!obj._frameDragArrow) {
    obj._frameDragArrow = new THREE.ArrowHelper(
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(),
      1,
      0xb5179e,
      1.6,
      0.9
    );
    obj._frameDragArrow.visible = false;
    scene.add(obj._frameDragArrow);
  }
  if (!obj._collisionSphere) {
    obj._collisionSphere = new THREE.Mesh(
      new THREE.SphereGeometry(1, 14, 10),
      new THREE.MeshBasicMaterial({
        color: 0xff9d4d,
        wireframe: true,
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
      })
    );
    obj._collisionSphere.visible = false;
    scene.add(obj._collisionSphere);
  }
}

/**
 * Hides all active debug overlay helpers attached to a celestial body.
 * @param {CelestialBody} obj - Target celestial body.
 */
function hideDebugHelpers(obj) {
  if (obj._velArrow) obj._velArrow.visible = false;
  if (obj._forceArrow) obj._forceArrow.visible = false;
  if (obj._accArrow) obj._accArrow.visible = false;
  if (obj._frameDragArrow) obj._frameDragArrow.visible = false;
  if (obj._collisionSphere) obj._collisionSphere.visible = false;
}

/**
 * Updates spatial positions and orientations for all active debug overlay vectors and markers.
 */
export function updateDebugOverlays() {
  const active = CONFIG.debugMode;
  const wantBodyOverlay =
    active &&
    (CONFIG.overlayVelocity ||
      CONFIG.overlayForce ||
      CONFIG.overlayAccel ||
      CONFIG.overlayFrameDrag ||
      CONFIG.overlayCollision);

  for (const b of state.bodies) {
    if (!wantBodyOverlay) {
      hideDebugHelpers(b);
      continue;
    }
    ensureDebugHelpers(b);
    const pos = b.mesh.position;

    // 1. Velocity vector arrow
    if (CONFIG.overlayVelocity && b.velocity.length() > 0.05) {
      b._velArrow.visible = true;
      b._velArrow.position.copy(pos);
      b._velArrow.setDirection(b.velocity.clone().normalize());
      b._velArrow.setLength(Math.min(b.velocity.length() * 1.3 + 1, 70), 1.6, 0.8);
    } else {
      b._velArrow.visible = false;
    }

    // 2. Acceleration vector arrow
    const acc = b.acceleration || new THREE.Vector3();
    const accLen = acc.length();
    if (CONFIG.overlayAccel && accLen > 0.0005) {
      b._accArrow.visible = true;
      b._accArrow.position.copy(pos);
      b._accArrow.setDirection(acc.clone().normalize());
      b._accArrow.setLength(Math.min(accLen * 45 + 1, 70), 1.6, 0.8);
    } else {
      b._accArrow.visible = false;
    }

    // 3. Net force vector arrow (F = m * a)
    if (CONFIG.overlayForce && accLen > 0.0005) {
      const force = accLen * b.mass;
      b._forceArrow.visible = true;
      b._forceArrow.position.copy(pos);
      b._forceArrow.setDirection(acc.clone().normalize());
      b._forceArrow.setLength(THREE.MathUtils.clamp(Math.log10(force + 1) * 16, 2, 80), 1.6, 0.8);
    } else {
      b._forceArrow.visible = false;
    }

    // 4. Frame-dragging acceleration vector arrow (Lense-Thirring)
    if (CONFIG.overlayFrameDrag && b.velocity && b.type !== 'blackhole') {
      computeLenseThirringAcceleration(b.mesh.position, b.velocity, b, state.bodies, _scratchLTOverlay);
      const ltLen = _scratchLTOverlay.length();
      if (ltLen > 0.0001) {
        b._frameDragArrow.visible = true;
        b._frameDragArrow.position.copy(pos);
        b._frameDragArrow.setDirection(_scratchLTOverlay.clone().normalize());
        b._frameDragArrow.setLength(Math.min(ltLen * 60 + 1, 70), 1.6, 0.8);
      } else {
        b._frameDragArrow.visible = false;
      }
    } else if (b._frameDragArrow) {
      b._frameDragArrow.visible = false;
    }

    // 5. Collision boundary wireframe
    if (CONFIG.overlayCollision && b.type !== 'blackhole') {
      b._collisionSphere.visible = true;
      b._collisionSphere.position.copy(pos);
      b._collisionSphere.scale.setScalar(b.radius * 0.85);
    } else {
      b._collisionSphere.visible = false;
    }
  }

  // System Center of Mass calculation: R_com = sum(m_i * r_i) / sum(m_i)
  if (active && CONFIG.overlayCOM && state.bodies.length) {
    let totalMass = 0;
    const com = new THREE.Vector3();
    for (const b of state.bodies) {
      com.addScaledVector(b.mesh.position, b.mass);
      totalMass += b.mass;
    }
    if (totalMass > 0) com.divideScalar(totalMass);
    comMarker.visible = true;
    comMarker.position.copy(com);
  } else {
    comMarker.visible = false;
  }

  // Motion trails visibility toggle
  const showPaths = CONFIG.trailsEnabled && (!active || CONFIG.overlayPaths);
  for (const b of state.bodies) {
    if (b.trail) b.trail.line.visible = showPaths;
  }
}

/* ============================================================================
   OBJECT BROWSER HIERARCHY TREE
   ============================================================================ */

const BROWSER_LABELS = {
  blackhole: 'BLACK HOLES',
  star: 'STARS',
  planet: 'PLANETS',
  moon: 'MOONS',
  comet: 'COMETS',
  neutron: 'NEUTRON STARS',
};

/**
 * Reconstructs the DOM listing of all celestial bodies categorized by taxonomic type.
 */
export function refreshObjectBrowser() {
  document.getElementById('browser-count').textContent = state.bodies.length
    ? `(${state.bodies.length})`
    : '';

  if (state.browserCollapsed) return;

  const groups = { blackhole: [], star: [], planet: [], moon: [], comet: [], neutron: [] };
  for (const b of state.bodies) {
    if (groups[b.type]) groups[b.type].push(b);
  }

  let html = '';
  for (const key of ['blackhole', 'star', 'planet', 'moon', 'comet', 'neutron']) {
    const list = groups[key];
    if (!list.length) continue;
    html += `<div class="browser-group">${BROWSER_LABELS[key]} (${list.length})</div>`;
    for (const b of list) {
      html += `<div class="browser-item" data-id="${b.id}">${b.name}</div>`;
    }
  }
  document.getElementById('browser-body').innerHTML =
    html || '<div class="browser-empty">No objects yet — try Generate New Universe.</div>';
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

/* ============================================================================
   CONTROL DECK EVENT BINDINGS & TIME CONTROLS
   ============================================================================ */

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

/**
 * Helper to bind HTML slider input events to CONFIG mutations and value display elements.
 */
function bindSlider(id, cb) {
  const el = document.getElementById(id);
  el.addEventListener('input', () => cb(+el.value));
}

bindSlider('slider-mass', (v) => {
  CONFIG.blackHoleMass = v;
  const primary = dominantBlackHole();
  if (primary) primary.mass = v;
  document.getElementById('val-mass').textContent = v;
});

bindSlider('slider-g', (v) => {
  CONFIG.G = v;
  document.getElementById('val-g').textContent = v.toFixed(2);
});

bindSlider('slider-asteroids', (v) => {
  document.getElementById('val-asteroids').textContent = v;
  initAsteroids(v);
});

bindSlider('slider-disk', (v) => {
  CONFIG.diskBrightness = v;
  for (const bh of blackHoles()) bh.diskMat.uniforms.uBrightness.value = v;
  document.getElementById('val-disk').textContent = v.toFixed(2);
});

bindSlider('slider-lens', (v) => {
  CONFIG.lensStrength = v;
  document.getElementById('val-lens').textContent = v.toFixed(2);
});

bindSlider('slider-substep', (v) => {
  CONFIG.maxSubstep = v;
  document.getElementById('val-substep').textContent = v.toFixed(2);
});

bindSlider('slider-traillen', (v) => {
  document.getElementById('val-traillen').textContent = v;
  resizeAllTrails(Math.round(v));
});

document.getElementById('btn-trails-toggle').addEventListener('click', () => {
  CONFIG.trailsEnabled = !CONFIG.trailsEnabled;
  const btn = document.getElementById('btn-trails-toggle');
  btn.textContent = CONFIG.trailsEnabled ? '\u25cf TRAILS: ON' : '\u25cb TRAILS: OFF';
  btn.classList.toggle('off', !CONFIG.trailsEnabled);
});

document.getElementById('btn-follow').addEventListener('click', () => {
  if (!state.selected || state.selected.isAsteroid) return;
  if (state.cameraMode === 'follow' && state.followTarget === state.selected) {
    setCameraMode('free');
    state.followTarget = null;
    return;
  }
  state.followTarget = state.selected;
  setCameraMode('follow');
});

document.getElementById('btn-orbit').addEventListener('click', () => {
  if (!state.selected || state.selected.isAsteroid) return;
  if (state.cameraMode === 'orbit' && state.followTarget === state.selected) {
    setCameraMode('free');
    state.followTarget = null;
    return;
  }
  state.followTarget = state.selected;
  setCameraMode('orbit');
});

document.getElementById('btn-return').addEventListener('click', () => {
  state.followTarget = null;
  setCameraMode('free');
  const primary = dominantBlackHole();
  if (primary) {
    flyCameraTo(primary.mesh.position, Math.max(primary.visualRadius * 14, 160), 1400);
  }
  updateBreadcrumb(['UNIVERSE']);
});

document.getElementById('btn-help').addEventListener('click', () => {
  document.getElementById('help-modal').classList.remove('hidden');
});

document.getElementById('btn-help-close').addEventListener('click', () => {
  document.getElementById('help-modal').classList.add('hidden');
});

document.getElementById('btn-gravity-toggle').addEventListener('click', () => {
  CONFIG.gravityEnabled = !CONFIG.gravityEnabled;
  const btn = document.getElementById('btn-gravity-toggle');
  btn.textContent = CONFIG.gravityEnabled ? '\u25cf GRAVITY: ON' : '\u25cb GRAVITY: OFF';
  btn.classList.toggle('off', !CONFIG.gravityEnabled);
  logEvent(`Gravity simulation ${CONFIG.gravityEnabled ? 'enabled' : 'disabled'}.`, 'info');
});

document.getElementById('btn-framedrag-toggle').addEventListener('click', () => {
  CONFIG.frameDragging = !CONFIG.frameDragging;
  const btn = document.getElementById('btn-framedrag-toggle');
  btn.textContent = CONFIG.frameDragging ? '\u25cf FRAME DRAGGING: ON' : '\u25cb FRAME DRAGGING: OFF';
  btn.classList.toggle('off', !CONFIG.frameDragging);
  logEvent(`Frame-dragging simulation ${CONFIG.frameDragging ? 'enabled' : 'disabled'}.`, 'info');
});

document.getElementById('btn-timedilation-toggle').addEventListener('click', () => {
  CONFIG.timeDilationEnabled = !CONFIG.timeDilationEnabled;
  const btn = document.getElementById('btn-timedilation-toggle');
  btn.textContent = CONFIG.timeDilationEnabled ? '\u25cf TIME DILATION: ON' : '\u25cb TIME DILATION: OFF';
  btn.classList.toggle('off', !CONFIG.timeDilationEnabled);
  logEvent(`Relativistic time dilation ${CONFIG.timeDilationEnabled ? 'enabled' : 'disabled'}.`, 'info');
});

document.getElementById('btn-lensing-toggle').addEventListener('click', () => {
  CONFIG.lensingEnabled = !CONFIG.lensingEnabled;
  const btn = document.getElementById('btn-lensing-toggle');
  btn.textContent = CONFIG.lensingEnabled ? '\u25cf GRAVITATIONAL LENSING: ON' : '\u25cb GRAVITATIONAL LENSING: OFF';
  btn.classList.toggle('off', !CONFIG.lensingEnabled);
  logEvent(`Gravitational lensing ${CONFIG.lensingEnabled ? 'enabled' : 'disabled'}.`, 'info');
});

document.getElementById('btn-debug').addEventListener('click', () => {
  CONFIG.debugMode = !CONFIG.debugMode;
  document.getElementById('debug-hud').classList.toggle('hidden', !CONFIG.debugMode);
});

const OVERLAY_CHECKBOXES = {
  'ov-velocity': 'overlayVelocity',
  'ov-force': 'overlayForce',
  'ov-accel': 'overlayAccel',
  'ov-framedrag': 'overlayFrameDrag',
  'ov-paths': 'overlayPaths',
  'ov-com': 'overlayCOM',
  'ov-collision': 'overlayCollision',
};

for (const [id, key] of Object.entries(OVERLAY_CHECKBOXES)) {
  const el = document.getElementById(id);
  if (!el) continue;
  el.checked = CONFIG[key];
  el.addEventListener('change', () => {
    CONFIG[key] = el.checked;
  });
}

/* ============================================================================
   CONFIG-TO-UI STATE SYNCHRONIZATION
   ============================================================================ */

/**
 * Synchronizes all on-screen control values (sliders, toggles, checkboxes)
 * with the underlying CONFIG parameters. Invoked after loading save files.
 */
export function syncUIFromConfig() {
  const setSlider = (id, valId, v, digits) => {
    const el = document.getElementById(id);
    const valEl = document.getElementById(valId);
    if (el) el.value = v;
    if (valEl) valEl.textContent = digits === 0 ? v : v.toFixed(digits);
  };

  setSlider('slider-mass', 'val-mass', CONFIG.blackHoleMass, 0);
  setSlider('slider-g', 'val-g', CONFIG.G, 2);
  setSlider('slider-asteroids', 'val-asteroids', CONFIG.asteroidCount, 0);
  setSlider('slider-disk', 'val-disk', CONFIG.diskBrightness, 2);
  setSlider('slider-lens', 'val-lens', CONFIG.lensStrength, 2);
  setSlider('slider-substep', 'val-substep', CONFIG.maxSubstep, 2);
  setSlider('slider-traillen', 'val-traillen', CONFIG.trailLength, 0);

  const gravBtn = document.getElementById('btn-gravity-toggle');
  if (gravBtn) {
    gravBtn.textContent = CONFIG.gravityEnabled ? '\u25cf GRAVITY: ON' : '\u25cb GRAVITY: OFF';
    gravBtn.classList.toggle('off', !CONFIG.gravityEnabled);
  }

  const fdBtn = document.getElementById('btn-framedrag-toggle');
  if (fdBtn) {
    fdBtn.textContent = CONFIG.frameDragging ? '\u25cf FRAME DRAGGING: ON' : '\u25cb FRAME DRAGGING: OFF';
    fdBtn.classList.toggle('off', !CONFIG.frameDragging);
  }

  const tdBtn = document.getElementById('btn-timedilation-toggle');
  if (tdBtn) {
    tdBtn.textContent = CONFIG.timeDilationEnabled ? '\u25cf TIME DILATION: ON' : '\u25cb TIME DILATION: OFF';
    tdBtn.classList.toggle('off', !CONFIG.timeDilationEnabled);
  }

  const lensBtn = document.getElementById('btn-lensing-toggle');
  if (lensBtn) {
    lensBtn.textContent = CONFIG.lensingEnabled ? '\u25cf GRAVITATIONAL LENSING: ON' : '\u25cb GRAVITATIONAL LENSING: OFF';
    lensBtn.classList.toggle('off', !CONFIG.lensingEnabled);
  }

  const trailBtn = document.getElementById('btn-trails-toggle');
  if (trailBtn) {
    trailBtn.textContent = CONFIG.trailsEnabled ? '\u25cf TRAILS: ON' : '\u25cb TRAILS: OFF';
    trailBtn.classList.toggle('off', !CONFIG.trailsEnabled);
  }

  const debugHud = document.getElementById('debug-hud');
  if (debugHud) debugHud.classList.toggle('hidden', !CONFIG.debugMode);

  for (const [id, key] of Object.entries(OVERLAY_CHECKBOXES)) {
    const el = document.getElementById(id);
    if (el) el.checked = CONFIG[key];
  }
}