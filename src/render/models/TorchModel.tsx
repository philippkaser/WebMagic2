import { useMemo, type Ref } from "react";
import { BoxGeometry, CylinderGeometry, Group, IcosahedronGeometry, MeshStandardMaterial } from "three";
import { bake, group, part, std, templateCache } from "./modelKit";
import { shared } from "./shared";

/** A torch: an iron basket of coals on a wooden haft. Wall-mounted torches
 * (`wallYaw` given) get an iron bracket reaching back to the wall — local −Z
 * turned by `wallYaw` — bolted to a plate; free-standing ones (on a post)
 * sit bare. The coals sit at (0, 0.08, 0.05), just above the origin, which
 * is where world/props.tsx (Torch) stands its living flame (fx/Flames) and
 * hangs its light; it drives the coals' brightness through `emberRef` so
 * coals, flame and light flicker together. */

/** Resting brightness of the coals (the flicker swings around it). */
export const TORCH_EMBER_INTENSITY = 4.5;

/** Where the coals sit relative to the origin — the flame's anchor. */
const COALS: [number, number, number] = [0, 0.08, 0.05];

function sconce(wall: boolean): Group {
  const iron = std("#2c2a30", { tex: "iron", metalness: 0.7, roughness: 0.45 });
  const wood = std("#4a321e", { tex: "bark", roughness: 0.9 });
  const parts = [
    // Basket: a flared cup with four prongs cradling the coals.
    part(new CylinderGeometry(0.1, 0.06, 0.1, 6, 1, true), iron, [0, -0.04, 0]),
    part(new CylinderGeometry(0.105, 0.105, 0.02, 6, 1, true), iron, [0, 0.01, 0]),
    ...[0, 1, 2, 3].map((i) =>
      group([part(new BoxGeometry(0.018, 0.14, 0.018), iron, [0, 0.05, 0.1], [-0.35, 0, 0])], [0, 0, 0], [0, (i / 4) * Math.PI * 2 + 0.4, 0]),
    ),
    // Haft
    part(new CylinderGeometry(0.035, 0.028, 0.42, 6), wood, [0, -0.3, 0]),
    part(new CylinderGeometry(0.04, 0.04, 0.04, 6), iron, [0, -0.13, 0]),
  ];
  if (wall) {
    parts.push(
      // Bracket arm back to the wall, and the wall plate it's bolted to.
      part(new BoxGeometry(0.04, 0.04, 0.3), iron, [0, -0.3, -0.15]),
      part(new BoxGeometry(0.03, 0.2, 0.03), iron, [0, -0.2, -0.26], [0.6, 0, 0]),
      part(new CylinderGeometry(0.05, 0.05, 0.05, 6, 1, true), iron, [0, -0.3, 0]),
      part(new BoxGeometry(0.14, 0.3, 0.03), iron, [0, -0.28, -0.3]),
    );
  }
  return bake(group(parts));
}

const sconces = templateCache<boolean>(sconce);
const coalGeo = shared(() => new IcosahedronGeometry(0.06, 0));

export function TorchModel({
  emberColor = "#ff8b3d",
  emberRef,
  wallYaw = null,
}: {
  emberColor?: string;
  /** The coals' material, per torch, for flicker. */
  emberRef?: Ref<MeshStandardMaterial>;
  /** Y rotation pointing the bracket (local −Z) at the wall it hangs on;
   * null for a free-standing torch. */
  wallYaw?: number | null;
}) {
  const wall = wallYaw !== null;
  const body = useMemo(() => sconces(wall), [wall]);
  return (
    <group position={COALS}>
      <primitive object={body} rotation-y={wallYaw ?? 0} />
      <mesh geometry={coalGeo()}>
        <meshStandardMaterial
          ref={emberRef}
          color="#07060a"
          emissive={emberColor}
          emissiveIntensity={TORCH_EMBER_INTENSITY}
          roughness={0.25}
          metalness={0.2}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
