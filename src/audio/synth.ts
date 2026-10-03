import { audioCtx, masterBus, noiseBuf, type NoiseColor } from "./context";

/** The synthesizer every sound in the game is built from — no samples, all
 * WebAudio. A sound is a few voices started together:
 *
 * - `tone`: an oscillator (sweeping, detuned, with vibrato); bright waves
 *   go through a lowpass that closes as the note dies, the way a struck
 *   string darkens — so a square is a reed, not a buzzer.
 * - `noise`: filtered noise in three colours (white hiss, pink air, brown
 *   rumble).
 * - `strike`: a struck object by its modes — the inharmonic partials of a
 *   bell, a bowl, glass, metal or stone, each ringing down at its own rate.
 * - `fm`: frequency modulation, its index falling as the note dies: the
 *   bright-attack, mellow-tail shimmer of magic.
 * - `voice`: a buzz or a breath through vowel formants — growls, groans,
 *   whispers — optionally rattling (a throat, a creaking hinge).
 * - `crackle`: a sprinkle of tiny noise grains — debris, embers, grit.
 * - `saturated`: the voices built inside go through a soft saturator (the
 *   grit of a blast or a roar).
 *
 * Voices go wherever the caller routes them (`routed`: a point in the
 * world, your own ears) or else to the master bus. Every call is a safe
 * no-op before the audio context exists. */

/** Where the voices being built go (null: the master bus). */
let dest: AudioNode | null = null;

/** Build `fn`'s voices into `node`. */
export function routed(node: AudioNode | null, fn: () => void): void {
  const prev = dest;
  dest = node;
  try {
    fn();
  } finally {
    dest = prev;
  }
}

const out = (): AudioNode | null => dest ?? masterBus();

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const cents = (c: number) => 2 ** (c / 1200);
/** Exponential ramps can't reach zero (or go below it). */
const SILENT = 0.0001;

/** A gain that swells in over `attack`, holds for `hold` of `dur`, then
 * dies away exponentially by `dur`. */
function envelope(ctx: BaseAudioContext, t0: number, dur: number, vol: number, attack: number, hold = 0): GainNode {
  const g = ctx.createGain();
  const a = Math.min(attack, dur * 0.95);
  g.gain.setValueAtTime(SILENT, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(vol, SILENT * 2), t0 + a);
  if (hold > 0) g.gain.setValueAtTime(Math.max(vol, SILENT * 2), Math.min(t0 + a + hold * dur, t0 + dur * 0.97));
  g.gain.exponentialRampToValueAtTime(SILENT, t0 + dur);
  return g;
}

/** Sweep `p` from `from` to `to` over [t0, t0 + dur] (exponential). */
function sweep(p: AudioParam, from: number, to: number | undefined, t0: number, dur: number, floor = 1): void {
  p.setValueAtTime(from, t0);
  if (to !== undefined && to !== from) p.exponentialRampToValueAtTime(Math.max(to, floor), t0 + dur);
}

// ── Tone ────────────────────────────────────────────────────────────────────

export interface ToneOptions {
  type?: OscillatorType;
  freq: number;
  freqEnd?: number;
  dur: number;
  vol?: number;
  delay?: number;
  /** Seconds to reach full volume (default: a click-free 8 ms). Long attacks
   * make swells — rushes and risers rather than hits. */
  attack?: number;
  /** Share of `dur` to hold at full volume before dying away (default 0: it
   * rings down from the peak, like a plucked string). */
  hold?: number;
  /** Bright waves (square, sawtooth, triangle) go through a lowpass this many
   * times the pitch, closing to a third of that as the note dies (default
   * 8; 0: raw). */
  bright?: number;
  /** A second voice this many cents away — width, shimmer, unease. */
  detune?: number;
  /** Lands up to this many cents off, at random: never twice the same. */
  vary?: number;
  /** Vibrato: [rate Hz, depth cents]. */
  vibrato?: [number, number];
}

