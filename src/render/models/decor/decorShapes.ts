import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  IcosahedronGeometry,
  LatheGeometry,
  Matrix4,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
} from "three";
import { ARCHITECTURE, WALL_HEIGHT } from "../../../core/config";
import { Rng, hashSeed } from "../../../core/rng";
import type { BiomeId, DecorKind, DoorwaySpawn, Vec3 } from "../../../world/types";
import { type DecorTile, SHEET_TILES, bannerTile, decorTileUv } from "../../textures/decorAtlas";
import { TRIM_BLOCK_H, TRIM_BLOCK_W, TRIM_TEX, trimBlocks } from "../../textures/surfaces";
import { doorArch } from "../archStoneMesh";

/** The shapes of the set dressing, built from primitives like every model
 * in the game (render/models/modelKit's philosophy), but baked for a whole
 * floor at once: each piece is a template of parts in its own space —
 * floor pieces stand on y = 0, wall pieces have the wall at z = 0 and face
 * +z, hanging pieces hang from the vault at y = 0 — and each part is mapped
 * into one tile of the decor atlas (or one block of the band's dressed
 * stone), so every part of every piece shares one of three materials:
 *
 *  - "solid": the atlas, lit, front faces (bone, iron, wax, clay…);
 *  - "sheet": the atlas, alpha-tested and double-sided (webs, kelp, banners,
 *    water);
 *  - "stone": the band's trim (fallen masonry, the frames of wall niches).
 *
 * Templates also say where their little flames burn (candles, braziers),
 * so the renderer can light them with the shared pixel-flame call. */

export type DecorMat = "solid" | "sheet" | "stone";

export interface DecorPart {
  geo: BufferGeometry;
  mat: DecorMat;
}

export interface DecorFlame {
  pos: Vec3;
  /** Flame height (m). */
  scale: number;
}

export interface DecorTemplate {
  parts: DecorPart[];
  flames: DecorFlame[];
}

type V3 = [number, number, number];

// ── Part helpers ─────────────────────────────────────────────────────────────

const STONE_BLOCKS = trimBlocks();
let stonePick = 0;

/** A block of the band's trim, as a UV rect (v up). */
function stoneUv(): [number, number, number, number] {
  const [bx, by] = STONE_BLOCKS[stonePick++ % STONE_BLOCKS.length];
  return [bx / TRIM_TEX, 1 - (by + TRIM_BLOCK_H) / TRIM_TEX, (bx + TRIM_BLOCK_W) / TRIM_TEX, 1 - by / TRIM_TEX];
}

/** Strip a primitive to position/normal/uv, non-indexed, with its UVs
 * squeezed into a tile and the transform baked in. `flat` re-derives
 * normals per face (crystal, rubble: facets catch the light). */
function prep(geo: BufferGeometry, tile: DecorTile | "stone", p: V3 = [0, 0, 0], r: V3 = [0, 0, 0], s: number | V3 = 1, flat = false): DecorPart {
  let g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  for (const name of Object.keys(g.attributes)) if (!["position", "normal", "uv"].includes(name)) g.deleteAttribute(name);
  const [u0, v0, u1, v1] = tile === "stone" ? stoneUv() : decorTileUv(tile);
  const uv = g.getAttribute("uv") as BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    const u = Math.min(1, Math.max(0, uv.getX(i)));
    const v = Math.min(1, Math.max(0, uv.getY(i)));
    uv.setXY(i, u0 + u * (u1 - u0), v0 + v * (v1 - v0));
  }
  const sc = typeof s === "number" ? new Vector3(s, s, s) : new Vector3(...s);
  g.applyMatrix4(new Matrix4().compose(new Vector3(...p), new Quaternion().setFromEuler(new Euler(...r)), sc));
  if (flat) g.computeVertexNormals();
  g = g as BufferGeometry;
  const mat: DecorMat = tile === "stone" ? "stone" : SHEET_TILES.has(tile) ? "sheet" : "solid";
  return { geo: g, mat };
}

