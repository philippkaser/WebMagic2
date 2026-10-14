import type { EnemyId } from "../roster";

/** Deaths with weight: what a body does in the second after it dies. The
 * kill hands the body's pose to a pooled corpse (corpsePool.ts) that lives
 * on after the RigidBody, collider and hittable are gone — gameplay is over
 * the instant the host says so; this is the show.
 *
 *  - Wisp — swells white-hot, then implodes in a spin and POPS.
 *  - Shadow — stretches up and unravels into smoke while its two eyes hang
 *    in the air a heartbeat longer, then blink out one by one.
 *  - Slime — stretches, then splats flat into a puddle that lingers and
 *    dithers away (its children squeeze out of it).
 *  - Sentry — its crystal head is blown off along the killing blow, bounces
 *    once on the stone and shatters; the plinth darkens and sinks.
 *  - Warden — hangs, its spin stuttering, sheds its three shards in blasts,
 *    then its core goes critical.
 *
 * Overkill flings the body (a rail through a wisp throws it across the
 * room); a big enough overkill skips the build-up and goes straight to the
 * pop. Every client plays the same death from the host's death note (the
 * killing blow's direction and overkill share).
 *
 * Pure numbers, allocation-free: a CorpseState is stepped in place and
 * carries its own pose; cues (the pop, the splat, a shard's blast) go out
 * through a callback so the shell can light them up. Tested in
 * corpseScripts.test.ts. */

export const CUE = {
  /** THE death beat: the burst, the soul rising, the kill light, the floor's splat. */
  main: 0,
  /** The sentry's head is blown off. */
  crack: 1,
  /** The sentry's head hits the stone. */
  bounce: 2,
  /** One of the Warden's shards is flung off (arg: which). */
  shard: 3,
} as const;

export type CueSink = (c: CorpseState, cue: number, x: number, y: number, z: number, arg: number) => void;

/** Overkill (share of max hp) at or past which the build-up is skipped. */
export const GIB_OVER = 0.5;
const FLOOR = 0;
const GRAVITY = -14;

/** How long each death plays (s). */
export const DURATION: Record<EnemyId, number> = { wisp: 0.3, shadow: 0.85, slime: 1.4, sentry: 1.5, boss: 2.3 };

/** When the Warden's shards fly, and when its core goes critical. */
export const WARDEN_SHARD_AT = [0.3, 0.7, 1.1] as const;
export const WARDEN_FINAL_AT = 2.0;

export interface CorpseInit {
  kind: EnemyId;
  x: number;
  y: number;
  z: number;
  /** Facing (the shadow's eyes, the sentry's head). */
  yaw: number;
  /** Body size (a slime generation's scale; 1 otherwise). */
  size: number;
  /** The killing blow's planar direction, or null. */
  dir: [number, number] | null;
  over: number;
  seed: number;
}

export class CorpseState {
  kind: EnemyId = "wisp";
  live = false;
  t = 0;
  dur = 0;
  gib = false;
  seed = 0;
  // Origin and the blow.
  x0 = 0;
  y0 = 0;
  z0 = 0;
  size = 1;
  dx = 0;
  dz = 0;
  over = 0;
  /** Bitmask of fired one-shot cues. */
  fired = 0;
  // The body: where it is (drifting if flung) and its pose.
  x = 0;
  y = 0;
  z = 0;
  vx = 0;
  vy = 0;
  vz = 0;
  yaw = 0;
  rx = 0;
  rz = 0;
  sx = 1;
  sy = 1;
  sz = 1;
  /** 0…1 toward pure white, emissive intensity (absolute, like `pglow` for
   * the part), coverage (1 solid → 0 gone). */
  white = 0;
  glow = 1;
  fade = 1;
  /** Shake (m) on top of the body. */
  shiver = 0;
  /** Smoke trailing off it, particles/s. */
  smoke = 0;
  /** The sentry's plinth darkening 0…1. */
  dark = 0;
  // A flying part: the sentry's head, the shadow's eyes.
  px = 0;
  py = 0;
  pz = 0;
  pvx = 0;
  pvy = 0;
  pvz = 0;
  prx = 0;
  pry = 0;
  prz = 0;
  pspinX = 0;
  pspinZ = 0;
  pfade = 1;
  pglow = 1;
  bounces = 0;
  /** Each eye's brightness (the shadow's blink out one at a time). */
  eye0 = 1;
  eye1 = 1;
  /** The Warden's shards: x, y, z, vx, vy, vz, fade per shard. */
  readonly shards = new Float64Array(21);
  /** The shell's own word on this death (its colours and bursts). */
  tag: unknown = null;
}

