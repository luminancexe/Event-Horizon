/**
 * @file scene.js
 * @description Three.js WebGL scene initialization, lighting, background environment, and post-processing pipeline.
 *
 * Sets up the primary 3D viewport, OrbitControls, deep-space environment (spectral starfield,
 * procedural nebulae), custom accretion disk GLSL shaders with Keplerian shear, and the post-processing
 * pipeline featuring bloom and screen-space gravitational lensing.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { makeGlowTexture, starGlowTex } from './textures.js';
import { CONFIG, C_SIM, MAX_LENSES } from './state.js';

/* ============================================================================
   RENDERER, SCENE, CAMERA, CONTROLS, AND LIGHTS
   ============================================================================ */

export const canvas = document.getElementById('scene');

/** Hardware-accelerated WebGL renderer with HDR tone mapping */
export const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

export const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020306);

/** Primary perspective camera with wide field of view for astronomical scales */
export const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.5, 4000);
camera.position.set(0, 160, 300);

/** Interactive damping orbit controls */
export const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 20;
controls.maxDistance = 1400;
controls.target.set(0, 0, 0);
controls.autoRotateSpeed = 1.1;

/** Dynamic point light positioned at the dominant singularity's accretion disk */
export const diskLight = new THREE.PointLight(0xffb066, 6, 900, 1.6);
scene.add(diskLight);

/** Base ambient fill lighting for shadowed planetary hemispheres */
scene.add(new THREE.AmbientLight(0x1a2a44, 0.9));

window.addEventListener('resize', onResize);

/**
 * Handles window viewport resizing and synchronizes camera projection and render buffers.
 */
export function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
}

/* ============================================================================
   BACKGROUND ENVIRONMENT (STARFIELD & PROCEDURAL NEBULAE)
   ============================================================================ */

/**
 * Generates a spherical background starfield with astronomical spectral color distributions.
 */
function buildStarfield() {
  const N = 7000;
  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  // Stellar spectral classifications: O/B (blue), A/F (white), G (yellow), K (orange), M (red)
  const palette = [
    [0.6, 0.75, 1.0],
    [1.0, 1.0, 1.0],
    [1.0, 0.92, 0.7],
    [1.0, 0.75, 0.55],
    [1.0, 0.55, 0.45],
  ];

  for (let i = 0; i < N; i++) {
    // Uniform distribution on a spherical shell between r=900 and r=2300
    const r = 900 + Math.random() * 1400;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);

    pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    pos[i * 3 + 1] = r * Math.cos(phi);
    pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);

    const p = palette[(Math.random() * palette.length) | 0];
    col[i * 3] = p[0];
    col[i * 3 + 1] = p[1];
    col[i * 3 + 2] = p[2];
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));

  const mat = new THREE.PointsMaterial({
    size: 1.6,
    map: starGlowTex,
    transparent: true,
    depthWrite: false,
    vertexColors: true,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });

  scene.add(new THREE.Points(geo, mat));
}
buildStarfield();

/**
 * Places procedural volumetric nebula sprites across the background skybox.
 */
function buildNebulae() {
  const colors = [
    'rgba(120,80,200,0.35)',
    'rgba(60,120,200,0.3)',
    'rgba(200,90,140,0.28)',
  ];

  for (let i = 0; i < 6; i++) {
    const tex = makeGlowTexture(colors[i % colors.length], 'rgba(0,0,0,0)', 256);
    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 0.5,
    });
    const sprite = new THREE.Sprite(mat);
    const r = 1000 + Math.random() * 900;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);

    sprite.position.set(
      r * Math.sin(phi) * Math.cos(theta),
      r * Math.cos(phi) * 0.4,
      r * Math.sin(phi) * Math.sin(theta)
    );
    const s = 400 + Math.random() * 500;
    sprite.scale.set(s, s, 1);
    scene.add(sprite);
  }
}
buildNebulae();

