import type { BiomeId, OmenId } from "../world/types";

/** What drifts in the air of each place — pure data (no three.js), so the
 * table and its omen bends are unit-tested. AmbientParticles.tsx turns each
 * layer into one instanced draw whose motion is computed entirely on the GPU.
 *
 * Sizes are sprite half-extents in metres; the shader's minimum-pixel rule
 * keeps the tiniest motes a steady single pixel at dpr 0.35. */

export type AmbientPlace = BiomeId | "village";

export type AmbientShape = "glow" | "streak" | "chunk" | "flare";

export interface AmbientLayer {
  /** Particles in the volume (the whole layer is one draw call). */
  count: number;
  shape: AmbientShape;
  /** drift: flow + wander, wrapped around the camera. drip: falls from the
   * ceiling under gravity and ripples on the floor. firefly: wandering
   * lights that blink. */
  mode: "drift" | "drip" | "firefly";
  /** Two hex colours; each particle picks a fixed mix of them. */
  colors: readonly [string, string];
  /** Self-glow (HDR multiplier; > 1 blooms). */
  intensity: number;
  /** How strongly the light pool + staff light brighten it — dust that is
   * only visible where the torchlight catches it. */
  lit: number;
  /** 1 = additive light, 0 = alpha-blended matter (ash). */
  additive: number;
  alpha: number;
  size: readonly [number, number];
  /** Mean flow, m/s. */
  drift: readonly [number, number, number];
  /** Wander amplitude (m) and angular speed (rad/s). */
  wander: number;
  wanderFreq: number;
  /** Brightness twinkle depth 0..1 and speed (rad/s). */
  twinkle: number;
  twinkleFreq: number;
  /** Vertical band (world y) the layer occupies. */
  yRange: readonly [number, number];
  /** Horizontal side of the camera-centred box (m). */
  extent: number;
}

/** Upper bound on any layer — keeps a bad tweak from costing a frame. */
export const MAX_AMBIENT_PER_LAYER = 600;

