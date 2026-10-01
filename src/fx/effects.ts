import { budgetCount, randomInCone, randomUnit, trailSteps, type MutVec3 } from "./curves";
import {
  beginParticle,
  commitParticle,
  GROUND_Y,
  particleOccupancy,
  readVec,
  rgbOf,
  type Vec3Like,
} from "./Particles";
import { EYE_HEIGHT } from "../core/config";
import { playerPosition } from "../game/player-state";
import type { ParticleInit, ParticleStyle } from "./particleSim";

/** Named gameplay effects, composed from the particle styles. Gameplay code
 * calls these instead of hand-tuning bursts, so every explosion, hit and
 * death in the game shares one visual language — pixel magic:
 *
 * - many SMALL crisp pieces rather than a few big soft ones: 1–2 px sparks
 *   and embers, hot chunks that tumble as little cubes, stepped glows;
 * - light (glows, sparks, flares, rings) is HDR, so its pixels bloom;
 * - matter (smoke, dust, debris) is solid, matte and lit by the light pool,
 *   so it glows with whatever flash made it, and dissolves in dither cells;
 * - spell colour tints everything, white-hot cores stepping down into it.
 *
 * All counts go through budgetCount: when the pool is filling up (a chain of
 * barrels), effects thin out instead of evicting each other. Everything here
 * is allocation-free — positions are read into scratch vectors. */

const at: MutVec3 = { x: 0, y: 0, z: 0 };
const dir: MutVec3 = { x: 0, y: 0, z: 0 };
const tmp: MutVec3 = { x: 0, y: 0, z: 0 };
const tmp2: MutVec3 = { x: 0, y: 0, z: 0 };

const rand = (a: number, b: number): number => a + Math.random() * (b - a);
const budget = (n: number): number => budgetCount(n, particleOccupancy());

/** Start colour = `start` pushed `whiten` of the way to white, × i0; end
 * colour = `end` × i1. The white-hot → tint → dim ramp every energetic
 * particle uses. */
function ramp(p: ParticleInit, start: string, end: string, i0: number, i1: number, whiten = 0): void {
  const a = rgbOf(start);
  const b = rgbOf(end);
  p.r0 = (a[0] + (1 - a[0]) * whiten) * i0;
  p.g0 = (a[1] + (1 - a[1]) * whiten) * i0;
  p.b0 = (a[2] + (1 - a[2]) * whiten) * i0;
  p.r1 = b[0] * i1;
  p.g1 = b[1] * i1;
  p.b1 = b[2] * i1;
}

function place(p: ParticleInit, x: number, y: number, z: number): ParticleInit {
  p.x = x;
  p.y = y;
  p.z = z;
  return p;
}

/** One quick sprite at a point — flashes, halos. */
function flash(
  style: ParticleStyle,
  x: number,
  y: number,
  z: number,
  size0: number,
  size1: number,
  life: number,
  color: string,
  intensity: number,
  whiten = 0.6,
): ParticleInit {
  const p = place(beginParticle(style), x, y, z);
  p.size0 = size0;
  p.size1 = size1;
  p.life = life;
  p.drag = 0;
  p.gravity = 0;
  ramp(p, color, color, intensity, intensity * 0.5, whiten);
  return p;
}

/** A shockwave ring. `n` = plane normal (null → faces the camera). */
function ring(
  x: number,
  y: number,
  z: number,
  n: MutVec3 | null,
  r0: number,
  r1: number,
  life: number,
  thickness: number,
  color: string,
  intensity: number,
  alpha = 1,
  whiten = 0.25,
): ParticleInit {
  const p = place(beginParticle("ring"), x, y, z);
  p.size0 = r0;
  p.size1 = r1;
  p.life = life;
  p.rotation = thickness;
  p.alpha = alpha;
  if (n) {
    p.nx = n.x;
    p.ny = n.y;
    p.nz = n.z;
  }
  // Rings fade by alpha, not by dimming: a dim additive ring reads as a
  // brown smear on dark stone.
  ramp(p, color, color, intensity, intensity * 0.85, whiten);
  return p;
}

const UP: MutVec3 = { x: 0, y: 1, z: 0 };

// ── Explosions ──────────────────────────────────────────────────────────────

/** A detonation: white-hot core flash, a swelling fireball, stretched sparks,
 * embers that drift up after, lingering lit smoke, an expanding shockwave
 * ring — and, near the ground, a floor ring and a skirt of kicked-up dust.
 * Scaled by `radius`; `power` (≈ particles/36 from explode()) scales counts
 * so a bolt's pop stays a pop and a barrel stays a barrel. */
