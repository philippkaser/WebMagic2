import { Euler, Quaternion, Vector3, type Group, type MeshStandardMaterial } from "three";
import { isEnemyVoice, playEnemyBreak, playEnemyHurt, playEnemyWindup } from "../audio/voices";
import { breakStop } from "../combat/shooter";
import { presentScale } from "../core/presentTime";
import { flashLight } from "../fx/DynamicLights";
import { breakFx, hitSparksFx, leakFx, type LeakStyle } from "../fx/effects";
import { nearestWizardTo } from "../game/targets";
import { crossedKnee, KNEE } from "../game/vitality";
import { ENEMY_GLOW, ENEMY_HUE, hitFlash } from "../render/models/enemies";
import { ACT, anticipate, createAct, createAnticipation, decodeAct, isWindup } from "./anticipation";
import type { Vec } from "./brains/common";
import { DOOM_TTL } from "./doom";
import { createHitGate, hitStrength, hitTier, passGate, sparkScale } from "./hitFx";
import {
  clearTargets,
  createPose,
  createPuppet,
  emerge,
  faceToward,
  kickHit,
  kickHop,
  kickSquash,
  leanToward,
  OX,
  OY,
  OZ,
  PUPPET,
  puppetPose,
  SC,
  SQ,
  stepPuppet,
  type Puppet,
} from "./puppet";
import type { EnemyId } from "./roster";
import { createWoundLook, woundLook } from "./wounds";
import { woundUniforms } from "./woundShader";

/** The living body: everything a client SHOWS of an enemy, from what it
 * knows — its own blows, the host's word on everyone else's (an hp drop in
 * a snapshot, a quantised direction), the replicated act code. One per
 * enemy, owned by the shell (useEnemy); never decides anything.
 *
 *  - a blow: a white frame, a flinch on the puppet's springs, sparks off the
 *    surface where it landed (gated: one pop per body per 70 ms, damage not
 *    yet shown rides into the next pop), a cry in its own voice;
 *  - the knee (game/vitality.ts): crossing it is a BREAK — a crack of light,
 *    a ring, a stagger, a pained yelp — and from then on it sputters, leaks
 *    and lists (wounds.ts), all from the replicated life so every client
 *    agrees;
 *  - body language: it breathes, faces its prey, and poses its wind-ups
 *    (anticipation.ts) so every player can read what's coming;
 *  - death throes: a blow this client knows was lethal (doom.ts) turns it
 *    rigid and white-hot until the host's despawn arrives.
 *
 * Animation runs on the presentation clock (core/presentTime.ts): hitstop
 * freezes the picture of a body mid-flinch; nothing here touches physics,
 * brains or the network. */

/** What each kind looks like when it's hurt. */
export interface BodyLook {
  /** Its flash material's hue (render/models/enemies#ENEMY_HUE) and resting glow. */
  hue: keyof typeof ENEMY_HUE;
  /** Hit sparks. */
  spark: string;
  /** Its soul's colour (the break's ring, the kill's light). */
  soul: string;
  /** What it leaks once broken. */
  leak: LeakStyle;
  leakColor: string;
  /** Fliers sag as they weaken. */
  flier: boolean;
  /** Centre of the body above its origin (the sentry's crystal). */
  center: number;
}

export const BODY_LOOK: Record<EnemyId, BodyLook> = {
  wisp: { hue: "wisp", spark: "#d9a9ff", soul: "#c89cff", leak: "ember", leakColor: "#c89cff", flier: true, center: 0 },
  shadow: { hue: "shadow", spark: "#8a5cc0", soul: "#9a6aff", leak: "smoke", leakColor: "#2a1a44", flier: true, center: 0 },
  slime: { hue: "slime", spark: "#a8f06a", soul: "#a8f06a", leak: "goo", leakColor: "#7fdc4a", flier: false, center: 0 },
  sentry: { hue: "sentry", spark: "#ff9a5a", soul: "#ff9a5a", leak: "crack", leakColor: "#ff7a4d", flier: false, center: 1.05 },
  boss: { hue: "warden", spark: "#ff8a5a", soul: "#ff3d2e", leak: "molten", leakColor: "#ff3d2e", flier: true, center: 0 },
};

