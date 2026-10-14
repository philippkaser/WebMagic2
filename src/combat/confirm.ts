import { KNEE } from "../game/vitality";

/** The hit confirm: what the crosshair and your ears say the instant your
 * magic lands — ticks flaring round the aim, a dry "tk" that climbs in pitch
 * as the creature weakens (its last half of life, the bar's last third, an
 * audible crescendo: the "barely alive" cue in sound), and on the killing
 * blow a red X and a deep chime.
 *
 * Pure; the caller passes the time (seconds). The marks are functions of the
 * time since the last hit and kill, so nothing needs stepping. Sounds go
 * through a gate: at most one per CONFIRM.gate, and light hits (a beam's or
 * a flame's ticks) at most one per CONFIRM.lightGate — a held stream reads
 * as a quick patter, not a buzz, and what the gate held back folds its
 * weight into the next sound instead of being lost. */

export const CONFIRM = {
  /** How long a hit's ticks show (s). */
  tickLife: 0.11,
  /** How long the kill X holds, then how long it takes to step out (in
   * three hard steps, like the HUD's pixel pieces). */
  killHold: 0.25,
  killOut: 0.1,
  /** At most one confirm sound per this long… */
  gate: 0.06,
  /** …and light hits at most one per this long. */
  lightGate: 0.115,
  /** A hit lighter than this (shot weight 0…1) is a tick. */
  light: 0.2,
  /** A kill is confirmed once per creature, though two signals report it
   * (the lethal hit as we saw it land, then the host's death note). */
  killMemory: 2,
} as const;

/** How many kills the dedupe ring remembers. */
const KILL_RING = 16;

export interface Confirm {
  hitAt: number;
  hitCrit: boolean;
  hitWeight: number;
  killAt: number;
  killCrit: boolean;
  /** When the last confirm sound played. */
  soundAt: number;
  /** A sound the gate is holding: the folded weight of the hits since the
   * last one, the lowest life they left, and whether any was a crit. */
  pending: boolean;
  /** Any single hit among them heavier than a tick. */
  pendHeavy: boolean;
  pendWeight: number;
  pendFrac: number;
  pendCrit: boolean;
  killIds: string[];
  killTimes: number[];
  killNext: number;
}

export function createConfirm(): Confirm {
  return {
    hitAt: -Infinity,
    hitCrit: false,
    hitWeight: 0,
    killAt: -Infinity,
    killCrit: false,
    soundAt: -Infinity,
    pending: false,
    pendHeavy: false,
    pendWeight: 0,
    pendFrac: 1,
    pendCrit: false,
    killIds: new Array<string>(KILL_RING).fill(""),
    killTimes: new Array<number>(KILL_RING).fill(-Infinity),
    killNext: 0,
  };
}

/** A confirm sound to play now. One scratch object, overwritten by the next
 * call — play it at once. */
export interface ConfirmSound {
  /** 0…1: how loud and thick the "tk" is. */
  weight: number;
  /** Playback pitch multiplier (confirmPitch). */
  pitch: number;
  crit: boolean;
}
const sound: ConfirmSound = { weight: 0, pitch: 1, crit: false };

/** Pitch of a hit's confirm for the real life `frac` it left (0…1): 1 at
 * full health, 1.6 at none. The first half of the life climbs only 30% of
 * the way; past the knee — where the bar is a sliver that lasts as long as
 * everything before it — the rest of the climb plays out, so the last
 * stretch is a crescendo. */
export function confirmPitch(frac: number): number {
  const f = Math.min(1, Math.max(0, Number.isFinite(frac) ? frac : 1));
  const w = f >= KNEE.real ? ((1 - f) / (1 - KNEE.real)) * 0.3 : 0.3 + ((KNEE.real - f) / KNEE.real) * 0.7;
  return 1 + 0.6 * w;
}

/** Ticks folded together are still ticks: the gate goes by the heaviest
 * single hit held, not their sum. */
function gateFor(c: Confirm): number {
  return c.pendHeavy ? CONFIRM.gate : CONFIRM.lightGate;
}

