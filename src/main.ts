import * as THREE from "three";
import { createCar } from "./car";
import { createTrack, centerlineFromLap } from "./track";
import { Input } from "./input";
import { createVehicleState, stepVehicle } from "./vehicle";
import { CameraRig } from "./cameras";
import { loadSession } from "./session";
import { Ghost } from "./ghost";

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
      stepVehicle(vehicle, input.throttle, input.brake, input.steer, FIXED_DT);
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

    rig.update(vehicle, frameDt);
    speedEl.textContent = String(Math.round(vehicle.speed * 3.6));
    renderer.render(scene, rig.camera);
  }
  requestAnimationFrame(frame);
}

init();
