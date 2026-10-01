import { synthNoise, synthTone } from "./sound";

/** Sounds of the in-world UI: panes of light humming into being and
 * collapsing, runes igniting, buttons ticking and pinging. Kept apart from the game
 * sounds so UI work never touches the combat bank. All synthesized. */

/** A pane is cast: a sigil hums awake, light pours up and tunes in. */
export function playHoloCast(): void {
  synthTone({ type: "sine", freq: 110, freqEnd: 220, dur: 0.5, vol: 0.04 });
  synthNoise({ dur: 0.45, vol: 0.03, filterFreq: 1800, filterEnd: 5200, type: "bandpass", q: 4, delay: 0.12 });
  synthTone({ type: "triangle", freq: 523, freqEnd: 784, dur: 0.35, vol: 0.022, delay: 0.22 });
  synthTone({ type: "sine", freq: 1046, freqEnd: 1318, dur: 0.4, vol: 0.012, delay: 0.38 });
}

/** A pane collapses back into its sigil. */
export function playHoloCollapse(): void {
  synthTone({ type: "sine", freq: 660, freqEnd: 165, dur: 0.32, vol: 0.025 });
  synthNoise({ dur: 0.25, vol: 0.02, filterFreq: 4200, filterEnd: 900, type: "bandpass", q: 3 });
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
