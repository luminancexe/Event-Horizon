/**
 * @file main.js
 * @description Application bootstrap, initial orbital system population, and primary animation loop.
 *
 * Coordinates:
 * 1. Initial scene initialization and celestial body population.
 * 2. Adaptive performance scaling tiers under heavy computational load.
 * 3. Sub-stepped physics integration loops for massive bodies and particle fields.
 * 4. Screen-space post-processing updates (gravitational lensing coordinates, accretion flare intensity).
 * 5. Telemetry and inspector rendering pipeline dispatch.
 */

import * as THREE from 'three';
import {
  CONFIG,
  state,
  C_SIM,
  MAX_LENSES,
  AGE_YEARS_PER_SIMSECOND,
  MAX_SUBSTEPS_BODY,
  MAX_SUBSTEPS_ASTEROID,
} from './state.js';
import { camera, controls, diskLight, composer, lensPass, renderer } from './scene.js';
import { updateCamera } from './camera.js';
import {
  createBlackHole,
  createStar,
  createPlanet,
  createMoon,
  createComet,
  orbitalVelocity,
  blackHoles,
  dominantBlackHole,
} from './objects.js';
import { initAsteroids, updateAsteroids } from './asteroids.js';
import {
  integrateBodiesVerlet,
  postStepBody,
  updateBlackHoleInteractions,
  checkBodyCollisions,
} from './physics.js';
import { updateFragments, updateStarLifecycle, TDEStreamManager } from './effects.js';
import { updateInfoPanel, selectionRing, velocityArrow, influenceSphere } from './selection.js';
import { updateDebugHud, updateDebugOverlays } from './ui.js';
import { logEvent, fmtClock } from './events.js';

// Side-effect imports: Register event listeners and UI bindings
import './creation.js';
import './saveload.js';

/* ============================================================================
   INITIAL ASTRONOMICAL POPULATION
   ============================================================================ */

createBlackHole({
  position: new THREE.Vector3(),
  velocity: new THREE.Vector3(),
  mass: CONFIG.blackHoleMass,
  name: 'SAGITTARIUS PRIME',
  bhClass: 'supermassive',
  spin: 0.85,
});

initAsteroids(CONFIG.asteroidCount);
state.tdeManager = new TDEStreamManager();

for (let i = 0; i < 5; i++) createStar();

const initialPlanets = [];
for (let i = 0; i < 8; i++) initialPlanets.push(createPlanet());

for (let i = 0; i < 3; i++) createComet();

// Spawn demonstration satellite orbiting a primary planet
if (initialPlanets.length) {
  const parent = initialPlanets[Math.floor(Math.random() * initialPlanets.length)];
  const offset = new THREE.Vector3(parent.radius * 5, 0, 0);
  const moonPos = parent.mesh.position.clone().add(offset);
  const moonVel = orbitalVelocity(moonPos, parent.mesh.position, parent.mass, 1).add(parent.velocity);
  createMoon({ position: moonPos, velocity: moonVel, name: 'LUNA-01', parent });
}

logEvent('Observatory systems online. Gravitational field stabilized.', 'info');

/* ============================================================================
   PRIMARY SIMULATION AND RENDERING LOOP
   ============================================================================ */

const clock = new THREE.Clock();
let perfAccum = 0;
let perfSamples = 0;
let perfScaled = false;
let perfScaledTier2 = false;

// Persistent scratch objects for zero-allocation multi-singularity screen projection
const _lensNdc = new THREE.Vector3();
const _lensCamPos = new THREE.Vector3();
const _candidateLenses = [];

/**
 * Main application loop driven by requestAnimationFrame.
 * Integrates simulation physics with sub-step subdivision and executes post-processing rendering.
 */