/** Move/turn/scale already-prepared parts as a group. */
function xf(parts: DecorPart[], p: V3 = [0, 0, 0], r: V3 = [0, 0, 0], s: number | V3 = 1): DecorPart[] {
  const sc = typeof s === "number" ? new Vector3(s, s, s) : new Vector3(...s);
  const m = new Matrix4().compose(new Vector3(...p), new Quaternion().setFromEuler(new Euler(...r)), sc);
  for (const part of parts) part.geo.applyMatrix4(m);
  return parts;
}

/** Hash-jittered vertices: hand-hewn stone and lumpy heaps. */
function roughen<T extends BufferGeometry>(geo: T, amount: number, seed: number): T {
  const pos = geo.getAttribute("position");
  const h = (x: number, y: number, z: number) => {
    const v = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + seed * 19.3) * 43758.5453;
    return v - Math.floor(v) - 0.5;
  };
  for (let i = 0; i < pos.count; i++) {
    const x = Math.round(pos.getX(i) * 1000) / 1000;
    const y = Math.round(pos.getY(i) * 1000) / 1000;
    const z = Math.round(pos.getZ(i) * 1000) / 1000;
    pos.setXYZ(i, pos.getX(i) + h(x, y, z) * amount, pos.getY(i) + h(y, z, x) * amount, pos.getZ(i) + h(z, x, y) * amount);
  }
  return geo;
}

const lathe = (profile: [number, number][], segments: number) =>
  new LatheGeometry(
    profile.map(([r, y]) => new Vector2(r, y)),
    segments,
  );

// ── Pieces shared between kinds ──────────────────────────────────────────────

function skull(): DecorPart[] {
  return [
    prep(new IcosahedronGeometry(0.1, 1), "bone", [0, 0.1, 0], [0, 0, 0], [1, 0.9, 1.15]),
    prep(new BoxGeometry(0.11, 0.05, 0.07), "bone", [0, 0.035, 0.08]),
    prep(new BoxGeometry(0.036, 0.032, 0.02), "void", [-0.036, 0.1, 0.106]),
    prep(new BoxGeometry(0.036, 0.032, 0.02), "void", [0.036, 0.1, 0.106]),
    prep(new BoxGeometry(0.016, 0.026, 0.02), "void", [0, 0.066, 0.112]),
  ];
}

/** A long bone lying along x, knuckles at both ends. */
function longBone(len: number): DecorPart[] {
  return [
    prep(new CylinderGeometry(0.02, 0.02, len, 5), "bone", [0, 0.022, 0], [0, 0, Math.PI / 2]),
    prep(new SphereGeometry(0.034, 5, 4), "bone", [len / 2, 0.03, 0]),
    prep(new SphereGeometry(0.034, 5, 4), "bone", [-len / 2, 0.03, 0]),
  ];
}

function candle(x: number, z: number, h: number, r: number, flames: DecorFlame[], base = 0): DecorPart[] {
  flames.push({ pos: [x, base + h + 0.04, z], scale: 0.085 + r });
  return [
    prep(new CylinderGeometry(r * 0.92, r, h, 6), "wax", [x, base + h / 2, z]),
    prep(new BoxGeometry(0.006, 0.022, 0.006), "void", [x, base + h + 0.01, z]),
    prep(new SphereGeometry(r * 0.55, 4, 3), "wax", [x + r * 0.8, base + h * 0.55, z], [0, 0, 0], [0.7, 1.6, 0.7]),
  ];
}

const URN: [number, number][] = [
  [0, 0],
  [0.07, 0],
  [0.12, 0.06],
  [0.14, 0.15],
  [0.11, 0.25],
  [0.06, 0.3],
  [0.06, 0.33],
  [0.085, 0.36],
  [0.07, 0.36],
];

function chainLink(): BufferGeometry {
  return new TorusGeometry(0.04, 0.011, 3, 6);
}

