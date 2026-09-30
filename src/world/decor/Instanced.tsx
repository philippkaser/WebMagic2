import { useLayoutEffect, useRef } from "react";
import { Euler, InstancedMesh, Matrix4, Quaternion, Vector3, type BufferGeometry, type Material } from "three";
import type { Vec3 } from "../types";

/** A mesh template: geometry + material drawn once per instance. */
export type Part = [BufferGeometry, Material];

/** One instanced draw call per part, every part sharing the same instance
 * transforms (e.g. mushroom stems and their glowing caps). */
export function InstancedParts({
  matrices,
  parts,
  castShadow = false,
}: {
  matrices: Matrix4[];
  parts: Part[];
  castShadow?: boolean;
}) {
  const meshes = useRef<(InstancedMesh | null)[]>([]);
  useLayoutEffect(() => {
    for (const mesh of meshes.current) {
      if (!mesh) continue;
      matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.instanceMatrix.needsUpdate = true;
      // Frustum culling needs bounds over all instances, not the template.
      mesh.computeBoundingSphere();
    }
  }, [matrices, parts]);
  if (!matrices.length) return null;
  return (
    <>
      {parts.map(([geo, mat], p) => (
        <instancedMesh
          key={p}
          ref={(m) => {
            meshes.current[p] = m;
          }}
          args={[geo, mat, matrices.length]}
          castShadow={castShadow}
          receiveShadow
        />
      ))}
    </>
  );
}

const q = new Quaternion();
const e = new Euler();
const v = new Vector3();
const s = new Vector3();

/** Compose a transform from position, yaw and scale. */
export function trs(pos: Vec3, yaw = 0, scale: Vec3 | number = 1): Matrix4 {
  q.setFromEuler(e.set(0, yaw, 0));
  if (typeof scale === "number") s.setScalar(scale);
  else s.set(...scale);
  return new Matrix4().compose(v.set(...pos), q, s);
}
