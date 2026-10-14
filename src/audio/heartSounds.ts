import { DUB_AT, LUB_AT } from "../game/heart";
import { atPoint, synthNoise as noise, synthTone as tone } from "./sound";
import type { At } from "./spatial";

/** The sounds of being barely alive. Everything here but a floor-mate's
 * Brink plays in your head — straight to the master bus, clear of the
 * world's muffle (audio/muffle) — so as the world goes under, your own
 * heart, your own ringing ears and your own breath are what's left. All
 * synthesized, like every other sound. */

const clamp01 = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x);

/** One beat of your own heart (game/heart): a lub and a dub, landing where
 * the beat's picture peaks within a `period`-second beat — heavier the more
 * it's `felt`. */
export function playHeartThud(felt: number, period: number): void {
  const f = clamp01(felt);
  const v = 0.07 + f * 0.17;
  const lub = LUB_AT * period;
  const dub = DUB_AT * period;
  tone({ type: "sine", freq: 66, freqEnd: 40, dur: 0.17, vol: v, delay: lub });
  // The knock of it against the ribs.
  noise({ dur: 0.07, vol: v * 0.3, filterFreq: 240, filterEnd: 80, delay: lub });
  tone({ type: "sine", freq: 57, freqEnd: 36, dur: 0.14, vol: v * 0.68, delay: dub });
}

/** A blow taken in the last stand: a ragged breath torn out of you, rougher
 * the nearer death (`depth` = the heart's low). It cuts through the muffle. */
export function playWoundRasp(depth: number): void {
  const d = clamp01(depth);
  noise({ dur: 0.26, vol: 0.04 + 0.06 * d, filterFreq: 1500, filterEnd: 480, type: "bandpass", q: 3 });
  tone({ type: "sawtooth", freq: 120 - 36 * d, freqEnd: 52, dur: 0.3, vol: 0.035 + 0.04 * d });
}

/** The Brink — the blow that should have killed you: a dull thoom inside the
 * skull, then the ring: tinnitus, high and thin, two sines beating against
 * each other, dying away over a couple of seconds while the world is gone. */
export function playBrink(): void {
  tone({ type: "sine", freq: 92, freqEnd: 28, dur: 0.65, vol: 0.34 });
  noise({ dur: 0.4, vol: 0.13, filterFreq: 700, filterEnd: 60 });
  tone({ type: "sine", freq: 3600, dur: 2.6, vol: 0.034, attack: 0.03 });
  tone({ type: "sine", freq: 3627, dur: 2.1, vol: 0.02, attack: 0.06 });
}

/** A second wind: a breath drawn in, rising through the throat, and a soft
 * fifth settling under it. */
export function playSecondWind(): void {
  noise({ dur: 0.9, vol: 0.11, filterFreq: 300, filterEnd: 3000, type: "bandpass", q: 1.6, attack: 0.6 });
  tone({ type: "sine", freq: 220, dur: 1.4, vol: 0.05, delay: 0.35, attack: 0.25 });
  tone({ type: "sine", freq: 330, dur: 1.5, vol: 0.04, delay: 0.45, attack: 0.3 });
}

/** A floor-mate at the Brink, heard where they stand: a shorter ring and a
 * dull knock, through the world like any other sound. */
export function playPeerBrink(at: At): void {
  atPoint(
    at,
    1.5,
    () => {
      tone({ type: "sine", freq: 2400, dur: 1.3, vol: 0.05, attack: 0.02 });
      tone({ type: "sine", freq: 2418, dur: 1.1, vol: 0.03, attack: 0.03 });
      tone({ type: "sine", freq: 84, freqEnd: 34, dur: 0.4, vol: 0.14 });
    },
    1.2,
    0.4,
  );
}
