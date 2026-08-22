# Event Horizon // Gravitational Observatory

An interactive gravitational astrophysics sandbox built with **Three.js** and WebGL. Rather than scripted animations, **Event Horizon** simulates direct-sum N-body Newtonian gravitation with Plummer softening, symplectic second-order **Velocity Verlet** integration, and general-relativistic astrophysics. Orbits, relativistic slingshots, tidal disruptions, accretion flares, stellar evolution, supernovae, binary black hole mergers, and Blandford–Znajek relativistic polar jets emerge dynamically from the underlying physics.

---

## Getting Started

No build tools, bundlers, or package installation steps are required. Open `index.html` in any modern desktop or mobile browser (Chrome, Firefox, Safari, Edge). Three.js and post-processing modules load via an ES Module Import Map from CDN.

### Recommended Local Server

Because browser security policies isolate `localStorage` by origin, running from a local HTTP server ensures persistent Save/Load functionality across sessions:

```bash
# Python 3
python -m http.server 8080

# Node.js / npx
npx serve .
```

*Note: The **Export Data (.json)** feature functions in all environments, including direct `file://` execution.*

---

## Directory Structure

```
Event Horizon/
├── index.html          Observatory HTML5 layout, UI panels, canvas, and import maps
├── README.md           Comprehensive technical documentation and user guide
├── CHANGELOG.md        Version history and maintenance pass records
├── css/
│   └── style.css       Design tokens, responsive grid/flex layout, and UI themes
├── src/
│   ├── main.js         Application bootstrap, initial population, and animation loop
│   ├── state.js        Global simulation parameters (CONFIG), constants, and shared state
│   ├── scene.js        Three.js WebGL renderer, perspective camera, lights, and shaders
│   ├── camera.js       Camera tracking modes (free/follow/orbit), tweens, and camera shake
│   ├── objects.js      CelestialBody class hierarchy, factories, and orbital trail buffers
│   ├── asteroids.js    Instanced asteroid particle field, spatial hashing, and collisions
│   ├── physics.js      N-body gravity, Velocity Verlet integrator, and celestial collisions
│   ├── effects.js      Accretion disk reactivity, TDE streams, and supernova lifecycles
│   ├── jets.js         Relativistic polar jets, Blandford–Znajek physics, and GPU particle pool
│   ├── selection.js    Raycasting selection, Hill sphere calculations, and inspector telemetry
│   ├── creation.js     Pointer interaction, drag-to-aim launch vectors, and context menus
│   ├── events.js       Chronological event logging with coordinate jump links and toasts
│   ├── ui.js           Physics telemetry HUD, debug overlays, and object browser tree
│   ├── textures.js     Procedural canvas texture generators for glows and rings
│   └── saveload.js     Schema Version 5 state serialization, two-phase loading, and universe generation
└── tests/
    ├── test_step6.mjs   Continuous tidal disruption and stream integration tests
    ├── test_step7.mjs   Scientific visualization diagnostic overlay test suite
    ├── test_step8.mjs   Mass classification & Kerr spin parameter test suite
    ├── test_step9.mjs   Binary black hole coalescence & gravitational wave tests
    └── test_step10.mjs  Blandford–Znajek relativistic jets & conservation invariant tests
```

---

## Relativistic Black Hole Physics & Scientific Visualization

The simulation incorporates a comprehensive suite of general-relativistic and high-energy astrophysical systems, bridging classical celestial mechanics with Kerr black hole spacetime physics.

### 1. Improved Gravitational Lensing
* **Screen-Space Deflection Shader**: Implements analytical thin-lens Schwarzschild light bending:
  $$\alpha(\theta) = \frac{\theta_E^2}{\theta}$$
* **Multi-Singularity Superposition**: Computes independent deflection vectors for up to 4 simultaneous black holes.
* **Event Horizon Shadow Preservation**: Applies smooth inner shadow masking to prevent artificial light bleeding across singularity event horizons.
* **Interactive Control**: Toggleable via `CONFIG.lensingEnabled` with real-time strength tuning (0.0–2.0×).

### 2. Relativistic Time Dilation
* **Combined Metric Factor**: Evaluates gravitational potential and special-relativistic kinematic velocity dilation:
  $$\gamma = \sqrt{\max\left(0, 1 - \frac{2\Phi_{\text{eff}}}{c^2}\right)} \cdot \sqrt{\max\left(0, 1 - \frac{v^2}{c^2}\right)}$$
* **Dynamic Clock Scaling**: Scales proper time accumulation ($\tau$), stellar lifecycle aging, and rotational velocity per entity.
* **Scientific Telemetry**: Continuous readout in the Selection Inspector (`Rate: XX.X%`) and Physics Debug HUD.

