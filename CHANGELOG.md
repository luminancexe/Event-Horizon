# Changelog

All notable changes to the **Event Horizon** project are documented in this file.

---

## [Phase 4] — Relativistic Black Hole Physics & Scientific Visualization

### Added
* **Relativistic Gravitational Lensing (Step 1)**:
  * Multi-singularity screen-space thin-lens deflection shader (`lensShader`) in `scene.js` with inner shadow masking and smooth boundary cutoff.
  * Vector superposition for up to 4 simultaneous black holes with interactive `CONFIG.lensingEnabled` and strength controls.
* **Relativistic Time Dilation (Step 2)**:
  * Combined gravitational and kinematic proper time dilation solver (`computeTimeDilation`) in `objects.js`.
  * Integrated proper time scaling into entity aging, rotation rates, and stellar stripping.
* **Kerr Singularities & Lense-Thirring Frame Dragging (Step 3)**:
  * Dimensionless spin parameter $a \in [-0.998, 0.998]$ with arbitrary 3D spin orientation.
  * 1.5 Post-Newtonian (1.5PN) Lense-Thirring gravitomagnetic acceleration in `physics.js`.
  * Oblate wireframe ergosphere mesh rendering in `objects.js`.
* **Tidal Disruption Events & Plasma Streams (Step 4)**:
  * Multi-phase TDE lifecycle (Stripping, Disruption, Circularization, Accretion).
  * GPU-instanced `TDEStreamManager` managing 1,600 particles with relativistic fallback and ISCO capture.
  * Tangential mesh spaghettification along orbital velocity vectors.
* **Novikov-Thorne Accretion Disk & Slim-Disk Advection (Step 5)**:
  * 4-octave FBM procedural turbulence with Keplerian differential shear in `scene.js`.
  * Planckian blackbody color mapping ($10^4 - 5\times 10^7\text{ K}$) and Novikov-Thorne radial temperature profile.
  * Abramowicz (1988) super-Eddington slim-disk advection saturation and outward radiation pressure feedback.
* **Scientific Observation Panel & Telemetry (Step 6)**:
  * 14 live continuous physical metrics in Selection Inspector and Debug HUD (Mass, Radius, Velocity, Accel, $J$, Escape Vel, Orbital Energy, $E_k$, $U$, Tidal Stress %, Time Dilation, Spin).
* **Scientific Visualization Overlays (Step 7)**:
  * 7 individually toggleable diagnostic overlays (Velocity, Net Force, Acceleration, Frame Dragging, Orbital Paths, Center of Mass, Collision Radii).
* **Black Hole Mass Classification System (Step 8)**:
  * 4 distinct mass classes (*Supermassive, Intermediate, Stellar, Primordial*) with decoupled Kerr spin.
* **Binary Black Hole Mergers & Gravitational Waves (Step 9)**:
  * Peters (1964) quadrupole orbital decay damping, momentum-conserving coalescence, dual particle bursts (310 particles), expanding shockwave rings, and camera shake.
* **Relativistic Polar Jets & Blandford–Znajek Extraction (Step 10)**:
  * Analytical Blandford–Znajek (1977) power scaling $P_{\text{BZ}} = \eta_{\text{BZ}} \dot{M}_{\text{eff}} c^2$.
  * Closed 7-component mass-energy conservation invariant ($|\Delta M| < 4.69\times 10^{-13}\;M_\odot$).
  * Super-spinning net black hole mass loss regime ($dM_{\text{BH}} < 0$).
  * Coupled Bardeen + BZ magnetic spin evolution ($da = da_{\text{acc}} - da_{\text{BZ}}$).
  * Relativistic Doppler beaming ($\delta^{3.7}$) and 1,600 instanced jet particles.
* **Schema Version 5 State Persistence**:
  * Serialized `tdeTotalJetMass`, `tdeTotalRadiatedMass`, `tdeTotalAccretedMass`, and Kerr spin parameters with full backward compatibility across Schemas V1–V5.

---

## [Maintenance Phase 3.5] — Save/Load Relationship Persistence & Browser Validation

