import assert from "node:assert";
import { createVehicleState, stepVehicle } from "../src/vehicle";

// Physics acceptance tests for the dynamic single-track model.
// Reference values are public F1 ballpark figures. Run: npm run check

const DT = 1 / 120;

// 1. Standing start, full throttle: 0–100 km/h in a plausible F1 window (~2.6 s real)
{
  const s = createVehicleState();
  let t = 0;
  while (s.vx < 100 / 3.6 && t < 10) {
    stepVehicle(s, { throttle: 1, brake: 0, steer: 0 }, DT);
    t += DT;
  }
  assert(t > 1.5 && t < 4.5, `0-100 km/h in ${t.toFixed(2)}s — expected 1.5-4.5s`);
}

// 2. Top speed under drag is F1-plausible (330-360 km/h with DRS closed ballpark)
{
  const s = createVehicleState();
  for (let i = 0; i < 60 * 120; i++) stepVehicle(s, { throttle: 1, brake: 0, steer: 0 }, DT);
  const kmh = s.vx * 3.6;
  assert(kmh > 280 && kmh < 400, `top speed ${kmh.toFixed(0)} km/h — expected 280-400`);
}

// 3. Braking from 300 km/h: aero + slicks stop an F1 car in roughly 130-260 m
{
  const s = createVehicleState();
  s.vx = 300 / 3.6;
  let dist = 0;
  while (s.vx > 0.5) {
    stepVehicle(s, { throttle: 0, brake: 1, steer: 0 }, DT);
    dist += s.vx * DT;
    assert(dist < 400, "braking distance runaway");
  }
  assert(dist > 80 && dist < 300, `300-0 in ${dist.toFixed(0)} m — expected 80-300`);
}

// 4. Steady-state cornering: at 180 km/h the car should sustain >2 g lateral
{
  const s = createVehicleState();
  s.vx = 50;
  let peakAy = 0;
  for (let i = 0; i < 6 * 120; i++) {
    stepVehicle(s, { throttle: 0.55, brake: 0, steer: 0.6 }, DT); // partial throttle holds speed roughly
    if (i > 240) peakAy = Math.max(peakAy, Math.abs(s.forces.ay + s.vx * s.yawRate)); // centripetal accel
  }
  assert(peakAy > 15, `sustained lateral accel ${(peakAy / 9.81).toFixed(2)} g — expected > 1.5 g`);
}

// 5. Low-speed kinematic consistency: gentle steer at 8 m/s turns left with sane radius
{
  const s = createVehicleState();
  s.vx = 8;
  for (let i = 0; i < 4 * 120; i++) stepVehicle(s, { throttle: 0.2, brake: 0, steer: 0.5 }, DT);
  assert(s.heading > 0.3, `low-speed left steer must accumulate heading, got ${s.heading.toFixed(2)}`);
  assert(Math.abs(s.vy) < 3, "no runaway lateral velocity at low speed");
}

// 6. Rest is stable: no NaN, no creep
{
  const s = createVehicleState(5, 7, 1);
  for (let i = 0; i < 240; i++) stepVehicle(s, { throttle: 0, brake: 0, steer: 0.7 }, DT);
  assert(Number.isFinite(s.vx + s.vy + s.yawRate + s.x + s.z), "state must stay finite at rest");
  assert(Math.abs(s.x - 5) < 0.1 && Math.abs(s.z - 7) < 0.1, "car must not creep with no input");
}

// ---- Phase 3: tire thermal + wear ----
import { createTireModel, stepTires, gripFactor, COMPOUNDS } from "../src/tires";

// 7. Sustained cornering warms tires into the working window; wear accumulates
{
  const s = createVehicleState();
  s.vx = 45;
  const tires = createTireModel("soft");
  const t0 = tires.front.tBulk;
  for (let i = 0; i < 60 * 120; i++) {
    stepVehicle(s, { throttle: 0.5, brake: 0, steer: 0.5 }, DT, undefined, {
      front: gripFactor(tires.front, tires.compound),
      rear: gripFactor(tires.rear, tires.compound),
    });
    stepTires(tires, s, DT);
  }
  assert(tires.front.tBulk > t0 + 15, `cornering must heat tires: ${t0}→${tires.front.tBulk.toFixed(0)}°C`);
  assert(tires.front.tSurface < 200, `surface temp must stay physical: ${tires.front.tSurface.toFixed(0)}°C`);
  assert(tires.front.wear > 0.001 && tires.front.wear < 0.6, `1 min hard cornering wear ${(tires.front.wear * 100).toFixed(1)}% — expected 0.1-60%`);
}

