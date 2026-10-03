import { audioCtx, noiseBuf } from "./context";
import { atPoint, self } from "./sound";
import { crackle, fm, noise, saturated, strike, tone, voice } from "./synth";
import { audibility, emitterAt, listenerAt, type At, type Emitter } from "./spatial";

/** The world's own voices, all synthesized and all placed (spatial.ts):
 * footsteps on each kind of ground, the creatures waking, walking and
 * dying, torches crackling and rifts humming where they stand, and the
 * small sounds a place makes by itself — a drip in the Drowned Halls, a
 * crystal ringing, an ember popping, crickets on the village green. */

const jitter = (x: number, amount = 0.1) => x * (1 + (Math.random() * 2 - 1) * amount);

// ── Footsteps ───────────────────────────────────────────────────────────────

export type Ground = "stone" | "cobble" | "wet" | "crystal" | "iron" | "ash" | "grass";

let groundFn: (x: number, z: number) => Ground = () => "stone";

/** What the ground at (x, z) is made of (set by the scene: AudioWorld). */
export function groundAt(x: number, z: number): Ground {
  return groundFn(x, z);
}

export function setGround(fn: (x: number, z: number) => Ground): void {
  groundFn = fn;
}

/** One footfall on `ground` — yours (from where you stand, under your
 * left `foot` −1 or right 1) or someone's `at` their feet. `loud` 0…1+ (a
 * landing is louder). */
export function playFootstep(ground: Ground, loud = 1, at?: At, foot = 0): void {
  const step = () => {
    const v = 0.9 + Math.random() * 0.2;
    if (ground === "grass") {
      // Blades swishing and crushed under the sole, a soft thump.
      noise({ dur: 0.1, vol: 0.026 * loud * v, filterFreq: jitter(1500), filterEnd: 600, color: "pink" });
      crackle({ dur: 0.06, count: 3, vol: 0.012 * loud, freq: 3800, spread: 0.4, grain: 0.008 });
      tone({ type: "sine", freq: jitter(80), freqEnd: 50, dur: 0.06, vol: 0.03 * loud });
      return;
    }
    if (ground === "ash") {
      // Cinders crunching.
      noise({ dur: 0.1, vol: 0.04 * loud * v, filterFreq: jitter(900), filterEnd: 280, color: "pink" });
      crackle({ dur: 0.08, count: 4, vol: 0.016 * loud, freq: 2200, spread: 0.5, grain: 0.01 });
      tone({ type: "sine", freq: jitter(75), freqEnd: 45, dur: 0.07, vol: 0.04 * loud });
      return;
    }
    // Hard ground: a heel's click and the thump under it, the stone giving
    // a dull knock, then the toe rolling down a few tens of milliseconds
    // later — never quite the same step twice.
    const click = jitter(ground === "cobble" ? 2100 : ground === "iron" ? 2600 : 1600, 0.15);
    noise({ dur: 0.045, vol: 0.05 * loud * v, filterFreq: click, filterEnd: 800, type: "bandpass", q: 1.3 });
    tone({ type: "sine", freq: jitter(88), freqEnd: 50, dur: 0.05, vol: 0.045 * loud });
    if (ground !== "wet") strike({ freq: jitter(ground === "iron" ? 380 : 210, 0.12), dur: 0.06, vol: 0.012 * loud, modes: "stone" });
    noise({ dur: 0.03, vol: 0.022 * loud * v, filterFreq: click * 1.4, type: "bandpass", q: 1.6, delay: jitter(0.045, 0.3) });
    if (ground === "cobble") noise({ dur: 0.03, vol: 0.025 * loud, filterFreq: jitter(2600), type: "bandpass", q: 2, delay: 0.018 });
    if (ground === "wet") {
      // A splash, and droplets.
      noise({ dur: 0.15, vol: 0.032 * loud * v, filterFreq: jitter(2800), filterEnd: 1200, type: "bandpass", q: 0.9, delay: 0.01, color: "pink" });
      for (let i = 0; i < 2; i++) {
        const f = jitter(1400, 0.3);
        tone({ type: "sine", freq: f, freqEnd: f * 1.8, dur: 0.035, vol: 0.008 * loud, delay: 0.04 + Math.random() * 0.08 });
      }
    }
    if (ground === "crystal") strike({ freq: [2093, 2637, 3136][Math.floor(Math.random() * 3)]!, dur: 0.35, vol: 0.012 * loud, modes: "glass", vary: 10 });
    if (ground === "iron") strike({ freq: jitter(520, 0.05), dur: 0.22, vol: 0.01 * loud, modes: "metal" });
  };
  if (at) atPoint(at, 0.35, step, 1, 0.15);
  else self(step, foot);
}

