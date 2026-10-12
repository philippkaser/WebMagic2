import { budgetCount, randomInCone, randomUnit, type MutVec3 } from "./curves";
import { beginParticle, commitParticle, particleOccupancy, readVec, setParticleColor, type Vec3Like } from "./Particles";
import type { ParticleInit } from "./particleSim";

/** The looks of the spells that don't fly — in the same pixel-magic
 * language as fx/effects.ts (crisp chunks, white-hot cores stepping down
 * into the spell's colour, stepped glows, everything through the one
 * particle draw call):
 *
 *  - beamFx: the Prism Ray. A line of hot pixels laid along the beam each
 *    tick (ticks overlap, so a held beam reads as continuous), a flare
 *    where it lands, sparks spat off the burn.
 *  - railFx: the Starpierce. One line, much brighter, that lingers and
 *    shivers apart into sparks along its length.
 *  - lightningFx: Forked Lightning. A jagged polyline of white-hot pixels
 *    with a glow halo, flashing for a few frames.
 *  - flameConeFx: Dragon's Breath. Flame streaks and embers flung down
 *    the cone, smoke curling off the tips.
 *  - stormStrikeFx: Stormcaller's sky-bolt, straight down from the vault.
 *  - ricochetFx: a bolt kissing off a wall.
 *
 * All counts go through the pool budget; allocation-free. */

const a: MutVec3 = { x: 0, y: 0, z: 0 };
const b: MutVec3 = { x: 0, y: 0, z: 0 };
const d: MutVec3 = { x: 0, y: 0, z: 0 };
const tmp: MutVec3 = { x: 0, y: 0, z: 0 };

const rand = (lo: number, hi: number): number => lo + Math.random() * (hi - lo);
const budget = (n: number): number => budgetCount(n, particleOccupancy());

function at(p: ParticleInit, x: number, y: number, z: number): ParticleInit {
  p.x = x;
  p.y = y;
  p.z = z;
  return p;
}

/** Hot pixels along the segment a→b (already read into `a`/`b`). */
function line(color: string, spacing: number, size: number, life: number, intensity: number, jitter: number, max: number): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dy, dz);
  const n = Math.min(budget(Math.ceil(len / spacing)), max);
  for (let i = 0; i < n; i++) {
    const f = (i + Math.random()) / n;
    const p = at(beginParticle("glow"), a.x + dx * f + rand(-jitter, jitter), a.y + dy * f + rand(-jitter, jitter), a.z + dz * f + rand(-jitter, jitter));
    p.size0 = size * rand(0.8, 1.2);
    p.size1 = size * 0.2;
    p.life = life * rand(0.8, 1.2);
    p.drag = 0;
    p.gravity = 0;
    setParticleColor(p, "#ffffff", color, intensity, intensity * 0.5);
    // A touch of white toward the core.
    p.r0 = (p.r0 + intensity) * 0.5;
    p.g0 = (p.g0 + intensity) * 0.5;
    p.b0 = (p.b0 + intensity) * 0.5;
    commitParticle();
  }
}

function flare(x: number, y: number, z: number, s0: number, s1: number, life: number, color: string, intensity: number): void {
  const p = at(beginParticle("flare"), x, y, z);
  p.size0 = s0;
  p.size1 = s1;
  p.life = life;
  setParticleColor(p, "#ffffff", color, intensity, intensity * 0.5);
  commitParticle();
}

function sparks(x: number, y: number, z: number, count: number, color: string, speed: number, size = 0.014): void {
  for (let i = 0, n = budget(count); i < n; i++) {
    randomUnit(d);
    const s = rand(speed * 0.4, speed);
    const p = at(beginParticle("spark"), x, y, z);
    p.vx = d.x * s;
    p.vy = d.y * s + 1;
    p.vz = d.z * s;
    p.size0 = size * rand(0.7, 1.3);
    p.stretch = 0.03;
    p.life = rand(0.15, 0.35);
    setParticleColor(p, "#ffffff", color, 2.6, 1.1);
    commitParticle();
  }
}

/** One tick of the Prism Ray from `from` to where it lands. `hit` = it
 * burned into something (a creature or stone), not just thin air. */
export function beamFx(from: Vec3Like, to: Vec3Like, color: string, hit: boolean): void {
  readVec(from, a);
  readVec(to, b);
  line(color, 0.11, 0.045, 0.1, 2.6, 0.012, 220);
  flare(b.x, b.y, b.z, 0.12, 0.2, 0.08, color, 2.6);
  if (hit) sparks(b.x, b.y, b.z, 3, color, 5);
}