/** A blow as the shell hands it over. One scratch record, reused. */
export interface Blow {
  /** Where it landed (null: somewhere on the surface facing the blow). */
  at: Vec | null;
  /** Planar push direction (unit) — the body flinches along it. */
  dx: number;
  dz: number;
  hasDir: boolean;
  damage: number;
  quiet: boolean;
}

export function createBlow(): Blow {
  return { at: null, dx: 0, dz: 0, hasDir: false, damage: 0, quiet: false };
}

/** The white frame: held ~2 frames at full, one at half (pixel-art steps). */
const WHITE_S = 0.07;
/** Cries at most this often per body (s) — sparks may pop faster. */
const VOICE_GAP = 0.15;
/** How long each wind-up lasts, for its sound (s). */
const WINDUP_S: Record<number, number> = { [ACT.coil]: 0.35, [ACT.brace]: 0.45, [ACT.slam]: 0.6, [ACT.aim]: 0.55 };

const UP = new Vector3(0, 1, 0);
const euler = new Euler();
const qLean = new Quaternion();
const qYaw = new Quaternion();
const spot = { x: 0, y: 0, z: 0 };
const spray = { x: 0, y: 0, z: 0 };

/** 0…1 hash of an id: desyncs neighbours' breathing, flicker and limp side. */
function seedOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10007) / 10007;
}

export class LiveBody {
  readonly look: BodyLook;
  readonly puppet: Puppet;
  readonly pose = createPose();
  readonly wound = createWoundLook();
  readonly act = createAct();
  readonly ant = createAnticipation();
  readonly seed: number;
  /** Hit flash 1 → 0 (the shell's ref, so a kind can light it: the Warden's slam). */
  flash: { current: number };
  /** The life this client believes (the host's, or our prediction of it). */
  life: number;
  /** The knee's break has been shown. */
  broke = false;
  /** Death throes started at (s), or −∞. */
  doomedAt = -Infinity;
  /** A kind's own pose on top (slime squash from its hop), before the step. */
  posture: ((p: Puppet) => void) | null = null;
  /** A kind's own tell when an act begins (the Warden's slam circle). */
  onAct: ((code: number, progress: number, pos: Vec) => void) | null = null;

  private white = 0;
  private readonly gate = createHitGate();
  private voiceAt = -Infinity;
  private leakAcc = 0;
  private frameNo: number;
  private lastActCode: number = ACT.idle;

  constructor(
    readonly kind: EnemyId,
    id: string,
    readonly maxHp: number,
    /** Body radius (sparks fly off the surface this far out). */
    readonly radius: number,
    flash: { current: number },
    private readonly flashDecay = 5,
  ) {
    this.look = BODY_LOOK[kind];
    this.seed = seedOf(id);
    this.puppet = createPuppet(PUPPET[kind], this.seed * Math.PI * 2);
    this.flash = flash;
    this.life = maxHp;
    this.frameNo = Math.floor(this.seed * 4);
  }

  /** Real life left, 0…1. */
  get frac(): number {
    return Math.max(0, this.life / this.maxHp);
  }

  get doomed(): boolean {
    return performance.now() / 1000 - this.doomedAt < DOOM_TTL;
  }

  /** Born small and springing up (a slime squeezing out of its parent). */
  emerge(from = 0.3): void {
    emerge(this.puppet, from);
  }

  /** Noticed you: a hop of fright and a squash. */
  startle(): void {
    kickHop(this.puppet, 0.25);
    kickSquash(this.puppet, -0.25);
    this.flash.current = Math.max(this.flash.current, 0.6);
  }

