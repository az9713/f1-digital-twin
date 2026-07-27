import { COMPOUNDS, createTireModel, gripFactor, stepTires, type TireModelState } from "./tires";
import { createVehicleState } from "./vehicle";

// Phase 5: Strategy Sandbox — race simulation built on the *same* tire
// thermal/wear model the driving sim uses. Lap time = clean-lap baseline
// + grip deficit penalty + fuel mass penalty; pit stops cost a fixed loss.
//
// ponytail: per-lap analytical race sim (no AI driver laps) — the tire state
// is advanced with a representative load profile per lap, so degradation
// curves and compound crossovers come from the physics, not a table.

export interface Stint {
  compound: keyof typeof COMPOUNDS;
  laps: number;
}

export interface StrategyResult {
  name: string;
  lapTimes: number[];
  total: number;
}

const PIT_LOSS = 24; // s, pit lane + stop at Monza
const FUEL_PER_LAP = 1.9; // kg
const FUEL_PENALTY = 0.033; // s per kg of fuel carried
const GRIP_SENSITIVITY = 55; // s of lap time per unit of grip factor lost

/** Advance a tire set through one representative flying lap's worth of load. */
function lapOfWear(tires: TireModelState, baseLap: number) {
  const s = createVehicleState();
  // Representative Monza profile: ~70% of the lap loaded at high speed
  s.speed = 58;
  s.vx = 58;
  s.forces = {
    fyFront: 5200, fyRear: 6200, fxDrive: 4200, drag: 4800, downforce: 14000,
    fzFront: 6200, fzRear: 7800, ax: 0, ay: 18,
    slipAngleFront: 0.05, slipAngleRear: 0.045,
  };
  const loadedTime = baseLap * 0.7;
  for (let i = 0; i < loadedTime; i++) stepTires(tires, s, 1);
  // Straights: no sliding, airflow cooling
  s.forces.fyFront = s.forces.fyRear = 0;
  s.forces.slipAngleFront = s.forces.slipAngleRear = 0;
  for (let i = 0; i < baseLap - loadedTime; i++) stepTires(tires, s, 1);
}

export function simulateStrategy(name: string, stints: Stint[], baseLap: number, raceLaps: number): StrategyResult {
  const lapTimes: number[] = [];
  let fuel = raceLaps * FUEL_PER_LAP;
  let lapCount = 0;

  for (let si = 0; si < stints.length && lapCount < raceLaps; si++) {
    const stint = stints[si];
    const tires = createTireModel(stint.compound);
    // Fresh tires start cool: out-lap penalty emerges from the thermal model
    for (let lap = 0; lap < stint.laps && lapCount < raceLaps; lap++, lapCount++) {
      const g = (gripFactor(tires.front, tires.compound) + gripFactor(tires.rear, tires.compound)) / 2;
      const gRef = COMPOUNDS.medium.gripPeak; // baseline lap assumes peak medium grip
      let t = baseLap + (gRef - g) * GRIP_SENSITIVITY + fuel * FUEL_PENALTY;
      if (lap === 0 && si > 0) t += PIT_LOSS; // stop taken entering this stint
      lapTimes.push(t);
      lapOfWear(tires, baseLap);
      fuel = Math.max(0, fuel - FUEL_PER_LAP);
    }
  }
  return { name, lapTimes, total: lapTimes.reduce((a, b) => a + b, 0) };
}

/** Parse "soft:12, hard:20" into stints. Returns null on nonsense. */
export function parseStints(text: string): Stint[] | null {
  const stints: Stint[] = [];
  for (const part of text.split(",")) {
    const m = part.trim().match(/^(soft|medium|hard)\s*:\s*(\d+)$/i);
    if (!m) return null;
    stints.push({ compound: m[1].toLowerCase() as Stint["compound"], laps: parseInt(m[2]) });
  }
  return stints.length ? stints : null;
}