export function tone({ type = "sine", freq, freqEnd, dur, vol = 0.2, delay = 0, attack = 0.008, hold = 0, bright = 8, detune = 0, vary = 0, vibrato }: ToneOptions): void {
  const ctx = audioCtx();
  const dst = out();
  if (!ctx || !dst) return;
  const t0 = ctx.currentTime + delay;
  const k = vary ? cents(rand(-vary, vary)) : 1;
  const g = envelope(ctx, t0, dur, vol, attack, hold);
  g.connect(dst);
  let head: AudioNode = g;
  if (type !== "sine" && bright > 0) {
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 0.5;
    const end = (freqEnd ?? freq) * k * bright;
    sweep(lp.frequency, Math.min(18000, freq * k * bright), Math.min(18000, Math.max(60, end / 3)), t0, dur, 60);
    lp.connect(g);
    head = lp;
  }
  let vib: OscillatorNode | null = null;
  let vibDepth: GainNode | null = null;
  if (vibrato) {
    vib = ctx.createOscillator();
    vib.frequency.value = vibrato[0];
    vibDepth = ctx.createGain();
    vibDepth.gain.value = vibrato[1];
    vib.connect(vibDepth);
    vib.start(t0);
    vib.stop(t0 + dur + 0.05);
  }
  const voices = detune ? [-detune / 2, detune / 2] : [0];
  const each = detune ? ctx.createGain() : null;
  if (each) {
    each.gain.value = 0.7;
    each.connect(head);
  }
  for (const c of voices) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.detune.value = c;
    sweep(osc.frequency, freq * k, freqEnd === undefined ? undefined : freqEnd * k, t0, dur);
    vibDepth?.connect(osc.detune);
    osc.connect(each ?? head);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }
}

// ── Noise ───────────────────────────────────────────────────────────────────

export interface NoiseOptions {
  dur: number;
  vol?: number;
  filterFreq: number;
  filterEnd?: number;
  q?: number;
  delay?: number;
  type?: BiquadFilterType;
  /** Seconds to reach full volume (default 12 ms); see ToneOptions.attack. */
  attack?: number;
  /** See ToneOptions.hold. */
  hold?: number;
  /** White (default: hiss, sparks), pink (air, breath) or brown (rumble). */
  color?: NoiseColor;
}

export function noise({ dur, vol = 0.2, filterFreq, filterEnd, q = 0.8, delay = 0, type = "lowpass", attack = 0.012, hold = 0, color = "white" }: NoiseOptions): void {
  const ctx = audioCtx();
  const buf = noiseBuf(color);
  const dst = out();
  if (!ctx || !dst || !buf) return;
  const t0 = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  src.playbackRate.value = 0.7 + Math.random() * 0.6;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.Q.value = q;
  sweep(filter.frequency, filterFreq, filterEnd, t0, dur, 20);
  const g = envelope(ctx, t0, dur, vol, attack, hold);
  src.connect(filter).connect(g).connect(dst);
  // From anywhere in the noise: no two bursts are the same grain of it.
  src.start(t0, Math.random() * buf.duration);
  src.stop(t0 + dur + 0.05);
}

// ── Struck things ───────────────────────────────────────────────────────────

/** A struck body's partials: [frequency ratio, amplitude, share of the
 * ring time]. Real objects ring inharmonically — that's what tells glass
 * from a bell from a stone. */
export const MODES = {
  /** A cast bell: hum an octave down, the prime, the minor third (tierce)
   * that makes a bell sound like a bell, the fifth, the nominal. */
  bell: [[0.5, 0.45, 1], [1, 1, 0.75], [1.19, 0.5, 0.6], [1.5, 0.28, 0.5], [2, 0.5, 0.42], [2.52, 0.18, 0.3], [3.01, 0.14, 0.24], [4.07, 0.07, 0.15]],
  /** A singing bowl: wide, slow, nearly pure. */
  bowl: [[1, 1, 1], [2.71, 0.38, 0.65], [5.15, 0.16, 0.4], [8.43, 0.07, 0.25]],
  /** A glass or crystal ping. */
  glass: [[1, 1, 1], [2.32, 0.32, 0.5], [4.25, 0.14, 0.3], [6.63, 0.06, 0.18]],
  /** A metal plate or gong: dense, clangorous. */
  metal: [[1, 1, 1], [1.59, 0.62, 0.75], [2.14, 0.5, 0.55], [2.65, 0.38, 0.45], [3.51, 0.24, 0.3], [4.62, 0.14, 0.2]],
  /** Stone or wood: a dull knock, gone almost at once. */
  stone: [[1, 1, 1], [1.73, 0.55, 0.45], [2.58, 0.32, 0.3], [3.93, 0.16, 0.18]],
} as const satisfies Record<string, readonly (readonly [number, number, number])[]>;

export interface StrikeOptions {
  freq: number;
  /** How long the fundamental rings (s). */
  dur: number;
  vol?: number;
  delay?: number;
  modes?: keyof typeof MODES;
  /** Scales the upper partials (1: as modelled; <1 duller, >1 brighter). */
  bright?: number;
  /** Each partial is a pair this far apart (Hz): the slow beating of a real
   * bell or bowl. */
  beat?: number;
  /** See ToneOptions.vary. */
  vary?: number;
  /** Seconds to full volume (default 2 ms: a hard strike). */
  attack?: number;
}

