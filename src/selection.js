/**
 * @file selection.js
 * @description Raycasting object selection, Hill sphere calculations, trajectory prediction, and inspector telemetry.
 *
 * Implements:
 * 1. Screen-to-world raycasting for selecting massive bodies and instanced asteroids.
 * 2. Visual selection helpers (focus rings, velocity vector arrows, Hill sphere / gravitational influence envelopes).
 * 3. Forward-integrated numerical trajectory preview paths.
 * 4. Hierarchical breadcrumb navigation paths (Universe -> Black Hole -> Star -> Planet -> Moon).
 * 5. Comprehensive real-time astronomical telemetry panel updates.
 */

import * as THREE from 'three';
import { CONFIG, state, C_SIM, BH_MASS_CLASSES } from './state.js';
import { scene, camera } from './scene.js';
import { selectionRingTex } from './textures.js';
import { findDominantAttractor, nearestBlackHole, bhRadii, computeTimeDilation } from './objects.js';
import { flyCameraTo, setCameraMode } from './camera.js';
import { logEvent, showBanner } from './events.js';
import { destroyObject } from './effects.js';

/* ============================================================================
   SELECTION VISUAL HELPERS & TRAJECTORY PREDICTION
   ============================================================================ */

export const selectionRing = new THREE.Sprite(
  new THREE.SpriteMaterial({
    map: selectionRingTex,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  })
);
selectionRing.visible = false;
scene.add(selectionRing);

export const velocityArrow = new THREE.ArrowHelper(
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(),
  1,
  0xffe066,
  2.2,
  1.3
);
velocityArrow.visible = false;
scene.add(velocityArrow);

export const influenceSphere = new THREE.Mesh(
  new THREE.SphereGeometry(1, 24, 16),
  new THREE.MeshBasicMaterial({
    color: 0x7fd9ff,
    wireframe: true,
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
  })
);
influenceSphere.visible = false;
scene.add(influenceSphere);

const predictGeo = new THREE.BufferGeometry();
const predictPositions = new Float32Array(80 * 3);
predictGeo.setAttribute('position', new THREE.BufferAttribute(predictPositions, 3));
export const predictLine = new THREE.Line(
  predictGeo,
  new THREE.LineDashedMaterial({
    color: 0x7fd9ff,
    dashSize: 3,
    gapSize: 2,
    transparent: true,
    opacity: 0.65,
  })
);
predictLine.visible = false;
scene.add(predictLine);

export const PREDICT_STEPS = 80;
export const PREDICT_DT = 0.6;

/**
 * Forward-integrates an estimated orbital trajectory line from initial kinematic conditions.
 * Evaluates the dominant local gravitational attractor at each step to curve the line accurately.
 *
 * @param {THREE.BufferGeometry} geo - Buffer geometry holding the path positions.
 * @param {THREE.Vector3} startPos - Initial world position.
 * @param {THREE.Vector3} startVel - Initial velocity vector.
 */
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
    arr[i * 3] = p.x;
    arr[i * 3 + 1] = p.y;
    arr[i * 3 + 2] = p.z;

    const { bh: pbh, dist: pr } = nearestBlackHole(p);
    if (pbh && pr < bhRadii(pbh).capture) {
      for (let j = i + 1; j < PREDICT_STEPS; j++) {
        arr[j * 3] = p.x;
        arr[j * 3 + 1] = p.y;
        arr[j * 3 + 2] = p.z;
      }
      break;
    }
  }
  geo.attributes.position.needsUpdate = true;
  geo.computeBoundingSphere();
  geo.computeLineDistances();
}

/* ============================================================================
   RAYCASTING SELECTION & SPATIAL HIERARCHY
   ============================================================================ */

const selectableMap = new Map();

/**
 * Registers a mesh in the raycasting lookup map.
 * @param {THREE.Object3D} mesh - Interactive mesh.
 * @param {CelestialBody} obj - Associated celestial body instance.
 */
export function registerSelectable(mesh, obj) {
  selectableMap.set(mesh.uuid, obj);
}

/**
 * Removes a mesh from the raycasting lookup map.
 * @param {THREE.Object3D} mesh - Interactive mesh to unregister.
 */
export function unregisterSelectable(mesh) {
  selectableMap.delete(mesh.uuid);
}

export const raycaster = new THREE.Raycaster();
export const pointerNDC = new THREE.Vector2();

/**
 * Resolves mouse or touch clicks into scene selection intersections.
 */
