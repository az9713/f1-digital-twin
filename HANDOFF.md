# HANDOFF — F1 Digital Twin

## Current state (2026-07-27)

v1 **Phase 0 complete**: drivable placeholder car on an oval track in the browser.

- Stack: Vite 8 + TypeScript 6 + Three.js 0.185, vanilla-ts template.
- `npm run dev` → drive with W/A/S/D, C cycles cameras. `npm run build` and `npm run check` both green.
- Vehicle model is a **deliberate kinematic placeholder** (`src/vehicle.ts`, marked `ponytail:`) —
  Phase 2 replaces it with the dynamic model behind the same `VehicleState` interface.
- Car is procedural primitives (`src/car.ts`) — swap for a CC0 GLTF later; same `CarModel` interface.
- Track centerline is an exported `CatmullRomCurve3` (`src/track.ts`) — reuse it for racing line / ghosts.
- Test approach: single assert-based check (`test/vehicle-check.ts`) bundled with rolldown, run via
  `npm run check`. No test framework by design; add cases to the same file.

## Next task

**Phase 1 — Telemetry ingestion (per v1 spec):**
1. Python side (`data/` folder, new): FastF1 script that pulls one historical session
   (suggest a Monza or Spa race lap) and bakes car position + speed + throttle/brake into
   static JSON keyed by time.
2. TS side: load the baked JSON, replay it as a translucent "ghost" car on a track fitted
   to the telemetry's world coordinates (this will replace the placeholder oval —
   keep the oval as a fallback).
3. Decision made: two-language repo (Python baker → static JSON → browser). No live API calls
   from the browser.

## Project decisions on record

- Strict v1 first (Phases 0–6), then v2 milestones (see specs in parent folder).
- Repo pushed to GitHub (az9713/f1-digital-twin) every session.
- Leaderboards/multiplayer: local-only until user asks for hosting.
- Specs live in parent folder `grok_simulations/`; copies in `docs/` here.
