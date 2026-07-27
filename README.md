# F1 Digital Twin

A real-time, browser-based digital twin of a Formula One car: rigorous-but-real-time physics
(Pacejka tires, thermal model, aero, vehicle dynamics, ERS) rendered on a visible 3D car with
force arrows, heat maps, and telemetry — validated against OpenF1/FastF1 data.

Specs: `../three-ambitious-simulation-specs.html` (v1, current target) and
`../three-ambitious-simulation-specs-v2.html` (v2, after v1 completes).

## Run

```bash
npm install
npm run dev     # dev server
npm run build   # type-check + production build
npm run check   # vehicle-model self-check (assert-based, no framework)
```

## Controls

- `W` / `S` — throttle / brake
- `A` / `D` — steer
- `C` — cycle camera: chase → onboard → free (drag to orbit)

## Status — v1 Phase 0 (Foundations)

- [x] Vite + TypeScript + Three.js scaffold
- [x] Procedural placeholder F1 car (GLTF swap-in planned)
- [x] Oval track from a reusable centerline curve
- [x] Chase / onboard / free cameras
- [x] Fixed-step (120 Hz) kinematic placeholder vehicle model
- [ ] Phase 1: OpenF1 telemetry ingestion + ghost lap
- [ ] Phase 2: dynamic bicycle model + Pacejka tires + force arrows

See `HANDOFF.md` for the current working state and next task.

## Architecture notes

- `src/vehicle.ts` — vehicle state + step function. Phase 0 is a kinematic bicycle model;
  Phase 2 replaces the internals behind the same `VehicleState` interface.
- `src/track.ts` — track built from an exported `CatmullRomCurve3` centerline so later
  phases (racing line, ghost replay) sample the same geometry.
- Simulation runs at a fixed 120 Hz decoupled from render rate (accumulator loop in `main.ts`).