/** Deterministic 0…1 from a seed and a salt. */
function rnd(seed: number, salt: number): number {
  const s = Math.sin(seed * 9301.17 + salt * 49297.31) * 43758.5453;
  return s - Math.floor(s);
}

const easeOut = (k: number) => 1 - (1 - k) * (1 - k);
const easeIn = (k: number) => k * k;
const clamp01 = (k: number) => (k < 0 ? 0 : k > 1 ? 1 : k);

/** (Re)start `c` as a fresh death. */
export function startCorpse(c: CorpseState, init: CorpseInit): CorpseState {
  c.kind = init.kind;
  c.live = true;
  c.t = 0;
  c.seed = init.seed;
  c.over = Math.max(0, Math.min(4, Number.isFinite(init.over) ? init.over : 0));
  c.gib = c.over >= GIB_OVER && (init.kind === "wisp" || init.kind === "shadow" || init.kind === "slime");
  c.dur = DURATION[init.kind] * (c.gib ? (init.kind === "slime" ? 0.7 : 0.35) : 1);
  c.x0 = c.x = init.x;
  c.y0 = c.y = init.y;
  c.z0 = c.z = init.z;
  c.size = init.size;
  c.yaw = init.yaw;
  c.rx = c.rz = 0;
  c.sx = c.sy = c.sz = 1;
  c.white = 0;
  c.glow = 1;
  c.fade = 1;
  c.shiver = 0;
  c.smoke = 0;
  c.dark = 0;
  c.fired = 0;
  c.bounces = 0;
  c.eye0 = c.eye1 = 1;
  c.pfade = 1;
  c.pglow = 1;
  if (init.dir) {
    c.dx = init.dir[0];
    c.dz = init.dir[1];
  } else {
    // No word on the blow: fall a random way (seeded, so it's this body's way).
    const a = rnd(init.seed, 1) * Math.PI * 2;
    c.dx = Math.cos(a);
    c.dz = Math.sin(a);
  }
  const fling = init.dir ? 1.5 + 7 * c.over : 0.6;
  c.vx = c.vy = c.vz = 0;
  if (c.kind === "wisp") {
    c.vx = c.dx * fling;
    c.vz = c.dz * fling;
    c.vy = 1.5;
  } else if (c.kind === "shadow") {
    c.vx = c.dx * fling * 0.45;
    c.vz = c.dz * fling * 0.45;
  }
  if (c.kind === "sentry") {
    // The head comes off along the blow, tumbling.
    c.px = c.x0;
    c.py = c.y0 + 1.05;
    c.pz = c.z0;
    // Modest: the corpse knows nothing of walls, so the head must land in the room.
    const kick = 1.5 + 3 * Math.min(c.over, 1);
    c.pvx = c.dx * kick;
    c.pvy = 3.5 + 1.5 * rnd(init.seed, 2);
    c.pvz = c.dz * kick;
    c.prx = c.prz = 0;
    c.pry = c.yaw;
    c.pspinX = (rnd(init.seed, 3) - 0.5) * 18;
    c.pspinZ = (rnd(init.seed, 4) - 0.5) * 18;
  } else if (c.kind === "shadow") {
    // The eyes stay where they were — it's the body that goes.
    c.px = c.x0 + Math.sin(c.yaw) * 0.34;
    c.py = c.y0 + 0.06;
    c.pz = c.z0 + Math.cos(c.yaw) * 0.34;
    c.pry = c.yaw;
  } else if (c.kind === "boss") {
    for (let i = 0; i < 3; i++) {
      const o = i * 7;
      c.shards[o + 6] = 1;
    }
  }
  return c;
}

/** The Warden's shard `i` at rest on its ring (render/models/enemies#WARDEN_SHARDS), turned by `yaw`. */
function shardHome(c: CorpseState, i: number, yaw: number, out: Float64Array, o: number): void {
  const a = (i / 3) * Math.PI * 2;
  const lx = Math.cos(a) * 1.7;
  const lz = Math.sin(a) * 1.7;
  const cs = Math.cos(yaw);
  const sn = Math.sin(yaw);
  out[o] = c.x + lx * cs + lz * sn;
  out[o + 1] = c.y + Math.sin(i * 2.1) * 0.4;
  out[o + 2] = c.z - lx * sn + lz * cs;
}

function once(c: CorpseState, bit: number): boolean {
  if (c.fired & (1 << bit)) return false;
  c.fired |= 1 << bit;
  return true;
}