  /** A blow landed (as this machine knows it). `pos` = the body origin. */
  react(b: Blow, pos: Vec): void {
    if (b.quiet || !(b.damage > 0)) return;
    const now = performance.now() / 1000;
    this.flash.current = 1;
    this.white = WHITE_S;
    let dx = b.dx;
    let dz = b.dz;
    if (!b.hasDir) {
      // No planar push (a strike from above, a replica's undirected drop):
      // flinch away from whoever is nearest.
      const t = nearestWizardTo(pos.x, pos.y, pos.z);
      dx = pos.x - t.pos.x;
      dz = pos.z - t.pos.z;
      const l = Math.hypot(dx, dz) || 1;
      dx /= l;
      dz /= l;
    }
    kickHit(this.puppet, dx, dz, hitStrength(b.damage, this.maxHp));
    const shown = passGate(this.gate, b.damage, now);
    if (shown <= 0) return;
    const at = b.at ?? this.surface(pos, dx, dz);
    // Sparks fly back off the surface toward whoever struck.
    spray.x = -dx;
    spray.y = 0.45;
    spray.z = -dz;
    hitSparksFx(at, this.look.spark, sparkScale(shown, this.maxHp), spray);
    const tier = hitTier(shown, this.maxHp);
    if ((now - this.voiceAt > VOICE_GAP || tier === 2) && isEnemyVoice(this.kind)) {
      this.voiceAt = now;
      playEnemyHurt(this.kind, [at.x, at.y, at.z], tier === 2 ? 1 : tier === 1 ? 0.5 : 0.15);
    }
  }

  /** The point on the body facing a blow travelling along (dx, dz). */
  private surface(pos: Vec, dx: number, dz: number): Vec {
    spot.x = pos.x - dx * this.radius * 0.9;
    spot.y = pos.y + this.look.center + this.pose.y;
    spot.z = pos.z - dz * this.radius * 0.9;
    return spot;
  }

  /** Life changed to `next` (real hp). Crossing the knee is the break beat;
   * `quietly` = a late joiner's first look (it was already broken). */
  lifeTo(next: number, pos: Vec | null, mine = false, quietly = false): void {
    const before = this.life / this.maxHp;
    this.life = next;
    const after = next / this.maxHp;
    if (this.broke || after > KNEE.real) return;
    this.broke = true;
    if (quietly || !pos || !crossedKnee(before, after)) return;
    this.breakBeat(pos, mine);
  }

  private breakBeat(pos: Vec, mine: boolean): void {
    const y = pos.y + this.look.center;
    const scale = this.kind === "boss" ? 2.4 : Math.max(0.7, this.radius / 0.45);
    breakFx([pos.x, y, pos.z], this.look.soul, scale);
    flashLight([pos.x, y, pos.z], "#ffffff", this.kind === "boss" ? 26 : 12, 7);
    // A big stagger on the springs (the host's brain staggers for real).
    kickHit(this.puppet, Math.sin(this.puppet.yaw + Math.PI), Math.cos(this.puppet.yaw + Math.PI), 1);
    kickSquash(this.puppet, -0.4);
    this.white = WHITE_S * 2;
    this.flash.current = 1;
    if (isEnemyVoice(this.kind)) playEnemyBreak(this.kind, [pos.x, y, pos.z]);
    // Our own blow broke it: hold the picture a beat — the shooter's
    // stopper decides how long (a stream's tick never stops it).
    if (mine) breakStop();
  }

  /** Our blow was lethal (as far as we know): death throes until the despawn. */
  doom(): void {
    if (!this.doomed) this.doomedAt = performance.now() / 1000;
  }

  /** The act on the wire (code × 16 + progress step); plays a wind-up's cry on its rising edge. */
  setAct(wire: number, pos: Vec | null): void {
    decodeAct(wire, this.act);
    const code = this.act.code;
    if (code !== this.lastActCode && pos) {
      if (isWindup(code) && isEnemyVoice(this.kind)) {
        const left = (WINDUP_S[code] ?? 0.4) * (1 - this.act.progress);
        playEnemyWindup(this.kind, [pos.x, pos.y + this.look.center, pos.z], left);
      }
      this.onAct?.(code, this.act.progress, pos);
    }
    this.lastActCode = code;
  }

