import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { VehicleState } from "./vehicle";

export type CameraMode = "chase" | "onboard" | "free";
const MODES: CameraMode[] = ["chase", "onboard", "free"];

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  private mode: CameraMode = "chase";
  private orbit: OrbitControls;

  constructor(renderer: THREE.WebGLRenderer) {
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);
    this.camera.position.set(20, 15, 20);
    this.orbit = new OrbitControls(this.camera, renderer.domElement);
    this.orbit.enabled = false;
    window.addEventListener("resize", () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
    });
  }

  toggle() {
    this.mode = MODES[(MODES.indexOf(this.mode) + 1) % MODES.length];
    this.orbit.enabled = this.mode === "free";
  }

  get currentMode(): CameraMode {
    return this.mode;
  }

  update(s: VehicleState, dt: number) {
    const forward = new THREE.Vector3(Math.sin(s.heading), 0, Math.cos(s.heading));
    const carPos = new THREE.Vector3(s.x, 0, s.z);

    if (this.mode === "chase") {
      const target = carPos.clone().addScaledVector(forward, -9).add(new THREE.Vector3(0, 3.5, 0));
      // Exponential smoothing, frame-rate independent
      const k = 1 - Math.exp(-6 * dt);
      this.camera.position.lerp(target, k);
      this.camera.lookAt(carPos.clone().add(new THREE.Vector3(0, 0.8, 0)));
    } else if (this.mode === "onboard") {
      this.camera.position.copy(carPos).addScaledVector(forward, 0.2).add(new THREE.Vector3(0, 1.1, 0));
      this.camera.lookAt(carPos.clone().addScaledVector(forward, 20).add(new THREE.Vector3(0, 0.8, 0)));
    } else {
      this.orbit.target.copy(carPos);
      this.orbit.update();
    }
  }
}
