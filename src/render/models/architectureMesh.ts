import { ARCHITECTURE, TILE, WALL_HEIGHT } from "../../core/config";
import type { FloorArchitecture, RibSpawn, Vec3 } from "../../world/types";

/** The dungeon's stonework as plain vertex buffers: wall faces, the base
 * course, arch ribs on their piers, and pillars — built from the tile grid
 * in one pass, with UVs taken from WORLD position (ARCHITECTURE.texMetres
 * per repeat). Pure (no three.js), so it's unit-tested like the generator.
 *
 * Why not instanced cubes any more: a cube's UVs are per cube, so a 7 m wall
 * either stretched its texture 3.5× or repeated it with a seam at every
 * tile. World-mapped faces tile per 4 m in BOTH directions, courses flow
 * unbroken along a wall, and only faces that border open floor are emitted
 * (the old cubes drew every hidden side too). Still one draw call.
 *
 * Face orientation: every quad is wound counter-clockwise seen from the
 * side its normal points to. For a vertical face with normal n, "right" is
 * up × n = (n.z, 0, −n.x) and u runs along it; v is world height — so the
 * texture's row 0 is always at the top, whichever way the wall faces. */

export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
}

export interface ArchitectureMeshes {
  /** Walls, base course, piers, ribs, pillars: one material, one draw. */
  stone: MeshData;
  /** Glowing seams where wall meets floor (the Ember Forge): emissive. */
  seams: MeshData;
  /** The seams' heat spilling onto the floor: additive quads whose UVs
   * describe the glow (see DungeonStone's seam glow shader). */
  seamGlow: MeshData;
}

export interface ArchitectureInput {
  tiles: Uint8Array;
  size: number;
  architecture: FloorArchitecture;
}

export interface ArchitectureOptions {
  /** Share of wall faces (0..1) whose foot glows (forge heat seams). */
  seamChance?: number;
}

const T = ARCHITECTURE.texMetres;
const FLOOR_TILE = 1;

