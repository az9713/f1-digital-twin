# HANDOFF — resume point for F1 Digital Twin

**Read this first each new session.** Live state + next task only; specs live in
`docs/`, run/test commands in `README.md`.

## Current state (as of 76cf39e, pushed)

**v1 COMPLETE — Phases 0–6 all shipped and verified.**
Playable: https://az9713.github.io/f1-digital-twin/ · Repo: https://github.com/az9713/f1-digital-twin
(`main` = source, `gh-pages` = built site).

What exists: drivable dynamic single-track car (Pacejka + friction circle + load
transfer), 3-node tire thermal + wear with grip cliff, ride-height aero + DRS, ERS
with SOC/modes, telemetry-fitted Monza track with Verstappen ghost + live delta,
lap timing, pit stops, fuel burn, Strategy Sandbox (races the tire model),
physics-notes page, QSS validation at **+0.5%** lap time vs real.

Working tree clean, local == remote. All green: `npm run check` (16 physics tests),
`npm run validate` (±8% gate, writes docs/validation.md), `npm run build`.

## Next task

- **v1 polish before v2** (pick in order): (1) DRS zone gating from track curvature
  (currently free toggle at speed); (2) brake tune — 300–0 in 91 m vs real ~140 m,
  soften `brakeForceMax` toward ~26 kN and re-run check+validate; (3) sector times +
  mode menu (practice/quali fuel presets).
- **Then v2 Milestone B** (docs/three-ambitious-simulation-specs-v2.html, F1 tab):
  MF6 combined slip + relaxation lengths + ring thermal, 6-DOF chassis + 4 corners
  on a physics worker at 1 kHz. Keep v1 acceptance tests green throughout.
- After F1 v2 (or if user redirects): Mars Sample Return v1, then eVTOL v1
  (specs in docs/, user chose strict v1-then-v2 per project).

## How to work (essentials)

- Tests: assert-based, bundled via rolldown (no framework). Entries must live in
  `test/` — rolldown won't resolve entry paths starting with `.check/`.
- Pages redeploy: `GH_PAGES=1 npm run build`, `touch dist/.nojekyll`, then in
  `dist/`: `git init -b gh-pages && git add -A && git commit && git push -f
  https://github.com/az9713/f1-digital-twin.git gh-pages:gh-pages`; remove
  `dist/.git` after. (GH_PAGES env sets base `/f1-digital-twin/` in vite.config.ts —
  keep asset paths relative.)
- New telemetry sessions: `python data/bake_session.py <session_key> <driver> <name>`
  (OpenF1, stdlib only; coordinates are decimeters). Monza 2024 = 9590, driver 1.
- Browser drive-tests via synthetic keydown run at ~1 fps in background tabs
  (rAF throttling) — validate physics numerically, screenshots for layout only.
- Commit each phase/milestone, push every session. Leaderboards/multiplayer stay
  local-only unless the user asks for hosting.

## Session-transient scratch (none pending)

All generators are committed (`data/bake_session.py`, `test/lap-sim.ts`). No
uncommitted scratch tooling exists.
