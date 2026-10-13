import { describe, expect, test } from "bun:test";
import { type NpcId, type NpcLineKind, allNpcVoices, getNpcVoice, npcLines, pickNpcLine } from "./npcLines";

/** The camp's voices: four people, every one with something to say to a
 * wizard fresh from the village and something more for the deep ones,
 * short enough for a speech plate, never in UI terms. */

const voices = allNpcVoices();
const KINDS: NpcLineKind[] = ["greeting", "idle", "hint"];

describe("npc voice lines", () => {
  test("Maro, Wenna, Brannoc and Varr, each with every kind of line", () => {
    expect(voices.map((v) => v.id).sort()).toEqual(["brannoc", "maro", "varr", "wenna"]);
    for (const v of voices) {
      expect(getNpcVoice(v.id)).toBe(v);
      expect(v.name.length).toBeGreaterThan(0);
      for (const k of KINDS) expect(v[k].length).toBeGreaterThanOrEqual(5);
    }
    expect(() => getNpcVoice("hesk" as NpcId)).toThrow();
  });

  test("lines are unique, short, and never speak in UI terms", () => {
    const seen = new Set<string>();
    const banned = [/\bHP\b/, /\bMP\b/, /checkpoint/i, /\bfloor \d/i, /\blevel \d/i, /\bXP\b/, /\bclick\b/i];
    for (const v of voices) {
      for (const k of KINDS) {
        for (const l of v[k]) {
          expect(seen.has(l.text)).toBe(false);
          seen.add(l.text);
          expect(l.text.trim().length).toBeGreaterThan(8);
          expect(l.text.length).toBeLessThanOrEqual(160);
          for (const re of banned) expect(l.text).not.toMatch(re);
          if (l.minDeepest !== undefined && l.maxDeepest !== undefined) expect(l.maxDeepest).toBeGreaterThan(l.minDeepest);
        }
      }
    }
  });

  test("a wizard fresh from the village is greeted, barked at and warned by everyone", () => {
    for (const v of voices) for (const k of KINDS) expect(npcLines(v.id, k, 0).length).toBeGreaterThan(0);
  });

  test("hints follow the wizard down, and the deep ones hear what the shallow don't", () => {
    for (const v of voices) {
      for (let deepest = 0; deepest <= 100; deepest += 5) expect(npcLines(v.id, "hint", deepest).length).toBeGreaterThan(0);
      const shallow = new Set(npcLines(v.id, "hint", 0).map((l) => l.text));
      const deep = npcLines(v.id, "hint", 90);
      expect(deep.some((l) => !shallow.has(l.text))).toBe(true);
      for (const l of npcLines(v.id, "hint", 3)) expect(l.minDeepest ?? 0).toBeLessThanOrEqual(3);
    }
  });

  test("picking is pure, gated, and leans toward where the wizard has just been", () => {
    for (const v of voices) {
      for (const k of KINDS) {
        for (const deepest of [0, 12, 40, 90]) {
          for (const roll of [0, 0.25, 0.5, 0.999, 1]) {
            const a = pickNpcLine(v.id, k, deepest, roll);
            expect(a).toEqual(pickNpcLine(v.id, k, deepest, roll));
            expect(npcLines(v.id, k, deepest)).toContain(a!);
          }
        }
      }
    }
    // Deep wizards hear deep hints more often than not.
    let deepHits = 0;
    for (let i = 0; i < 100; i++) if ((pickNpcLine("wenna", "hint", 80, i / 100)!.minDeepest ?? 0) >= 50) deepHits++;
    expect(deepHits).toBeGreaterThan(40);
  });
});
