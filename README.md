# Event Horizon // Gravitational Observatory

An interactive, cinematic black hole simulation built with **Three.js**. Watch stars, planets, comets, and asteroids orbit a central singularity under a simplified Newtonian gravity model, spawn your own objects, and watch what happens when they stray too close to the event horizon.

---

## Running it

No build step, no install. Just open `index.html` in a modern desktop or mobile browser (Chrome, Firefox, Safari, Edge). Three.js and its addons load from a CDN via an import map, so an internet connection is required the first time.

Keep all three files in the same folder — `index.html` links to `style.css` and `script.js` by relative path:

```
blackhole/
├── index.html
├── style.css
└── script.js
```

---

## Controls

| Input | Action |
|---|---|
| Drag | Orbit the camera around the black hole |
| Scroll / pinch | Zoom in and out |
| Click / tap an object | Select it and open its data panel |
| Click / tap empty space | Deselect |
| Right-click empty space | Open the spawn menu (Create Planet / Star / Asteroid / Comet / companion Black Hole) |
| Long-press empty space (touch) | Same spawn menu, for mobile |

The **Control Deck** (left panel) lets you:
- Pause/play and set simulation speed (0.25x – 100x)
- Adjust black hole mass and the gravitational constant (`G`)
- Change the asteroid field density
- Adjust accretion disk brightness and gravitational lensing strength
- Follow the selected object with the camera, or snap back to the black hole
- Reset the whole simulation

The **right-hand deck** shows the selected object's live telemetry (mass, distance, velocity, orbital status, tidal stress) and a scrolling **Event Log** reporting captures, tidal disruptions, slingshots, escapes, and asteroid collisions in real time.

---

## What's simulated

- **Gravity** — every star, planet, comet, and asteroid feels a Newtonian pull toward the black hole (`F = G·M·m / r²`), integrated each frame. Increasing black hole mass or `G` visibly reshapes every orbit in the scene.
- **Tidal disruption** — objects that stray inside a threshold radius get stretched, flagged "unstable," and logged; if they cross the event horizon they're consumed in a small particle burst that feeds the accretion disk.
- **Slingshots & escapes** — fast flybys that swing around the hole and pull away are detected and logged, as are objects that drift far enough out to leave the system.
- **Accretion disk** — a custom GLSL shader renders turbulent, differentially-rotating (faster near the center) plasma with a white-hot inner edge fading to orange/red, plus flaring hot spots.
- **Gravitational lensing** — a post-processing pass warps the background starfield around the black hole's screen position.
- **Asteroid field** — hundreds of instanced asteroids with coarse grid-based collision detection and object pooling (captured/escaped asteroids are recycled into new orbits rather than destroyed for good).

This is a *stylized*, not scientifically rigorous, simulation — some effects (like the slow inspiral drag near the horizon, or "c" velocity readouts) are dramatized for visual and narrative effect rather than strict general relativity.

---

## Customizing

Most tunable values live at the top of `script.js`:

```js
const CONFIG = {
  G: 0.6,               // gravitational constant
  blackHoleMass: 5000,
  timeScale: 1,
  asteroidCount: 400,
  diskBrightness: 1.0,
  lensStrength: 1.0,
};

const HORIZON_RADIUS = 9;   // visual size of the event horizon
const CAPTURE_R = ...       // distance at which objects are consumed
const TIDAL_R   = ...       // distance at which tidal stretching begins
const DRAG_R    = ...       // distance at which orbital decay begins
const ESCAPE_R  = 480;      // distance at which objects are considered to have left the system
```

Visual styling (colors, fonts, HUD layout) lives in `style.css`.

---

## Performance notes

- Asteroids are rendered with a single `InstancedMesh` and use a spatial grid for collision checks, so counts up to ~1000+ should stay smooth on most machines.
- If the simulation feels sluggish, lower **Asteroid Count** in the Control Deck first — it's the biggest lever.
- Bloom and lensing are full-screen post-process passes; on lower-end integrated GPUs you can reduce `diskBrightness`/`lensStrength` or edit the `UnrealBloomPass` strength in `script.js` to lighten the load.
