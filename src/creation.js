import * as THREE from 'three';
import { CONFIG, state, VELOCITY_DRAG_SCALE } from './state.js';
import { scene, camera, controls, renderer } from './scene.js';
import { raycaster, pointerNDC, handleClick, fillPredictedPath } from './selection.js';
import { orbitalVelocity, findDominantAttractor, randomName, createStar, createPlanet, createMoon, createComet, createBlackHole } from './objects.js';
import { spawnAsteroid } from './asteroids.js';
import { logEvent, showBanner } from './events.js';

/* =========================================================================
   POINTER HANDLING — shared entry point for both "click to select" and
   "click-drag to place a new object"; placement mode always takes priority
   when active.
   ========================================================================= */
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
  if (state.placement) { beginPlacementDrag(p); return; }
  pointerDownPos = p; pointerDownTime = performance.now();
  if (e.pointerType === 'touch') {
    clearTimeout(longPressTimer);
    longPressTimer = setTimeout(() => openContextMenu(p.x, p.y), 550);
  }
});
renderer.domElement.addEventListener('pointermove', (e) => {
  const t = (e.touches && e.touches[0]) || e;
  if (state.placement) { updatePlacementPointer(t.clientX, t.clientY); return; }
  if (!pointerDownPos) return;
  const dx = t.clientX - pointerDownPos.x, dy = t.clientY - pointerDownPos.y;
  if (Math.hypot(dx, dy) > 8) clearTimeout(longPressTimer);
});
renderer.domElement.addEventListener('pointerup', (e) => {
  clearTimeout(longPressTimer);
  if (state.placement) { const p = getPointer(e); endPlacementDrag(p); return; }
  if (e.button === 2 || !pointerDownPos) return;
  const p = getPointer(e);
  const dx = p.x - pointerDownPos.x, dy = p.y - pointerDownPos.y;
  const dt = performance.now() - pointerDownTime;
  pointerDownPos = null;
  if (Math.hypot(dx, dy) < 8 && dt < 450) handleClick();
});

/* =========================================================================
   CONTEXT MENU / CREATE-OBJECT BUTTON / DRAG-TO-LAUNCH PLACEMENT
   ========================================================================= */
const ctxMenu = document.getElementById('context-menu');
const placementPanel = document.getElementById('placement-panel');
const spawnPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

let ghostMarker = null;
function getGhostMarker() {
  if (!ghostMarker) {
    ghostMarker = new THREE.Mesh(
      new THREE.IcosahedronGeometry(2, 0),
      new THREE.MeshBasicMaterial({ color: 0x7fd9ff, wireframe: true, transparent: true, opacity: 0.7 })
    );
    ghostMarker.visible = false;
    state.ghostMarker = ghostMarker;
    scene.add(ghostMarker);
  }
  return ghostMarker;
}

const dragArrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 1, 0x7fd9ff, 3, 1.6);
dragArrow.visible = false;
scene.add(dragArrow);

const dragPredictGeo = new THREE.BufferGeometry();
const dragPredictPositions = new Float32Array(80 * 3);
dragPredictGeo.setAttribute('position', new THREE.BufferAttribute(dragPredictPositions, 3));
const dragPredictLine = new THREE.Line(dragPredictGeo, new THREE.LineBasicMaterial({ color: 0x9be8ff, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false }));
dragPredictLine.visible = false;
scene.add(dragPredictLine);

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

renderer.domElement.addEventListener('contextmenu', (e) => { e.preventDefault(); if (!state.placement) openContextMenu(e.clientX, e.clientY); });
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
    if (!state.selected || state.selected.type !== 'planet') {
      showBanner('SELECT A PLANET FIRST');
      logEvent('Moon creation requires a selected planet to orbit.', 'info');
      return;
    }
    parentBody = state.selected;
  }
  state.placement = { type, parentBody, dragging: false, dragStart: null };
  controls.enabled = true; // camera stays usable until the user actually starts dragging on empty space
  document.getElementById('placement-title').textContent = 'PLACING ' + type.toUpperCase() + (parentBody ? ` (ORBITS ${parentBody.name})` : '');
  document.getElementById('input-p-name').value = randomName(type);
  document.getElementById('row-p-temp').classList.toggle('hidden', type !== 'star');
  placementPanel.classList.remove('hidden');
  getGhostMarker().visible = true;
}
function cancelPlacement() {
  state.placement = null;
  placementPanel.classList.add('hidden');
  if (ghostMarker) ghostMarker.visible = false;
  dragArrow.visible = false;
  dragPredictLine.visible = false;
  controls.enabled = true;
}
document.getElementById('btn-p-cancel').addEventListener('click', cancelPlacement);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state.placement) cancelPlacement(); });

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
      if (state.placement.type === 'moon' && state.placement.parentBody) previewVel = drag.clone().multiplyScalar(VELOCITY_DRAG_SCALE).add(state.placement.parentBody.velocity);
      else previewVel = drag.clone().multiplyScalar(VELOCITY_DRAG_SCALE);
      fillPredictedPath(dragPredictGeo, state.placement.dragStart, previewVel);
      dragPredictLine.visible = true;
    } else { dragArrow.visible = false; dragPredictLine.visible = false; }
    ghostMarker.position.copy(state.placement.dragStart);
  }
}
function beginPlacementDrag(p) {
  state.placement.dragging = true;
  state.placement.dragStart = worldPointFromScreen(p.x, p.y);
  controls.enabled = false;
}
function endPlacementDrag(p) {
  if (!state.placement || !state.placement.dragging) return;
  const endPt = worldPointFromScreen(p.x, p.y);
  const dragStart = state.placement.dragStart;
  const dragVec = endPt.clone().sub(dragStart);
  const name = document.getElementById('input-p-name').value.trim() || randomName(state.placement.type);
  const mass = +document.getElementById('slider-p-mass').value;
  const size = +document.getElementById('slider-p-size').value;
  const tempK = +document.getElementById('slider-p-temp').value;

  let velocity;
  if (state.placement.type === 'moon') {
    const parent = state.placement.parentBody;
    if (dragVec.length() > 2) velocity = dragVec.clone().multiplyScalar(VELOCITY_DRAG_SCALE).add(parent.velocity);
    else velocity = orbitalVelocity(dragStart, parent.mesh.position, parent.mass, 1).add(parent.velocity);
  } else if (dragVec.length() > 2) {
    velocity = dragVec.clone().multiplyScalar(VELOCITY_DRAG_SCALE);
  } else {
    const dominant = findDominantAttractor(dragStart, null);
    velocity = dominant ? orbitalVelocity(dragStart, dominant.mesh.position, dominant.mass, 1).add(dominant.velocity) : new THREE.Vector3();
  }

  spawnFromPlacement(state.placement.type, dragStart, velocity, { name, mass, size, tempK, parentBody: state.placement.parentBody });
  logEvent(`New ${state.placement.type} "${name}" deployed into the field.`, 'info', dragStart);
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
      const i = state.aPos.length ? Math.floor(Math.random() * state.aPos.length) : 0;
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
