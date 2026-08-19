/**
 * @file creation.js
 * @description Interactive entity spawning, drag-to-launch velocity aiming, and context menu dispatch.
 *
 * Implements:
 * 1. Unified mouse and touch pointer event handling (disambiguates tap selection from drag gestures).
 * 2. Unprojection from 2D screen coordinates onto the 3D XZ ecliptic plane (y = 0).
 * 3. Interactive drag-to-aim launch targeting with real-time forward-integrated trajectory previews.
 * 4. Automatic Keplerian circular orbit calculations when spawning without a manual drag vector.
 * 5. Radial context menu and creation panel parameter bindings.
 */

import * as THREE from 'three';
import { CONFIG, state, VELOCITY_DRAG_SCALE, BH_MASS_CLASSES } from './state.js';
import { scene, camera, controls, renderer } from './scene.js';
import { raycaster, pointerNDC, handleClick, fillPredictedPath } from './selection.js';
import {
  orbitalVelocity,
  findDominantAttractor,
  randomName,
  createStar,
  createPlanet,
  createMoon,
  createComet,
  createBlackHole,
} from './objects.js';
import { spawnAsteroid } from './asteroids.js';
import { logEvent, showBanner } from './events.js';

/* ============================================================================
   POINTER INPUT AND GESTURE DISAMBIGUATION
   ============================================================================ */

let pointerDownPos = null;
let pointerDownTime = 0;
let longPressTimer = null;

/**
 * Normalizes mouse and touch events to screen pixel coordinates and WebGL NDC coordinates.
 *
 * @param {MouseEvent|TouchEvent} e - Input event.
 * @returns {{ x: number, y: number }} Viewport pixel coordinates.
 */
function getPointer(e) {
  const t = (e.touches && e.touches[0]) || e;
  pointerNDC.x = (t.clientX / window.innerWidth) * 2 - 1;
  pointerNDC.y = -(t.clientY / window.innerHeight) * 2 + 1;
  return { x: t.clientX, y: t.clientY };
}

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.button === 2) return; // Right-click handled by contextmenu listener
  const p = getPointer(e);
  if (state.placement) {
    beginPlacementDrag(p);
    return;
  }
  pointerDownPos = p;
  pointerDownTime = performance.now();

  // Long-press gesture for mobile context menu
  if (e.pointerType === 'touch') {
    clearTimeout(longPressTimer);
    longPressTimer = setTimeout(() => openContextMenu(p.x, p.y), 550);
  }
});

renderer.domElement.addEventListener('pointermove', (e) => {
  const t = (e.touches && e.touches[0]) || e;
  if (state.placement) {
    updatePlacementPointer(t.clientX, t.clientY);
    return;
  }
  if (!pointerDownPos) return;
  const dx = t.clientX - pointerDownPos.x;
  const dy = t.clientY - pointerDownPos.y;
  if (Math.hypot(dx, dy) > 8) clearTimeout(longPressTimer);
});

renderer.domElement.addEventListener('pointerup', (e) => {
  clearTimeout(longPressTimer);
  if (state.placement) {
    const p = getPointer(e);
    endPlacementDrag(p);
    return;
  }
  if (e.button === 2 || !pointerDownPos) return;
  const p = getPointer(e);
  const dx = p.x - pointerDownPos.x;
  const dy = p.y - pointerDownPos.y;
  const dt = performance.now() - pointerDownTime;
  pointerDownPos = null;

  // Short tap without significant drag displacement qualifies as a click
  if (Math.hypot(dx, dy) < 8 && dt < 450) handleClick();
});

/* ============================================================================
   SCREEN-TO-WORLD UNPROJECTION & PLACEMENT VISUALS
   ============================================================================ */

const ctxMenu = document.getElementById('context-menu');
const placementPanel = document.getElementById('placement-panel');
const spawnPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0); // Ecliptic plane at y = 0

let ghostMarker = null;

/**
 * Returns or instantiates the wireframe positioning marker for the spawn cursor.
 * @returns {THREE.Mesh}
 */
function getGhostMarker() {
  if (!ghostMarker) {
    ghostMarker = new THREE.Mesh(
      new THREE.IcosahedronGeometry(2, 0),
      new THREE.MeshBasicMaterial({
        color: 0x7fd9ff,
        wireframe: true,
        transparent: true,
        opacity: 0.7,
      })
    );
    ghostMarker.visible = false;
    state.ghostMarker = ghostMarker;
    scene.add(ghostMarker);
  }
  return ghostMarker;
}