/* ============================================================================
   ACCRETION DISK GLSL SHADER FACTORY
   ============================================================================ */

/**
 * Creates an instance of the relativistic accretion disk shader material.
 * Implements procedural multi-octave Fractal Brownian Motion (fBm) turbulence,
 * differential Keplerian orbital shear (omega ~ r^-1.5), Kerr-inspired relativistic
 * Doppler boosting/dimming (delta^3), gravitational redshift, and spectral color shifting.
 *
 * @param {number} brightness - Base brightness uniform multiplier.
 * @param {object} [opts={}] - Initial black hole parameter overrides.
 * @returns {THREE.ShaderMaterial}
 */
export function createDiskMaterial(brightness, opts = {}) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: Math.random() * 100 },
      uBrightness: { value: brightness },
      uCameraPos: { value: new THREE.Vector3(0, 160, 300) },
      uBHPos: { value: new THREE.Vector3(0, 0, 0) },
      uSpinAxis: { value: new THREE.Vector3(0, 1, 0) },
      uSpin: { value: opts.spin ?? 0.85 },
      uMass: { value: opts.mass ?? 5000 },
      uInnerRadius: { value: opts.innerRadius ?? 10.8 },
      uDopplerEnabled: { value: CONFIG.dopplerBeamingEnabled ?? true },
      uAccretionRate: { value: opts.accretionRate ?? 0.0 },
      uG: { value: CONFIG.G },
      uCSim: { value: C_SIM },
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vWorldPosition;
      void main() {
        vUv = uv;
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPos.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      varying vec3 vWorldPosition;

      uniform float uTime;
      uniform float uBrightness;
      uniform vec3 uCameraPos;
      uniform vec3 uBHPos;
      uniform vec3 uSpinAxis;
      uniform float uSpin;
      uniform float uMass;
      uniform float uInnerRadius;
      uniform bool uDopplerEnabled;
      uniform float uAccretionRate;
      uniform float uG;
      uniform float uCSim;

      // 2D pseudo-random hash generator
      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }

      // Value noise with cubic Hermite interpolation
      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        float a = hash(i);
        float b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0));
        float d = hash(i + vec2(1.0, 1.0));
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
      }

      // 4-octave Fractal Brownian Motion for turbulent gas dynamics
      float fbm(vec2 p) {
        float v = 0.0;
        float amp = 0.55;
        for (int i = 0; i < 4; i++) {
          v += amp * noise(p);
          p *= 2.05;
          amp *= 0.55;
        }
        return v;
      }

      void main() {
        float radialFrac = clamp(vUv.y, 0.0, 1.0);
        float angle = vUv.x * 6.28318530718;

        // Differential Keplerian rotation modulated by spin sign and magnitude
        float spinSign = uSpin > 0.001 ? 1.0 : (uSpin < -0.001 ? -1.0 : 0.0);
        float spinMag = abs(uSpin);
        float rotDirection = spinSign != 0.0 ? spinSign : 1.0;
        float angVel = (5.2 / (radialFrac * 2.2 + 0.35)) * (1.0 + spinMag * 0.25);
        float rotAngle = angle + uTime * angVel * 0.12 * rotDirection;

        float turb = fbm(vec2(rotAngle * 2.4, radialFrac * 5.0 - uTime * 0.08 * rotDirection));
        float turb2 = fbm(vec2(rotAngle * 5.5 + 4.0, radialFrac * 9.0 + uTime * 0.05 * rotDirection));
        float accBoost = 1.0 + log(1.0 + max(uAccretionRate, 0.0) * 12.0) * 0.45;
        float brightness = (turb * 0.65 + turb2 * 0.45) * accBoost;

        // Thermal blackbody color ramp: white-hot inner edge to deep red outer rim
        vec3 hot = vec3(1.0, 0.98, 0.92);
        vec3 mid = vec3(1.0, 0.55, 0.15);
        vec3 outer = vec3(0.75, 0.12, 0.05);

        vec3 col = mix(hot, mid, smoothstep(0.0, 0.45, radialFrac));
        col = mix(col, outer, smoothstep(0.45, 1.0, radialFrac));

        // High-energy turbulent flare highlights
        float flare = pow(max(turb2, 0.0), 4.0) * 1.8;
        col += vec3(0.7, 0.85, 1.0) * flare * (1.0 - radialFrac);

        // Relativistic Doppler Beaming & Gravitational Redshift Calculation
        float dopplerFactor = 1.0;
        float gravRedshift = 1.0;

        if (uDopplerEnabled) {
          vec3 rVec = vWorldPosition - uBHPos;
          float worldR = max(length(rVec), 0.1);
          vec3 uR = rVec / worldR;

          vec3 spinAxisNorm = length(uSpinAxis) > 0.001 ? normalize(uSpinAxis) : vec3(0.0, 1.0, 0.0);
          vec3 uPhi = cross(spinAxisNorm, uR);
          float uPhiLen = length(uPhi);
          if (uPhiLen > 0.0001) {
            uPhi = (uPhi / uPhiLen) * rotDirection;
          } else {
            uPhi = vec3(0.0);
          }

          vec3 camDir = uCameraPos - vWorldPosition;
          float camDist = max(length(camDir), 0.1);
          vec3 nObs = camDir / camDist;

          // Line-of-sight velocity alignment cosine
          float cosTheta = dot(uPhi, nObs);

          // Orbital velocity v ~ sqrt(GM/r) with Kerr ISCO relativistic inner enhancement
          float vOrbit = sqrt(max((uG * uMass) / worldR, 0.0)) * (1.0 + 0.15 * spinMag * (uInnerRadius / worldR));
          float beta = clamp(vOrbit / max(uCSim, 1.0), 0.0, 0.75);
          float gamma = 1.0 / sqrt(max(1.0 - beta * beta, 0.01));

          // Relativistic Doppler factor delta = 1 / (gamma * (1 - beta * cosTheta))
          float delta = 1.0 / max(gamma * (1.0 - beta * cosTheta), 0.05);

          // Intensity scaling I_obs = I_emit * delta^3 (clamped for visual dynamic range)
          dopplerFactor = spinSign != 0.0 ? clamp(pow(delta, 3.0), 0.12, 4.50) : 1.0;

          // Kerr-inspired gravitational redshift approximation g_grav = sqrt(1 - r_H / r)
          float rs = (2.0 * uG * uMass) / (uCSim * uCSim);
          float rH = (rs * 0.5) * (1.0 + sqrt(max(0.0, 1.0 - spinMag * spinMag)));
          gravRedshift = sqrt(max(1.0 - (rH * 0.9) / max(worldR, rH * 0.95), 0.001));

          // Frequency shift spectral modulation (blue-shifting approaching side, red-shifting receding side)
          float gNet = delta * gravRedshift;
          vec3 blueTint = vec3(0.65, 0.85, 1.15);
          vec3 redTint = vec3(1.15, 0.40, 0.15);
          if (gNet > 1.0) {
            col = mix(col, col * blueTint, smoothstep(1.0, 1.6, gNet));
          } else {
            col = mix(col, col * redTint, smoothstep(1.0, 0.5, gNet));
          }
        }

        // Smooth inner event horizon and outer edge alpha falloff
        float edgeFade = smoothstep(0.0, 0.08, radialFrac) * (1.0 - smoothstep(0.82, 1.0, radialFrac));
        float alpha = edgeFade * (0.35 + brightness * 0.9) * uBrightness * min(dopplerFactor, 2.0);

        vec3 finalColor = col * (0.6 + brightness * 0.9) * uBrightness * dopplerFactor * gravRedshift;
        gl_FragColor = vec4(finalColor, alpha);
      }
    `,
  });
}

/* ============================================================================
   POST-PROCESSING PIPELINE (BLOOM & GRAVITATIONAL LENSING)
   ============================================================================ */

export const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

/** Unreal bloom pass for glowing celestial bodies and relativistic disks */
export const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  1.15,
  0.55,
  0.15
);
composer.addPass(bloomPass);

/**
 * Screen-space multi-singularity gravitational lensing shader.
 * Implements thin-lens Schwarzschild light deflection, Einstein-ring formation,
 * and multi-singularity vector superposition for up to MAX_LENSES active black holes.
 */
const lensShader = {
  uniforms: {
    tDiffuse: { value: null },
    uLensCount: { value: 0 },
    uLensPos: {
      value: Array.from({ length: MAX_LENSES }, () => new THREE.Vector2(0.5, 0.5)),
    },
    uEinsteinRadius: { value: new Float32Array(MAX_LENSES) },
    uShadowRadius: { value: new Float32Array(MAX_LENSES) },
    uCutoffRadius: { value: new Float32Array(MAX_LENSES) },
    uStrength: { value: 1.0 },
    uAspect: { value: window.innerWidth / window.innerHeight },
    uLensingEnabled: { value: true },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform int uLensCount;
    uniform vec2 uLensPos[${MAX_LENSES}];
    uniform float uEinsteinRadius[${MAX_LENSES}];
    uniform float uShadowRadius[${MAX_LENSES}];
    uniform float uCutoffRadius[${MAX_LENSES}];
    uniform float uStrength;
    uniform float uAspect;
    uniform bool uLensingEnabled;
    varying vec2 vUv;

    void main() {
      if (!uLensingEnabled || uStrength <= 0.001 || uLensCount <= 0) {
        gl_FragColor = texture2D(tDiffuse, vUv);
        return;
      }

      vec2 aspectUv = vec2(vUv.x * uAspect, vUv.y);
      vec2 netDeflection = vec2(0.0);
      float minShadowMask = 1.0;

      for (int i = 0; i < ${MAX_LENSES}; i++) {
        if (i >= uLensCount) break;

        vec2 lensCenter = vec2(uLensPos[i].x * uAspect, uLensPos[i].y);
        vec2 diff = aspectUv - lensCenter;
        float theta = length(diff);

        float thetaE = uEinsteinRadius[i];
        float shadowR = uShadowRadius[i];
        float cutoffR = uCutoffRadius[i];

        if (theta > cutoffR || theta < 0.0001) continue;

        vec2 dir = diff / theta;

        // Schwarzschild thin-lens deflection angle: alpha(theta) = theta_E^2 / theta
        // Softened near the horizon to avoid singularity division
        float softTheta = max(theta, shadowR * 0.45 + 0.002);
        float alphaMag = (thetaE * thetaE) / softTheta;

        // Smooth boundary fade towards cutoff radius to eliminate edge artifacts
        float fade = smoothstep(cutoffR, cutoffR * 0.35, theta);

        // Black hole event horizon shadow preservation: mask inner shadow to prevent light smearing
        float shadowFactor = smoothstep(shadowR * 0.75, shadowR * 1.25, theta);
        minShadowMask = min(minShadowMask, shadowFactor);

        // Multi-singularity linear deflection vector superposition
        netDeflection += dir * (alphaMag * fade * shadowFactor * uStrength);
      }

      // Aspect-ratio corrected UV offset sampling
      vec2 sampleOffset = vec2(netDeflection.x / uAspect, netDeflection.y);
      vec2 sampleUv = clamp(vUv - sampleOffset, 0.0, 1.0);

      vec4 sampledColor = texture2D(tDiffuse, sampleUv);

      // Preserve opaque black event horizon core
      gl_FragColor = vec4(sampledColor.rgb * minShadowMask, sampledColor.a);
    }
  `,
};

export const lensPass = new ShaderPass(lensShader);
composer.addPass(lensPass);
