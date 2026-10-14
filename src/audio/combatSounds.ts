import { self, synthNoise as noise, synthTone as tone } from "./sound";

/** What the shooter hears when their magic lands — kept apart from the
 * world's impacts (sound.ts playHit, the creatures' voices), which everyone
 * hears from where it happened. These play from where YOU stand (the self
 * bus): no voice pool to lose them to, no travel delay, never occluded, so
 * the answer to a shot is instant however far it flew. All synthesized.
 *
 * `pitch` is a playback ratio (1 = as written): the hit confirm climbs as
 * the creature weakens (combat/confirm confirmPitch), the kill chime climbs
 * a pentatonic scale down a streak (combat/momentum). */

/** A hit landed: a dry "tk" — a click of bright noise and a short tick of
 * tone. `weight` 0…1 thickens it: a beam's tick is a whisper, a rail's
 * hit has a body under it. */
export function playHitConfirm(weight: number, pitch: number): void {
  const w = Math.min(1, Math.max(0, weight));
  self(() => {
    noise({ dur: 0.022, vol: 0.05 + 0.07 * w, filterFreq: 3800 * pitch, type: "bandpass", q: 1.6, attack: 0.002 });
    tone({ type: "triangle", freq: 1250 * pitch, freqEnd: 820 * pitch, dur: 0.045, vol: 0.028 + 0.04 * w, attack: 0.002 });
    if (w > 0.45) tone({ type: "sine", freq: 210 * pitch, freqEnd: 95, dur: 0.07, vol: 0.05 + 0.07 * (w - 0.45), attack: 0.003 });
  });
}

/** A precision hit: a bright bell — inharmonic partials (1 : 2.76 : 5.4)
 * ringing off fast, over the hit's own click. */
export function playCritDing(pitch = 1): void {
  const f = 1568 * Math.min(1.25, Math.max(0.9, 0.8 + pitch * 0.2));
  self(() => {
    tone({ type: "sine", freq: f, dur: 0.42, vol: 0.055, attack: 0.002 });
    tone({ type: "sine", freq: f * 2.76, dur: 0.22, vol: 0.022, attack: 0.002 });
    tone({ type: "sine", freq: f * 5.4, dur: 0.1, vol: 0.012, attack: 0.002 });
    noise({ dur: 0.02, vol: 0.05, filterFreq: 6500, type: "highpass", q: 0.7, attack: 0.001 });
  });
}

/** A killing blow: a deep thunk and a chime over it. `ratio` lifts the
 * chime up the streak's scale; a precision kill rings a bell on top. */
export function playKillConfirm(ratio: number, crit: boolean): void {
  const root = 392 * ratio;
  self(() => {
    // The thunk: a short low knock you feel more than hear.
    tone({ type: "sine", freq: 120, freqEnd: 48, dur: 0.22, vol: 0.2, attack: 0.003 });
    noise({ dur: 0.07, vol: 0.09, filterFreq: 520, filterEnd: 160, attack: 0.002 });
    // The chime: root, octave and a fifth above, struck together.
    tone({ type: "sine", freq: root, dur: 0.55, vol: 0.06, attack: 0.004, delay: 0.012 });
    tone({ type: "sine", freq: root * 2, dur: 0.4, vol: 0.03, attack: 0.004, delay: 0.012 });
    tone({ type: "triangle", freq: root * 3, dur: 0.25, vol: 0.012, attack: 0.004, delay: 0.012 });
  });
  if (crit) playCritDing(1.2);
}

/** A rune word for a streak (DOUBLE, TRIPLE…): a rising shimmer that grows
 * with the chain. */
export function playStreak(multi: number): void {
  const n = Math.min(4, Math.max(2, multi));
  self(() => {
    noise({ dur: 0.35, vol: 0.035, filterFreq: 1800, filterEnd: 5200, type: "bandpass", q: 4, attack: 0.08 });
    for (let i = 0; i < n; i++) {
      const f = 784 * 2 ** ([0, 4, 7, 12][i]! / 12);
      tone({ type: "sine", freq: f, dur: 0.5, vol: 0.02, delay: 0.05 + i * 0.045, attack: 0.01 });
    }
  });
}

/** A heavy spell is ready again: a soft two-note lift. */
export function playSpellReady(): void {
  self(() => {
    tone({ type: "sine", freq: 988, dur: 0.16, vol: 0.022, attack: 0.01 });
    tone({ type: "sine", freq: 1480, dur: 0.28, vol: 0.02, delay: 0.07, attack: 0.01 });
  });
}

/** Too little mana: the spell sputters out at the staff — a choked crackle
 * and a sagging buzz, not silence. */
export function playFizzle(): void {
  self(() => {
    noise({ dur: 0.2, vol: 0.06, filterFreq: 1400, filterEnd: 260, type: "bandpass", q: 3 });
    for (let i = 0; i < 3; i++) {
      noise({ dur: 0.025, vol: 0.04, filterFreq: 2600 + Math.random() * 1800, type: "highpass", q: 1, delay: 0.03 + i * 0.045 });
    }
    tone({ type: "sawtooth", freq: 150, freqEnd: 70, dur: 0.18, vol: 0.025 });
  });
}
