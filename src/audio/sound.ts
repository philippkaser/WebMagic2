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
  /** Seconds to reach full volume (default: a click-free 8 ms). Long attacks
   * make swells — rushes and risers rather than hits. */
  attack?: number;
}

function tone({ type = "sine", freq, freqEnd, dur, vol = 0.2, delay = 0, attack = 0.008 }: ToneOptions): void {
  if (!ctx || !master) return;
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (freqEnd !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 1), t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + Math.min(attack, dur * 0.95));
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
  /** Seconds to reach full volume (default 12 ms); see ToneOptions.attack. */
  attack?: number;
}

function noise({
  dur,
  vol = 0.2,
  filterFreq,
  filterEnd,
  q = 0.8,
  delay = 0,
  type = "lowpass",
  attack = 0.012,
}: NoiseOptions): void {
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
  g.gain.exponentialRampToValueAtTime(vol, t0 + Math.min(attack, dur * 0.95));
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

// ── Travel: portals, the tunnel, death and the way back ─────────────────────
// (transition/TransitionSystem plays these on the journey's stage changes.)

/** Being pulled into a portal: a rush of air swelling into a whistle, a
 * chord bending upward, and a sub "thoom" as the vortex closes over you.
 * `bright` 0…1 lifts the pitch — cyan descents sit lower than gold homecomings. */
export function playPortalEnter(bright = 0.5): void {
  noise({ dur: 1, vol: 0.17, filterFreq: 240, filterEnd: 3600, type: "bandpass", q: 1.4, attack: 0.75 });
  noise({ dur: 0.9, vol: 0.05, filterFreq: 1800, filterEnd: 7200, type: "bandpass", q: 6, delay: 0.15, attack: 0.6 });
  const base = 170 + bright * 90;
  tone({ type: "sine", freq: base, freqEnd: base * 3.2, dur: 0.95, vol: 0.07, attack: 0.6 });
  tone({ type: "triangle", freq: base * 1.5, freqEnd: base * 4.6, dur: 0.9, vol: 0.03, delay: 0.05, attack: 0.55 });
  tone({ type: "sine", freq: 96, freqEnd: 30, dur: 0.7, vol: 0.22, delay: 0.84 });
}

/** The tunnel: rushing air swept by a slow LFO over a low two-voice drone
 * with a little vibrato. Loops until the returned stop() (which fades out).
 * `pitch` is the drone's root in Hz; `air` scales the rush (0 = drone only). */
export function startTunnelRush(pitch = 55, air = 1): () => void {
  if (!ctx || !master || !noiseBuffer) return () => {};
  const c = ctx;
  const now = c.currentTime;
  const out = c.createGain();
  out.gain.setValueAtTime(0.0001, now);
  out.gain.exponentialRampToValueAtTime(1, now + 0.2);
  out.connect(master);

  const rush = c.createBufferSource();
  rush.buffer = noiseBuffer;
  rush.loop = true;
  const band = c.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = 900;
  band.Q.value = 0.8;
  const sweep = c.createOscillator();
  sweep.frequency.value = 0.8;
  const sweepDepth = c.createGain();
  sweepDepth.gain.value = 500;
  sweep.connect(sweepDepth).connect(band.frequency);
  const rushGain = c.createGain();
  rushGain.gain.value = 0.1 * air;
  rush.connect(band).connect(rushGain).connect(out);

  const low = c.createBiquadFilter();
  low.type = "lowpass";
  low.frequency.value = 520;
  const droneGain = c.createGain();
  droneGain.gain.value = 0.035;
  low.connect(droneGain).connect(out);
  const vib = c.createOscillator();
  vib.frequency.value = 5.5;
  const vibDepth = c.createGain();
  vibDepth.gain.value = pitch * 0.012;
  vib.connect(vibDepth);
  const voices: OscillatorNode[] = [];
  for (const mult of [1, 1.5]) {
    const o = c.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = pitch * mult;
    vibDepth.connect(o.frequency);
    o.connect(low);
    voices.push(o);
  }

  const sources = [rush, sweep, vib, ...voices];
  for (const s of sources) s.start(now);
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    const t = c.currentTime;
    out.gain.cancelScheduledValues(t);
    out.gain.setValueAtTime(Math.max(out.gain.value, 0.0001), t);
    out.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    for (const s of sources) s.stop(t + 0.4);
    setTimeout(() => out.disconnect(), 500);
  };
}