function release(c: Confirm, now: number): ConfirmSound {
  c.soundAt = now;
  sound.weight = Math.min(1, c.pendWeight);
  sound.pitch = confirmPitch(c.pendFrac);
  sound.crit = c.pendCrit;
  c.pending = false;
  c.pendHeavy = false;
  c.pendWeight = 0;
  c.pendFrac = 1;
  c.pendCrit = false;
  return sound;
}

/** One of your hits landed: `weight` the shot's heft (0…1), `frac` the life
 * it left. Lights the ticks; returns the sound to play now, or null when the
 * gate holds it (call flushConfirm when pendingDue says). */
export function noteHit(c: Confirm, now: number, weight: number, frac: number, crit: boolean): ConfirmSound | null {
  // Ticks: a crit keeps them gold for as long as they show.
  c.hitCrit = crit || (c.hitCrit && now - c.hitAt < CONFIRM.tickLife);
  c.hitWeight = now - c.hitAt < CONFIRM.tickLife ? Math.max(c.hitWeight, weight) : weight;
  c.hitAt = now;
  c.pending = true;
  c.pendHeavy ||= weight >= CONFIRM.light;
  c.pendWeight += Math.max(0, weight);
  c.pendFrac = Math.min(c.pendFrac, frac);
  c.pendCrit ||= crit;
  return now - c.soundAt >= gateFor(c) ? release(c, now) : null;
}

/** When the held sound may play (seconds, the caller's clock), or null. */
export function pendingDue(c: Confirm): number | null {
  return c.pending ? c.soundAt + gateFor(c) : null;
}

/** Release the held sound if its time has come. */
export function flushConfirm(c: Confirm, now: number): ConfirmSound | null {
  return c.pending && now - c.soundAt >= gateFor(c) ? release(c, now) : null;
}

/** A creature `id` you hit died. True if this is news (play the kill
 * confirm); false if it was already confirmed. The kill takes over from any
 * tick still showing or still waiting at the gate. */
export function noteKill(c: Confirm, now: number, id: string, crit: boolean): boolean {
  for (let i = 0; i < KILL_RING; i++) {
    if (c.killIds[i] === id && now - c.killTimes[i]! < CONFIRM.killMemory) return false;
  }
  c.killIds[c.killNext] = id;
  c.killTimes[c.killNext] = now;
  c.killNext = (c.killNext + 1) % KILL_RING;
  c.killAt = now;
  c.killCrit = crit;
  c.hitAt = -Infinity;
  c.pending = false;
  c.pendHeavy = false;
  c.pendWeight = 0;
  c.pendFrac = 1;
  c.pendCrit = false;
  c.soundAt = now;
  return true;
}

/** The crosshair's marks right now. */
export interface Marks {
  /** Hit ticks, 1 fresh → 0 gone. */
  tick: number;
  /** Whole pixels the ticks have stepped out. */
  spread: number;
  /** The kill X: 1 held, stepping out to 0. */
  kill: number;
  /** Gold (a precision hit or kill). */
  crit: boolean;
  /** The shot was heavy: longer ticks. */
  heavy: boolean;
}

export function marksAt(c: Confirm, now: number, out: Marks): Marks {
  const k = now - c.killAt;
  if (k >= 0 && k < CONFIRM.killHold) out.kill = 1;
  else if (k >= 0 && k < CONFIRM.killHold + CONFIRM.killOut) {
    // 1 → ⅔ → ⅓ → gone: three hard steps.
    out.kill = 1 - (Math.floor(((k - CONFIRM.killHold) / CONFIRM.killOut) * 2) + 1) / 3;
  } else out.kill = 0;
  const h = now - c.hitAt;
  out.tick = out.kill > 0 || h < 0 || h >= CONFIRM.tickLife ? 0 : 1 - h / CONFIRM.tickLife;
  // The ticks step out two whole pixels as they fade.
  out.spread = out.tick > 0 ? Math.min(2, Math.floor((1 - out.tick) * 3)) : 0;
  out.crit = out.kill > 0 ? c.killCrit : out.tick > 0 && c.hitCrit;
  out.heavy = c.hitWeight >= 0.6;
  return out;
}

export function newMarks(): Marks {
  return { tick: 0, spread: 0, kill: 0, crit: false, heavy: false };
}
