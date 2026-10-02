import { audioCtx, noiseBuf } from "./context";
import { atPoint, self, synthNoise as noise, synthTone as tone } from "./sound";
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

/** One footfall on `ground` — yours (from where you stand) or someone's
 * `at` their feet. `loud` 0…1+ (a landing is louder). */
export function playFootstep(ground: Ground, loud = 1, at?: At): void {
  atPoint(at, 0.3, () => {
    const v = 0.9 + Math.random() * 0.2;
    if (ground === "grass") {
      noise({ dur: 0.09, vol: 0.03 * loud * v, filterFreq: jitter(1300), filterEnd: 500 });
      tone({ type: "sine", freq: jitter(80), freqEnd: 50, dur: 0.06, vol: 0.03 * loud });
      return;
    }
    if (ground === "ash") {
      noise({ dur: 0.1, vol: 0.05 * loud * v, filterFreq: jitter(900), filterEnd: 280 });
      tone({ type: "sine", freq: jitter(75), freqEnd: 45, dur: 0.07, vol: 0.04 * loud });
      return;
    }
    // Hard ground: a heel's click and the thump under it, then the toe
    // rolling down a few tens of milliseconds later — never quite the same
    // step twice.
    const click = jitter(ground === "cobble" ? 2100 : ground === "iron" ? 2600 : 1600, 0.15);
    noise({ dur: 0.045, vol: 0.05 * loud * v, filterFreq: click, filterEnd: 800, type: "bandpass", q: 1.3 });
    tone({ type: "sine", freq: jitter(88), freqEnd: 50, dur: 0.05, vol: 0.045 * loud });
    noise({ dur: 0.03, vol: 0.022 * loud * v, filterFreq: click * 1.4, type: "bandpass", q: 1.6, delay: jitter(0.045, 0.3) });
    if (ground === "cobble") noise({ dur: 0.03, vol: 0.025 * loud, filterFreq: jitter(2600), type: "bandpass", q: 2, delay: 0.018 });
    if (ground === "wet") noise({ dur: 0.15, vol: 0.035 * loud * v, filterFreq: jitter(2800), filterEnd: 1200, type: "bandpass", q: 0.9, delay: 0.01 });
    if (ground === "crystal") tone({ type: "sine", freq: [2093, 2637, 3136][Math.floor(Math.random() * 3)]!, dur: 0.2, vol: 0.012 * loud });
    if (ground === "iron") tone({ type: "triangle", freq: jitter(520, 0.05), freqEnd: 500, dur: 0.14, vol: 0.012 * loud });
  });
}

// ── The creatures ───────────────────────────────────────────────────────────

/** Enemy kinds as they sound (useEnemy's `kind`). */
export type EnemyVoice = "slime" | "wisp" | "shadow" | "sentry" | "boss";

const VOICES = new Set<string>(["slime", "wisp", "shadow", "sentry", "boss"]);
export const isEnemyVoice = (k: string): k is EnemyVoice => VOICES.has(k);

/** Metres an enemy walks between footfalls (0: it doesn't walk). */
export const ENEMY_STRIDE: Record<EnemyVoice, number> = { slime: 1.1, wisp: 0, shadow: 0.9, sentry: 0, boss: 2.2 };

/** It has noticed you. */
export function playEnemyWake(kind: EnemyVoice, at: At): void {
  atPoint(at, 0.9, () => {
    switch (kind) {
      case "slime":
        tone({ type: "sine", freq: jitter(190), freqEnd: 85, dur: 0.28, vol: 0.12 });
        noise({ dur: 0.22, vol: 0.06, filterFreq: 900, filterEnd: 300, type: "bandpass", q: 2.5 });
        break;
      case "wisp":
        tone({ type: "sine", freq: jitter(880), freqEnd: 1320, dur: 0.25, vol: 0.05 });
        tone({ type: "sine", freq: jitter(1320), freqEnd: 1760, dur: 0.3, vol: 0.035, delay: 0.08 });
        break;
      case "shadow":
        noise({ dur: 0.7, vol: 0.07, filterFreq: 2800, filterEnd: 1600, type: "bandpass", q: 3, attack: 0.15 });
        tone({ type: "sine", freq: 70, freqEnd: 58, dur: 0.6, vol: 0.08 });
        break;
      case "sentry":
        tone({ type: "square", freq: 310, dur: 0.04, vol: 0.05 });
        tone({ type: "sine", freq: 600, freqEnd: 940, dur: 0.35, vol: 0.04, delay: 0.05 });
        break;
      case "boss":
        break; // it roars (playBossRoar)
    }
  }, 1.3);
}

/** A footfall (or a slither). */
export function playEnemyStep(kind: EnemyVoice, at: At): void {
  atPoint(at, 0.35, () => {
    if (kind === "slime") {
      noise({ dur: 0.08, vol: 0.05, filterFreq: jitter(700), filterEnd: 350, type: "bandpass", q: 2 });
      tone({ type: "sine", freq: jitter(140), freqEnd: 80, dur: 0.07, vol: 0.05 });
    } else if (kind === "shadow") {
      noise({ dur: 0.1, vol: 0.03, filterFreq: jitter(1300), filterEnd: 700, type: "bandpass", q: 1 });
    } else if (kind === "boss") {
      tone({ type: "sine", freq: jitter(58), freqEnd: 32, dur: 0.28, vol: 0.22 });
      noise({ dur: 0.2, vol: 0.09, filterFreq: 320, filterEnd: 90 });
    }
  }, kind === "boss" ? 1.6 : 1);
}