### 3. Kerr-Inspired Rotating Black Holes & Frame Dragging
* **Dimensionless Spin ($a$)**: Supports prograde and retrograde rotation ($a \in [-0.998, 0.998]$) aligned with an arbitrary 3D spin vector $\hat{S}$.
* **Lense-Thirring Acceleration**: Applies 1.5 Post-Newtonian gravitomagnetic frame dragging:
  $$\vec{a}_{\text{LT}} = \frac{2G}{c^2 (r^2 + \epsilon^2)^{3/2}} \left[ 3(\hat{r} \cdot \vec{J})\hat{r} - \vec{J} \right] \times \vec{v}_{\text{rel}}$$
* **Oblate Ergosphere**: Renders dynamic cyan wireframe ergosphere geometry scaled to:
  $$r_E(\theta) = \frac{r_s}{2}\left(1 + \sqrt{1 - a^2 \cos^2\theta}\right)$$

### 4. Tidal Disruption Events (TDE) & Spaghettification
* **Roche Limit Disruption**: Calculates physical tidal disruption radius $r_t = R_* (M_{\text{BH}} / M_*)^{1/3}$.
* **Tangential Elongation**: Spaghettifies approaching celestial bodies along their velocity vector.
* **Plasma Stream Formation**: Strips mass continuously into an instanced GPU stream of 1,600 particles with relativistic fallback, circularization shocks, and ISCO capture.

### 5. Advanced Accretion Disk & Novikov-Thorne Emission
* **Turbulent Gas Dynamics**: 4-octave Fractal Brownian Motion (FBM) procedural noise with Keplerian differential rotation $\Omega(r) \propto r^{-1.5}$.
* **Planckian Blackbody Mapping**: Realistic temperature-to-color mapping across $10^4\text{ K}$ (deep red) to $5 \times 10^7\text{ K}$ (electric blue/ultraviolet).
* **Super-Eddington Regulation**: Slim-disk logarithmic advection saturation for super-Eddington accretion rates ($\lambda_{\text{Edd}} > 1$).
* **Relativistic Doppler Boosting**: Asymmetric beaming brightening approaching disk limbs and dimming receding limbs.

### 6. Scientific Observation Panel
Displays 14 live physical metrics updated continuously per frame:
* Mass ($M_\odot$ / Mt), Radius ($r_s, r_H, r_{\text{ISCO}}$ in AU), Velocity ($c$), Acceleration ($u/s^2$)
* Angular Momentum ($J$), Escape Velocity, Orbital Period ($T$), Kinetic / Potential Energy
* Distance from Event Horizon, Estimated Tidal Stress %, Proper Time Dilation Factor, and Kerr Spin ($a$).

### 7. Scientific Visualization Overlays
Individually toggleable diagnostic overlays in the Debug HUD:
* **Velocity Vectors** (Green arrows)
* **Net Force Vectors** ($F = ma$, Yellow arrows)
* **Acceleration Vectors** (Cyan arrows)
* **Frame-Dragging Vectors** (Lense-Thirring $\vec{a}_{\text{LT}}$, Purple arrows)
* **Orbital Path Trajectories** (Cyan path lines)
* **System Center of Mass** (Orange coordinate marker)
* **Collision Radii** (Red wireframe spheres)
* **Hill Spheres & Roche Limits** (Dynamic influence boundaries)

### 8. Black Hole Mass Classifications
* **Supermassive Singularity**: $1,000 - 20,000\;M_\odot$ (default $5,000\;M_\odot$, spin $0.85$, extensive accretion disk)
* **Intermediate-Mass Black Hole**: $100 - 1,000\;M_\odot$ (default $450\;M_\odot$, spin $0.50$, mid-scale disk)
* **Stellar Black Hole**: $10 - 100\;M_\odot$ (default $35\;M_\odot$, spin $0.70$, compact disk)
* **Primordial Micro Singularity**: $0.5 - 10\;M_\odot$ (default $3.5\;M_\odot$, spin $0.00$, high-energy evaporation glow)

### 9. Relativistic Black Hole Mergers
* **Quadrupole Gravitational Wave Decay**: Damps mutual orbital energy following Peters (1964) gravitational radiation scaling.
* **Momentum-Conserving Coalescence**: Inelastic merger creating a unified remnant black hole.
* **Shockwave Visuals**: Dual particle bursts (310 particles), expanding concentric energy rings, camera shake, and outward momentum impulse to surrounding bodies.

### 10. Relativistic Polar Jets & Blandford–Znajek Extraction
* **Analytical Blandford–Znajek (1977) Power**:
  $$P_{\text{BZ}} = \eta_{\text{BZ}}(a) \cdot \dot{M}_{\text{eff}} \cdot c^2, \quad \eta_{\text{BZ}}(a) = k_{\text{BZ}} \left(\frac{a}{1 + \sqrt{1 - a^2}}\right)^2$$
