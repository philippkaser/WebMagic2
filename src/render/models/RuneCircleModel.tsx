import { useFrame } from "@react-three/fiber";
import { useMemo } from "react";
import { AdditiveBlending, CircleGeometry, Color, MeshBasicMaterial } from "three";
import type { Vec3 } from "../../world/types";
import { getRuneCircleTexture } from "../textures";
import { shared } from "./shared";

/** The arrival sigil (ported from the artpass branch): a magic circle of
 * glyph rings around a heptagram, glowing on the floor where a wizard steps
 * onto a level. One flat disc, drawn additively in the band's accent
 * colour, turning slowly and breathing — the first thing you see at your
 * feet on every floor. */

const disc = shared(() => new CircleGeometry(1, 32).rotateX(-Math.PI / 2));

/** One material per accent colour, kept for the session (five bands). */
const materials = new Map<string, MeshBasicMaterial>();
function circleMaterial(accent: string): MeshBasicMaterial {
  let m = materials.get(accent);
  if (!m) {
    m = new MeshBasicMaterial({
      map: getRuneCircleTexture(),
      color: new Color(accent).multiplyScalar(0.9),
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    materials.set(accent, m);
  }
  return m;
}

export function RuneCircleModel({ position, radius, accent }: { position: Vec3; radius: number; accent: string }) {
  const material = circleMaterial(accent);
  const scale = useMemo<Vec3>(() => [radius, 1, radius], [radius]);
  useFrame(({ clock }) => {
    // The texture is shared, so spinning it turns every circle at once.
    const map = material.map;
    if (map) map.rotation = clock.elapsedTime * 0.08;
    material.opacity = 0.55 + Math.sin(clock.elapsedTime * 1.7) * 0.15;
  });
  return (
    <mesh
      geometry={disc()}
      material={material}
      position={[position[0], 0.02, position[2]]}
      scale={scale}
      renderOrder={1}
    />
  );
}
