import { synthNoise, synthTone } from "./sound";

/** Sounds of the in-world UI: stone slabs grinding together, runes igniting,
 * buttons that are really small stone plaques. Kept apart from the game
 * sounds so UI work never touches the combat bank. All synthesized. */

/** A tablet assembles: a low stone grind under a rising chime. */
export function playTabletBuild(): void {
  synthNoise({ dur: 0.55, vol: 0.07, filterFreq: 180, filterEnd: 420, q: 1.2 });
  synthNoise({ dur: 0.25, vol: 0.05, filterFreq: 900, filterEnd: 300, type: "bandpass", q: 3, delay: 0.32 });
  synthTone({ type: "sine", freq: 392, freqEnd: 523, dur: 0.7, vol: 0.035, delay: 0.3 });
  synthTone({ type: "sine", freq: 784, dur: 0.6, vol: 0.02, delay: 0.42 });
}

/** A tablet breaks apart. */
export function playTabletBreak(): void {
  synthNoise({ dur: 0.5, vol: 0.06, filterFreq: 600, filterEnd: 140, q: 1 });
  synthTone({ type: "triangle", freq: 330, freqEnd: 196, dur: 0.4, vol: 0.02 });
}

/** The pointer finds a button: a faint rune tick. */
export function playUiHover(): void {
  synthTone({ type: "sine", freq: 1320, freqEnd: 1480, dur: 0.07, vol: 0.018 });
}

/** A button is pressed: stone click and a bright ping. */
export function playUiPress(): void {
  synthNoise({ dur: 0.06, vol: 0.08, filterFreq: 2400, type: "bandpass", q: 2 });
  synthTone({ type: "triangle", freq: 660, freqEnd: 880, dur: 0.18, vol: 0.05 });
}

/** Words burn into the air ahead of you. */
export function playRuneWrite(): void {
  synthNoise({ dur: 0.45, vol: 0.025, filterFreq: 3000, filterEnd: 5200, type: "bandpass", q: 5 });
  synthTone({ type: "sine", freq: 880, freqEnd: 988, dur: 0.35, vol: 0.012 });
}

/** An item is picked up in the inventory (drag starts). */
export function playItemLift(): void {
  synthTone({ type: "sine", freq: 520, freqEnd: 700, dur: 0.12, vol: 0.03 });
}

/** An item is set down in a slot (drag ends). */
export function playItemSet(): void {
  synthNoise({ dur: 0.05, vol: 0.06, filterFreq: 1500, type: "bandpass", q: 2 });
  synthTone({ type: "sine", freq: 440, freqEnd: 330, dur: 0.12, vol: 0.03 });
}