// ── The creatures ───────────────────────────────────────────────────────────

/** Enemy kinds as they sound (useEnemy's `kind`). */
export type EnemyVoice = "slime" | "wisp" | "shadow" | "sentry" | "boss";

const VOICES = new Set<string>(["slime", "wisp", "shadow", "sentry", "boss"]);
export const isEnemyVoice = (k: string): k is EnemyVoice => VOICES.has(k);

/** Metres an enemy walks between footfalls (0: it doesn't walk). */
export const ENEMY_STRIDE: Record<EnemyVoice, number> = { slime: 1.1, wisp: 0, shadow: 0.9, sentry: 0, boss: 2.2 };

/** How big each kind sounds (radius, m). */
const ENEMY_SIZE: Record<EnemyVoice, number> = { slime: 0.5, wisp: 0.25, shadow: 0.7, sentry: 0.4, boss: 1.6 };

/** A bubble rising and popping in slime: a sine chirping up. */
function bubble(delay: number, vol: number, f = jitter(500, 0.35)): void {
  tone({ type: "sine", freq: f, freqEnd: f * 2.4, dur: 0.045, vol, delay });
}

/** It has noticed you. */
export function playEnemyWake(kind: EnemyVoice, at: At): void {
  atPoint(at, 1, () => {
    switch (kind) {
      case "slime":
        // A wet gurgle rising out of it.
        tone({ type: "sine", freq: jitter(190), freqEnd: 85, dur: 0.28, vol: 0.1 });
        noise({ dur: 0.3, vol: 0.06, filterFreq: 450, filterEnd: 1300, type: "bandpass", q: 4, color: "pink" });
        for (let i = 0; i < 3; i++) bubble(0.05 + i * 0.07 + Math.random() * 0.03, 0.035);
        break;
      case "wisp":
        // A glassy chime that bends upward.
        fm({ freq: jitter(880, 0.05), freqEnd: 1320, dur: 0.3, vol: 0.045, ratio: 3.5, index: 1.6, indexEnd: 0 });
        fm({ freq: jitter(1320, 0.05), freqEnd: 1760, dur: 0.35, vol: 0.03, ratio: 2.01, index: 1.2, delay: 0.08 });
        strike({ freq: 2637, dur: 0.6, vol: 0.012, modes: "glass", delay: 0.12 });
        break;
      case "shadow":
        // A breath drawn in through teeth, over something low.
        voice({ freq: 0, dur: 0.7, vol: 0.07, attack: 0.25, vowel: "i", vowelEnd: "u", breath: true, q: 5 });
        tone({ type: "sine", freq: 70, freqEnd: 58, dur: 0.6, vol: 0.07, detune: 25 });
        break;
      case "sentry":
        // A click, a servo spinning up, a ping.
        noise({ dur: 0.012, vol: 0.06, filterFreq: 3500, type: "highpass", attack: 0.001 });
        tone({ type: "sawtooth", freq: 180, freqEnd: 420, dur: 0.22, vol: 0.025, bright: 4, attack: 0.04 });
        strike({ freq: 1180, dur: 0.4, vol: 0.03, modes: "metal", delay: 0.18 });
        fm({ freq: 600, freqEnd: 940, dur: 0.3, vol: 0.03, ratio: 2, index: 1.5, delay: 0.2 });
        break;
      case "boss":
        break; // it roars (playBossRoar)
    }
  }, 1.3, ENEMY_SIZE[kind]);
}

/** A footfall (or a slither). */
export function playEnemyStep(kind: EnemyVoice, at: At): void {
  atPoint(at, kind === "boss" ? 0.6 : 0.35, () => {
    if (kind === "slime") {
      // A squelch.
      noise({ dur: 0.09, vol: 0.05, filterFreq: jitter(500), filterEnd: 1100, type: "bandpass", q: 3, color: "pink" });
      tone({ type: "sine", freq: jitter(140), freqEnd: 80, dur: 0.07, vol: 0.045 });
      if (Math.random() < 0.5) bubble(0.04, 0.015);
    } else if (kind === "shadow") {
      // Cloth dragged over stone.
      noise({ dur: 0.12, vol: 0.05, filterFreq: jitter(1300), filterEnd: 700, type: "bandpass", q: 1, attack: 0.03, color: "pink" });
    } else if (kind === "boss") {
      // The floor takes its weight; grit shaken loose.
      saturated(0.3, () => {
        tone({ type: "sine", freq: jitter(58), freqEnd: 30, dur: 0.3, vol: 0.22 });
        noise({ dur: 0.22, vol: 0.08, filterFreq: 320, filterEnd: 80, color: "brown" });
      });
      crackle({ dur: 0.35, count: 4, vol: 0.015, freq: 2200, spread: 0.5, delay: 0.04, grain: 0.015 });
    }
  }, kind === "boss" ? 1.6 : 1, ENEMY_SIZE[kind]);
}

