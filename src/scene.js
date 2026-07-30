import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { makeGlowTexture, starGlowTex } from './textures.js';

/* =========================================================================
   RENDERER / SCENE / CAMERA / CONTROLS / LIGHTS
   ========================================================================= */
export const canvas = document.getElementById('scene');
export const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

export const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020306);

export const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.5, 4000);
camera.position.set(0, 160, 300);

export const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 20;
controls.maxDistance = 1400;
controls.target.set(0, 0, 0);
controls.autoRotateSpeed = 1.1;

export const diskLight = new THREE.PointLight(0xffb066, 6, 900, 1.6);
scene.add(diskLight);
scene.add(new THREE.AmbientLight(0x1a2a44, 0.9));

window.addEventListener('resize', onResize);
export function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
}

/* =========================================================================
   BACKGROUND: starfield + nebulae
   ========================================================================= */
function buildStarfield() {
  const N = 7000;
  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  const palette = [[0.6, 0.75, 1.0], [1, 1, 1], [1, 0.92, 0.7], [1, 0.75, 0.55], [1, 0.55, 0.45]];
  for (let i = 0; i < N; i++) {
    const r = 900 + Math.random() * 1400;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    pos[i * 3 + 1] = r * Math.cos(phi);
    pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    const p = palette[(Math.random() * palette.length) | 0];
    col[i * 3] = p[0]; col[i * 3 + 1] = p[1]; col[i * 3 + 2] = p[2];
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({
    size: 1.6, map: starGlowTex, transparent: true, depthWrite: false,
    vertexColors: true, blending: THREE.AdditiveBlending, sizeAttenuation: true,
  });
  scene.add(new THREE.Points(geo, mat));
}
buildStarfield();

function buildNebulae() {
  const colors = ['rgba(120,80,200,0.35)', 'rgba(60,120,200,0.3)', 'rgba(200,90,140,0.28)'];
  for (let i = 0; i < 6; i++) {
    const tex = makeGlowTexture(colors[i % colors.length], 'rgba(0,0,0,0)', 256);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.5 });
    const sprite = new THREE.Sprite(mat);
    const r = 1000 + Math.random() * 900;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    sprite.position.set(r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi) * 0.4, r * Math.sin(phi) * Math.sin(theta));
    const s = 400 + Math.random() * 500;
    sprite.scale.set(s, s, 1);
    scene.add(sprite);
  }
}
buildNebulae();

/* =========================================================================
   ACCRETION DISK SHADER (factory — every black hole gets its own instance)
   ========================================================================= */
export function createDiskMaterial(brightness) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: Math.random() * 100 }, uBrightness: { value: brightness } },
    vertexShader: `
      varying vec2 vUv;
      void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
    `,
    fragmentShader: `
      varying vec2 vUv;
      uniform float uTime;
      uniform float uBrightness;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453123); }
      float noise(vec2 p){
        vec2 i = floor(p); vec2 f = fract(p);
        float a = hash(i), b = hash(i+vec2(1.0,0.0)), c = hash(i+vec2(0.0,1.0)), d = hash(i+vec2(1.0,1.0));
        vec2 u = f*f*(3.0-2.0*f);
        return mix(a,b,u.x) + (c-a)*u.y*(1.0-u.x) + (d-b)*u.x*u.y;
      }
      float fbm(vec2 p){
        float v = 0.0; float amp = 0.55;
        for(int i=0;i<4;i++){ v += amp*noise(p); p *= 2.05; amp *= 0.55; }
        return v;
      }
      void main(){
        float radialFrac = clamp(vUv.y, 0.0, 1.0);
        float angle = vUv.x * 6.28318530718;
        float angVel = 5.2 / (radialFrac*2.2 + 0.35);
        float rotAngle = angle + uTime * angVel * 0.12;
        float turb = fbm(vec2(rotAngle * 2.4, radialFrac * 5.0 - uTime * 0.08));
        float turb2 = fbm(vec2(rotAngle * 5.5 + 4.0, radialFrac * 9.0 + uTime * 0.05));
        float brightness = turb * 0.65 + turb2 * 0.45;
        vec3 hot = vec3(1.0, 0.98, 0.92);
        vec3 mid = vec3(1.0, 0.55, 0.15);
        vec3 outer = vec3(0.75, 0.12, 0.05);
        vec3 col = mix(hot, mid, smoothstep(0.0, 0.45, radialFrac));
        col = mix(col, outer, smoothstep(0.45, 1.0, radialFrac));
        float flare = pow(max(turb2,0.0), 4.0) * 1.8;
        col += vec3(0.7,0.85,1.0) * flare * (1.0 - radialFrac);
        float edgeFade = smoothstep(0.0, 0.08, radialFrac) * (1.0 - smoothstep(0.82, 1.0, radialFrac));
        float alpha = edgeFade * (0.35 + brightness * 0.9) * uBrightness;
        gl_FragColor = vec4(col * (0.6 + brightness*0.9) * uBrightness, alpha);
      }
    `,
  });
}

/* =========================================================================
   POSTPROCESSING (bloom + gravitational lensing)
   ========================================================================= */
export const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
export const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.15, 0.55, 0.15);
composer.addPass(bloomPass);

const lensShader = {
  uniforms: { tDiffuse: { value: null }, uBH: { value: new THREE.Vector2(0.5, 0.5) }, uStrength: { value: 1.0 }, uAspect: { value: window.innerWidth / window.innerHeight } },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec2 uBH; uniform float uStrength; uniform float uAspect;
    varying vec2 vUv;
    void main(){
      vec2 diff = vUv - uBH; diff.x *= uAspect;
      float dist = length(diff);
      vec2 dirn = dist > 0.0001 ? normalize(diff) : vec2(0.0);
      float bend = uStrength * 0.09 * exp(-dist * 9.0);
      vec2 offset = dirn * bend; offset.x /= uAspect;
      gl_FragColor = texture2D(tDiffuse, clamp(vUv - offset, 0.0, 1.0));
    }
  `,
};
export const lensPass = new ShaderPass(lensShader);
composer.addPass(lensPass);