export function explosionFx(position: Vec3Like, radius: number, color: string, power = 1): void {
  readVec(position, at);
  const { x, y, z } = at;
  const R = Math.max(0.4, radius);
  const k = Math.max(0.3, Math.min(power, 1.8));

  // Core: a star flash that pops, and a hot glow under it. Kept well inside
  // the radius — at dpr 0.35 a big white quad reads as a blown-out screen,
  // not heat; the colour has to survive. A point-blank blast (blast-jumping)
  // is capped further by its distance to the eye.
  const eye = Math.hypot(x - playerPosition.x, y - playerPosition.y - EYE_HEIGHT, z - playerPosition.z);
  const core = Math.min(R * (0.55 + 0.45 * Math.min(k, 1)), Math.max(0.5, eye * 0.7));
  commit(flash("flare", x, y, z, core * 0.12, core * 0.42, 0.12, color, 2.4, 0.65));
  commit(flash("glow", x, y, z, core * 0.14, core * 0.24, 0.14, color, 2.2, 0.6));

  // Fireball: a cluster of stepped pixel puffs that swell as they slow,
  // banding down from white-hot to the spell's tint to a dull ember.
  for (let i = 0, n = budget(8 + 10 * k + R * 2); i < n; i++) {
    randomUnit(dir);
    const s = R * rand(1, 2.6);
    const off = R * rand(0.05, 0.2);
    const p = place(beginParticle("glow"), x + dir.x * off, y + dir.y * off, z + dir.z * off);
    p.vx = dir.x * s;
    p.vy = dir.y * s + R * 0.4;
    p.vz = dir.z * s;
    p.drag = 5.5;
    p.size0 = R * rand(0.045, 0.09);
    p.size1 = p.size0 * rand(1.5, 2);
    p.life = rand(0.3, 0.6);
    // Modest HDR: pale spell colours (ice blue) saturate to white if pushed
    // much past 1.3, and the fireball should read as the spell's colour.
    ramp(p, color, color, 1.3, 0.55, Math.random() < 0.25 ? rand(0.2, 0.4) : rand(0, 0.1));
    commitParticle();
  }

  // Sparks: chains of hot pixels flung out, arcing down, bouncing.
  for (let i = 0, n = budget(14 + 26 * k + R * 4); i < n; i++) {
    randomUnit(dir);
    const s = R * rand(3, 7.5);
    const p = place(beginParticle("spark"), x, y, z);
    p.vx = dir.x * s;
    p.vy = dir.y * s + R * 1.2;
    p.vz = dir.z * s;
    p.size0 = rand(0.012, 0.026);
    p.size1 = p.size0 * 0.5;
    p.life = rand(0.3, 0.8);
    p.gravity = -14;
    p.drag = 1.7;
    p.stretch = 0.04;
    ramp(p, "#fff1c8", color, 3, 1.3, 0);
    commitParticle();
  }

  // Cinders: hot little cubes that tumble out, bounce and cool — the
  // chunky heart of a pixel explosion.
  for (let i = 0, n = budget(6 + 8 * k + R * 2.5); i < n; i++) {
    randomUnit(dir);
    const s = R * rand(1.2, 3.6);
    const p = place(beginParticle("pixel"), x, y, z);
    p.vx = dir.x * s;
    p.vy = Math.abs(dir.y) * s + R * 0.8;
    p.vz = dir.z * s;
    p.size0 = rand(0.015, 0.035) * Math.min(1.3, 0.6 + R * 0.15);
    p.size1 = 0;
    p.life = rand(0.7, 1.5);
    ramp(p, "#ffe7b0", color, 2.4, 0.5, 0.2);
    commitParticle();
  }

  // Embers: single bright pixels that float up once the blast lets go.
  for (let i = 0, n = budget(6 + 12 * k + R * 2); i < n; i++) {
    randomUnit(dir);
    const s = R * rand(0.8, 2.6);
    const p = place(beginParticle("ember"), x, y, z);
    p.vx = dir.x * s;
    p.vy = Math.abs(dir.y) * s + 1;
    p.vz = dir.z * s;
    p.size0 = rand(0.012, 0.022);
    p.life = rand(1, 2.4);
    ramp(p, "#ffd08a", color, 2.6, 0.9, 0.2);
    commitParticle();
  }

  // Smoke: lit, so the flash (and nearby torches) colour it as it rolls up.
  for (let i = 0, n = budget(3 + 7 * k + R * 1.5); i < n; i++) {
    randomUnit(dir);
    const s = R * rand(0.4, 1.1);
    const p = place(beginParticle("smoke"), x + dir.x * R * 0.2, y + dir.y * R * 0.15, z + dir.z * R * 0.2);
    p.vx = dir.x * s;
    p.vy = dir.y * s * 0.5 + rand(0.4, 1);
    p.vz = dir.z * s;
    p.size0 = R * rand(0.05, 0.09);
    p.size1 = R * rand(0.18, 0.3);
    p.life = rand(1.2, 2.2);
    p.alpha = rand(0.55, 0.8);
    tintedSmoke(p, color, 0.18);
    commitParticle();
  }

  // Shockwave: a quick, thin pressure ring in the air…
  commit(ring(x, y, z, null, R * 0.1, R * 0.9, 0.2, 0.04, color, 2, 0.5));
  // …and where the blast is near the floor, a ground ring and a dust skirt.
  const h = y - GROUND_Y;
  if (h < R * 0.9) {
    const near = 1 - Math.max(0, h) / (R * 0.9);
    commit(ring(x, GROUND_Y + 0.06, z, UP, R * 0.2, R * 1.25, 0.42, 0.06, color, 2, 0.35 + 0.65 * near));
    for (let i = 0, n = budget((4 + R * 3.5) * near); i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = R * rand(1.6, 3);
      const p = place(beginParticle("smoke"), x + Math.cos(a) * R * 0.3, GROUND_Y + 0.15, z + Math.sin(a) * R * 0.3);
      p.vx = Math.cos(a) * s;
      p.vz = Math.sin(a) * s;
      p.vy = rand(0.2, 0.6);
      p.drag = 3.5;
      p.gravity = 0.15;
      p.size0 = R * 0.04;
      p.size1 = R * rand(0.1, 0.17);
      p.life = rand(0.7, 1.2);
      p.alpha = 0.7 * near;
      ramp(p, "#5a4c3e", "#1c1916", 1, 1);
      commitParticle();
    }
  }
}

/** A ring of force centred on its caster (the Shockwave spell). No fireball
 * — the caster is standing in it — the energy is all in rings: a bright one
 * racing out along the floor from the feet, a slower, softer one behind it, a
 * faint one at chest height, sparks skating outward along the ground and a
 * skirt of dust. */
