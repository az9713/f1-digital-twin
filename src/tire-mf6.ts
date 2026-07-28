// Milestone B: Magic Formula 6.x-style tire — combined slip + transients.
//
// Pure slip:  Fx0(κ), Fy0(α), both peaking at μ(Fz)·Fz.
// Combined:   Fx = Fx0·Gxα(α), Fy = Fy0·Gyκ(κ) using MF6's cosine weighting
//             functions. Unlike v1's hard friction-circle clamp this couples
//             the two channels smoothly and *before* saturation, so a little
//             trail-braking already costs a little cornering grip.
// Load:       μ falls as Fz rises above the nominal corner load (real slicks).
// Transients: σ·dα/dt = v·(α_ss − α) — relaxation length, so slip (and force)
//             builds over a travelled distance instead of instantly.
//
// ponytail: no camber, turn-slip, or horizontal/vertical shifts; the
// longitudinal curve uses E = 0 so it can be inverted analytically (see
// kappaForFx) instead of carrying a wheel-spin DOF and a root solver.

export const MF6 = {
  Bx: 11, Cx: 1.5, // longitudinal pure slip (peak at κ ≈ 0.16)
  By: 10, Cy: 1.55, Ey: 0.97, // lateral pure slip (v1's shape, preserved)
  Bxa: 9, Cxa: 1, // Gxα: slip angle eats longitudinal force
  Byk: 11, Cyk: 1, // Gyκ: slip ratio eats lateral force
  fz0: 4000, // N, nominal corner load
  loadSens: 0.05, // μ lost per unit of (Fz − Fz0)/Fz0
  sigmaKappa: 0.3, // m, longitudinal relaxation length
  sigmaAlpha: 0.45, // m, lateral relaxation length
};

/** Load-sensitive friction: a corner carrying more load returns less μ. */
export function muLoad(mu: number, fz: number): number {
  return mu * Math.max(0.6, 1 - (MF6.loadSens * (fz - MF6.fz0)) / MF6.fz0);
}

export function fx0(kappa: number, fz: number, mu: number): number {
  return muLoad(mu, fz) * fz * Math.sin(MF6.Cx * Math.atan(MF6.Bx * kappa));
}

export function fy0(alpha: number, fz: number, mu: number): number {
  const Ba = MF6.By * alpha;
  return -muLoad(mu, fz) * fz * Math.sin(MF6.Cy * Math.atan(Ba - MF6.Ey * (Ba - Math.atan(Ba))));
}

/** Slip ratio that would produce this longitudinal force (exact inverse of fx0). */
export function kappaForFx(fx: number, fz: number, mu: number): number {
  const d = muLoad(mu, fz) * fz;
  if (d < 1) return 0;
  const r = Math.max(-0.999, Math.min(0.999, fx / d));
  return Math.tan(Math.asin(r) / MF6.Cx) / MF6.Bx;
}

/** MF6 combined slip: each channel is scaled by a cosine weighting of the other. */
export function combined(kappa: number, alpha: number, fz: number, mu: number) {
  const gxa = Math.cos(MF6.Cxa * Math.atan(MF6.Bxa * alpha));
  const gyk = Math.cos(MF6.Cyk * Math.atan(MF6.Byk * kappa));
  return { fx: fx0(kappa, fz, mu) * gxa, fy: fy0(alpha, fz, mu) * gyk, gxa, gyk };
}

/** First-order relaxation toward a steady-state slip over relaxation length σ. */
export function relax(cur: number, target: number, sigma: number, v: number, dt: number): number {
  const k = Math.min(1, (Math.max(Math.abs(v), 0.5) / sigma) * dt);
  return cur + (target - cur) * k;
}
