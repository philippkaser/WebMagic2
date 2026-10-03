import { audioCtx, ensureContext, masterBus, noiseBuf } from "./context";
import { ambientAirOut, oneShotAt, selfOut, type At } from "./spatial";
import { crackle, fm, noise, routed, saturated, strike, tone, voice, type Vowel } from "./synth";

/** Procedural WebAudio — every sound is synthesized (audio/synth.ts),
 * keeping the zero-asset pipeline. The context is created lazily on the first user gesture (autoplay
 * policy, audio/context.ts); every play call is a safe no-op before that.
 *
 * World sounds are placed and traced (audio/spatial.ts): `atPoint` plays a
 * sound's voices from a point in the world — around corners, through the
 * room's reverb — and `self` from where you stand (your steps, your spells:
 * dry, plus the room answering). Sounds in your head (the omen, the
 * heartbeat, the journey through a rift) go straight to the master bus. */

let ambientStop: (() => void) | null = null;
let pendingAmbient: "village" | "dungeon" | null = null;
let pendingMood: AmbientMood | undefined;

/** Play `fn`'s voices at `pos` in the world (for `life` seconds), or from
 * where you stand if no position is given. `size`: how big the sound is
 * (radius, m) — up close a big one comes from all round you. (When every
 * voice is busy with something louder, a placed sound is dropped — never
 * moved into your head.) */
export function atPoint(pos: At | undefined | null, life: number, fn: () => void, gain = 1, size = 0.3): void {
  if (!audioCtx()) return;
  const out = pos ? oneShotAt(pos, life, gain, size) : selfOut();
  if (out) routed(out, fn);
}

/** Play `fn`'s voices from where you stand: dry, and the room answering —
 * under your left (`foot` −1) or right (1) foot for a step. */