const dragArrow = new THREE.ArrowHelper(
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(),
  1,
  0x7fd9ff,
  3,
  1.6
);
dragArrow.visible = false;
scene.add(dragArrow);

const dragPredictGeo = new THREE.BufferGeometry();
const dragPredictPositions = new Float32Array(80 * 3);
dragPredictGeo.setAttribute('position', new THREE.BufferAttribute(dragPredictPositions, 3));
const dragPredictLine = new THREE.Line(
  dragPredictGeo,
  new THREE.LineBasicMaterial({
    color: 0x9be8ff,
    transparent: true,
    opacity: 0.75,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
);
dragPredictLine.visible = false;
scene.add(dragPredictLine);

/**
 * Projects 2D screen coordinates onto the 3D XZ ecliptic plane (y = 0).
 *
 * @param {number} x - Client X coordinate.
 * @param {number} y - Client Y coordinate.
 * @returns {THREE.Vector3} World-space intersection coordinate.
 */
function worldPointFromScreen(x, y) {
  pointerNDC.x = (x / window.innerWidth) * 2 - 1;
  pointerNDC.y = -(y / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointerNDC, camera);
  const out = new THREE.Vector3();
  raycaster.ray.intersectPlane(spawnPlane, out);
  return out;
}

/* Context menu open / close handlers */
function openContextMenu(x, y) {
  ctxMenu.style.left = Math.min(x, window.innerWidth - 210) + 'px';
  ctxMenu.style.top = Math.min(y, window.innerHeight - 200) + 'px';
  ctxMenu.classList.remove('hidden');
}

function closeContextMenu() {
  ctxMenu.classList.add('hidden');
}

renderer.domElement.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (!state.placement) openContextMenu(e.clientX, e.clientY);
});

document.getElementById('btn-create').addEventListener('click', (e) => {
  const r = e.target.getBoundingClientRect();
  openContextMenu(r.right + 8, r.top);
});

document.addEventListener('pointerdown', (e) => {
  if (!ctxMenu.contains(e.target) && !ctxMenu.classList.contains('hidden')) {
    closeContextMenu();
  }
});

ctxMenu.querySelectorAll('.ctx-item').forEach((item) => {
  item.addEventListener('click', () => {
    startPlacement(item.dataset.type);
    closeContextMenu();
  });
});

/* ============================================================================
   PLACEMENT LIFECYCLE & DRAG-TO-LAUNCH INTEGRATION
   ============================================================================ */

/**
 * Enters placement mode for a specific celestial body classification.
 *
 * @param {string} type - Body type to spawn.
 */
function startPlacement(type) {
  let parentBody = null;
  if (type === 'moon') {
    if (!state.selected || state.selected.type !== 'planet') {
      showBanner('SELECT A PLANET FIRST');
      logEvent('Moon creation requires a selected planet to orbit.', 'info');
      return;
    }
    parentBody = state.selected;
  }

  state.placement = { type, parentBody, dragging: false, dragStart: null };
  controls.enabled = true;

  document.getElementById('placement-title').textContent =
    'PLACING ' + type.toUpperCase() + (parentBody ? ` (ORBITS ${parentBody.name})` : '');
  document.getElementById('input-p-name').value = randomName(type);

  const isBH = type === 'blackhole';
  document.getElementById('row-p-bhclass').classList.toggle('hidden', !isBH);
  document.getElementById('row-p-spin').classList.toggle('hidden', !isBH);
  document.getElementById('row-p-size').classList.toggle('hidden', isBH);
  document.getElementById('row-p-temp').classList.toggle('hidden', type !== 'star');

  const massSlider = document.getElementById('slider-p-mass');
  const massVal = document.getElementById('val-p-mass');
  if (isBH) {
    const cls = document.getElementById('select-p-bhclass').value || 'supermassive';
    const cfg = BH_MASS_CLASSES[cls] || BH_MASS_CLASSES.supermassive;
    massSlider.min = cfg.massRange[0];
    massSlider.max = cfg.massRange[1];
    massSlider.step = cfg.massRange[0] < 1 ? '0.1' : (cfg.massRange[1] > 1000 ? '50' : '1');
    massSlider.value = cfg.defaultMass;
    massVal.textContent = cfg.defaultMass.toFixed(1);

    const spinSlider = document.getElementById('slider-p-spin');
    spinSlider.value = cfg.defaultSpin;
    document.getElementById('val-p-spin').textContent =
      (cfg.defaultSpin >= 0 ? '+' : '') + cfg.defaultSpin.toFixed(2);
  } else {
    massSlider.min = '0.1';
    massSlider.max = '500';
    massSlider.step = '0.1';
    massSlider.value = '10';
    massVal.textContent = '10.0';
  }

  placementPanel.classList.remove('hidden');
  getGhostMarker().visible = true;
}

