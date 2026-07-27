import * as THREE from "three";
import { createCar } from "./car";
import { createTrack, centerlineFromLap } from "./track";
import { Input } from "./input";
import { createVehicleState, stepVehicle } from "./vehicle";
import { CameraRig } from "./cameras";
import { loadSession } from "./session";
import { Ghost } from "./ghost";
import { ForceArrows } from "./forces";
import { createTireModel, stepTires, gripFactor, tempToColor } from "./tires";
import { createErsState, stepErs, cycleErsMode, ERS } from "./ers";

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
  const vehicle = createVehicleState(startPos.x, startPos.z, Math.atan2(startTan.x, startTan.z));

  const input = new Input();
  const rig = new CameraRig(renderer);
  input.onCameraToggle = () => rig.toggle();
  const arrows = new ForceArrows(scene);
  window.addEventListener("keydown", (e) => {
    if (e.code === "KeyF" && !e.repeat) arrows.toggle();
  });
  const tires = createTireModel("medium");
  const tireFEl = document.getElementById("tire-f")!;
  const tireREl = document.getElementById("tire-r")!;

  const ers = createErsState();
  let drsWanted = false;
  window.addEventListener("keydown", (e) => {
    if (e.repeat) return;
    if (e.code === "KeyE") drsWanted = !drsWanted;
    if (e.code === "KeyQ") cycleErsMode(ers);
  });
  const socBarEl = document.getElementById("soc-bar")!;
  const ersModeEl = document.getElementById("ers-mode")!;
  const drsEl = document.getElementById("drs")!;

  const FIXED_DT = 1 / 120; // fixed-step sim, decoupled from render rate
  let accumulator = 0;
  let last = performance.now();

  function frame(now: number) {
    requestAnimationFrame(frame);
    const frameDt = Math.min((now - last) / 1000, 0.1);
    last = now;

    accumulator += frameDt;
    while (accumulator >= FIXED_DT) {
      input.update(FIXED_DT);
      // DRS closes itself under braking, steering, or low speed
      if (input.brake > 0.05 || Math.abs(input.steer) > 0.25 || vehicle.speed < 22) drsWanted = false;
      const boost = stepErs(ers, input.throttle, input.brake, vehicle.speed, FIXED_DT);
      stepVehicle(
        vehicle,
        { throttle: input.throttle, brake: input.brake, steer: input.steer, drs: drsWanted, powerBoost: boost },
        FIXED_DT,
        undefined,
        {
          front: gripFactor(tires.front, tires.compound),
          rear: gripFactor(tires.rear, tires.compound),
        }
      );
      stepTires(tires, vehicle, FIXED_DT);
      ghost?.update(FIXED_DT);
      accumulator -= FIXED_DT;
    }

    // Sync visuals
    car.root.position.set(vehicle.x, 0, vehicle.z);
    car.root.rotation.y = vehicle.heading;
    for (const w of car.wheels) w.rotation.x = vehicle.wheelSpin;
    for (const fw of car.frontWheels) fw.rotation.y = vehicle.steerAngle;

    // Keep the shadow camera centered on the player so shadows work on a 5.8 km circuit
    sun.position.set(vehicle.x + 120, 180, vehicle.z + 80);
    sun.target.position.set(vehicle.x, 0, vehicle.z);
    sun.target.updateMatrixWorld();

    // Tire heat tint on the 3D wheels (front = wheels 0,1 / rear = 2,3)
    const [rf, gf, bf] = tempToColor(tires.front.tSurface);
    const [rr, gr, br] = tempToColor(tires.rear.tSurface);
    (car.wheels[0].material as THREE.MeshStandardMaterial).color.setRGB(rf * 0.6, gf * 0.6, bf * 0.6);
    (car.wheels[1].material as THREE.MeshStandardMaterial).color.setRGB(rf * 0.6, gf * 0.6, bf * 0.6);
    (car.wheels[2].material as THREE.MeshStandardMaterial).color.setRGB(rr * 0.6, gr * 0.6, br * 0.6);
    (car.wheels[3].material as THREE.MeshStandardMaterial).color.setRGB(rr * 0.6, gr * 0.6, br * 0.6);

    // HUD tire widget
    const updateTile = (el: HTMLElement, t: { tSurface: number; wear: number }) => {
      const [r, g, b] = tempToColor(t.tSurface);
      el.style.borderColor = `rgb(${r * 255},${g * 255},${b * 255})`;
      (el.querySelector(".t") as HTMLElement).textContent = `${Math.round(t.tSurface)}°`;
      const bar = el.querySelector(".w div") as HTMLElement;
      bar.style.width = `${Math.max(0, (1 - t.wear) * 100)}%`;
      bar.style.background = t.wear > 0.65 ? "#ef4444" : t.wear > 0.4 ? "#f59e0b" : "#10b981";
    };
    updateTile(tireFEl, tires.front);
    updateTile(tireREl, tires.rear);

    // ERS + DRS HUD
    socBarEl.style.width = `${(ers.soc / ERS.capacity) * 100}%`;
    socBarEl.style.background = ers.deploying ? "#f59e0b" : "#22d3ee";
    ersModeEl.textContent = `ERS: ${ers.mode}`;
    drsEl.style.opacity = drsWanted ? "1" : "0.25";

    arrows.update(vehicle);
    rig.update(vehicle, frameDt);
    speedEl.textContent = String(Math.round(vehicle.speed * 3.6));
    renderer.render(scene, rig.camera);
  }
  requestAnimationFrame(frame);
}

init();