/** It falls. */
export function playEnemyDeath(kind: EnemyVoice, at: At): void {
  atPoint(at, 1.3, () => {
    switch (kind) {
      case "slime":
        // A splat, sinking, its last bubbles.
        noise({ dur: 0.08, vol: 0.06, filterFreq: 1800, type: "bandpass", q: 1, attack: 0.002 });
        tone({ type: "sine", freq: 220, freqEnd: 50, dur: 0.5, vol: 0.11 });
        noise({ dur: 0.45, vol: 0.05, filterFreq: 1300, filterEnd: 250, type: "bandpass", q: 3, color: "pink" });
        for (let i = 0; i < 4; i++) bubble(0.12 + i * 0.1 + Math.random() * 0.05, 0.02 * (1 - i * 0.2), jitter(420 - i * 60, 0.2));
        break;
      case "wisp":
        // Its light shatters into chimes, falling.
        for (let i = 0; i < 5; i++) strike({ freq: jitter(1760 + i * 440, 0.06), dur: 0.7, vol: 0.022, modes: "glass", delay: i * 0.04 + Math.random() * 0.02 });
        fm({ freq: 1500, freqEnd: 400, dur: 0.6, vol: 0.02, ratio: 1.41, index: 2 });
        break;
      case "shadow":
        // A last breath, torn away.
        voice({ freq: 0, dur: 0.9, vol: 0.07, attack: 0.02, vowel: "a", vowelEnd: "u", breath: true, q: 5 });
        noise({ dur: 0.9, vol: 0.05, filterFreq: 3200, filterEnd: 300, type: "bandpass", q: 1.6, color: "pink" });
        tone({ type: "sine", freq: 90, freqEnd: 40, dur: 0.8, vol: 0.07, detune: 25 });
        break;
      case "sentry":
        // Sparks, its works winding down, a clunk.
        crackle({ dur: 0.3, count: 6, vol: 0.04, freq: 3800, spread: 0.4, grain: 0.01 });
        tone({ type: "sawtooth", freq: 620, freqEnd: 70, dur: 0.7, vol: 0.05, bright: 5 });
        strike({ freq: 240, dur: 0.15, vol: 0.06, modes: "metal", delay: 0.6 });
        break;
      case "boss":
        break; // it roars as it falls (playBossRoar)
    }
  }, 1.3, ENEMY_SIZE[kind]);
}

// ── Lasting sounds: torches, rifts ─────────────────────────────────────────

export interface Loop {
  emitter: Emitter;
  stop(): void;
}

/** A lasting sound that may be voiced (a torch, a rift). */
export interface LoopSource {
  key: string;
  at: At;
  /** Metres (as the crow flies) beyond which it isn't even considered. */
  reach: number;
  level: number;
}

/** Quieter than this at the listener: not worth a voice. */
const MIN_AUDIBLE = 0.04;

/** Which lasting sounds get a voice: the `max` that reach you loudest, the
 * way sound travels — not the nearest as the crow flies, or the torch
 * behind the rock takes the place of the one round the corner you just
 * came from. One already sounding keeps its place unless another is
 * clearly louder (no churn as you walk). */
export function chooseLoops<T extends LoopSource>(sources: readonly T[], sounding: (key: string) => boolean, max: number): T[] {
  const l = listenerAt();
  return sources
    .filter((s) => Math.hypot(s.at[0] - l.x, s.at[2] - l.z) < s.reach)
    .map((s) => ({ s, a: audibility(s.at, s.level) * (sounding(s.key) ? 1.5 : 1) }))
    .filter(({ a }) => a > MIN_AUDIBLE)
    .sort((x, y) => y.a - x.a)
    .slice(0, max)
    .map(({ s }) => s);
}

let torchBuf: AudioBuffer | null = null;

/** Three seconds of a torch: a low roar of flame with crackles popping in
 * it (Poisson-timed clicks of noise, each its own size), seamless. */
