import { useFrame } from "@react-three/fiber";
import { CuboidCollider, CylinderCollider, RigidBody } from "@react-three/rapier";
import { useEffect, useMemo, useRef } from "react";
import {
  BoxGeometry,
  type BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  DoubleSide,
  Float32BufferAttribute,
  IcosahedronGeometry,
  Matrix4,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { Rng } from "../../core/rng";
import { addFlame, removeFlame } from "../../fx/Flames";
import { addLightSource, removeLightSource, type DynamicLightSource } from "../../fx/DynamicLights";
import { getModelTextures } from "../../render/models/modelPaint";
import { getVillageTextures } from "../../render/textures/villagePainters";
import type { Vec3 } from "../../world/types";
import {
  BANNERS,
  CAMPFIRE,
  PALISADE,
  PLAZA_R,
  STONE_RING,
  STRUCTURES,
  WORKTABLE,
  WORLD_GROUPS,
  type Structure,
} from "./layout";

/** Riftwatch: the expedition's camp round the rift. Canvas tents with
 * lamplight in their doorways, the command pavilion with the survey maps
 * spread under a lamp, a watchtower over the forest edge, a covered wagon,
 * the fire everyone sits round, the diggers' worktable and their spoil
 * heaps between the old standing stones, survey stakes strung round the
 * uncovered paving, banners with the expedition's eye, and a palisade of
 * sharpened logs round the camp's south half.
 *
 * Static, so every part is baked into world space and merged per material:
 * the whole camp is a handful of draw calls. */

// ── Geometry helpers ────────────────────────────────────────────────────────

const UP = new Vector3(0, 1, 0);
const tmpQ = new Quaternion();
const tmpV = new Vector3();

/** A round beam from a to b (rope, pole, brace). */
function beam(a: Vec3, b: Vec3, r: number, sides = 5): BufferGeometry {
  const va = new Vector3(...a);
  const vb = new Vector3(...b);
  const len = va.distanceTo(vb);
  const g = new CylinderGeometry(r, r, len, sides, 1);
  tmpQ.setFromUnitVectors(UP, tmpV.subVectors(vb, va).normalize());
  return g.applyQuaternion(tmpQ).translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
}

const box = (w: number, h: number, d: number, x: number, y: number, z: number) => new BoxGeometry(w, h, d).translate(x, y, z);

function placeAt(s: { pos: Vec3; rot: number }): Matrix4 {
  return new Matrix4().compose(new Vector3(...s.pos), tmpQ.setFromAxisAngle(UP, s.rot).clone(), new Vector3(1, 1, 1));
}

/** Parts per material, collected in world space, merged at the end. */
type Bin = Record<string, BufferGeometry[]>;
function put(bin: Bin, mat: string, g: BufferGeometry, m?: Matrix4) {
  if (m) g.applyMatrix4(m);
  (bin[mat] ??= []).push(g.index ? g.toNonIndexed() : g);
}

// ── The structures ──────────────────────────────────────────────────────────

/** A ridge tent: a canvas prism, a lamplit doorway in its front, poles at
 * each end and guy ropes to pegs. */
function tent(bin: Bin, s: Structure, rng: Rng) {
  const m = placeAt(s);
  const { w, d, h } = s;
  // Prism along z, apex up, base on the ground.
  const prism = new CylinderGeometry(1, 1, 1, 3, 1).rotateX(-Math.PI / 2).translate(0, 0.5, 0);
  prism.scale(w / Math.sqrt(3), h / 1.5, d);
  put(bin, "canvas", prism, m);
  const door = new Shape();
  door.moveTo(-w * 0.26, 0);
  door.lineTo(w * 0.26, 0);
  door.lineTo(0, h * 0.72);
  door.closePath();
  put(bin, "doorway", new ShapeGeometry(door).translate(0, 0, d / 2 + 0.02), m);
  for (const z of [-1, 1]) {
    const end = z * (d / 2 + 0.04);
    put(bin, "wood", beam([0, 0, end], [0, h + 0.18, end], 0.035), m);
    // Guy rope from the pole's top to a peg out front / behind.
    const peg = z * (d / 2 + 0.95 + rng.next() * 0.2);
    put(bin, "rope", beam([0, h + 0.12, end], [0, 0.05, peg], 0.012, 3), m);
    put(bin, "wood", box(0.05, 0.16, 0.05, 0, 0.05, peg), m);
    // And from the eaves to pegs at the sides.
    for (const x of [-1, 1]) {
      const ex = x * w * 0.24;
      const px = x * (w / 2 + 0.55);
      put(bin, "rope", beam([ex, h * 0.52, end * 0.6], [px, 0.04, end * 0.75], 0.01, 3), m);
      put(bin, "wood", box(0.05, 0.14, 0.05, px, 0.04, end * 0.75), m);
    }
  }
}

/** The command pavilion: four posts, a peaked canvas roof, the survey maps
 * on a trestle under a hanging lamp, a pennant on the king pole. */
function pavilion(bin: Bin, s: Structure) {
  const m = placeAt(s);
  const hw = s.w / 2 - 0.15;
  const hd = s.d / 2 - 0.15;
  const eave = 2.5;
  for (const [x, z] of [[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd]] as const) {
    put(bin, "wood", beam([x, 0, z], [x, eave, z], 0.07, 6), m);
  }
  put(bin, "canvas", new ConeGeometry(s.w * 0.76, 1.4, 4, 1, true).rotateY(Math.PI / 4).translate(0, eave + 0.7, 0), m);
  // A valance hanging round the eaves.
  for (const [w, d, x, z] of [[s.w, 0.04, 0, hd + 0.1], [s.w, 0.04, 0, -hd - 0.1], [0.04, s.d, hw + 0.1, 0], [0.04, s.d, -hw - 0.1, 0]] as const) {
    put(bin, "canvas", box(w, 0.32, d, x, eave - 0.1, z), m);
  }
  put(bin, "wood", beam([0, eave, 0], [0, eave + 2.1, 0], 0.045), m);
  // The trestle and its maps.
  put(bin, "wood", box(1.8, 0.07, 1.0, 0, 0.86, 0), m);
  for (const x of [-0.75, 0.75]) put(bin, "wood", box(0.07, 0.84, 0.9, x, 0.42, 0), m);
  put(bin, "parchment", new PlaneGeometry(0.7, 0.5).rotateX(-Math.PI / 2).rotateY(0.15).translate(-0.3, 0.905, 0.05), m);
  put(bin, "parchment", new PlaneGeometry(0.55, 0.42).rotateX(-Math.PI / 2).rotateY(-0.3).translate(0.4, 0.91, -0.12), m);
  put(bin, "lamp", box(0.18, 0.24, 0.18, 0, 2.1, 0), m);
  put(bin, "rope", beam([0, 2.22, 0], [0, eave + 0.4, 0], 0.01, 3), m);
}

/** The watchtower: four raking legs braced with X's, a railed platform at
 * four metres under a little canvas roof, a ladder up the front. */
function tower(bin: Bin, s: Structure) {
  const m = placeAt(s);
  const base = 1.05;
  const top = 0.85;
  const deck = 4.0;
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const;
  for (const [x, z] of corners) put(bin, "wood", beam([x * base, 0, z * base], [x * top, deck + 1.0, z * top], 0.085, 6), m);
  for (let i = 0; i < 4; i++) {
    const [ax, az] = corners[i]!;
    const [bx, bz] = corners[(i + 1) % 4]!;
    const at = (x: number, z: number, y: number) => {
      const k = y / (deck + 1.0);
      const r = base + (top - base) * k;
      return [x * r, y, z * r] as Vec3;
    };
    put(bin, "wood", beam(at(ax, az, 0.5), at(bx, bz, 3.5), 0.045), m);
    put(bin, "wood", beam(at(bx, bz, 0.5), at(ax, az, 3.5), 0.045), m);
    put(bin, "wood", beam(at(ax, az, deck + 0.9), at(bx, bz, deck + 0.9), 0.04), m);
  }
  put(bin, "planks", box(2.3, 0.14, 2.3, 0, deck, 0), m);
  for (const [x, z] of corners) put(bin, "wood", beam([x * top, deck + 1.0, z * top], [x * top, deck + 1.65, z * top], 0.04), m);
  put(bin, "canvas", new ConeGeometry(1.75, 0.9, 4, 1, true).rotateY(Math.PI / 4).translate(0, deck + 2.1, 0), m);
  // The ladder, leaning against the front.
  for (const x of [-0.26, 0.26]) put(bin, "wood", beam([x, 0, 1.75], [x, deck + 0.1, 1.2], 0.03), m);
  for (let y = 0.35; y < deck; y += 0.38) {
    const z = 1.75 - (y / deck) * 0.55;
    put(bin, "wood", box(0.52, 0.03, 0.04, 0, y, z), m);
  }
  put(bin, "lamp", box(0.2, 0.26, 0.2, 0.7, deck + 0.95, 0.7), m);
}

/** A covered wagon, unhitched, its tongue resting on the grass. */
function wagon(bin: Bin, s: Structure) {
  const m = placeAt(s);
  put(bin, "planks", box(1.4, 0.12, 2.8, 0, 0.78, 0), m);
  for (const x of [-0.68, 0.68]) put(bin, "planks", box(0.06, 0.34, 2.8, x, 1.0, 0), m);
  for (const z of [-1.37, 1.37]) put(bin, "planks", box(1.4, 0.34, 0.06, 0, 1.0, z), m);
  for (const x of [-0.78, 0.78])
    for (const z of [-0.95, 0.95]) put(bin, "wood", new CylinderGeometry(0.42, 0.42, 0.07, 10).rotateZ(Math.PI / 2).translate(x, 0.42, z), m);
  for (const z of [-0.95, 0.95]) put(bin, "iron", beam([-0.8, 0.42, z], [0.8, 0.42, z], 0.03), m);
  put(bin, "canvas", new CylinderGeometry(0.74, 0.74, 2.3, 10, 1, true, Math.PI / 2, Math.PI).rotateX(Math.PI / 2).translate(0, 1.15, -0.15), m);
  put(bin, "wood", beam([0, 0.6, 1.4], [0, 0.08, 3.0], 0.04), m);
}

// ── The rest of the camp ────────────────────────────────────────────────────

/** The fire: a ring of stones, logs stacked in a cone, and four seat-logs. */
function campfire(bin: Bin, rng: Rng) {
  const m = placeAt({ pos: CAMPFIRE, rot: 0.3 });
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const s = 0.14 + rng.next() * 0.06;
    put(bin, "stone", new DodecahedronGeometry(s).scale(1, 0.7, 1).translate(Math.cos(a) * 0.58, s * 0.4, Math.sin(a) * 0.58), m);
  }
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    put(bin, "charred", beam([Math.cos(a) * 0.42, 0.03, Math.sin(a) * 0.42], [Math.cos(a) * 0.05, 0.55, Math.sin(a) * 0.05], 0.05), m);
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    const c = [Math.cos(a) * 1.75, 0.2, Math.sin(a) * 1.75] as const;
    const t = [-Math.sin(a) * 0.7, 0, Math.cos(a) * 0.7] as const;
    put(bin, "bark", beam([c[0] - t[0], c[1], c[2] - t[2]], [c[0] + t[0], c[1], c[2] + t[2]], 0.19, 7), m);
  }
}

