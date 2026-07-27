import type { VehicleState } from "./vehicle";

// Phase 3: three-node tire thermal network (surface / bulk / carcass) + wear.
// ponytail: per-axle resolution, mirrored onto both wheels of the axle — the
// single-track vehicle model can't distinguish left/right anyway.
//
// Heat in:  sliding power (lateral slip × force, drive/brake slip fraction)
//           + rolling deformation heating.
// Heat out: convection from surface (speed-dependent) and carcass (to airflow).
// Grip:     Gaussian window around the compound's optimal bulk temperature.
// Wear:     accumulates with sliding energy, hotter surface wears faster;
//           grip falls gently to a "cliff" past 65% wear.

export interface Compound {
  name: string;
  color: number; // sidewall band color
  tOpt: number; // °C optimal bulk temperature
  tWindow: number; // °C gaussian width
  gripPeak: number; // mu multiplier at optimum, fresh tire
  wearRate: number; // wear fraction per MJ of sliding energy
}

export const COMPOUNDS: Record<string, Compound> = {
  soft: { name: "Soft", color: 0xef4444, tOpt: 95, tWindow: 38, gripPeak: 1.05, wearRate: 0.055 },
  medium: { name: "Medium", color: 0xfbbf24, tOpt: 100, tWindow: 42, gripPeak: 1.0, wearRate: 0.035 },
  hard: { name: "Hard", color: 0xf1f5f9, tOpt: 105, tWindow: 46, gripPeak: 0.96, wearRate: 0.022 },
};

export interface AxleTire {
  tSurface: number; // °C
  tBulk: number;
  tCarcass: number;
  wear: number; // 0..1
}

export interface TireModelState {
  front: AxleTire;
  rear: AxleTire;
  compound: Compound;
}

const T_AMBIENT = 28;
const T_TRACK = 38;

// Thermal parameters (per axle pair, lumped)
const C_SURFACE = 9_000; // J/K — thin tread layer
const C_BULK = 35_000;
const C_CARCASS = 45_000;
const K_SB = 900; // W/K surface↔bulk conduction (thin tread, tight coupling)
const K_BC = 350; // W/K bulk↔carcass
const H_SURF = 9; // W/K per (m/s) surface convection coefficient
const H_CARC = 8; // W/K per (m/s) carcass/rim convection (airflow through the wheel)

export function createTireModel(compoundKey: keyof typeof COMPOUNDS = "medium"): TireModelState {
  const cold = (): AxleTire => ({ tSurface: 60, tBulk: 60, tCarcass: 55, wear: 0 });
  return { front: cold(), rear: cold(), compound: COMPOUNDS[compoundKey] };
}

/** Grip multiplier for the vehicle model: temperature window × wear state. */
export function gripFactor(tire: AxleTire, c: Compound): number {
  const dT = (tire.tBulk - c.tOpt) / c.tWindow;
  const thermal = 0.72 + 0.28 * Math.exp(-dT * dT); // cold/overheated tires keep ~72%
  const w = tire.wear;
  const wearF = w < 0.65 ? 1 - 0.12 * (w / 0.65) : 0.88 - 0.5 * (w - 0.65); // cliff past 65%
  return c.gripPeak * thermal * Math.max(0.5, wearF);
}

function stepAxle(
  tire: AxleTire,
  c: Compound,
  slidePower: number, // W of frictional sliding at the contact patch
  rollPower: number, // W of deformation heating
  v: number, // m/s airspeed for cooling
  dt: number
) {
  const heatIn = slidePower * 0.85 + rollPower; // most sliding heat enters the tread
  const conv = H_SURF * (3 + v) * (tire.tSurface - T_AMBIENT);
  const toTrack = 25 * (tire.tSurface - T_TRACK); // conduction into the track surface
  const sb = K_SB * (tire.tSurface - tire.tBulk);
  const bc = K_BC * (tire.tBulk - tire.tCarcass);
  const carcConv = H_CARC * (3 + v) * (tire.tCarcass - T_AMBIENT);

  tire.tSurface += ((heatIn - conv - toTrack - sb) / C_SURFACE) * dt;
  tire.tBulk += ((sb + slidePower * 0.15 - bc) / C_BULK) * dt;
  tire.tCarcass += ((bc - carcConv) / C_CARCASS) * dt;

  // Wear: sliding energy in MJ × rate, accelerated when the surface runs hot
  const hotFactor = 1 + Math.max(0, (tire.tSurface - c.tOpt - 15) / 60);
  tire.wear = Math.min(1, tire.wear + (slidePower * dt) / 1e6 * c.wearRate * hotFactor);
}

/** Advance tire temperatures/wear from the vehicle's current force state. */
export function stepTires(t: TireModelState, s: VehicleState, dt: number) {
  const v = Math.max(s.speed, 0.1);
  const f = s.forces;

  // Sliding velocity ≈ v·sin(slip angle); drive/brake adds a slip-ratio share
  const slideF = Math.abs(f.fyFront * v * Math.sin(f.slipAngleFront)) + 0.04 * Math.abs(Math.min(0, f.fxDrive)) * v * 0.5;
  const slideR = Math.abs(f.fyRear * v * Math.sin(f.slipAngleRear)) + 0.04 * Math.abs(f.fxDrive) * v * 0.5;
  const rollF = 0.006 * f.fzFront * v;
  const rollR = 0.006 * f.fzRear * v;

  stepAxle(t.front, t.compound, slideF, rollF, v, dt);
  stepAxle(t.rear, t.compound, slideR, rollR, v, dt);
}

/** Map a surface temperature to a display color (blue → green → yellow → red). */
export function tempToColor(tC: number): [number, number, number] {
  const stops: [number, [number, number, number]][] = [
    [40, [0.2, 0.4, 1.0]],
    [80, [0.2, 0.9, 0.4]],
    [105, [1.0, 0.85, 0.2]],
    [130, [1.0, 0.15, 0.1]],
  ];
  if (tC <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (tC <= stops[i][0]) {
      const [t0, c0] = stops[i - 1];
      const [t1, c1] = stops[i];
      const f = (tC - t0) / (t1 - t0);
      return [c0[0] + (c1[0] - c0[0]) * f, c0[1] + (c1[1] - c0[1]) * f, c0[2] + (c1[2] - c0[2]) * f];
    }
  }
  return stops[stops.length - 1][1];
}