export function strike({ freq, dur, vol = 0.1, delay = 0, modes = "bell", bright = 1, beat = 0, vary = 0, attack = 0.002 }: StrikeOptions): void {
  const ctx = audioCtx();
  const dst = out();
  if (!ctx || !dst) return;
  const t0 = ctx.currentTime + delay;
  const k = vary ? cents(rand(-vary, vary)) : 1;
  const nyquist = ctx.sampleRate * 0.45;
  MODES[modes].forEach(([ratio, amp, ring], i) => {
    const f = freq * k * ratio * cents(rand(-3, 3));
    if (f > nyquist) return;
    const a = vol * amp * bright ** i;
    if (a < SILENT * 10) return;
    const d = Math.max(0.03, dur * ring);
    const g = envelope(ctx, t0, d, a, attack * (1 + i * 0.5));
    g.connect(dst);
    for (const off of beat ? [-beat / 2, beat / 2] : [0]) {
      const o = ctx.createOscillator();
      o.frequency.value = f + off * ratio;
      o.connect(g);
      o.start(t0);
      o.stop(t0 + d + 0.05);
    }
  });
}

// ── FM ──────────────────────────────────────────────────────────────────────

export interface FmOptions {
  freq: number;
  freqEnd?: number;
  dur: number;
  vol?: number;
  delay?: number;
  attack?: number;
  hold?: number;
  /** Modulator frequency as a multiple of the carrier's (default 1;
   * non-integers are bell-like and metallic). */
  ratio?: number;
  /** Modulation index at the start (default 2): how bright. */
  index?: number;
  /** …and at the end (default a tenth of it). */
  indexEnd?: number;
  /** See ToneOptions.vary. */
  vary?: number;
}

export function fm({ freq, freqEnd, dur, vol = 0.1, delay = 0, attack = 0.005, hold = 0, ratio = 1, index = 2, indexEnd = index * 0.1, vary = 0 }: FmOptions): void {
  const ctx = audioCtx();
  const dst = out();
  if (!ctx || !dst) return;
  const t0 = ctx.currentTime + delay;
  const k = vary ? cents(rand(-vary, vary)) : 1;
  const f0 = freq * k;
  const f1 = freqEnd === undefined ? undefined : freqEnd * k;
  const car = ctx.createOscillator();
  const mod = ctx.createOscillator();
  sweep(car.frequency, f0, f1, t0, dur);
  sweep(mod.frequency, f0 * ratio, f1 === undefined ? undefined : f1 * ratio, t0, dur);
  const depth = ctx.createGain();
  depth.gain.setValueAtTime(index * f0 * ratio, t0);
  depth.gain.linearRampToValueAtTime(indexEnd * (f1 ?? f0) * ratio, t0 + dur);
  mod.connect(depth).connect(car.frequency);
  const g = envelope(ctx, t0, dur, vol, attack, hold);
  car.connect(g).connect(dst);
  for (const o of [car, mod]) {
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }
}

// ── Voices: formants ────────────────────────────────────────────────────────

/** Vowel formants (Hz) — what makes a buzz a growl, a breath a whisper. */
export const VOWELS = {
  a: [800, 1150, 2900],
  e: [400, 1700, 2600],
  i: [300, 2200, 3000],
  o: [450, 800, 2830],
  u: [325, 700, 2530],
} as const;
export type Vowel = keyof typeof VOWELS;

export interface VoiceOptions {
  /** The buzz's pitch (ignored for a breath). */
  freq: number;
  freqEnd?: number;
  dur: number;
  vol?: number;
  delay?: number;
  attack?: number;
  hold?: number;
  vowel: Vowel;
  /** Glides to this vowel over the sound. */
  vowelEnd?: Vowel;
  /** Breath (pink noise) instead of a buzz: a whisper. */
  breath?: boolean;
  /** An amplitude rattle at this rate (Hz): a throat's roughness, a
   * hinge's creak. */
  rattle?: number;
  /** A second buzz this many cents away (see ToneOptions.detune). */
  detune?: number;
  /** Formant sharpness (default 9: freq / bandwidth). */
  q?: number;
  /** Shifts every formant (1: an adult's throat; <1 a bigger beast). */
  size?: number;
}