export function shockwaveFx(position: Vec3Like, radius: number, color: string, power = 1): void {
  readVec(position, at);
  const { x, y, z } = at;
  const R = Math.max(0.5, radius);
  const k = Math.max(0.4, Math.min(power, 1.8));
  const gy = GROUND_Y + 0.06;
  // Standing, the staff tip is ~1.4 m up; far above the floor the ground
  // rings fade out.
  const near = 1 - Math.min(1, Math.max(0, y - GROUND_Y - 1.8) / R);
  if (near > 0) {
    commit(ring(x, gy, z, UP, 0.3, R * 1.1, 0.42, 0.06, color, 2.6, near));
    commit(ring(x, gy, z, UP, 0.2, R * 0.75, 0.6, 0.18, color, 1.6, 0.65 * near));
  }
  commit(ring(x, y - 0.35, z, UP, 0.4, R * 1.2, 0.28, 0.04, color, 2, 0.45));
  const floorY = near > 0 ? gy + 0.08 : y - 0.5;
  for (let i = 0, n = budget(32 * k); i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rand(-0.1, 0.1);
    const p = place(beginParticle("spark"), x + Math.cos(a) * 0.5, floorY, z + Math.sin(a) * 0.5);
    const s = R * rand(3, 4.6);
    p.vx = Math.cos(a) * s;
    p.vz = Math.sin(a) * s;
    p.vy = rand(0.3, 1.5);
    p.gravity = -6;
    p.drag = 2.4;
    p.stretch = 0.04;
    p.size0 = rand(0.012, 0.024);
    p.life = rand(0.3, 0.5);
    ramp(p, "#ffffff", color, 2.8, 1.2);
    commitParticle();
  }
  for (let i = 0, n = budget(10 * k * near); i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = R * rand(1.6, 2.6);
    const p = place(beginParticle("smoke"), x + Math.cos(a) * 0.6, GROUND_Y + 0.15, z + Math.sin(a) * 0.6);
    p.vx = Math.cos(a) * s;
    p.vz = Math.sin(a) * s;
    p.vy = rand(0.2, 0.5);
    p.drag = 3.2;
    p.size0 = 0.1;
    p.size1 = R * rand(0.07, 0.11);
    p.life = rand(0.6, 1);
    p.alpha = 0.65 * near;
    ramp(p, "#6a5c4c", "#1c1916", 1, 1);
    commitParticle();
  }
  for (let i = 0, n = budget(14 * k); i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = R * rand(0.3, 0.9);
    const p = place(beginParticle("ember"), x + Math.cos(a) * r, floorY + 0.1, z + Math.sin(a) * r);
    p.vy = rand(0.8, 1.8);
    p.size0 = rand(0.012, 0.022);
    p.life = rand(0.7, 1.3);
    ramp(p, "#ffffff", color, 2.4, 0.9, 0.3);
    commitParticle();
  }
}

/** Smoke that starts faintly tinted by the fire that made it and darkens. */
function tintedSmoke(p: ParticleInit, color: string, tint: number): void {
  const c = rgbOf(color);
  const base = 0.09;
  p.r0 = base + c[0] * tint;
  p.g0 = base * 0.9 + c[1] * tint;
  p.b0 = base * 0.85 + c[2] * tint;
  p.r1 = p.g1 = p.b1 = 0.03;
}

/** Spawn `p` — always the shared scratch record returned by a builder
 * (flash/ring); taking it as a parameter keeps "build, tweak, commit" readable
 * at the call site. */
function commit(_p: ParticleInit): void {
  commitParticle();
}

// ── Casting ─────────────────────────────────────────────────────────────────

/** Commit `p` moving with the emitter (velocity in tmp2). */
function withInherit(p: ParticleInit): void {
  p.vx += tmp2.x;
  p.vy += tmp2.y;
  p.vz += tmp2.z;
  commitParticle();
}

/** Muzzle flare at the staff tip: a star flash, a small spell circle facing
 * the aim, and a spray of sparks down the line of fire. `inherit` is the
 * caster's velocity so the flare rides with a strafing wizard instead of
 * being left behind. */
export function castFlareFx(
  position: Vec3Like,
  aim: Vec3Like,
  color: string,
  inherit?: Vec3Like,
  scale = 1,
): void {
  readVec(position, at);
  readVec(aim, dir);
  if (inherit) readVec(inherit, tmp2);
  else tmp2.x = tmp2.y = tmp2.z = 0;
  // The flash is a hard plus of pixels (a pixel-art star), the circle a
  // stepped rune ring facing the aim.
  withInherit(flash("flare", at.x, at.y, at.z, 0.06 * scale, 0.16 * scale, 0.11, color, 3, 0.7));
  const c = ring(at.x, at.y, at.z, dir, 0.03 * scale, 0.14 * scale, 0.15, 0.07, color, 2.2, 1, 0.25);
  c.drag = 0;
  withInherit(c);
  const ax = dir.x;
  const ay = dir.y;
  const az = dir.z;
  for (let i = 0, n = budget(9 * scale); i < n; i++) {
    randomInCone(ax, ay, az, 0.45, tmp);
    const s = rand(5, 11);
    const p = place(beginParticle("spark"), at.x, at.y, at.z);
    p.vx = tmp.x * s;
    p.vy = tmp.y * s;
    p.vz = tmp.z * s;
    p.gravity = -4;
    p.drag = 7;
    p.size0 = rand(0.008, 0.014) * scale;
    p.stretch = 0.025;
    p.life = rand(0.1, 0.22);
    ramp(p, "#ffffff", color, 3, 1.4);
    withInherit(p);
  }
}

