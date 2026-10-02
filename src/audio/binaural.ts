/** How a head hears a sound from somewhere: the cues the ears use to put it
 * in space, besides how loud it is. Pure and tested; spatial.ts dresses
 * every voice in them.
 *
 * The head is a sphere (Brown & Duda, "A structural model for binaural
 * sound synthesis", 1998): sound reaches the far ear later, round the head
 * (the interaural time difference, up to ~0.66 ms — Woodworth's formula),
 * and with its treble shadowed by the head while the near ear's is lifted
 * (a one-pole shelf whose height swings from +6 dB facing the sound to
 * −20 dB in the head's shadow). The torso and the backs of the ears dull
 * what comes from behind. Lows bend round a head almost untouched — a few
 * dB at most — so on headphones it's the timing and the treble that place
 * a sound, not a fader between the ears.
 *
 * On speakers, two ears hear both speakers: delays between the channels
 * turn into comb filtering, and the head adds its own shadow. There the
 * cues fall back to level (an equal-power pan) and the dulling from behind.
 *
 * Beyond direction:
 *  - `spread`: a sound has a size. Far off, a rift is a point; a step away
 *    it fills half your hearing; inside a blast it's all round you.
 *  - `airDb`: air takes the treble off sound the further it goes. */

export const HEAD_RADIUS = 0.0875;
export const SPEED_OF_SOUND = 343;

/** The cues at each ear for a sound from a direction. */
export interface Ears {
  /** Seconds each ear hears it late (the far ear, round the head). */
  delayL: number;
  delayR: number;
  /** The head's shadow: treble shelf at each ear (dB) and its corner (Hz). */
  shelfL: number;
  shelfR: number;
  cornerL: number;
  cornerR: number;
  /** Broadband level at each ear (linear). */
  gainL: number;
  gainR: number;
  /** Treble cut for a sound behind you (dB, ≤ 0). */
  behind: number;
}

/** The delay at an ear (s) for a sound `theta` radians off that ear's axis:
 * none facing it, the head's radius over c straight ahead, round the back
 * of the head beyond (Brown & Duda; the difference is Woodworth's ITD). */
export function earDelay(theta: number): number {
  const a = HEAD_RADIUS / SPEED_OF_SOUND;
  return theta < Math.PI / 2 ? a * (1 - Math.cos(theta)) : a * (1 + theta - Math.PI / 2);
}

/** The head shadow's treble gain α at an ear for a sound `theta` off its
 * axis: 2 (+6 dB) facing it, 0.1 (−20 dB) at 150°, a little back up behind
 * (the bright spot round a sphere). */
export function shadowAlpha(theta: number): number {
  const aMin = 0.1;
  const thetaMin = (150 * Math.PI) / 180;
  return 1 + aMin / 2 + (1 - aMin / 2) * Math.cos((theta / thetaMin) * Math.PI);
}

/** The shelf's corner (Hz) for treble gain α: the model's pole sits at 2c/a
 * (1.25 kHz) and its zero at that over α; a shelf's corner is midway. */
export function shadowCorner(alpha: number): number {
  return (2 * SPEED_OF_SOUND) / HEAD_RADIUS / (2 * Math.PI) / Math.sqrt(alpha);
}

const FRONT_DB = 20 * Math.log10(shadowAlpha(Math.PI / 2));
const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));

/** The cues for a sound in direction (x right, y up, z ahead) of the head.
 * Straight ahead both ears get the same, untouched (a sound in front of you
 * is as bright and loud as your own); a sound on top of you (`near` < 1, as
 * it closes in) has its cues fade to the middle. */
export function ears(x: number, y: number, z: number, headphones: boolean, near = 1): Ears {
  const n = Math.hypot(x, y, z);
  const ux = n > 1e-6 ? (x / n) * near : 0;
  const uz = n > 1e-6 ? (z / n) * near : 1;
  const behind = Math.min(0, uz) * 10;
  if (!headphones) {
    // An equal-power pan, centred at unity like a sound of your own.
    const p = ((clamp1(ux * 0.85) + 1) * Math.PI) / 4;
    return { delayL: 0, delayR: 0, shelfL: 0, shelfR: 0, cornerL: 1250, cornerR: 1250, gainL: Math.cos(p) * Math.SQRT2, gainR: Math.sin(p) * Math.SQRT2, behind };
  }
  const thR = Math.acos(clamp1(ux));
  const thL = Math.acos(clamp1(-ux));
  const aR = shadowAlpha(thR);
  const aL = shadowAlpha(thL);
  // Relative to straight ahead, and the near ear's lift kept within +6 dB.
  const shelf = (a: number) => Math.min(6, 20 * Math.log10(a) - FRONT_DB);
  // The lows: about 1.5 dB louder at the near ear, as much quieter at the far.
  const lo = 1.5 * ux;
  return {
    delayL: earDelay(thL),
    delayR: earDelay(thR),
    shelfL: shelf(aL),
    shelfR: shelf(aR),
    cornerL: shadowCorner(aL),
    cornerR: shadowCorner(aR),
    gainL: Math.pow(10, -lo / 20),
    gainR: Math.pow(10, lo / 20),
    behind,
  };
}

/** How much of a sound of `radius` metres, `dist` away, comes from all
 * round rather than from a point (0 a point … 1 inside it): its angular
 * size, as a share of your hearing. A rift (1.2 m) is half wide at arm's
 * length and a point across a hall. */
export function spread(radius: number, dist: number): number {
  if (radius <= 0) return 0;
  return (2 / Math.PI) * Math.atan(radius / Math.max(1e-3, dist));
}

/** The treble the air takes off a sound that went `dist` metres (dB at the
 * shelf, ≤ 0): about a third of a dB a metre beyond arm's length, so a
 * sound across a hall is a touch duller and one down a long passage dull. */
export function airDb(dist: number): number {
  return -Math.min(18, 0.3 * Math.max(0, dist - 2));
}

/** A stereo decorrelation filter: a short burst of sparse noise (velvet
 * noise, decaying in a few milliseconds), different in each ear, unit
 * energy each. A sound through it keeps its colour but loses its place:
 * the ears hear it from everywhere at once. */
export function decorrelator(sampleRate: number, seed = 7): [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] {
  const len = Math.ceil(0.02 * sampleRate);
  const out: [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] = [new Float32Array(len), new Float32Array(len)];
  let s = seed >>> 0;
  const rand = () => {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0;
    return s / 4294967296;
  };
  // One pulse every ~0.6 ms, at a random spot in its slot, random sign.
  const slot = Math.max(1, Math.round(sampleRate * 0.0006));
  for (const ch of out) {
    let e = 0;
    for (let i = 0; i < len; i += slot) {
      const k = Math.min(len - 1, i + Math.floor(rand() * slot));
      const v = (rand() < 0.5 ? -1 : 1) * Math.exp(-k / (0.005 * sampleRate));
      ch[k] = v;
      e += v * v;
    }
    const g = 1 / Math.sqrt(e);
    for (let i = 0; i < len; i++) ch[i]! *= g;
  }
  return out;
}