/** The diggers' worktable: finds laid out by a lamp, a shovel leaning on
 * it, a pick on the ground, a wheelbarrow by the nearest spoil heap. */
function worktable(bin: Bin) {
  const m = placeAt(WORKTABLE);
  put(bin, "wood", box(1.6, 0.07, 0.8, 0, 0.84, 0), m);
  for (const x of [-0.7, 0.7]) for (const z of [-0.32, 0.32]) put(bin, "wood", box(0.07, 0.82, 0.07, x, 0.41, z), m);
  put(bin, "parchment", new PlaneGeometry(0.55, 0.4).rotateX(-Math.PI / 2).rotateY(0.2).translate(-0.35, 0.882, 0), m);
  put(bin, "stone", new DodecahedronGeometry(0.1).scale(1, 0.6, 1.3).translate(0.25, 0.92, 0.1), m);
  put(bin, "stone", new DodecahedronGeometry(0.07).translate(0.48, 0.91, -0.15), m);
  put(bin, "parchment", new CylinderGeometry(0.035, 0.035, 0.42, 6).rotateZ(Math.PI / 2).translate(0.05, 0.91, -0.25), m);
  put(bin, "lamp", box(0.14, 0.2, 0.14, 0.62, 0.98, 0.22), m);
  put(bin, "wood", beam([0.85, 0, 0.55], [0.95, 1.15, 0.2], 0.022), m);
  put(bin, "iron", box(0.2, 0.26, 0.03, 0.85, 0.12, 0.56), m);
  put(bin, "wood", beam([-1.2, 0.04, 0.7], [-0.4, 0.04, 1.1], 0.025), m);
  put(bin, "iron", box(0.5, 0.05, 0.06, -1.22, 0.05, 0.68), m);
}

