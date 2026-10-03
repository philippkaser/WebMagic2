import { useFrame } from "@react-three/fiber";
import { MeshStandardMaterial } from "three";
import { withFloorTint } from "../floorTint";
import { getSurface, type ArchSurface } from "../textures";

/** The dungeon's surface materials: one MeshStandardMaterial per
 * architecture kind — the painted maps and the artpass material (roughness
 * from the map, a touch of metal so wet texels pick up the environment,
 * emissive white under the painted glow) — built once and kept for the
 * session, so revisiting a band never recompiles or repaints anything.
 * The texture carries all the weathering; the material adds only the
 * floor's tint (render/floorTint.ts). */

const cache = new Map<ArchSurface, MeshStandardMaterial>();

export function dungeonMaterial(kind: ArchSurface): MeshStandardMaterial {
  let m = cache.get(kind);
  if (!m) {
    m = withFloorTint(new MeshStandardMaterial({ ...getSurface(kind).material }));
    cache.set(kind, m);
  }
  return m;
}

/** How a band's painted glow (lume specks, magma seams, veins, runes)
 * burns: base strength and how much it breathes (0 = steady). */
export interface SurfaceGlow {
  intensity: number;
  pulse: number;
}

/** The glow's strength at time `t`: two slow incommensurate waves, so the
 * breathing never settles into an obvious loop. */
export function glowLevel(glow: SurfaceGlow, t: number): number {
  return glow.intensity * (1 + glow.pulse * (Math.sin(t * 1.3) * 0.6 + Math.sin(t * 3.7) * 0.25));
}

/** Breathe the emissive of every material here that has an emissive map
 * (a uniform tweak per frame — no allocation, no recompile). */
export function useBreathingGlow(materials: readonly MeshStandardMaterial[], glow: SurfaceGlow): void {
  useFrame(({ clock }) => {
    const k = glowLevel(glow, clock.elapsedTime);
    for (const m of materials) if (m.emissiveMap) m.emissiveIntensity = k;
  });
}
