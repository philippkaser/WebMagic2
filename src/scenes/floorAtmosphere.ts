import { useThree } from "@react-three/fiber";
import { useEffect } from "react";
import { Color, Fog } from "three";
import { playOmen, startAmbient, stopAmbient, type AmbientMood } from "../audio/sound";
import { resetGrade, setGrade } from "../render/Effects";
import { floorTint, NO_TINT, setFloorTint, turnHue } from "../render/floorTint";
import { getBiomeDef } from "../world/biomes";
import { omenGenMods } from "../world/omens";
import type { BiomeId, FloorLayout } from "../world/types";

/** How a floor FEELS, applied while it's mounted: the biome's fog, backdrop,
 * environment-map strength, colour grade (eased in by render/Effects), the
 * floor's tint and ambient drone, and the omen's arrival whisper. The layout decides WHAT is on the floor; this decides the mood
 * it's seen and heard in. (The omen's rule bends are installed by GameScene
 * alongside the layout, before any enemy renders.) Everything here is
 * undone on unmount. */

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

/** Fog/background/ambient of a biome, with the omen's fog squeeze applied
 * and the floor's tint (render/floorTint.ts) — the air takes half of the
 * turn the stone takes. */
export function atmosphereOf(layout: FloorLayout) {
  const biome = getBiomeDef(layout.biome);
  const fogMult = omenGenMods(layout.omen).fogMult;
  const tint = floorTint(layout.seed);
  return {
    biome,
    tint,
    fog: { color: turnHue(biome.fog.color, tint.hue * 0.5), near: biome.fog.near * fogMult, far: biome.fog.far * fogMult },
    background: turnHue(biome.background, tint.hue * 0.5),
  };
}

export function useFloorAtmosphere(layout: FloorLayout): void {
  const scene = useThree((s) => s.scene);

  useEffect(() => {
    const { biome, fog, background, tint } = atmosphereOf(layout);
    scene.fog = new Fog(fog.color, fog.near, fog.far);
    scene.background = new Color(background);
    setFloorTint(tint);
    const envBefore = scene.environmentIntensity;
    scene.environmentIntensity = biome.envIntensity;
    setGrade(biome.grade, biome.air);
    startAmbient("dungeon", BIOME_MOODS[layout.biome]);

    let omenTimer: ReturnType<typeof setTimeout> | null = null;
    if (layout.omen) {
      // The omen's name and whisper are written into the arrival title (the
      // HUD's Location); here it only announces itself in sound.
      omenTimer = setTimeout(playOmen, OMEN_DELAY_MS);
    }
    return () => {
      if (omenTimer !== null) clearTimeout(omenTimer);
      scene.fog = null;
      setFloorTint(NO_TINT);
      scene.environmentIntensity = envBefore;
      resetGrade();
      stopAmbient();
    };
  }, [scene, layout]);
}