/** Spoil heaps between the standing stones, where the paving was dug out. */
const HEAPS: [number, number, number][] = [
  [0.9, 1.5, 1.0],
  [2.3, 1.2, 0.8],
  [4.0, 1.7, 1.1],
  [5.3, 1.3, 0.9],
];

function dig(bin: Bin, rng: Rng) {
  for (const [a, w, d] of HEAPS) {
    const r = STONE_RING + 1.4;
    const g = new IcosahedronGeometry(1, 1).scale(w, 0.42 + rng.next() * 0.2, d);
    put(bin, "earth", g.rotateY(a).translate(Math.cos(a) * r, -0.05, Math.sin(a) * r));
  }
  // A wheelbarrow by the first heap.
  const [a0] = HEAPS[0]!;
  const wb = placeAt({ pos: [Math.cos(a0) * (STONE_RING - 0.4), 0, Math.sin(a0) * (STONE_RING - 0.4)], rot: a0 + 1.2 });
  put(bin, "planks", box(0.6, 0.25, 0.8, 0, 0.45, 0), wb);
  put(bin, "wood", new CylinderGeometry(0.17, 0.17, 0.06, 8).rotateZ(Math.PI / 2).translate(0, 0.17, 0.55), wb);
  for (const x of [-0.22, 0.22]) put(bin, "wood", beam([x, 0.35, 0.4], [x * 1.3, 0.5, -0.9], 0.025), wb);
  // Survey stakes strung round the paving, a flag on every other one.
  const stakes: Vec3[] = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    if (Math.abs(a - Math.PI / 2) < 0.42) continue; // the lane
    stakes.push([Math.cos(a) * (PLAZA_R + 0.45), 0, Math.sin(a) * (PLAZA_R + 0.45)]);
  }
  stakes.forEach(([x, , z], i) => {
    put(bin, "wood", box(0.04, 0.62, 0.04, x, 0.31, z));
    if (i % 2 === 0) put(bin, "flag", new PlaneGeometry(0.18, 0.11).translate(0.09, 0, 0).rotateY(Math.atan2(x, z)).translate(x, 0.55, z));
    const n = stakes[i + 1];
    if (n && Math.hypot(n[0] - x, n[2] - z) < 2.5) put(bin, "rope", beam([x, 0.45, z], [n[0], 0.45, n[2]], 0.008, 3));
  });
}

