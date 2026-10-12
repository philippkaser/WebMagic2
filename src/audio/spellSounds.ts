import type { SpellDef } from "../weapons/spellCatalog";
import { atPoint, synthNoise as noise, synthTone as tone } from "./sound";
import type { At } from "./spatial";

/** Per-archetype cast timbres — each staff class sounds like what it is,
 * the way a shotgun and a rifle never sound alike. Placed and traced like
 * every world sound (audio/sound.ts atPoint): your own casts from where you
 * stand, a floor-mate's from their staff. Synthesized, zero assets.
 *
 * Held spells (the beam, the flame) tick many times a second; their ticks
 * are short and quiet so the stream of them becomes a hum, not a rattle. */

let tick = 0;

export function playSpellCast(def: Readonly<SpellDef>, at?: At): void {
  switch (def.kind) {
    case "ray":
      if (def.look === "beam") {
        // A buzzing hum: a square pair beating against each other.
        if (tick++ % 2 !== 0) return;
        atPoint(at, 0.2, () => {
          tone({ type: "square", freq: 196, dur: 0.17, vol: 0.035, attack: 0.02 });
          tone({ type: "square", freq: 201, dur: 0.17, vol: 0.03, attack: 0.02 });
          noise({ dur: 0.15, vol: 0.02, filterFreq: 5200, type: "highpass", q: 0.7 });
        });
        return;
      }
      // The rail: a charged crack and a falling zing.
      atPoint(at, 0.9, () => {
        tone({ type: "sawtooth", freq: 2200, freqEnd: 140, dur: 0.55, vol: 0.09 });
        tone({ type: "sine", freq: 90, freqEnd: 40, dur: 0.5, vol: 0.2 });
        noise({ dur: 0.35, vol: 0.12, filterFreq: 6000, filterEnd: 900, type: "bandpass", q: 1.2 });
      }, 1.3, 0.6);
      return;
    case "chain":
      // Crackle: bursts of bright noise over a low electrical growl.
      atPoint(at, 0.45, () => {
        for (let i = 0; i < 4; i++) {
          noise({ dur: 0.05, vol: 0.09, filterFreq: 3500 + Math.random() * 2500, type: "highpass", q: 1, delay: i * 0.035 });
        }
        tone({ type: "sawtooth", freq: 82, freqEnd: 60, dur: 0.3, vol: 0.08 });
      }, 1.1, 0.5);
      return;
    case "cone":
      // A roar of air: lowpassed noise, a soft rumble under it.
      if (tick++ % 2 !== 0) return;
      atPoint(at, 0.25, () => {
        noise({ dur: 0.2, vol: 0.07, filterFreq: 900, filterEnd: 1400, type: "lowpass", q: 0.5, attack: 0.03 });
        tone({ type: "sine", freq: 70, dur: 0.18, vol: 0.05, attack: 0.03 });
      }, 1, 0.6);
      return;
    case "bolt":
      if (def.gravityScale >= 0.9) {
        // A shell lobbed: a hollow thump.
        atPoint(at, 0.4, () => {
          tone({ type: "sine", freq: 130, freqEnd: 52, dur: 0.24, vol: 0.2 });
          noise({ dur: 0.12, vol: 0.06, filterFreq: 600, filterEnd: 200 });
        });
        return;
      }
      break;
  }
  // The classic spell: a zap leaving the staff.
  atPoint(at, 0.3, () => {
    tone({ type: "square", freq: 640 + Math.random() * 120, freqEnd: 170, dur: 0.13, vol: 0.1 });
    noise({ dur: 0.09, vol: 0.05, filterFreq: 2600, filterEnd: 500, type: "bandpass", q: 2 });
  });
}

/** Stormcaller's sky-bolt landing. */
export function playThunder(at?: At): void {
  atPoint(at, 1.4, () => {
    noise({ dur: 0.08, vol: 0.2, filterFreq: 7000, type: "highpass" });
    noise({ dur: 1.1, vol: 0.16, filterFreq: 500, filterEnd: 60, delay: 0.04 });
    tone({ type: "sine", freq: 60, freqEnd: 30, dur: 0.9, vol: 0.2, delay: 0.03 });
  }, 1.4, 2);
}

/** A bolt glancing off stone. */
export function playRicochet(at?: At): void {
  atPoint(at, 0.25, () => tone({ type: "triangle", freq: 1400 + Math.random() * 600, freqEnd: 500, dur: 0.12, vol: 0.06 }), 1, 0.2);
}
