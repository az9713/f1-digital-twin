import assert from "node:assert";
import fs from "node:fs";
import { MF6, combined, fy0, kappaForFx, muLoad, relax } from "../src/tire-mf6";
import { CHASSIS, createChassisState, stepChassis, stepCornerTires, cornerGrip, staticAttitude } from "../src/chassis";
import { createCornerTires, ringSpread, stepCornerTire } from "../src/tires";
import { DEFAULT_PARAMS, aeroCoeffs, G, RHO } from "../src/vehicle";
import { centerlineFromLap } from "../src/track";

// Milestone B acceptance tests: MF6 combined slip + relaxation, ring thermal,
// 6-DOF chassis on four corners. Run: npm run check:b
// The v1 suite (test/vehicle-check.ts) still guards the single-track model.

const DT = 1 / 1000; // the physics worker's step
const p = DEFAULT_PARAMS;

// 1. Combined slip: asking a tire for longitudinal force costs lateral capacity,
//    and it costs it smoothly rather than only at the friction limit.
{
  const fz = 4000, mu = 1.9, alpha = 0.08;
  const pure = Math.abs(combined(0, alpha, fz, mu).fy);
  const mild = Math.abs(combined(0.03, alpha, fz, mu).fy);
  const hard = Math.abs(combined(0.15, alpha, fz, mu).fy);
  assert(mild < pure * 0.99, `mild slip ratio must already cost lateral grip: ${mild.toFixed(0)} vs ${pure.toFixed(0)} N`);
  assert(hard < mild, `more slip ratio must cost more: ${hard.toFixed(0)} vs ${mild.toFixed(0)} N`);
  assert(hard < pure * 0.7, `κ = 0.15 must cost >30% of lateral capacity, got ${((1 - hard / pure) * 100).toFixed(0)}%`);
  // And symmetrically: slip angle eats longitudinal force
  const fxPure = combined(0.1, 0, fz, mu).fx;
  const fxCorner = combined(0.1, 0.1, fz, mu).fx;
  assert(fxCorner < fxPure * 0.9, `slip angle must cost longitudinal force: ${fxCorner.toFixed(0)} vs ${fxPure.toFixed(0)} N`);
  // Pure-slip peak is still μ·Fz, so v1's grip budget is preserved
  let peak = 0;
  for (let a = 0; a < 0.6; a += 0.001) peak = Math.max(peak, Math.abs(fy0(a, fz, mu)));
  assert(Math.abs(peak - muLoad(mu, fz) * fz) < 0.002 * peak, `pure lateral peak must be μ(Fz)·Fz, got ${peak.toFixed(0)} N`);
  // Load sensitivity: a heavily loaded corner returns less μ
  assert(muLoad(mu, 8000) < muLoad(mu, 4000), "μ must fall with load");
}

// 2. Relaxation length: slip lags, then converges to the steady state, and the
//    lag scales with distance travelled (not with time).
{
  const target = 0.06;
  let a = 0;
  a = relax(a, target, MF6.sigmaAlpha, 50, DT);
  assert(a > 0 && a < target * 0.2, `one step must only start the build-up, got ${a.toFixed(4)}`);
  let dist = 0;
  while (Math.abs(target - a) > 0.01 * target && dist < 20) {
    a = relax(a, target, MF6.sigmaAlpha, 50, DT);
    dist += 50 * DT;
  }
  assert(Math.abs(target - a) < 0.01 * target, `must converge to steady state, got ${a.toFixed(4)}`);
  // 99% of a first-order lag takes ≈ 4.6 relaxation lengths of travel
  assert(dist > 3 * MF6.sigmaAlpha && dist < 7 * MF6.sigmaAlpha, `convergence took ${dist.toFixed(2)} m, expected ≈ 4.6σ = ${(4.6 * MF6.sigmaAlpha).toFixed(2)} m`);
  // Same slip built at half the speed takes twice as long in seconds
  const steps = (v: number) => {
    let x = 0, n = 0;
    while (x < target * 0.63 && n < 1e6) { x = relax(x, target, MF6.sigmaAlpha, v, DT); n++; }
    return n;
  };
  const nFast = steps(80), nSlow = steps(40);
  assert(nSlow > nFast * 1.8 && nSlow < nFast * 2.2, `lag must be distance-based: ${nSlow} vs ${nFast} steps`);
  // The inverse of the longitudinal curve round-trips
  const k = kappaForFx(6000, 5000, 1.9);
  assert(Math.abs(combined(k, 0, 5000, 1.9).fx - 6000) < 1, "kappaForFx must invert fx0");
}