/** Crates and sacks of supplies against the tents and the pavilion. */
const SUPPLIES: { at: Vec3; rot: number; crates: number; sacks: number }[] = [
  { at: [12.8, 0, -3.8], rot: 0.4, crates: 3, sacks: 2 },
  { at: [-6.4, 0, -7.6], rot: -0.3, crates: 2, sacks: 1 },
  { at: [-10.8, 0, -4.6], rot: 1.1, crates: 2, sacks: 3 },
  { at: [-9.0, 0, 4.2], rot: 0.2, crates: 1, sacks: 2 },
  { at: [10.4, 0, 8.0], rot: -0.6, crates: 2, sacks: 1 },
];

function supplies(bin: Bin, rng: Rng) {
  for (const s of SUPPLIES) {
    const m = placeAt({ pos: s.at, rot: s.rot });
    for (let i = 0; i < s.crates; i++) {
      const sz = 0.55 + rng.next() * 0.2;
      const stacked = i === 2;
      put(bin, "crate", new BoxGeometry(sz, sz, sz).rotateY(rng.next() * 0.4).translate(stacked ? 0.3 : i * 0.75, stacked ? 0.65 + sz / 2 : sz / 2, stacked ? 0.1 : 0), m);
    }
    for (let i = 0; i < s.sacks; i++) {
      put(bin, "sack", new SphereGeometry(0.28, 7, 5).scale(1, 0.75, 0.85).translate(-0.6 - i * 0.5, 0.2, 0.35 + rng.next() * 0.2), m);
    }
  }
}

