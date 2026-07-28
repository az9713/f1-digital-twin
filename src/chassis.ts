import { CAR_DIMENSIONS } from "./car";
import { DEFAULT_PARAMS, aeroCoeffs, RHO, G, MAX_STEER } from "./vehicle";
import type { Controls, VehicleParams, VehicleState } from "./vehicle";
import { MF6, combined, kappaForFx, relax } from "./tire-mf6";
import { gripFactor, stepCornerTire } from "./tires";
import type { CornerTireSet } from "./tires";

// Milestone B: 6-DOF rigid chassis on four independent corners, replacing v1's
// single-track model. Degrees of freedom: surge, sway, yaw (as in v1) plus
// heave, roll and pitch of the sprung mass.
//
// Vertical load is no longer a quasi-static formula — each corner carries a
// spring, a damper and an anti-roll bar, and the body's heave/roll/pitch states
// are integrated from those forces. Load transfer, dive, squat and body roll
// therefore *emerge*, and per-corner Fz feeds a per-corner MF6 tire.
//
// Sign conventions (body frame, x forward, y left, world heading 0 = +z):
//   heave > 0  body moves down (springs compress)
//   pitch > 0  nose down
//   roll  > 0  right-hand side down
// Corner order is FL, FR, RL, RR throughout.
//
// ponytail: the wheels are assumed to stay on the ground — no unsprung masses
// and no tire vertical spring, so suspension travel is read straight off the
// body attitude. That is the smallest model that still makes springs, dampers
// and roll bars change per-corner load, which is the point of the milestone.

export const CHASSIS = {
  ixx: 120, // roll inertia, kg m²
  iyy: 900, // pitch inertia, kg m²
  halfTrackF: 0.8,
  halfTrackR: 0.75,
  kF: 180_000, // front wheel rate, N/m (heave mode ≈ 4.6 Hz)
  kR: 160_000,
  cF: 9_000, // damping, N s/m (ζ ≈ 0.75 in heave)
  cR: 8_500,
  arbF: 90_000, // anti-roll bar rate, N/m of differential travel
  arbR: 60_000,
};

export interface Corner {
  fz: number; // N vertical load
  fx: number; // N longitudinal, tire frame
  fy: number; // N lateral, tire frame
  alpha: number; // rad, relaxed slip angle
  kappa: number; // relaxed slip ratio
  travel: number; // m of spring compression
  use: number; // 0..1 friction-ellipse utilisation, for the HUD
}

export interface ChassisState extends VehicleState {
  heave: number;
  heaveRate: number;
  roll: number;
  rollRate: number;
  pitch: number;
  pitchRate: number;
  corners: Corner[];
}

/** Corner geometry: [x forward, y left, spring, damper, arb, isFront]. */
function geometry(p: VehicleParams) {
  const { halfTrackF: hf, halfTrackR: hr, kF, kR, cF, cR, arbF, arbR } = CHASSIS;
  return [
    { x: p.a, y: hf, k: kF, c: cF, arb: arbF, front: true },
    { x: p.a, y: -hf, k: kF, c: cF, arb: arbF, front: true },
    { x: -p.b, y: hr, k: kR, c: cR, arb: arbR, front: false },
    { x: -p.b, y: -hr, k: kR, c: cR, arb: arbR, front: false },
  ];
}

/**
 * Body attitude that balances weight on the four springs. Because the front
 * and rear rates differ, the car sits with a little static pitch as well as
 * heave — the axle loads, not the travels, are what the weight distribution
 * fixes.
 */
export function staticAttitude(p: VehicleParams = DEFAULT_PARAMS) {
  const L = p.a + p.b;
  const cF = (p.mass * G * p.b) / L / (2 * CHASSIS.kF); // front travel, m
  const cR = (p.mass * G * p.a) / L / (2 * CHASSIS.kR);
  const pitch = (cF - cR) / L;
  return { heave: cF - pitch * p.a, pitch };
}

