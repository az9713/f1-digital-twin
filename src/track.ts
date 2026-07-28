import * as THREE from "three";

// Oval track built from a closed centerline curve. The curve object is exported
// so later phases (racing line, ghost replay) can sample the same geometry.

export const TRACK_WIDTH = 12;
const STRAIGHT = 300; // m
const RADIUS = 80; // m

export function createCenterline(): THREE.CatmullRomCurve3 {
  const pts: THREE.Vector3[] = [];
  const half = STRAIGHT / 2;
  // Two straights + two 180° arcs, sampled coarsely; CatmullRom smooths the joins
  for (let i = 0; i <= 10; i++) pts.push(new THREE.Vector3(-RADIUS, 0, -half + (STRAIGHT * i) / 10));
  for (let i = 1; i < 12; i++) {
    const a = Math.PI - (Math.PI * i) / 12; // from π to 0
    pts.push(new THREE.Vector3(-Math.cos(a) * RADIUS, 0, half + Math.sin(a) * RADIUS));
  }
  for (let i = 0; i <= 10; i++) pts.push(new THREE.Vector3(RADIUS, 0, half - (STRAIGHT * i) / 10));
  for (let i = 1; i < 12; i++) {
    const a = (Math.PI * i) / 12; // from 0 to π
    pts.push(new THREE.Vector3(Math.cos(a) * RADIUS, 0, -half - Math.sin(a) * RADIUS));
  }
  return new THREE.CatmullRomCurve3(pts, true, "catmullrom", 0.1);
}

/** Fit a closed centerline to a telemetry lap trace (racing-line approximation). */
export function centerlineFromLap(xs: number[], zs: number[]): THREE.CatmullRomCurve3 {
  const pts: THREE.Vector3[] = [];
  const stride = 8; // ~0.8 s between control points smooths GPS noise
  for (let i = 0; i < xs.length - stride; i += stride) {
    pts.push(new THREE.Vector3(xs[i], 0, zs[i]));
  }
  return new THREE.CatmullRomCurve3(pts, true, "catmullrom", 0.5);
}

/**
 * DRS zones derived from track curvature: stretches with corner radius > 600 m
 * that run at least 250 m, opening ~120 m past the corner exit (the activation
 * line). Returned as [tStart, tEnd] curve-parameter ranges; a zone may wrap t=0.
 */
export function drsZones(curve: THREE.CatmullRomCurve3, n = 800): Array<[number, number]> {
  const pts = Array.from({ length: n }, (_, i) => curve.getPointAt(i / n));
  const straight: boolean[] = [];
  const ds: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n], c = pts[(i + 2) % n];
    const ab = Math.hypot(b.x - a.x, b.z - a.z);
    const bc = Math.hypot(c.x - b.x, c.z - b.z);
    const ca = Math.hypot(a.x - c.x, a.z - c.z);
    const area2 = Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x));
    const kappa = ab * bc * ca > 1e-9 ? (2 * area2) / (ab * bc * ca) : 0;
    ds.push(ab);
    straight.push(kappa < 1 / 600);
  }
  // Scan runs starting from a corner so a straight spanning t=0 stays one run
  const k0 = straight.findIndex((s) => !s);
  if (k0 < 0) return [[0, 1]]; // no corners at all
  const zones: Array<[number, number]> = [];
  let runStart = -1;
  let runLen = 0;
  for (let i = k0; i <= k0 + n; i++) {
    if (i < k0 + n && straight[i % n]) {
      if (runStart < 0) {
        runStart = i;
        runLen = 0;
      }
      runLen += ds[i % n];
    } else if (runStart >= 0) {
      if (runLen >= 250) {
        const open = runStart + Math.ceil((120 / runLen) * (i - runStart));
        zones.push([(open % n) / n, ((i - 1) % n) / n]);
      }
      runStart = -1;
    }
  }
  return zones;
}

/** Is curve parameter t inside any zone? Handles zones that wrap t=0. */
export function inDrsZone(zones: Array<[number, number]>, t: number): boolean {
  return zones.some(([a, b]) => (a <= b ? t >= a && t <= b : t >= a || t <= b));
}

export function createTrack(scene: THREE.Scene, curve?: THREE.CatmullRomCurve3): THREE.CatmullRomCurve3 {
  curve = curve ?? createCenterline();
  const n = 800;

  // Track ribbon as a triangle strip
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t);
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
    const left = p.clone().addScaledVector(normal, TRACK_WIDTH / 2);
    const right = p.clone().addScaledVector(normal, -TRACK_WIDTH / 2);
    positions.push(left.x, 0.01, left.z, right.x, 0.01, right.z);
    if (i < n) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const asphalt = new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.95, side: THREE.DoubleSide });
  const ribbon = new THREE.Mesh(geo, asphalt);
  ribbon.receiveShadow = true;
  scene.add(ribbon);

  // Edge lines
  for (const side of [1, -1]) {
    const linePts: THREE.Vector3[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const p = curve.getPointAt(t);
      const tangent = curve.getTangentAt(t);
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
      linePts.push(p.clone().addScaledVector(normal, (side * TRACK_WIDTH) / 2).setY(0.02));
    }
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(linePts),
      new THREE.LineBasicMaterial({ color: 0xffffff })
    );
    scene.add(line);
  }

  // Start/finish line
  const sfP = curve.getPointAt(0);
  const sfT = curve.getTangentAt(0);
  const sf = new THREE.Mesh(
    new THREE.PlaneGeometry(TRACK_WIDTH, 1.2),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 })
  );
  sf.rotation.x = -Math.PI / 2;
  sf.position.copy(sfP).setY(0.02);
  sf.rotation.z = Math.atan2(sfT.x, sfT.z);
  scene.add(sf);

  // Grass plane
  const grass = new THREE.Mesh(
    new THREE.PlaneGeometry(8000, 8000),
    new THREE.MeshStandardMaterial({ color: 0x14351c, roughness: 1 })
  );
  grass.rotation.x = -Math.PI / 2;
  grass.position.y = -0.02;
  grass.receiveShadow = true;
  scene.add(grass);

  return curve;
}
