# Event Horizon // Gravitational Observatory

A full interactive gravitational sandbox built with **Three.js**: a real N-body physics simulation, not an animation. Black holes, stars, planets, moons, comets, and asteroid fields all pull on each other under Newtonian gravity; orbits, slingshots, tidal destruction, supernovae, and black hole mergers all emerge from that gravity rather than being scripted.

---

## Running it

No build step, no install. Open `index.html` in a modern desktop or mobile browser (Chrome, Firefox, Safari, Edge). Three.js and its addons load from a CDN via an import map, so an internet connection is required.

The project is a set of ES modules — keep the folder structure intact:

```
blackhole/
├── index.html
├── style.css
└── src/
    ├── main.js          entry point: initial population + the animation loop
    ├── state.js         CONFIG + all shared mutable state
    ├── scene.js         renderer, camera, lights, composer, accretion-disk shader
    ├── camera.js        camera modes, smooth "fly to" transitions, screen shake
    ├── objects.js       CelestialBody class hierarchy + factories + trails
    ├── asteroids.js     the instanced asteroid field
    ├── physics.js       N-body gravity, Velocity Verlet integration, collisions
    ├── effects.js       disk bursts, fragments, star lifecycle, supernovae
    ├── selection.js     raycasting, selection, the info panel
    ├── creation.js      context menu + click-drag object placement
    ├── events.js        the event log / timeline + toast banners
    ├── ui.js            debug HUD, overlays, object browser, control-deck wiring
    └── saveload.js       generate/save/load/export a universe
```

