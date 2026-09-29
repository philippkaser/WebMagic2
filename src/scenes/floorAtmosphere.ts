import { useThree } from "@react-three/fiber";
import { useEffect } from "react";
import { Color, Fog } from "three";
import { playOmen, startAmbient, stopAmbient, type AmbientMood } from "../audio/sound";
import { gameEvents } from "../core/events";
import { getBiomeDef } from "../world/biomes";
import { getOmenDef, omenGenMods } from "../world/omens";
import type { BiomeId, FloorLayout } from "../world/types";

/** How a floor FEELS, applied while it's mounted: the biome's fog, backdrop
 * and ambient drone, and the omen's arrival whisper. The layout decides WHAT
 * is on the floor; this decides the mood it's seen and heard in. (The omen's
 * rule bends are installed by GameScene alongside the layout, before any
 * enemy renders.) Everything here is undone on unmount. */

/** Each band hums in its own key. */
const BIOME_MOODS: Record<BiomeId, AmbientMood> = {
  catacombs: { drone: 41, wind: 220, weight: 1 },
  drowned: { drone: 36.7, wind: 560, weight: 0.9 },
  forge: { drone: 46.2, wind: 150, weight: 1.35 },
  crystal: { drone: 55, wind: 1100, weight: 0.7 },
  hollow: { drone: 30.9, wind: 90, weight: 0.45 },
};

/** How long after arrival the omen makes itself known — after the load
 * settles and the floor has had a moment to look ordinary. */
const OMEN_DELAY_MS = 1600;

/** Fog/background/ambient of a biome, with the omen's fog squeeze applied. */
export function atmosphereOf(layout: FloorLayout) {
  const biome = getBiomeDef(layout.biome);
  const fogMult = omenGenMods(layout.omen).fogMult;
  return {
    biome,
    fog: { color: biome.fog.color, near: biome.fog.near * fogMult, far: biome.fog.far * fogMult },
  };
}

export function useFloorAtmosphere(layout: FloorLayout): void {
  const scene = useThree((s) => s.scene);

  useEffect(() => {
    const { biome, fog } = atmosphereOf(layout);
    scene.fog = new Fog(fog.color, fog.near, fog.far);
    scene.background = new Color(biome.background);
    startAmbient("dungeon", BIOME_MOODS[layout.biome]);

    let omenTimer: ReturnType<typeof setTimeout> | null = null;
    if (layout.omen) {
      const omen = getOmenDef(layout.omen);
      omenTimer = setTimeout(() => {
        playOmen();
        gameEvents.emit("message", `${omen.name} — ${omen.whisper}`);
      }, OMEN_DELAY_MS);
    }
    return () => {
      if (omenTimer !== null) clearTimeout(omenTimer);
      scene.fog = null;
      stopAmbient();
    };
  }, [scene, layout]);
}