function layers(place: AmbientPlace, ceiling: number): AmbientLayer[] {
  const top = Math.max(2, ceiling);
  switch (place) {
    case "catacombs":
      // Dust hanging in the torchlight: invisible in the dark, a slow
      // glittering haze wherever a flame (or your staff) lights it.
      return [
        {
          count: 420,
          shape: "glow",
          mode: "drift",
          colors: ["#f0d8b4", "#c2a888"],
          intensity: 0.05,
          lit: 2.6,
          additive: 1,
          alpha: 0.9,
          size: [0.012, 0.024],
          drift: [0.03, -0.02, 0.02],
          wander: 0.35,
          wanderFreq: 0.35,
          twinkle: 0.3,
          twinkleFreq: 1.5,
          yRange: [0.15, top - 0.2],
          extent: 22,
        },
      ];
    case "drowned":
      // Bioluminescent spores rising through brine-mist, and drips.
      return [
        {
          count: 300,
          shape: "glow",
          mode: "drift",
          colors: ["#8fffe0", "#5ad0ff"],
          intensity: 0.9,
          lit: 0.6,
          additive: 1,
          alpha: 0.7,
          size: [0.012, 0.028],
          drift: [0.02, 0.12, 0.01],
          wander: 0.25,
          wanderFreq: 0.5,
          twinkle: 0.6,
          twinkleFreq: 1.2,
          yRange: [0.1, top],
          extent: 22,
        },
        {
          count: 40,
          shape: "streak",
          mode: "drip",
          colors: ["#d4fbff", "#8fe6d4"],
          intensity: 1.3,
          lit: 1.6,
          additive: 1,
          alpha: 0.85,
          size: [0.012, 0.018],
          drift: [0, 0, 0],
          wander: 0,
          wanderFreq: 0,
          twinkle: 0,
          twinkleFreq: 0,
          yRange: [0.02, top - 0.05],
          extent: 18,
        },
      ];
    case "forge":
      // The fires never cooled: embers riding the heat, and ash with them.
      return [
        {
          count: 260,
          shape: "glow",
          mode: "drift",
          colors: ["#ffb35a", "#ff5a1f"],
          intensity: 2.2,
          lit: 0,
          additive: 1,
          alpha: 0.9,
          size: [0.012, 0.03],
          drift: [0.08, 0.55, 0.03],
          wander: 0.4,
          wanderFreq: 0.9,
          twinkle: 0.7,
          twinkleFreq: 5,
          yRange: [0, top + 0.5],
          extent: 22,
        },
        {
          count: 200,
          shape: "chunk",
          mode: "drift",
          colors: ["#5a5048", "#2e2a26"],
          intensity: 0.25,
          lit: 1.2,
          additive: 0,
          alpha: 0.85,
          size: [0.012, 0.022],
          drift: [0.05, 0.18, 0],
          wander: 0.5,
          wanderFreq: 0.4,
          twinkle: 0,
          twinkleFreq: 0,
          yRange: [0, top],
          extent: 20,
        },
      ];
    case "crystal":
      // The deep sings: motes that glint like struck glass.
      return [
        {
          count: 440,
          shape: "flare",
          mode: "drift",
          colors: ["#9fe8ff", "#d8a8ff"],
          intensity: 2.4,
          lit: 0.5,
          additive: 1,
          alpha: 0.95,
          size: [0.02, 0.04],
          drift: [0.02, 0.04, -0.02],
          wander: 0.3,
          wanderFreq: 0.3,
          twinkle: 0.85,
          twinkleFreq: 2.4,
          yRange: [0.1, top],
          extent: 24,
        },
      ];
    case "hollow":
      // Near the bottom, pale ash falls without a sound.
      return [
        {
          count: 480,
          shape: "chunk",
          mode: "drift",
          colors: ["#c4c0b6", "#8e8a80"],
          intensity: 0.35,
          lit: 0.8,
          additive: 0,
          alpha: 0.8,
          size: [0.011, 0.02],
          drift: [0.04, -0.28, 0.02],
          wander: 0.45,
          wanderFreq: 0.5,
          twinkle: 0,
          twinkleFreq: 0,
          yRange: [0, top],
          extent: 22,
        },
      ];
    case "village":
      // Night over the village: fireflies in the grass, motes in the air.
      return [
        {
          count: 70,
          shape: "glow",
          mode: "firefly",
          colors: ["#d8ff7a", "#fff29a"],
          intensity: 2.4,
          lit: 0,
          additive: 1,
          alpha: 1,
          size: [0.025, 0.04],
          drift: [0, 0, 0],
          wander: 1.4,
          wanderFreq: 0.35,
          twinkle: 1,
          twinkleFreq: 1.2,
          yRange: [0.3, 3.2],
          extent: 34,
        },
        {
          count: 180,
          shape: "glow",
          mode: "drift",
          colors: ["#a8b8ff", "#e0e8ff"],
          intensity: 0.3,
          lit: 1.2,
          additive: 1,
          alpha: 0.6,
          size: [0.01, 0.02],
          drift: [0.1, 0.03, 0.05],
          wander: 0.3,
          wanderFreq: 0.4,
          twinkle: 0.4,
          twinkleFreq: 1.5,
          yRange: [0.2, 6],
          extent: 26,
        },
      ];
  }
}

/** Mix a hex colour toward another by t (for omen tints). */
export function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (shift: number) => {
    const x = (pa >> shift) & 255;
    const y = (pb >> shift) & 255;
    return Math.round(x + (y - x) * t);
  };
  const v = (ch(16) << 16) | (ch(8) << 8) | ch(0);
  return `#${v.toString(16).padStart(6, "0")}`;
}

/** The layers for a place under an omen. Omens bend the air too:
 * - the Weightless Hour: everything floats upward, drips become rising
 *   droplets;
 * - the Crimson Omen: the motes run red. */
export function ambientLayers(place: AmbientPlace, omen: OmenId | null, ceiling = 7): AmbientLayer[] {
  return layers(place, ceiling).map((l) => {
    let out: AmbientLayer = { ...l, count: Math.min(l.count, MAX_AMBIENT_PER_LAYER) };
    if (omen === "weightless") {
      out = {
        ...out,
        mode: out.mode === "drip" ? "drift" : out.mode,
        shape: out.shape === "streak" ? "glow" : out.shape,
        drift: [out.drift[0], Math.max(out.drift[1], 0) + 0.42, out.drift[2]],
        wander: out.wander * 1.6 + 0.1,
      };
    } else if (omen === "crimson") {
      out = {
        ...out,
        colors: [mixHex(out.colors[0], "#ff2a2a", 0.55), mixHex(out.colors[1], "#8a0a14", 0.55)],
      };
    }
    return out;
  });
}
