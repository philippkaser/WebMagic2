import { crackle, fm, noise, strike, tone } from "./synth";

/** Sounds of the in-world UI: stone slabs grinding together, the cast map
 * humming into being, runes igniting, buttons ticking and pinging. Kept apart from the game
 * sounds so UI work never touches the combat bank. All synthesized. */

/** A tablet assembles: stone grinding into place, a knock as it seats, and
 * a rising chime. */
export function playTabletBuild(): void {
  noise({ dur: 0.55, vol: 0.05, filterFreq: 180, filterEnd: 420, q: 1.2, color: "brown" });
  crackle({ dur: 0.45, count: 7, vol: 0.016, freq: 1600, spread: 0.5, grain: 0.02, decay: 0.1 });
  strike({ freq: 160, dur: 0.18, vol: 0.028, modes: "stone", delay: 0.32 });
  tone({ type: "sine", freq: 392, freqEnd: 523, dur: 0.7, vol: 0.03, delay: 0.3, detune: 6 });
  strike({ freq: 784, dur: 0.8, vol: 0.022, modes: "glass", delay: 0.42 });
}

/** A tablet breaks apart: stone cracking and crumbling. */
export function playTabletBreak(): void {
  strike({ freq: 190, dur: 0.15, vol: 0.025, modes: "stone" });
  noise({ dur: 0.5, vol: 0.03, filterFreq: 700, filterEnd: 140, q: 1, color: "pink" });
  crackle({ dur: 0.45, count: 8, vol: 0.013, freq: 1900, spread: 0.5, grain: 0.015 });
  tone({ type: "triangle", freq: 330, freqEnd: 196, dur: 0.4, vol: 0.016 });
}

/** A pane is cast: a sigil hums awake, light pours up and tunes in. */
export function playHoloCast(): void {
  tone({ type: "sine", freq: 110, freqEnd: 220, dur: 0.5, vol: 0.04, detune: 8 });
  noise({ dur: 0.45, vol: 0.026, filterFreq: 1800, filterEnd: 5200, type: "bandpass", q: 4, delay: 0.12, color: "pink" });
  fm({ freq: 523, freqEnd: 784, dur: 0.35, vol: 0.022, delay: 0.22, ratio: 2, index: 1.5 });
  strike({ freq: 1318, dur: 0.6, vol: 0.014, modes: "glass", delay: 0.38 });
}

/** A pane collapses back into its sigil. */
export function playHoloCollapse(): void {
  fm({ freq: 660, freqEnd: 165, dur: 0.32, vol: 0.025, ratio: 2, index: 1.2, indexEnd: 0 });
  noise({ dur: 0.25, vol: 0.018, filterFreq: 4200, filterEnd: 900, type: "bandpass", q: 3, color: "pink" });
}

/** The pointer finds a button: a faint glass tick. */
export function playUiHover(): void {
  strike({ freq: 1480, dur: 0.12, vol: 0.016, modes: "glass", bright: 0.7, vary: 20 });
}

/** A button is pressed: a stone click and a bright ping. */
export function playUiPress(): void {
  noise({ dur: 0.05, vol: 0.07, filterFreq: 2400, type: "bandpass", q: 2, attack: 0.001 });
  strike({ freq: 520, dur: 0.07, vol: 0.04, modes: "stone" });
  strike({ freq: 1320, dur: 0.4, vol: 0.025, modes: "glass", delay: 0.01 });
}

/** Words burn into the air ahead of you: a fizz of embers and a thin hum. */
export function playRuneWrite(): void {
  noise({ dur: 0.45, vol: 0.022, filterFreq: 3000, filterEnd: 5200, type: "bandpass", q: 5, color: "pink" });
  crackle({ dur: 0.4, count: 6, vol: 0.012, freq: 5000, spread: 0.3, grain: 0.006, decay: 0.2 });
  tone({ type: "sine", freq: 880, freqEnd: 988, dur: 0.35, vol: 0.012, vibrato: [7, 10] });
}

/** An item is picked up in the inventory (drag starts). */
export function playItemLift(): void {
  noise({ dur: 0.1, vol: 0.02, filterFreq: 800, filterEnd: 2400, type: "bandpass", q: 1.2, color: "pink" });
  tone({ type: "sine", freq: 520, freqEnd: 700, dur: 0.12, vol: 0.026 });
}

/** An item is set down in a slot (drag ends): a small solid knock. */
export function playItemSet(): void {
  noise({ dur: 0.04, vol: 0.05, filterFreq: 1500, type: "bandpass", q: 2, attack: 0.001 });
  strike({ freq: 330, dur: 0.1, vol: 0.026, modes: "stone", vary: 40 });
  tone({ type: "sine", freq: 440, freqEnd: 330, dur: 0.12, vol: 0.02 });
}