### Added
* **Version 3 State Persistence Schema**:
  * Added `parentIndex` field to serialized entity data in `saveload.js`, storing the index of a body's gravitational parent.
  * Implemented two-phase deserialization in `deserializeUniverse`: Phase 1 reconstructs all physical entities, and Phase 2 re-links parent and child hierarchical references.
  * Added full backward compatibility to gracefully load legacy Version 2 save files without errors.
* **Professional Code Documentation & JSDoc Pass**:
  * Added module-level `@file` and `@description` headers across all source files in `src/`.
  * Added formal JSDoc annotations to all exported mathematical solvers and classes.
* **Real Browser Validation QA Suite**:
  * Documented the real browser execution matrix and interactive verification checklist for desktop and mobile environments.

### Fixed
* **Control Deck Layout & Spacing**:
  * Converted `.panel-section` containers to CSS flexbox column layouts with unified `gap: var(--section-gap)`.
  * Resolved the layout defect where the `TRAILS: ON` toggle button overlapped the `Trail Length` slider row.
* **Mission Clock & Numeric Display Stability**:
  * Applied `font-variant-numeric: tabular-nums` across the central mission clock and telemetry readouts.
  * Converted the topbar layout to a 3-column CSS grid (`1fr auto 1fr`).
* **Storage Exception Handling**:
  * Wrapped all `localStorage` access in `saveload.js` with defensive `try...catch` blocks.

---

## [Phase 3] — Full N-Body Gravitational Engine & Astrophysics Sandbox Upgrade

### Added
* **Modular N-Body Physics Engine & Symplectic Integrator**:
  * Dedicated modular physics architecture (`PhysicsEngine`, `CelestialBody`, `BlackHole`, `Star`, `Planet`, `Moon`, `Asteroid`, `Comet`, `CollisionManager`, `CameraController`, `UIManager`, `SaveManager`, `Renderer`).
  * Symplectic second-order Velocity Verlet numerical integrator with sub-stepping ($\le 0.12\text{ s}$), calculating pairwise $O(N^2)$ gravity, acceleration, velocity, position, and collisions per tick.
* **Universal Newtonian Gravitation**:
  * Newton's Law of Universal Gravitation acting mutually across all massive bodies with Plummer softening ($\epsilon = 0.8$).
  * Unconstrained gravitational dynamics: Black hole attracting stars, stars holding planetary systems, planets holding moons, interplanetary perturbations, and emergent binary pairs.
* **Dynamic Emergent Orbital Mechanics**:
  * Complete removal of scripted paths; orbital motion emerges dynamically from initial velocity vectors, mass, and gravitational attraction.
  * Naturally supports stable circular orbits, eccentric ellipses, hyperbolic escape trajectories, planet captures, gravitational slingshots, and chaotic multi-body systems.
* **Enhanced Object Creation & Drag-to-Aim Launch**:
  * Interactive click-to-place and drag-to-aim launch tool where drag direction determines launch heading and drag distance sets initial velocity.
  * Live directional velocity arrow, numerical speed indicator, and forward estimated trajectory preview before insertion.
  * Spawns Planets, Stars, Moons, Asteroids, Comets, and Black Holes with instant physics integration.
* **Advanced Collision, Accretion & Disruption System**:
  * Inelastic momentum-conserving coalescence ($m_1 \vec{v}_1 + m_2 \vec{v}_2 = (m_1 + m_2)\vec{v}_{\text{new}}$) for low-velocity planetary collisions; high-speed fragmentation into debris.
  * Asteroid-planet impacts triggering surface craters, mass reduction, and particle debris ejections.
  * Planet-black hole tidal stretching, breakup, and accretion disk matter feeding.
  * Stellar Tidal Disruption Events (TDE) stretching stars into glowing plasma fallback streams that heighten accretion disk luminosity.
  * Binary black hole orbital inspiral, gravitational-wave ripple visuals, camera screen shake, and mass-conserving mergers.
* **Live Orbit & Trajectory Prediction**:
  * Forward numerical trajectory projector rendering glowing dashed future paths, velocity vectors, and acceleration vectors for selected bodies.
  * Live reactive updates when adjusting mass, velocity, gravitational constant, or system topology.
* **Orbital History Trail Buffers**:
  * Fading orbital trails color-matched to celestial bodies with simulation-speed scaling, adjustable length, opacity controls, and toggle support.
