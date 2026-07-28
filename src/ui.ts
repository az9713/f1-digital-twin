import { simulateStrategy, parseStints, type StrategyResult } from "./strategy";
import type { COMPOUNDS } from "./tires";

// Phase 5 overlays: pit stop + strategy sandbox. Pausing is owned here.

export type SessionMode = "quali" | "practice" | "race";

export interface UiHooks {
  canPit: () => boolean;
  onCompound: (c: keyof typeof COMPOUNDS) => void;
  onMode: (m: SessionMode) => void;
  baseLap: number; // clean-lap baseline for the strategy sim, seconds
}

export function setupOverlays(hooks: UiHooks): { paused: () => boolean } {
  const pitOverlay = document.getElementById("pit-overlay")!;
  const stratOverlay = document.getElementById("strategy-overlay")!;
  const modeOverlay = document.getElementById("mode-overlay")!;
  const open = (el: HTMLElement) => el.classList.add("open");
  const close = (el: HTMLElement) => el.classList.remove("open");
  const anyOpen = () =>
    pitOverlay.classList.contains("open") ||
    stratOverlay.classList.contains("open") ||
    modeOverlay.classList.contains("open");

  window.addEventListener("keydown", (e) => {
    if (e.repeat) return;
    if (e.code === "KeyP" && !anyOpen() && hooks.canPit()) open(pitOverlay);
    if (e.code === "KeyT") stratOverlay.classList.toggle("open");
    if (e.code === "KeyM") modeOverlay.classList.toggle("open");
    if (e.code === "Escape") {
      close(pitOverlay);
      close(stratOverlay);
      close(modeOverlay);
    }
  });

  modeOverlay.querySelectorAll("button[data-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      hooks.onMode((btn as HTMLElement).dataset.mode as SessionMode);
      close(modeOverlay);
    });
  });
  document.getElementById("mode-cancel")!.addEventListener("click", () => close(modeOverlay));

  pitOverlay.querySelectorAll("button[data-compound]").forEach((btn) => {
    btn.addEventListener("click", () => {
      hooks.onCompound((btn as HTMLElement).dataset.compound as keyof typeof COMPOUNDS);
      close(pitOverlay);
    });
  });
  document.getElementById("pit-cancel")!.addEventListener("click", () => close(pitOverlay));
  document.getElementById("strat-close")!.addEventListener("click", () => close(stratOverlay));

  document.getElementById("strat-run")!.addEventListener("click", () => {
    const laps = parseInt((document.getElementById("strat-laps") as HTMLInputElement).value) || 20;
    const a = parseStints((document.getElementById("strat-a") as HTMLInputElement).value);
    const b = parseStints((document.getElementById("strat-b") as HTMLInputElement).value);
    const out = document.getElementById("strat-result")!;
    if (!a || !b) {
      out.textContent = 'Could not parse a strategy — use e.g. "soft:8, hard:12"';
      return;
    }
    const ra = simulateStrategy("A", a, hooks.baseLap, laps);
    const rb = simulateStrategy("B", b, hooks.baseLap, laps);
    drawChart(document.getElementById("strategy-chart") as HTMLCanvasElement, ra, rb);
    const gap = ra.total - rb.total;
    out.textContent =
      `A: ${ra.total.toFixed(1)} s   B: ${rb.total.toFixed(1)} s   →   ` +
      (Math.abs(gap) < 0.05 ? "dead heat" : gap < 0 ? `A wins by ${(-gap).toFixed(1)} s` : `B wins by ${gap.toFixed(1)} s`);
  });

  return { paused: anyOpen };
}

function drawChart(canvas: HTMLCanvasElement, a: StrategyResult, b: StrategyResult) {
  const ctx = canvas.getContext("2d")!;
  const W = canvas.width, H = canvas.height;
  const padL = 46, padR = 12, padT = 16, padB = 30;
  ctx.clearRect(0, 0, W, H);

  const all = [...a.lapTimes, ...b.lapTimes];
  const yMin = Math.min(...all) - 0.5;
  const yMax = Math.max(...all) + 0.5;
  const n = Math.max(a.lapTimes.length, b.lapTimes.length);
  const x = (i: number) => padL + ((W - padL - padR) * i) / Math.max(1, n - 1);
  const y = (v: number) => padT + ((H - padT - padB) * (yMax - v)) / (yMax - yMin);

  // Grid + axis labels
  ctx.strokeStyle = "#2a3444";
  ctx.fillStyle = "#8b9bb4";
  ctx.font = "10px system-ui";
  ctx.lineWidth = 1;
  for (let g = 0; g <= 4; g++) {
    const v = yMin + ((yMax - yMin) * g) / 4;
    const yy = y(v);
    ctx.beginPath();
    ctx.moveTo(padL, yy);
    ctx.lineTo(W - padR, yy);
    ctx.stroke();
    ctx.fillText(`${v.toFixed(1)}s`, 6, yy + 3);
  }
  for (let i = 0; i < n; i += Math.ceil(n / 10)) {
    ctx.fillText(`L${i + 1}`, x(i) - 6, H - 12);
  }

  const line = (r: StrategyResult, color: string) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    r.lapTimes.forEach((t, i) => (i ? ctx.lineTo(x(i), y(t)) : ctx.moveTo(x(i), y(t))));
    ctx.stroke();
  };
  line(a, "#22d3ee");
  line(b, "#f59e0b");
  ctx.fillStyle = "#22d3ee";
  ctx.fillText("A", W - 40, padT + 10);
  ctx.fillStyle = "#f59e0b";
  ctx.fillText("B", W - 24, padT + 10);
}
