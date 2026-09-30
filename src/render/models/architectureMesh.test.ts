import { describe, expect, test } from "bun:test";
import { ARCHITECTURE, TILE, WALL_HEIGHT } from "../../core/config";
import { generateFloor } from "../../world/gen";
import type { FloorArchitecture } from "../../world/types";
import { type MeshData, buildArchitectureMeshes, ribProfile, worldUv } from "./architectureMesh";

/** The stone mesh replaced the instanced wall cubes, so it inherits their
 * contract — a face on every rock/floor boundary, none anywhere else — plus
 * its own: consistent winding, square world-scaled texels, and a base
 * course with no gaps or overlaps round corners. */

const NONE: FloorArchitecture = { pillars: [], ribs: [], shafts: [], crystals: [] };
const T = ARCHITECTURE.texMetres;
const PH = ARCHITECTURE.plinthHeight;
const PD = ARCHITECTURE.plinthDepth;

/** A size×size grid with one w×h room carved at (x0, y0). */
function room(size: number, x0: number, y0: number, w: number, h: number): Uint8Array {
  const tiles = new Uint8Array(size * size);
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) tiles[y * size + x] = 1;
  return tiles;
}

interface Tri {
  p: [number, number, number][];
  n: [number, number, number][];
  uv: [number, number][];
}

function triangles(m: MeshData): Tri[] {
  const out: Tri[] = [];
  for (let t = 0; t < m.indices.length; t += 3) {
    const tri: Tri = { p: [], n: [], uv: [] };
    for (let k = 0; k < 3; k++) {
      const i = m.indices[t + k];
      tri.p.push([m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]]);
      tri.n.push([m.normals[i * 3], m.normals[i * 3 + 1], m.normals[i * 3 + 2]]);
      tri.uv.push([m.uvs[i * 2], m.uvs[i * 2 + 1]]);
    }
    out.push(tri);
  }
  return out;
}

function faceNormal(t: Tri): [number, number, number] {
  const [a, b, c] = t.p;
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
}

const area = (t: Tri) => Math.hypot(...faceNormal(t)) / 2;