// 3. Six-DOF statics: the four corner loads carry exactly the car's weight,
//    split evenly because the CG sits at the wheelbase midpoint.
{
  const s = createChassisState();
  for (let i = 0; i < 3000; i++) stepChassis(s, { throttle: 0, brake: 0, steer: 0 }, DT);
  const total = s.corners.reduce((a, c) => a + c.fz, 0);
  const weight = p.mass * G;
  assert(Math.abs(total - weight) / weight < 0.01, `static corner loads ${total.toFixed(0)} N must equal weight ${weight.toFixed(0)} N`);
  const front = s.corners[0].fz + s.corners[1].fz;
  assert(Math.abs(front / total - p.b / (p.a + p.b)) < 0.02, `front share ${(front / total * 100).toFixed(1)}% must match weight distribution`);
  assert(Math.abs(s.corners[0].fz - s.corners[1].fz) < 1, "left and right must be equal at rest");
  assert(Math.abs(s.roll) < 1e-5, "no roll at rest");
  // Softer rear springs mean a hair of static rake, and the car must stay there
  assert(Math.abs(s.pitch - staticAttitude().pitch) < 1e-4, `pitch must hold static equilibrium, drifted to ${s.pitch.toFixed(5)} rad`);
  assert(Math.abs(s.x) < 0.01 && Math.abs(s.z) < 0.01, "car must not creep at rest");
}

// 4. Load transfer emerges from the suspension: braking loads the front axle,
//    cornering rolls the body and loads the outside pair.
{
  // Compared against a coasting reference, because at 300 km/h the rearward
  // aero centre of pressure already holds the nose up on its own.
  const run = (brake: number) => {
    const s = createChassisState();
    s.vx = 300 / 3.6;
    for (let i = 0; i < 300; i++) stepChassis(s, { throttle: 0, brake, steer: 0 }, DT);
    return s;
  };
  const coast = run(0);
  const brake = run(1);
  assert(brake.pitch > coast.pitch + 0.001, `braking must dive the nose: ${(brake.pitch * 57.3).toFixed(3)}° vs coasting ${(coast.pitch * 57.3).toFixed(3)}°`);
  const ratio = (s: typeof brake) => s.forces.fzFront / s.forces.fzRear;
  assert(ratio(brake) > ratio(coast) * 1.2, `braking must shift load forward: F/R ${ratio(brake).toFixed(2)} vs ${ratio(coast).toFixed(2)}`);
  console.log(`  brake dive: ${(brake.pitch * 57.3).toFixed(3)}° nose-down, front/rear load ${ratio(coast).toFixed(2)} → ${ratio(brake).toFixed(2)}`);

  const c = createChassisState();
  c.vx = 60;
  for (let i = 0; i < 2000; i++) stepChassis(c, { throttle: 0.5, brake: 0, steer: 0.7 }, DT);
  assert(c.roll > 0.002, `left turn must roll the body right, got ${(c.roll * 57.3).toFixed(2)}°`);
  assert(c.roll * 57.3 < 3, `body roll ${(c.roll * 57.3).toFixed(2)}° must stay F1-plausible (< 3°)`);
  assert(c.corners[1].fz > c.corners[0].fz * 1.1, "outside front must outload inside front");
  assert(c.corners[3].fz > c.corners[2].fz * 1.1, "outside rear must outload inside rear");
  const totalLoad = c.corners.reduce((a, k) => a + k.fz, 0);
  const expect = p.mass * G + c.forces.downforce;
  assert(Math.abs(totalLoad - expect) / expect < 0.05, `cornering loads ${totalLoad.toFixed(0)} N vs weight+downforce ${expect.toFixed(0)} N`);
}

// 5. Longitudinal parity with v1: 0-100 km/h and 300-0 braking distance
{
  const a = createChassisState();
  let t = 0;
  while (a.vx < 100 / 3.6 && t < 10) {
    stepChassis(a, { throttle: 1, brake: 0, steer: 0 }, DT);
    t += DT;
  }
  assert(t > 1.5 && t < 4.5, `0-100 km/h in ${t.toFixed(2)}s — expected 1.5-4.5s`);

  const b = createChassisState();
  b.vx = 300 / 3.6;
  let dist = 0;
  while (b.vx > 0.5 && dist < 400) {
    stepChassis(b, { throttle: 0, brake: 1, steer: 0 }, DT);
    dist += b.vx * DT;
  }
  assert(dist > 130 && dist < 145, `300-0 in ${dist.toFixed(1)} m — expected 130-145 (real ≈ 140)`);
  console.log(`  300-0 braking: ${dist.toFixed(1)} m`);
}