function animate() {
  requestAnimationFrame(animate);

  // Clamp raw frame delta to 50ms to prevent simulation explosion during tab backgrounding
  const rawDt = Math.min(clock.getDelta(), 0.05);

  // Exponential moving average for framerate telemetry smoothing
  state.fpsSmoothed =
    state.fpsSmoothed * 0.92 + (rawDt > 0 ? 1 / rawDt : state.fpsSmoothed) * 0.08;

  // Adaptive performance scaling: two non-oscillating degradation tiers
  perfAccum += rawDt;
  perfSamples++;
  if (perfSamples >= 90) {
    const avgDt = perfAccum / perfSamples;
    // Tier 1: Reduce asteroid particle count if framerate drops below ~30 FPS
    if (!perfScaled && avgDt > 0.033 && state.aPos.length > 150) {
      perfScaled = true;
      const newCount = Math.max(150, Math.floor(state.aPos.length * 0.6));
      initAsteroids(newCount);
      CONFIG.asteroidCount = newCount;
      document.getElementById('slider-asteroids').value = newCount;
      document.getElementById('val-asteroids').textContent = newCount;
      logEvent('Performance mode engaged: Asteroid density reduced for optimal framerate.', 'info');
    } else if (perfScaled && !perfScaledTier2 && avgDt > 0.033 && renderer.getPixelRatio() > 1) {
      // Tier 2: Downsample render resolution pixel ratio
      perfScaledTier2 = true;
      renderer.setPixelRatio(1);
      composer.setSize(window.innerWidth, window.innerHeight);
      logEvent('Performance mode (Tier 2): Render resolution downscaled.', 'info');
    }
    perfAccum = 0;
    perfSamples = 0;
  }

  updateCamera();

  state.gravityCalcCount = 0;
  const physicsStart = performance.now();
  let gravityMs = 0;
  let collisionMs = 0;
  let asteroidMs = 0;

  if (!CONFIG.paused) {
    const dt = rawDt * CONFIG.timeScale;
    state.simTime += dt;
    state.simYears += dt * AGE_YEARS_PER_SIMSECOND;

    // Sub-step subdivision for massive body integration
    const nBody = Math.min(
      Math.max(Math.ceil(dt / CONFIG.maxSubstep), 1),
      MAX_SUBSTEPS_BODY
    );
    state.lastSubsteps = nBody;
    const subDtBody = dt / nBody;

    for (let s = 0; s < nBody; s++) {
      let t0 = performance.now();
      integrateBodiesVerlet(subDtBody);
      for (const obj of [...state.bodies]) postStepBody(obj, subDtBody);
      gravityMs += performance.now() - t0;

      t0 = performance.now();
      updateBlackHoleInteractions(subDtBody);
      checkBodyCollisions();
      collisionMs += performance.now() - t0;
    }

    // Sub-step subdivision for asteroid field integration
    const nAst = Math.min(nBody, MAX_SUBSTEPS_ASTEROID);
    const subDtAst = dt / nAst;
    for (let s = 0; s < nAst; s++) {
      const t0 = performance.now();
      updateAsteroids(subDtAst);
      updateFragments(subDtAst);
      state.tdeManager?.update(subDtAst);
      asteroidMs += performance.now() - t0;
    }

    // Active TDE count tracking
    let activeTdes = 0;
    for (const b of state.bodies) {
      if (b.tdePhase === 1) activeTdes++;
    }
    state.activeTdeCount = activeTdes;

    // Stellar lifecycles and pulsar optical oscillations
    for (const b of [...state.bodies]) {
      if (b.type === 'star') updateStarLifecycle(b);
    }
    for (const b of state.bodies) {
      if (b.type === 'neutron') {
        const t = b.properTime !== undefined ? b.properTime : state.simTime;
        const pulse = 1 + 0.3 * Math.sin(t * 8 + b.id);
        b.core.scale.setScalar(pulse);
      }
    }

    // Accretion disk shader time advancement, flare dissipation, and relativistic Doppler parameters
    for (const bh of blackHoles()) {
      if (bh.diskMat) {
        bh.diskMat.uniforms.uTime.value += dt;
        bh._burst = Math.max(0, (bh._burst || 0) - dt * 0.7);
        bh.diskMat.uniforms.uBrightness.value = CONFIG.diskBrightness + bh._burst;
        bh.diskMat.uniforms.uCameraPos.value.copy(camera.position);
        bh.diskMat.uniforms.uBHPos.value.copy(bh.mesh.position);
        bh.diskMat.uniforms.uSpinAxis.value.copy(bh.spinDirection);
        bh.diskMat.uniforms.uSpin.value = bh.spin;
        bh.diskMat.uniforms.uMass.value = bh.mass;
        bh.diskMat.uniforms.uDopplerEnabled.value = CONFIG.dopplerBeamingEnabled;
        bh.diskMat.uniforms.uG.value = CONFIG.G;
      }
    }
    diskLight.intensity =
      5 + Math.sin(state.simTime * 0.6) * 1.2 + (dominantBlackHole()?._burst || 0) * 4;
  }

  state.lastPhysicsMs = performance.now() - physicsStart;
  state.lastGravityMs = gravityMs;
  state.lastCollisionMs = collisionMs;
  state.lastAsteroidMs = asteroidMs;

  const dominantForLight = dominantBlackHole();
  if (dominantForLight) diskLight.position.copy(dominantForLight.mesh.position);

  document.getElementById('clock-value').textContent = fmtClock(state.simTime);
  document.getElementById('sim-years-value').textContent =
    Math.floor(state.simYears).toLocaleString() + ' YEARS';

  // Update target tracking camera target
  if (state.followTarget) {
    const stillExists =
      state.bodies.includes(state.followTarget) ||
      (state.followTarget.isAsteroid && state.aAlive[state.followTarget.index]);
    if (!stillExists) {
      state.followTarget = null;
    } else {
      controls.target.lerp(
        state.followTarget.isAsteroid
          ? state.aPos[state.followTarget.index]
          : state.followTarget.mesh.position,
        0.08
      );
    }
  }

  for (const bh of blackHoles()) {
    if (bh.photonSprite) {
      bh.photonSprite.material.rotation += rawDt * 0.05;
    }
  }

  if (state.selected) {
    updateInfoPanel();
  } else {
    selectionRing.visible = velocityArrow.visible = influenceSphere.visible = false;
  }

  // Multi-singularity gravitational lensing screen-space projection
  if (CONFIG.lensingEnabled && CONFIG.lensStrength > 0.001) {
    const fovRad = (camera.fov * Math.PI) / 180;
    const tanHalfFov = Math.tan(fovRad * 0.5);
    const allBhs = blackHoles();

    _candidateLenses.length = 0;

    for (let i = 0; i < allBhs.length; i++) {
      const bh = allBhs[i];
      if (bh._destroyed) continue;

      // Transform to camera view space: z_cam < 0 means in front of camera
      _lensCamPos.copy(bh.mesh.position).applyMatrix4(camera.matrixWorldInverse);
      const camDist = -_lensCamPos.z;

      // Cull singularities behind or too close to the camera plane
      if (camDist < 0.5) continue;

      // Project to Normalized Device Coordinates [-1, 1]
      _lensNdc.copy(bh.mesh.position).project(camera);
      const uvX = (_lensNdc.x + 1) * 0.5;
      const uvY = (_lensNdc.y + 1) * 0.5;

      // Physical Schwarzschild radius & angular Einstein radius: theta_E = sqrt(2 * r_s / D_l)
      const rs = bh.schwarzschildRadius || (2 * CONFIG.G * bh.mass) / (C_SIM * C_SIM);
      const totalDist = Math.max(bh.mesh.position.distanceTo(camera.position), 0.5);
      const thetaE = Math.sqrt((2 * rs) / totalDist);

      // Angular screen fractions normalized to vertical FOV
      const einsteinScreen = Math.min(Math.max((thetaE / tanHalfFov) * 0.35, 0.002), 0.5);
      const shadowScreen = Math.min(Math.max((bh.visualRadius / totalDist) / tanHalfFov, 0.001), 0.4);
      const cutoffScreen = Math.min(einsteinScreen * 6.5 + shadowScreen * 2.0, 1.8);

      // Frustum boundary check with margin for extended distortion field
      if (uvX < -0.4 || uvX > 1.4 || uvY < -0.4 || uvY > 1.4) continue;

      _candidateLenses.push({
        uvX,
        uvY,
        einsteinScreen,
        shadowScreen,
        cutoffScreen,
        influence: einsteinScreen / totalDist,
      });
    }

    // Rank candidates by apparent angular lensing influence
    _candidateLenses.sort((a, b) => b.influence - a.influence);
    const activeCount = Math.min(_candidateLenses.length, MAX_LENSES);

    for (let i = 0; i < activeCount; i++) {
      const c = _candidateLenses[i];
      lensPass.uniforms.uLensPos.value[i].set(c.uvX, c.uvY);
      lensPass.uniforms.uEinsteinRadius.value[i] = c.einsteinScreen;
      lensPass.uniforms.uShadowRadius.value[i] = c.shadowScreen;
      lensPass.uniforms.uCutoffRadius.value[i] = c.cutoffScreen;
    }

    lensPass.uniforms.uLensCount.value = activeCount;
    state.activeLensesCount = activeCount;
  } else {
    lensPass.uniforms.uLensCount.value = 0;
    state.activeLensesCount = 0;
  }

  lensPass.uniforms.uAspect.value = window.innerWidth / window.innerHeight;
  lensPass.uniforms.uStrength.value = CONFIG.lensStrength;
  lensPass.uniforms.uLensingEnabled.value = CONFIG.lensingEnabled;

  updateDebugOverlays();
  if (CONFIG.debugMode) updateDebugHud();

  composer.render();
}

animate();