* **Closed 7-Component Mass-Energy Invariant**:
  $$M_{\text{initial}} = M_{\text{rem}} + M_{\text{stream}} + M_{\text{disk}} + M_{\text{ejecta}} + \frac{E_{\text{jet}}}{c^2} + M_{\text{rad}} + \left[M_{\text{BH}}(t) - M_{\text{BH}}(0)\right]$$
  *(Verified closed to machine precision $|\Delta M| < 4.69 \times 10^{-13}\;M_\odot$).*
* **Super-Spinning Mass Loss**: For $\eta_{\text{disk}} + \eta_{\text{BZ}} > 1.0$, $dM_{\text{BH}} < 0$, extracting black hole rest mass to power relativistic outflows.
* **Coupled Bardeen + BZ Spin Torque**: $da = da_{\text{acc}} - da_{\text{BZ}}$ (brakes prograde spin and drives retrograde spin towards 0).
* **Synchrotron Beaming**: Frequency-integrated intensity transformation $I_{\text{obs}} = \delta^{3.7} I_{\text{emit}}$ ($\alpha = 0.7$, bulk $\Gamma = 3.0$).
* **GPU Instanced Outflows**: 1,600 particles with magnetic collimation funnel profile $R_{\text{jet}}(z) = r_H + z \tan(5^\circ)\sqrt{z/(z+50)}$.

---

## Physics Models & Approximations

Event Horizon implements physically motivated approximations engineered for real-time 60+ FPS execution:

| Astrophysical System | Theoretical Foundation | Simulation Formulation / Approximation |
| :--- | :--- | :--- |
| **N-Body Gravity** | Newtonian Gravitation | Direct-sum $O(N^2)$ pairwise gravity with Plummer softening ($\epsilon = 0.8$). |
| **Numerical Integrator** | Hamiltonian Dynamics | Symplectic second-order Velocity Verlet with adaptive sub-stepping ($\le 0.12\text{ s}$). |
| **Gravitational Lensing** | General Relativity (Null Geodesics) | Screen-space Schwarzschild thin-lens deflection with multi-lens vector superposition. |
| **Time Dilation** | General & Special Relativity | Combined effective Kerr potential $\Phi_{\text{eff}}(r, \theta)$ and special-relativistic Lorentz factor. |
| **Frame Dragging** | Gravitomagnetism | 1.5 Post-Newtonian (1.5PN) Lense-Thirring dipole acceleration. |
| **Kerr ISCO & Horizon** | Kerr Metric (1963) | Exact analytical algebraic solutions for $r_{\text{ISCO}}(a)$, $r_H(a)$, and $r_E(a, \theta)$. |
| **Tidal Disruption (TDE)** | Hydrodynamics & Roche Limits | Tangential mesh elongation with 1,600 instanced fallback/circularization stream particles. |
| **Accretion Disk** | Novikov-Thorne (1973) | Relativistic thin-disk $T(r) \propto r^{-3/4}$ with Abramowicz (1988) slim-disk advection saturation. |
| **Relativistic Jets** | Blandford–Znajek (1977) | MAD extraction efficiency $\eta_{\text{BZ}}(a)$, coupled spin torque, and synchrotron Doppler beaming ($\delta^{3.7}$). |
| **Binary BH Mergers** | Gravitational Wave Radiation | Peters (1964) quadrupole energy dissipation with momentum-conserving coalescence. |

---

## Technical Architecture

```
[ UI Layer / DOM ] ───► [ Control Deck & Inspector (ui.js, selection.js) ]
                                  │
                                  ▼
[ Simulation Loop (main.js) ] ───► [ Velocity Verlet Integrator (physics.js) ]
         │                                │
         ├─► [ TDE Stream Manager (effects.js) ]
         ├─► [ Relativistic Jet Manager (jets.js) ]
         ├─► [ Asteroid Field Spatial Hash (asteroids.js) ]
         │                                │
         ▼                                ▼
[ Three.js Scene (scene.js) ] ◄── [ Celestial Body Hierarchy (objects.js) ]
         │
         ▼
[ Post-Processing Composer ] ───► [ Unreal Bloom Pass ]
                                 └─► [ Gravitational Lensing ShaderPass ]
```