function crackleBuffer(ctx: AudioContext): AudioBuffer {
  if (torchBuf) return torchBuf;
  const sr = ctx.sampleRate;
  const len = sr * 3;
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  let lp = 0;
  for (let i = 0; i < len; i++) {
    lp += (Math.random() * 2 - 1 - lp) * 0.035;
    d[i] = lp * 0.9 * (0.8 + 0.2 * Math.sin((i / sr) * Math.PI * 2 * (2 / 3)));
  }
  for (let t = Math.random() * 0.1; t < 3; t -= Math.log(Math.random()) / 11) {
    const at = Math.floor(t * sr);
    const amp = 0.15 + Math.random() ** 2 * 0.85;
    const n = 20 + Math.floor(Math.random() * 160);
    let prev = 0;
    for (let k = 0; k < n && at + k < len; k++) {
      const x = Math.random() * 2 - 1;
      d[at + k]! += (x - prev) * amp * Math.exp((-k * 4) / n) * 0.6;
      prev = x;
    }
  }
  // Seamless: the last 60 ms blend into the first.
  const fade = Math.floor(sr * 0.06);
  for (let k = 0; k < fade; k++) {
    const w = k / fade;
    d[len - fade + k] = d[len - fade + k]! * (1 - w) + d[k]! * w;
  }
  torchBuf = buf;
  return buf;
}

/** A torch burning at `at`. */
export function startTorch(at: At, level = 1): Loop | null {
  const ctx = audioCtx();
  if (!ctx) return null;
  const e = emitterAt(at, level, 0.25);
  if (!e) return null;
  const src = ctx.createBufferSource();
  src.buffer = crackleBuffer(ctx);
  src.loop = true;
  src.playbackRate.value = 0.85 + Math.random() * 0.3;
  const g = ctx.createGain();
  g.gain.value = 0;
  g.gain.setTargetAtTime(0.22, ctx.currentTime, 0.4);
  src.connect(g).connect(e.input);
  src.start(ctx.currentTime, Math.random() * 3);
  return {
    emitter: e,
    stop() {
      g.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
      src.stop(ctx.currentTime + 0.8);
      e.release(0.7);
    },
  };
}

/** A rift humming at `at`: two detuned tones a fifth apart, breathing, over
 * a swirl of air. `pitch` sets the root (the way home sings higher). */
export function startRiftHum(at: At, pitch = 98, level = 1): Loop | null {
  const ctx = audioCtx();
  const nb = noiseBuf();
  if (!ctx || !nb) return null;
  // A rift is big: across a hall it's a point, beside it it's all round you.
  const e = emitterAt(at, level, 1.2);
  if (!e) return null;
  const t = ctx.currentTime;
  const out = ctx.createGain();
  out.gain.value = 0;
  out.gain.setTargetAtTime(1, t, 0.6);
  out.connect(e.input);
  const nodes: AudioScheduledSourceNode[] = [];
  for (const [f, v] of [
    [pitch, 0.05],
    [pitch * 1.5 + 0.7, 0.03],
    [pitch * 2 - 0.4, 0.015],
  ] as const) {
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.value = f;
    const g = ctx.createGain();
    g.gain.value = v;
    o.connect(g).connect(out);
    o.start(t);
    nodes.push(o);
  }
  const air = ctx.createBufferSource();
  air.buffer = nb;
  air.loop = true;
  air.playbackRate.value = 0.6;
  const band = ctx.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = 700;
  band.Q.value = 2.5;
  const swirl = ctx.createOscillator();
  swirl.frequency.value = 0.35;
  const depth = ctx.createGain();
  depth.gain.value = 380;
  swirl.connect(depth).connect(band.frequency);
  const ag = ctx.createGain();
  ag.gain.value = 0.035;
  air.connect(band).connect(ag).connect(out);
  air.start(t);
  swirl.start(t);
  nodes.push(air, swirl);
  return {
    emitter: e,
    stop() {
      const now = ctx.currentTime;
      out.gain.setTargetAtTime(0, now, 0.2);
      for (const n of nodes) n.stop(now + 1);
      e.release(0.9);
    },
  };
}

// ── What a place says by itself ─────────────────────────────────────────────

export type RoomVoice = "drip" | "chime" | "ember" | "groan" | "settle" | "skitter" | "cricket" | "owl";

/** How big each sounds (radius, m): a drip is a point, the dungeon's groan
 * is the stone itself. */
const ROOM_VOICE_SIZE: Record<RoomVoice, number> = { drip: 0.05, chime: 0.15, ember: 0.1, groan: 6, settle: 2, skitter: 0.4, cricket: 0.05, owl: 0.3 };