// 8. Straight-line airflow cools an overheated tire (the "cooling lap" effect),
//    and it can never cool below ambient
{
  const s = createVehicleState();
  s.vx = 50;
  s.speed = 50; // stepTires reads s.speed for airflow
  const tires = createTireModel("medium");
  tires.front.tSurface = tires.front.tBulk = tires.front.tCarcass = 115;
  for (let i = 0; i < 60 * 120; i++) stepTires(tires, s, DT);
  assert(tires.front.tSurface < 95, `60s at speed must cool the surface, got ${tires.front.tSurface.toFixed(0)}°C`);
  assert(tires.front.tSurface > 25, "tire cannot cool below ambient");
}

// 9. Grip peaks near the compound's optimal temperature and degrades off-peak + worn
{
  const c = COMPOUNDS.medium;
  const at = (tBulk: number, wear = 0) => gripFactor({ tSurface: tBulk, tBulk, tCarcass: tBulk, wear }, c);
  assert(at(c.tOpt) > at(50), "warm tire must out-grip cold tire");
  assert(at(c.tOpt) > at(c.tOpt + 60), "overheated tire must lose grip");
  assert(at(c.tOpt, 0.9) < at(c.tOpt, 0) * 0.85, "worn tire past the cliff must lose >15% grip");
  assert(COMPOUNDS.soft.gripPeak > COMPOUNDS.hard.gripPeak, "soft must out-grip hard");
  assert(COMPOUNDS.soft.wearRate > COMPOUNDS.hard.wearRate, "soft must wear faster than hard");
}

// ---- Phase 4: aero maps, DRS, ERS ----
import { aeroCoeffs, DEFAULT_PARAMS } from "../src/vehicle";
import { createErsState, stepErs, ERS } from "../src/ers";

// 10. Aero map: lower ride height → more downforce; DRS cuts drag and rear load
{
  const low = { ...DEFAULT_PARAMS, rideHeightF: 28, rideHeightR: 38 };
  const high = { ...DEFAULT_PARAMS, rideHeightF: 50, rideHeightR: 70 };
  assert(aeroCoeffs(low, false).clA > aeroCoeffs(high, false).clA, "lower ride height must add downforce");
  const closed = aeroCoeffs(DEFAULT_PARAMS, false);
  const open = aeroCoeffs(DEFAULT_PARAMS, true);
  assert(open.cdA < closed.cdA, "DRS must cut drag");
  assert(open.clA < closed.clA, "DRS must dump downforce");
  const stalled = aeroCoeffs({ ...DEFAULT_PARAMS, rideHeightF: 20, rideHeightR: 30 }, false);
  const okLow = aeroCoeffs({ ...DEFAULT_PARAMS, rideHeightF: 26, rideHeightR: 36 }, false);
  assert(stalled.clA < okLow.clA, "floor must stall below minimum ride height");
}

// 11. DRS raises top speed measurably
{
  const closed = createVehicleState();
  const open = createVehicleState();
  for (let i = 0; i < 60 * 120; i++) {
    stepVehicle(closed, { throttle: 1, brake: 0, steer: 0 }, DT);
    stepVehicle(open, { throttle: 1, brake: 0, steer: 0, drs: true }, DT);
  }
  const gain = (open.vx - closed.vx) * 3.6;
  assert(gain > 5 && gain < 40, `DRS top-speed gain ${gain.toFixed(1)} km/h — expected 5-40`);
}

// 12. ERS: deployment adds power and drains SOC; harvest refills under braking
{
  const e = createErsState();
  e.mode = "hotlap";
  const soc0 = e.soc;
  let boosted = 0;
  for (let i = 0; i < 10 * 120; i++) boosted = Math.max(boosted, stepErs(e, 1, 0, 60, DT));
  assert(boosted === ERS.maxPower, `full deploy must reach ${ERS.maxPower} W, got ${boosted}`);
  assert(e.soc < soc0, "deployment must drain the battery");

  const socLow = e.soc;
  for (let i = 0; i < 10 * 120; i++) stepErs(e, 0, 1, 60, DT);
  assert(e.soc > socLow, "braking must harvest energy back");
  assert(e.soc <= ERS.capacity, "SOC cannot exceed capacity");
  assert(e.harvestedThisLap <= ERS.harvestPerLap + 1, "per-lap harvest limit must hold");
}

// 13. ERS balanced mode preserves a reserve; off mode never deploys
{
  const e = createErsState();
  e.mode = "balanced";
  for (let i = 0; i < 300 * 120; i++) stepErs(e, 1, 0, 60, DT);
  assert(e.soc >= 0.29 * ERS.capacity, `balanced mode must keep ~30% reserve, got ${(e.soc / ERS.capacity * 100).toFixed(0)}%`);
  const off = createErsState();
  off.mode = "off";
  assert(stepErs(off, 1, 0, 60, DT) === 0, "off mode must not deploy");
}

console.log("vehicle-check: all assertions passed");
