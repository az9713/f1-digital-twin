# HANDOFF — resume point for F1 Digital Twin

**Read this first each new session.** Live state + next task only; specs live in
`docs/`, run/test commands in `README.md`.

## Current state

**v1 COMPLETE + polish + v2 Milestone B shipped.**
Milestone B (this session): MF6 combined-slip tires (cosine weighting, load-
sensitive μ, relaxation lags, analytic slip inverse — no wheel-spin DOF),
6-DOF chassis on 4 corners (spring/damper/ARB, ~0.02° static rake solved in
staticAttitude()), 8-node circumferential ring thermal per corner, all on a
1 kHz Web Worker with interpolated rendering. New-model QSS lap +1.7%
(v1 model still +1.5%); `check` = check:v1 && check:b, both green.
Polish (this session): DRS gated to curvature-derived zones (radius > 600 m for
≥ 250 m, opens 120 m in; 5 zones / 2468 m at Monza; HUD lamp shows availability),
brakes softened 36 → 18 kN (300–0 now 133 m vs real ~140 m; QSS lap error +1.5%,
still in gate), sector times (curve thirds, S1/S2/S3 in HUD, green = personal
best), session-mode menu on M (Quali 12 kg / Practice 30 kg / Race 100 kg —
resets car, tires, ERS, times).
Playable: https://az9713.github.io/f1-digital-twin/ · Repo: https://github.com/az9713/f1-digital-twin
(`main` = source, `gh-pages` = built site).

What exists: drivable dynamic single-track car (Pacejka + friction circle + load
transfer), 3-node tire thermal + wear with grip cliff, ride-height aero + DRS, ERS
with SOC/modes, telemetry-fitted Monza track with Verstappen ghost + live delta,
lap timing, pit stops, fuel burn, Strategy Sandbox (races the tire model),
physics-notes page, QSS validation at **+1.5%** lap time vs real.

Working tree clean, local == remote. All green: `npm run check` (16 physics tests),
`npm run validate` (±8% gate, writes docs/validation.md), `npm run build`.

## Next task

- **v2 next milestones** (docs/three-ambitious-simulation-specs-v2.html, F1 tab)
  or Milestone B leftovers: friction-ellipse dials + 3-D tread heat map viz,
  wheel-spin DOF, camber-driven lateral ring gradient, suspension kinematics/LSD.
- Sibling projects now exist (parallel agent builds, Phases 0–1 shipped + live):
  ../mars-sample-return (Kepler/patched-conic planner) and ../evtol-studio
  (6-DOF multirotor + BEM-lite). Next: Mars Phase 2-3, eVTOL Phase 2-3.

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
