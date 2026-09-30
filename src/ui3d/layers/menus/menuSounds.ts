import { synthNoise, synthTone } from "../../../audio/sound";

/** The menus' own sounds — the beats of their rituals. Kept beside the
 * screens (not in audio/uiSounds.ts, which the whole UI shares) because
 * each is tied to one moment of one screen. All synthesized. */

/** A thread of light leaves an item and runs to the gate's reading. */
export function playThread(index: number): void {
  synthTone({ type: "sine", freq: 523 * (1 + index * 0.125), freqEnd: 784 * (1 + index * 0.125), dur: 0.5, vol: 0.018 });
}

/** The gate names your resonance: a struck bowl. */
export function playResonance(): void {
  synthTone({ type: "sine", freq: 294, dur: 1.6, vol: 0.05 });
  synthTone({ type: "sine", freq: 588, dur: 1.2, vol: 0.02, delay: 0.01 });
  synthTone({ type: "triangle", freq: 882, freqEnd: 870, dur: 0.9, vol: 0.012, delay: 0.02 });
}

/** The destination burns in: low gong under a rushing flare. */
export function playFloorReveal(): void {
  synthTone({ type: "sine", freq: 98, freqEnd: 82, dur: 2.2, vol: 0.09 });
  synthTone({ type: "triangle", freq: 196, freqEnd: 180, dur: 1.4, vol: 0.03 });
  synthNoise({ dur: 0.7, vol: 0.05, filterFreq: 600, filterEnd: 3200, type: "bandpass", q: 1.5 });
}

/** YOU DIED: a slow, falling toll. */
export function playDeathToll(): void {
  synthTone({ type: "sine", freq: 110, freqEnd: 73, dur: 3.2, vol: 0.1 });
  synthTone({ type: "triangle", freq: 165, freqEnd: 110, dur: 2.4, vol: 0.035, delay: 0.05 });
  synthNoise({ dur: 1.4, vol: 0.04, filterFreq: 300, filterEnd: 90, q: 0.9 });
}

/** A lost thing crumbles to ash. */
export function playCrumble(index: number): void {
  synthNoise({ dur: 0.45, vol: 0.05, filterFreq: 1400 - index * 60, filterEnd: 200, q: 0.9 });
  synthTone({ type: "triangle", freq: 220 - index * 8, freqEnd: 110, dur: 0.3, vol: 0.012 });
}

/** A lost thing sinks into its grave. */
export function playGraveTake(index: number): void {
  synthTone({ type: "sine", freq: 330 - index * 12, freqEnd: 165, dur: 0.6, vol: 0.03 });
  synthNoise({ dur: 0.3, vol: 0.03, filterFreq: 500, filterEnd: 150, q: 1 });
}

/** The tome opens / shuts. */
export function playBookOpen(): void {
  synthNoise({ dur: 0.35, vol: 0.06, filterFreq: 700, filterEnd: 2200, type: "bandpass", q: 0.8 });
  synthNoise({ dur: 0.12, vol: 0.05, filterFreq: 300, q: 1.2, delay: 0.3 });
  synthTone({ type: "sine", freq: 392, freqEnd: 440, dur: 0.6, vol: 0.02, delay: 0.25 });
}

export function playBookClose(): void {
  synthNoise({ dur: 0.1, vol: 0.09, filterFreq: 260, q: 1.4 });
  synthNoise({ dur: 0.3, vol: 0.03, filterFreq: 1500, filterEnd: 400, type: "bandpass", q: 0.8 });
}

/** A page turns: a papery swish. */
export function playPageTurn(): void {
  synthNoise({ dur: 0.28, vol: 0.05, filterFreq: 1800, filterEnd: 4200, type: "bandpass", q: 0.7 });
  synthNoise({ dur: 0.08, vol: 0.02, filterFreq: 900, type: "bandpass", q: 2, delay: 0.24 });
}

/** A letter is carved into the name plaque. */
export function playCarve(): void {
  synthNoise({ dur: 0.04, vol: 0.035, filterFreq: 3200, type: "bandpass", q: 3 });
}