/** A pixel comet tail for a bolt, laid along the segment it flew this frame
 * so the trail is continuous at any speed: stepped squares that cool and
 * burn down behind the head, a few loose sparks shed off it, and a tiny
 * star at the head that bloom turns into the bolt's glow. */
export function boltTrailFx(from: Vec3Like, to: Vec3Like, color: string, size: number): void {
  readVec(from, tmp);
  readVec(to, at);
  const dx = at.x - tmp.x;
  const dy = at.y - tmp.y;
  const dz = at.z - tmp.z;
  const dist = Math.hypot(dx, dy, dz);
  const steps = Math.min(trailSteps(dist, 0.06, 14), budget(14));
  for (let i = 0; i < steps; i++) {
    const f = (i + Math.random()) / steps;
    const p = place(beginParticle("glow"), tmp.x + dx * f, tmp.y + dy * f, tmp.z + dz * f);
    p.vx = rand(-0.3, 0.3);
    p.vy = rand(-0.3, 0.3);
    p.vz = rand(-0.3, 0.3);
    p.drag = 2;
    p.size0 = size * rand(0.55, 0.85);
    p.size1 = 0;
    // Earlier points on the segment were "emitted" earlier: shorter life.
    p.life = rand(0.16, 0.28) * (0.75 + 0.25 * f);
    ramp(p, color, color, 2.2, 0.5, 0.5);
    commitParticle();
  }
  // Head glint: a tiny pixel star riding the bolt.
  const h = flash("flare", at.x, at.y, at.z, size * 1.4, size * 1.8, 0.05, color, 2, 0.5);
  h.vx = dx * 10;
  h.vy = dy * 10;
  h.vz = dz * 10;
  commitParticle();
  // Shed sparks: loose pixels flicked off the head.
  for (let i = 0, n = Math.random() < 0.6 ? budget(2) : 0; i < n; i++) {
    randomUnit(dir);
    const p = place(beginParticle("ember"), at.x, at.y, at.z);
    p.vx = dir.x * 1.6;
    p.vy = dir.y * 1.6;
    p.vz = dir.z * 1.6;
    p.gravity = -3;
    p.size0 = rand(0.008, 0.014);
    p.life = rand(0.25, 0.5);
    ramp(p, "#ffffff", color, 2.5, 1.2, 0);
    commitParticle();
  }
}

// ── Void magic ──────────────────────────────────────────────────────────────

const VOID_LIGHT = "#c89cff";

/** A void seed in flight / waiting: motes pulled into it in tight spirals
 * and a thin dark wake. Call every frame or two. */
export function voidSeedFx(position: Vec3Like, size: number): void {
  readVec(position, at);
  if (budget(2) <= 0) return;
  // An inward-spiralling mote from a shell around the seed.
  randomUnit(dir);
  const r = size * rand(3, 5);
  const p = place(beginParticle("glow"), at.x + dir.x * r, at.y + dir.y * r, at.z + dir.z * r);
  // Tangent = dir × up (fallback x): gives the swirl.
  p.vx = -dir.z * 2.2;
  p.vy = 0.4;
  p.vz = dir.x * 2.2;
  p.ax = at.x;
  p.ay = at.y;
  p.az = at.z;
  p.attract = 14;
  p.drag = 1;
  p.size0 = size * 0.22;
  p.size1 = size * 0.08;
  p.life = 0.5;
  ramp(p, VOID_LIGHT, "#8a4dff", 2, 1.4, 0.2);
  commitParticle();
  // Dark wake.
  const s = place(beginParticle("smoke"), at.x, at.y, at.z);
  s.size0 = size * 0.4;
  s.size1 = size * 1.2;
  s.life = 0.6;
  s.alpha = 0.75;
  s.gravity = 0;
  ramp(s, "#1a0a2e", "#05020a", 1, 1);
  commitParticle();
}

// Accretion disc plane (matches the BlackHole torus, rotated π/2.3 about X).
const DISC_TILT = Math.PI / 2.3;
const DISC_W = { x: 0, y: Math.cos(DISC_TILT), z: Math.sin(DISC_TILT) };

/** One frame of a black hole: matter spiralling in along a tilted accretion
 * disc (bright motes and dark smoke), plus — every `ringEvery` calls — an
 * event-horizon ring contracting into the core. `radius` is the pull radius. */
export function blackHoleFx(position: Vec3Like, radius: number, ringPulse: boolean): void {
  readVec(position, at);
  const { x, y, z } = at;
  for (let i = 0, n = budget(6); i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = radius * rand(0.45, 0.95);
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    // Disc position: u = x-axis, w = tilted up-axis.
    const px = x + ca * r;
    const py = y + DISC_W.y * sa * r + rand(-0.15, 0.15);
    const pz = z + DISC_W.z * sa * r;
    const dark = i % 3 === 2;
    const p = place(beginParticle(dark ? "smoke" : "glow"), px, py, pz);
    // Tangential velocity (−sin a)·u + (cos a)·w.
    const v = rand(2.8, 4.2);
    p.vx = -sa * v;
    p.vy = DISC_W.y * ca * v;
    p.vz = DISC_W.z * ca * v;
    p.ax = x;
    p.ay = y;
    p.az = z;
    p.attract = rand(9, 14);
    p.drag = 0.8;
    p.gravity = 0;
    p.life = 1.4;
    if (dark) {
      p.size0 = rand(0.1, 0.18);
      p.size1 = 0.05;
      p.alpha = 0.9;
      ramp(p, "#140824", "#000000", 1, 1);
    } else {
      p.size0 = rand(0.025, 0.055);
      p.size1 = 0.015;
      ramp(p, VOID_LIGHT, "#7a3dff", 2.4, 1.6, 0.35);
    }
    commitParticle();
  }
  if (ringPulse) commit(ring(x, y, z, null, 1.9, 0.55, 0.45, 0.1, "#b07bff", 2, 0.8, 0.1));
}