/** Links along a polyline of points (local y of each link along it). */
function chainAlong(points: V3[], tile: DecorTile): DecorPart[] {
  const parts: DecorPart[] = [];
  const step = 0.088;
  let carry = 0;
  let n = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = new Vector3(...points[i]);
    const b = new Vector3(...points[i + 1]);
    const seg = b.clone().sub(a);
    const len = seg.length();
    const dir = seg.clone().normalize();
    const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir);
    for (let t = carry; t < len; t += step) {
      const p = a.clone().addScaledVector(dir, t);
      const twist = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), n++ % 2 ? Math.PI / 2 : 0);
      const e = new Euler().setFromQuaternion(q.clone().multiply(twist));
      parts.push(prep(chainLink(), tile, [p.x, p.y, p.z], [e.x, e.y, e.z], [1, 1.5, 1]));
      carry = t + step - len;
    }
  }
  return parts;
}

// ── Templates ────────────────────────────────────────────────────────────────

type Builder = (rng: Rng, variant: number, biome: BiomeId, flames: DecorFlame[]) => DecorPart[];

const BUILDERS: Record<DecorKind, Builder> = {
  bones(rng, variant) {
    const parts: DecorPart[] = [];
    const skulls = variant === 1 ? 2 : 1;
    for (let i = 0; i < skulls; i++) parts.push(...xf(skull(), [i * 0.2 - 0.05 * skulls, 0, i * -0.12], [0, rng.range(-0.8, 0.8), rng.range(-0.15, 0.15)]));
    const bones = variant === 2 ? 2 : 4;
    for (let i = 0; i < bones; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(0.12, 0.3);
      parts.push(...xf(longBone(rng.range(0.26, 0.42)), [Math.cos(a) * r, i * 0.03, Math.sin(a) * r], [0, rng.range(0, Math.PI), rng.range(-0.12, 0.12)]));
    }
    if (variant === 2) {
      // A ribcage lying on its side along a spine.
      const spine = prep(new CylinderGeometry(0.018, 0.018, 0.42, 5), "bone", [0.05, 0.03, 0.18], [0, 0, Math.PI / 2]);
      parts.push(spine);
      for (let k = 0; k < 5; k++)
        parts.push(prep(new TorusGeometry(0.11, 0.012, 3, 7, Math.PI * 0.9), "bone", [-0.12 + k * 0.08, 0.02, 0.18], [Math.PI / 2, 0, 0.1]));
    }
    return parts;
  },

  candles(rng, variant, _biome, flames) {
    const parts: DecorPart[] = [prep(new CylinderGeometry(0.2, 0.23, 0.014, 10), "wax", [0, 0.007, 0])];
    if (variant === 2) {
      // A candle burning on a skull, two more beside it.
      parts.push(...xf(skull(), [0, 0, 0], [0, rng.range(-0.5, 0.5), 0]));
      parts.push(...candle(0, -0.01, 0.1, 0.028, flames, 0.19));
      parts.push(...candle(0.17, 0.08, 0.16, 0.03, flames));
      parts.push(...candle(-0.15, 0.1, 0.09, 0.026, flames));
      return parts;
    }
    const count = 3 + variant * 2;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + rng.range(-0.3, 0.3);
      const r = i === 0 ? 0 : rng.range(0.07, 0.16);
      parts.push(...candle(Math.cos(a) * r, Math.sin(a) * r, rng.range(0.07, i === 0 ? 0.34 : 0.22), rng.range(0.022, 0.036), flames));
    }
    return parts;
  },

  chain(rng, variant, biome) {
    const tile: DecorTile = biome === "drowned" || biome === "forge" ? "rust" : "iron";
    const parts: DecorPart[] = [];
    if (variant === 2) {
      // A loop sagging between two hooks in the vault.
      const pts: V3[] = [];
      const half = 0.6;
      const sag = 1.9;
      for (let i = 0; i <= 24; i++) {
        const x = -half + (2 * half * i) / 24;
        pts.push([x, -sag * (1 - (x / half) ** 2) - 0.04, 0]);
      }
      parts.push(...chainAlong(pts, tile));
      for (const x of [-half, half]) parts.push(prep(new BoxGeometry(0.12, 0.03, 0.12), tile, [x, -0.015, 0]));
      return parts;
    }
    const len = variant === 0 ? 1.7 + rng.range(-0.2, 0.2) : 2.15;
    parts.push(prep(new BoxGeometry(0.13, 0.03, 0.13), tile, [0, -0.015, 0]));
    parts.push(...chainAlong([[0, -0.04, 0], [0, -len, 0]], tile));
    if (variant === 0) parts.push(prep(new TorusGeometry(0.07, 0.014, 3, 8, Math.PI * 1.35), tile, [0.035, -len - 0.07, 0], [0, 0, Math.PI * 0.9]));
    else parts.push(prep(new TorusGeometry(0.08, 0.016, 3, 10), tile, [0, -len - 0.08, 0], [0, Math.PI / 2, 0]));
    return parts;
  },

  cobweb(_rng, variant) {
    // In the corner's own frame (walls on x = 0 and z = 0, room toward +x
    // +z, vault at y = 0), turned so +z+x faces along the spawn's yaw.
    const L = variant === 0 ? 1.1 : 1.3;
    const drop = variant === 0 ? 1.1 : 1.5;
    const g = new BufferGeometry();
    const e = 0.012;
    g.setAttribute("position", new BufferAttribute(new Float32Array([e, -drop, e, L, -e, e, e, -e, L]), 3));
    g.setAttribute("normal", new BufferAttribute(new Float32Array([0.577, -0.577, 0.577, 0.577, -0.577, 0.577, 0.577, -0.577, 0.577]), 3));
    g.setAttribute("uv", new BufferAttribute(new Float32Array([0, 1, 1, 1, 0, 0]), 2));
    return [prep(g, "web", [0, 0, 0], [0, -Math.PI / 4, 0])];
  },

  banner(rng, variant, biome) {
    const parts: DecorPart[] = [];
    const rodY = 5.56;
    parts.push(prep(new CylinderGeometry(0.024, 0.024, 1.05, 6), "iron", [0, rodY, 0.15], [0, 0, Math.PI / 2]));
    for (const x of [-0.55, 0.55]) parts.push(prep(new SphereGeometry(0.04, 5, 4), "iron", [x, rodY, 0.15]));
    for (const x of [-0.38, 0.38]) parts.push(prep(new BoxGeometry(0.03, 0.03, 0.16), "iron", [x, rodY, 0.075]));
    const len = variant === 0 ? 2.7 : 2.25;
    const cloth = new PlaneGeometry(0.82, len, 2, 10);
    const pos = cloth.getAttribute("position");
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const t = 0.5 - pos.getY(i) / len; // 0 at the top, 1 at the hem
      pos.setZ(i, 0.06 * Math.sin(Math.PI * t) + 0.018 * Math.sin(x * 9 + t * 4));
    }
    cloth.computeVertexNormals();
    const tilt = variant === 1 ? rng.range(-0.07, 0.07) : 0;
    parts.push(prep(cloth, bannerTile(biome), [0, rodY - 0.05 - len / 2, 0.15], [0, 0, tilt]));
    return parts;
  },

  grate(_rng, variant, biome) {
    const tile: DecorTile = biome === "drowned" ? "rust" : "iron";
    const parts: DecorPart[] = [];
    if (variant === 0) {
      parts.push(prep(new PlaneGeometry(1.1, 1.1), "void", [0, 0.004, 0], [-Math.PI / 2, 0, 0]));
      for (const z of [-0.59, 0.59]) parts.push(prep(new BoxGeometry(1.26, 0.035, 0.08), tile, [0, 0.0175, z]));
      for (const x of [-0.59, 0.59]) parts.push(prep(new BoxGeometry(0.08, 0.035, 1.1), tile, [x, 0.0175, 0]));
      for (let i = 0; i < 7; i++) parts.push(prep(new BoxGeometry(0.035, 0.03, 1.1), tile, [-0.45 + i * 0.15, 0.015, 0]));
      parts.push(prep(new BoxGeometry(1.1, 0.025, 0.035), tile, [0, 0.03, 0]));
      return parts;
    }
    parts.push(prep(new CircleGeometry(0.5, 12), "void", [0, 0.004, 0], [-Math.PI / 2, 0, 0]));
    parts.push(prep(new TorusGeometry(0.52, 0.04, 3, 14), tile, [0, 0.012, 0], [Math.PI / 2, 0, 0], [1, 1, 0.5]));
    for (let i = -2; i <= 2; i++) {
      const x = i * 0.18;
      const l = 2 * Math.sqrt(0.5 * 0.5 - x * x);
      parts.push(prep(new BoxGeometry(0.035, 0.03, l), tile, [x, 0.015, 0]));
    }
    return parts;
  },

  rubble(rng, variant) {
    const parts: DecorPart[] = [];
    const chunk = (w: number, h: number, d: number, x: number, z: number) =>
      prep(roughen(new BoxGeometry(w, h, d), 0.025, rng.int(1, 999)), "stone", [x, h * 0.32, z], [rng.range(-0.3, 0.3), rng.range(0, Math.PI), rng.range(-0.3, 0.3)], 1, true);
    if (variant === 2) parts.push(chunk(0.72, 0.3, 0.38, 0, 0));
    const n = variant === 1 ? 6 : 4;
    for (let i = 0; i < n; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(0.08, 0.4);
      const s = variant === 1 ? 0.6 : 1;
      parts.push(chunk(rng.range(0.16, 0.36) * s, rng.range(0.1, 0.24) * s, rng.range(0.14, 0.3) * s, Math.cos(a) * r, Math.sin(a) * r));
    }
    for (let i = 0; i < 4; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(0.2, 0.5);
      parts.push(prep(new IcosahedronGeometry(rng.range(0.04, 0.07), 0), "stone", [Math.cos(a) * r, 0.02, Math.sin(a) * r], [rng.range(0, 3), rng.range(0, 3), 0], 1, true));
    }
    return parts;
  },

  niche(rng, variant, _biome, flames) {
    const parts: DecorPart[] = [
      prep(new BoxGeometry(0.14, 1.5, 0.26), "stone", [-0.45, 1.55, 0.13]),
      prep(new BoxGeometry(0.14, 1.5, 0.26), "stone", [0.45, 1.55, 0.13]),
      prep(new BoxGeometry(1.1, 0.1, 0.32), "stone", [0, 0.8, 0.16]),
      prep(new BoxGeometry(1.1, 0.16, 0.3), "stone", [0, 2.27, 0.15]),
      prep(new PlaneGeometry(0.76, 1.37), "void", [0, 1.535, 0.012]),
    ];
    parts.push(prep(lathe(URN, 8), "clay", [-0.16, 0.85, 0.14], [0, rng.range(0, 6), 0], 1.25));
    if (variant === 0) parts.push(prep(lathe(URN, 8), "clay", [0.18, 0.85, 0.12], [0, rng.range(0, 6), 0], 0.85));
    else {
      parts.push(...xf(skull(), [0.17, 0.85, 0.13], [0, rng.range(-0.4, 0.4), 0]));
      parts.push(...candle(0.04, 0.2, 0.12, 0.025, flames, 0.85));
    }
    return parts;
  },

  barnacles(rng, variant) {
    const parts: DecorPart[] = [];
    const n = 10 + variant * 5;
    const wallZ = -0.45;
    for (let i = 0; i < n; i++) {
      const onWall = i % 3 === 0;
      const r = rng.range(0.035, 0.07);
      const h = rng.range(0.04, 0.09);
      if (onWall) {
        parts.push(prep(new ConeGeometry(r, h, 5), "barnacle", [rng.range(-0.4, 0.4), rng.range(0.05, 0.45), wallZ + h / 2], [Math.PI / 2, 0, 0]));
      } else {
        const a = rng.range(-Math.PI, 0);
        const d = rng.range(0, 0.42);
        parts.push(prep(new ConeGeometry(r, h, 5), "barnacle", [Math.cos(a) * d, h / 2, Math.sin(a) * d * 0.8], [rng.range(-0.2, 0.2), 0, rng.range(-0.2, 0.2)]));
      }
    }
    for (let i = 0; i < 4; i++) parts.push(prep(new SphereGeometry(0.05, 5, 4), "rust", [rng.range(-0.3, 0.3), 0.02, rng.range(-0.35, 0)], [0, 0, 0], [1, 0.5, 1.4]));
    return parts;
  },

  kelp(rng, variant) {
    const parts: DecorPart[] = [];
    const n = 3 + variant;
    for (let i = 0; i < n; i++) {
      const h = rng.range(1.1, 2.2);
      const lean = rng.range(-0.25, 0.25);
      const x = rng.range(-0.2, 0.2);
      const z = rng.range(-0.2, 0.2);
      const yaw = rng.range(0, Math.PI);
      for (const turn of [0, Math.PI / 2]) {
        const g = new PlaneGeometry(0.34, h, 1, 5);
        const pos = g.getAttribute("position");
        for (let k = 0; k < pos.count; k++) {
          const t = pos.getY(k) / h + 0.5;
          pos.setX(k, pos.getX(k) + lean * t * t);
        }
        parts.push(prep(g, "kelp", [x, h / 2, z], [0, yaw + turn, 0]));
      }
    }
    return parts;
  },

  puddle(_rng, variant) {
    const s: V3 = variant === 0 ? [1, 1, 1] : variant === 1 ? [1.35, 1, 0.8] : [0.8, 1, 1.2];
    return [prep(new PlaneGeometry(1.8, 1.8), "water", [0, 0.006, 0], [-Math.PI / 2, 0, variant * 1.3], s)];
  },

  anvil(rng) {
    return [
      prep(new CylinderGeometry(0.24, 0.27, 0.42, 8), "wood", [0, 0.21, 0]),
      prep(new BoxGeometry(0.36, 0.08, 0.26), "iron", [0, 0.46, 0]),
      prep(new BoxGeometry(0.22, 0.1, 0.16), "iron", [0, 0.55, 0]),
      prep(new BoxGeometry(0.5, 0.1, 0.2), "iron", [0, 0.65, 0]),
      prep(new ConeGeometry(0.08, 0.28, 6), "iron", [0.38, 0.66, 0], [0, 0, -Math.PI / 2]),
      prep(new BoxGeometry(0.08, 0.08, 0.16), "iron", [-0.29, 0.66, 0]),
      // A hammer left on the stump.
      prep(new CylinderGeometry(0.016, 0.016, 0.36, 5), "wood", [0.02, 0.44, 0.17], [Math.PI / 2, rng.range(-0.4, 0.4), 0]),
      prep(new BoxGeometry(0.12, 0.06, 0.06), "iron", [0.02, 0.45, 0.33]),
    ];
  },

  slag(rng, variant) {
    const parts: DecorPart[] = [
      prep(roughen(new IcosahedronGeometry(0.42, 1), 0.08, rng.int(1, 999)), "slag", [0, 0.04, 0], [0, rng.range(0, 6), 0], [1, 0.42 + variant * 0.06, 0.85], true),
    ];
    for (let i = 0; i < 3; i++) {
      const a = rng.range(0, Math.PI * 2);
      parts.push(prep(roughen(new IcosahedronGeometry(rng.range(0.07, 0.12), 0), 0.03, i + 7), "slag", [Math.cos(a) * 0.45, 0.04, Math.sin(a) * 0.4], [rng.range(0, 3), rng.range(0, 3), 0], 1, true));
    }
    return parts;
  },

  brazier(_rng, _variant, _biome, flames) {
    const parts: DecorPart[] = [];
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      parts.push(prep(new BoxGeometry(0.035, 0.9, 0.035), "iron", [Math.cos(a) * 0.2, 0.43, Math.sin(a) * 0.2], [Math.sin(a) * -0.18, 0, Math.cos(a) * 0.18]));
    }
    parts.push(prep(new TorusGeometry(0.19, 0.018, 3, 10), "iron", [0, 0.38, 0], [Math.PI / 2, 0, 0]));
    parts.push(
      prep(
        lathe(
          [
            [0.06, 0],
            [0.2, 0.05],
            [0.29, 0.17],
            [0.31, 0.2],
            [0.27, 0.2],
            [0.25, 0.17],
          ],
          10,
        ),
        "iron",
        [0, 0.8, 0],
      ),
    );
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      parts.push(prep(new IcosahedronGeometry(0.075, 0), "coal", [Math.cos(a) * 0.12, 0.93, Math.sin(a) * 0.12], [a, a * 2, 0]));
    }
    parts.push(prep(new IcosahedronGeometry(0.09, 0), "coal", [0, 0.96, 0]));
    flames.push({ pos: [0, 1.02, 0], scale: 0.5 });
    return parts;
  },

  spur(rng, variant) {
    const parts: DecorPart[] = [];
    const n = rng.int(3, 6);
    for (let i = 0; i < n; i++) {
      const tile: DecorTile = variant === 2 ? (i % 2 ? "crystalCyan" : "crystalViolet") : variant === 0 ? "crystalViolet" : "crystalCyan";
      const len = i === 0 ? rng.range(0.6, 0.95) : rng.range(0.25, 0.6);
      const girth = rng.range(0.6, 1.2);
      const yaw = rng.range(0, Math.PI * 2);
      const r = i === 0 ? 0 : rng.range(0.08, 0.28);
      const g = lathe(
        [
          [0, -0.1],
          [0.08, -0.06],
          [0.09, 0.65],
          [0, 0.9],
        ],
        6,
      );
      parts.push(prep(g, tile, [Math.sin(yaw) * r, 0, Math.cos(yaw) * r], [rng.range(0.15, 0.6), yaw, 0], [girth, len, girth], true));
    }
    return parts;
  },

  roots(rng, variant) {
    const parts: DecorPart[] = [prep(new CircleGeometry(0.55, 8), "root", [0, -0.012, 0], [Math.PI / 2, 0, 0])];
    const n = 4 + variant;
    for (let i = 0; i < n; i++) {
      const len = rng.range(0.8, 2.15);
      const x0 = rng.range(-0.4, 0.4);
      const z0 = rng.range(-0.4, 0.4);
      const pts: Vector3[] = [];
      for (let k = 0; k <= 5; k++) {
        const t = k / 5;
        pts.push(new Vector3(x0 + Math.sin(t * 5 + i) * 0.12 * t, -len * t, z0 + Math.cos(t * 4 + i * 2) * 0.1 * t));
      }
      parts.push(prep(new TubeGeometry(new CatmullRomCurve3(pts), 8, rng.range(0.018, 0.04), 4), "root"));
    }
    return parts;
  },

  chime(rng, variant) {
    const ringY = -1.0 - variant * 0.15;
    const parts: DecorPart[] = [
      prep(new BoxGeometry(0.014, -ringY, 0.014), "cord", [0, ringY / 2, 0]),
      prep(new TorusGeometry(0.2, 0.015, 3, 10), "iron", [0, ringY, 0], [Math.PI / 2, 0, 0]),
    ];
    const n = 6;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = Math.cos(a) * 0.2;
      const z = Math.sin(a) * 0.2;
      const cord = rng.range(0.22, 0.55);
      parts.push(prep(new BoxGeometry(0.01, cord, 0.01), "cord", [x, ringY - cord / 2, z]));
      const bone = longBone(rng.range(0.18, 0.28));
      parts.push(...xf(bone, [x, ringY - cord - 0.15, z], [0, a, Math.PI / 2]));
    }
    return parts;
  },
};