export function handleClick() {
  raycaster.setFromCamera(pointerNDC, camera);
  const meshes = [...selectableMap.keys()]
    .map((uuid) => scene.getObjectByProperty('uuid', uuid))
    .filter(Boolean);

  const hits = raycaster.intersectObjects(meshes, false);
  let asteroidHit = null;

  if (state.asteroidMesh) {
    const ahits = raycaster.intersectObject(state.asteroidMesh);
    if (ahits.length && (!hits.length || ahits[0].distance < hits[0].distance)) {
      asteroidHit = ahits[0];
    }
  }

  if (asteroidHit && !hits.length) {
    selectAsteroid(asteroidHit.instanceId);
    return;
  }
  if (hits.length === 0) {
    deselect();
    return;
  }

  const obj = selectableMap.get(hits[0].object.uuid);
  if (obj) select(obj);
}

/**
 * Updates the topbar breadcrumb UI with hierarchical navigational segments.
 * @param {string[]} parts - Ordered breadcrumb segment titles.
 */
export function updateBreadcrumb(parts) {
  document.getElementById('breadcrumb-bar').textContent = parts.join(' \u203a ');
}

/**
 * Traces the gravitational attractor hierarchy upward from a body to the global origin.
 *
 * @param {CelestialBody} obj - Target celestial body.
 * @returns {string[]} Hierarchy chain array.
 */
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

/**
 * Focuses selection on a celestial body and activates inspector panels.
 * @param {CelestialBody} obj - Target celestial body.
 */
export function select(obj) {
  if (state.selected && state.selected.trail) {
    state.selected.trail.boosted = false;
    state.selected.trail.line.material.opacity = state.selected.trail.baseOpacity;
  }

  state.selected = obj;

  if (obj.trail) {
    obj.trail.boosted = true;
    obj.trail.line.material.opacity = Math.min(0.9, obj.trail.baseOpacity * 2.2);
  }

  document.getElementById('info-panel').classList.remove('hidden');
  document.getElementById('btn-follow').disabled = false;
  document.getElementById('btn-orbit').disabled = false;
  document.getElementById('btn-delete-obj').classList.toggle('hidden', obj.type === 'blackhole');
  document.getElementById('btn-enter-system').classList.toggle('hidden', obj.type !== 'star');
  predictLine.visible = obj.type !== 'blackhole';
  updateBreadcrumb(breadcrumbChainFor(obj));
}

/**
 * Focuses selection on an individual asteroid instance.
 * @param {number} instanceId - Index into the asteroid particle arrays.
 */
export function selectAsteroid(instanceId) {
  if (state.selected && state.selected.trail) {
    state.selected.trail.boosted = false;
    state.selected.trail.line.material.opacity = state.selected.trail.baseOpacity;
  }

  state.selected = {
    type: 'asteroid',
    name: `AST-${instanceId}`,
    isAsteroid: true,
    index: instanceId,
  };

  document.getElementById('info-panel').classList.remove('hidden');
  document.getElementById('btn-follow').disabled = true;
  document.getElementById('btn-orbit').disabled = true;
  document.getElementById('btn-delete-obj').classList.add('hidden');
  document.getElementById('btn-enter-system').classList.add('hidden');
  predictLine.visible = false;

  const dom = findDominantAttractor(state.aPos[instanceId], null);
  updateBreadcrumb(
    dom ? [...breadcrumbChainFor(dom), state.selected.name] : ['UNIVERSE', state.selected.name]
  );
}

/**
 * Clears current selection state and hides inspector visuals.
 */
export function deselect() {
  if (state.selected && state.selected.trail) {
    state.selected.trail.boosted = false;
    state.selected.trail.line.material.opacity = state.selected.trail.baseOpacity;
  }
  state.selected = null;
  document.getElementById('info-panel').classList.add('hidden');
  document.getElementById('btn-follow').disabled = true;
  document.getElementById('btn-orbit').disabled = true;
  document.getElementById('btn-enter-system').classList.add('hidden');
  predictLine.visible = false;
  selectionRing.visible = velocityArrow.visible = influenceSphere.visible = false;
  updateBreadcrumb(['UNIVERSE']);
}

/* Event bindings for selection action buttons */
document.getElementById('btn-delete-obj').addEventListener('click', () => {
  if (state.selected && !state.selected.isAsteroid && state.selected.type !== 'blackhole') {
    destroyObject(state.selected);
  }
  deselect();
});

