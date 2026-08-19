# Event Horizon // Gravitational Observatory

An interactive gravitational astrophysics sandbox built with **Three.js** and WebGL. Rather than scripted animations, **Event Horizon** simulates direct-sum N-body Newtonian gravitation with Plummer softening and symplectic second-order **Velocity Verlet** integration. Orbits, relativistic slingshots, tidal disruptions, accretion flares, stellar evolution, supernovae, and binary black hole mergers emerge dynamically from the underlying physics.

---

## Getting Started

No build tools, bundlers, or package installation steps are required. Open `index.html` in any modern desktop or mobile browser (Chrome, Firefox, Safari, Edge). Three.js and post-processing modules load via an ES Module Import Map from CDN.

### Recommended Local Server

Because browser security policies isolate `localStorage` by origin, running from a local HTTP server ensures persistent Save/Load functionality across sessions:

```bash
# Python 3
python -m http.server 8000

# Node.js / npx
npx serve .
```

*Note: The **Export Data (.json)** feature functions in all environments, including direct `file://` execution.*

---

## Directory Structure

```
Event Horizon/
├── index.html          Observatory HTML5 layout, UI panels, canvas, and import maps
├── README.md           Technical documentation and user guide
├── CHANGELOG.md        Version history and maintenance pass records
├── css/
│   └── style.css       Design tokens, responsive grid/flex layout, and UI themes
└── src/
    ├── main.js         Application bootstrap, initial population, and animation loop
    ├── state.js        Global simulation parameters (CONFIG), constants, and shared state
    ├── scene.js        Three.js WebGL renderer, perspective camera, lights, and shaders
    ├── camera.js       Camera tracking modes (free/follow/orbit), tweens, and camera shake
    ├── objects.js      CelestialBody class hierarchy, factories, and orbital trail buffers
    ├── asteroids.js    Instanced asteroid particle field, spatial hashing, and collisions
    ├── physics.js      N-body gravity, Velocity Verlet integrator, and celestial collisions
    ├── effects.js      Accretion disk reactivity, tidal fragments, and supernova lifecycles
    ├── selection.js    Raycasting selection, Hill sphere calculations, and inspector telemetry
    ├── creation.js     Pointer interaction, drag-to-aim launch vectors, and context menus
    ├── events.js       Chronological event logging with coordinate jump links and toasts
    ├── ui.js           Physics telemetry HUD, debug overlays, and object browser tree
    ├── textures.js     Procedural canvas texture generators for glows and rings
    └── saveload.js     Version 3 state serialization, two-phase loading, and universe generation
```

---

## Observatory Controls

| Input | Action |
|---|---|
| **Left Click + Drag** | Orbit the observation camera |
| **Scroll / Pinch** | Smooth zoom in / out |
| **Click / Tap Object** | Focus and select (displays focus ring, velocity vector, predicted trajectory, and Hill sphere) |
| **Click / Tap Empty Space** | Clear selection and return to global context |
| **Right-Click / Long-Press** | Open radial creation context menu (*Star, Planet, Moon, Asteroid, Comet, Black Hole*) |
| **Placement Drag** | **Click** for an automated circular Keplerian orbit, or **click-drag** to aim and set an exact launch velocity with real-time trajectory prediction |

### Control Deck (Left Dock)

* **Time**: Pause or accelerate simulation time from `0.1x` to `1000x`. An in-universe mission clock tracks elapsed astronomical centuries and years.
* **Gravity**: Real-time tuning of primary singularity mass, universal gravitational constant $G$, and a master gravity toggle for performance A/B comparison.
* **Physics**: Sub-step timestep slider ($\Delta t$) controlling numerical integration granularity independent of simulation playback speed.
* **Field**: Asteroid field particle count, accretion disk shader brightness, gravitational lensing refraction strength, orbital trail visibility, and trail buffer length.
* **Camera**: Switch between **Free**, **Follow**, and **Auto-Orbit** tracking modes, or trigger smooth orbital focus transitions (**Black Hole View** / **Enter Star System**).
* **Universe Management**: **Generate New Universe** (randomized procedural system), **Save / Load** (browser `localStorage`), and **Export Data** (`.json` file download).

### Inspector & Telemetry (Right Dock)

* **Hierarchical Breadcrumb**: Centered navigational bar displaying orbital lineage (e.g. `UNIVERSE › SAGITTARIUS PRIME › SOL › TERRA › LUNA`).
* **Object Browser**: Categorized tree listing active celestial bodies with one-click camera focus framing.
* **Celestial Telemetry Panel**: Live physical metrics including velocity ($c$), orbital period ($T$), surface temperature ($K$), age, evolutionary lifecycle stage, tidal stress percentage, and Hill sphere radius ($r_H$).
* **Event Log**: Chronological timeline of astronomical events. Entries tagged with $\nearrow$ are interactive and jump the camera directly to the event coordinates.
* **Physics Debug HUD** (`⚙` icon): Displays real-time FPS, sub-step counts, sub-millisecond execution times (gravity, collisions, asteroid field), total gravity evaluations per frame, and kinetic/potential orbital energy profiles ($E_k$, $U$). Includes vector overlays for velocity, net force, acceleration, center of mass, and collision boundaries.