/** Accumulates quads with world-mapped UVs. */
export class MeshBuilder {
  private pos: number[] = [];
  private nor: number[] = [];
  private uv: number[] = [];
  private idx: number[] = [];

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
        const [u, v] = worldUv(p, n);
        this.uv.push(u, v);
      }
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** A quad with its own per-corner normals (curved surfaces); winding is
   * fixed up against their average, like `quad`. */
  quadSmooth(corners: Vec3[], normals: Vec3[], uvs: number[]): void {
    const base = this.vertexCount;
    const avg: Vec3 = [0, 0, 0];
    for (const n of normals) for (let a = 0; a < 3; a++) avg[a] += n[a];
    const order = facesAway(corners, avg) ? [0, 3, 2, 1] : [0, 1, 2, 3];
    for (const k of order) {
      this.pos.push(...corners[k]);
      this.nor.push(...normals[k]);
      this.uv.push(uvs[k * 2], uvs[k * 2 + 1]);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** An axis-aligned vertical face: normal `n` (horizontal unit axis), the
   * face plane through `origin`, spanning [s0, s1] along "right" and
   * [y0, y1] in height. */
  wall(origin: Vec3, n: Vec3, s0: number, s1: number, y0: number, y1: number): void {
    const r: Vec3 = [n[2], 0, -n[0]];
    const at = (s: number, y: number): Vec3 => [origin[0] + r[0] * s, y, origin[2] + r[2] * s];
    this.quad(at(s0, y0), at(s1, y0), at(s1, y1), at(s0, y1), n);
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

/** World position → UV, projected along the normal's dominant axis. */
export function worldUv(p: Vec3, n: Vec3): [number, number] {
  const ax = Math.abs(n[0]);
  const ay = Math.abs(n[1]);
  const az = Math.abs(n[2]);
  if (ay >= ax && ay >= az) return [p[0] / T, (n[1] > 0 ? -p[2] : p[2]) / T];
  // Vertical: u along right = up × n, v up.
  const sx = ax >= az ? 0 : Math.sign(n[2]);
  const sz = ax >= az ? -Math.sign(n[0]) : 0;
  return [(p[0] * sx + p[2] * sz) / T, p[1] / T];
}

/** Deterministic 0..1 hash of a wall face — cosmetic choices (which feet
 * glow) that every client must agree on without an rng stream. */
export function faceHash(x: number, y: number, dir: number): number {
  let h = Math.imul(x + 0x9e37, 0x85ebca6b) ^ Math.imul(y + 0x7f4a, 0xc2b2ae35) ^ Math.imul(dir + 1, 0x27d4eb2f);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

/** The four horizontal tile steps with their outward normals. */
const SIDES: readonly { dx: number; dy: number; n: Vec3 }[] = [
  { dx: 1, dy: 0, n: [1, 0, 0] },
  { dx: -1, dy: 0, n: [-1, 0, 0] },
  { dx: 0, dy: 1, n: [0, 0, 1] },
  { dx: 0, dy: -1, n: [0, 0, -1] },
];

export function buildArchitectureMeshes(input: ArchitectureInput, opts: ArchitectureOptions = {}): ArchitectureMeshes {
  const { tiles, size, architecture } = input;
  const stone = new MeshBuilder();
  const seams = new MeshBuilder();
  const glow = new MeshBuilder();
  const isFloor = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < size && y < size && tiles[y * size + x] === FLOOR_TILE;
  const H = WALL_HEIGHT;
  const PH = ARCHITECTURE.plinthHeight;
  const PD = ARCHITECTURE.plinthDepth;
  const half = TILE / 2;
  const seamChance = opts.seamChance ?? 0;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (isFloor(x, y)) continue;
      for (let dir = 0; dir < 4; dir++) {
        const { dx, dy, n } = SIDES[dir];
        if (!isFloor(x + dx, y + dy)) continue;
        // Face plane: the tile edge between this rock and the floor.
        const cx = (x - size / 2) * TILE + half;
        const cz = (y - size / 2) * TILE + half;
        const origin: Vec3 = [cx + n[0] * half, 0, cz + n[2] * half];
        stone.wall(origin, n, -half, half, PH, H);

        // Base course ends: extended round convex corners, pulled back at
        // concave ones — see plinthEnd.
        const r: Vec3 = [n[2], 0, -n[0]];
        const rdx = Math.round(r[0]);
        const rdy = Math.round(r[2]);
        const endHi = plinthEnd(isFloor, x, y, dx, dy, rdx, rdy, n);
        const endLo = plinthEnd(isFloor, x, y, dx, dy, -rdx, -rdy, n);
        const s0 = -half - endLo.grow;
        const s1 = half + endHi.grow;
        const front: Vec3 = [origin[0] + n[0] * PD, 0, origin[2] + n[2] * PD];
        stone.wall(front, n, s0, s1, 0, PH);
        // Top of the course, from the wall face out to its front edge.
        const at = (o: Vec3, s: number): Vec3 => [o[0] + r[0] * s, PH, o[2] + r[2] * s];
        stone.quad(at(front, s0), at(front, s1), at(origin, s1), at(origin, s0), [0, 1, 0]);
        // Exposed end caps round a convex corner.
        for (const [end, s, sign] of [
          [endHi, s1, 1],
          [endLo, s0, -1],
        ] as const) {
          if (!end.cap) continue;
          const capN: Vec3 = [r[0] * sign, 0, r[2] * sign];
          const capOrigin: Vec3 = [origin[0] + r[0] * s, 0, origin[2] + r[2] * s];
          // Along the cap's own "right", the course runs from the wall face
          // (0) out to its front (PD) — which way round depends on the side.
          const capR: Vec3 = [capN[2], 0, -capN[0]];
          const dot = capR[0] * n[0] + capR[2] * n[2];
          stone.wall(capOrigin, capN, Math.min(0, dot * PD), Math.max(0, dot * PD), 0, PH);
        }

        if (seamChance > 0 && faceHash(x, y, dir) < seamChance) addSeam(seams, glow, front, n, s0, s1);
      }
    }
  }

  for (const rib of architecture.ribs) addRib(stone, rib);
  for (const p of architecture.pillars) addPillar(stone, p.pos);

  return { stone: stone.build(), seams: seams.build(), seamGlow: glow.build() };
}

/** A heat seam at the foot of one wall face: a glowing crack along the
 * middle of the course (a crack, not a strip) and a quad on the floor in
 * front of it whose UVs (u along the crack 0..1, v out from the wall 0..1)
 * let the glow shader draw a soft half-ellipse of heat bleeding out. */
function addSeam(seams: MeshBuilder, glow: MeshBuilder, front: Vec3, n: Vec3, s0: number, s1: number): void {
  const r: Vec3 = [n[2], 0, -n[0]];
  const a = s0 + (s1 - s0) * 0.18;
  const b = s1 - (s1 - s0) * 0.18;
  const lip: Vec3 = [front[0] + n[0] * 0.006, 0, front[2] + n[2] * 0.006];
  seams.wall(lip, n, a, b, 0, 0.06);
  const at = (s: number, out: number): Vec3 => [front[0] + r[0] * s + n[0] * out, 0.012, front[2] + r[2] * s + n[2] * out];
  const reach = 0.9;
  glow.quad(at(s0, reach), at(s1, reach), at(s1, 0), at(s0, 0), [0, 1, 0], [0, 1, 1, 1, 1, 0, 0, 0]);
}

/** How one end of a base-course strip meets its neighbour. The strip runs
 * along the face of rock tile (x, y) whose floor side is (dx, dy); (ex, ey)
 * is the end being decided.
 *  - Rock beyond the floor tile's side (a concave corner, or a pinch):
 *    the course along the other wall runs through, so x-facing strips stop
 *    short by the course depth; z-facing ones run to the corner.
 *  - Open floor beside the rock too (a convex corner): z-facing strips
 *    grow round the corner by the course depth and cap their end; x-facing
 *    strips stop flush (the z strip covers the corner).
 *  - Otherwise the wall runs straight on: no change. */
function plinthEnd(
  isFloor: (x: number, y: number) => boolean,
  x: number,
  y: number,
  dx: number,
  dy: number,
  ex: number,
  ey: number,
  n: Vec3,
): { grow: number; cap: boolean } {
  const PD = ARCHITECTURE.plinthDepth;
  const alongX = Math.abs(n[0]) > 0.5;
  const besideFloor = isFloor(x + dx + ex, y + dy + ey);
  if (!besideFloor) return { grow: alongX ? -PD : 0, cap: false };
  const besideOpen = isFloor(x + ex, y + ey);
  if (besideOpen) return alongX ? { grow: 0, cap: false } : { grow: PD, cap: true };
  return { grow: 0, cap: false };
}

// ── Ribs ─────────────────────────────────────────────────────────────────────

/** Rib shape for a span: where it springs, where its underside peaks. The
 * rise grows with the span (a wide hall gets a proper arch, a narrow one a
 * shallow segment) but always leaves the underside well above head height. */
export function ribProfile(span: number): { springY: number; crownY: number; rise: number } {
  const crownY = WALL_HEIGHT - ARCHITECTURE.ribDepth;
  const rise = Math.min(2.8, Math.max(1.2, span * 0.25));
  return { springY: crownY - rise, crownY, rise };
}

const RIB_SEGMENTS = 10;

function addRib(b: MeshBuilder, rib: RibSpawn): void {
  const span = rib.to - rib.from;
  const mid = (rib.from + rib.to) / 2;
  const halfSpan = span / 2;
  const { springY, crownY, rise } = ribProfile(span);
  // Circular segment through both springings and the crown.
  const R = (halfSpan * halfSpan + rise * rise) / (2 * rise);
  const cy = crownY - R;
  const W = ARCHITECTURE.ribWidth / 2;
  const H = WALL_HEIGHT;
  // (s along the span, o across it) → world.
  const P = (s: number, y: number, o: number): Vec3 => (rib.axis === "x" ? [s, y, rib.at + o] : [rib.at + o, y, s]);
  const under = (s: number) => cy + Math.sqrt(Math.max(0, R * R - (s - mid) ** 2));
  const underN = (s: number): Vec3 => {
    const ns = -(s - mid) / R;
    const ny = -(under(s) - cy) / R;
    return rib.axis === "x" ? [ns, ny, 0] : [0, ny, ns];
  };
  // Across-axis unit normal for the two flanks.
  const flank = (sign: number): Vec3 => (rib.axis === "x" ? [0, 0, sign] : [sign, 0, 0]);

  for (let i = 0; i < RIB_SEGMENTS; i++) {
    const s0 = rib.from + (span * i) / RIB_SEGMENTS;
    const s1 = rib.from + (span * (i + 1)) / RIB_SEGMENTS;
    const y0 = under(s0);
    const y1 = under(s1);
    // Underside, facing down and in: u along the span, v across.
    const us0 = s0 / T;
    const us1 = s1 / T;
    const vo0 = (rib.at - W) / T;
    const vo1 = (rib.at + W) / T;
    b.quadSmooth(
      [P(s0, y0, -W), P(s0, y0, W), P(s1, y1, W), P(s1, y1, -W)],
      [underN(s0), underN(s0), underN(s1), underN(s1)],
      [us0, vo0, us0, vo1, us1, vo1, us1, vo0],
    );
    // The two flanks: from the underside up to the ceiling.
    for (const sign of [-1, 1]) {
      const n = flank(sign);
      const a = P(s0, y0, sign * W);
      const c = P(s1, y1, sign * W);
      b.quad(a, c, P(s1, H, sign * W), P(s0, H, sign * W), n);
    }
  }

  // Piers under both ends, each with a capital the rib springs from.
  for (const [face, inward] of [
    [rib.from, 1],
    [rib.to, -1],
  ] as const) {
    const n: Vec3 = rib.axis === "x" ? [inward, 0, 0] : [0, 0, inward];
    const wallAt = P(face, 0, 0);
    addPier(b, wallAt, n, ARCHITECTURE.pierWidth / 2, ARCHITECTURE.pierDepth, 0, springY - 0.28);
    addPier(b, wallAt, n, ARCHITECTURE.pierWidth / 2 + 0.1, ARCHITECTURE.pierDepth + 0.1, springY - 0.28, springY);
  }
}

/** A box standing proud of a wall: front and both sides (its back is in the
 * rock; top and bottom are never seen from the floor). `wallAt` is on the
 * wall face at the pier's centre line. */
function addPier(b: MeshBuilder, wallAt: Vec3, n: Vec3, halfW: number, depth: number, y0: number, y1: number): void {
  const front: Vec3 = [wallAt[0] + n[0] * depth, 0, wallAt[2] + n[2] * depth];
  b.wall(front, n, -halfW, halfW, y0, y1);
  const r: Vec3 = [n[2], 0, -n[0]];
  for (const sign of [-1, 1]) {
    const sn: Vec3 = [r[0] * sign, 0, r[2] * sign];
    const o: Vec3 = [wallAt[0] + r[0] * sign * halfW, 0, wallAt[2] + r[2] * sign * halfW];
    const sr: Vec3 = [sn[2], 0, -sn[0]];
    const d = sr[0] * n[0] + sr[2] * n[2];
    b.wall(o, sn, Math.min(0, d * depth), Math.max(0, d * depth), y0, y1);
  }
  // The underside of a capital overhangs the pier below it — visible.
  if (y0 > 0) {
    const r0: Vec3 = [wallAt[0] - r[0] * halfW, y0, wallAt[2] - r[2] * halfW];
    const r1: Vec3 = [wallAt[0] + r[0] * halfW, y0, wallAt[2] + r[2] * halfW];
    const f0: Vec3 = [r0[0] + n[0] * depth, y0, r0[2] + n[2] * depth];
    const f1: Vec3 = [r1[0] + n[0] * depth, y0, r1[2] + n[2] * depth];
    addHorizontal(b, [r0, r1, f1, f0], -1);
  }
}

/** A horizontal quad facing up (+1) or down (−1). */
function addHorizontal(b: MeshBuilder, c: Vec3[], facing: 1 | -1): void {
  b.quad(c[0], c[1], c[2], c[3], [0, facing, 0]);
}

// ── Pillars ──────────────────────────────────────────────────────────────────

const PILLAR_SIDES = 8;
const BASE_HEIGHT = 0.5;
const CAPITAL_HEIGHT = 0.4;

function addPillar(b: MeshBuilder, foot: Vec3): void {
  const [px, , pz] = foot;
  const H = WALL_HEIGHT;
  const B = ARCHITECTURE.pillarBase;
  const R = ARCHITECTURE.pillarRadius;
  // Square base block and capital: four faces each, plus the base's top
  // and the capital's underside (the two you can see).
  for (const [half, y0, y1] of [
    [B, 0, BASE_HEIGHT],
    [B * 0.96, H - CAPITAL_HEIGHT, H],
  ] as const) {
    for (const { n } of SIDES) {
      const origin: Vec3 = [px + n[0] * half, 0, pz + n[2] * half];
      b.wall(origin, n, -half, half, y0, y1);
    }
    const y = y0 === 0 ? y1 : y0;
    addHorizontal(
      b,
      [
        [px - half, y, pz - half],
        [px + half, y, pz - half],
        [px + half, y, pz + half],
        [px - half, y, pz + half],
      ],
      y0 === 0 ? 1 : -1,
    );
  }
  // Octagonal shaft, smooth-shaded, u = arc length so texels stay square.
  const y0 = BASE_HEIGHT;
  const y1 = H - CAPITAL_HEIGHT;
  const circ = 2 * Math.PI * R;
  for (let k = 0; k < PILLAR_SIDES; k++) {
    // Angles run from +x toward −z (clockwise seen from above), so going
    // from c1 to c0 is the outward face's "right".
    const a0 = (-(k + 1) / PILLAR_SIDES) * Math.PI * 2;
    const a1 = (-k / PILLAR_SIDES) * Math.PI * 2;
    const c0: Vec3 = [px + Math.cos(a0) * R, 0, pz + Math.sin(a0) * R];
    const c1: Vec3 = [px + Math.cos(a1) * R, 0, pz + Math.sin(a1) * R];
    const n0: Vec3 = [Math.cos(a0), 0, Math.sin(a0)];
    const n1: Vec3 = [Math.cos(a1), 0, Math.sin(a1)];
    // u grows along the face's "right" (from c1 round to c0).
    const u1 = (circ * k) / PILLAR_SIDES / T;
    const u0 = (circ * (k + 1)) / PILLAR_SIDES / T;
    b.quadSmooth(
      [
        [c1[0], y0, c1[2]],
        [c0[0], y0, c0[2]],
        [c0[0], y1, c0[2]],
        [c1[0], y1, c1[2]],
      ],
      [n1, n0, n0, n1],
      [u1, y0 / T, u0, y0 / T, u0, y1 / T, u1, y1 / T],
    );
  }
}
