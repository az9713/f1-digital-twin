import * as THREE from "three";
import { createCar } from "./car";
import { sampleChannel, type SessionData } from "./session";

/** Translucent replay of a real telemetry lap. */
export class Ghost {
  readonly root: THREE.Group;
  private session: SessionData;
  time = 0;

  constructor(scene: THREE.Scene, session: SessionData) {
    this.session = session;
    const car = createCar();
    this.root = car.root;
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        const m = (o.material as THREE.MeshStandardMaterial).clone();
        m.transparent = true;
        m.opacity = 0.35;
        m.color.set(0x22d3ee);
        m.depthWrite = false;
        o.material = m;
        o.castShadow = false;
      }
    });
    scene.add(this.root);
  }

  update(dt: number) {
    this.time += dt;
    const s = this.session;
    const x = sampleChannel(s, s.x, this.time);
    const z = sampleChannel(s, s.z, this.time);
    // Heading from a short look-ahead along the path
    const xa = sampleChannel(s, s.x, this.time + 0.2);
    const za = sampleChannel(s, s.z, this.time + 0.2);
    this.root.position.set(x, 0, z);
    if (Math.hypot(xa - x, za - z) > 0.01) {
      this.root.rotation.y = Math.atan2(xa - x, za - z);
    }
  }

  get speedKmh(): number {
    return sampleChannel(this.session, this.session.speed, this.time) * 3.6;
  }
}