/** It falls. */
export function playEnemyDeath(kind: EnemyVoice, at: At): void {
  atPoint(at, 1.1, () => {
    switch (kind) {
      case "slime":
        tone({ type: "sine", freq: 220, freqEnd: 50, dur: 0.5, vol: 0.12 });
        noise({ dur: 0.45, vol: 0.06, filterFreq: 1200, filterEnd: 200, type: "bandpass", q: 1.5 });
        break;
      case "wisp":
        for (let i = 0; i < 4; i++) tone({ type: "sine", freq: jitter(1760 + i * 440, 0.04), freqEnd: 900, dur: 0.6, vol: 0.025, delay: i * 0.04 });
        break;
      case "shadow":
        noise({ dur: 0.9, vol: 0.08, filterFreq: 3200, filterEnd: 300, type: "bandpass", q: 1.6 });
        tone({ type: "sine", freq: 90, freqEnd: 40, dur: 0.8, vol: 0.07 });
        break;
      case "sentry":
        tone({ type: "sawtooth", freq: 620, freqEnd: 70, dur: 0.7, vol: 0.05 });
        noise({ dur: 0.12, vol: 0.06, filterFreq: 2400, type: "bandpass", q: 2 });
        break;
      case "boss":
        break; // it roars as it falls (playBossRoar)
    }
  }, 1.3);
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

let crackle: AudioBuffer | null = null;

/** Three seconds of a torch: a low roar of flame with crackles popping in
 * it (Poisson-timed clicks of noise, each its own size), seamless. */
function crackleBuffer(ctx: AudioContext): AudioBuffer {
  if (crackle) return crackle;
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
  crackle = buf;
  return buf;
}

/** A torch burning at `at`. */
export function startTorch(at: At, level = 1): Loop | null {
  const ctx = audioCtx();
  if (!ctx) return null;
  const e = emitterAt(at, level);
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
  const e = emitterAt(at, level);
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

/** A small sound the place makes at `at`. */
export function playRoomVoice(v: RoomVoice, at: At): void {
  atPoint(at, v === "groan" || v === "chime" ? 2.4 : v === "owl" ? 1.4 : 0.6, () => {
    switch (v) {
      case "drip": {
        const f = jitter(1100, 0.25);
        tone({ type: "sine", freq: f, freqEnd: f * 2.2, dur: 0.06, vol: 0.05 });
        noise({ dur: 0.03, vol: 0.015, filterFreq: 4000, type: "bandpass", q: 3 });
        break;
      }
      case "chime": {
        const base = [1568, 1760, 2093, 2349][Math.floor(Math.random() * 4)]!;
        tone({ type: "sine", freq: base, dur: 2.2, vol: 0.02 });
        tone({ type: "sine", freq: base * 2.76, dur: 1.2, vol: 0.006, delay: 0.01 });
        break;
      }
      case "ember":
        noise({ dur: 0.04, vol: 0.05, filterFreq: jitter(3200), type: "bandpass", q: 1.5 });
        noise({ dur: 0.35, vol: 0.02, filterFreq: 1800, filterEnd: 600, type: "bandpass", q: 1, delay: 0.03 });
        break;
      case "groan":
        tone({ type: "sawtooth", freq: jitter(42, 0.1), freqEnd: 34, dur: 2.2, vol: 0.05, attack: 0.6 });
        noise({ dur: 2, vol: 0.03, filterFreq: 220, filterEnd: 120, attack: 0.6 });
        break;
      case "settle":
        tone({ type: "sine", freq: jitter(70), freqEnd: 40, dur: 0.18, vol: 0.06 });
        for (let i = 0; i < 4; i++) noise({ dur: 0.02, vol: 0.02, filterFreq: jitter(3000, 0.3), type: "bandpass", q: 3, delay: 0.1 + i * 0.06 + Math.random() * 0.05 });
        break;
      case "skitter":
        for (let i = 0; i < 7; i++) noise({ dur: 0.012, vol: 0.018, filterFreq: jitter(4200, 0.2), type: "bandpass", q: 4, delay: i * 0.035 + Math.random() * 0.015 });
        break;
      case "cricket":
        for (let i = 0; i < 3; i++) tone({ type: "sine", freq: jitter(4400, 0.03), dur: 0.035, vol: 0.012, delay: i * 0.07 });
        break;
      case "owl":
        tone({ type: "sine", freq: 330, freqEnd: 300, dur: 0.35, vol: 0.04, attack: 0.05 });
        tone({ type: "sine", freq: 300, freqEnd: 270, dur: 0.55, vol: 0.035, delay: 0.5, attack: 0.08 });
        break;
    }
  });
}

/** Your own landing: a thump scaled by how hard. */
export function playLanding(ground: Ground, strength: number): void {
  self(() => {
    tone({ type: "sine", freq: 80, freqEnd: 40, dur: 0.16, vol: Math.min(0.18, 0.06 + strength * 0.12) });
  });
  playFootstep(ground, 1 + strength);
}