/** The moment a black hole gives way: a white flash, a ring that snaps
 * outward, then the ordinary (purple) explosion does the rest. */
export function collapseFlashFx(position: Vec3Like): void {
  readVec(position, at);
  commit(flash("flare", at.x, at.y, at.z, 0.35, 2.2, 0.18, VOID_LIGHT, 2.6, 0.7));
  commit(ring(at.x, at.y, at.z, null, 0.3, 5, 0.4, 0.04, VOID_LIGHT, 2.6, 0.9));
}

// ── Hits and deaths ─────────────────────────────────────────────────────────

/** A shot landing on a creature: a small flash and a spray of sparks in the
 * creature's colour. */
export function hitSparksFx(position: Vec3Like, color: string, scale = 1): void {
  readVec(position, at);
  commit(flash("flare", at.x, at.y, at.z, 0.1 * scale, 0.22 * scale, 0.1, color, 2.6, 0.7));
  commit(flash("glow", at.x, at.y, at.z, 0.05 * scale, 0.08 * scale, 0.08, color, 2.4, 0.7));
  for (let i = 0, n = budget(11 * scale + 3); i < n; i++) {
    randomUnit(dir);
    const s = rand(3, 7.5) * scale;
    const p = place(beginParticle("spark"), at.x, at.y, at.z);
    p.vx = dir.x * s;
    p.vy = dir.y * s + 1.5;
    p.vz = dir.z * s;
    p.gravity = -13;
    p.drag = 2.8;
    p.size0 = rand(0.009, 0.018) * scale;
    p.stretch = 0.03;
    p.life = rand(0.18, 0.4);
    ramp(p, "#ffffff", color, 2.8, 1.1);
    commitParticle();
  }
}

/** A creature's death: a flash, a ring, and its energy dissolving upward as
 * rising soul-light — plus a couple of streaks shooting straight up. `scale`
 * sizes it (1 = a wisp, ~2.5 = the Warden). */
export function soulDissolveFx(position: Vec3Like, color: string, scale = 1): void {
  readVec(position, at);
  const { x, y, z } = at;
  commit(flash("glow", x, y, z, 0.12 * scale, 0.26 * scale, 0.16, color, 3, 0.8));
  commit(flash("flare", x, y, z, 0.2 * scale, 0.7 * scale, 0.16, color, 2.6, 0.8));
  commit(ring(x, y, z, null, 0.2 * scale, 1.5 * scale, 0.38, 0.03, color, 2.2, 1));

  for (let i = 0, n = budget(34 * scale); i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * 0.45 * scale;
    const p = place(
      beginParticle("soul"),
      x + Math.cos(a) * r,
      y + rand(-0.45, 0.45) * scale,
      z + Math.sin(a) * r,
    );
    const out = rand(0.4, 1.3);
    p.vx = Math.cos(a) * out;
    p.vz = Math.sin(a) * out;
    p.vy = rand(0.3, 1.6);
    p.size0 = rand(0.016, 0.04) * Math.sqrt(scale);
    p.life = rand(0.8, 1.8);
    ramp(p, color, color, 2.4, 0.7, rand(0.1, 0.55));
    commitParticle();
  }
  for (let i = 0, n = budget(12 + 6 * scale); i < n; i++) {
    randomUnit(dir);
    const s = rand(3.5, 7) * Math.sqrt(scale);
    const p = place(beginParticle("spark"), x, y, z);
    p.vx = dir.x * s;
    p.vy = dir.y * s + 2;
    p.vz = dir.z * s;
    p.size0 = rand(0.01, 0.02);
    p.life = rand(0.3, 0.6);
    ramp(p, "#ffffff", color, 2.8, 1);
    commitParticle();
  }
  // The soul leaving: bright streaks straight up.
  for (let i = 0; i < 2; i++) {
    const p = place(beginParticle("spark"), x + rand(-0.1, 0.1), y, z + rand(-0.1, 0.1));
    p.vy = rand(7, 10) * Math.sqrt(scale);
    p.gravity = 0;
    p.drag = 2.2;
    p.stretch = 0.06;
    p.size0 = 0.018 * scale;
    p.size1 = 0.008;
    p.life = 0.5;
    ramp(p, color, color, 2.2, 1, 0.35);
    commitParticle();
  }
}

/** A prop breaking: tumbling lit chunks that bounce and settle, and a puff
 * of dust. `colors` are the material's shard colours. */
export function shatterFx(position: Vec3Like, colors: readonly string[], scale = 1): void {
  readVec(position, at);
  const { x, y, z } = at;
  for (let i = 0, n = budget(24 * scale); i < n; i++) {
    randomUnit(dir);
    const s = rand(1.8, 5.5);
    const p = place(beginParticle("shard"), x + dir.x * 0.2, y + dir.y * 0.2, z + dir.z * 0.2);
    p.vx = dir.x * s;
    p.vy = Math.abs(dir.y) * s + rand(1.5, 3.5);
    p.vz = dir.z * s;
    p.size0 = rand(0.022, 0.055) * scale;
    p.size1 = p.size0 * 0.4;
    p.life = rand(1.2, 2.2);
    const c = colors[(Math.random() * colors.length) | 0];
    ramp(p, c, c, 1.4, 1.2);
    commitParticle();
  }
  for (let i = 0, n = budget(7 * scale); i < n; i++) {
    randomUnit(dir);
    const p = place(beginParticle("smoke"), x + dir.x * 0.2, y + dir.y * 0.15, z + dir.z * 0.2);
    p.vx = dir.x * 1.1;
    p.vy = Math.abs(dir.y) * 0.6 + 0.25;
    p.vz = dir.z * 1.1;
    p.size0 = 0.08 * scale;
    p.size1 = rand(0.22, 0.34) * scale;
    p.life = rand(0.8, 1.4);
    p.alpha = 0.6;
    ramp(p, "#6e6152", "#2a2622", 1, 1);
    commitParticle();
  }
}

