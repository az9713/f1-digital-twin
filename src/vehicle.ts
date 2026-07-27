import { CAR_DIMENSIONS } from "./car";

// ponytail: Phase 0 kinematic bicycle model — just enough motion to exercise
// cameras and the track. Phase 2 replaces this with the dynamic model
// (slip-based Pacejka tires, load transfer) behind the same state interface.

export interface VehicleState {
  x: number;
  z: number;
  heading: number; // rad, 0 = +z
  speed: number; // m/s, forward
  steerAngle: number; // rad at front wheels
  wheelSpin: number; // rad, accumulated rotation for wheel meshes
}

const MAX_STEER = 0.35; // rad
const ENGINE_ACCEL = 12; // m/s² flat-out (placeholder)
const BRAKE_DECEL = 35; // m/s²
const DRAG = 0.0012; // v² coefficient (placeholder)
const ROLLING = 0.4; // m/s² constant resistance

export function createVehicleState(x = 0, z = 0, heading = 0): VehicleState {
  return { x, z, heading, speed: 0, steerAngle: 0, wheelSpin: 0 };
}

export function stepVehicle(s: VehicleState, throttle: number, brake: number, steer: number, dt: number) {
  s.steerAngle = steer * MAX_STEER;

  const accel = throttle * ENGINE_ACCEL - brake * BRAKE_DECEL - DRAG * s.speed * s.speed - (s.speed > 0 ? ROLLING : 0);
  s.speed = Math.max(0, s.speed + accel * dt);

  // Kinematic bicycle: yaw rate = v/L · tan(δ)
  const yawRate = (s.speed / CAR_DIMENSIONS.WHEELBASE) * Math.tan(s.steerAngle);
  s.heading += yawRate * dt;
  s.x += Math.sin(s.heading) * s.speed * dt;
  s.z += Math.cos(s.heading) * s.speed * dt;
  s.wheelSpin += (s.speed / CAR_DIMENSIONS.WHEEL_RADIUS) * dt;
}