/** Banner poles: a pole and crossbar (the cloth is its own swaying mesh). */
function bannerPoles(bin: Bin) {
  for (const [x, , z] of BANNERS) {
    put(bin, "wood", beam([x, 0, z], [x, 4.6, z], 0.05, 6));
    put(bin, "wood", beam([x - 0.6, 4.35, z], [x + 0.6, 4.35, z], 0.03));
    put(bin, "iron", new ConeGeometry(0.07, 0.25, 5).translate(x, 4.72, z));
  }
}

/** Palisade logs round the south half, sharpened, leaning a little. */
function palisade(bin: Bin, rng: Rng): [number, number, number, number][] {
  const segs: [number, number, number, number][] = [];
  const step = 0.42 / PALISADE.r;
  for (let a = PALISADE.from; a < PALISADE.to; a += step) {
    if (Math.abs(a - Math.PI / 2) < PALISADE.gate) continue;
    const r = PALISADE.r + (rng.next() - 0.5) * 0.12;
    const h = 2.5 + rng.next() * 0.7;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const lean = (rng.next() - 0.5) * 0.06;
    const log = mergeGeometries([
      new CylinderGeometry(0.2, 0.22, h, 6).translate(0, h / 2, 0).toNonIndexed(),
      new ConeGeometry(0.2, 0.45, 6).translate(0, h + 0.22, 0).toNonIndexed(),
    ])!;
    put(bin, "bark", log.rotateZ(lean).rotateY(rng.next() * 6).translate(x, -0.1, z));
  }
  // Colliders: one box per three-metre chord, skipping the gate.
  const chord = 3 / PALISADE.r;
  for (let a = PALISADE.from; a < PALISADE.to - 1e-3; a += chord) {
    const b = Math.min(PALISADE.to, a + chord);
    const mid = (a + b) / 2;
    if (Math.abs(mid - Math.PI / 2) < PALISADE.gate + chord / 2) continue;
    segs.push([Math.cos(mid) * PALISADE.r, Math.sin(mid) * PALISADE.r, (b - a) * PALISADE.r, mid]);
  }
  return segs;
}

// ── The component ───────────────────────────────────────────────────────────

/** Where the camp's lamps hang (world space): tent doorways, the pavilion,
 * the tower, the worktable. */
function lampsOf(): { at: Vec3; intensity: number; distance: number; priority: number }[] {
  const out: { at: Vec3; intensity: number; distance: number; priority: number }[] = [];
  const v = new Vector3();
  for (const s of STRUCTURES) {
    const m = placeAt(s);
    if (s.kind === "pavilion") out.push({ at: v.set(0, 2.0, 0).applyMatrix4(m).toArray() as Vec3, intensity: 6, distance: 9, priority: 1 });
    if (s.kind === "tower") out.push({ at: v.set(0.7, 4.9, 0.7).applyMatrix4(m).toArray() as Vec3, intensity: 6, distance: 11, priority: 1 });
  }
  const t = placeAt(WORKTABLE);
  out.push({ at: v.set(0.62, 1.1, 0.22).applyMatrix4(t).toArray() as Vec3, intensity: 3, distance: 6, priority: 0 });
  // The two tents nearest the lane glow out of their doorways.
  for (const s of STRUCTURES.filter((s) => s.kind === "tent").slice(0, 4)) {
    if (Math.hypot(s.pos[0], s.pos[2] - 8) > 8) continue;
    out.push({ at: v.set(0, 0.7, s.d / 2 + 0.4).applyMatrix4(placeAt(s)).toArray() as Vec3, intensity: 2.5, distance: 5, priority: 0 });
  }
  return out;
}

