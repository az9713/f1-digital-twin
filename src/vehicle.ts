import { CAR_DIMENSIONS } from "./car";

// Phase 2: dynamic single-track (bicycle) model with Pacejka tires,
// longitudinal load transfer, power-limited drive, and friction-circle
// coupling between longitudinal and lateral force.
//
// Axes: body frame, x forward, y left. World heading 0 = +z, left turn positive.

export interface VehicleParams {
  mass: number; // kg (car + driver, no fuel)
  izz: number; // yaw inertia, kg m²
  a: number; // CG → front axle, m
  b: number; // CG → rear axle, m
  hCg: number; // CG height, m
  powerMax: number; // W
  brakeForceMax: number; // N, total at the pedal
  brakeBias: number; // fraction front
  mu: number; // tire friction coefficient (slicks, in temperature window)
  cdA: number; // drag area at reference ride height, m²
  clA: number; // downforce area at reference ride height, m²
  aeroBalance: number; // fraction of downforce on front axle at zero rake delta
  rideHeightF: number; // mm, front (reference 35)
  rideHeightR: number; // mm, rear (reference 45)
}

export const DEFAULT_PARAMS: VehicleParams = {
  mass: 798,
  izz: 1200,
  a: 1.8,
  b: 1.8,
  hCg: 0.3,
  powerMax: 735_000,
  brakeForceMax: 18_000, // tuned so 300-0 lands at ~133 m, near the real ~140 m (was 91 m at 36 kN)
  brakeBias: 0.58,
  mu: 1.9,
  cdA: 1.5,
  clA: 4.8,
  aeroBalance: 0.44,
  rideHeightF: 35,
  rideHeightR: 45,
};

/**
 * Ground-effect era aero map: lower ride height → more downforce (until the
 * floor bottoms out), higher ride → less load, slightly more drag from the
 * exposed floor. Rake (rear − front) shifts balance forward. DRS dumps rear
 * wing load and drag.
 */
export function aeroCoeffs(p: VehicleParams, drs: boolean): { cdA: number; clA: number; balance: number } {
  const hF = p.rideHeightF;
  const hR = p.rideHeightR;
  const hAvg = (hF + hR) / 2;
  // ~1.6% downforce lost per mm of average ride height above reference 40 mm
  let clA = p.clA * (1 - 0.016 * (hAvg - 40));
  // Floor stall when running dangerously low: sudden loss below 25 mm front
  if (hF < 25) clA *= 0.82;
  let cdA = p.cdA * (1 + 0.004 * (hAvg - 40));
  // Rake shifts aero balance: +0.4% front per mm of extra rake vs reference 10 mm
  const balance = Math.min(0.55, Math.max(0.3, p.aeroBalance + 0.004 * (hR - hF - 10)));
  if (drs) {
    cdA *= 0.88; // ~12% drag cut
    clA -= 0.9; // rear wing load dumped
  }
  return { cdA, clA: Math.max(1, clA), balance: drs ? Math.min(0.62, balance + 0.08) : balance };
}

export interface Controls {
  throttle: number; // 0..1
  brake: number; // 0..1
  steer: number; // -1..1, left positive
  drs?: boolean;
  powerBoost?: number; // W, e.g. ERS deployment
}

export const RHO = 1.2; // air density kg/m³
export const G = 9.81;
export const MAX_STEER = 0.35; // rad at the wheels

export interface Forces {
  fyFront: number; // N, lateral at front axle (body y)
  fyRear: number;
  fxDrive: number; // N, net longitudinal tire force (drive − brake)
  drag: number; // N
  downforce: number; // N total
  fzFront: number; // N vertical per axle
  fzRear: number;
  ax: number; // m/s² body longitudinal accel (for HUD/telemetry)
  ay: number; // m/s² body lateral accel
  slipAngleFront: number; // rad
  slipAngleRear: number;
}

export interface VehicleState {
  x: number;
  z: number;
  heading: number; // rad, 0 = +z
  vx: number; // m/s body forward
  vy: number; // m/s body left
  yawRate: number; // rad/s
  speed: number; // |v|, kept for HUD/cameras
  steerAngle: number; // rad at front wheels
  wheelSpin: number; // rad accumulated, for wheel meshes
  forces: Forces;
}

export function createVehicleState(x = 0, z = 0, heading = 0): VehicleState {
  return {
    x, z, heading,
    vx: 0, vy: 0, yawRate: 0, speed: 0, steerAngle: 0, wheelSpin: 0,
    forces: {
      fyFront: 0, fyRear: 0, fxDrive: 0, drag: 0, downforce: 0,
      fzFront: 0, fzRear: 0, ax: 0, ay: 0, slipAngleFront: 0, slipAngleRear: 0,
    },
  };
}

/** Pacejka magic formula, lateral. Returns force for a given slip angle and load. */
function pacejkaLateral(alpha: number, fz: number, mu: number): number {
  const B = 10, C = 1.55, E = 0.97;
  const D = mu * fz;
  return -D * Math.sin(C * Math.atan(B * alpha - E * (B * alpha - Math.atan(B * alpha))));
}

