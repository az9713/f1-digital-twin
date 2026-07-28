import { createChassisState, stepChassis, stepCornerTires, cornerGrip } from "./chassis";
import { createCornerTires } from "./tires";
import type { COMPOUNDS } from "./tires";
import { DEFAULT_PARAMS } from "./vehicle";

// Milestone B: the 6-DOF chassis + MF6 tires run here, on their own thread, at
// a fixed 1 kHz — fast enough for the stiff suspension and slip transients and
// immune to render-rate stutter. The main thread only posts controls and
// interpolates the snapshots this worker streams back.

export const PHYSICS_HZ = 1000;
const DT = 1 / PHYSICS_HZ;
const MAX_CATCHUP = 0.05; // s of simulation per tick, so a stall can't spiral

export interface WorkerControls {
  throttle: number;
  brake: number;
  steer: number;
  drs: boolean;
  powerBoost: number;
  mass: number;
}

export interface Snapshot {
  t: number; // s of simulated time
  x: number; z: number; heading: number;
  roll: number; pitch: number; heave: number;
  vx: number; vy: number; yawRate: number; speed: number;
  steerAngle: number; wheelSpin: number;
  forces: import("./vehicle").Forces;
  corners: { fz: number; use: number; slip: number }[];
  tires: { tSurface: number; tBulk: number; wear: number; spread: number }[];
}

export type ToWorker =
  | { cmd: "controls"; u: WorkerControls }
  | { cmd: "reset"; x: number; z: number; heading: number }
  | { cmd: "compound"; key: keyof typeof COMPOUNDS };

// ponytail: `self` is typed as a Window by the DOM lib (the project has one
// tsconfig for main thread + worker), so the worker scope is cast once here.
const ctx = self as unknown as {
  postMessage(m: Snapshot): void;
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null;
};

let state = createChassisState();
let tires = createCornerTires("medium");
const params = { ...DEFAULT_PARAMS };
let u: WorkerControls = { throttle: 0, brake: 0, steer: 0, drs: false, powerBoost: 0, mass: DEFAULT_PARAMS.mass };
let simTime = 0;
let last = performance.now();

ctx.onmessage = (e) => {
  const m = e.data;
  if (m.cmd === "controls") u = m.u;
  else if (m.cmd === "reset") state = createChassisState(m.x, m.z, m.heading, params);
  else if (m.cmd === "compound") tires = createCornerTires(m.key);
};

function snapshot(): Snapshot {
  return {
    t: simTime,
    x: state.x, z: state.z, heading: state.heading,
    roll: state.roll, pitch: state.pitch, heave: state.heave,
    vx: state.vx, vy: state.vy, yawRate: state.yawRate, speed: state.speed,
    steerAngle: state.steerAngle, wheelSpin: state.wheelSpin,
    forces: state.forces,
    corners: state.corners.map((c) => ({ fz: c.fz, use: c.use, slip: c.alpha })),
    tires: tires.corners.map((c) => ({
      tSurface: c.tSurface, tBulk: c.tBulk, wear: c.wear,
      spread: Math.max(...c.ring) - Math.min(...c.ring),
    })),
  };
}

function tick() {
  const now = performance.now();
  let budget = Math.min((now - last) / 1000, MAX_CATCHUP);
  last = now;
  params.mass = u.mass;
  const controls = { throttle: u.throttle, brake: u.brake, steer: u.steer, drs: u.drs, powerBoost: u.powerBoost };
  while (budget >= DT) {
    stepChassis(state, controls, DT, params, cornerGrip(tires));
    stepCornerTires(tires, state, DT);
    simTime += DT;
    budget -= DT;
  }
  ctx.postMessage(snapshot());
}

setInterval(tick, 4);
