import * as THREE from 'three';
import { CONFIG, state, AGE_YEARS_PER_SIMSECOND, MAX_SUBSTEPS_BODY, MAX_SUBSTEPS_ASTEROID } from './state.js';
import { camera, controls, diskLight, composer, lensPass, renderer } from './scene.js';
import { updateCamera } from './camera.js';
import { createBlackHole, createStar, createPlanet, createMoon, createComet, orbitalVelocity, blackHoles, dominantBlackHole } from './objects.js';
import { initAsteroids, updateAsteroids } from './asteroids.js';
import { integrateBodiesVerlet, postStepBody, updateBlackHoleInteractions, checkBodyCollisions } from './physics.js';
import { updateFragments, updateStarLifecycle } from './effects.js';
import { updateInfoPanel, selectionRing, velocityArrow, influenceSphere } from './selection.js';
import { updateDebugHud, updateDebugOverlays } from './ui.js';
import { logEvent, fmtClock } from './events.js';

// modules whose top-level code (event listeners, DOM wiring) needs to run
// even though main.js doesn't call anything from them directly
import './creation.js';
import './saveload.js';

/* =========================================================================
   INITIAL POPULATION
   ========================================================================= */
createBlackHole({ position: new THREE.Vector3(), velocity: new THREE.Vector3(), mass: CONFIG.blackHoleMass, name: 'SAGITTARIUS PRIME' });
initAsteroids(CONFIG.asteroidCount);
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
   MAIN LOOP
   ========================================================================= */
const clock = new THREE.Clock();
let perfAccum = 0, perfSamples = 0, perfScaled = false, perfScaledTier2 = false;

function animate() {
  requestAnimationFrame(animate);
  const rawDt = Math.min(clock.getDelta(), 0.05);
  state.fpsSmoothed = state.fpsSmoothed * 0.92 + (rawDt > 0 ? 1 / rawDt : state.fpsSmoothed) * 0.08;

  // automatic performance scaling: two escalating, one-shot tiers. Neither
  // re-triggers once applied (no oscillation) — if the sim is still heavy
  // after thinning the asteroid field, only then does it fall back to
  // reducing render resolution, which is a bigger visual trade-off.
  perfAccum += rawDt; perfSamples++;
  if (perfSamples >= 90) {
    const avgDt = perfAccum / perfSamples;
    if (!perfScaled && avgDt > 0.033 && state.aPos.length > 150) {
      perfScaled = true;
      const newCount = Math.max(150, Math.floor(state.aPos.length * 0.6));
      initAsteroids(newCount);
      CONFIG.asteroidCount = newCount;
      document.getElementById('slider-asteroids').value = newCount;
      document.getElementById('val-asteroids').textContent = newCount;
      logEvent('Performance mode engaged — asteroid density reduced automatically for a smoother framerate.', 'info');
    } else if (perfScaled && !perfScaledTier2 && avgDt > 0.033 && renderer.getPixelRatio() > 1) {
      perfScaledTier2 = true;
      renderer.setPixelRatio(1);
      composer.setSize(window.innerWidth, window.innerHeight);
      logEvent('Performance mode (tier 2) — render resolution reduced for a smoother framerate.', 'info');
    }
    perfAccum = 0; perfSamples = 0;
  }

  updateCamera();

  state.gravityCalcCount = 0;
  const physicsStart = performance.now();
  let gravityMs = 0, collisionMs = 0, asteroidMs = 0;
  if (!CONFIG.paused) {
    const dt = rawDt * CONFIG.timeScale;
    state.simTime += dt;
    state.simYears += dt * AGE_YEARS_PER_SIMSECOND;

    // split large steps (high time-scale) into bounded sub-steps so nothing
    // tunnels through a capture radius or blows up numerically
    const nBody = Math.min(Math.max(Math.ceil(dt / CONFIG.maxSubstep), 1), MAX_SUBSTEPS_BODY);
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

    const nAst = Math.min(nBody, MAX_SUBSTEPS_ASTEROID);
    const subDtAst = dt / nAst;
    for (let s = 0; s < nAst; s++) {
      const t0 = performance.now();
      updateAsteroids(subDtAst); updateFragments(subDtAst);
      asteroidMs += performance.now() - t0;
    }

    for (const b of [...state.bodies]) if (b.type === 'star') updateStarLifecycle(b);
    for (const b of state.bodies) if (b.type === 'neutron') { const pulse = 1 + 0.3 * Math.sin(state.simTime * 8 + b.id); b.core.scale.setScalar(pulse); }

    for (const bh of blackHoles()) {
      bh.diskMat.uniforms.uTime.value += dt;
      bh._burst = Math.max(0, (bh._burst || 0) - dt * 0.7);
      bh.diskMat.uniforms.uBrightness.value = CONFIG.diskBrightness + bh._burst;
    }
    diskLight.intensity = 5 + Math.sin(state.simTime * 0.6) * 1.2 + (dominantBlackHole()?._burst || 0) * 4;
  }
  state.lastPhysicsMs = performance.now() - physicsStart;
  state.lastGravityMs = gravityMs;
  state.lastCollisionMs = collisionMs;
  state.lastAsteroidMs = asteroidMs;

  const dominantForLight = dominantBlackHole();
  if (dominantForLight) diskLight.position.copy(dominantForLight.mesh.position);

  document.getElementById('clock-value').textContent = fmtClock(state.simTime);
  document.getElementById('sim-years-value').textContent = Math.floor(state.simYears).toLocaleString() + ' YEARS';

  if (state.followTarget) {
    const stillExists = state.bodies.includes(state.followTarget) || (state.followTarget.isAsteroid && state.aAlive[state.followTarget.index]);
    if (!stillExists) state.followTarget = null;
    else controls.target.lerp(state.followTarget.isAsteroid ? state.aPos[state.followTarget.index] : state.followTarget.mesh.position, 0.08);
  }

  for (const bh of blackHoles()) bh.photonSprite.material.rotation += rawDt * 0.05;

  if (state.selected) updateInfoPanel();
  else { selectionRing.visible = velocityArrow.visible = influenceSphere.visible = false; }

  const dominant = dominantBlackHole();
  if (dominant) {
    const ndc = dominant.mesh.position.clone().project(camera);
    lensPass.uniforms.uBH.value.set((ndc.x + 1) / 2, (ndc.y + 1) / 2);
    lensPass.uniforms.uStrength.value = CONFIG.lensStrength * (ndc.z < 1 ? 1 : 0);
  }
  lensPass.uniforms.uAspect.value = window.innerWidth / window.innerHeight;

  updateDebugOverlays();
  if (CONFIG.debugMode) updateDebugHud();

  composer.render();
}
animate();