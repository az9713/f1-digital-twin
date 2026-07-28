# F1 Digital Twin

A real-time, browser-based digital twin of a Formula One car. Every force is computed from
first principles at 120 Hz and drawn on the car — Pacejka tires with a friction circle,
a three-node tire thermal network with wear, ride-height-dependent aerodynamics with DRS,
ERS energy flows — validated against real OpenF1 telemetry to **+0.5 % lap-time error**
at Monza.

**Play it:** https://az9713.github.io/f1-digital-twin/ (or `npm install && npm run dev`)

## The game

You drive against the **ghost of Verstappen's fastest race lap** (Monza 2024, 1:21.745),
fitted from real GPS + car telemetry. A live delta timer scores you against him at every
meter of the lap.

- `W/S` throttle & brake · `A/D` steer
- `C` cameras (chase / onboard / free) · `F` force arrows
- `E` DRS (auto-closes on brake/steer) · `Q` ERS mode (balanced / hotlap / harvest / off)
- `P` pit stop when nearly stopped (compound change, 24 s loss, cold fresh tires)
- `T` Strategy Sandbox · `R` reset to the line

**Strategy Sandbox:** design two stint plans (`soft:8, hard:12` vs `medium:20`) and race
them through the same tire thermal/wear model you drive on. Out-lap warm-up, degradation,
the soft-tire cliff, fuel burn-off, and pit loss all emerge from the physics.

## The physics

All models documented with equations in the in-game **[Physics Notes](public/physics-notes.html)** page:

| Model | Method |
|---|---|
| Vehicle dynamics | 6-DOF rigid chassis (surge/sway/yaw + heave/roll/pitch) on 4 independent corners, spring–damper–ARB per corner, stepped at 1 kHz on a Web Worker |
| Tires (grip) | Magic Formula 6.x per corner: combined slip via cosine weighting functions, load-sensitive μ, relaxation-length transients |
| Tires (thermal) | Per-tire ring model — 8 circumferential tread nodes + bulk + carcass, heat entering only the segment in the contact patch |
| Tires (wear) | Sliding-energy accumulation, overheat acceleration, grip cliff at 65 % |
| Aero | Ride-height/rake maps, floor stall, DRS drag/load dump |
| ERS | 120 kW MGU-K, 4 MJ store, per-lap deploy/harvest limits, 4 modes |
| Strategy sim | Per-lap tire-state advance + grip/fuel lap-time pricing |

## Validation

`npm run validate` runs a quasi-steady-state lap simulation over the telemetry-fitted
racing line with the game's exact vehicle parameters ([docs/validation.md](docs/validation.md)):

| | Simulated | Real | Error |
|---|---|---|---|
| Lap time | 82.18 s | 81.745 s | **+0.5 %** |
| Top speed | 334 km/h | 333 km/h | +0.3 % |
| Track length | 5756 m | 5793 m | −0.6 % |

`npm run check` runs both suites: `check:v1` (16 acceptance tests — 0–100 in 2.4 s, 300–0
braking, sustained 3.4 g cornering, thermal windows, wear cliff, ERS budgets, strategy
crossovers) and `check:b` (8 Milestone B tests — combined slip, relaxation lengths,
6-DOF statics, load transfer, ring thermal, and a QSS lap on the new model at **+1.7 %**).

## Data pipeline

`data/bake_session.py` (Python stdlib only) pulls any session's fastest lap from the
[OpenF1 API](https://openf1.org) — location + car data — and bakes it to static JSON:

```bash
python data/bake_session.py 9590 1 monza-2024   # session_key driver out_name
```

## Known simplifications

- No wheel-spin DOF: slip ratio is inverted from the brake/drive force demand, then relaxed
- Wheels are assumed to stay on the ground — no unsprung masses, tire vertical spring, or kerb strikes
- No suspension kinematics yet (camber/toe curves), so no camber term in the tire model
- Ring thermal is circumferential only (8 nodes), not the spec's 8 × 3 grid
- Track fitted from the driven racing line; chicane apex curvature is over-tight (−26 % on min speed)
- DRS is free-toggle at speed rather than zone-gated; braking is ~30 % stronger than real
- Strategy sim prices laps analytically instead of AI-driving them

Full v1/v2 specifications in [docs/](docs/).
