import * as THREE from 'three';
import { CONFIG, state } from './state.js';
import { scene, camera } from './scene.js';
import { selectionRingTex } from './textures.js';
import { findDominantAttractor, nearestBlackHole, bhRadii } from './objects.js';
import { flyCameraTo, setCameraMode } from './camera.js';
import { logEvent, showBanner } from './events.js';
import { destroyObject } from './effects.js';

/* =========================================================================
   SELECTION VISUALS (shared, repositioned to whichever object is selected)
   ========================================================================= */
export const selectionRing = new THREE.Sprite(new THREE.SpriteMaterial({ map: selectionRingTex, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending }));
selectionRing.visible = false;
scene.add(selectionRing);

export const velocityArrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 1, 0xffe066, 2.2, 1.3);
velocityArrow.visible = false;
scene.add(velocityArrow);

export const influenceSphere = new THREE.Mesh(
  new THREE.SphereGeometry(1, 24, 16),
  new THREE.MeshBasicMaterial({ color: 0x7fd9ff, wireframe: true, transparent: true, opacity: 0.16, depthWrite: false })
);
influenceSphere.visible = false;
scene.add(influenceSphere);

// predicted trajectory (single reusable dashed line, approximated against the
// single strongest local attractor at each simulated step)
const predictGeo = new THREE.BufferGeometry();
const predictPositions = new Float32Array(80 * 3);
predictGeo.setAttribute('position', new THREE.BufferAttribute(predictPositions, 3));
export const predictLine = new THREE.Line(predictGeo, new THREE.LineDashedMaterial({ color: 0x7fd9ff, dashSize: 3, gapSize: 2, transparent: true, opacity: 0.65 }));
predictLine.visible = false;
scene.add(predictLine);