/** Where a part's tile bias goes per band: no template paints a band's
 * colour by itself except banners (and rust in the wet and the heat). */
const templates = new Map<string, DecorTemplate>();

/** The template for one shape of one kind, in one band (cached). */
export function decorTemplate(kind: DecorKind, variant: number, biome: BiomeId): DecorTemplate {
  const key = `${kind}:${variant}:${biome}`;
  let t = templates.get(key);
  if (!t) {
    const flames: DecorFlame[] = [];
    stonePick = hashSeed(key) % STONE_BLOCKS.length;
    const parts = BUILDERS[kind](new Rng(hashSeed(`decor:${key}`)), variant, biome, flames);
    t = { parts, flames };
    templates.set(key, t);
  }
  return t;
}

// ── Doorway ironmongery and woodwork ─────────────────────────────────────────

/** A doorway's local space: origin on the wall face at the opening's
 * middle plus `s` along the wall and `dd` into the room; local +z points
 * into the room, +y up, +x = up × z (never a mirror). Also returns which
 * way local +x runs along the wall (±1 in world s). */
function doorBasis(d: DoorwaySpawn, s: number, dd: number): { m: Matrix4; sgn: number } {
  const mid = (d.from + d.to) / 2;
  const across = d.face + d.inward * dd;
  const p = d.axis === "x" ? new Vector3(mid + s, 0, across) : new Vector3(across, 0, mid + s);
  const n = d.axis === "x" ? new Vector3(0, 0, d.inward) : new Vector3(d.inward, 0, 0);
  const x = new Vector3(n.z, 0, -n.x);
  const r = d.axis === "x" ? new Vector3(1, 0, 0) : new Vector3(0, 0, 1);
  const m = new Matrix4().makeBasis(x, new Vector3(0, 1, 0), n).setPosition(p);
  return { m, sgn: Math.sign(x.dot(r)) };
}