// ── The wizard's body ───────────────────────────────────────────────────────

/** Dust kicked up at the feet (`position` = the feet). `strength` ~ 0.5 for a
 * jump, 1 for a hard landing. Puffs roll outward along the floor. */
export function dustPuffFx(position: Vec3Like, strength = 1): void {
  readVec(position, at);
  const { x, y, z } = at;
  for (let i = 0, n = budget(5 + 8 * strength); i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = rand(1, 2.6) * (0.5 + strength * 0.5);
    const p = place(beginParticle("smoke"), x + Math.cos(a) * 0.25, y + 0.05, z + Math.sin(a) * 0.25);
    p.vx = Math.cos(a) * s;
    p.vz = Math.sin(a) * s;
    p.vy = rand(0.15, 0.5);
    p.drag = 4;
    p.gravity = 0.1;
    p.size0 = 0.05;
    p.size1 = rand(0.12, 0.22) * (0.7 + strength * 0.3);
    p.life = rand(0.5, 0.95);
    p.alpha = 0.55 + 0.15 * strength;
    ramp(p, "#7a6b5a", "#2e2923", 1, 1);
    commitParticle();
  }
  for (let i = 0, n = budget(Math.round(5 * strength)); i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const p = place(beginParticle("pixel"), x, y + 0.05, z);
    p.vx = Math.cos(a) * rand(0.8, 2);
    p.vz = Math.sin(a) * rand(0.8, 2);
    p.vy = rand(1.5, 3);
    p.size0 = rand(0.012, 0.025);
    p.size1 = 0;
    p.life = rand(0.4, 0.7);
    ramp(p, "#4a4038", "#4a4038", 1, 1);
    commitParticle();
  }
}

/** The double jump: a rune circle flashes under the feet and throws sparks
 * down — the "stepped on air" read. */
export function runeBurstFx(feet: Vec3Like, color: string): void {
  readVec(feet, at);
  const { x, y, z } = at;
  commit(ring(x, y, z, UP, 0.15, 1.05, 0.38, 0.14, color, 2.4, 1));
  commit(ring(x, y, z, UP, 0.1, 0.6, 0.55, 0.28, color, 1.6, 0.8));
  // Glyph points around the circle.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const p = place(beginParticle("flare"), x + Math.cos(a) * 0.5, y, z + Math.sin(a) * 0.5);
    p.vx = Math.cos(a) * 1.4;
    p.vz = Math.sin(a) * 1.4;
    p.vy = -0.8;
    p.drag = 3;
    p.size0 = 0.04;
    p.size1 = 0.07;
    p.life = 0.35;
    ramp(p, color, color, 2.6, 1.2, 0.5);
    commitParticle();
  }
  for (let i = 0, n = budget(16); i < n; i++) {
    randomInCone(0, -1, 0, 0.8, dir);
    const s = rand(2.5, 5.5);
    const p = place(beginParticle("spark"), x, y, z);
    p.vx = dir.x * s;
    p.vy = dir.y * s;
    p.vz = dir.z * s;
    p.gravity = -8;
    p.size0 = 0.011;
    p.life = rand(0.2, 0.4);
    ramp(p, "#ffffff", color, 2.6, 1);
    commitParticle();
  }
}

/** The blink dash: speed lines streaming past the eyes (world-space streaks
 * laid ahead along the dash, moving slower than the wizard, so they pour
 * backward past the camera) and an afterimage left where the dash began. */
export function dashFx(eye: Vec3Like, direction: Vec3Like, color: string): void {
  readVec(eye, at);
  readVec(direction, dir);
  const l = Math.hypot(dir.x, dir.y, dir.z) || 1;
  const dx = dir.x / l;
  const dy = dir.y / l;
  const dz = dir.z / l;
  // Perpendicular basis around the dash direction.
  let px = -dz;
  let pz = dx;
  const pl = Math.hypot(px, pz) || 1;
  px /= pl;
  pz /= pl;
  for (let i = 0, n = budget(22); i < n; i++) {
    const ahead = rand(1.2, 7);
    const a = Math.random() * Math.PI * 2;
    const r = rand(0.55, 1.7);
    // Lateral offset in the (perp, up) plane.
    const ox = px * Math.cos(a) * r;
    const oz = pz * Math.cos(a) * r;
    const oy = Math.sin(a) * r * 0.8;
    const p = place(beginParticle("spark"), at.x + dx * ahead + ox, at.y + dy * ahead + oy, at.z + dz * ahead + oz);
    const s = rand(9, 14);
    p.vx = dx * s;
    p.vy = dy * s;
    p.vz = dz * s;
    p.gravity = 0;
    p.drag = 0;
    p.stretch = 0.05;
    p.size0 = rand(0.012, 0.022);
    p.size1 = p.size0;
    p.alpha = 0.8;
    p.life = rand(0.16, 0.28);
    ramp(p, color, color, 2.4, 1.2, 0.5);
    commitParticle();
  }
  // Afterimage: a ghostly column of light where the body was.
  for (let i = 0, n = budget(10); i < n; i++) {
    const p = place(beginParticle("soul"), at.x + rand(-0.2, 0.2), at.y - rand(0.3, 1.5), at.z + rand(-0.2, 0.2));
    p.vx = -dx * rand(0.5, 1.5);
    p.vz = -dz * rand(0.5, 1.5);
    p.vy = rand(0, 0.5);
    p.gravity = 1;
    p.size0 = rand(0.03, 0.06);
    p.life = rand(0.35, 0.6);
    ramp(p, color, color, 1.6, 0.5, 0.3);
    commitParticle();
  }
}