/** The Starpierce's line: bright, lingering, shivering into sparks. */
export function railFx(from: Vec3Like, to: Vec3Like, color: string): void {
  readVec(from, a);
  readVec(to, b);
  line(color, 0.06, 0.09, 0.32, 3.4, 0.02, 700);
  line("#ffffff", 0.15, 0.04, 0.14, 4, 0, 300);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  for (let i = 0, n = budget(18); i < n; i++) {
    const f = Math.random();
    sparks(a.x + dx * f, a.y + dy * f, a.z + dz * f, 1, color, 2.5, 0.012);
  }
  flare(b.x, b.y, b.z, 0.2, 0.5, 0.16, color, 3);
  flare(a.x, a.y, a.z, 0.15, 0.3, 0.1, color, 3);
}

/** A forked bolt along precomputed points (weapons/hitscan#lightningPoints). */
export function lightningFx(points: readonly Vec3Like[], color: string): void {
  for (let i = 0; i + 1 < points.length; i++) {
    readVec(points[i]!, a);
    readVec(points[i + 1]!, b);
    line("#e8fbff", 0.07, 0.035, 0.09, 3.6, 0, 80);
    line(color, 0.18, 0.08, 0.12, 1.6, 0.03, 40);
  }
  const end = points[points.length - 1];
  if (end) {
    readVec(end, b);
    flare(b.x, b.y, b.z, 0.16, 0.34, 0.12, color, 3);
    sparks(b.x, b.y, b.z, 6, color, 6);
  }
}

/** One tick of Dragon's Breath: flame flung down the cone. */
export function flameConeFx(origin: Vec3Like, aim: Vec3Like, range: number, halfAngle: number, color: string): void {
  readVec(origin, a);
  readVec(aim, d);
  const speed = range * 3.2;
  for (let i = 0, n = budget(9); i < n; i++) {
    randomInCone(d.x, d.y, d.z, halfAngle, tmp);
    const s = speed * rand(0.7, 1.1);
    const p = at(beginParticle("flame"), a.x, a.y, a.z);
    p.vx = tmp.x * s;
    p.vy = tmp.y * s;
    p.vz = tmp.z * s;
    p.drag = 3.2;
    p.size0 = rand(0.06, 0.11);
    p.life = rand(0.22, 0.34);
    setParticleColor(p, "#fff4c0", color, 3, 1.2);
    commitParticle();
  }
  for (let i = 0, n = budget(3); i < n; i++) {
    randomInCone(d.x, d.y, d.z, halfAngle * 1.2, tmp);
    const s = speed * rand(0.5, 0.9);
    const p = at(beginParticle("ember"), a.x, a.y, a.z);
    p.vx = tmp.x * s;
    p.vy = tmp.y * s;
    p.vz = tmp.z * s;
    p.size0 = rand(0.012, 0.022);
    p.life = rand(0.4, 0.8);
    setParticleColor(p, "#ffffff", color, 2.6, 1.2);
    commitParticle();
  }
  if (Math.random() < 0.35) {
    const p = at(beginParticle("smoke"), a.x + d.x * range * 0.8, a.y + d.y * range * 0.8 + 0.3, a.z + d.z * range * 0.8);
    p.vy = 0.8;
    p.size0 = 0.25;
    p.size1 = 0.7;
    p.life = 0.9;
    setParticleColor(p, "#2a2220", "#141012", 1, 1);
    commitParticle();
  }
}

/** Stormcaller's sky-bolt: straight down from the vault onto `target`. */
export function stormStrikeFx(target: Vec3Like, color: string, ceiling = 6): void {
  readVec(target, b);
  const pts: Vec3Like[] = [];
  let x = b.x + rand(-0.4, 0.4);
  let z = b.z + rand(-0.4, 0.4);
  const steps = 7;
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    pts.push({ x, y: ceiling + (b.y - ceiling) * f, z });
    x = b.x + (x - b.x) * 0.6 + rand(-0.35, 0.35) * (1 - f);
    z = b.z + (z - b.z) * 0.6 + rand(-0.35, 0.35) * (1 - f);
  }
  pts[pts.length - 1] = { x: b.x, y: b.y, z: b.z };
  lightningFx(pts, color);
}

/** A bolt glancing off stone. */
export function ricochetFx(position: Vec3Like, color: string): void {
  readVec(position, b);
  flare(b.x, b.y, b.z, 0.08, 0.18, 0.08, color, 2.6);
  sparks(b.x, b.y, b.z, 5, color, 5, 0.01);
}

// Dev-only hook for screenshot scripts.
if (typeof window !== "undefined" && import.meta.env?.DEV) {
  (window as unknown as Record<string, unknown>).__spellFx = { beamFx, railFx, lightningFx, flameConeFx, stormStrikeFx, ricochetFx };
}