export function self(fn: () => void, foot = 0): void {
  if (!audioCtx()) return;
  routed(selfOut(foot), fn);
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


// ── Game sounds ──────────────────────────────────────────────────────────────

/** A spell leaves a staff — yours (from where you stand), or a floor-mate's
 * (`at` their staff): a breath of air torn forward, a bright FM zap falling
 * away with a glint on top, and a small recoil in the wood. */
export function playCast(at?: At): void {
  atPoint(at, 0.35, () => {
    const f = 560 + Math.random() * 140;
    noise({ dur: 0.2, vol: 0.06, filterFreq: 900, filterEnd: 3600, type: "bandpass", q: 1.3, attack: 0.02, color: "pink" });
    fm({ freq: f, freqEnd: f * 0.32, dur: 0.17, vol: 0.075, ratio: 1.41, index: 3.2, indexEnd: 0.2, vary: 40 });
    tone({ type: "triangle", freq: f * 3.4, freqEnd: f * 5, dur: 0.11, vol: 0.016, delay: 0.015, bright: 3 });
    tone({ type: "sine", freq: 190, freqEnd: 70, dur: 0.08, vol: 0.07, vary: 60 });
  });
}

/** A blast: the crack of it, a saturated boom with a sub drop under it, the
 * fire's roar, debris pattering down and a low rumble rolling away — all
 * as big as the blast. */
export function playExplosion(radius: number, at?: At): void {
  const size = Math.min(radius / 4, 1.6);
  const tail = 1.3 + size * 0.6;
  atPoint(at, tail + 0.2, () => {
    noise({ dur: 0.05, vol: 0.2, filterFreq: 1800, type: "highpass", q: 0.7, attack: 0.001 });
    saturated(0.32, () => {
      noise({ dur: 0.45 + size * 0.3, vol: 0.2 + size * 0.06, filterFreq: 1000, filterEnd: 80, attack: 0.004, color: "brown" });
      tone({ type: "sine", freq: 100, freqEnd: 30, dur: 0.42 + size * 0.2, vol: 0.3, vary: 80 });
    });
    noise({ dur: 0.8 + size * 0.4, vol: 0.05, filterFreq: 700, filterEnd: 180, type: "bandpass", q: 0.7, attack: 0.04, hold: 0.1, color: "pink" });
    crackle({ dur: 0.7 + size * 0.4, count: Math.round(7 + size * 6), vol: 0.035, freq: 2600, spread: 0.6, delay: 0.08, grain: 0.014 });
    noise({ dur: tail, vol: 0.045, filterFreq: 170, filterEnd: 50, attack: 0.1, color: "brown" });
    // As big as the blast: inside it, it's all round you.
  }, 1.5, radius * 0.6);
}

/** A spell strikes something: a thud, a crunch, a fizz of magic and a
 * couple of sparks. Never twice the same. */
export function playHit(at?: At): void {
  atPoint(at, 0.25, () => {
    tone({ type: "sine", freq: 250, freqEnd: 75, dur: 0.07, vol: 0.13, vary: 120 });
    noise({ dur: 0.06, vol: 0.08, filterFreq: 2400, filterEnd: 900, type: "bandpass", q: 1.4, attack: 0.001 });
    fm({ freq: 900, freqEnd: 500, dur: 0.13, vol: 0.035, ratio: 2.3, index: 4, indexEnd: 0, vary: 150 });
    crackle({ dur: 0.14, count: 3, vol: 0.03, freq: 4200, spread: 0.3, delay: 0.01 });
  }, 1, 0.25);
}

/** You're hurt: a blow to the body, a sharp sting, a crunch, and a low
 * rough groan of pain under it. */
export function playHurt(): void {
  self(() => {
    tone({ type: "sine", freq: 150, freqEnd: 52, dur: 0.18, vol: 0.15 });
    noise({ dur: 0.03, vol: 0.05, filterFreq: 3000, type: "highpass", attack: 0.001 });
    noise({ dur: 0.15, vol: 0.06, filterFreq: 1500, filterEnd: 200, attack: 0.002 });
    tone({ type: "sawtooth", freq: 170, freqEnd: 68, dur: 0.24, vol: 0.09, detune: 35, bright: 6 });
  });
}

/** Something picked up: a glassy arpeggio rising into a bright chord, a soft
 * bloom under it and a breath of shimmer. */
export function playPickup(): void {
  const notes = [659, 784, 1047, 1319];
  notes.forEach((f, i) => strike({ freq: f, dur: 0.8, vol: 0.042, modes: "glass", bright: 0.9, delay: i * 0.055 }));
  tone({ type: "sine", freq: 262, dur: 0.45, vol: 0.03, attack: 0.03 });
  noise({ dur: 0.45, vol: 0.012, filterFreq: 6500, type: "highpass", attack: 0.12, delay: 0.05, color: "pink" });
}

/** Off the ground: a swish of cloak and air, a small push. */
export function playJump(): void {
  self(() => {
    noise({ dur: 0.17, vol: 0.085, filterFreq: 450, filterEnd: 1500, type: "bandpass", q: 1, attack: 0.03, color: "pink" });
    tone({ type: "sine", freq: 120, freqEnd: 180, dur: 0.07, vol: 0.06 });
  });
}

/** A dash: air rushing past one way then the other, with a thin glint of
 * magic carrying you. */
export function playDash(): void {
  self(() => {
    noise({ dur: 0.2, vol: 0.095, filterFreq: 350, filterEnd: 3000, type: "bandpass", q: 1.2, attack: 0.06, color: "pink" });
    noise({ dur: 0.25, vol: 0.05, filterFreq: 2800, filterEnd: 600, type: "bandpass", q: 1.2, delay: 0.12, color: "pink" });
    fm({ freq: 420, freqEnd: 1250, dur: 0.2, vol: 0.016, ratio: 1.5, index: 2, attack: 0.05 });
  });
}

/** A portal opens nearby: a whump of displaced air, a chord rising through
 * a swirl of wind, and a glint as it settles. */
export function playPortal(at?: At): void {
  atPoint(at, 1.3, () => {
    tone({ type: "sine", freq: 92, freqEnd: 45, dur: 0.4, vol: 0.15 });
    [330, 415, 494].forEach((f, i) => tone({ type: "sine", freq: f, freqEnd: f * 2, dur: 0.9, vol: 0.065, delay: i * 0.07, attack: 0.25, detune: 9, vibrato: [5, 14] }));
    noise({ dur: 1, vol: 0.085, filterFreq: 700, filterEnd: 2800, type: "bandpass", q: 3, attack: 0.3, color: "pink" });
    strike({ freq: 1760, dur: 0.8, vol: 0.022, modes: "glass", delay: 0.35 });
  }, 1, 1.2);
}

/** The Warden roars: two throats growling through a vowel that closes from
 * "ah" to "oo", rattling and saturated, over a sub that shakes the floor
 * and the breath behind it. */
export function playBossRoar(at?: At): void {
  atPoint(at, 1.4, () => {
    saturated(0.28, () => {
      voice({ freq: 82, freqEnd: 48, dur: 1.1, vol: 0.2, attack: 0.08, hold: 0.3, vowel: "a", vowelEnd: "u", rattle: 27, detune: 22, size: 0.8 });
      voice({ freq: 123, freqEnd: 70, dur: 1, vol: 0.09, attack: 0.1, hold: 0.25, delay: 0.03, vowel: "o", vowelEnd: "u", rattle: 33, size: 0.75 });
    });
    tone({ type: "sine", freq: 56, freqEnd: 32, dur: 1.2, vol: 0.18, attack: 0.06, hold: 0.3 });
    noise({ dur: 1.1, vol: 0.07, filterFreq: 900, filterEnd: 200, attack: 0.06, hold: 0.2, color: "pink" });
  }, 1.8, 1.6);
}

// ── Encounters, lore & omens ─────────────────────────────────────────────────

/** Another wizard has entered the floor — a low, uneasy swell. No name, no
 * direction: just the knowledge that you're not alone anymore. */
export function playPresence(): void {
  tone({ type: "sine", freq: 58, freqEnd: 74, dur: 2.4, vol: 0.1, attack: 0.5, hold: 0.25 });
  tone({ type: "triangle", freq: 233, freqEnd: 220, dur: 2, vol: 0.03, delay: 0.3, attack: 0.4, detune: 18, vibrato: [0.8, 12] });
  noise({ dur: 2.2, vol: 0.022, filterFreq: 180, filterEnd: 800, type: "bandpass", q: 4, attack: 1.2, color: "pink" });
}

/** One heartbeat (lub-dub), a thump felt in the chest. Played by the
 * presence system faster and louder as a hostile wizard closes in. */
export function playHeartbeat(intensity: number): void {
  const v = 0.05 + Math.min(1, Math.max(0, intensity)) * 0.13;
  for (const [at, k] of [[0, 1], [0.17, 0.75]] as const) {
    tone({ type: "sine", freq: 62, freqEnd: 38, dur: 0.15, vol: v * k, delay: at });
    tone({ type: "sine", freq: 120, freqEnd: 50, dur: 0.035, vol: v * k * 0.35, delay: at });
    noise({ dur: 0.09, vol: v * k * 0.25, filterFreq: 160, delay: at, color: "brown" });
  }
}

/** A pact is sworn — two bowls struck a fifth apart, beating slowly
 * together, over a warm low hum. */
export function playPactSworn(): void {
  strike({ freq: 294, dur: 2, vol: 0.04, modes: "bowl", beat: 1.2 });
  strike({ freq: 440, dur: 2, vol: 0.03, modes: "bowl", beat: 1.6, delay: 0.14 });
  tone({ type: "sine", freq: 147, dur: 1.4, vol: 0.03, attack: 0.2, hold: 0.3 });
}

/** A pact breaks — a crack, a tritone grinding apart, a shard of glass. */
export function playPactBroken(): void {
  noise({ dur: 0.04, vol: 0.08, filterFreq: 2500, type: "highpass", attack: 0.001 });
  tone({ type: "sawtooth", freq: 311, freqEnd: 288, dur: 0.55, vol: 0.06, detune: 16, bright: 6 });
  tone({ type: "sawtooth", freq: 440, freqEnd: 472, dur: 0.55, vol: 0.05, detune: 16, bright: 6 });
  strike({ freq: 1245, dur: 0.45, vol: 0.025, modes: "glass" });
  noise({ dur: 0.3, vol: 0.05, filterFreq: 1800, filterEnd: 300, type: "bandpass", q: 2 });
}

/** A grave rises where a wizard fell: earth heaving and pebbles tumbling,
 * and a far bell tolling once. */
export function playGraveRise(at?: At): void {
  atPoint(at, 2.3, () => {
    noise({ dur: 1.3, vol: 0.06, filterFreq: 420, filterEnd: 90, attack: 0.15, color: "brown" });
    crackle({ dur: 1, count: 9, vol: 0.025, freq: 1800, spread: 0.5, grain: 0.02, decay: 0.2 });
    strike({ freq: 98, dur: 2.1, vol: 0.09, modes: "bell", bright: 0.7, beat: 0.8, delay: 0.15 });
    tone({ type: "sine", freq: 196, freqEnd: 98, dur: 1.6, vol: 0.05 });
  }, 1.4, 1);
}

const WHISPER_VOWELS: Vowel[] = ["a", "e", "i", "o", "u"];

/** A lore rune is read — a whisper of half-heard syllables over a faint
 * chord. */
export function playWhisper(at?: At): void {
  atPoint(at, 1.8, () => {
    let t = 0.05;
    for (let i = 0; i < 6; i++) {
      const v = WHISPER_VOWELS[Math.floor(Math.random() * 5)]!;
      const end = WHISPER_VOWELS[Math.floor(Math.random() * 5)]!;
      const d = 0.12 + Math.random() * 0.16;
      voice({ freq: 0, dur: d, vol: 0.05, delay: t, attack: 0.03, vowel: v, vowelEnd: end, breath: true, q: 6, size: 1.1 });
      // A hiss between some syllables ("s", "sh").
      if (Math.random() < 0.4) noise({ dur: 0.08, vol: 0.02, filterFreq: 5500, type: "bandpass", q: 3, delay: t + d, color: "pink" });
      t += d + 0.03 + Math.random() * 0.08;
    }
    tone({ type: "sine", freq: 523, dur: 1.3, vol: 0.025, delay: 0.1, attack: 0.3, vibrato: [4, 8] });
    tone({ type: "sine", freq: 659, dur: 1.3, vol: 0.02, delay: 0.25, attack: 0.3, vibrato: [4.5, 8] });
  }, 1.3, 0.5);
}

/** The floor's omen announces itself on arrival: a far gong under a low
 * fifth slowly beating, and a cold breath swelling. */
export function playOmen(): void {
  strike({ freq: 55, dur: 3, vol: 0.06, modes: "metal", bright: 0.6, beat: 0.5 });
  tone({ type: "sine", freq: 110, freqEnd: 104, dur: 2.6, vol: 0.1, attack: 0.1, detune: 6 });
  tone({ type: "sine", freq: 164.8, freqEnd: 156, dur: 2.4, vol: 0.06, delay: 0.15, attack: 0.2, detune: 8 });
  noise({ dur: 2.4, vol: 0.04, filterFreq: 600, filterEnd: 200, type: "bandpass", q: 5, attack: 0.5, color: "pink" });
}

/** The Weighing Gate reads your gear: bowls struck down a scale, each
 * sinking an octave as it rings. */
export function playWeighing(): void {
  for (let i = 0; i < 4; i++) {
    const f = 220 * (1 + i * 0.5);
    strike({ freq: f, dur: 1.4, vol: 0.022, modes: "bowl", beat: 1, delay: i * 0.1 });
    tone({ type: "sine", freq: f, freqEnd: f / 2, dur: 1.4, vol: 0.025, delay: i * 0.1, attack: 0.08 });
  }
}

// ── Travel: portals, the tunnel, death and the way back ─────────────────────
// (transition/TransitionSystem plays these on the journey's stage changes.)

/** Being pulled into a rift: a rush of air swelling into a whistle, a chord
 * bending upward, the artpass warp's rising sweep and sparkle over a deep
 * sub that sinks as you go, and a "thoom" as the tear closes over you.
 * `bright` 0…1 lifts the pitch — cyan descents sit lower than gold
 * homecomings. */
export function playPortalEnter(bright = 0.5): void {
  noise({ dur: 1, vol: 0.15, filterFreq: 240, filterEnd: 3600, type: "bandpass", q: 1.4, attack: 0.75, color: "pink" });
  noise({ dur: 0.9, vol: 0.05, filterFreq: 1800, filterEnd: 7200, type: "bandpass", q: 6, delay: 0.15, attack: 0.6 });
  const base = 170 + bright * 90;
  tone({ type: "sine", freq: base, freqEnd: base * 3.2, dur: 0.95, vol: 0.07, attack: 0.6, detune: 10 });
  tone({ type: "triangle", freq: base * 1.5, freqEnd: base * 4.6, dur: 0.9, vol: 0.03, delay: 0.05, attack: 0.55, detune: 12 });
  // The warp (artpass playWarp): a rising rush through space, a glittering
  // top, and a sub sinking under it all.
  tone({ type: "sine", freq: 110, freqEnd: 560, dur: 1.1, vol: 0.06, attack: 0.3 });
  fm({ freq: 880, freqEnd: 2400, dur: 0.8, vol: 0.02, delay: 0.3, attack: 0.2, ratio: 2.01, index: 1.5 });
  tone({ type: "sine", freq: 55, freqEnd: 38, dur: 1.3, vol: 0.12, attack: 0.2 });
  saturated(0.3, () => {
    tone({ type: "sine", freq: 96, freqEnd: 30, dur: 0.7, vol: 0.24, delay: 0.84 });
    noise({ dur: 0.4, vol: 0.08, filterFreq: 500, filterEnd: 70, delay: 0.84, color: "brown" });
  });
}

/** The tunnel: rushing air swept by a slow LFO over a low two-voice drone
 * with a little vibrato, a far whistle drifting in it. Loops until the
 * returned stop() (which fades out). `pitch` is the drone's root in Hz;
 * `air` scales the rush (0 = drone only). */
export function startTunnelRush(pitch = 55, air = 1): () => void {
  const ctx = audioCtx();
  const master = masterBus();
  const pink = noiseBuf("pink");
  if (!ctx || !master || !pink) return () => {};
  const c = ctx;
  const now = c.currentTime;
  const out = c.createGain();
  out.gain.setValueAtTime(0.0001, now);
  out.gain.exponentialRampToValueAtTime(1, now + 0.2);
  out.connect(master);

  const sources: AudioScheduledSourceNode[] = [];
  const lfo = (rate: number, depth: number, param: AudioParam) => {
    const o = c.createOscillator();
    o.frequency.value = rate;
    const g = c.createGain();
    g.gain.value = depth;
    o.connect(g).connect(param);
    sources.push(o);
  };

  // The rush: pink air through a band swept by a slow LFO.
  const rush = c.createBufferSource();
  rush.buffer = pink;
  rush.loop = true;
  const band = c.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = 900;
  band.Q.value = 0.8;
  lfo(0.8, 500, band.frequency);
  const rushGain = c.createGain();
  rushGain.gain.value = 0.11 * air;
  rush.connect(band).connect(rushGain).connect(out);
  // A far whistle: the same air through a narrow band, wandering.
  const whistle = c.createBiquadFilter();
  whistle.type = "bandpass";
  whistle.frequency.value = pitch * 32;
  whistle.Q.value = 14;
  lfo(0.23, pitch * 9, whistle.frequency);
  const whistleGain = c.createGain();
  whistleGain.gain.value = 0.05 * air;
  rush.connect(whistle).connect(whistleGain).connect(out);
  sources.push(rush);

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
  sources.push(vib);
  for (const [mult, cents] of [[1, -6], [1, 6], [1.5, 3]] as const) {
    const o = c.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = pitch * mult;
    o.detune.value = cents;
    vibDepth.connect(o.frequency);
    o.connect(low);
    sources.push(o);
  }

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

/** Spat out the other side: a pop of air, a landing thump, a chord blooming
 * with a bell's shimmer on top. `bright` as in playPortalEnter. */
export function playPortalArrive(bright = 0.5): void {
  noise({ dur: 0.55, vol: 0.11, filterFreq: 3200, filterEnd: 180, color: "pink" });
  tone({ type: "sine", freq: 74, freqEnd: 38, dur: 0.45, vol: 0.2 });
  const root = 294 + bright * 98;
  const chord = [1, 1.26, 1.5, 2];
  for (let i = 0; i < chord.length; i++) {
    tone({ type: "sine", freq: root * chord[i]!, dur: 1.4, vol: 0.036, delay: 0.03 * i, attack: 0.05, detune: 7 });
  }
  strike({ freq: root * 2, dur: 1.4, vol: 0.03, modes: "bell", bright: 0.8, delay: 0.05 });
}

/** Falling: a long sinking tone, a breath let go, and a heart that slows. */
export function playDeathFade(): void {
  tone({ type: "sine", freq: 110, freqEnd: 34, dur: 1.4, vol: 0.15, attack: 0.05 });
  tone({ type: "triangle", freq: 220, freqEnd: 66, dur: 1.1, vol: 0.045, detune: 20 });
  voice({ freq: 0, dur: 1.2, vol: 0.05, attack: 0.15, vowel: "a", vowelEnd: "u", breath: true, q: 4 });
  noise({ dur: 1.4, vol: 0.05, filterFreq: 900, filterEnd: 110, attack: 0.3, color: "pink" });
  for (const at of [0.15, 0.95]) {
    tone({ type: "sine", freq: 62, freqEnd: 40, dur: 0.14, vol: 0.17, delay: at });
    tone({ type: "sine", freq: 55, freqEnd: 36, dur: 0.12, vol: 0.12, delay: at + 0.19 });
  }
}

/** The way back from death: an airy shimmer rising out of the dark. */
export function playRespawnRise(): void {
  for (let i = 0; i < 3; i++) {
    const f = 262 * (1 + i * 0.5);
    tone({ type: "sine", freq: f, freqEnd: f * 2, dur: 1.1, vol: 0.04, delay: i * 0.06, attack: 0.35, detune: 8 });
  }
  noise({ dur: 1, vol: 0.045, filterFreq: 1200, filterEnd: 4200, type: "bandpass", q: 3, attack: 0.45, color: "pink" });
  strike({ freq: 1047, dur: 1, vol: 0.02, modes: "glass", delay: 0.75 });
}

/** A Feather of Safe Passage lifts you: a soft updraft and wind chimes. */
export function playFeatherLift(): void {
  noise({ dur: 1.1, vol: 0.08, filterFreq: 500, filterEnd: 2400, type: "bandpass", q: 1.8, attack: 0.4, color: "pink" });
  const chimes = [880, 1175, 1480, 1760, 2349];
  for (let i = 0; i < chimes.length; i++) {
    strike({ freq: chimes[i]!, dur: 1.1, vol: 0.03, modes: "glass", vary: 15, delay: 0.08 + i * 0.09 + Math.random() * 0.04 });
  }
}

/** A sealed rift refuses you: a dull knock on stone, and the wound flinches
 * — a short, low, torn growl. */
export function playSealedTouch(): void {
  strike({ freq: 124, dur: 0.25, vol: 0.14, modes: "stone" });
  noise({ dur: 0.12, vol: 0.06, filterFreq: 520, filterEnd: 110, color: "brown" });
  voice({ freq: 82, freqEnd: 58, dur: 0.45, vol: 0.05, delay: 0.04, attack: 0.03, vowel: "o", vowelEnd: "u", rattle: 24, detune: 30, size: 0.8 });
  noise({ dur: 0.35, vol: 0.05, filterFreq: 1400, filterEnd: 300, type: "bandpass", q: 4, delay: 0.05 });
}

/** A seal breaks (the Warden has fallen, the Tithe is paid): space RIPS —
 * a tearing burst whose pitch races down, crackles along the tear — and the
 * wound breathes open with a rising swell. */
export function playSealBreak(): void {
  saturated(0.3, () => {
    noise({ dur: 0.5, vol: 0.16, filterFreq: 6200, filterEnd: 500, type: "bandpass", q: 1.2 });
    noise({ dur: 0.35, vol: 0.1, filterFreq: 900, filterEnd: 160, delay: 0.04, color: "brown" });
    tone({ type: "sine", freq: 70, freqEnd: 36, dur: 0.6, vol: 0.18 });
  });
  crackle({ dur: 0.4, count: 9, vol: 0.06, freq: 3900, spread: 0.4, delay: 0.05, grain: 0.03, q: 8, decay: 0.2 });
  tone({ type: "sine", freq: 196, freqEnd: 392, dur: 1.3, vol: 0.06, delay: 0.15, attack: 0.3, detune: 10 });
  fm({ freq: 880, freqEnd: 1760, dur: 1, vol: 0.02, delay: 0.3, attack: 0.3, ratio: 1.5, index: 1.2 });
  noise({ dur: 1.2, vol: 0.05, filterFreq: 400, filterEnd: 1800, type: "bandpass", q: 2, delay: 0.1, attack: 0.4, color: "pink" });
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

/** The place's own sound, under everything, until stopAmbient():
 *
 * - the ground: a sub at the drone, felt more than heard;
 * - the dark: a far organ — saws an octave and a twelfth over the drone,
 *   slightly apart, through a lowpass that slowly breathes open and shut;
 * - the air: wind gusting on two slow, unrelated swells (brown noise below
 *   ground, pink under the open sky), sent through the acoustics so big
 *   spaces fill with it;
 * - below ground a draught moaning through far passages (a narrow band of
 *   air whose pitch wanders, coming and going); in the village, leaves
 *   stirring in the gusts. */
export function startAmbient(kind: "village" | "dungeon", mood?: AmbientMood): void {
  stopAmbient();
  const ctx = audioCtx();
  const master = masterBus();
  const pink = noiseBuf("pink");
  const brown = noiseBuf("brown");
  if (!ctx || !master || !pink || !brown) {
    // Context not unlocked yet — start this bed on the first gesture.
    pendingAmbient = kind;
    pendingMood = mood;
    return;
  }
  const dungeon = kind === "dungeon";
  const m = mood ?? (dungeon ? DUNGEON_MOOD : VILLAGE_MOOD);
  const weight = m.weight ?? 1;
  const now = ctx.currentTime;
  const nodes: AudioNode[] = [];
  const sources: AudioScheduledSourceNode[] = [];
  const gain = (v: number) => {
    const g = ctx.createGain();
    g.gain.value = v;
    nodes.push(g);
    return g;
  };
  const osc = (type: OscillatorType, f: number, detune = 0) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    o.detune.value = detune;
    sources.push(o);
    return o;
  };
  /** A slow swell on `param`: ± `depth` at `rate` Hz. */
  const lfo = (rate: number, depth: number, param: AudioParam) => {
    osc("sine", rate).connect(gain(depth)).connect(param);
  };
  const filter = (type: BiquadFilterType, f: number, q = 0.7) => {
    const b = ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    nodes.push(b);
    return b;
  };
  const loop = (buf: AudioBuffer, rate: number) => {
    const s = ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.playbackRate.value = rate;
    sources.push(s);
    return s;
  };

  const bed = gain(0);
  bed.gain.linearRampToValueAtTime(1, now + 2.5);
  bed.connect(master);
  // The wind is the place's air: it goes out through the acoustics, which
  // fill it out in big spaces and lean it toward the open sky.
  const airBed = gain(0);
  airBed.gain.linearRampToValueAtTime(1, now + 2.5);
  airBed.connect(ambientAirOut() ?? master);

  // The ground.
  osc("sine", m.drone).connect(gain((dungeon ? 0.045 : 0.025) * weight)).connect(bed);

  // The dark.
  const padLevel = (dungeon ? 0.011 : 0.006) * weight;
  const pad = gain(padLevel);
  lfo(0.047, padLevel * 0.5, pad.gain);
  const padTone = filter("lowpass", m.drone * 5);
  lfo(0.031, m.drone * 2.5, padTone.frequency);
  padTone.connect(pad).connect(bed);
  for (const [mult, cents, level] of [[2, -7, 1], [2, 7, 1], [3, 4, 0.6]] as const) {
    osc("sawtooth", m.drone * mult, cents).connect(gain(level)).connect(padTone);
  }

  // The air: below ground a deep brown rumble, airier places (and the open
  // sky) pink. A low cutoff keeps nearly all of brown noise's energy, so
  // its level follows the cutoff to keep a still hollow quiet and a windy
  // cavern loud, as the biomes ask.
  const brownWind = dungeon && m.wind < 500;
  const windLevel = brownWind ? 0.06 * Math.min(1.3, m.wind / 220) : dungeon ? 0.048 : 0.06;
  const wind = gain(windLevel);
  lfo(0.07, windLevel * 0.45, wind.gain);
  lfo(0.023, windLevel * 0.3, wind.gain);
  loop(brownWind ? brown : pink, dungeon ? 0.5 : 0.4).connect(filter("lowpass", m.wind)).connect(wind).connect(airBed);

  if (dungeon) {
    // The draught: comes and goes (its level swung right down to nothing).
    const howlLevel = 0.022;
    const howl = gain(howlLevel);
    lfo(0.019, howlLevel, howl.gain);
    const band = filter("bandpass", m.wind * 2.6, 9);
    lfo(0.053, m.wind * 0.7, band.frequency);
    loop(pink, 0.6).connect(band).connect(howl).connect(airBed);
  } else {
    // Leaves: the high rustle of the same gusts.
    const leafLevel = 0.012;
    const leaves = gain(leafLevel);
    lfo(0.07, leafLevel * 0.8, leaves.gain);
    lfo(0.11, leafLevel * 0.3, leaves.gain);
    loop(pink, 1).connect(filter("highpass", 2800)).connect(leaves).connect(airBed);
  }

  for (const s of sources) {
    if (s instanceof AudioBufferSourceNode) s.start(now, Math.random() * 2);
    else s.start(now);
  }

  ambientStop = () => {
    const t = ctx.currentTime;
    for (const g of [bed.gain, airBed.gain]) {
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(0, t + 0.6);
    }
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
