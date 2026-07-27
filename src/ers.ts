// Phase 4: ERS-K energy recovery + deployment and battery state of charge.
// 2024-style numbers: 120 kW MGU-K both directions, ~4 MJ usable store,
// 4 MJ/lap deploy limit, 2 MJ/lap harvest-to-store limit.
// resetLap() is called by the lap-timing layer at each start-line crossing.

export type ErsMode = "off" | "balanced" | "hotlap" | "harvest";
const MODES: ErsMode[] = ["off", "balanced", "hotlap", "harvest"];

export const ERS = {
  capacity: 4_000_000, // J
  maxPower: 120_000, // W deploy and harvest
  deployPerLap: 4_000_000, // J
  harvestPerLap: 2_000_000, // J
};

export interface ErsState {
  soc: number; // J in the store
  mode: ErsMode;
  deployedThisLap: number;
  harvestedThisLap: number;
  deploying: boolean; // for HUD
}

export function createErsState(): ErsState {
  return { soc: ERS.capacity * 0.8, mode: "balanced", deployedThisLap: 0, harvestedThisLap: 0, deploying: false };
}

export function cycleErsMode(e: ErsState) {
  e.mode = MODES[(MODES.indexOf(e.mode) + 1) % MODES.length];
}

export function resetLap(e: ErsState) {
  e.deployedThisLap = 0;
  e.harvestedThisLap = 0;
}

/**
 * Returns extra drive power (W) from the MGU-K for this step and updates SOC.
 * Deployment policy per mode; harvest happens under braking in every mode.
 */
export function stepErs(e: ErsState, throttle: number, brake: number, speed: number, dt: number): number {
  // Harvest: braking at speed drives the MGU-K as a generator on the rear axle
  if (brake > 0.05 && speed > 5 && e.harvestedThisLap < ERS.harvestPerLap && e.soc < ERS.capacity) {
    const p = ERS.maxPower * Math.min(1, brake * 1.5);
    const j = Math.min(p * dt, ERS.capacity - e.soc, ERS.harvestPerLap - e.harvestedThisLap);
    e.soc += j;
    e.harvestedThisLap += j;
  }

  // Deploy: full throttle at speed, gated by mode
  const wantsDeploy =
    e.mode !== "off" &&
    e.mode !== "harvest" &&
    throttle > 0.85 &&
    speed > 15 &&
    e.soc > 0 &&
    e.deployedThisLap < ERS.deployPerLap;
  // "balanced" saves the store below 30% SOC; "hotlap" empties it
  const socFloor = e.mode === "balanced" ? 0.3 * ERS.capacity : 0;
  e.deploying = wantsDeploy && e.soc > socFloor;
  if (!e.deploying) return 0;

  const j = Math.min(ERS.maxPower * dt, e.soc - socFloor, ERS.deployPerLap - e.deployedThisLap);
  e.soc -= j;
  e.deployedThisLap += j;
  return j / dt;
}
