import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

type Vec3 = [number, number, number];
export type StaticShape = { name: string; center: Vec3 } & (
  { kind: 'box'; halfExtents: Vec3; axes: [Vec3, Vec3, Vec3] } |
  { kind: 'cylinder'; radius: number; length: number; flatEnds: boolean; axis: Vec3 } |
  { kind: 'sphere'; radius: number }
);
export interface InteriorCollision { version: number; source: string; sha256: string; shapes: StaticShape[] }

/** Native static volumes use world coordinates, already reflected by the exporter. */
export function staticCollisionGeometry(data: InteriorCollision): THREE.BufferGeometry {
  const parts = data.shapes.map(shape => {
    let geometry: THREE.BufferGeometry;
    if (shape.kind === 'box') {
      geometry = new THREE.BoxGeometry(...shape.halfExtents.map(n => n * 2) as Vec3);
      const x = new THREE.Vector3(...shape.axes[0]).normalize();
      const y = new THREE.Vector3(...shape.axes[1]).normalize();
      // A reflected basis has negative determinant. A box is symmetric about its
      // axes, so choosing a right-handed third axis preserves its shape and winding.
      const z = new THREE.Vector3().crossVectors(x, y).normalize();
      geometry.applyMatrix4(new THREE.Matrix4().makeBasis(x, y, z));
    } else if (shape.kind === 'cylinder') {
      // PAL native constructor 0x002ce390 bounds rounded cylinders by length +
      // radius, and flat cylinders by sqrt(length² + radius²): length is half-span.
      geometry = shape.flatEnds
        ? new THREE.CylinderGeometry(shape.radius, shape.radius, shape.length * 2, 12)
        : new THREE.CapsuleGeometry(shape.radius, shape.length * 2, 4, 12);
      geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...shape.axis).normalize()));
    } else {
      geometry = new THREE.SphereGeometry(shape.radius, 12, 8);
    }
    geometry.translate(...shape.center);
    const triangles = geometry.toNonIndexed();
    geometry.dispose();
    triangles.deleteAttribute('normal');triangles.deleteAttribute('uv');
    return triangles;
  });
  const result = mergeGeometries(parts);
  parts.forEach(part => part.dispose());
  if (!result) throw new Error(`No static collision shapes in ${data.source}`);
  return result;
}