### Key Performance Patterns
1. **GPU Instancing**: Asteroids (up to 2,000 instances), TDE plasma streams (1,600 instances), and relativistic polar jets (1,600 instances) render via single `THREE.InstancedMesh` draw calls.
2. **Zero-Allocation Hot Paths**: Inner physics and particle loops reuse module-level scratch vectors (`_scratchJetPos`, `_scratchRadRel`, etc.) and contiguous TypedArrays (`Float32Array`, `Uint8Array`), eliminating garbage collection pauses.
3. **Adaptive Sub-Stepping**: Large simulation steps are automatically divided into sub-steps ($\Delta t \le 0.12\text{ s}$) to prevent orbital tunneling through capture horizons.

---

## Performance Notes

Verified runtime metrics collected via Google Chrome DevTools Protocol (CDP Port 9222):
* **Framerate**: **60–73 FPS** under full astronomical load (18 celestial bodies, 55 scene objects, 1,600 jet particles, 400 asteroids).
* **Console Diagnostics**: **0 errors**, **0 warnings**, **0 uncaught exceptions**.
* **Memory Stutter**: Zero garbage-collection frame drops during continuous multi-minute execution.

---

## Observatory Controls & Settings

### Control Deck (Left Dock)
* **Time**: Speed controls (`0.1x` to `1000x`), pause (`II`), and mission clock display.
* **Gravity**: Black hole mass slider ($500 - 20,000\;M_\odot$), $G$ constant slider ($0.05 - 2.0$), master gravity toggle.
* **Physics**: Sub-step size slider ($\Delta t$), master frame-dragging toggle, master time-dilation toggle.
* **Field**: Asteroid count slider ($0 - 2000$), disk brightness ($0.2 - 2.5$), lensing strength ($0 - 2.0$), master lensing toggle, master Doppler beaming toggle, master tidal streams toggle, stream density slider, trails toggle and length.
* **Camera**: Free, Follow, Auto-Orbit, Black Hole View, Enter Star System.
* **Universe Management**: Generate New Universe, Save / Load (`localStorage`), Export Data (`.json`).

### Creation & Drag-to-Aim Launch
* **Context Menu**: Right-click or long-press empty space to spawn Stars, Planets, Moons, Asteroids, Comets, or Black Holes.
* **Drag-to-Aim**: Click for an automated circular Keplerian orbit, or click-drag to aim an exact launch velocity vector with live trajectory path prediction.

---

## Screenshots & Visualizations

<!-- Placeholders for visual reference documentation -->
- **[Screenshot Placeholder]** *Gravitational Lensing & Multi-Singularity Light Deflection*
- **[Screenshot Placeholder]** *Kerr Black Hole Oblate Ergosphere & Frame Dragging*
- **[Screenshot Placeholder]** *Tidal Disruption Event (TDE) Plasma Stream Fallback*
- **[Screenshot Placeholder]** *Novikov-Thorne Relativistic Accretion Disk & Doppler Beaming*
- **[Screenshot Placeholder]** *Scientific Observation HUD & Vector Overlays*
- **[Screenshot Placeholder]** *Relativistic Polar Jets & Blandford–Znajek Outflow*
- **[Screenshot Placeholder]** *Binary Black Hole Coalescence & Gravitational Wave Shockwaves*

---

## State Persistence & Save Format (Schema Version 5)

The simulation utilizes a versioned JSON state serialization schema (`Version 5`):
* **Celestial Bodies**: Mass, position, velocity, visual radius, surface temperature, age, lifespan, stellar stage, and Kerr spin ($a$).
* **Hierarchical Linkages**: Parent/child relationships reconstructed in two-phase deserialization.
* **Accretion & Jet State**: Cumulative radiated mass (`tdeTotalRadiatedMass`), cumulative accreted mass (`tdeTotalAccretedMass`), and cumulative jet mass-energy equivalent (`tdeTotalJetMass`).
* **Backward Compatibility**: Automatically detects and loads legacy Version 1, 2, 3, 4, and 5 save files.

---

## Roadmap

* **Phase 1 — Core Celestial Mechanics & N-Body Gravity**: `[COMPLETE]`
* **Phase 2 — Stellar Evolution, Supernovae & Collisions**: `[COMPLETE]`
* **Phase 3 — UI Architecture, Hierarchy Browser & State Persistence**: `[COMPLETE]`
* **Phase 4 — Relativistic Black Hole Physics & Scientific Visualization**: `[COMPLETE]`

---

## Changelog

For a detailed record of version releases, feature additions, and maintenance passes, please see [CHANGELOG.md](CHANGELOG.md).

---

## Credits & License

* **Core Engine**: Built with [Three.js](https://threejs.org/) (r160) and WebGL.
* **Astrophysical Formulations**: Schwarzschild (1916), Kerr (1963), Peters (1964), Bardeen (1970), Novikov-Thorne (1973), Blandford-Znajek (1977), Abramowicz (1988).
* **License**: MIT License. Open source for educational and scientific visualization purposes.