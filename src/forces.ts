import * as THREE from "three";
import type { VehicleState } from "./vehicle";

// Live free-body diagram: every force the model computes is drawn as an arrow
// anchored where it physically acts. Toggle with F.

const N_PER_METER = 4000; // arrow length scale
const MAX_LEN = 6;

interface Arrow {
  helper: THREE.ArrowHelper;
  color: number;
}

export class ForceArrows {
  private arrows: Record<string, Arrow> = {};
  private group = new THREE.Group();
  visible = true;

  constructor(scene: THREE.Scene) {
    const make = (name: string, color: number) => {
      const helper = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 1, color, 0.5, 0.3);
      this.group.add(helper);
      this.arrows[name] = { helper, color };
    };
    make("fyFront", 0xa78bfa); // lateral front — purple
    make("fyRear", 0xc4b5fd); // lateral rear — light purple
    make("drive", 0x34d399); // drive/brake — green
    make("drag", 0xf59e0b); // drag — orange
    make("downforce", 0x22d3ee); // downforce — cyan
    scene.add(this.group);
  }

  toggle() {
    this.visible = !this.visible;
    this.group.visible = this.visible;
  }

  update(s: VehicleState) {
    if (!this.visible) return;
    const sinH = Math.sin(s.heading);
    const cosH = Math.cos(s.heading);
    const fwd = new THREE.Vector3(sinH, 0, cosH);
    const left = new THREE.Vector3(cosH, 0, -sinH);
    const pos = new THREE.Vector3(s.x, 0.4, s.z);
    const front = pos.clone().addScaledVector(fwd, 1.8);
    const rear = pos.clone().addScaledVector(fwd, -1.8);

    const set = (name: string, origin: THREE.Vector3, dir: THREE.Vector3, newtons: number) => {
      const a = this.arrows[name].helper;
      const len = Math.min(Math.abs(newtons) / N_PER_METER, MAX_LEN);
      if (len < 0.05) {
        a.visible = false;
        return;
      }
      a.visible = true;
      a.position.copy(origin);
      const d = dir.clone().multiplyScalar(Math.sign(newtons)).normalize();
      a.setDirection(d);
      a.setLength(len, Math.min(0.5, len * 0.3), Math.min(0.3, len * 0.2));
    };

    set("fyFront", front, left, s.forces.fyFront);
    set("fyRear", rear, left, s.forces.fyRear);
    set("drive", rear.clone().add(new THREE.Vector3(0, 0.2, 0)), fwd, s.forces.fxDrive);
    set("drag", pos.clone().add(new THREE.Vector3(0, 0.6, 0)), fwd, -s.forces.drag);
    set("downforce", pos.clone().add(new THREE.Vector3(0, 1.2, 0)), new THREE.Vector3(0, -1, 0), s.forces.downforce);
  }
}
