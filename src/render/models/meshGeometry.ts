import { BufferAttribute, BufferGeometry } from "three";
import type { MeshData } from "./architectureMesh";

/** Plain vertex buffers (built by pure code, see architectureMesh.ts) →
 * a three.js BufferGeometry. The one place the dungeon models cross from
 * testable arrays into GPU objects; callers own and dispose the result. */
export function toGeometry(m: MeshData): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(m.positions, 3));
  g.setAttribute("normal", new BufferAttribute(m.normals, 3));
  g.setAttribute("uv", new BufferAttribute(m.uvs, 2));
  g.setIndex(new BufferAttribute(m.indices, 1));
  g.computeBoundingSphere();
  return g;
}
