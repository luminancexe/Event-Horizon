/* =========================================================================
   STATE.JS — configuration and shared mutable state.

   ES modules give live bindings for named exports, but an imported binding
   can never be *reassigned* from outside the module that owns it (only
   mutated if it's an object). Since almost everything in this app touches
   things like "the current body list" or "the currently selected object",
   every cross-module mutable value lives as a *property* on the single
   `state` object below, rather than as a bare exported `let`. Modules can
   freely read/write `state.bodies`, `state.selected`, etc. Anything that's
   truly private to one module (a cooldown timer, a loop counter) stays a
   local `let` inside that module instead of living here.
   ========================================================================= */

export const CONFIG = {
  G: 0.6,
  blackHoleMass: 5000,       // mirrors the primary black hole's mass, kept for the slider
  timeScale: 1,
  paused: false,
  asteroidCount: 400,
  diskBrightness: 1.0,
  lensStrength: 1.0,
  gravityEnabled: true,      // can be switched off for performance A/B testing
  debugMode: false,
  overlayVelocity: false,
  overlayForce: false,
  overlayAccel: false,
  overlayPaths: true,
  overlayCOM: false,
  overlayCollision: false,
};

export const BASE_HORIZON   = 9;      // visual radius of a "reference mass" black hole
export const BASE_BH_MASS    = 5000;
export const CAPTURE_MULT    = 1.15;
export const TIDAL_MULT      = 4.2;
export const DRAG_MULT       = 7.5;
export const ESCAPE_R        = 480;
export const SOFTENING       = 2.2;   // gravitational softening to avoid singular blow-ups
export const VELOCITY_DRAG_SCALE = 0.26; // world-units-of-velocity per world-unit of drag
export const AGE_YEARS_PER_SIMSECOND = 6;
export const STAR_LIFESPAN_K = 60000; // heavier stars burn through this much faster (see createStar)

// at high time-scales a single frame can represent many sim-seconds; integrating
// the whole thing in one Euler step would let fast-moving bodies tunnel through
// capture radii or blow up numerically, so we always split big steps into
// bounded sub-steps instead.
export const MAX_SUBSTEP_BODY      = 0.12;
export const MAX_SUBSTEPS_BODY     = 40;
export const MAX_SUBSTEPS_ASTEROID = 8;

export const COLLISION_MERGE_SPEED = 12; // relative speed below which bodies merge instead of fragmenting
export const COLLISION_GRACE_MS = 900;   // newly spawned bodies are briefly immune (e.g. a moon placed close to its planet)

export const state = {
  // simulation clock
  simTime: 0,
  simYears: 0,
  gravityCalcCount: 0, // reset each frame, used by the debug overlay

  // body registry
  bodies: [],
  idCounter: 1,
  selected: null,
  followTarget: null,

  // asteroid field (parallel arrays + the instanced mesh that renders them)
  asteroidMesh: null,
  aPos: [], aVel: [], aAcc: [], aMass: [], aRadius: [], aAlive: [],

  // debris that spirals into a black hole after a tidal disintegration
  fragments: [],

  // camera
  cameraMode: 'free',
  cameraTween: null,
  shakeState: null,

  // object placement / drag-to-launch
  placement: null,
  ghostMarker: null,

  // misc UI state
  browserCollapsed: true,

  // debug HUD stats (written by physics.js / main.js, read by ui.js)
  lastPhysicsMs: 0,
  lastSubsteps: 1,
  fpsSmoothed: 60,
};
