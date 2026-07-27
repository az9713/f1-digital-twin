import * as THREE from "three";
import type { VehicleState } from "./vehicle";
import type { SessionData } from "./session";

// Phase 5: lap timing via start-line plane crossing, live delta to the ghost
// computed by arc-position comparison (the classic timing-loop delta).

export interface LapTimer {
  lap: number;
  lapTime: number; // s, running
  lastLap: number | null;
  bestLap: number | null;
  onLapComplete: ((lapTime: number) => void) | null;
}

export class Timing {
  timer: LapTimer = { lap: 0, lapTime: 0, lastLap: null, bestLap: null, onLapComplete: null };
  private startPoint: THREE.Vector3;
  private startTangent: THREE.Vector3;
  private prevSide = 0;
  private curve: THREE.CatmullRomCurve3;
  private tGuess = 0;
  // Ghost arc-length → time lookup, from the telemetry speed integral
  private ghostDist: number[] = []; // cumulative meters at each sample
  private session: SessionData | null;
  private trackLength = 0;

  constructor(curve: THREE.CatmullRomCurve3, session: SessionData | null) {
    this.curve = curve;
    this.session = session;
    this.startPoint = curve.getPointAt(0);
    this.startTangent = curve.getTangentAt(0);
    this.trackLength = curve.getLength();
    if (session) {
      let d = 0;
      this.ghostDist = session.speed.map((v) => (d += v * session.dt));
    }
  }

  /** Signed distance of the car ahead(+)/behind(−) the start-line plane. */
  private sideOf(x: number, z: number): number {
    return (x - this.startPoint.x) * this.startTangent.x + (z - this.startPoint.z) * this.startTangent.z;
  }

  /** Curve parameter of the car via local search around the last known position. */
  trackT(s: VehicleState): number {
    let best = this.tGuess;
    let bestD = Infinity;
    for (let i = -20; i <= 20; i++) {
      const t = (this.tGuess + i * 0.001 + 1) % 1;
      const p = this.curve.getPointAt(t);
      const d = (p.x - s.x) ** 2 + (p.z - s.z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    this.tGuess = best;
    return best;
  }

  /** Live delta vs the ghost: + means the player is slower. Null off-lap. */
  ghostDelta(s: VehicleState): number | null {
    if (!this.session || this.timer.lap === 0) return null;
    const arc = this.trackT(s) * this.trackLength;
    // Find ghost time at the same arc distance
    const gd = this.ghostDist;
    let lo = 0, hi = gd.length - 1;
    if (arc >= gd[hi]) return null;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (gd[mid] < arc) lo = mid + 1;
      else hi = mid;
    }
    const ghostTime = lo * this.session.dt;
    return this.timer.lapTime - ghostTime;
  }

  update(s: VehicleState, dt: number) {
    if (this.timer.lap > 0) this.timer.lapTime += dt;
    const near = (s.x - this.startPoint.x) ** 2 + (s.z - this.startPoint.z) ** 2 < 30 * 30;
    const side = this.sideOf(s.x, s.z);
    if (near && this.prevSide < 0 && side >= 0 && s.speed > 3) {
      if (this.timer.lap > 0 && this.timer.lapTime > 20) {
        const t = this.timer.lapTime;
        this.timer.lastLap = t;
        if (this.timer.bestLap === null || t < this.timer.bestLap) this.timer.bestLap = t;
        this.timer.onLapComplete?.(t);
      }
      this.timer.lap += 1;
      this.timer.lapTime = 0;
    }
    this.prevSide = side;
  }
}

export function fmtLap(t: number | null): string {
  if (t === null) return "–:––.–––";
  const m = Math.floor(t / 60);
  return `${m}:${(t - m * 60).toFixed(3).padStart(6, "0")}`;
}