export function createChassisState(x = 0, z = 0, heading = 0, p: VehicleParams = DEFAULT_PARAMS): ChassisState {
  const { heave, pitch } = staticAttitude(p);
  const g = geometry(p);
  const travel = g.map((c) => heave + pitch * c.x);
  return {
    x, z, heading,
    vx: 0, vy: 0, yawRate: 0, speed: 0, steerAngle: 0, wheelSpin: 0,
    heave, heaveRate: 0, roll: 0, rollRate: 0, pitch, pitchRate: 0,
    corners: g.map((c, i) => ({ fz: c.k * travel[i], fx: 0, fy: 0, alpha: 0, kappa: 0, travel: travel[i], use: 0 })),
    forces: {
      fyFront: 0, fyRear: 0, fxDrive: 0, drag: 0, downforce: 0,
      fzFront: 2 * CHASSIS.kF * travel[0], fzRear: 2 * CHASSIS.kR * travel[2],
      ax: 0, ay: 0, slipAngleFront: 0, slipAngleRear: 0,
    },
  };
}

/** Per-corner grip multipliers (tire temperature × wear), FL FR RL RR. */
export type CornerGrip = [number, number, number, number];

export function stepChassis(
  s: ChassisState,
  u: Controls,
  dt: number,
  p: VehicleParams = DEFAULT_PARAMS,
  grip: CornerGrip = [1, 1, 1, 1]
) {
  const L = p.a + p.b;
  s.steerAngle = (u.steer * MAX_STEER) / (1 + s.vx / 18);
  const delta = s.steerAngle;
  const sinD = Math.sin(delta);
  const cosD = Math.cos(delta);

  const v = Math.hypot(s.vx, s.vy);
  const qDyn = 0.5 * RHO * v * v;
  const aero = aeroCoeffs(p, u.drs ?? false);
  const drag = aero.cdA * qDyn;
  const downforce = aero.clA * qDyn;
  // Longitudinal station of the aero centre of pressure that gives this balance
  const xCp = aero.balance * L - p.b;

  const g = geometry(p);

  // --- 1. Suspension: travel and rate straight off the body attitude ---
  const travel = g.map((c) => s.heave + s.pitch * c.x - s.roll * c.y);
  const rate = g.map((c) => s.heaveRate + s.pitchRate * c.x - s.rollRate * c.y);
  const arb = [
    (CHASSIS.arbF * (travel[0] - travel[1])) / 2,
    (CHASSIS.arbF * (travel[1] - travel[0])) / 2,
    (CHASSIS.arbR * (travel[2] - travel[3])) / 2,
    (CHASSIS.arbR * (travel[3] - travel[2])) / 2,
  ];
  const fz = g.map((c, i) => Math.max(0, c.k * travel[i] + c.c * rate[i] + arb[i]));

  // --- 2. Longitudinal demand per corner: RWD drive, brakes split by bias ---
  const power = p.powerMax + (u.powerBoost ?? 0);
  const drive = u.throttle * (s.vx > 1 ? power / s.vx : power);
  const braking = u.brake * p.brakeForceMax * (s.vx > 0.1 ? 1 : 0);
  const demand = [
    (-braking * p.brakeBias) / 2,
    (-braking * p.brakeBias) / 2,
    (drive - braking * (1 - p.brakeBias)) / 2,
    (drive - braking * (1 - p.brakeBias)) / 2,
  ];

  // --- 3. Per-corner slip, relaxed, then MF6 combined-slip forces ---
  let fxBody = 0;
  let fyBody = 0;
  let mz = 0;
  for (let i = 0; i < 4; i++) {
    const c = g[i];
    const k = s.corners[i];
    const vxi = s.vx - s.yawRate * c.y;
    const vyi = s.vy + s.yawRate * c.x;
    const vxSafe = Math.max(Math.abs(vxi), 0.5);
    const alphaSS = Math.atan2(vyi, vxSafe) - (c.front ? delta : 0);
    const mu = p.mu * grip[i];
    const kappaSS = kappaForFx(demand[i], fz[i], mu);

    k.alpha = relax(k.alpha, alphaSS, MF6.sigmaAlpha, v, dt);
    k.kappa = relax(k.kappa, kappaSS, MF6.sigmaKappa, v, dt);
    const f = combined(k.kappa, k.alpha, fz[i], mu);
    k.fz = fz[i];
    k.fx = f.fx;
    k.fy = f.fy;
    k.travel = travel[i];
    const cap = mu * fz[i] || 1;
    k.use = Math.min(1, Math.hypot(f.fx, f.fy) / cap);

    // Front tire forces rotate through the steer angle into the body frame
    const bx = c.front ? f.fx * cosD - f.fy * sinD : f.fx;
    const by = c.front ? f.fx * sinD + f.fy * cosD : f.fy;
    fxBody += bx;
    fyBody += by;
    mz += c.x * by - c.y * bx;
  }

  // --- 4. Planar equations of motion ---
  const roll = 0.015 * p.mass * G * Math.sign(s.vx);
  const fxTotal = fxBody - drag * Math.sign(s.vx) - roll;
  const ax = fxTotal / p.mass + s.vy * s.yawRate;
  const ay = fyBody / p.mass - s.vx * s.yawRate;

  // --- 5. Heave / pitch / roll of the sprung mass ---
  let sumFz = 0;
  let mPitch = downforce * xCp - fxBody * p.hCg;
  let mRoll = fyBody * p.hCg;
  for (let i = 0; i < 4; i++) {
    sumFz += fz[i];
    mPitch -= fz[i] * g[i].x;
    mRoll += fz[i] * g[i].y;
  }
  const heaveAcc = (p.mass * G + downforce - sumFz) / p.mass;

  s.vx += ax * dt;
  s.vy += ay * dt;
  s.yawRate += (mz / p.izz) * dt;
  s.heaveRate += heaveAcc * dt;
  s.pitchRate += (mPitch / CHASSIS.iyy) * dt;
  s.rollRate += (mRoll / CHASSIS.ixx) * dt;
  s.heave += s.heaveRate * dt;
  s.pitch += s.pitchRate * dt;
  s.roll += s.rollRate * dt;

  // Low-speed sanity, framerate-independent (v1 used a per-step 0.8 factor at 120 Hz)
  if (s.vx < 1) {
    const d = Math.min(1, 25 * dt);
    s.vy -= s.vy * d;
    s.yawRate -= s.yawRate * d;
    if (s.vx < 0) s.vx = 0;
  }

  const sinH = Math.sin(s.heading);
  const cosH = Math.cos(s.heading);
  s.x += (s.vx * sinH + s.vy * cosH) * dt;
  s.z += (s.vx * cosH - s.vy * sinH) * dt;
  s.heading += s.yawRate * dt;
  s.speed = Math.hypot(s.vx, s.vy);
  s.wheelSpin += (s.vx / CAR_DIMENSIONS.WHEEL_RADIUS) * dt;

  s.forces = {
    fyFront: s.corners[0].fy + s.corners[1].fy,
    fyRear: s.corners[2].fy + s.corners[3].fy,
    fxDrive: fxBody,
    drag,
    downforce,
    fzFront: fz[0] + fz[1],
    fzRear: fz[2] + fz[3],
    ax: fxTotal / p.mass,
    ay,
    slipAngleFront: (s.corners[0].alpha + s.corners[1].alpha) / 2,
    slipAngleRear: (s.corners[2].alpha + s.corners[3].alpha) / 2,
  };
}

/** Advance all four ring-thermal tires from the corner forces just computed. */
export function stepCornerTires(t: CornerTireSet, s: ChassisState, dt: number) {
  const v = Math.max(s.speed, 0.1);
  for (let i = 0; i < 4; i++) {
    const k = s.corners[i];
    // Sliding power = force × sliding velocity, laterally v·sin α and
    // longitudinally κ·v. The patch moves at the wheel's surface speed, so a
    // locked wheel (κ = −1) parks the heat on one tread segment.
    const slide = Math.abs(k.fy * v * Math.sin(k.alpha)) + Math.abs(k.fx * k.kappa * v);
    stepCornerTire(t.corners[i], t.compound, slide, 0.006 * k.fz * v, v, v * (1 + k.kappa), dt);
  }
}

export function cornerGrip(t: CornerTireSet): CornerGrip {
  return t.corners.map((c) => gripFactor(c, t.compound)) as CornerGrip;
}
