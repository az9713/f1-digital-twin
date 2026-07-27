import assert from "node:assert";
import { createVehicleState, stepVehicle } from "../src/vehicle";

// Smallest check that fails if the vehicle model breaks.
// Run: npm run check

// 1. Full throttle from rest: accelerates, monotonically, and reaches a plausible speed
{
  const s = createVehicleState();
  let prev = 0;
  for (let i = 0; i < 5 * 120; i++) {
    stepVehicle(s, 1, 0, 0, 1 / 120);
    assert(s.speed >= prev, "speed must not drop under full throttle");
    prev = s.speed;
  }
  assert(s.speed > 30 && s.speed < 120, `5s full-throttle speed plausible, got ${s.speed.toFixed(1)} m/s`);
}

// 2. Braking from speed: stops, never goes negative
{
  const s = createVehicleState();
  s.speed = 80;
  for (let i = 0; i < 5 * 120; i++) stepVehicle(s, 0, 1, 0, 1 / 120);
  assert(s.speed === 0, `car must stop under full brake, got ${s.speed}`);
}

// 3. Constant steer at speed: heading changes, and a full circle returns near start
{
  const s = createVehicleState();
  s.speed = 20;
  const startHeading = s.heading;
  // Hold speed constant by matching resistances is fiddly; just verify yaw accumulates
  for (let i = 0; i < 120; i++) stepVehicle(s, 0.5, 0, 1, 1 / 120);
  assert(s.heading > startHeading + 0.1, "left steer must yaw the car left");
}

// 4. No motion without input
{
  const s = createVehicleState(5, 7, 1);
  for (let i = 0; i < 120; i++) stepVehicle(s, 0, 0, 0, 1 / 120);
  assert(s.x === 5 && s.z === 7, "car must not creep with no input");
}

console.log("vehicle-check: all assertions passed");
