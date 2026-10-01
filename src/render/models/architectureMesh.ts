import { TILE, WALL_HEIGHT } from "../../core/config";
import type { Vec3 } from "../../world/types";
import { VARIANT_WEIGHTS, WALL_VARIANTS, wallAtlasU } from "../textures/surfaces";

/** The dungeon's walls as plain vertex buffers, built from the tile grid in
 * one pass. Pure (no three.js), so it's unit-tested like the generator.
 *
 * Only faces that border open floor are emitted (a cube per wall tile would
 * draw every hidden side too), all in one mesh: one material, one draw.
 * Each face is one tile wide and the full wall tall, and shows exactly one
 * wall texture — a column of the biome's variant atlas (see
 * render/textures/surfaces): u across the face, v = height / WALL_HEIGHT.
 * The texture is painted WALL_HEIGHT × 32 px tall for a 2 m (64 px) tile,
 * so texels are square, and the composition reads top to bottom: moss or
 * soot under the vault, grime or a tide line at the foot. Faces of the same
 * variant side by side continue each other (the painters wrap across the
 * tile width).
 *
 * Face orientation: every quad is wound counter-clockwise seen from the
 * side its normal points to. For a vertical face with normal n, "right" is
 * up × n = (n.z, 0, −n.x) and u runs along it, so the texture is never
 * mirrored, whichever way the wall faces. */

export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
}

export interface WallInput {
  tiles: Uint8Array;
  size: number;
  /** Floor seed — which faces get which wall variant. */
  seed: number;
}

const FLOOR_TILE = 1;

/** Accumulates quads. UVs are either given per corner or projected from
 * world position at `span` metres per texture repeat (floors, ceilings). */
export class MeshBuilder {
  private pos: number[] = [];
  private nor: number[] = [];
  private uv: number[] = [];
  private idx: number[] = [];

  constructor(private readonly span = 1) {}

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  /** A planar quad: four corners going round it (either way), facing `n`.
   * The winding is fixed up to agree with `n`, so callers only have to get
   * the normal right. UVs are projected from world position along `n`'s
   * dominant axis unless given (then per corner, in the order passed). */
  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, n: Vec3, uvs?: number[]): void {
    const base = this.vertexCount;
    const flip = facesAway([a, b, c, d], n);
    const order = flip ? [0, 3, 2, 1] : [0, 1, 2, 3];
    const given = [a, b, c, d];
    const corners = order.map((k) => given[k]);
    if (uvs) uvs = order.flatMap((k) => [uvs![k * 2], uvs![k * 2 + 1]]);
    for (let k = 0; k < 4; k++) {
      const p = corners[k];
      this.pos.push(p[0], p[1], p[2]);
      this.nor.push(n[0], n[1], n[2]);
      if (uvs) this.uv.push(uvs[k * 2], uvs[k * 2 + 1]);
      else {
        const [u, v] = worldUv(p, n, this.span);
        this.uv.push(u, v);
      }
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  build(): MeshData {
    return {
      positions: new Float32Array(this.pos),
      normals: new Float32Array(this.nor),
      uvs: new Float32Array(this.uv),
      indices: new Uint32Array(this.idx),
    };
  }
}

/** Does the quad's counter-clockwise front face point away from `n`? */
function facesAway(c: Vec3[], n: Vec3): boolean {
  // Sum of the two triangles' cross products (robust to one degenerate).
  let gx = 0;
  let gy = 0;
  let gz = 0;
  for (const [i, j, k] of [
    [0, 1, 2],
    [0, 2, 3],
  ]) {
    const ux = c[j][0] - c[i][0];
    const uy = c[j][1] - c[i][1];
    const uz = c[j][2] - c[i][2];
    const vx = c[k][0] - c[i][0];
    const vy = c[k][1] - c[i][1];
    const vz = c[k][2] - c[i][2];
    gx += uy * vz - uz * vy;
    gy += uz * vx - ux * vz;
    gz += ux * vy - uy * vx;
  }
  return gx * n[0] + gy * n[1] + gz * n[2] < 0;
}

/** World position → UV at `span` metres per repeat, projected along the
 * normal's dominant axis. */
export function worldUv(p: Vec3, n: Vec3, span: number): [number, number] {
  const ax = Math.abs(n[0]);
  const ay = Math.abs(n[1]);
  const az = Math.abs(n[2]);
  if (ay >= ax && ay >= az) return [p[0] / span, (n[1] > 0 ? -p[2] : p[2]) / span];
  // Vertical: u along right = up × n, v up.
  const sx = ax >= az ? 0 : Math.sign(n[2]);
  const sz = ax >= az ? -Math.sign(n[0]) : 0;
  return [(p[0] * sx + p[2] * sz) / span, p[1] / span];
}

/** Deterministic 0..1 hash of a wall face — cosmetic choices every client
 * must agree on without an rng stream. */
export function faceHash(x: number, y: number, dir: number, seed = 0): number {
  let h =
    Math.imul(x + 0x9e37, 0x85ebca6b) ^ Math.imul(y + 0x7f4a, 0xc2b2ae35) ^ Math.imul(dir + 1, 0x27d4eb2f) ^ seed;
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

/** Which wall variant a 0..1 roll lands on (VARIANT_WEIGHTS). */
export function pickVariant(r: number): number {
  let acc = 0;
  for (let v = 0; v < WALL_VARIANTS; v++) {
    acc += VARIANT_WEIGHTS[v];
    if (r < acc) return v;
  }
  return 0;
}

/** The four horizontal tile steps with their outward normals. */
const SIDES: readonly { dx: number; dy: number; n: Vec3 }[] = [
  { dx: 1, dy: 0, n: [1, 0, 0] },
  { dx: -1, dy: 0, n: [-1, 0, 0] },
  { dx: 0, dy: 1, n: [0, 0, 1] },
  { dx: 0, dy: -1, n: [0, 0, -1] },
];

export function buildWallMesh({ tiles, size, seed }: WallInput): MeshData {
  const b = new MeshBuilder();
  const isFloor = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < size && y < size && tiles[y * size + x] === FLOOR_TILE;
  const H = WALL_HEIGHT;
  const half = TILE / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (isFloor(x, y)) continue;
      for (let dir = 0; dir < 4; dir++) {
        const { dx, dy, n } = SIDES[dir];
        if (!isFloor(x + dx, y + dy)) continue;
        // Face plane: the tile edge between this rock and the floor.
        const cx = (x - size / 2) * TILE + half;
        const cz = (y - size / 2) * TILE + half;
        const ox = cx + n[0] * half;
        const oz = cz + n[2] * half;
        const r: Vec3 = [n[2], 0, -n[0]];
        const at = (s: number, h: number): Vec3 => [ox + r[0] * s, h, oz + r[2] * s];
        // A set-piece (niche, geode, eye) never repeats on the next face
        // along the wall: two identical ones side by side read as a tiled
        // texture, not a place. The neighbour's own roll decides, so every
        // client agrees without tracking the run.
        let v = pickVariant(faceHash(x, y, dir, seed));
        const lx = x - Math.round(r[0]);
        const ly = y - Math.round(r[2]);
        if (v !== 0 && !isFloor(lx, ly) && isFloor(lx + dx, ly + dy) && pickVariant(faceHash(lx, ly, dir, seed)) === v) v = 0;
        const [u0, u1] = wallAtlasU(v);
        b.quad(at(-half, 0), at(half, 0), at(half, H), at(-half, H), n, [u0, 0, u1, 0, u1, 1, u0, 1]);
      }
    }
  }
  return b.build();
}