/**
 * Aborts placement mode and resets visual indicators.
 */
function cancelPlacement() {
  state.placement = null;
  placementPanel.classList.add('hidden');
  if (ghostMarker) ghostMarker.visible = false;
  dragArrow.visible = false;
  dragPredictLine.visible = false;
  controls.enabled = true;
}

document.getElementById('btn-p-cancel').addEventListener('click', cancelPlacement);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.placement) cancelPlacement();
});

const bhClassSelect = document.getElementById('select-p-bhclass');
if (bhClassSelect) {
  bhClassSelect.addEventListener('change', () => {
    if (!state.placement || state.placement.type !== 'blackhole') return;
    const cls = bhClassSelect.value;
    const cfg = BH_MASS_CLASSES[cls];
    if (!cfg) return;
    const massSlider = document.getElementById('slider-p-mass');
    massSlider.min = cfg.massRange[0];
    massSlider.max = cfg.massRange[1];
    massSlider.step = cfg.massRange[0] < 1 ? '0.1' : (cfg.massRange[1] > 1000 ? '50' : '1');
    massSlider.value = cfg.defaultMass;
    document.getElementById('val-p-mass').textContent = cfg.defaultMass.toFixed(1);

    const spinSlider = document.getElementById('slider-p-spin');
    spinSlider.value = cfg.defaultSpin;
    document.getElementById('val-p-spin').textContent =
      (cfg.defaultSpin >= 0 ? '+' : '') + cfg.defaultSpin.toFixed(2);
  });
}

/**
 * Updates placement visuals while moving or dragging across the viewport.
 *
 * @param {number} x - Client X coordinate.
 * @param {number} y - Client Y coordinate.
 */
function updatePlacementPointer(x, y) {
  const pt = worldPointFromScreen(x, y);

  if (!state.placement.dragging) {
    getGhostMarker().position.copy(pt);
  } else {
    const drag = pt.clone().sub(state.placement.dragStart);
    dragArrow.position.copy(state.placement.dragStart);

    if (drag.length() > 0.4) {
      dragArrow.visible = true;
      dragArrow.setDirection(drag.clone().normalize());
      dragArrow.setLength(Math.min(drag.length(), 220), 3, 1.6);

      let previewVel;
      if (state.placement.type === 'moon' && state.placement.parentBody) {
        previewVel = drag
          .clone()
          .multiplyScalar(VELOCITY_DRAG_SCALE)
          .add(state.placement.parentBody.velocity);
      } else {
        previewVel = drag.clone().multiplyScalar(VELOCITY_DRAG_SCALE);
      }

      fillPredictedPath(dragPredictGeo, state.placement.dragStart, previewVel);
      dragPredictLine.visible = true;
    } else {
      dragArrow.visible = false;
      dragPredictLine.visible = false;
    }

    ghostMarker.position.copy(state.placement.dragStart);
  }
}

/**
 * Begins drag-to-aim launch vector definition.
 *
 * @param {{ x: number, y: number }} p - Start pointer screen coordinates.
 */
function beginPlacementDrag(p) {
  state.placement.dragging = true;
  state.placement.dragStart = worldPointFromScreen(p.x, p.y);
  controls.enabled = false; // Suspend camera rotation during drag-aim
}

/**
 * Finalizes placement drag gesture, computes launch velocity vector, and spawns entity.
 *
 * @param {{ x: number, y: number }} p - End pointer screen coordinates.
 */