/** Advance a death by `dt` (the presentation clock's — hitstop holds a
 * corpse mid-implode). Fires each cue exactly once. Returns whether it is
 * still playing; a finished corpse is `live = false`. */
export function stepCorpse(c: CorpseState, dt: number, onCue: CueSink): boolean {
  if (!c.live) return false;
  if (dt <= 0) return true;
  c.t += dt;
  const t = c.t;
  // Drift (a flung body), with air drag; it never sinks through the floor.
  const drag = Math.exp(-3 * dt);
  c.vx *= drag;
  c.vz *= drag;
  c.vy = c.vy * drag;
  c.x += c.vx * dt;
  c.y = Math.max(FLOOR + 0.25 * c.size, c.y + c.vy * dt);
  c.z += c.vz * dt;

  switch (c.kind) {
    case "wisp":
      stepWisp(c, dt, onCue);
      break;
    case "shadow":
      stepShadow(c, onCue);
      break;
    case "slime":
      stepSlime(c, onCue);
      break;
    case "sentry":
      stepSentry(c, dt, onCue);
      break;
    case "boss":
      stepWarden(c, dt, onCue);
      break;
  }
  if (t >= c.dur) {
    c.live = false;
    c.fade = 0;
    c.pfade = 0;
  }
  return c.live;
}

function stepWisp(c: CorpseState, dt: number, onCue: CueSink): void {
  const swell = c.gib ? 0 : 0.06;
  const t = c.t;
  c.white = 1;
  if (t < swell) {
    const s = 1 + 0.25 * easeOut(t / swell);
    c.sx = c.sy = c.sz = s;
    c.glow = 6;
  } else {
    const k = clamp01((t - swell) / Math.max(1e-3, c.dur - swell));
    const s = 0.08 + 1.17 * (1 - k) * (1 - k);
    c.sx = c.sz = s;
    c.sy = s * (1 + 0.4 * k); // pulled into a sliver as it goes
    c.yaw += dt * (6 + 26 * k);
    c.glow = 6 + 6 * k;
  }
  if (t >= c.dur && once(c, CUE.main)) onCue(c, CUE.main, c.x, c.y, c.z, 0);
}

function stepShadow(c: CorpseState, onCue: CueSink): void {
  const t = c.t;
  const k = clamp01(t / c.dur);
  if (t >= 0.04 && once(c, CUE.main)) onCue(c, CUE.main, c.x, c.y, c.z, 0);
  // Freezes, then stretches up and comes apart as it sinks.
  const sy = 1 + 0.65 * easeOut(clamp01(t / 0.18));
  const w = (1 / Math.sqrt(sy)) * (1 - 0.35 * k);
  c.sx = c.sz = w;
  c.sy = sy;
  c.y = Math.max(FLOOR + 0.2, c.y0 - 0.45 * k * k);
  c.white = Math.max(0, 0.7 - t * 5);
  c.glow = 1.6 * (1 - k);
  c.fade = t < 0.1 ? 1 : 1 - clamp01((t - 0.1) / (c.dur * 0.75 - 0.1));
  c.smoke = c.fade > 0.05 ? 45 : 0;
  // The eyes hang in the air, flaring, then go out one by one.
  const eyesOut = c.dur * 0.65;
  c.pglow = 3 * (1 + 2.5 * (1 - k));
  c.eye0 = t < eyesOut ? 1 : 0;
  c.eye1 = t < eyesOut + c.dur * 0.15 ? 1 : 0;
  c.pfade = c.eye0 + c.eye1 > 0 ? 1 : 0;
}

function stepSlime(c: CorpseState, onCue: CueSink): void {
  const t = c.t;
  const r = 0.5 * c.size;
  const up = c.gib ? 0 : 0.06;
  const flat = up + 0.1;
  if (t < up) {
    const sy = 1 + 0.3 * (t / up);
    c.sy = sy;
    c.sx = c.sz = 1 / Math.sqrt(sy);
    c.white = 0.8;
  } else if (t < flat) {
    const k = easeIn((t - up) / (flat - up));
    c.sy = 1.3 + (0.15 - 1.3) * k;
    c.sx = c.sz = 0.88 + (1.8 - 0.88) * k;
    c.y = c.y0 + (FLOOR + r * c.sy - c.y0) * k;
    c.white = 0.4 * (1 - k);
  } else {
    if (once(c, CUE.main)) onCue(c, CUE.main, c.x, FLOOR + 0.05, c.z, 0);
    // The puddle lingers, flattening, and dithers away.
    const k = clamp01((t - flat) / Math.max(1e-3, c.dur - flat));
    c.sy = 0.15 - 0.07 * k;
    c.sx = c.sz = 1.8 + 0.25 * k;
    c.y = FLOOR + r * c.sy;
    c.white = 0;
    c.fade = 1 - clamp01((k - 0.35) / 0.65);
  }
  c.glow = 1 - 0.6 * clamp01(t / c.dur);
}