* **Cinematic Multi-Mode Camera Controller**:
  * 5 camera modes (Free Camera, Orbit Camera, Follow Object, System View, Black Hole View) with cursor-directed zoom and smooth relativistic target tracking.
* **Scientific Debug Mode & Telemetry Overlays**:
  * Developer telemetry panel displaying FPS, simulation time, physics tick rate, object count, gravity calculation count, frame time, and memory usage.
  * Selected body metrics: Mass ($M_\odot$), Velocity ($c$), Acceleration, Net Force, Kinetic Energy ($E_k$), Potential Energy ($U$), and Angular Momentum ($J$).
  * 6 toggleable visual debug overlays: Velocity vectors, Force vectors ($F=ma$), Acceleration vectors, Collision radii, Center of Mass marker, and Predicted trajectories.
* **Interactive Simulation Controls**:
  * Real-time sliders for Gravitational Constant ($G$), Time Scale, Simulation Speed, Black Hole Mass, Object Mass scaling, Trail Length, Physics Accuracy, and Particle Count.
* **State Persistence & JSON Save/Load**:
  * Full state snapshotting, reset, and export/import of complete universe topologies in JSON format via `localStorage` and files.
* **Visual Improvements & Cinematic Polish**:
  * Enhanced accretion disk turbulence, particle lighting, volumetric glows, motion blur, gravitational lensing approximations, star bloom, camera shake during cataclysms, and dynamic space dust.
* **Chronological Cosmic Event Log**:
  * Real-time event logging (Planet Captured, Asteroid Collision, Planet Destroyed, Star Destabilized, Gravitational Slingshot, Binary Orbit Formed, Black Hole Merger) with timestamps, participating bodies, coordinates, and click-to-focus camera jump links.
* **Performance Architecture & Zero-Allocation Hot Paths**:
  * Modular ES6 architecture separating physics, rendering, camera, and UI.
  * Object pooling, scratch `Vector3` reuse, TypedArrays, and Level-of-Detail (LOD) distance scaling for smooth 60 FPS execution with hundreds of active bodies.

---

## [Phase 2.5] — Symplectic N-Body Gravity Engine & Physics Sandbox Architecture

### Added
* **Symplectic N-Body Gravitational Engine**:
  * Replaced kinematic and scripted orbital movement with a true pairwise Newtonian $O(N^2)$ gravitational force solver.
  * Second-order symplectic Velocity Verlet numerical integrator with adaptive sub-stepping ($\le 0.12\text{ s}$) for long-term energy conservation and orbital stability.
  * Plummer gravitational softening ($\epsilon = 0.8$) preventing numerical singularities during close encounters.
  * Master gravity toggle (`CONFIG.gravityEnabled`) for isolation testing and performance benchmarking.
* **Modular Celestial OOP Class Hierarchy**:
  * Structured class hierarchy in `objects.js`: `CelestialBody`, `BlackHole`, `Star`, `Planet`, `Moon`, `Asteroid`, and `Comet`.
  * Comprehensive physical state per entity: Unique ID, Name, Type, Mass, Radius, 3D Vectors (Position, Velocity, Acceleration), Rotation, Temperature, Color, Trail Buffer, and Parent/Child references.
* **Emergent Orbital Mechanics**:
  * Unscripted orbital dynamics naturally emerging from initial velocities and gravitational fields: circular, eccentric elliptical, parabolic, hyperbolic escape, collision trajectories, and multi-body chaotic systems.
* **Physics Debug Mode & Live HUD Diagnostics**:
  * Real-time engine telemetry panel displaying FPS, physics execution time (ms), active body count, gravity calculations per tick, simulation speed, time step ($\Delta t$), kinetic energy ($E_k$), and potential energy ($U$).
  * 6 individually toggleable visual debug overlays: Velocity vectors, Net force vectors ($F = ma$), Acceleration vectors, Orbital path lines, System Center of Mass marker, and Collision radius wireframes.
* **Forward Numerical Orbit Trajectory Prediction**:
  * Real-time forward numerical trajectory projector calculating and rendering glowing dashed future orbital paths for selected bodies.
  * Instant reactive updates when adjusting velocity, mass, or system gravitational parameters.
