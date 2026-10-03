import { describe, expect, test } from "bun:test";
import { TILE, WALL_HEIGHT } from "../../core/config";
import { generateFloor } from "../../world/gen";
import { TEXELS_PER_METRE, WALL_TEX_H, WALL_TEX_W, WALL_VARIANTS, wallAtlasU } from "../textures/surfaces";
import { type MeshData, buildWallMesh, faceHash, pickVariant, worldUv } from "./architectureMesh";

/** The wall mesh replaced the instanced wall cubes, so it inherits their
 * contract — a full-height face on every rock/floor boundary, none anywhere
 * else — plus its own: consistent winding, one painted wall texture per
 * face with square texels, and set-pieces that never repeat side by side. */

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

describe("wall mesh", () => {
  const floor = generateFloor(4242, 40);
  const mesh = buildWallMesh({ tiles: floor.tiles, size: floor.size, seed: floor.seed });
  const tris = triangles(mesh);

  test("every triangle is wound to face along its normals", () => {
    for (const t of tris) {
      const g = faceNormal(t);
      for (const n of t.n) expect(g[0] * n[0] + g[1] * n[1] + g[2] * n[2]).toBeGreaterThan(0);
    }
  });

  test("buffers are consistent and indices in range", () => {
    const verts = mesh.positions.length / 3;
    expect(mesh.normals.length).toBe(mesh.positions.length);
    expect(mesh.uvs.length).toBe(verts * 2);
    for (const i of mesh.indices) expect(i).toBeLessThan(verts);
    for (const v of mesh.positions) expect(Number.isFinite(v)).toBe(true);
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
    expect(tris.length).toBe(boundaries * 2);
    for (const t of tris) {
      expect(Math.min(...t.p.map((p) => p[1]))).toBeCloseTo(0, 6);
      expect(Math.max(...t.p.map((p) => p[1]))).toBeCloseTo(WALL_HEIGHT, 6);
      // Each face sits on a tile edge with floor in front and rock behind.
      const n = t.n[0];
      const cx = (t.p[0][0] + t.p[1][0] + t.p[2][0]) / 3;
      const cz = (t.p[0][2] + t.p[1][2] + t.p[2][2]) / 3;
      const tile = (wx: number, wz: number) =>
        tiles[Math.floor(wz / TILE + size / 2) * size + Math.floor(wx / TILE + size / 2)];
      expect(tile(cx + n[0] * 0.5, cz + n[2] * 0.5)).toBe(1);
      expect(tile(cx - n[0] * 0.5, cz - n[2] * 0.5)).toBe(0);
    }
  });

  test("each face shows one whole wall texture with square texels", () => {
    const atlasW = WALL_TEX_W * WALL_VARIANTS;
    for (const t of tris) {
      // v runs from the floor (0) to the vault (1)…
      t.p.forEach((p, k) => expect(t.uv[k][1]).toBeCloseTo(p[1] / WALL_HEIGHT, 6));
      // …and u stays inside one variant's column of the atlas.
      const us = t.uv.map((uv) => uv[0]);
      const col = Math.floor(Math.min(...us) * WALL_VARIANTS);
      expect(Math.floor(Math.max(...us) * WALL_VARIANTS - 1e-9)).toBe(col);
      // Texel density: texels per metre equal across and up the face.
      const uvArea = Math.abs(
        (t.uv[1][0] - t.uv[0][0]) * (t.uv[2][1] - t.uv[0][1]) - (t.uv[2][0] - t.uv[0][0]) * (t.uv[1][1] - t.uv[0][1]),
      ) / 2;
      const texels = uvArea * atlasW * WALL_TEX_H;
      expect(texels / area(t)).toBeCloseTo(TEXELS_PER_METRE * TEXELS_PER_METRE, -2);
    }
  });

  test("mostly the common wall; set-pieces present but never twice in a row", () => {
    const counts = [0, 0, 0];
    const variantOf = (t: Tri) => Math.floor(Math.min(...t.uv.map((uv) => uv[0])) * WALL_VARIANTS);
    for (let i = 0; i < tris.length; i += 2) counts[variantOf(tris[i])]++;
    expect(counts[0]).toBeGreaterThan(counts[1] + counts[2]);
    expect(counts[1]).toBeGreaterThan(0);
    expect(counts[2]).toBeGreaterThan(0);
    // Faces on one straight wall of a plain room: no identical neighbours.
    const size = 40;
    const m = triangles(buildWallMesh({ tiles: room(size, 2, 2, 36, 4), size, seed: 7 }));
    const north = m
      .filter((t, i) => i % 2 === 0 && t.n[0][2] === 1)
      .map((t) => ({ x: Math.min(...t.p.map((p) => p[0])), v: variantOf(t) }))
      .sort((a, b) => a.x - b.x);
    expect(north.length).toBe(36);
    for (let i = 1; i < north.length; i++) if (north[i].v !== 0) expect(north[i].v).not.toBe(north[i - 1].v);
  });

  test("deterministic per seed; a different seed reshuffles the variants", () => {
    const again = buildWallMesh({ tiles: floor.tiles, size: floor.size, seed: floor.seed });
    expect(Array.from(again.uvs)).toEqual(Array.from(mesh.uvs));
    const other = buildWallMesh({ tiles: floor.tiles, size: floor.size, seed: floor.seed + 1 });
    expect(Array.from(other.uvs)).not.toEqual(Array.from(mesh.uvs));
  });

  test("variant picks follow the weights", () => {
    expect(pickVariant(0)).toBe(0);
    expect(pickVariant(0.75)).toBe(1);
    expect(pickVariant(0.99)).toBe(2);
    let ones = 0;
    for (let i = 0; i < 4000; i++) if (pickVariant(faceHash(i % 63, Math.floor(i / 63), i % 4, 5)) === 1) ones++;
    expect(ones / 4000).toBeGreaterThan(0.1);
    expect(ones / 4000).toBeLessThan(0.22);
    const [u0, u1] = wallAtlasU(1);
    expect(u0).toBeGreaterThan(1 / 3);
    expect(u1).toBeLessThan(2 / 3);
  });

  test("worldUv: floors and ceilings map at `span` metres per repeat", () => {
    expect(worldUv([1, 2, 3], [0, 1, 0], 4)).toEqual([1 / 4, -3 / 4]);
    expect(worldUv([1, 2, 3], [0, -1, 0], 2)).toEqual([1 / 2, 3 / 2]);
    expect(worldUv([1, 2, 3], [0, 0, 1], 2)).toEqual([1 / 2, 2 / 2]);
    expect(worldUv([1, 2, 3], [1, 0, 0], 2)).toEqual([-3 / 2, 2 / 2]);
  });
});
