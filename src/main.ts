import * as THREE from "three";
import { createCar } from "./car";
import { createTrack, centerlineFromLap, drsZones, inDrsZone } from "./track";
import { Input } from "./input";
import { createVehicleState } from "./vehicle";
import type { Snapshot, ToWorker } from "./physics-worker";
import { CameraRig } from "./cameras";
import { loadSession } from "./session";
import { Ghost } from "./ghost";
import { ForceArrows } from "./forces";
import { tempToColor } from "./tires";
import { createErsState, stepErs, cycleErsMode, ERS, resetLap } from "./ers";
import { Timing, fmtLap } from "./timing";
import { setupOverlays, type SessionMode } from "./ui";
import { DEFAULT_PARAMS } from "./vehicle";
import { COMPOUNDS } from "./tires";

const WHEEL_OF = [1, 0, 3, 2]; // physics corner FL,FR,RL,RR → car.wheels index

const app = document.getElementById("app")!;
const speedEl = document.getElementById("speed-val")!;
const hudEl = document.getElementById("hud")!;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);
window.addEventListener("resize", () => renderer.setSize(window.innerWidth, window.innerHeight));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87b5d9);
scene.fog = new THREE.Fog(0x87b5d9, 600, 2500);

const sun = new THREE.DirectionalLight(0xfff4e0, 2.2);
sun.position.set(120, 180, 80);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const SHADOW_EXTENT = 200;
sun.shadow.camera.left = -SHADOW_EXTENT;
sun.shadow.camera.right = SHADOW_EXTENT;
sun.shadow.camera.top = SHADOW_EXTENT;
sun.shadow.camera.bottom = -SHADOW_EXTENT;
sun.shadow.camera.far = 600;
scene.add(sun);
scene.add(new THREE.AmbientLight(0xbcd4e8, 0.6));

