import { atPoint, synthNoise as noise, synthTone as tone } from "./sound";
import type { At } from "./spatial";

/** The camp's crafting corners, heard where they stand: the cauldron's
 * bubbling and its gulp when a brew takes, the anvil's ring. Synthesized,
 * zero assets. */

/** A few fat bubbles breaking the brew's surface. */
export function playBubble(at?: At): void {
  atPoint(at, 0.35, () => {
    const n = 1 + Math.floor(Math.random() * 2);
    for (let i = 0; i < n; i++) {
      const f = 180 + Math.random() * 160;
      tone({ type: "sine", freq: f, freqEnd: f * 2.4, dur: 0.07, vol: 0.05, delay: i * 0.08 });
    }
  }, 0.7, 0.4);
}

/** A brew takes: a rising gulp and a hiss of steam. */
export function playBrewDone(at?: At): void {
  atPoint(at, 1.2, () => {
    for (let i = 0; i < 6; i++) {
      const f = 160 + i * 60 + Math.random() * 40;
      tone({ type: "sine", freq: f, freqEnd: f * 2.6, dur: 0.09, vol: 0.08, delay: i * 0.06 });
    }
    noise({ dur: 0.9, vol: 0.06, filterFreq: 3800, filterEnd: 1600, type: "bandpass", q: 0.8, delay: 0.25, attack: 0.15 });
    tone({ type: "triangle", freq: 660, dur: 0.5, vol: 0.06, delay: 0.45 });
    tone({ type: "triangle", freq: 990, dur: 0.6, vol: 0.05, delay: 0.55 });
  }, 1.2, 0.6);
}

/** Hammer on anvil: a struck bar's inharmonic ring. `heavy` for the big
 * works (enhance, the Great Work). */
export function playAnvil(at?: At, heavy = false): void {
  atPoint(at, heavy ? 1.6 : 1, () => {
    const strikes = heavy ? 3 : 1;
    for (let s = 0; s < strikes; s++) {
      const d = s * 0.32;
      for (const [k, v] of [
        [1, 0.12],
        [2.76, 0.07],
        [5.4, 0.04],
      ] as const) {
        tone({ type: "sine", freq: 520 * k, dur: heavy ? 1.1 : 0.7, vol: v, delay: d });
      }
      noise({ dur: 0.05, vol: 0.12, filterFreq: 4000, type: "highpass", delay: d });
    }
  }, 1.3, 0.4);
}

/** The forge breathing: a low roar of coals under the bellows. */
export function playBellows(at?: At): void {
  atPoint(at, 0.8, () => {
    noise({ dur: 0.7, vol: 0.06, filterFreq: 300, filterEnd: 700, attack: 0.25 });
  }, 0.8, 0.8);
}