/** A raised portcullis: its grid hidden in the header, the spiked foot
 * hanging just under the arch. */
export function portcullisParts(d: DoorwaySpawn, biome: BiomeId): DecorPart[] {
  const tile: DecorTile = biome === "drowned" || biome === "forge" ? "rust" : "iron";
  const half = (d.to - d.from) / 2 - 0.07;
  const { crownY } = doorArch(d.to - d.from);
  const bottom = crownY - 0.55;
  const z = -ARCHITECTURE.headerDepth / 2;
  const parts: DecorPart[] = [];
  const bars = Math.max(3, Math.round((half * 2) / 0.24));
  for (let i = 0; i <= bars; i++) {
    const x = -half + (2 * half * i) / bars;
    const h = WALL_HEIGHT - bottom;
    parts.push(prep(new BoxGeometry(0.05, h, 0.05), tile, [x, bottom + h / 2, z]));
    parts.push(prep(new ConeGeometry(0.035, 0.16, 4), tile, [x, bottom - 0.08, z], [Math.PI, 0, 0]));
  }
  for (let y = bottom + 0.22; y < WALL_HEIGHT; y += 0.45) parts.push(prep(new BoxGeometry(half * 2 + 0.04, 0.05, 0.065), tile, [0, y, z]));
  const { m } = doorBasis(d, 0, 0);
  for (const p of parts) p.geo.applyMatrix4(m);
  return parts;
}