document.getElementById('btn-enter-system').addEventListener('click', () => {
  if (!state.selected || state.selected.type !== 'star') return;
  const star = state.selected;
  const members = state.bodies.filter(
    (b) => b !== star && findDominantAttractor(b.mesh.position, b) === star
  );
  let radius = 35;
  for (const m of members) {
    radius = Math.max(radius, m.mesh.position.distanceTo(star.mesh.position) + m.radius * 3);
  }
  flyCameraTo(star.mesh.position, radius * 1.5 + 30, 1400);
  state.followTarget = star;
  setCameraMode('follow');
  logEvent(`Entering the ${star.name} system.`, 'info', star.mesh.position);
});

/* ============================================================================
   ASTRONOMICAL TELEMETRY & HILL SPHERE CALCULATIONS
   ============================================================================ */

/**
 * Computes the Hill sphere radius for a body in orbit around a dominant attractor:
 *   r_H = r * ( m / (3 * M_dom) )^(1/3)
 *
 * @param {CelestialBody} obj - Secondary body.
 * @returns {{ hr: number, dom: CelestialBody }|null} Hill radius in world units and attractor ref.
 */
export function hillRadius(obj) {
  const dom = findDominantAttractor(obj.mesh.position, obj);
  if (!dom) return null;
  const r = obj.mesh.position.distanceTo(dom.mesh.position);
  const hr = r * Math.cbrt(obj.mass / (3 * Math.max(dom.mass, 0.01)));
  return { hr, dom };
}

/**
 * Updates the right-deck inspector panel with real-time astronomical telemetry.
 */
