# HANDOFF — F1 Digital Twin

## Current state (2026-07-27)

**v1 COMPLETE — Phases 0–6 all shipped.** Playable at https://az9713.github.io/f1-digital-twin/
(deployed from `dist` to the `gh-pages` branch; redeploy = `npm run build` + push dist to gh-pages).

What exists: drivable dynamic single-track car (Pacejka + friction circle + load transfer),
3-node tire thermal + wear with grip cliff, ride-height aero + DRS, ERS with SOC/modes,
telemetry-fitted Monza track with Verstappen ghost + live delta, lap timing, pit stops,
fuel burn, Strategy Sandbox (races the tire model), physics-notes page, QSS validation
(+0.5% lap time vs real).

- `npm run check` — 16 physics acceptance tests. `npm run validate` — QSS lap sim vs
  OpenF1, writes docs/validation.md, gates at ±8%. Both green. `npm run build` green.
- Tests bundle via rolldown (no test framework). Note: rolldown won't resolve entry paths
  starting with `.check/` — keep test entries in `test/`.
- Browser verification quirk: background tabs throttle rAF to ~1 fps, so drive-tests via
  synthetic keydown show tiny speeds — physics is validated numerically instead.

## Next task (v2, per docs/three-ambitious-simulation-specs-v2.html)

Milestone B — transient tires + multi-body: MF6 combined slip, relaxation lengths,
ring thermal model, 6-DOF chassis + 4 corners on a physics worker at 1 kHz.
Before that, worthwhile v1 polish candidates:
1. DRS zone gating from track curvature (currently free toggle at speed)
2. Brake force tune (300–0 in 91 m vs real ~140 m — soften brakeForceMax toward ~26 kN)
3. Sector times + a proper mode menu (practice/quali fuel presets)

## Decisions on record

- Strict v1 → v2 order (user). Repo public, pushed every session.
- Leaderboards/multiplayer local-only until asked.
- Strategy Sandbox uses analytical per-lap pricing on the real tire model rather than
  AI-driven laps (v1 scope decision, noted in README).
- OpenF1 coordinates are decimeters; Monza session_key 9590, driver 1, race lap 43.
