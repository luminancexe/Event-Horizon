import { camera, controls } from './scene.js';
import { state } from './state.js';

/* =========================================================================
   CAMERA — modes (free / follow / orbit) plus one-shot smooth "fly to"
   transitions used for the star-system / black-hole views, and a simple
   camera-shake effect for cinematic events (supernovae, mergers).
   ========================================================================= */
export function setCameraMode(mode) {
  state.cameraMode = mode;
  controls.autoRotate = mode === 'orbit';
  document.getElementById('btn-follow').classList.toggle('active', mode === 'follow');
  document.getElementById('btn-orbit').classList.toggle('active', mode === 'orbit');
}

export function easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

export function flyCameraTo(targetPos, distance, duration = 1300) {
  const startPos = camera.position.clone();
  const startTarget = controls.target.clone();
  let dir = camera.position.clone().sub(controls.target);
  if (dir.lengthSq() < 0.01) dir.set(0.4, 0.5, 0.8);
  dir.normalize();
  const endPos = targetPos.clone().addScaledVector(dir, distance);
  state.cameraTween = { startPos, startTarget, endPos, endTarget: targetPos.clone(), start: performance.now(), duration };
  controls.enabled = false;
}

export function cameraShake(intensity = 1, duration = 700) {
  state.shakeState = { intensity, start: performance.now(), duration };
}

// called once per frame from main.js: drives the fly-to tween and the
// shake jitter, and otherwise defers to OrbitControls' own update()
export function updateCamera() {
  if (state.cameraTween) {
    const t = Math.min((performance.now() - state.cameraTween.start) / state.cameraTween.duration, 1);
    const e = easeInOutCubic(t);
    camera.position.lerpVectors(state.cameraTween.startPos, state.cameraTween.endPos, e);
    controls.target.lerpVectors(state.cameraTween.startTarget, state.cameraTween.endTarget, e);
    camera.lookAt(controls.target);
    if (t >= 1) { state.cameraTween = null; controls.enabled = true; }
  } else {
    controls.update();
  }

  if (state.shakeState) {
    const st = Math.min((performance.now() - state.shakeState.start) / state.shakeState.duration, 1);
    if (st >= 1) state.shakeState = null;
    else {
      const decay = (1 - st) * state.shakeState.intensity;
      camera.position.x += (Math.random() - 0.5) * decay;
      camera.position.y += (Math.random() - 0.5) * decay;
      camera.position.z += (Math.random() - 0.5) * decay;
    }
  }
}