`index.html` loads `src/main.js` as a module; everything else is pulled in via `import`. Because `localStorage` is scoped per-origin, Save/Load is most reliable when served from a local server (`python3 -m http.server`, VS Code's Live Server, etc.) rather than opened directly as a `file://` URL — Export-to-file works either way.

---

## Controls

| Input | Action |
|---|---|
| Drag | Orbit the camera |
| Scroll / pinch | Zoom |
| Click / tap an object | Select it — shows a glowing ring, velocity vector, predicted trajectory, and sphere of influence |
| Click / tap empty space | Deselect |
| Right-click empty space, or **Create Object** | Open the spawn menu (Star / Planet / Moon / Asteroid / Comet / Black Hole) |
| Long-press empty space (touch) | Same spawn menu, for mobile |
| While placing an object | **Click** for an automatic stable orbit, or **click-drag** to aim and set an exact launch velocity — a live predicted path is shown while you drag |

**Control Deck** (left panel):
- **Time**: pause, or run from 0.1x to 1000x; a `SIMULATION TIME` readout tracks elapsed in-universe years
- **Gravity**: black hole mass, the gravitational constant `G`, and a gravity on/off toggle for A/B testing
- **Field**: asteroid count, accretion disk brightness, gravitational lensing strength
- **Camera**: Follow / Auto-Orbit toggle for the selected object, and a Black Hole View button with a smooth flight instead of a snap-cut
- **Create**: opens the same spawn menu as right-click
- **Universe**: Generate New Universe (fully random system), Save / Load (browser storage), Export (.json download)

**Right panel**: a collapsible **Object Browser** (click any body to select + fly to it), the selected object's live telemetry, and the **Event Log** — a clickable timeline where anything marked with `↗` jumps the camera to where it happened.

A `⚙` icon in the top bar opens the **Physics Debug HUD**: FPS, physics-step timing, object/asteroid counts, gravity-calculation count, and — for the selected object — velocity, acceleration, kinetic and potential energy. It also has six independent overlay toggles: velocity vectors, force vectors, acceleration vectors, orbital paths, center of mass, and collision radii.

---

## What's simulated

- **N-body gravity** — every star, planet, moon, comet, and black hole attracts every other one (`F = G·M·m / r²`); asteroids feel all of them as test particles. Nested orbits (moon → planet → star → black hole) emerge naturally from mass and distance, not from parent-child scripting.
- **Velocity Verlet integration** — position and velocity are integrated together across all bodies each sub-step (move using current acceleration, recompute acceleration at the new position, then average old/new acceleration into the velocity update), which conserves orbital energy far better than a naive Euler step, especially at high time-acceleration.
- **Sub-stepping for stability** — large simulated steps (from high time-scale) are automatically split into smaller bounded sub-steps so fast objects can't tunnel through a black hole's capture radius or blow up numerically.
- **Tidal destruction** — objects that stray too close to a black hole stretch, destabilize, and then gradually disintegrate into fragments that spiral in and flare the accretion disk, rather than simply vanishing.
- **Body-body collisions** — any two non-black-hole bodies that touch either merge (slow encounter — mass/momentum conserved, radius combines by volume) or shatter into a scattered debris field of new asteroids (fast encounter), with a spawn-grace period so a moon placed deliberately close to its planet doesn't instantly get eaten by its own creation.
- **Star lifecycle** — stars age, swell into red giants/supergiants partway through their (mass-dependent) lifespan, then either fade to a white dwarf or go supernova — collapsing into a neutron star or, for the most massive stars, a brand new black hole that immediately rejoins the simulation.
- **Black hole mergers** — two black holes that drift close enough decay out of their mutual orbit and merge into one larger one, with a rippling multi-ring "gravitational wave" effect.
- **Gravitational slingshots** — fast flybys that curve around a black hole and pull away are detected and logged; nothing prevents you from engineering one deliberately via the drag-to-launch tool.
- **Accretion disk** — a custom GLSL shader renders turbulent, differentially-rotating (faster near the center) plasma, and reactively brightens/pulses whenever something is consumed.
- **Gravitational lensing** — a post-processing pass warps the background starfield around each black hole's screen position.
- **Automatic performance scaling** — if the frame rate stays low for a sustained stretch, the asteroid field is quietly thinned once (and only once) rather than left to keep bogging down.

This is a *stylized*, not scientifically rigorous, simulation — some effects (star lifespans compressed to be watchable, "c" velocity readouts, the artificial inspiral drag near a black hole) are dramatized for pacing and visual clarity rather than strict general relativity.

---

## Customizing

Shared config and tunable constants live in `src/state.js`:

```js
export const CONFIG = {
  G: 0.6, blackHoleMass: 5000, timeScale: 1,
  asteroidCount: 400, diskBrightness: 1.0, lensStrength: 1.0,
  gravityEnabled: true, debugMode: false, ...
};

export const BASE_HORIZON = 9;        // visual size of a reference-mass black hole
export const CAPTURE_MULT = 1.15;     // → capture radius
export const TIDAL_MULT   = 4.2;      // → tidal-stress radius
export const DRAG_MULT    = 7.5;      // → orbital-decay radius
export const ESCAPE_R     = 480;
export const COLLISION_MERGE_SPEED = 12;  // below this relative speed, colliding bodies merge; above, they shatter
export const MAX_SUBSTEP_BODY = 0.12;     // integration stability at high time-scale
```

Visual styling (colors, fonts, HUD layout) lives in `style.css`.

---

## Architecture notes

Almost every module in `src/` shares mutable data (the body list, the current selection, sim time, ...). ES modules give you live *read* access to another module's exports, but you can never reassign an imported binding from outside its home module — so instead of scattered `export let` primitives, every shared mutable value is a **property on the single `state` object** exported from `state.js`. Modules read/write `state.bodies`, `state.selected`, etc.; only the property changes, never the object identity, so every module always sees the same live data.

A few modules import from each other in both directions (e.g. `selection.js` needs `destroyObject` from `effects.js`, and `effects.js` needs `deselect` from `selection.js`). This is safe here because every such reference is used inside a function body — never at a module's top level — and is always a hoisted `function` declaration, so it's available the moment its module starts evaluating, cycle or not.

---

## Performance notes

- Asteroids render as a single `InstancedMesh` with a spatial grid for collision checks and Velocity Verlet integration at no extra cost over the old scheme (same number of gravity calculations per asteroid per sub-step).
- If things feel sluggish, lower **Asteroid Count** first — it's the biggest lever, and the sim will also do this automatically after a few seconds of sustained low frame rate.
- Bloom and lensing are full-screen post-process passes (`src/scene.js`); on lower-end GPUs, reduce `diskBrightness`/`lensStrength` or the `UnrealBloomPass` strength there to lighten the load.