/** One leaf of a broken door, swung back against the wall beside its jamb
 * and hanging from its top hinge, the free corner dragging on the floor. */
export function doorLeafParts(d: DoorwaySpawn): DecorPart[] {
  const L = ARCHITECTURE.doorLeaf;
  const Hh = 2.9;
  const T = 0.08;
  // Built with the hinge edge at x = 0, the leaf running toward +x.
  const leaf: DecorPart[] = [
    prep(new BoxGeometry(L, Hh, T), "wood", [L / 2, Hh / 2, 0]),
    ...[0.45, 1.45, 2.45].map((y) => prep(new BoxGeometry(L - 0.1, 0.09, 0.03), "iron", [L / 2 - 0.02, y, T / 2 + 0.012])),
    prep(new TorusGeometry(0.07, 0.012, 3, 8), "iron", [L - 0.25, 1.3, T / 2 + 0.03]),
  ];
  // Sag on the top hinge: turn about the top hinge corner, then rest the
  // low corner on the floor.
  const droop = 0.1;
  xf(leaf, [0, 0, 0], [0, 0, -droop]);
  const lift = L * Math.sin(droop);
  xf(leaf, [0, lift, 0]);
  // Swung back toward the wall: hinge proud of the jamb, free end near it,
  // running away from the opening.
  const hingeD = ARCHITECTURE.jambDepth + 0.2;
  const freeD = 0.12;
  const back = Math.asin((hingeD - freeD) / L);
  const half = (d.to - d.from) / 2;
  const { m: base, sgn } = doorBasis(d, d.hinge * (half + 0.02), hingeD);
  const turn = d.hinge * sgn > 0 ? back : Math.PI - back;
  const m = base.multiply(new Matrix4().makeRotationY(turn));
  for (const p of leaf) p.geo.applyMatrix4(m);
  return leaf;
}
