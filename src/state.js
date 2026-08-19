/**
 * @file state.js
 * @description Centralized application state and simulation constants for Event Horizon.
 *
 * Exposes the immutable simulation configuration defaults (CONFIG) and a shared mutable
 * state container (`state`). Cross-module updates mutate properties on `state` to maintain
 * consistent references across ES module boundaries without requiring re-exports.
 */

/**
 * Global runtime simulation parameters, controllable via UI sliders and serializable to save files.
 */
export const CONFIG = {
  G: 0.6,                    // Gravitational constant scaling factor
  blackHoleMass: 5000,       // Reference mass of the primary singularity (M☉)
  timeScale: 1,              // Simulation time multiplier
  paused: false,             // Simulation pause state
  asteroidCount: 400,        // Active asteroid particle capacity
  diskBrightness: 1.0,       // Accretion disk shader intensity multiplier
  lensStrength: 1.0,         // Gravitational lensing post-processing distortion strength
  lensingEnabled: true,      // Master gravitational lensing post-processing switch
  dopplerBeamingEnabled: true,// Relativistic accretion disk Doppler beaming & gravitational redshift switch
  tidalDisruptionEnabled: true,// Relativistic continuous tidal disruption & plasma streams switch
  tdeStreamDensity: 1.0,     // Tidal disruption stream particle emission density multiplier (0.5x - 2.0x)
  tdeViscousTimescale: 6.0,  // Viscous accretion timescale (simulation seconds) for disk -> BH mass transfer
  tdeDiskThickness: 1.2,     // Effective accretion disk half-thickness for stream-disk swept intersection
  tdeCircularizationTimescale: 1.5, // Time constant (simulation seconds) for circularization velocity damping
  tdeCircVelocityThreshold: 0.08,  // Relative velocity ratio threshold (|v_rel| / v_circ) for circularization completion
  tdeMaxCircularizationTime: 3.5,   // Maximum duration (simulation seconds) for circularizing state before disk assimilation
  tdeSpinEvolutionEnabled: true,    // Relativistic Kerr spin evolution from accretion angular momentum torque
  tdeEddingtonLimitEnabled: true,   // Eddington luminosity and accretion rate diagnostics & clamping
  gravityEnabled: true,      // Master gravitational interaction switch (A/B performance testing)
  frameDragging: true,       // Kerr-inspired Lense-Thirring frame-dragging acceleration switch
  timeDilationEnabled: true, // Relativistic gravitational and kinematic time dilation switch
  debugMode: false,          // Physics debug HUD and overlay visibility
  overlayVelocity: false,    // Render velocity vector arrows
  overlayForce: false,       // Render net force vector arrows
  overlayAccel: false,       // Render net acceleration vector arrows
  overlayFrameDrag: false,   // Render Lense-Thirring frame-dragging acceleration vector arrows
  overlayPaths: true,        // Render orbital trajectory trails
  overlayCOM: false,         // Render system center of mass indicator
  overlayCollision: false,   // Render collision boundary wireframes
  trailsEnabled: true,       // Global motion trail visibility
  trailLength: 140,          // Sample point capacity per orbital trail buffer
  maxSubstep: 0.12,          // Maximum integration timestep size (seconds) per physics sub-step
};

/* ============================================================================
   ASTROPHYSICAL AND NUMERICAL CONSTANTS
   ============================================================================ */

/** Maximum number of active black hole gravitational lenses evaluated in the screen-space shader */
export const MAX_LENSES = 8;

/** Relativistic reference speed of light constant (simulation velocity units: u/s) */
export const C_SIM = 60;

/**
 * Standard mass classifications for black hole singularities.
 * Decoupled from spin (any mass class can possess arbitrary Schwarzschild or Kerr spin).
 */
