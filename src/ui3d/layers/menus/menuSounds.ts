import { crackle, noise, strike, tone } from "../../../audio/synth";

/** The menus' own sounds — the beats of their rituals. Kept beside the
 * screens (not in audio/uiSounds.ts, which the whole UI shares) because
 * each is tied to one moment of one screen. All synthesized. */

/** A thread of light leaves an item and runs to the gate's reading. */
export function playThread(index: number): void {
  const k = 1 + index * 0.125;
  tone({ type: "sine", freq: 523 * k, freqEnd: 784 * k, dur: 0.5, vol: 0.016, vibrato: [6, 12] });
  strike({ freq: 1568 * k, dur: 0.4, vol: 0.008, modes: "glass", delay: 0.35 });
}

/** The gate names your resonance: a struck bowl, singing. */
export function playResonance(): void {
  strike({ freq: 294, dur: 2.4, vol: 0.027, modes: "bowl", beat: 1.3 });
}

/** The destination burns in: low gong under a rushing flare. */
export function playFloorReveal(): void {
  strike({ freq: 98, dur: 2.4, vol: 0.035, modes: "metal", bright: 0.6, beat: 0.6 });
  tone({ type: "sine", freq: 98, freqEnd: 82, dur: 2.2, vol: 0.05 });
  noise({ dur: 0.7, vol: 0.045, filterFreq: 600, filterEnd: 3200, type: "bandpass", q: 1.5, color: "pink" });
}

/** YOU DIED: a great bell tolls once, and its hum sinks away. */
export function playDeathToll(): void {
  strike({ freq: 110, dur: 4, vol: 0.055, modes: "bell", bright: 0.85, beat: 0.7 });
  tone({ type: "sine", freq: 110, freqEnd: 73, dur: 3.2, vol: 0.05, attack: 0.3 });
  noise({ dur: 1.4, vol: 0.03, filterFreq: 300, filterEnd: 90, q: 0.9, color: "brown" });
}

/** A lost thing crumbles to ash. */
export function playCrumble(index: number): void {
  noise({ dur: 0.45, vol: 0.055, filterFreq: 1400 - index * 60, filterEnd: 200, q: 0.9, color: "pink" });
  crackle({ dur: 0.4, count: 6, vol: 0.016, freq: 2400 - index * 80, spread: 0.5, grain: 0.012 });
  tone({ type: "triangle", freq: 220 - index * 8, freqEnd: 110, dur: 0.3, vol: 0.012 });
}

/** A lost thing sinks into its grave. */
export function playGraveTake(index: number): void {
  tone({ type: "sine", freq: 330 - index * 12, freqEnd: 165, dur: 0.6, vol: 0.03 });
  noise({ dur: 0.3, vol: 0.03, filterFreq: 500, filterEnd: 150, q: 1, color: "brown" });
  crackle({ dur: 0.3, count: 3, vol: 0.01, freq: 1500, spread: 0.4, grain: 0.02, delay: 0.05 });
}

/** The tome opens: the cover lifts, pages fan, a soft note. */
export function playBookOpen(): void {
  noise({ dur: 0.35, vol: 0.05, filterFreq: 700, filterEnd: 2200, type: "bandpass", q: 0.8, color: "pink" });
  crackle({ dur: 0.3, count: 5, vol: 0.01, freq: 3500, spread: 0.5, grain: 0.01, decay: 0 });
  noise({ dur: 0.12, vol: 0.05, filterFreq: 300, q: 1.2, delay: 0.3, color: "brown" });
  tone({ type: "sine", freq: 392, freqEnd: 440, dur: 0.6, vol: 0.02, delay: 0.25 });
}

/** The tome shuts: a soft thump and a puff of air. */
export function playBookClose(): void {
  noise({ dur: 0.1, vol: 0.04, filterFreq: 260, q: 1.4, color: "brown" });
  tone({ type: "sine", freq: 95, freqEnd: 55, dur: 0.08, vol: 0.025 });
  noise({ dur: 0.3, vol: 0.03, filterFreq: 1500, filterEnd: 400, type: "bandpass", q: 0.8, color: "pink" });
}

/** A page turns: a papery swish with the crinkle of the sheet. */
export function playPageTurn(): void {
  noise({ dur: 0.28, vol: 0.11, filterFreq: 1800, filterEnd: 4200, type: "bandpass", q: 0.7, attack: 0.05, color: "pink" });
  crackle({ dur: 0.22, count: 4, vol: 0.016, freq: 3800, spread: 0.5, grain: 0.008, decay: 0 });
  noise({ dur: 0.08, vol: 0.02, filterFreq: 900, type: "bandpass", q: 2, delay: 0.24 });
}

/** A letter is carved into the name plaque: the chisel bites, a chip
 * flies. */
export function playCarve(): void {
  noise({ dur: 0.03, vol: 0.022, filterFreq: 3200, type: "bandpass", q: 3, attack: 0.001 });
  strike({ freq: 2400 + Math.random() * 600, dur: 0.06, vol: 0.006, modes: "stone" });
  crackle({ dur: 0.08, count: 2, vol: 0.007, freq: 4500, spread: 0.3, grain: 0.006, delay: 0.02 });
}