---

## Physical Simulation Engine

* **N-Body Gravitational Dynamics**: Every massive entity exerts mutual gravitational attraction using Newton's law with Plummer softening:
  $$\vec{a}_i = \sum_{j \neq i} \frac{G M_j (\vec{r}_j - \vec{r}_i)}{\left(|\vec{r}_j - \vec{r}_i|^2 + \epsilon^2\right)^{3/2}}$$
* **Symplectic Velocity Verlet Integration**: Preserves phase space volume and maintains long-term orbital energy conservation over large simulation timescales:
  $$\vec{x}(t + \Delta t) = \vec{x}(t) + \vec{v}(t)\Delta t + \frac{1}{2}\vec{a}(t)\Delta t^2$$
  $$\vec{v}(t + \Delta t) = \vec{v}(t) + \frac{1}{2}\left(\vec{a}(t) + \vec{a}(t + \Delta t)\right)\Delta t$$
* **Adaptive Sub-Stepping**: Large frame deltas (e.g., at $1000\times$ time acceleration) are automatically subdivided into bounded numerical sub-steps ($\le \text{maxSubstep}$) to eliminate orbital tunneling through capture radii.
* **Roche Limit & Tidal Disruption**: Celestial bodies entering a black hole's tidal disruption zone undergo physical mesh elongation along their tangential orbital vector before fragmenting into debris that spirals into the event horizon.
* **Relativistic Binary Black Hole Mergers**: Proximity encounters between singularities trigger orbital energy dissipation, spiral coalescence into a combined remnant, and outward gravitational wave shockwaves.
* **Stellar Evolution**: Stars age according to mass-luminosity scaling ($t_{\text{life}} \propto M^{-1.6}$), expanding into red giants or supergiants before collapsing into white dwarfs, neutron stars, or stellar-mass black holes via core-collapse supernovae.
* **Collisions & Coalescence**: Low-velocity encounters ($|v_{\text{rel}}| < 12\text{ u/s}$) conserve linear momentum and volume to merge bodies into larger objects; high-velocity impacts shatter progenitors into asteroid debris clouds.

---

## State Persistence & Save Format (Version 3)

The simulation uses a versioned JSON state serialization schema (`Version 3`) that captures the full operational environment:

* **Physical State**: Position, velocity, mass, visual radius, surface temperature, age, lifespan, and stellar stage.
* **Hierarchical Relationships**: Parent/child linkages (e.g. moons orbiting planets) are serialized via stable array index references (`parentIndex`) and reconstructed in a two-phase deserialization pass.
* **Camera & Viewport**: Exact camera Cartesian coordinates, OrbitControls target look-at, tracking modes, and active selection markers.
* **Configuration Integrity**: Parameter values are clamped against safe physical bounds on load to prevent numerical instability.
* **Backward Compatibility**: Automatically detects and loads legacy Version 2 saves without hierarchical relationship errors.

---

## Browser Compatibility & Validation

* **ES Module Compatibility**: Uses native browser ES modules with an HTML5 `<script type="importmap">` targeting CDN-hosted Three.js r160.
* **WebGL Requirements**: Compatible with all standard WebGL 1.0 / 2.0 implementations supporting `OES_texture_float` and standard derivative extensions.
* **Cross-Browser Verification**: Verified across Chromium-based browsers (Chrome, Edge, Brave), Firefox, and Safari on desktop and mobile viewports.
* **Testing & Quality Assurance Approach**:
  * *Static Verification*: Node.js syntax parsing (`node --check`) across all modules.
  * *Headless / CI Validation*: DOM reference and module dependency graph verification.
  * *Interactive Browser QA Matrix*: Verification of WebGL context initialization, GLSL shader compilation, OrbitControls gesture dampening, touch long-press context menus, and `localStorage` exception handling.

---

## Performance Optimizations

1. **Instanced Rendering**: Asteroids render via a single Three.js `InstancedMesh` with dynamic transform buffer updates.
2. **Spatial Hash Partitioning**: Inter-asteroid collisions use a 2D spatial hash grid on the orbital plane ($O(N)$ broad-phase search).
3. **Memory Allocations**: Inner physics integration loops utilize persistent scratch buffers (`_newAcceleration`, reusable vector pools, and circular array buffers for trails) to eliminate runtime garbage collection stutter.
4. **Automated Adaptive Scaling**: Two-tier automatic performance protection:
   * *Tier 1*: Thins asteroid field density if framerate drops below 30 FPS.
   * *Tier 2*: Downsamples WebGL pixel ratio to $1.0\times$ on high-DPI displays if framerate remains constrained.

---

## Known Limitations & Approximations

* **Stylized Units**: Mass, distances, and velocities are scaled for interactive real-time observation and visual pacing rather than exact general relativistic metrics.
* **Screen-Space Gravitational Lensing**: Lensing distortion is computed via a post-processing ShaderPass mapped to the projected screen-space coordinate of the primary dominant singularity.
* **Trajectory Line Prediction**: Predictive orbit paths are computed via single-attractor forward integration at each step to deliver responsive $O(N)$ rendering during live dragging.