function endPlacementDrag(p) {
  if (!state.placement || !state.placement.dragging) return;
  const endPt = worldPointFromScreen(p.x, p.y);
  const dragStart = state.placement.dragStart;
  const dragVec = endPt.clone().sub(dragStart);

  const name = document.getElementById('input-p-name').value.trim() || randomName(state.placement.type);
  const mass = +document.getElementById('slider-p-mass').value;
  const size = +document.getElementById('slider-p-size').value;
  const tempK = +document.getElementById('slider-p-temp').value;
  const bhClass = document.getElementById('select-p-bhclass')?.value || 'supermassive';
  const spin = +document.getElementById('slider-p-spin')?.value || 0;

  let velocity;
  if (state.placement.type === 'moon') {
    const parent = state.placement.parentBody;
    if (dragVec.length() > 2) {
      velocity = dragVec.clone().multiplyScalar(VELOCITY_DRAG_SCALE).add(parent.velocity);
    } else {
      velocity = orbitalVelocity(dragStart, parent.mesh.position, parent.mass, 1).add(parent.velocity);
    }
  } else if (dragVec.length() > 2) {
    velocity = dragVec.clone().multiplyScalar(VELOCITY_DRAG_SCALE);
  } else {
    // Zero/negligible drag: solve for a stable Keplerian circular orbit around the nearest attractor
    const dominant = findDominantAttractor(dragStart, null);
    velocity = dominant
      ? orbitalVelocity(dragStart, dominant.mesh.position, dominant.mass, 1).add(dominant.velocity)
      : new THREE.Vector3();
  }

  spawnFromPlacement(state.placement.type, dragStart, velocity, {
    name,
    mass,
    size,
    tempK,
    bhClass,
    spin,
    parentBody: state.placement.parentBody,
  });

  logEvent(`New ${state.placement.type} "${name}" deployed into the field.`, 'info', dragStart);
  cancelPlacement();
}

/**
 * Dispatches entity construction to the appropriate specialized factory function.
 */
function spawnFromPlacement(type, pos, vel, props) {
  switch (type) {
    case 'star':
      createStar({
        position: pos,
        velocity: vel,
        mass: props.mass,
        size: props.size,
        tempK: props.tempK,
        name: props.name,
      });
      break;
    case 'planet':
      createPlanet({
        position: pos,
        velocity: vel,
        mass: props.mass,
        size: props.size,
        name: props.name,
      });
      break;
    case 'moon':
      createMoon({
        position: pos,
        velocity: vel,
        mass: Math.min(props.mass, 30),
        size: Math.min(props.size, 1.5),
        name: props.name,
        parent: props.parentBody,
      });
      break;
    case 'comet':
      createComet({
        position: pos,
        velocity: vel,
        mass: Math.min(props.mass, 2),
        size: Math.min(props.size, 1.2),
        name: props.name,
      });
      break;
    case 'blackhole':
      createBlackHole({
        position: pos,
        velocity: vel,
        mass: props.mass,
        name: props.name,
        bhClass: props.bhClass || 'supermassive',
        spin: props.spin !== undefined ? props.spin : 0.85,
        spinDirection: new THREE.Vector3(0, (props.spin ?? 0) >= 0 ? 1 : -1, 0),
      });
      break;
    case 'asteroid': {
      const i = state.aPos.length ? Math.floor(Math.random() * state.aPos.length) : 0;
      spawnAsteroid(
        i,
        pos,
        vel,
        Math.max(props.mass * 0.15, 0.05),
        Math.max(props.size * 0.5, 0.2)
      );
      break;
    }
  }
}

/* UI feedback listeners for placement slider inputs */
['slider-p-mass', 'slider-p-size', 'slider-p-temp', 'slider-p-spin'].forEach((id) => {
  const el = document.getElementById(id);
  if (!el) return;
  const valId = 'val-' + id.replace('slider-', '');
  el.addEventListener('input', () => {
    const valEl = document.getElementById(valId);
    if (!valEl) return;
    if (id === 'slider-p-temp') {
      valEl.textContent = (+el.value).toFixed(0);
    } else if (id === 'slider-p-spin') {
      const v = +el.value;
      valEl.textContent = (v >= 0 ? '+' : '') + v.toFixed(2);
    } else {
      valEl.textContent = (+el.value).toFixed(1);
    }
  });
});
