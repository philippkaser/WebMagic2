/** Procedural WebAudio — every sound is synthesized, keeping the zero-asset
 * pipeline. The context is created lazily on the first user gesture (autoplay
 * policy); every play call is a safe no-op before that. */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;
let ambientStop: (() => void) | null = null;
let pendingAmbient: "village" | "dungeon" | null = null;

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
      startAmbient(kind);
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

// ── Game sounds ──────────────────────────────────────────────────────────────

export function playCast(): void {
  tone({ type: "square", freq: 640 + Math.random() * 120, freqEnd: 170, dur: 0.13, vol: 0.1 });
  noise({ dur: 0.09, vol: 0.05, filterFreq: 2600, filterEnd: 500, type: "bandpass", q: 2 });
}

export function playExplosion(radius: number): void {
  const size = Math.min(radius / 4, 1.6);
  // Crack → boom → rumble: a sharp transient bite, a deep sub thump, and a
  // longer low tail with crackling debris so big blasts feel like pressure.
  noise({ dur: 0.06, vol: 0.2 + size * 0.08, filterFreq: 4200, filterEnd: 1400, type: "bandpass", q: 0.7 });
  noise({ dur: 0.34 + size * 0.22, vol: 0.24 + size * 0.12, filterFreq: 1100, filterEnd: 70 });
  tone({ type: "sine", freq: 96, freqEnd: 28, dur: 0.38 + size * 0.2, vol: 0.34 + size * 0.08 });
  tone({ type: "triangle", freq: 52, freqEnd: 22, dur: 0.5 + size * 0.3, vol: 0.2 + size * 0.1, delay: 0.02 });
  // Debris crackle sputtering out after the boom.
  for (let i = 0; i < 3; i++) {
    noise({
      dur: 0.05,
      vol: 0.07 + size * 0.03,
      filterFreq: 2400 + Math.random() * 1800,
      type: "bandpass",
      q: 5,
      delay: 0.12 + i * (0.07 + Math.random() * 0.06),
    });
  }
  // Big detonations get a second, deeper concussion and a long rumble tail —
  // the fireball catching after the initial crack.
  if (radius >= 3.4) {
    tone({ type: "sine", freq: 64, freqEnd: 18, dur: 0.7, vol: 0.3, delay: 0.06 });
    noise({ dur: 0.9, vol: 0.14, filterFreq: 300, filterEnd: 40, delay: 0.1 });
  }
}

/** Phantom-blade swing: an airy whoosh sweeping down in pitch. */
export function playSwing(heavy = false): void {
  noise({
    dur: heavy ? 0.3 : 0.18,
    vol: heavy ? 0.18 : 0.13,
    filterFreq: heavy ? 900 : 1500,
    filterEnd: heavy ? 180 : 420,
    type: "bandpass",
    q: 1.6,
  });
  tone({ type: "sine", freq: heavy ? 220 : 340, freqEnd: heavy ? 70 : 150, dur: heavy ? 0.22 : 0.14, vol: 0.06 });
}

/** Spectral blade connecting — a short metallic bite. */
export function playSwordHit(): void {
  tone({ type: "square", freq: 480, freqEnd: 190, dur: 0.07, vol: 0.1 });
  tone({ type: "triangle", freq: 1250, freqEnd: 700, dur: 0.09, vol: 0.07 });
  noise({ dur: 0.07, vol: 0.08, filterFreq: 3200, filterEnd: 900, type: "bandpass", q: 2.4 });
}

/** One tick of the laser charge-up — pitch rises with charge fraction. */
export function playChargeTick(frac: number): void {
  tone({ type: "sine", freq: 240 + frac * 620, dur: 0.06, vol: 0.05 + frac * 0.05 });
}

/** Laser release: a zap whose weight scales with charge. */
export function playBeam(power: number): void {
  tone({ type: "sawtooth", freq: 1400 + power * 600, freqEnd: 140, dur: 0.22 + power * 0.18, vol: 0.12 + power * 0.1 });
  tone({ type: "square", freq: 190, freqEnd: 60, dur: 0.2 + power * 0.2, vol: 0.1 + power * 0.12 });
  noise({ dur: 0.18 + power * 0.15, vol: 0.1, filterFreq: 5200, filterEnd: 700, type: "bandpass", q: 1.2 });
}

/** Grenade lob: a hollow thoomp out of the staff mortar. */
export function playLob(): void {
  tone({ type: "sine", freq: 150, freqEnd: 60, dur: 0.18, vol: 0.22 });
  noise({ dur: 0.12, vol: 0.1, filterFreq: 500, filterEnd: 140 });
}

/** A projectile ricocheting off the world. */
export function playBounce(): void {
  tone({ type: "triangle", freq: 620 + Math.random() * 160, freqEnd: 260, dur: 0.06, vol: 0.08 });
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

// ── Ambient beds ─────────────────────────────────────────────────────────────

export function startAmbient(kind: "village" | "dungeon"): void {
  stopAmbient();
  if (!ctx || !master || !noiseBuffer) {
    // Context not unlocked yet — start this bed on the first gesture.
    pendingAmbient = kind;
    return;
  }
  const nodes: AudioNode[] = [];
  const sources: (OscillatorNode | AudioBufferSourceNode)[] = [];
  const bed = ctx.createGain();
  bed.gain.value = 0;
  bed.gain.linearRampToValueAtTime(1, ctx.currentTime + 2);
  bed.connect(master);
  nodes.push(bed);

  const droneFreq = kind === "dungeon" ? 41 : 55;
  for (const detune of [0, 0.6]) {
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = droneFreq + detune;
    const g = ctx.createGain();
    g.gain.value = kind === "dungeon" ? 0.05 : 0.03;
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
  windFilter.frequency.value = kind === "dungeon" ? 220 : 480;
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