export function updateInfoPanel() {
  const selected = state.selected;
  if (!selected) return;
  const $ = (id) => document.getElementById(id);

  if (selected.type === 'blackhole') {
    const bh = selected;
    const classLabel = (BH_MASS_CLASSES[bh.bhClass]?.label || 'BLACK HOLE SINGULARITY').toUpperCase();
    const spinVal = bh.spin ?? 0;
    const spinStr =
      Math.abs(spinVal) < 0.001
        ? 'SCHWARZSCHILD (a = 0.00)'
        : `KERR (a = ${spinVal >= 0 ? '+' : ''}${spinVal.toFixed(2)} ${spinVal >= 0 ? 'PROGRADE' : 'RETROGRADE'})`;

    const camDist = Math.max(bh.mesh.position.distanceTo(camera.position), 0.5);
    const rs = bh.schwarzschildRadius || (2 * CONFIG.G * bh.mass) / (C_SIM * C_SIM);
    const thetaE = Math.sqrt((2 * rs) / camDist);
    const thetaDeg = (thetaE * 180) / Math.PI;

    $('info-name').textContent = bh.name;
    $('info-type').textContent = classLabel;
    $('info-parent').textContent = bh.spinDirection
      ? `\u015c: (${bh.spinDirection.x.toFixed(1)}, ${bh.spinDirection.y.toFixed(1)}, ${bh.spinDirection.z.toFixed(1)})`
      : '—';
    $('info-mass').textContent = bh.mass.toLocaleString(undefined, { maximumFractionDigits: 1 }) + ' M☉';
    $('info-distance').textContent = (bh.mesh.position.length() / 10).toFixed(2) + ' AU';
    $('info-velocity').textContent = (bh.velocity.length() / C_SIM).toFixed(2) + 'c';
    $('info-orbit').textContent = spinStr;
    $('info-temp').textContent =
      bh.bhClass === 'primordial' ? 'HAWKING EMISSION' : bh.diskMat ? 'ACCRETION HEATED' : 'INACTIVE';
    $('info-age').textContent = Math.floor(bh.age).toLocaleString() + ' yrs';
    $('info-lifecycle').textContent = `r_s: ${(bh.schwarzschildRadius / 10).toFixed(2)} AU | r_H: ${(bh.kerrHorizonRadius / 10).toFixed(2)} AU`;
    $('info-tidal').textContent = 'EXTREME';
    $('info-influence').textContent = bh.angularMomentumSim !== undefined
      ? `J: ${Math.abs(bh.angularMomentumSim).toExponential(2)} | \u03b8_E: ${thetaDeg.toFixed(2)}\u00b0`
      : `\u03b8_E: ${thetaDeg.toFixed(2)}\u00b0`;
    const lensLabel = CONFIG.lensingEnabled ? `LENS: ACTIVE (${CONFIG.lensStrength.toFixed(1)}\u00d7)` : 'LENS: OFF';
    $('info-status').textContent =
      bh.rotationModel === 'kerr'
        ? `${CONFIG.frameDragging ? 'FRAME DRAG: ACTIVE' : 'FRAME DRAG: PAUSED'} | ${lensLabel}`
        : `STATIC | ${lensLabel}`;
    positionSelectionVisuals(bh.mesh.position, bh.velocity, bh.visualRadius * 2.6, null);
    return;
  }

  if (selected.isAsteroid) {
    const i = selected.index;
    if (!state.aAlive[i]) {
      deselect();
      return;
    }
    const r = state.aPos[i].length();
    const dom = findDominantAttractor(state.aPos[i], null);
    const dilation = computeTimeDilation(state.aPos[i], state.aVel[i], null);
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
    $('info-age').textContent = dilation < 0.999 ? `RATE: ${(dilation * 100).toFixed(1)}%` : 'RATE: 100%';
    $('info-lifecycle').textContent = '—';
    $('info-tidal').textContent = tidal ? 'ELEVATED' : 'NOMINAL';
    $('info-influence').textContent = '—';
    $('info-status').textContent = dilation < 0.999 ? `DILATED (${dilation.toFixed(3)}×)` : 'TRACKED';
    positionSelectionVisuals(state.aPos[i], state.aVel[i], state.aRadius[i] * 3.5, null);
    return;
  }

  const obj = selected;
  const r = obj.mesh.position.length();
  const speed = obj.velocity.length();
  const dom = findDominantAttractor(obj.mesh.position, obj);
  const dilation = obj.timeDilation !== undefined
    ? obj.timeDilation
    : computeTimeDilation(obj.mesh.position, obj.velocity, obj);
  const ratePct = (dilation * 100).toFixed(1);
  const rateStr = dilation < 0.999
    ? `${ratePct}% (${dilation.toFixed(3)}×)`
    : '100.0% (1.000× NOMINAL)';

  $('info-name').textContent = obj.name;
  $('info-type').textContent = obj.type.toUpperCase();
  $('info-parent').textContent = dom ? dom.name : '—';
  $('info-mass').textContent =
    obj.mass.toFixed(2) + (obj.type === 'star' || obj.type === 'neutron' ? ' M☉' : ' Mt');
  $('info-distance').textContent = (r / 10).toFixed(2) + ' AU';
  $('info-velocity').textContent = (speed / 60).toFixed(2) + 'c';
  const period = ((2 * Math.PI * r) / Math.max(speed, 0.001) / 10).toFixed(1);
  $('info-orbit').textContent = `${obj.status.toUpperCase()} (T≈${period}d)`;
  $('info-temp').textContent =
    obj.type === 'star'
      ? Math.round(obj.tempK).toLocaleString() + ' K'
      : obj.type === 'neutron'
      ? '~1,000,000,000 K'
      : '—';
  $('info-age').textContent = `${Math.floor(obj.age).toLocaleString()} yrs | Rate: ${rateStr}`;

  if (obj.type === 'star') {
    const pct = Math.min(100, (obj.age / obj.lifespan) * 100).toFixed(0);
    const stageLabel = {
      main_sequence: 'MAIN SEQUENCE',
      giant: obj.isHighMass ? 'RED SUPERGIANT' : 'RED GIANT',
      remnant: 'REMNANT',
    }[obj.stage];
    $('info-lifecycle').textContent = `${stageLabel} (${pct}%)`;
  } else if (obj.type === 'neutron') {
    $('info-lifecycle').textContent = 'STELLAR REMNANT';
  } else {
    $('info-lifecycle').textContent = '—';
  }

  $('info-tidal').textContent = (obj.tidalPercent ?? 0).toFixed(1) + '%';
  const hs = hillRadius(obj);
  $('info-influence').textContent = hs ? (hs.hr / 10).toFixed(2) + ' AU' : '—';
  $('info-status').textContent = dilation < 0.999
    ? `DILATED (${ratePct}%)`
    : (obj.status === 'unstable' ? 'DESTABILIZING' : 'NOMINAL');

  positionSelectionVisuals(obj.mesh.position, obj.velocity, obj.radius * 4, hs);
  fillPredictedPath(predictGeo, obj.mesh.position, obj.velocity);
}

/**
 * Positions and rescales the selection ring, velocity arrow, and Hill sphere wireframe.
 *
 * @param {THREE.Vector3} pos - Target position.
 * @param {THREE.Vector3} vel - Velocity vector.
 * @param {number} ringScale - Selection sprite scale.
 * @param {{ hr: number, dom: CelestialBody }|null} hs - Hill sphere radius and attractor.
 */
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
  } else {
    velocityArrow.visible = false;
  }

  if (hs && hs.hr > 0.5) {
    influenceSphere.visible = true;
    influenceSphere.position.copy(pos);
    influenceSphere.scale.setScalar(hs.hr);
  } else {
    influenceSphere.visible = false;
  }
}