export interface GripScale {
  front: number;
  rear: number;
}

export function stepVehicle(
  s: VehicleState,
  u: Controls,
  dt: number,
  p: VehicleParams = DEFAULT_PARAMS,
  grip: GripScale = { front: 1, rear: 1 }
) {
  const { throttle, brake, steer } = u;
  const L = p.a + p.b;
  // Speed-sensitive steering so full lock is usable in slow corners but not at 300 km/h
  s.steerAngle = (steer * MAX_STEER) / (1 + s.vx / 18);
  const delta = s.steerAngle;

  const v = Math.hypot(s.vx, s.vy);
  const qDyn = 0.5 * RHO * v * v;
  const aero = aeroCoeffs(p, u.drs ?? false);
  const drag = aero.cdA * qDyn;
  const downforce = aero.clA * qDyn;

  // Axle vertical loads: static + aero + longitudinal transfer (from last step's ax)
  const axPrev = s.forces.ax;
  const weight = p.mass * G;
  let fzF = (weight * p.b) / L + downforce * aero.balance - (p.mass * axPrev * p.hCg) / L;
  let fzR = (weight * p.a) / L + downforce * (1 - aero.balance) + (p.mass * axPrev * p.hCg) / L;
  fzF = Math.max(0, fzF);
  fzR = Math.max(0, fzR);

  // Longitudinal tire forces: power-limited RWD drive minus brakes, split by bias
  const power = p.powerMax + (u.powerBoost ?? 0);
  const driveAvail = throttle * (s.vx > 1 ? power / s.vx : power);
  const brakeF = brake * p.brakeForceMax * p.brakeBias * (s.vx > 0.1 ? 1 : 0);
  const brakeR = brake * p.brakeForceMax * (1 - p.brakeBias) * (s.vx > 0.1 ? 1 : 0);
  let fxFront = -brakeF;
  let fxRear = driveAvail - brakeR;

  // Friction circle per axle: longitudinal demand is capped by mu*Fz, and what is
  // used longitudinally shrinks the lateral capacity.
  const muF = p.mu * grip.front;
  const muR = p.mu * grip.rear;
  const capF = muF * fzF;
  const capR = muR * fzR;
  fxFront = Math.max(-capF, Math.min(capF, fxFront));
  fxRear = Math.max(-capR, Math.min(capR, fxRear));
  const latScaleF = Math.sqrt(Math.max(0.05, 1 - (fxFront / (capF || 1)) ** 2));
  const latScaleR = Math.sqrt(Math.max(0.05, 1 - (fxRear / (capR || 1)) ** 2));

  // Slip angles (guard the singularity at rest)
  const vxSafe = Math.max(s.vx, 0.5);
  const alphaF = Math.atan2(s.vy + p.a * s.yawRate, vxSafe) - delta;
  const alphaR = Math.atan2(s.vy - p.b * s.yawRate, vxSafe);
  const fyF = pacejkaLateral(alphaF, fzF, muF) * latScaleF;
  const fyR = pacejkaLateral(alphaR, fzR, muR) * latScaleR;

  // Rolling resistance
  const roll = 0.015 * weight * Math.sign(s.vx);

  // Equations of motion (body frame)
  const fx = fxRear + fxFront * Math.cos(delta) - fyF * Math.sin(delta) - drag * Math.sign(s.vx) - roll;
  const fy = fyF * Math.cos(delta) + fyR + fxFront * Math.sin(delta);
  const ax = fx / p.mass + s.vy * s.yawRate;
  const ay = fy / p.mass - s.vx * s.yawRate;
  const yawAcc = (p.a * (fyF * Math.cos(delta) + fxFront * Math.sin(delta)) - p.b * fyR) / p.izz;

  s.vx += ax * dt;
  s.vy += ay * dt;
  s.yawRate += yawAcc * dt;

  // Low-speed sanity: below walking pace, kill lateral drift and yaw
  if (s.vx < 1) {
    s.vy *= 0.8;
    s.yawRate *= 0.8;
    if (s.vx < 0) s.vx = 0;
  }

  // World integration
  const sinH = Math.sin(s.heading);
  const cosH = Math.cos(s.heading);
  s.x += (s.vx * sinH + s.vy * cosH) * dt;
  s.z += (s.vx * cosH - s.vy * sinH) * dt;
  s.heading += s.yawRate * dt;

  s.speed = Math.hypot(s.vx, s.vy);
  s.wheelSpin += (s.vx / CAR_DIMENSIONS.WHEEL_RADIUS) * dt;

  s.forces = {
    fyFront: fyF, fyRear: fyR, fxDrive: fxRear + fxFront,
    drag, downforce, fzFront: fzF, fzRear: fzR,
    ax: fx / p.mass, ay,
    slipAngleFront: alphaF, slipAngleRear: alphaR,
  };
}