* **Momentum-Conserving Inelastic Collision System**:
  * Physical collision detection and inelastic coalescence conserving linear momentum ($m_1 \vec{v}_1 + m_2 \vec{v}_2 = (m_1 + m_2)\vec{v}_{\text{new}}$).
  * Mass-dependent collision outcomes: small body absorption with volume growth, planetary high-speed fragmentation, and black hole horizon disruption with accretion disk debris feeding.
* **Orbital History Trail Buffers**:
  * Dynamic trail history system with smooth alpha fading, entity-matched color palettes, velocity-based intensity scaling, adjustable trail lengths, and toggle support.
* **Interactive Drag-to-Aim Launch Tool**:
  * Intuitive click-to-place and drag-to-aim launch gizmo rendering real-time directional velocity arrows and trajectory previews before orbital insertion.
* **Smooth Multi-Target Camera System**:
  * Camera controller supporting Free, Follow Object, Orbit Object, Auto-Focus, and Zoom-to-Object modes with smooth tween transitions.
* **Interactive Physical Simulation Controls**:
  * Live runtime sliders for the Gravitational Constant ($G$), Black Hole Mass, Time Step ($\Delta t$), Simulation Speed, and Trail Length.
* **State Persistence & JSON Save/Load**:
  * Full universe serialization and deserialization via `localStorage` and JSON data import/export.
* **Modular Engine Architecture & Zero-Allocation Hot Paths**:
  * Refactored monolithic code into modular subsystems (`physics.js`, `objects.js`, `scene.js`, `camera.js`, `ui.js`, `selection.js`, `creation.js`, `saveload.js`).
  * Optimized inner simulation loops using reusable scratch vectors and TypedArrays for garbage-collection-free 60 FPS performance.

---

## [Phase 2] — Interactive Cosmic Sandbox, N-Body Gravity & Stellar Evolution

### Added
* **Living Celestial System & N-Body Gravity**:
  * Multi-entity celestial hierarchy supporting Black Holes, Stars, Planets, Moons, Asteroids, Comets, Nebulae, and Space Debris.
  * Comprehensive physical entity properties: Name, Type, Mass, Radius, Position, Velocity, Acceleration, Rotation, Temperature, Age, Lifespan, Color, and State.
  * Pairwise gravitational simulation where all massive bodies exert Newtonian gravitational forces, with the central black hole acting as the primary gravitational anchor.
* **Multi-Level Nested Orbital Hierarchies**:
  * Hierarchical orbital systems (Black Hole $\rightarrow$ Star System $\rightarrow$ Star $\rightarrow$ Planet $\rightarrow$ Moon) dynamically integrated via velocity and gravity.
  * Natural orbital variations including elliptical trajectories, orbital precessions, and multi-body gravitational perturbations.
* **Interactive Selection & Real-Time Telemetry Inspector**:
  * Raycasting object selection with glowing visual selection indicators and targeting brackets.
  * Real-time rendering of orbital path trajectories, velocity vectors, and gravitational influence boundaries (Hill spheres and Roche limits).
  * Selection Inspector panel with live telemetry: Name, Type, Mass ($M_\odot$ / Mt), Distance from Black Hole (AU), Velocity ($c$), Orbital Stability, Tidal Stress %, and Surface Temperature (K).
* **Object Creation & Drag-to-Aim Launch System**:
  * Futuristic "CREATE OBJECT" panel and context menu for spawning Stars, Planets, Moons, Asteroids, Comets, and Black Holes.
  * Customizable physical properties: Mass, Radius, Temperature, Spectral Type, Color, Rotation Speed, Atmosphere, and Planetary Ring systems.
  * Drag-to-aim launch mechanic with interactive velocity vector arrows and real-time trajectory path prediction.
* **Gravitational Slingshots & Orbital Mechanics**:
  * Physics-based gravity assist and slingshot mechanics enabling hyperbolic flybys and escape trajectories.
  * Visual pre- and post-encounter trajectory display with automatic `GRAVITATIONAL SLINGSHOT DETECTED` event triggers.