export function Camp() {
  const built = useMemo(() => {
    const rng = new Rng(0xca4b);
    const bin: Bin = {};
    for (const s of STRUCTURES) {
      if (s.kind === "tent") tent(bin, s, rng);
      else if (s.kind === "pavilion") pavilion(bin, s);
      else if (s.kind === "tower") tower(bin, s);
      else wagon(bin, s);
    }
    campfire(bin, rng);
    worktable(bin);
    dig(bin, rng);
    supplies(bin, rng);
    bannerPoles(bin);
    const walls = palisade(bin, rng);
    const geos = Object.fromEntries(Object.entries(bin).map(([k, parts]) => [k, mergeGeometries(parts)!]));
    return { geos, walls };
  }, []);

  const mats = useMemo(() => {
    const canvas = getVillageTextures("canvas");
    const earth = getVillageTextures("earth");
    const bark = getVillageTextures("treeBark");
    const stone = getVillageTextures("basalt");
    const planks = getModelTextures("planks");
    const cloth = getModelTextures("cloth");
    return {
      canvas: new MeshStandardMaterial({ map: canvas.map, normalMap: canvas.normalMap, roughness: 0.95, side: DoubleSide }),
      doorway: new MeshStandardMaterial({ color: "#140a03", emissive: "#ff9440", emissiveIntensity: 1.5, toneMapped: false }),
      wood: new MeshStandardMaterial({ map: planks.map, color: "#5e4a38", roughness: 0.92 }),
      planks: new MeshStandardMaterial({ map: planks.map, normalMap: planks.normalMap, color: "#6e5a44", roughness: 0.9 }),
      crate: new MeshStandardMaterial({ map: planks.map, normalMap: planks.normalMap, color: "#7a6448", roughness: 0.9 }),
      rope: new MeshStandardMaterial({ color: "#6a5c44", roughness: 1 }),
      iron: new MeshStandardMaterial({ color: "#1e1c1e", roughness: 0.6, metalness: 0.6 }),
      lamp: new MeshStandardMaterial({ color: "#301800", emissive: "#ffb050", emissiveIntensity: 3, toneMapped: false }),
      parchment: new MeshStandardMaterial({ color: "#8a7a58", emissive: "#3a2c14", roughness: 0.9, side: DoubleSide }),
      stone: new MeshStandardMaterial({ map: stone.map, normalMap: stone.normalMap, color: "#8a8690", roughness: 0.85, flatShading: true }),
      charred: new MeshStandardMaterial({ color: "#120c08", emissive: "#3a1004", roughness: 1 }),
      bark: new MeshStandardMaterial({ map: bark.map, normalMap: bark.normalMap, roughness: 0.95 }),
      earth: new MeshStandardMaterial({ map: earth.map, normalMap: earth.normalMap, roughness: 1, flatShading: true }),
      flag: new MeshStandardMaterial({ color: "#8a2a1e", roughness: 0.9, side: DoubleSide }),
      sack: new MeshStandardMaterial({ map: cloth.map, color: "#7a6a4c", roughness: 1, flatShading: true }),
    } as Record<string, MeshStandardMaterial>;
  }, []);

  useEffect(
    () => () => {
      Object.values(built.geos).forEach((g) => g.dispose());
      Object.values(mats).forEach((m) => m.dispose());
    },
    [built, mats],
  );

  // Lamps and the fire, in the dynamic light pool.
  const fire = useRef<{ light: DynamicLightSource; seed: number } | null>(null);
  useEffect(() => {
    const lamps = lampsOf().map((l) => addLightSource({ position: l.at, color: "#ffb45a", intensity: l.intensity, distance: l.distance, priority: l.priority }));
    const [x, , z] = CAMPFIRE;
    const light = addLightSource({ position: [x, 0.9, z], color: "#ff8a3a", intensity: 14, distance: 13, priority: 2 });
    const flames = [
      addFlame({ position: [x, 0.12, z], color: "#ff8a3a", scale: 1.25 }),
      addFlame({ position: [x + 0.18, 0.1, z - 0.1], color: "#ff7a30", scale: 0.8 }),
      addFlame({ position: [x - 0.15, 0.1, z + 0.12], color: "#ff9a40", scale: 0.7 }),
    ];
    fire.current = { light, seed: Math.random() * 10 };
    return () => {
      lamps.forEach(removeLightSource);
      removeLightSource(light);
      flames.forEach(removeFlame);
      fire.current = null;
    };
  }, []);
  useFrame(({ clock }) => {
    const f = fire.current;
    if (!f) return;
    const t = clock.elapsedTime + f.seed;
    f.light.intensity = 14 + Math.sin(t * 7.1) * 2.2 + Math.sin(t * 17.3) * 1.4 + Math.sin(t * 2.3) * 1.6;
  });

  return (
    <group>
      {Object.entries(built.geos).map(([k, g]) => (
        <mesh key={k} geometry={g} material={mats[k]} castShadow={k !== "doorway" && k !== "rope"} receiveShadow />
      ))}
      <Banners />
      <RigidBody type="fixed" colliders={false}>
        {STRUCTURES.map((s, i) =>
          s.kind === "tent" || s.kind === "wagon" ? (
            <CuboidCollider key={i} args={[s.w / 2, s.h / 2, s.d / 2]} position={[s.pos[0], s.h / 2, s.pos[2]]} rotation={[0, s.rot, 0]} collisionGroups={WORLD_GROUPS} />
          ) : (
            // Pavilion and tower: their posts / legs.
            <group key={i} position={s.pos} rotation={[0, s.rot, 0]}>
              {[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, z], j) => {
                const k = s.kind === "tower" ? 1.0 : s.w / 2 - 0.15;
                return <CylinderCollider key={j} args={[1.5, 0.16]} position={[x! * k, 1.5, z! * k]} collisionGroups={WORLD_GROUPS} />;
              })}
              {s.kind === "pavilion" && <CuboidCollider args={[0.9, 0.45, 0.5]} position={[0, 0.45, 0]} collisionGroups={WORLD_GROUPS} />}
            </group>
          ),
        )}
        <CylinderCollider args={[0.4, 0.7]} position={[CAMPFIRE[0], 0.4, CAMPFIRE[2]]} collisionGroups={WORLD_GROUPS} />
        <CuboidCollider args={[0.8, 0.45, 0.4]} position={[WORKTABLE.pos[0], 0.45, WORKTABLE.pos[2]]} rotation={[0, WORKTABLE.rot, 0]} collisionGroups={WORLD_GROUPS} />
        {built.walls.map(([x, z, len, a], i) => (
          <CuboidCollider key={`w${i}`} args={[0.25, 1.6, len / 2]} position={[x, 1.6, z]} rotation={[0, -a, 0]} collisionGroups={WORLD_GROUPS} />
        ))}
      </RigidBody>
    </group>
  );
}