describe("architecture mesh", () => {
  const floor = generateFloor(4242, 40);
  const meshes = buildArchitectureMeshes(
    { tiles: floor.tiles, size: floor.size, architecture: floor.architecture },
    { seamChance: 0.2 },
  );

  test("every triangle is wound to face along its normals", () => {
    for (const m of [meshes.stone, meshes.seams, meshes.seamGlow]) {
      for (const t of triangles(m)) {
        if (area(t) < 1e-9) continue;
        const g = faceNormal(t);
        for (const n of t.n) expect(g[0] * n[0] + g[1] * n[1] + g[2] * n[2]).toBeGreaterThan(0);
      }
    }
  });

  test("buffers are consistent and indices in range", () => {
    for (const m of [meshes.stone, meshes.seams, meshes.seamGlow]) {
      const verts = m.positions.length / 3;
      expect(m.normals.length).toBe(m.positions.length);
      expect(m.uvs.length).toBe(verts * 2);
      for (const i of m.indices) expect(i).toBeLessThan(verts);
      for (const v of m.positions) expect(Number.isFinite(v)).toBe(true);
    }
  });

  test("one full-height wall face per rock/floor boundary, and nothing else", () => {
    const { tiles, size } = floor;
    let boundaries = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (tiles[y * size + x] === 1) continue;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < size && ny < size && tiles[ny * size + nx] === 1) boundaries++;
        }
      }
    }
    const plain = buildArchitectureMeshes({ tiles, size, architecture: NONE });
    const wallTris = triangles(plain.stone).filter(
      (t) => Math.abs(Math.min(...t.p.map((p) => p[1])) - PH) < 1e-6 && Math.abs(Math.max(...t.p.map((p) => p[1])) - WALL_HEIGHT) < 1e-6,
    );
    expect(wallTris.length).toBe(boundaries * 2);
    // Each wall face sits on a tile edge with floor in front and rock behind.
    for (const t of wallTris) {
      const n = t.n[0];
      const cx = (t.p[0][0] + t.p[1][0] + t.p[2][0]) / 3;
      const cz = (t.p[0][2] + t.p[1][2] + t.p[2][2]) / 3;
      const tile = (wx: number, wz: number) => {
        const x = Math.floor(wx / TILE + size / 2);
        const y = Math.floor(wz / TILE + size / 2);
        return tiles[y * size + x];
      };
      expect(tile(cx + n[0] * 0.5, cz + n[2] * 0.5)).toBe(1);
      expect(tile(cx - n[0] * 0.5, cz - n[2] * 0.5)).toBe(0);
    }
  });

  test("texels are square and world-scaled on every flat face", () => {
    for (const t of triangles(meshes.stone)) {
      const n = t.n[0];
      if (t.n.some((m) => Math.abs(m[0] - n[0]) + Math.abs(m[1] - n[1]) + Math.abs(m[2] - n[2]) > 1e-6)) continue;
      if (area(t) < 1e-6) continue;
      // UV area = world area / T² when the mapping is an isometry / T.
      const [a, b, c] = t.uv;
      const uvArea = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
      expect(uvArea).toBeCloseTo(area(t) / (T * T), 6);
    }
  });

  test("courses flow unbroken along a straight wall (shared edges share UVs)", () => {
    const size = 12;
    const plain = buildArchitectureMeshes({ tiles: room(size, 3, 3, 6, 5), size, architecture: NONE });
    const walls = triangles(plain.stone).filter((t) => t.n[0][2] === -1 && Math.min(...t.p.map((p) => p[1])) >= PH - 1e-6);
    // Every vertex position on this wall maps to one UV, whichever face it's on.
    const seen = new Map<string, string>();
    for (const t of walls) {
      t.p.forEach((p, k) => {
        const key = p.map((v) => v.toFixed(4)).join(",");
        const uv = t.uv[k].map((v) => v.toFixed(4)).join(",");
        if (seen.has(key)) expect(seen.get(key)).toBe(uv);
        seen.set(key, uv);
      });
    }
    expect(seen.size).toBeGreaterThan(4);
  });

  test("worldUv puts v = height on walls and keeps u running along the wall", () => {
    expect(worldUv([1, 2, 3], [0, 0, 1])).toEqual([1 / T, 2 / T]);
    expect(worldUv([1, 2, 3], [0, 0, -1])).toEqual([-1 / T, 2 / T]);
    expect(worldUv([1, 2, 3], [1, 0, 0])).toEqual([-3 / T, 2 / T]);
    expect(worldUv([1, 2, 3], [-1, 0, 0])).toEqual([3 / T, 2 / T]);
    expect(worldUv([1, 2, 3], [0, 1, 0])).toEqual([1 / T, -3 / T]);
  });

  test("the base course rings a room with no gaps and no overlaps", () => {
    const size = 14;
    const [w, h] = [6, 4];
    const plain = buildArchitectureMeshes({ tiles: room(size, 4, 5, w, h), size, architecture: NONE });
    const tops = triangles(plain.stone).filter((t) => t.p.every((p) => Math.abs(p[1] - PH) < 1e-6) && t.n[0][1] > 0.99);
    const topArea = tops.reduce((s, t) => s + area(t), 0);
    // North/south strips run the full wall; east/west ones stop short of
    // the corners by the course depth, where they abut the others.
    const expected = PD * (2 * w * TILE + 2 * (h * TILE - 2 * PD));
    expect(topArea).toBeCloseTo(expected, 6);
  });

  test("convex corners are wrapped and capped", () => {
    // A plus-shaped hole: a 1-tile rock in the middle of a 3×3 room has
    // four convex corners; its course area covers the full ring round it.
    const size = 9;
    const tiles = room(size, 2, 2, 5, 5);
    tiles[4 * size + 4] = 0;
    const plain = buildArchitectureMeshes({ tiles, size, architecture: NONE });
    const tops = triangles(plain.stone).filter(
      (t) =>
        t.p.every((p) => Math.abs(p[1] - PH) < 1e-6 && Math.abs(p[0]) < TILE && Math.abs(p[2]) < TILE) && t.n[0][1] > 0.99,
    );
    const ring = (TILE + 2 * PD) ** 2 - TILE * TILE;
    expect(tops.reduce((s, t) => s + area(t), 0)).toBeCloseTo(ring, 6);
    // Four caps close the grown ends (vertical faces 0.14 wide at the column).
    const caps = triangles(plain.stone).filter((t) => {
      const xs = t.p.map((p) => p[0]);
      const zs = t.p.map((p) => p[2]);
      const w = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
      return Math.abs(t.n[0][1]) < 1e-6 && Math.abs(w - PD) < 1e-6 && Math.max(...t.p.map((p) => p[1])) <= PH + 1e-6;
    });
    expect(caps.length).toBe(4 * 2);
  });

  test("seams only where asked, deterministically", () => {
    const again = buildArchitectureMeshes(
      { tiles: floor.tiles, size: floor.size, architecture: floor.architecture },
      { seamChance: 0.2 },
    );
    expect(again.seams.positions).toEqual(meshes.seams.positions);
    expect(meshes.seams.indices.length).toBeGreaterThan(0);
    const none = buildArchitectureMeshes({ tiles: floor.tiles, size: floor.size, architecture: floor.architecture });
    expect(none.seams.indices.length).toBe(0);
    expect(none.seamGlow.indices.length).toBe(0);
  });

  test("ribs rise with their span but stay well above head height", () => {
    for (const span of [10, 14, 20]) {
      const { springY, crownY, rise } = ribProfile(span);
      expect(springY).toBeGreaterThan(3.3);
      expect(crownY).toBeLessThan(WALL_HEIGHT);
      expect(crownY - springY).toBeCloseTo(rise, 9);
    }
    expect(ribProfile(20).rise).toBeGreaterThan(ribProfile(10).rise);
  });

  test("pillars and ribs add geometry that stays inside the vault", () => {
    const plain = buildArchitectureMeshes({ tiles: floor.tiles, size: floor.size, architecture: NONE });
    expect(meshes.stone.indices.length).toBeGreaterThan(plain.stone.indices.length);
    for (let i = 1; i < meshes.stone.positions.length; i += 3) {
      expect(meshes.stone.positions[i]).toBeGreaterThanOrEqual(-1e-6);
      expect(meshes.stone.positions[i]).toBeLessThanOrEqual(WALL_HEIGHT + 1e-6);
    }
  });
});