  /** One frame: springs, facing, wounds, wind-up pose, leaks; writes the
   * view group. `dt` is the real frame time (scaled here by the
   * presentation clock). */
  frame(dt: number, pos: Vec, view: Group | null): void {
    const pdt = dt * presentScale();
    const now = performance.now() / 1000;
    const p = this.puppet;
    this.flash.current = Math.max(0, this.flash.current - pdt * this.flashDecay);
    this.white = Math.max(0, this.white - pdt);
    const w = woundLook(this.frac, now, this.seed, this.wound);
    anticipate(this.kind, this.act.code, this.act.progress, this.ant);
    const a = this.ant;

    clearTargets(p);
    const fx = Math.sin(p.yaw);
    const fz = Math.cos(p.yaw);
    if (w.list > 0) {
      // Lists to its own weak side.
      const side = this.seed < 0.5 ? 1 : -1;
      leanToward(p, side * fz, -side * fx, w.list);
      if (this.look.flier) p.t[OY] -= w.sag;
    }
    leanToward(p, fx, fz, a.lean);
    p.t[OX] -= fx * a.back;
    p.t[OZ] -= fz * a.back;
    p.t[OY] += a.rise;
    p.t[SQ] += a.squash;
    p.t[SC] += a.swell;
    p.jitter = a.shiver;
    if (this.doomed) {
      // Rigid and white-hot, shuddering: it's already dead, it just
      // doesn't know yet.
      p.t[SQ] += 0.12;
      p.jitter = Math.max(p.jitter, 0.06);
    }
    this.posture?.(p);
    if (p.tune.faces && (this.frameNo++ & 3) === 0) {
      const t = nearestWizardTo(pos.x, pos.y, pos.z);
      faceToward(p, pos.x, pos.z, t.pos.x, t.pos.z);
    }
    stepPuppet(p, pdt);
    // Held by a hitstop: keep last frame's pose whole. Posing it again would
    // drop the breath (a dying thing's height snaps ~15%) and re-roll the
    // shiver, so a frozen body would twitch instead of hanging still.
    if (pdt > 0) puppetPose(p, this.pose, w.breath);
    if (view) {
      const o = this.pose;
      view.position.set(o.x, o.y, o.z);
      euler.set(o.rx, 0, o.rz);
      qLean.setFromEuler(euler);
      qYaw.setFromAxisAngle(UP, o.yaw);
      view.quaternion.multiplyQuaternions(qLean, qYaw);
      view.scale.set(o.sx, o.sy, o.sz);
    }

    // It leaks (budgeted inside leakFx; staggered by the accumulator).
    if (w.leak > 0 && pdt > 0) {
      this.leakAcc += pdt * w.leak;
      if (this.leakAcc >= 1) {
        const n = Math.floor(this.leakAcc);
        this.leakAcc -= n;
        spot.x = pos.x + this.pose.x;
        spot.y = pos.y + this.look.center + this.pose.y;
        spot.z = pos.z + this.pose.z;
        leakFx(this.look.leak, spot, this.look.leakColor, n);
      }
    }
  }

  /** Paint the flash material: hue, white frame, hit flash, the wound's
   * sputter, the wind-up's heat, the death throes' glare. `extra` adds
   * glow (a sentry's charge); `gain` is how hard the hit flash flares. */
  paint(mat: MeshStandardMaterial | null, extra = 0, gain = 6): void {
    if (!mat) return;
    const glow = ENEMY_GLOW[this.look.hue] * this.wound.glow + this.ant.glow + extra;
    let white = this.white > WHITE_S * 0.5 ? 1 : this.white > 0 ? 0.5 : 0;
    if (this.doomed) white = Math.max(white, 0.8);
    hitFlash(mat, this.look.hue, glow, this.flash.current, white, gain);
    // Cracks open across the shell as its life runs out (they gutter with it).
    woundUniforms(mat, this.look.soul).wound.value = this.wound.crack * (this.wound.stage >= 2 ? 0.5 + 0.5 * this.wound.glow : 1);
  }

  /** The weak spot's world position, `fwd` metres ahead along its facing. */
  ahead(fwd: number): { x: number; z: number } {
    spot.x = Math.sin(this.puppet.yaw) * fwd;
    spot.z = Math.cos(this.puppet.yaw) * fwd;
    return spot;
  }
}