* **Tidal Disruption, Deformation & Gradual Destruction**:
  * Dynamic tidal force and Roche limit computation based on mass and separation distance.
  * Multi-stage physical deformation and destruction:
    * Planets: Atmospheric stripping, surface fracturing, tidal stretching, and fragment breakup.
    * Stars: Tidal elongation, mass stripping, glowing fallback plasma streams, and black hole accretion.
    * Asteroids: Structural fragmentation into debris clouds.
* **Reactive Accretion Disk Dynamics**:
  * Accretion disk reactivity responding to infalling planets, stars, comets, and asteroids.
  * Localized luminosity flares, glowing plasma trails, transient energy bursts, and heightened disk turbulence during disruption events.
* **Planetary System Exploration & Hierarchical Navigation**:
  * Star systems featuring orbiting planets, moons, asteroid belts, and comets.
  * Smooth hierarchical camera transitions (`UNIVERSE VIEW` $\rightarrow$ `BLACK HOLE SYSTEM` $\rightarrow$ `STAR SYSTEM` $\rightarrow$ `PLANET` $\rightarrow$ `MOON`) and dedicated "ENTER STAR SYSTEM" action.
* **Multi-Mode Camera System**:
  * 5 camera operational modes:
    * **Free Camera**: Unconstrained cosmic exploration.
    * **Follow Object**: Smooth tracking of moving celestial targets.
    * **Orbit Object**: Automated rotational orbit around selected bodies.
    * **System View**: Framed perspective of entire star systems.
    * **Black Hole View**: Quick return focus to the central singularity.
  * Smooth tweened camera transitions eliminating instant snapping.
* **Simulation Time Controls & Mission Clock**:
  * Wide-range time scaling controls: `Pause`, `Play`, `0.1x`, `0.25x`, `0.5x`, `1x`, `2x`, `5x`, `10x`, `100x`, `1000x`.
  * Central mission clock tracking elapsed cosmic years and simulation epochs.
  * Stable numerical sub-stepping ensuring orbital stability during extreme time acceleration.
* **Stellar Evolution & Mass-Dependent Lifecycles**:
  * Low-mass star lifecycle progression: Nebula $\rightarrow$ Protostar $\rightarrow$ Main Sequence $\rightarrow$ Red Giant $\rightarrow$ White Dwarf.
  * High-mass star lifecycle progression: Nebula $\rightarrow$ Protostar $\rightarrow$ Main Sequence $\rightarrow$ Red Supergiant $\rightarrow$ Supernova $\rightarrow$ Neutron Star / Black Hole.
  * Real-time lifecycle stage indicator and stellar age progress tracking in inspector telemetry.
* **Cinematic Supernova Explosions**:
  * Catastrophic core-collapse supernovae for massive stars reaching lifecycle termination.
  * High-intensity brightness flash, expanding shockwave rings, particle debris bursts, camera screen shake, and remnant formation (Neutron Star or Black Hole).
  * Automated event logging: `SUPERNOVA DETECTED: STAR [NAME] HAS COLLAPSED`.
* **Multi-Black Hole Interactions & Binary Mergers**:
  * Support for multiple simultaneous black holes with mutual gravitational influence.
  * Orbital decay inspiral and coalescence into a single combined-mass black hole remnant.
  * Outward gravitational wave ripples, particle distortions, and kinetic momentum impulses to nearby celestial bodies.
* **Expanding Gravitational Wave Visualizations**:
  * Concentric spacetime ripples and particle warping propagating outward from cataclysmic events (mergers, supernova collapses).
* **Procedural Universe Generator**:
  * "GENERATE NEW UNIVERSE" procedural engine generating balanced, natural cosmic environments with randomized stars, planets, moons, asteroid fields, and comets.
* **Universe State Persistence (Save / Load / Export)**:
  * Full universe serialization and deserialization via `localStorage` and downloadable `.json` files.
  * Saves complete state: positions, velocities, masses, types, ages, radii, colors, and simulation time.
* **Chronological Event Timeline**:
  * Historical event log recording universe initialization, planetary formations, unstable orbits, tidal disruptions, supernovae, and mergers.
  * Clickable event entries with automated camera jump-to-coordinate navigation.
* **Futuristic Observatory UI & Object Browser**:
  * Glassmorphic multi-panel UI containing Control Deck, Hierarchical Object Browser, Telemetry Inspector, Event Timeline, and Creation Menu.