// 6. Sustained cornering: >2 g lateral, and combined slip makes trail-braking
//    cost cornering grip on the full vehicle, not just in the tire formula.
{
  const free = createChassisState();
  free.vx = 50;
  let peak = 0;
  for (let i = 0; i < 6000; i++) {
    stepChassis(free, { throttle: 0.55, brake: 0, steer: 0.6 }, DT);
    if (i > 2000) peak = Math.max(peak, Math.abs(free.forces.ay + free.vx * free.yawRate));
  }
  assert(peak > 19.6, `sustained lateral accel ${(peak / G).toFixed(2)} g — expected > 2 g`);
  console.log(`  sustained cornering: ${(peak / G).toFixed(2)} g`);

  const braked = createChassisState();
  braked.vx = 50;
  let peakB = 0;
  for (let i = 0; i < 6000; i++) {
    stepChassis(braked, { throttle: 0, brake: 0.5, steer: 0.6 }, DT);
    if (i > 2000) peakB = Math.max(peakB, Math.abs(braked.forces.ay + braked.vx * braked.yawRate));
  }
  assert(peakB < peak, `trail-braking must cut lateral grip: ${(peakB / G).toFixed(2)} g vs ${(peak / G).toFixed(2)} g`);
}

// 7. Ring thermal: cornering heats the tires into the working window, the
//    loaded outside tire runs hotter than the unloaded inside one, and a locked
//    wheel bakes one tread segment (a flat spot) instead of the whole ring.
{
  const s = createChassisState();
  s.vx = 45;
  const tires = createCornerTires("soft");
  const t0 = tires.corners[0].tBulk;
  for (let i = 0; i < 60_000; i++) {
    stepChassis(s, { throttle: 0.5, brake: 0, steer: 0.5 }, DT, undefined, cornerGrip(tires));
    stepCornerTires(tires, s, DT);
  }
  const outside = tires.corners[1];
  const inside = tires.corners[0];
  assert(outside.tBulk > t0 + 15, `cornering must heat tires: ${t0}→${outside.tBulk.toFixed(0)}°C`);
  assert(outside.tSurface < 200, `surface must stay physical: ${outside.tSurface.toFixed(0)}°C`);
  assert(outside.tSurface > inside.tSurface, `outside tire must run hotter: ${outside.tSurface.toFixed(0)} vs ${inside.tSurface.toFixed(0)}°C`);
  assert(outside.wear > 0.001 && outside.wear < 0.6, `1 min cornering wear ${(outside.wear * 100).toFixed(1)}% — expected 0.1-60%`);
  assert(ringSpread(outside) < 12, `a rolling tire must heat evenly, spread ${ringSpread(outside).toFixed(1)}°C`);
  console.log(`  60 s cornering: outside ${outside.tSurface.toFixed(0)}°C / inside ${inside.tSurface.toFixed(0)}°C, wear ${(outside.wear * 100).toFixed(1)}%`);

  // Lock-up: spin = 0 keeps the patch on one segment, so it bakes alone
  const flat = createCornerTires("soft");
  const seg = flat.corners[0];
  for (let i = 0; i < 500; i++) stepCornerTire(seg, flat.compound, 60_000, 0, 50, 0, DT);
  assert(ringSpread(seg) > 25, `a locked wheel must flat-spot one segment, spread ${ringSpread(seg).toFixed(1)}°C`);
  console.log(`  0.5 s lock-up: tread spread ${ringSpread(seg).toFixed(1)}°C`);
}

