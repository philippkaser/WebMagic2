import { useMemo, type Ref } from "react";
import { BoxGeometry, ConeGeometry, CylinderGeometry, Group, Object3D, OctahedronGeometry, TorusGeometry } from "three";
import { getModelTextures } from "./modelPaint";
import { bake, glow, group, part, roughen, std, templateCache } from "./modelKit";
import { shared } from "./shared";

/** The floor-treasure altar: a stepped basalt plinth, a column whose carved
 * runes glow in the treasure's own colour, a capital with four stone horns
 * and an iron dish, and the treasure's gem hovering above it. Origin =
 * ground at the column's centre. (The artpass treasure altar.)
 *
 * Behaviour (world/props.tsx TreasurePedestal) owns the roll, the take
 * request and the light; it bobs and spins the gem through `orbRef` (a group
 * resting at PEDESTAL_ORB_Y) and hides it with `taken`. */

export const PEDESTAL_ORB_Y = 1.45;
/** Height of the altar's top surface. */
const ALTAR_TOP = 1.04;

/** Basalt whose carvings glow: the glyph map is the emissive mask. */
function runeStone(color: string, intensity: number) {
  return std("#4a4658", {
    tex: "runestone",
    roughness: 0.85,
    emissive: color,
    emissiveIntensity: intensity,
    emissiveMap: getModelTextures("glyphs").map,
  });
}

function altar(color: string): Group {
  const stone = std("#4a4658", { tex: "runestone", roughness: 0.9 });
  const runes = runeStone(color, 1.2);
  const iron = std("#2c2a30", { tex: "iron", metalness: 0.7, roughness: 0.45 });
  const parts: Object3D[] = [
    part(roughen(new BoxGeometry(1.15, 0.18, 1.15, 2, 1, 2), 0.02, 1), stone, [0, 0.09, 0]),
    part(roughen(new BoxGeometry(0.88, 0.14, 0.88, 2, 1, 2), 0.015, 2), stone, [0, 0.25, 0]),
    part(new CylinderGeometry(0.25, 0.3, 0.62, 8), runes, [0, 0.63, 0]),
    part(roughen(new BoxGeometry(0.7, 0.1, 0.7, 2, 1, 2), 0.012, 3), stone, [0, 0.99, 0]),
    // Iron dish the treasure hangs over.
    part(new TorusGeometry(0.24, 0.03, 4, 12), iron, [0, ALTAR_TOP + 0.01, 0], [Math.PI / 2, 0, 0]),
  ];
  // Four stone horns curling up from the capital's corners.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    parts.push(group([part(new ConeGeometry(0.05, 0.26, 5), stone, [0, 0.12, 0.05], [0.45, 0, 0])], [Math.sin(a) * 0.34, ALTAR_TOP, Math.cos(a) * 0.34], [0, a, 0]));
  }
  return bake(group(parts));
}

const altars = templateCache<string>(altar);
const gemGeo = shared(() => new OctahedronGeometry(0.26));

export function PedestalModel({
  color,
  taken = false,
  orbRef,
}: {
  /** The treasure's item color. */
  color: string;
  taken?: boolean;
  orbRef?: Ref<Group>;
}) {
  const obj = useMemo(() => altars(color), [color]);
  return (
    <group>
      <primitive object={obj} />
      {!taken && (
        <group ref={orbRef} position={[0, PEDESTAL_ORB_Y, 0]}>
          <mesh geometry={gemGeo()} material={glow(color, 2.8)} scale={[1, 1.35, 1]} castShadow />
        </group>
      )}
    </group>
  );
}