/** Hover boots holding the wizard up: soft wisps shed downward. */
export function hoverWispFx(feet: Vec3Like, color: string): void {
  readVec(feet, at);
  for (let i = 0, n = budget(2); i < n; i++) {
    const p = place(beginParticle("glow"), at.x + rand(-0.2, 0.2), at.y, at.z + rand(-0.2, 0.2));
    p.vx = rand(-0.4, 0.4);
    p.vy = rand(-1.6, -0.8);
    p.vz = rand(-0.4, 0.4);
    p.drag = 1.5;
    p.size0 = rand(0.02, 0.035);
    p.size1 = 0.008;
    p.life = rand(0.35, 0.55);
    ramp(p, color, color, 1.8, 0.6, 0.3);
    commitParticle();
  }
}

// ── The world ───────────────────────────────────────────────────────────────

/** What a torch sheds around its shader flame (Flames.tsx), called from its
 * frame loop with its own clocks: rising embers, a thin lit smoke thread,
 * and now and then a popping spark. `top` is the flame's tip. */
export function torchEmberFx(top: Vec3Like, color: string): void {
  readVec(top, at);
  if (budget(1) <= 0) return;
  const p = place(beginParticle("ember"), at.x + rand(-0.05, 0.05), at.y, at.z + rand(-0.05, 0.05));
  p.vx = rand(-0.25, 0.25);
  p.vy = rand(0.5, 1.1);
  p.vz = rand(-0.25, 0.25);
  p.size0 = rand(0.007, 0.013);
  p.life = rand(1, 1.9);
  ramp(p, "#ffe2b8", color, 2.6, 0.9, 0);
  commitParticle();
}

export function torchSmokeFx(top: Vec3Like): void {
  readVec(top, at);
  if (budget(1) <= 0) return;
  const p = place(beginParticle("smoke"), at.x, at.y + 0.1, at.z);
  p.vx = rand(-0.08, 0.08);
  p.vy = rand(0.35, 0.55);
  p.vz = rand(-0.08, 0.08);
  p.drag = 0.4;
  p.gravity = 0.05;
  p.size0 = 0.03;
  p.size1 = rand(0.1, 0.16);
  p.life = rand(1.6, 2.4);
  p.alpha = 0.42;
  ramp(p, "#2c2622", "#161412", 1, 1);
  commitParticle();
}

export function torchSparkFx(top: Vec3Like, color: string): void {
  readVec(top, at);
  for (let i = 0, n = budget(3); i < n; i++) {
    randomInCone(0, 1, 0, 0.7, dir);
    const s = rand(1.4, 2.6);
    const p = place(beginParticle("spark"), at.x, at.y - 0.1, at.z);
    p.vx = dir.x * s;
    p.vy = dir.y * s;
    p.vz = dir.z * s;
    p.gravity = -5;
    p.drag = 1;
    p.size0 = 0.008;
    p.life = rand(0.35, 0.6);
    ramp(p, "#fff4d6", color, 2.8, 1.2);
    commitParticle();
  }
}

/** A slam about to land: a warning circle at the blast radius on the floor
 * and a second ring contracting from it into the caster — it reads as
 * power being drawn in. Lasts `duration` (the telegraph). */
export function telegraphFx(center: Vec3Like, radius: number, color: string, duration: number): void {
  readVec(center, at);
  const gy = GROUND_Y + 0.07;
  const warn = ring(at.x, gy, at.z, UP, radius, radius * 1.02, duration, 0.05, color, 2.6, 0.9);
  warn.size1 = radius; // constant-radius warning line
  commitParticle();
  commit(ring(at.x, gy, at.z, UP, radius, 0.4, duration, 0.08, color, 2, 0.7));
  // Sparks rising off the circle.
  for (let i = 0, n = budget(40); i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const p = place(beginParticle("ember"), at.x + Math.cos(a) * radius, gy, at.z + Math.sin(a) * radius);
    p.vx = -Math.cos(a) * rand(0.5, 1.5);
    p.vz = -Math.sin(a) * rand(0.5, 1.5);
    p.vy = rand(0.8, 2.2);
    p.size0 = rand(0.014, 0.024);
    p.life = duration + rand(0, 0.3);
    ramp(p, "#ffd9a8", color, 2.6, 1);
    commitParticle();
  }
}

/** Spike trap bite: steel sparks and a spatter. */
export function spikeFx(position: Vec3Like): void {
  readVec(position, at);
  for (let i = 0, n = budget(12); i < n; i++) {
    randomInCone(0, 1, 0, 0.9, dir);
    const s = rand(2.5, 5.5);
    const p = place(beginParticle("spark"), at.x + rand(-0.25, 0.25), at.y, at.z + rand(-0.25, 0.25));
    p.vx = dir.x * s;
    p.vy = dir.y * s;
    p.vz = dir.z * s;
    p.size0 = 0.01;
    p.life = rand(0.2, 0.4);
    ramp(p, "#ffffff", "#ffb35a", 2.4, 1);
    commitParticle();
  }
  for (let i = 0, n = budget(10); i < n; i++) {
    randomInCone(0, 1, 0, 1, dir);
    const p = place(beginParticle("pixel"), at.x, at.y + 0.2, at.z);
    const s = rand(1.5, 3.5);
    p.vx = dir.x * s;
    p.vy = dir.y * s;
    p.vz = dir.z * s;
    p.size0 = rand(0.015, 0.03);
    p.size1 = 0;
    p.life = rand(0.4, 0.7);
    ramp(p, "#b3202a", "#5a0a10", 1, 1);
    commitParticle();
  }
}

