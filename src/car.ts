import * as THREE from "three";

// ponytail: procedural placeholder car built from primitives.
// Swap for a CC0 GLTF in a later phase — same Group interface, nothing else changes.

export interface CarModel {
  root: THREE.Group;
  wheels: THREE.Mesh[]; // FL, FR, RL, RR — spun by the sim loop
  frontWheels: THREE.Mesh[]; // steered visually
}

const WHEEL_RADIUS = 0.33;
const WHEELBASE = 3.6;
const TRACK_FRONT = 1.6;
const TRACK_REAR = 1.5;

export function createCar(): CarModel {
  const root = new THREE.Group();

  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xd32f2f, roughness: 0.4, metalness: 0.3 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6 });
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });

  // Monocoque: narrow tapered tub
  const tub = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.35, 3.4), bodyMat);
  tub.position.set(0, 0.35, 0.1);
  root.add(tub);

  // Nose cone
  const nose = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.32, 1.4, 12), bodyMat);
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, 0.32, 2.5);
  root.add(nose);

  // Cockpit halo + airbox hint
  const airbox = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.45, 0.9), bodyMat);
  airbox.position.set(0, 0.72, -0.5);
  root.add(airbox);

  // Front wing
  const frontWing = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.06, 0.55), darkMat);
  frontWing.position.set(0, 0.12, 3.15);
  root.add(frontWing);

  // Rear wing
  const rearWing = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.06, 0.45), darkMat);
  rearWing.position.set(0, 0.85, -1.85);
  root.add(rearWing);
  const wingPlate = new THREE.BoxGeometry(0.05, 0.4, 0.45);
  for (const x of [-0.5, 0.5]) {
    const plate = new THREE.Mesh(wingPlate, darkMat);
    plate.position.set(x, 0.68, -1.85);
    root.add(plate);
  }

  // Floor
  const floor = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.05, 3.6), darkMat);
  floor.position.set(0, 0.1, 0);
  root.add(floor);

  // Sidepods
  for (const x of [-0.65, 0.65]) {
    const pod = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.35, 1.6), bodyMat);
    pod.position.set(x, 0.32, -0.4);
    root.add(pod);
  }

  // Wheels
  const wheelGeo = new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, 0.36, 20);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheels: THREE.Mesh[] = [];
  const frontWheels: THREE.Mesh[] = [];
  const positions: [number, number, boolean][] = [
    [-TRACK_FRONT / 2, WHEELBASE / 2, true],
    [TRACK_FRONT / 2, WHEELBASE / 2, true],
    [-TRACK_REAR / 2, -WHEELBASE / 2, false],
    [TRACK_REAR / 2, -WHEELBASE / 2, false],
  ];
  for (const [x, z, isFront] of positions) {
    // Pivot group so front wheels can steer around Y while the mesh spins around X
    const pivot = new THREE.Group();
    pivot.position.set(x, WHEEL_RADIUS, z);
    const wheel = new THREE.Mesh(wheelGeo, tireMat.clone()); // own material → per-axle heat tint
    pivot.add(wheel);
    root.add(pivot);
    wheels.push(wheel);
    if (isFront) frontWheels.push(pivot as unknown as THREE.Mesh);
  }

  root.traverse((o) => {
    o.castShadow = true;
    o.receiveShadow = true;
  });

  return { root, wheels, frontWheels };
}

export const CAR_DIMENSIONS = { WHEEL_RADIUS, WHEELBASE, TRACK_FRONT, TRACK_REAR };
