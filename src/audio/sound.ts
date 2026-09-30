/** Procedural WebAudio — every sound is synthesized, keeping the zero-asset
 * pipeline. The context is created lazily on the first user gesture (autoplay
 * policy); every play call is a safe no-op before that. */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;
let ambientStop: (() => void) | null = null;
let pendingAmbient: "village" | "dungeon" | null = null;
let pendingMood: AmbientMood | undefined;

function ensureContext(): void {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.45;
    master.connect(ctx.destination);
    const len = ctx.sampleRate * 2;
    noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === "suspended") void ctx.resume();
}

/** Call once at app start: arms a one-time gesture listener. */
export function initAudio(): void {
  const unlock = () => {
    ensureContext();
    if (pendingAmbient) {
      const kind = pendingAmbient;
      pendingAmbient = null;
      startAmbient(kind, pendingMood);
    }
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
}

interface ToneOptions {
  type?: OscillatorType;
  freq: number;
  freqEnd?: number;
  dur: number;
  vol?: number;
  delay?: number;
}

function tone({ type = "sine", freq, freqEnd, dur, vol = 0.2, delay = 0 }: ToneOptions): void {
  if (!ctx || !master) return;
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (freqEnd !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 1), t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

interface NoiseOptions {
  dur: number;
  vol?: number;
  filterFreq: number;
  filterEnd?: number;
  q?: number;
  delay?: number;
  type?: BiquadFilterType;
}

function noise({ dur, vol = 0.2, filterFreq, filterEnd, q = 0.8, delay = 0, type = "lowpass" }: NoiseOptions): void {
  if (!ctx || !master || !noiseBuffer) return;
  const t0 = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;
  src.playbackRate.value = 0.7 + Math.random() * 0.6;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.Q.value = q;
  filter.frequency.setValueAtTime(filterFreq, t0);
  if (filterEnd !== undefined) filter.frequency.exponentialRampToValueAtTime(Math.max(filterEnd, 20), t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(filter).connect(g).connect(master);
  src.start(t0);
  src.stop(t0 + dur + 0.05);
}

/** The two synth voices, for sound banks kept in their own modules
 * (audio/uiSounds.ts) — same master bus, same zero-asset rule. */
export { noise as synthNoise, tone as synthTone };
export type { NoiseOptions, ToneOptions };

// ── Game sounds ──────────────────────────────────────────────────────────────

export function playCast(): void {
  tone({ type: "square", freq: 640 + Math.random() * 120, freqEnd: 170, dur: 0.13, vol: 0.1 });
  noise({ dur: 0.09, vol: 0.05, filterFreq: 2600, filterEnd: 500, type: "bandpass", q: 2 });
}

export function playExplosion(radius: number): void {
  const size = Math.min(radius / 4, 1.6);
  noise({ dur: 0.32 + size * 0.2, vol: 0.22 + size * 0.1, filterFreq: 1100, filterEnd: 90 });
  tone({ type: "sine", freq: 110, freqEnd: 34, dur: 0.34 + size * 0.15, vol: 0.28 });
}

export function playHit(): void {
  tone({ type: "triangle", freq: 320 + Math.random() * 80, freqEnd: 110, dur: 0.08, vol: 0.12 });
}

export function playHurt(): void {
  tone({ type: "sawtooth", freq: 170, freqEnd: 65, dur: 0.22, vol: 0.16 });
  noise({ dur: 0.16, vol: 0.08, filterFreq: 700, filterEnd: 150 });
}

export function playPickup(): void {
  tone({ type: "sine", freq: 520, dur: 0.1, vol: 0.12 });
  tone({ type: "sine", freq: 660, dur: 0.12, vol: 0.12, delay: 0.09 });
  tone({ type: "sine", freq: 880, dur: 0.18, vol: 0.1, delay: 0.18 });
}

export function playJump(): void {
  tone({ type: "sine", freq: 170, freqEnd: 300, dur: 0.09, vol: 0.06 });
}

export function playDash(): void {
  noise({ dur: 0.22, vol: 0.12, filterFreq: 400, filterEnd: 3200, type: "bandpass", q: 1.4 });
}

export function playPortal(): void {
  for (let i = 0; i < 3; i++) {
    tone({ type: "sine", freq: 380 + i * 140, freqEnd: 760 + i * 180, dur: 0.7, vol: 0.07, delay: i * 0.07 });
  }
  noise({ dur: 0.8, vol: 0.05, filterFreq: 900, filterEnd: 2600, type: "bandpass", q: 3 });
}

export function playBossRoar(): void {
  tone({ type: "sawtooth", freq: 90, freqEnd: 42, dur: 0.9, vol: 0.22 });
  tone({ type: "square", freq: 61, freqEnd: 30, dur: 1.1, vol: 0.14, delay: 0.05 });
  noise({ dur: 0.9, vol: 0.12, filterFreq: 500, filterEnd: 80 });
}

// ── Encounters, lore & omens ─────────────────────────────────────────────────

/** Another wizard has entered the floor — a low, uneasy swell. No name, no
 * direction: just the knowledge that you're not alone anymore. */
export function playPresence(): void {
  tone({ type: "sine", freq: 58, freqEnd: 74, dur: 2.2, vol: 0.16 });
  tone({ type: "triangle", freq: 233, freqEnd: 220, dur: 1.8, vol: 0.035, delay: 0.3 });
  noise({ dur: 2, vol: 0.05, filterFreq: 180, filterEnd: 520, type: "bandpass", q: 4 });
}

/** One heartbeat (lub-dub). Played by the presence system faster and louder
 * as a hostile wizard closes in. */
export function playHeartbeat(intensity: number): void {
  const v = 0.05 + Math.min(1, Math.max(0, intensity)) * 0.13;
  tone({ type: "sine", freq: 62, freqEnd: 40, dur: 0.14, vol: v });
  tone({ type: "sine", freq: 55, freqEnd: 36, dur: 0.12, vol: v * 0.75, delay: 0.17 });
}

/** A pact is sworn — two tones settling into a fifth. */
export function playPactSworn(): void {
  tone({ type: "sine", freq: 294, dur: 0.9, vol: 0.09 });
  tone({ type: "sine", freq: 440, dur: 1.1, vol: 0.08, delay: 0.12 });
  tone({ type: "triangle", freq: 588, dur: 0.8, vol: 0.03, delay: 0.24 });
}

/** A pact breaks — a tritone snapping apart. */
export function playPactBroken(): void {
  tone({ type: "sawtooth", freq: 311, freqEnd: 290, dur: 0.5, vol: 0.07 });
  tone({ type: "sawtooth", freq: 440, freqEnd: 470, dur: 0.5, vol: 0.06 });
  noise({ dur: 0.3, vol: 0.06, filterFreq: 1800, filterEnd: 300, type: "bandpass", q: 2 });
}

/** A grave rises where a wizard fell. */
export function playGraveRise(): void {
  tone({ type: "sine", freq: 196, freqEnd: 98, dur: 1.6, vol: 0.12 });
  tone({ type: "triangle", freq: 392, freqEnd: 370, dur: 1.4, vol: 0.04, delay: 0.2 });
  noise({ dur: 1.2, vol: 0.06, filterFreq: 300, filterEnd: 90 });
}

/** A lore rune is read — breathy whisper over a faint chord. */
export function playWhisper(): void {
  noise({ dur: 1.4, vol: 0.07, filterFreq: 1400, filterEnd: 2600, type: "bandpass", q: 6 });
  tone({ type: "sine", freq: 523, dur: 1.2, vol: 0.03, delay: 0.1 });
  tone({ type: "sine", freq: 659, dur: 1.2, vol: 0.025, delay: 0.25 });
}

/** The floor's omen announces itself on arrival. */
export function playOmen(): void {
  tone({ type: "sine", freq: 110, freqEnd: 104, dur: 2.6, vol: 0.12 });
  tone({ type: "sine", freq: 164.8, freqEnd: 156, dur: 2.4, vol: 0.07, delay: 0.15 });
  noise({ dur: 2.4, vol: 0.04, filterFreq: 600, filterEnd: 200, type: "bandpass", q: 5 });
}

/** The Weighing Gate reads your gear. */
export function playWeighing(): void {
  for (let i = 0; i < 4; i++) {
    tone({ type: "sine", freq: 220 * (1 + i * 0.5), freqEnd: 110 * (1 + i * 0.5), dur: 1.4, vol: 0.05, delay: i * 0.1 });
  }
}

// ── Ambient beds ─────────────────────────────────────────────────────────────

/** Optional coloring for the dungeon bed, per depth biome. */
export interface AmbientMood {
  /** Drone fundamental (Hz). */
  drone: number;
  /** Cavern-hiss lowpass cutoff (Hz) — higher = airier, wetter. */
  wind: number;
  /** Drone loudness multiplier. */
  weight?: number;
}

const DUNGEON_MOOD: AmbientMood = { drone: 41, wind: 220, weight: 1 };
const VILLAGE_MOOD: AmbientMood = { drone: 55, wind: 480, weight: 1 };

export function startAmbient(kind: "village" | "dungeon", mood?: AmbientMood): void {
  stopAmbient();
  if (!ctx || !master || !noiseBuffer) {
    // Context not unlocked yet — start this bed on the first gesture.
    pendingAmbient = kind;
    pendingMood = mood;
    return;
  }
  const m = mood ?? (kind === "dungeon" ? DUNGEON_MOOD : VILLAGE_MOOD);
  const nodes: AudioNode[] = [];
  const sources: (OscillatorNode | AudioBufferSourceNode)[] = [];
  const bed = ctx.createGain();
  bed.gain.value = 0;
  bed.gain.linearRampToValueAtTime(1, ctx.currentTime + 2);
  bed.connect(master);
  nodes.push(bed);

  for (const detune of [0, 0.6]) {
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = m.drone + detune;
    const g = ctx.createGain();
    g.gain.value = (kind === "dungeon" ? 0.05 : 0.03) * (m.weight ?? 1);
    osc.connect(g).connect(bed);
    osc.start();
    sources.push(osc);
    nodes.push(g);
  }

  // Wind / cavern hiss.
  const wind = ctx.createBufferSource();
  wind.buffer = noiseBuffer;
  wind.loop = true;
  wind.playbackRate.value = 0.4;
  const windFilter = ctx.createBiquadFilter();
  windFilter.type = "lowpass";
  windFilter.frequency.value = m.wind;
  const windGain = ctx.createGain();
  windGain.gain.value = kind === "dungeon" ? 0.035 : 0.05;
  // Slow swell via LFO.
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.07;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = kind === "dungeon" ? 0.018 : 0.03;
  lfo.connect(lfoGain).connect(windGain.gain);
  lfo.start();
  wind.connect(windFilter).connect(windGain).connect(bed);
  wind.start();
  sources.push(wind, lfo);
  nodes.push(windFilter, windGain, lfoGain);

  ambientStop = () => {
    const now = ctx!.currentTime;
    bed.gain.cancelScheduledValues(now);
    bed.gain.setValueAtTime(bed.gain.value, now);
    bed.gain.linearRampToValueAtTime(0, now + 0.6);
    setTimeout(() => {
      for (const s of sources) {
        try {
          s.stop();
        } catch {
          // already stopped
        }
      }
      for (const n of nodes) n.disconnect();
    }, 700);
  };
}

export function stopAmbient(): void {
  pendingAmbient = null;
  ambientStop?.();
  ambientStop = null;
}