// ── Banners ─────────────────────────────────────────────────────────────────

/** The expedition's banners, hanging from the crossbars and stirring in the
 * night wind (a vertex sway, more at the swallowtail than at the bar). */
function Banners() {
  const res = useMemo(() => {
    // A cloth 1.0 × 2.2 m, cut into a swallowtail, in a grid so it can sway.
    const shape = new Shape();
    shape.moveTo(-0.5, 0);
    shape.lineTo(0.5, 0);
    shape.lineTo(0.5, -2.2);
    shape.lineTo(0, -1.75);
    shape.lineTo(-0.5, -2.2);
    shape.closePath();
    const g = new ShapeGeometry(shape, 1);
    // UVs: x −0.5…0.5 → 0…1, y 0…−2.2 → 1…0.
    const pos = g.attributes.position!;
    const uv = g.attributes.uv!;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) + 0.5, 1 + pos.getY(i) / 2.2);
    const parts: BufferGeometry[] = [];
    BANNERS.forEach(([x, , z], i) => {
      const c = g.clone().toNonIndexed();
      // Each banner stirs out of step with the others.
      c.setAttribute("aPhase", new Float32BufferAttribute(new Array(c.attributes.position!.count).fill(i * 1.7), 1));
      parts.push(c.translate(x, 4.33, z));
    });
    const geo = mergeGeometries(parts)!;
    const tex = getVillageTextures("banner");
    const mat = new MeshStandardMaterial({
      map: tex.map,
      emissiveMap: tex.emissiveMap,
      emissive: "#ffffff",
      emissiveIntensity: 1.2,
      roughness: 0.9,
      side: DoubleSide,
    });
    const time = { value: 0 };
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = time;
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nuniform float uTime;\nattribute float aPhase;")
        .replace(
          "#include <begin_vertex>",
          `vec3 transformed = position;
          float phase = aPhase;
          float hang = clamp((4.33 - position.y) / 2.2, 0.0, 1.0);
          transformed.z += sin(uTime * 1.6 + phase + position.y * 1.8) * 0.16 * hang;
          transformed.x += sin(uTime * 1.1 + phase * 0.7) * 0.05 * hang;`,
        );
    };
    return { geo, mat, time };
  }, []);
  useEffect(() => () => {
    res.geo.dispose();
    res.mat.dispose();
  }, [res]);
  useFrame(({ clock }) => {
    res.time.value = clock.elapsedTime;
  });
  return <mesh geometry={res.geo} material={res.mat} castShadow frustumCulled={false} />;
}