function stepSentry(c: CorpseState, dt: number, onCue: CueSink): void {
  const t = c.t;
  if (once(c, CUE.crack)) onCue(c, CUE.crack, c.px, c.py, c.pz, 0);
  // The plinth darkens and sinks a little, then crumbles away.
  c.dark = clamp01(t / 0.5);
  c.y = c.y0 - 0.15 * c.dark;
  c.fade = 1 - clamp01((t - c.dur + 0.5) / 0.5);
  c.glow = 0;
  // The head: ballistic, tumbling, a bounce, then it shatters.
  if (!(c.fired & (1 << CUE.main))) {
    c.pvy += GRAVITY * dt;
    c.px += c.pvx * dt;
    c.py += c.pvy * dt;
    c.pz += c.pvz * dt;
    c.prx += c.pspinX * dt;
    c.prz += c.pspinZ * dt;
    const rest = FLOOR + 0.24;
    if (c.py < rest && c.pvy < 0) {
      c.py = rest;
      c.bounces++;
      if (c.bounces === 1) {
        onCue(c, CUE.bounce, c.px, c.py, c.pz, 0);
        c.pvy = -c.pvy * 0.42;
        c.pvx *= 0.6;
        c.pvz *= 0.6;
        c.pspinX *= 0.5;
        c.pspinZ *= 0.5;
      }
    }
    if (c.bounces >= 2 || t > 1.1) {
      c.fired |= 1 << CUE.main;
      c.pfade = 0;
      onCue(c, CUE.main, c.px, c.py, c.pz, 0);
    }
  }
  c.white = 0;
  c.pglow = t < 0.08 ? 8 : 2 + 4 * Math.max(0, 1 - t);
}

function stepWarden(c: CorpseState, dt: number, onCue: CueSink): void {
  const t = c.t;
  const toFinal = clamp01(t / WARDEN_FINAL_AT);
  // It hangs, sagging; its spin stutters; it swells and blanches toward the end.
  c.y = c.y0 - 0.3 * toFinal;
  c.yaw += dt * (Math.sin(t * 23) > 0.3 ? 1.4 : -0.6);
  const swell = 1 + 0.15 * easeIn(toFinal);
  c.sx = c.sy = c.sz = swell;
  c.white = easeIn(toFinal);
  c.glow = 1.3 + 7 * toFinal + (Math.sin(t * 41) > 0 ? 1.5 * toFinal : 0);
  c.shiver = 0.03 + 0.08 * toFinal;
  c.fade = t < WARDEN_FINAL_AT ? 1 : 0;
  const s = c.shards;
  for (let i = 0; i < 3; i++) {
    const o = i * 7;
    if (t < WARDEN_SHARD_AT[i]) {
      shardHome(c, i, c.yaw, s, o);
      continue;
    }
    if (once(c, 8 + i)) {
      // Flung off its ring, up and out.
      shardHome(c, i, c.yaw, s, o);
      const ox = s[o] - c.x;
      const oz = s[o + 2] - c.z;
      const l = Math.hypot(ox, oz) || 1;
      s[o + 3] = (ox / l) * 7;
      s[o + 4] = 4;
      s[o + 5] = (oz / l) * 7;
      onCue(c, CUE.shard, s[o], s[o + 1], s[o + 2], i);
    }
    s[o + 4] += GRAVITY * dt;
    s[o] += s[o + 3] * dt;
    s[o + 1] += s[o + 4] * dt;
    s[o + 2] += s[o + 5] * dt;
    if (s[o + 1] < FLOOR + 0.15 && s[o + 4] < 0) {
      s[o + 1] = FLOOR + 0.15;
      s[o + 4] = -s[o + 4] * 0.35;
      s[o + 3] *= 0.5;
      s[o + 5] *= 0.5;
    }
    s[o + 6] = 1 - clamp01((t - WARDEN_SHARD_AT[i] - 0.5) / 0.6);
  }
  if (t >= WARDEN_FINAL_AT && once(c, CUE.main)) onCue(c, CUE.main, c.x, c.y, c.z, 0);
}