// shared forward-integration used by both the selection prediction line above
// and the drag-to-launch preview line in creation.js: a cheap "dominant
// single attractor" approximation, recomputed every step so it still bends
// correctly around whichever body currently matters most
export const PREDICT_STEPS = 80, PREDICT_DT = 0.6;
export function fillPredictedPath(geo, startPos, startVel) {
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
   SELECTION / RAYCASTING
   ========================================================================= */
const selectableMap = new Map();
export function registerSelectable(mesh, obj) { selectableMap.set(mesh.uuid, obj); }
export function unregisterSelectable(mesh) { selectableMap.delete(mesh.uuid); }

export const raycaster = new THREE.Raycaster();
export const pointerNDC = new THREE.Vector2();

export function handleClick() {
  raycaster.setFromCamera(pointerNDC, camera);
  const meshes = [...selectableMap.keys()].map((uuid) => scene.getObjectByProperty('uuid', uuid)).filter(Boolean);
  const hits = raycaster.intersectObjects(meshes, false);
  let asteroidHit = null;
  if (state.asteroidMesh) {
    const ahits = raycaster.intersectObject(state.asteroidMesh);
    if (ahits.length && (!hits.length || ahits[0].distance < hits[0].distance)) asteroidHit = ahits[0];
  }
  if (asteroidHit && !hits.length) { selectAsteroid(asteroidHit.instanceId); return; }
  if (hits.length === 0) { deselect(); return; }
  const obj = selectableMap.get(hits[0].object.uuid);
  if (obj) select(obj);
}

export function updateBreadcrumb(parts) {
  document.getElementById('breadcrumb-bar').textContent = parts.join(' \u203a ');
}
export function breadcrumbChainFor(obj) {
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

export function select(obj) {
  if (state.selected && state.selected.trail) state.selected.trail.line.material.opacity = state.selected.trail.baseOpacity;
  state.selected = obj;
  if (obj.trail) obj.trail.line.material.opacity = Math.min(0.9, obj.trail.baseOpacity * 2.2);
  document.getElementById('info-panel').classList.remove('hidden');
  document.getElementById('btn-follow').disabled = false;
  document.getElementById('btn-orbit').disabled = false;
  document.getElementById('btn-delete-obj').classList.toggle('hidden', obj.type === 'blackhole');
  document.getElementById('btn-enter-system').classList.toggle('hidden', obj.type !== 'star');
  predictLine.visible = obj.type !== 'blackhole';
  updateBreadcrumb(breadcrumbChainFor(obj));
}
export function selectAsteroid(instanceId) {
  if (state.selected && state.selected.trail) state.selected.trail.line.material.opacity = state.selected.trail.baseOpacity;
  state.selected = { type: 'asteroid', name: `AST-${instanceId}`, isAsteroid: true, index: instanceId };
  document.getElementById('info-panel').classList.remove('hidden');
  document.getElementById('btn-follow').disabled = true;
  document.getElementById('btn-orbit').disabled = true;
  document.getElementById('btn-delete-obj').classList.add('hidden');
  document.getElementById('btn-enter-system').classList.add('hidden');
  predictLine.visible = false;
  const dom = findDominantAttractor(state.aPos[instanceId], null);
  updateBreadcrumb(dom ? [...breadcrumbChainFor(dom), state.selected.name] : ['UNIVERSE', state.selected.name]);
}
export function deselect() {
  if (state.selected && state.selected.trail) state.selected.trail.line.material.opacity = state.selected.trail.baseOpacity;
  state.selected = null;
  document.getElementById('info-panel').classList.add('hidden');
  document.getElementById('btn-follow').disabled = true;
  document.getElementById('btn-orbit').disabled = true;
  document.getElementById('btn-enter-system').classList.add('hidden');
  predictLine.visible = false;
  selectionRing.visible = velocityArrow.visible = influenceSphere.visible = false;
  updateBreadcrumb(['UNIVERSE']);
}
document.getElementById('btn-delete-obj').addEventListener('click', () => {
  if (state.selected && !state.selected.isAsteroid && state.selected.type !== 'blackhole') destroyObject(state.selected, 'removed', true);
  deselect();
});
document.getElementById('btn-enter-system').addEventListener('click', () => {
  if (!state.selected || state.selected.type !== 'star') return;
  const star = state.selected;
  const members = state.bodies.filter((b) => b !== star && findDominantAttractor(b.mesh.position, b) === star);
  let radius = 35;
  for (const m of members) radius = Math.max(radius, m.mesh.position.distanceTo(star.mesh.position) + m.radius * 3);
  flyCameraTo(star.mesh.position, radius * 1.5 + 30, 1400);
  state.followTarget = star;
  setCameraMode('follow');
  logEvent(`Entering the ${star.name} system.`, 'info', star.mesh.position);
});

/* =========================================================================
   INFO PANEL
   ========================================================================= */
export function hillRadius(obj) {
  const dom = findDominantAttractor(obj.mesh.position, obj);
  if (!dom) return null;
  const r = obj.mesh.position.distanceTo(dom.mesh.position);
  const hr = r * Math.cbrt(obj.mass / (3 * Math.max(dom.mass, 0.01)));
  return { hr, dom };
}

export function updateInfoPanel() {
  const selected = state.selected;
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
    if (!state.aAlive[i]) { deselect(); return; }
    const r = state.aPos[i].length();
    const dom = findDominantAttractor(state.aPos[i], null);
    $('info-name').textContent = selected.name;
    $('info-type').textContent = 'ASTEROID';
    $('info-parent').textContent = dom ? dom.name : '—';
    $('info-mass').textContent = state.aMass[i].toFixed(2) + ' Mt';
    $('info-distance').textContent = (r / 10).toFixed(2) + ' AU';
    $('info-velocity').textContent = (state.aVel[i].length() / 60).toFixed(2) + 'c';
    const { bh } = nearestBlackHole(state.aPos[i]);
    const tidal = bh ? r < bhRadii(bh).tidal : false;
    $('info-orbit').textContent = tidal ? 'UNSTABLE' : 'STABLE';
    $('info-temp').textContent = '—';
    $('info-age').textContent = '—';
    $('info-lifecycle').textContent = '—';
    $('info-tidal').textContent = tidal ? 'ELEVATED' : 'NOMINAL';
    $('info-influence').textContent = '—';
    $('info-status').textContent = 'TRACKED';
    positionSelectionVisuals(state.aPos[i], state.aVel[i], state.aRadius[i] * 3.5, null);
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

export function positionSelectionVisuals(pos, vel, ringScale, hs) {
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