/** Spat out the other side: a pop of air, a landing thump, a chord blooming.
 * `bright` as in playPortalEnter. */
export function playPortalArrive(bright = 0.5): void {
  noise({ dur: 0.55, vol: 0.12, filterFreq: 3200, filterEnd: 180 });
  tone({ type: "sine", freq: 74, freqEnd: 38, dur: 0.45, vol: 0.2 });
  const root = 294 + bright * 98;
  const chord = [1, 1.26, 1.5, 2];
  for (let i = 0; i < chord.length; i++) {
    tone({ type: "sine", freq: root * chord[i], dur: 1.3, vol: 0.04, delay: 0.03 * i, attack: 0.05 });
  }
}

/** Falling: a long sinking tone, a breath let go, and a heart that slows. */
export function playDeathFade(): void {
  tone({ type: "sine", freq: 110, freqEnd: 34, dur: 1.4, vol: 0.16, attack: 0.05 });
  tone({ type: "triangle", freq: 220, freqEnd: 66, dur: 1.1, vol: 0.045 });
  noise({ dur: 1.4, vol: 0.08, filterFreq: 900, filterEnd: 110, attack: 0.3 });
  for (const at of [0.15, 0.95]) {
    tone({ type: "sine", freq: 62, freqEnd: 40, dur: 0.14, vol: 0.17, delay: at });
    tone({ type: "sine", freq: 55, freqEnd: 36, dur: 0.12, vol: 0.12, delay: at + 0.19 });
  }
}

/** The way back from death: an airy shimmer rising out of the dark. */
export function playRespawnRise(): void {
  for (let i = 0; i < 3; i++) {
    const f = 262 * (1 + i * 0.5);
    tone({ type: "sine", freq: f, freqEnd: f * 2, dur: 1.1, vol: 0.04, delay: i * 0.06, attack: 0.35 });
  }
  noise({ dur: 1, vol: 0.05, filterFreq: 1200, filterEnd: 4200, type: "bandpass", q: 3, attack: 0.45 });
}

/** A Feather of Safe Passage lifts you: a soft updraft and wind chimes. */
export function playFeatherLift(): void {
  noise({ dur: 1.1, vol: 0.09, filterFreq: 500, filterEnd: 2400, type: "bandpass", q: 1.8, attack: 0.4 });
  const chimes = [880, 1175, 1480, 1760, 2349];
  for (let i = 0; i < chimes.length; i++) {
    tone({ type: "sine", freq: chimes[i], dur: 0.9, vol: 0.03, delay: 0.08 + i * 0.09 });
  }
}

/** A sealed portal refuses you: a dull knock, and the seal's glass rings. */
export function playSealedTouch(): void {
  tone({ type: "sine", freq: 124, freqEnd: 70, dur: 0.18, vol: 0.16 });
  noise({ dur: 0.12, vol: 0.07, filterFreq: 520, filterEnd: 110 });
  tone({ type: "sine", freq: 1568, dur: 0.7, vol: 0.022, delay: 0.03 });
  tone({ type: "sine", freq: 2349, dur: 0.5, vol: 0.012, delay: 0.05 });
}

/** A seal breaks (the Warden has fallen): glass shatters, and the portal
 * breathes open. */
export function playSealBreak(): void {
  noise({ dur: 0.4, vol: 0.14, filterFreq: 5200, filterEnd: 1400, type: "bandpass", q: 0.9 });
  for (let i = 0; i < 6; i++) {
    tone({ type: "sine", freq: 1800 + Math.random() * 2600, dur: 0.2 + Math.random() * 0.35, vol: 0.025, delay: i * 0.035 });
  }
  tone({ type: "sine", freq: 196, freqEnd: 392, dur: 1.3, vol: 0.06, delay: 0.1, attack: 0.3 });
  noise({ dur: 1.2, vol: 0.05, filterFreq: 400, filterEnd: 1800, type: "bandpass", q: 2, delay: 0.1, attack: 0.4 });
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