async function init() {
  const session = await loadSession("monza-2024");

  const trackCurve = session
    ? createTrack(scene, centerlineFromLap(session.x, session.z))
    : createTrack(scene);

  const car = createCar();
  scene.add(car.root);

  let ghost: Ghost | null = null;
  if (session) {
    ghost = new Ghost(scene, session);
    const m = session.meta;
    const title = hudEl.querySelector("b");
    if (title) title.textContent = `F1 Digital Twin — ${m.circuit} ${m.year}`;
    const info = document.createElement("div");
    info.textContent = `Ghost: car ${m.driver_number}, lap ${m.lap_number} (${m.lap_time_s.toFixed(3)}s)`;
    info.style.color = "#22d3ee";
    hudEl.appendChild(info);
  }

  // Spawn on the start/finish line, pointing along the track
  const startPos = trackCurve.getPointAt(0);
  const startTan = trackCurve.getTangentAt(0);
  const startHeading = Math.atan2(startTan.x, startTan.z);

  // Milestone B: the 6-DOF chassis + MF6 tires live on a worker at 1 kHz.
  // `vehicle` is the main thread's *view* of it — two snapshots interpolated,
  // in the same shape the cameras, timing, ghost delta and force arrows expect.
  const physics = new Worker(new URL("./physics-worker.ts", import.meta.url), { type: "module" });
  const post = (m: ToWorker) => physics.postMessage(m);
  const vehicle = Object.assign(createVehicleState(startPos.x, startPos.z, startHeading), {
    roll: 0, pitch: 0, heave: 0,
  });
  let tireView: Snapshot["tires"] = [0, 1, 2, 3].map(() => ({ tSurface: 60, tBulk: 60, wear: 0, spread: 0 }));
  let snapPrev: Snapshot | null = null;
  let snapCur: Snapshot | null = null;
  let snapAt = 0; // s, when the newest snapshot arrived
  let snapGap = 0.008; // s between snapshots, measured
  physics.onmessage = (e: MessageEvent<Snapshot>) => {
    snapPrev = snapCur ?? e.data;
    snapCur = e.data;
    const now = performance.now() / 1000;
    if (snapAt) snapGap = Math.max(0.002, Math.min(0.05, now - snapAt));
    snapAt = now;
    tireView = e.data.tires;
  };
  post({ cmd: "reset", x: startPos.x, z: startPos.z, heading: startHeading });

  /** Render one snapshot behind the worker, lerped by arrival time. */
  function syncView() {
    if (!snapPrev || !snapCur) return;
    const f = Math.min(1, (performance.now() / 1000 - snapAt) / snapGap);
    const a = snapPrev;
    const b = snapCur;
    const l = (p: number, q: number) => p + (q - p) * f;
    vehicle.x = l(a.x, b.x);
    vehicle.z = l(a.z, b.z);
    vehicle.heading = l(a.heading, b.heading); // unwrapped, so a plain lerp is safe
    vehicle.roll = l(a.roll, b.roll);
    vehicle.pitch = l(a.pitch, b.pitch);
    vehicle.heave = l(a.heave, b.heave);
    vehicle.speed = l(a.speed, b.speed);
    vehicle.vx = l(a.vx, b.vx);
    vehicle.vy = l(a.vy, b.vy);
    vehicle.yawRate = l(a.yawRate, b.yawRate);
    vehicle.steerAngle = l(a.steerAngle, b.steerAngle);
    vehicle.wheelSpin = l(a.wheelSpin, b.wheelSpin);
    vehicle.forces = b.forces;
  }

  const input = new Input();
  const rig = new CameraRig(renderer);
  input.onCameraToggle = () => rig.toggle();
  const arrows = new ForceArrows(scene);
  window.addEventListener("keydown", (e) => {
    if (e.code === "KeyF" && !e.repeat) arrows.toggle();
  });
  let compoundKey: keyof typeof COMPOUNDS = "medium";
  const tireEls = ["tire-fl", "tire-fr", "tire-rl", "tire-rr"].map((id) => document.getElementById(id)!);
  const compoundEl = document.getElementById("compound-label")!;

  const ers = createErsState();
  const zones = drsZones(trackCurve);
  let drsWanted = false;
  let drsAvailable = false;
  window.addEventListener("keydown", (e) => {
    if (e.repeat) return;
    if (e.code === "KeyE") drsWanted = !drsWanted;
    if (e.code === "KeyQ") cycleErsMode(ers);
  });
  const socBarEl = document.getElementById("soc-bar")!;
  const ersModeEl = document.getElementById("ers-mode")!;
  const drsEl = document.getElementById("drs")!;

  // Phase 5: timing, fuel, pit, strategy
  const timing = new Timing(trackCurve, session);
  timing.timer.onLapComplete = () => resetLap(ers);
  const MODE_FUEL: Record<SessionMode, number> = { quali: 12, practice: 30, race: 100 };
  let fuel = MODE_FUEL.quali; // kg
  const resetCar = () => {
    const p0 = trackCurve.getPointAt(0);
    const t0 = trackCurve.getTangentAt(0);
    post({ cmd: "reset", x: p0.x, z: p0.z, heading: Math.atan2(t0.x, t0.z) });
    snapPrev = snapCur = null;
    Object.assign(vehicle, createVehicleState(p0.x, p0.z, Math.atan2(t0.x, t0.z)));
  };
  const modeLabelEl = document.getElementById("mode-label")!;
  const ui = setupOverlays({
    canPit: () => vehicle.speed < 5,
    onCompound: (c) => {
      compoundKey = c;
      post({ cmd: "compound", key: c });
      compoundEl.textContent = COMPOUNDS[c].name;
      timing.timer.lapTime += 24; // pit loss
    },
    onMode: (m) => {
      fuel = MODE_FUEL[m];
      post({ cmd: "compound", key: compoundKey });
      Object.assign(ers, createErsState());
      timing.reset();
      resetCar();
      modeLabelEl.textContent = m[0].toUpperCase() + m.slice(1);
    },
    baseLap: session ? session.meta.lap_time_s : 82,
  });
  window.addEventListener("keydown", (e) => {
    if (e.code === "KeyR" && !e.repeat) resetCar();
  });
  const lapNoEl = document.getElementById("lap-no")!;
  const lapCurEl = document.getElementById("lap-cur")!;
  const lapLastEl = document.getElementById("lap-last")!;
  const lapBestEl = document.getElementById("lap-best")!;
  const deltaEl = document.getElementById("delta")!;
  const fuelEl = document.getElementById("fuel")!;
  const sectorEls = ["s1", "s2", "s3"].map((id) => document.getElementById(id)!);

  let last = performance.now();
  car.root.rotation.order = "YXZ"; // yaw, then pitch about the car's axle line, then roll

  function frame(now: number) {
    requestAnimationFrame(frame);
    const frameDt = Math.min((now - last) / 1000, 0.1);
    last = now;

    if (!ui.paused()) {
      syncView();
      input.update(frameDt);
      // DRS: only inside curvature-derived zones, and it closes itself under
      // braking, steering, or low speed
      const tPos = timing.trackT(vehicle);
      drsAvailable = inDrsZone(zones, tPos);
      if (!drsAvailable || input.brake > 0.05 || Math.abs(input.steer) > 0.25 || vehicle.speed < 22)
        drsWanted = false;
      const boost = stepErs(ers, input.throttle, input.brake, vehicle.speed, frameDt);
      fuel = Math.max(0, fuel - input.throttle * 0.042 * frameDt);
      post({
        cmd: "controls",
        u: {
          throttle: input.throttle, brake: input.brake, steer: input.steer,
          drs: drsWanted, powerBoost: boost, mass: DEFAULT_PARAMS.mass + fuel,
        },
      });
      timing.update(vehicle, frameDt, tPos);
      ghost?.update(frameDt);
    }

    // Sync visuals
    car.root.position.set(vehicle.x, 0, vehicle.z);
    // +x is the car's left here (heading 0 = +z forward, body y = left), so a
    // right-side-down roll raises +x → rotation.z takes roll unnegated.
    car.root.rotation.set(vehicle.pitch, vehicle.heading, vehicle.roll);
    for (const w of car.wheels) w.rotation.x = vehicle.wheelSpin;
    for (const fw of car.frontWheels) fw.rotation.y = vehicle.steerAngle;

    // Keep the shadow camera centered on the player so shadows work on a 5.8 km circuit
    sun.position.set(vehicle.x + 120, 180, vehicle.z + 80);
    sun.target.position.set(vehicle.x, 0, vehicle.z);
    sun.target.updateMatrixWorld();

    // Tire heat tint + HUD tile, now one per corner (FL, FR, RL, RR).
    // car.wheels is built right-first (x = -track/2 is +x-negative = the right
    // side), so the mesh for corner i is WHEEL_OF[i].
    for (let i = 0; i < 4; i++) {
      const t = tireView[i];
      const [r, g, b] = tempToColor(t.tSurface);
      (car.wheels[WHEEL_OF[i]].material as THREE.MeshStandardMaterial).color.setRGB(r * 0.6, g * 0.6, b * 0.6);
      const el = tireEls[i];
      el.style.borderColor = `rgb(${r * 255},${g * 255},${b * 255})`;
      (el.querySelector(".t") as HTMLElement).textContent = `${Math.round(t.tSurface)}°`;
      const bar = el.querySelector(".w div") as HTMLElement;
      bar.style.width = `${Math.max(0, (1 - t.wear) * 100)}%`;
      bar.style.background = t.wear > 0.65 ? "#ef4444" : t.wear > 0.4 ? "#f59e0b" : "#10b981";
      // Load bar: how hard this corner is being worked, 0..1 of its friction ellipse
      const use = el.querySelector(".u div") as HTMLElement;
      const u = snapCur ? snapCur.corners[i].use : 0;
      use.style.width = `${u * 100}%`;
      use.style.background = u > 0.95 ? "#ef4444" : "#22d3ee";
    }

    // ERS + DRS HUD
    socBarEl.style.width = `${(ers.soc / ERS.capacity) * 100}%`;
    socBarEl.style.background = ers.deploying ? "#f59e0b" : "#22d3ee";
    ersModeEl.textContent = `ERS: ${ers.mode}`;
    // DRS lamp: bright = open, dim green = available in this zone, faint = no zone
    drsEl.style.opacity = drsWanted ? "1" : drsAvailable ? "0.65" : "0.2";

    // Timing HUD
    lapNoEl.textContent = String(timing.timer.lap);
    lapCurEl.textContent = timing.timer.lap > 0 ? fmtLap(timing.timer.lapTime) : "–:––.–––";
    lapLastEl.textContent = fmtLap(timing.timer.lastLap);
    lapBestEl.textContent = fmtLap(timing.timer.bestLap);
    fuelEl.textContent = fuel.toFixed(1);
    for (let i = 0; i < 3; i++) {
      const el = sectorEls[i];
      const last = timing.sectors.last[i];
      el.textContent = last === null ? "––.––" : last.toFixed(2);
      el.style.color = last !== null && last === timing.sectors.best[i] ? "#10b981" : "#e8eef7";
    }
    const delta = timing.ghostDelta(vehicle);
    if (delta === null) {
      deltaEl.textContent = "±0.000";
      deltaEl.style.color = "#8b9bb4";
    } else {
      deltaEl.textContent = `${delta >= 0 ? "+" : ""}${delta.toFixed(3)}`;
      deltaEl.style.color = delta <= 0 ? "#10b981" : "#ef4444";
    }

    arrows.update(vehicle);
    rig.update(vehicle, frameDt);
    speedEl.textContent = String(Math.round(vehicle.speed * 3.6));
    renderer.render(scene, rig.camera);
  }
  requestAnimationFrame(frame);
}

init();