/** A small sound the place makes at `at`. */
export function playRoomVoice(v: RoomVoice, at: At): void {
  atPoint(at, v === "groan" || v === "chime" ? 2.4 : v === "owl" ? 1.4 : 0.6, () => {
    switch (v) {
      case "drip": {
        // The drop's chirp, a smaller one after it, and the pool ringing.
        const f = jitter(1100, 0.25);
        tone({ type: "sine", freq: f, freqEnd: f * 2.2, dur: 0.06, vol: 0.05 });
        noise({ dur: 0.03, vol: 0.015, filterFreq: 4000, type: "bandpass", q: 3 });
        if (Math.random() < 0.6) tone({ type: "sine", freq: f * 1.3, freqEnd: f * 2.6, dur: 0.04, vol: 0.015, delay: jitter(0.07, 0.3) });
        break;
      }
      case "chime": {
        // A crystal ringing by itself.
        const base = [1568, 1760, 2093, 2349][Math.floor(Math.random() * 4)]!;
        strike({ freq: base, dur: 2.2, vol: 0.013, modes: "glass", beat: 2, attack: 0.01 });
        break;
      }
      case "ember":
        noise({ dur: 0.04, vol: 0.05, filterFreq: jitter(3200), type: "bandpass", q: 1.5, attack: 0.001 });
        crackle({ dur: 0.25, count: 3, vol: 0.032, freq: 2600, spread: 0.4, delay: 0.03 });
        noise({ dur: 0.35, vol: 0.015, filterFreq: 1800, filterEnd: 600, type: "bandpass", q: 1, delay: 0.03, color: "pink" });
        break;
      case "groan":
        // The stone itself, creaking under the weight above.
        voice({ freq: jitter(42, 0.1), freqEnd: 34, dur: 2.2, vol: 0.095, attack: 0.6, vowel: "o", vowelEnd: "u", rattle: jitter(9, 0.2), size: 0.6 });
        noise({ dur: 2, vol: 0.025, filterFreq: 220, filterEnd: 120, attack: 0.6, color: "brown" });
        break;
      case "settle":
        // A knock deep in the wall, grit trickling down after it.
        strike({ freq: jitter(70), dur: 0.25, vol: 0.035, modes: "stone" });
        crackle({ dur: 0.35, count: 5, vol: 0.02, freq: 3000, spread: 0.3, delay: 0.1, grain: 0.02, q: 3, decay: 0.3 });
        break;
      case "skitter":
        for (let i = 0; i < 7; i++) noise({ dur: 0.012, vol: 0.018, filterFreq: jitter(4200, 0.2), type: "bandpass", q: 4, delay: i * 0.035 + Math.random() * 0.015 });
        break;
      case "cricket": {
        // Two chirps, each a few quick pulses of one high note.
        const f = jitter(4400, 0.03);
        for (let c = 0; c < 2; c++) for (let i = 0; i < 4; i++) tone({ type: "sine", freq: f, dur: 0.016, vol: 0.012, attack: 0.003, delay: c * 0.16 + i * 0.024 });
        break;
      }
      case "owl":
        // Hoo… hoo-oo: a soft tone and the breath through it.
        tone({ type: "sine", freq: 330, freqEnd: 300, dur: 0.35, vol: 0.026, attack: 0.05, hold: 0.3, vibrato: [6, 10] });
        noise({ dur: 0.35, vol: 0.003, filterFreq: 330, type: "bandpass", q: 6, attack: 0.05, color: "pink" });
        tone({ type: "sine", freq: 300, freqEnd: 270, dur: 0.55, vol: 0.022, delay: 0.5, attack: 0.08, hold: 0.3, vibrato: [6, 10] });
        noise({ dur: 0.55, vol: 0.0027, filterFreq: 300, type: "bandpass", q: 6, attack: 0.08, delay: 0.5, color: "pink" });
        break;
    }
  }, 1, ROOM_VOICE_SIZE[v]);
}

/** Your own landing: a thump scaled by how hard, and the knees taking it. */
export function playLanding(ground: Ground, strength: number): void {
  self(() => {
    tone({ type: "sine", freq: 80, freqEnd: 40, dur: 0.16, vol: Math.min(0.18, 0.06 + strength * 0.12) });
    noise({ dur: 0.12, vol: Math.min(0.06, 0.02 + strength * 0.04), filterFreq: 400, filterEnd: 120, color: "brown" });
  });
  playFootstep(ground, 1 + strength);
}