// 8. QSS lap validation with the Milestone B model: four-corner loads with
//    roll-stiffness-split lateral transfer and MF6 load-sensitive peak grip,
//    over the same telemetry-fitted Monza line v1 validates against.
{
  const sess = JSON.parse(fs.readFileSync("public/sessions/monza-2024.json", "utf8"));
  const curve = centerlineFromLap(sess.x, sess.z);
  const aero = aeroCoeffs(p, false);
  const L = p.a + p.b;
  const N = 4000;
  const pts = Array.from({ length: N }, (_, i) => curve.getPointAt(i / N));
  const ds: number[] = [];
  const kappaTrack: number[] = [];
  for (let i = 0; i < N; i++) {
    const a = pts[i], b = pts[(i + 1) % N], c = pts[(i + 2) % N];
    ds.push(Math.hypot(b.x - a.x, b.z - a.z));
    const ab = Math.hypot(b.x - a.x, b.z - a.z);
    const bc = Math.hypot(c.x - b.x, c.z - b.z);
    const ca = Math.hypot(a.x - c.x, a.z - c.z);
    const area2 = Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x));
    kappaTrack.push(ab * bc * ca > 1e-9 ? (2 * area2) / (ab * bc * ca) : 0);
  }

  // Roll-stiffness shares decide how the roll moment splits across the axles
  const kRollF = 2 * (CHASSIS.kF * CHASSIS.halfTrackF ** 2 + CHASSIS.arbF * CHASSIS.halfTrackF ** 2);
  const kRollR = 2 * (CHASSIS.kR * CHASSIS.halfTrackR ** 2 + CHASSIS.arbR * CHASSIS.halfTrackR ** 2);
  const shareF = kRollF / (kRollF + kRollR);

  /** Four corner loads at speed v with lateral acceleration ay. */
  function cornerLoads(v: number, ay: number): number[] {
    const down = 0.5 * RHO * aero.clA * v * v;
    const axleF = (p.mass * G * p.b) / L + down * aero.balance;
    const axleR = (p.mass * G * p.a) / L + down * (1 - aero.balance);
    const moment = p.mass * ay * p.hCg;
    const dF = (moment * shareF) / (2 * CHASSIS.halfTrackF);
    const dR = (moment * (1 - shareF)) / (2 * CHASSIS.halfTrackR);
    return [
      Math.max(0, axleF / 2 - dF), Math.max(0, axleF / 2 + dF),
      Math.max(0, axleR / 2 - dR), Math.max(0, axleR / 2 + dR),
    ];
  }
  /** Total grip force available, summing the load-sensitive MF6 peak per corner. */
  function gripForce(v: number, ay: number): number {
    return cornerLoads(v, ay).reduce((a, fz) => a + muLoad(p.mu, fz) * fz, 0);
  }
  /** Lateral limit at speed v: fixed point, since transfer costs grip. */
  function ayMax(v: number): number {
    let ay = (p.mu * (p.mass * G + 0.5 * RHO * aero.clA * v * v)) / p.mass;
    for (let i = 0; i < 6; i++) ay = gripForce(v, ay) / p.mass;
    return ay;
  }
  const dragAccel = (v: number) => (0.5 * RHO * aero.cdA * v * v + 0.015 * p.mass * G) / p.mass;
  function longAccel(v: number, k: number): number {
    const aLat = v * v * k;
    const aTot = gripForce(v, aLat) / p.mass;
    return aTot > aLat ? Math.sqrt(aTot * aTot - aLat * aLat) : 0;
  }

  const vLim = kappaTrack.map((k) => {
    if (k < 1e-5) return 110;
    let v = 110;
    for (let i = 0; i < 12; i++) v = Math.min(110, Math.sqrt(ayMax(v) / k));
    return v;
  });

  const v = vLim.slice();
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < 2 * N; i++) {
      const j = i % N, nx = (j + 1) % N;
      const aDrive = Math.min(longAccel(v[j], kappaTrack[j]), p.powerMax / (p.mass * Math.max(v[j], 5)));
      const a = aDrive - dragAccel(v[j]);
      v[nx] = Math.min(vLim[nx], Math.sqrt(Math.max(1, v[j] * v[j] + 2 * a * ds[j])));
    }
    for (let i = 2 * N; i > 0; i--) {
      const j = i % N, pv = (j - 1 + N) % N;
      const aBrake = Math.min(longAccel(v[j], kappaTrack[j]), p.brakeForceMax / p.mass) + dragAccel(v[j]);
      v[pv] = Math.min(v[pv], Math.sqrt(v[j] * v[j] + 2 * aBrake * ds[pv]));
    }
  }

  let lapTime = 0;
  for (let i = 0; i < N; i++) lapTime += ds[i] / ((v[i] + v[(i + 1) % N]) / 2);
  const realLap = sess.meta.lap_time_s as number;
  const err = ((lapTime - realLap) / realLap) * 100;
  console.log(`  QSS lap (Milestone B model): ${lapTime.toFixed(2)} s vs real ${realLap.toFixed(3)} s → ${err >= 0 ? "+" : ""}${err.toFixed(1)}%`);
  assert(Math.abs(err) <= 8, `Milestone B lap time error ${err.toFixed(1)}% exceeds the 8% gate`);
  const simVmax = Math.max(...v);
  const realVmax = Math.max(...(sess.speed as number[]));
  assert(Math.abs(simVmax - realVmax) / realVmax <= 0.08, `top speed ${(simVmax * 3.6).toFixed(0)} km/h off by more than 8%`);
}

console.log("physics-b-check: all assertions passed");
