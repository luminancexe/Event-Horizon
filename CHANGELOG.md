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
