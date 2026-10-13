import { useThree } from "@react-three/fiber";
import { useEffect } from "react";
import { getBiomeDef } from "../../world/biomes";
import type { BiomeId, FloorLayout } from "../../world/types";
import { type BounceLight, bakeBounce, linearRgb } from "./bounce";
import { clearLightGrid, setLightGrid } from "./lightGrid";

/** Hands a dungeon floor to the light grid (lightGrid.ts) while it's
 * mounted: the tile occupancy for the grid shadows, and the bounce field
 * baked from the floor's static lights (bounce.ts) — its torches, in the
 * colours the scene lit them with, and its light shafts. Unmount clears
 * both, so the village never sees them. Renders nothing. */

/** The torch's pooled light (world/props.tsx#Torch): a quarter-metre over
 * the sconce, 0.2 m off it, flickering round 7 × the band's multiplier. */
const TORCH_LIGHT = { lift: 0.25, out: 0.2, intensity: 7, range: 10 };

/** How strongly each band's bounce shows: the dark, saturated bands carry
 * more of their torches' colour round the corner. */
const BOUNCE_BY_BIOME: Record<BiomeId, number> = {
  catacombs: 0.9,
  drowned: 1.15,
  forge: 0.9,
  crystal: 1.1,
  hollow: 1,
};

export function FloorLighting({ layout, torchColors }: { layout: FloorLayout; torchColors: readonly string[] }) {
  useEffect(() => {
    const biome = getBiomeDef(layout.biome);
    const lights: BounceLight[] = layout.torches.map(([x, y, z], i) => ({
      x,
      y: y + TORCH_LIGHT.lift,
      z: z + TORCH_LIGHT.out,
      color: linearRgb(torchColors[i] ?? biome.torchColor),
      intensity: TORCH_LIGHT.intensity * biome.torchIntensityMult,
      range: TORCH_LIGHT.range,
    }));
    // The pools under the shafts (scenes/DungeonFloor.tsx#ShaftLights).
    const shaft = biome.look.shaft;
    for (const s of layout.architecture.shafts) {
      lights.push({
        x: s.pos[0],
        y: shaft.rising ? 0.6 : 2.2,
        z: s.pos[2],
        color: linearRgb(shaft.color),
        intensity: (shaft.rising ? 10 : 16) * shaft.strength,
        range: 6 + s.radius * 1.5,
      });
    }
    const grid = { tiles: layout.tiles, size: layout.size };
    setLightGrid(layout.tiles, layout.size, bakeBounce(grid, lights), BOUNCE_BY_BIOME[layout.biome]);
    return () => clearLightGrid();
  }, [layout, torchColors]);
  useSceneBench();
  return null;
}

/** Dev: time the world pass alone (no post), `frames` synchronous renders,
 * each waited out — perf A/Bs of the light grid that the shared machine's
 * frame-to-frame noise can't drown. */
function useSceneBench(): void {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as Record<string, unknown>;
    w.__scene = scene;
    w.__sceneBench = (frames = 8) => {
      const ctx = gl.getContext();
      const px = new Uint8Array(4);
      const out: number[] = [];
      for (let i = 0; i < frames; i++) {
        const t0 = performance.now();
        gl.render(scene, camera);
        ctx.readPixels(0, 0, 1, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, px);
        out.push(performance.now() - t0);
      }
      return out;
    };
    return () => {
      delete w.__sceneBench;
      delete w.__scene;
    };
  }, [gl, scene, camera]);
}