/** Warp sigil firing: a column of light and souls pulling the wizard down. */
export function warpFx(position: Vec3Like, color: string): void {
  readVec(position, at);
  const { x, y, z } = at;
  commit(ring(x, y + 0.05, z, UP, 0.3, 2.4, 0.6, 0.1, color, 2.6, 1));
  commit(ring(x, y + 0.05, z, UP, 2, 0.2, 0.5, 0.14, color, 2, 0.8));
  commit(flash("flare", x, y + 0.8, z, 0.3, 1.4, 0.25, color, 3, 0.8));
  for (let i = 0, n = budget(48); i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = rand(0.2, 0.9);
    const p = place(beginParticle("soul"), x + Math.cos(a) * r, y + rand(0, 0.4), z + Math.sin(a) * r);
    p.vx = -Math.cos(a) * 0.4;
    p.vz = -Math.sin(a) * 0.4;
    p.vy = rand(2, 5);
    p.size0 = rand(0.018, 0.04);
    p.life = rand(0.6, 1.2);
    ramp(p, color, color, 2.4, 0.8, 0.4);
    commitParticle();
  }
}

/** A single slow mote rising off something magical (runes, graves, souls).
 * The emitter jitters its own spawn point. */
export function moteFx(position: Vec3Like, color: string, opts?: { rise?: number; size?: number; life?: number; style?: ParticleStyle }): void {
  readVec(position, at);
  if (budget(1) <= 0) return;
  const p = place(beginParticle(opts?.style ?? "mote"), at.x, at.y, at.z);
  p.vx = rand(-0.12, 0.12);
  p.vy = (opts?.rise ?? 0.45) * rand(0.6, 1.2);
  p.vz = rand(-0.12, 0.12);
  p.gravity = 0.15;
  // Sizes are a mote's nominal width; at pixel scale it draws as a 1–3 px
  // speck with a 1-px halo, so it's spent at a little over half that.
  p.size0 = (opts?.size ?? 0.035) * 0.55 * rand(0.7, 1.3);
  p.life = (opts?.life ?? 1.6) * rand(0.8, 1.2);
  ramp(p, color, color, 2.2, 1, 0.35);
  commitParticle();
}

/** A burst of rising soul-light (a grave looted, a rune read). */
export function soulRiseFx(position: Vec3Like, color: string, count = 16): void {
  readVec(position, at);
  commit(flash("glow", at.x, at.y, at.z, 0.08, 0.18, 0.22, color, 2.2, 0.6));
  commit(flash("flare", at.x, at.y, at.z, 0.15, 0.45, 0.2, color, 2.2, 0.6));
  for (let i = 0, n = budget(Math.round(count * 1.5)); i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = rand(0, 0.45);
    const p = place(beginParticle("soul"), at.x + Math.cos(a) * r, at.y + rand(-0.2, 0.2), at.z + Math.sin(a) * r);
    p.vx = Math.cos(a) * rand(0.2, 0.8);
    p.vz = Math.sin(a) * rand(0.2, 0.8);
    p.vy = rand(0.6, 1.8);
    p.size0 = rand(0.016, 0.034);
    p.life = rand(0.9, 1.6);
    ramp(p, color, color, 2.2, 0.7, 0.4);
    commitParticle();
  }
}

/** Heavy charge-up puff (the Warden launching into a charge). */
export function chargeBurstFx(position: Vec3Like, direction: Vec3Like, color: string): void {
  readVec(position, at);
  readVec(direction, dir);
  const l = Math.hypot(dir.x, dir.y, dir.z) || 1;
  for (let i = 0, n = budget(30); i < n; i++) {
    randomInCone(-dir.x / l, -dir.y / l, -dir.z / l, 0.6, tmp);
    const s = rand(4, 9);
    const p = place(beginParticle("spark"), at.x, at.y, at.z);
    p.vx = tmp.x * s;
    p.vy = tmp.y * s;
    p.vz = tmp.z * s;
    p.size0 = rand(0.014, 0.026);
    p.life = rand(0.25, 0.5);
    ramp(p, "#ffd9a8", color, 2.8, 1.2);
    commitParticle();
  }
  commit(ring(at.x, at.y, at.z, null, 0.4, 2.4, 0.3, 0.08, color, 2.2, 0.9));
}

// Dev-only hook for screenshot/e2e scripts: fire any effect by name.
if (typeof window !== "undefined" && import.meta.env?.DEV) {
  (window as unknown as Record<string, unknown>).__fx = {
    explosionFx,
    shockwaveFx,
    castFlareFx,
    boltTrailFx,
    voidSeedFx,
    blackHoleFx,
    collapseFlashFx,
    hitSparksFx,
    soulDissolveFx,
    shatterFx,
    dustPuffFx,
    runeBurstFx,
    dashFx,
    hoverWispFx,
    torchEmberFx,
    torchSmokeFx,
    torchSparkFx,
    telegraphFx,
    spikeFx,
    warpFx,
    moteFx,
    soulRiseFx,
    chargeBurstFx,
  };
}
