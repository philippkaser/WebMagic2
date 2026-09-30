import { describe, expect, test } from "bun:test";
import { BIOME_DEFS } from "../world/biomes";
import { ambientLayers, MAX_AMBIENT_PER_LAYER, mixHex, type AmbientPlace } from "./ambientConfig";

const PLACES: AmbientPlace[] = [...BIOME_DEFS.map((b) => b.id), "village"];

describe("ambient layers", () => {
  test("every biome and the village has air, within budget", () => {
    for (const place of PLACES) {
      const ls = ambientLayers(place, null);
      expect(ls.length).toBeGreaterThan(0);
      expect(ls.length).toBeLessThanOrEqual(2); // ≤ 2 draw calls per place
      for (const l of ls) {
        expect(l.count).toBeGreaterThan(0);
        expect(l.count).toBeLessThanOrEqual(MAX_AMBIENT_PER_LAYER);
        expect(l.yRange[1]).toBeGreaterThan(l.yRange[0]);
        expect(l.size[1]).toBeGreaterThanOrEqual(l.size[0]);
        for (const c of l.colors) expect(c).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  test("the volume spans floor to ceiling", () => {
    const low = ambientLayers("catacombs", null, 4)[0];
    const high = ambientLayers("catacombs", null, 7)[0];
    expect(high.yRange[1]).toBeGreaterThan(low.yRange[1]);
    expect(high.yRange[1]).toBeLessThanOrEqual(7);
  });

  test("the drowned halls drip, the hollow's ash falls, the forge's embers rise", () => {
    expect(ambientLayers("drowned", null).some((l) => l.mode === "drip")).toBe(true);
    expect(ambientLayers("hollow", null)[0].drift[1]).toBeLessThan(0);
    expect(ambientLayers("forge", null)[0].drift[1]).toBeGreaterThan(0);
  });

  test("the Weightless Hour makes everything float upward", () => {
    for (const place of PLACES) {
      for (const l of ambientLayers(place, "weightless")) {
        if (l.mode === "firefly") continue; // fireflies wander, they don't flow
        expect(l.mode).not.toBe("drip");
        expect(l.drift[1]).toBeGreaterThan(0.3);
      }
    }
  });

  test("the Crimson Omen reddens the air", () => {
    const calm = ambientLayers("crystal", null)[0].colors[0];
    const red = ambientLayers("crystal", "crimson")[0].colors[0];
    const r = (h: string) => parseInt(h.slice(1, 3), 16);
    const b = (h: string) => parseInt(h.slice(5, 7), 16);
    expect(r(red) - b(red)).toBeGreaterThan(r(calm) - b(calm));
  });

  test("mixHex blends channel-wise", () => {
    expect(mixHex("#000000", "#ffffff", 0)).toBe("#000000");
    expect(mixHex("#000000", "#ffffff", 1)).toBe("#ffffff");
    expect(mixHex("#ff0000", "#0000ff", 0.5)).toBe("#800080");
  });
});