export const BH_MASS_CLASSES = {
  supermassive: {
    id: 'supermassive',
    label: 'Supermassive Singularity',
    massRange: [1000, 20000],
    defaultMass: 5000,
    defaultSpin: 0.85,
    hasDisk: true,
    diskScale: 6.5,
    description: 'Galactic-core supermassive black hole with an extensive accretion disk.',
  },
  intermediate: {
    id: 'intermediate',
    label: 'Intermediate-Mass Black Hole',
    massRange: [100, 1000],
    defaultMass: 450,
    defaultSpin: 0.50,
    hasDisk: true,
    diskScale: 5.0,
    description: 'Mid-scale black hole formed in dense stellar clusters.',
  },
  stellar: {
    id: 'stellar',
    label: 'Stellar Black Hole',
    massRange: [10, 100],
    defaultMass: 35,
    defaultSpin: 0.70,
    hasDisk: true,
    diskScale: 4.0,
    description: 'Compact remnant of a massive star core-collapse supernova.',
  },
  primordial: {
    id: 'primordial',
    label: 'Primordial Micro Singularity',
    massRange: [0.5, 10],
    defaultMass: 3.5,
    defaultSpin: 0.00,
    hasDisk: false,
    diskScale: 0.0,
    description: 'Early-universe micro black hole exhibiting high-energy evaporation glow.',
  },
};

/** Visual radius of a standard 5000 M☉ black hole event horizon */
export const BASE_HORIZON = 9;

/** Reference mass used for cubic-root scale normalizations */
export const BASE_BH_MASS = 5000;

/** Multiplier defining the gravitational capture (event horizon) radius */
export const CAPTURE_MULT = 1.15;

/** Multiplier defining the Roche limit / tidal disruption threshold */
export const TIDAL_MULT = 4.2;

/** Multiplier defining the accretion disk hydrodynamic drag boundary */
export const DRAG_MULT = 7.5;

/** Maximum boundary distance from origin before an object is classified as escaped */
export const ESCAPE_R = 480;

/** Plummer gravitational softening factor to prevent numerical singularities at r -> 0 */
export const SOFTENING = 2.2;

/** Velocity scaling factor applied to drag-launch vector magnitude (world units to velocity) */
export const VELOCITY_DRAG_SCALE = 0.26;

/** Conversion factor: simulation seconds elapsed per simulation year */
export const AGE_YEARS_PER_SIMSECOND = 6;

/** Scaling factor for stellar main-sequence lifespan calculations (t ~ M^-1.6) */
export const STAR_LIFESPAN_K = 60000;

/** Hard upper limit on numerical sub-steps per frame for massive bodies */
export const MAX_SUBSTEPS_BODY = 40;

/** Hard upper limit on numerical sub-steps per frame for asteroid field integration */
export const MAX_SUBSTEPS_ASTEROID = 8;

/** Relative velocity threshold (world units/s) below which collisions merge rather than shatter */
export const COLLISION_MERGE_SPEED = 12;

/** Grace period (ms) following body creation during which collision checks are suppressed */
export const COLLISION_GRACE_MS = 900;

/**
 * Emergency numerical clamping ceiling (u/s^2) applied strictly to prevent NaN/Infinity
 * propagation during extreme near-singularity coordinate encounters or high timeScale values.
 * NOTE: This is an engine crash prevention safeguard, NOT a physical relativistic limit.
 */
export const NUMERICAL_SAFETY_LIMIT = 250.0;

/** Scaling factor applied to Kerr Lense-Thirring frame-dragging acceleration */
export const FRAME_DRAG_SCALE = 1.0;

/* ============================================================================
   SHARED RUNTIME STATE CONTAINER
   ============================================================================ */

/**
 * Mutable state singleton shared across simulation, rendering, and UI modules.
 */
export const state = {
  // Simulation timers
  simTime: 0,
  simYears: 0,
  gravityCalcCount: 0,

  // Celestial body registry
  bodies: [],
  idCounter: 1,
  selected: null,
  followTarget: null,

  // Instanced asteroid field (parallel arrays for contiguous memory layout)
  asteroidMesh: null,
  aPos: [],
  aVel: [],
  aAcc: [],
  aNewAcc: [],
  aMass: [],
  aRadius: [],
  aAlive: [],

  // Tidal disruption debris fragments & continuous plasma streams
  fragments: [],
  tdeManager: null,
  activeTdeCount: 0,
  tdeEjectaMass: 0,
  tdeTotalAccretedMass: 0,
  tdeTotalRadiatedMass: 0,

  // Camera animation and kinematic state
  cameraMode: 'free',
  cameraTween: null,
  shakeState: null,

  // Interactive object placement state
  placement: null,
  ghostMarker: null,

  // UI state
  browserCollapsed: true,

  // Performance telemetry and profiling metrics (ms)
  lastPhysicsMs: 0,
  lastGravityMs: 0,
  lastCollisionMs: 0,
  lastAsteroidMs: 0,
  lastSubsteps: 1,
  fpsSmoothed: 60,
  activeLensesCount: 0,
};