* **Performance Architecture & Optimization**:
  * Object pooling, particle batching, Level of Detail (LOD) distance scaling, and efficient memory management ensuring sustained 60 FPS.

---

## [Phase 1] — Core Black Hole Simulation & Interactive Visual Foundation

### Added
* **Central Black Hole & Event Horizon Engine**:
  * Perfectly dark central event horizon located at the simulation center with soft-edge radial gradient transition and layered shadow absorption.
  * Subtle gravitational glow and dark gravitational shadow surrounding the singularity boundary, creating high visual contrast against the surrounding accretion disk.
* **3D Tilted Accretion Disk**:
  * Multi-layered elliptical accretion disk tilted at an adjustable inclination angle (20°–35°) for a realistic 3D perspective.
  * Relativistic rear glowing arc wrapping around the event horizon, simulating light bending from the back of the disk.
  * Dynamic fluid accretion dynamics with Keplerian differential orbital speeds, turbulent plasma motion, and asymmetric limb brightness.
  * Multi-stage thermal color progression: outer dark red/deep orange, middle orange/yellow, inner bright yellow/white-hot, and innermost intense blue-white highlights.
* **Relativistic Gravitational Lensing & Photon Ring**:
  * Gravitational light bending simulation visually distorting nearby light paths and particle trajectories.
  * Dynamic, irregular, and ultra-bright photon ring surrounding the event horizon perimeter.
  * Layered elliptical distortion arcs and glowing relativistic rings.
* **Dynamic Particle System & Gravitational Infall**:
  * Multi-thousand particle system simulating plasma, dust, gas, light, and energy quanta.
  * Per-particle attributes: orbital angle, radial distance, orbital velocity, scale, brightness, opacity, color, and randomized turbulence.
  * Orbital gravitational attraction model: radial distance calculation, gravitational acceleration, orbital velocity integration, event horizon crossing annihilation, and continuous outer-boundary replenishment.
  * Relativistic acceleration and brightness intensification as infalling particles approach the event horizon.
* **Deep-Space Procedural Environment**:
  * Multi-layered deep-space starfield with hundreds of stars of varying sizes and magnitudes.
  * Subtle cosmic nebula clouds and ambient space color gradients (deep blue, purple, dark red).
  * Smooth cosmic parallax and ambient star movement.
* **Cinematic Visual Effects & Post-Processing**:
  * Screen bloom glow, soft diffusion blur, particle motion trails, and subtle screen vignette.
  * Camera parallax and smooth camera zoom dynamics.
* **Futuristic Sci-Fi Control Panel & UI**:
  * Floating glassmorphic HUD panel with dark transparent backdrop, subtle borders, soft glow, and modern typography.
  * Real-time adjustment sliders: Simulation Speed, Gravitational Strength, Particle Count, Accretion Disk Brightness, Rotation Speed, Disk Inclination, Star Density, and Camera Zoom.
  * Quick action buttons: Pause, Resume, Reset, Toggle UI (`H`), and Fullscreen (`F`).
  * Minimal scientific observation overlay displaying live system telemetry (Status: ACTIVE, Particle Count, Gravity Multiplier, Speed Multiplier).
* **Interactive Controls & Input System**:
  * Mouse interactions: click-and-drag camera rotation, mouse scroll zoom, and click-to-disturb gravitational shockwaves.
  * Full keyboard shortcuts: `Space` (Pause/Resume), `R` (Reset), `+`/`-` (Speed adjustments), `F` (Fullscreen), `H` (Show/Hide UI).
  * Touch support for mobile/tablet devices with pinch-to-zoom and drag-to-rotate gestures.
* **High-Performance Architecture & Modular Codebase**:
  * Pure client-side HTML5 Canvas/WebGL execution requiring zero build tools, bundlers, or backend/PHP dependencies.
  * Modular JavaScript object-oriented design cleanly separating responsibilities: `BlackHole`, `Particle`, `AccretionDisk`, `StarField`, `Camera`, `Simulation`, and `UIController`.
  * Optimized 60 FPS `requestAnimationFrame` loop with object pooling, minimal DOM updates, and dynamic particle scaling for performance.