export function voice({ freq, freqEnd, dur, vol = 0.1, delay = 0, attack = 0.03, hold = 0, vowel, vowelEnd, breath = false, rattle, detune = 0, q = 9, size = 1 }: VoiceOptions): void {
  const ctx = audioCtx();
  const dst = out();
  const nb = noiseBuf("pink");
  if (!ctx || !dst || !nb) return;
  const t0 = ctx.currentTime + delay;
  const g = envelope(ctx, t0, dur, vol, attack, hold);
  g.connect(dst);
  let into: AudioNode = g;
  if (rattle) {
    // The rattle: the sound's level swung by a low oscillator, half way.
    const r = ctx.createGain();
    r.gain.value = 0.5;
    const lfo = ctx.createOscillator();
    lfo.type = "triangle";
    lfo.frequency.value = rattle;
    const depth = ctx.createGain();
    depth.gain.value = 0.5;
    lfo.connect(depth).connect(r.gain);
    lfo.start(t0);
    lfo.stop(t0 + dur + 0.05);
    r.connect(g);
    into = r;
  }
  // The source feeds three formant bands in parallel, the higher ones
  // quieter. Narrow bands pass less, so each is made up by its Q.
  const bank = ctx.createGain();
  const from = VOWELS[vowel];
  const to = VOWELS[vowelEnd ?? vowel];
  for (let i = 0; i < 3; i++) {
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = q;
    sweep(bp.frequency, from[i]! * size, to[i]! * size, t0, dur, 40);
    const fg = ctx.createGain();
    fg.gain.value = [1, 0.55, 0.25][i]! * Math.sqrt(q) * (breath ? 1.4 : 0.9);
    bank.connect(bp).connect(fg).connect(into);
  }
  if (breath) {
    const src = ctx.createBufferSource();
    src.buffer = nb;
    src.loop = true;
    src.connect(bank);
    src.start(t0, Math.random() * nb.duration);
    src.stop(t0 + dur + 0.05);
  } else {
    for (const c of detune ? [-detune / 2, detune / 2] : [0]) {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.detune.value = c;
      sweep(o.frequency, freq, freqEnd, t0, dur);
      o.connect(bank);
      o.start(t0);
      o.stop(t0 + dur + 0.05);
    }
  }
}

// ── Grains ──────────────────────────────────────────────────────────────────

export interface CrackleOptions {
  /** Spread over this long (s), thicker at the start. */
  dur: number;
  count: number;
  vol?: number;
  /** Centre of the grains' band (Hz)… */
  freq: number;
  /** …each landing up to this share off it. */
  spread?: number;
  delay?: number;
  /** Each grain's length (s, ±50%). */
  grain?: number;
  q?: number;
  /** 0: grains evenly spread; up to 1: bunched at the start, fading. */
  decay?: number;
  color?: NoiseColor;
}

export function crackle({ dur, count, vol = 0.05, freq, spread = 0.4, delay = 0, grain = 0.012, q = 3, decay = 0.6, color = "white" }: CrackleOptions): void {
  for (let i = 0; i < count; i++) {
    const at = Math.random() ** (1 + decay * 1.5) * dur;
    noise({
      dur: grain * rand(0.5, 1.5),
      vol: vol * rand(0.3, 1) * (1 - (decay * at) / dur),
      filterFreq: freq * (1 + rand(-spread, spread)),
      type: "bandpass",
      q,
      attack: 0.001,
      delay: delay + at,
      color,
    });
  }
}

// ── Saturation ──────────────────────────────────────────────────────────────

const curves = new Map<number, Float32Array<ArrayBuffer>>();

/** y = c·tanh(x / c): unity for quiet signals, rounding off toward `c`. */
function saturationCurve(ceiling: number): Float32Array<ArrayBuffer> {
  let c = curves.get(ceiling);
  if (!c) {
    c = new Float32Array(1024);
    for (let i = 0; i < c.length; i++) {
      const x = (i / (c.length - 1)) * 2 - 1;
      c[i] = ceiling * Math.tanh(x / ceiling);
    }
    curves.set(ceiling, c);
  }
  return c;
}

/** Build `fn`'s voices through a soft saturator that rounds them off toward
 * `ceiling` (a peak level, e.g. 0.3) — the grit and weight of a blast or a
 * roar. Quieter than about half of it passes clean. */
export function saturated(ceiling: number, fn: () => void): void {
  const ctx = audioCtx();
  const dst = out();
  if (!ctx || !dst) return;
  const ws = ctx.createWaveShaper();
  ws.curve = saturationCurve(ceiling);
  ws.oversample = "2x";
  ws.connect(dst);
  routed(ws, fn);
}
