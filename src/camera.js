/**
 * @file camera.js
 * @description Camera kinematic management, interpolation tweens, and cinematic shake.
 *
 * Implements camera focus modes (free orbit, target follow, auto-orbit), smooth cubic-eased
 * position transitions between celestial bodies, and decaying procedural camera shake
 * during high-energy events (supernovae, binary black hole mergers).
 */

import { camera, controls } from './scene.js';
import { state } from './state.js';

/* ============================================================================
   CAMERA MODE CONFIGURATION
   ============================================================================ */

/**
 * Sets the active camera tracking mode and updates associated UI state.
 *
 * @param {'free'|'follow'|'orbit'} mode - Target camera mode.
 */
export function setCameraMode(mode) {
  state.cameraMode = mode;
  controls.autoRotate = mode === 'orbit';
  document.getElementById('btn-follow').classList.toggle('active', mode === 'follow');
  document.getElementById('btn-orbit').classList.toggle('active', mode === 'orbit');
}

/**
 * Standard cubic ease-in-out interpolation curve.
 *
 * @param {number} t - Normalized progress [0, 1].
 * @returns {number} Interpolated value [0, 1].
 */
export function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Initiates a smooth camera transition to frame a target position.
 * Disables manual orbit controls during the transition.
 *
 * @param {THREE.Vector3} targetPos - Target look-at and framing center.
 * @param {number} distance - Desired standoff distance along the current viewing vector.
 * @param {number} [duration=1300] - Transition duration in milliseconds.
 */
export function flyCameraTo(targetPos, distance, duration = 1300) {
  const startPos = camera.position.clone();
  const startTarget = controls.target.clone();
  let dir = camera.position.clone().sub(controls.target);
  if (dir.lengthSq() < 0.01) dir.set(0.4, 0.5, 0.8);
  dir.normalize();
  const endPos = targetPos.clone().addScaledVector(dir, distance);
  state.cameraTween = {
    startPos,
    startTarget,
    endPos,
    endTarget: targetPos.clone(),
    start: performance.now(),
    duration,
  };
  controls.enabled = false;
}

/**
 * Triggers a decaying procedural camera shake offset.
 *
 * @param {number} [intensity=1] - Maximum random displacement magnitude in world units.
 * @param {number} [duration=700] - Total duration in milliseconds until shake fully decays.
 */
export function cameraShake(intensity = 1, duration = 700) {
  state.shakeState = { intensity, start: performance.now(), duration };
}

/**
 * Advances camera animation state. Must be invoked once per render frame.
 * Drives active transitions, decaying shake offsets, or delegates to OrbitControls.
 */
export function updateCamera() {
  if (state.cameraTween) {
    const t = Math.min((performance.now() - state.cameraTween.start) / state.cameraTween.duration, 1);
    const e = easeInOutCubic(t);
    camera.position.lerpVectors(state.cameraTween.startPos, state.cameraTween.endPos, e);
    controls.target.lerpVectors(state.cameraTween.startTarget, state.cameraTween.endTarget, e);
    camera.lookAt(controls.target);
    if (t >= 1) {
      state.cameraTween = null;
      controls.enabled = true;
    }
  } else {
    controls.update();
  }

  if (state.shakeState) {
    const st = Math.min((performance.now() - state.shakeState.start) / state.shakeState.duration, 1);
    if (st >= 1) {
      state.shakeState = null;
    } else {
      const decay = (1 - st) * state.shakeState.intensity;
      camera.position.x += (Math.random() - 0.5) * decay;
      camera.position.y += (Math.random() - 0.5) * decay;
      camera.position.z += (Math.random() - 0.5) * decay;
    }
  }
}
