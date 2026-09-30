import { useMemo, type Ref } from "react";
import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Object3D,
  SphereGeometry,
  TorusGeometry,
  type MeshStandardMaterial,
} from "three";
import { bake, glow, group, instance, part, roughen, std } from "./kit";

/** Iron-bound wooden chest with an arched lid. `remains` adds what's left of
 * its owner — skull, scattered bones, a slumped wizard's hat and a snapped
 * staff — a chest inherited from someone who died on an older version of
 * this floor. The lid is a separate group (hinged at the back edge) so the
 * owner can animate it; the seam material glows in the chest's color. */

const W = 0.9;
const H = 0.5;
const D = 0.6;

function iron() {
  return std("#2e2c34", { tex: "iron", metalness: 0.75, roughness: 0.42 });
}

function body(): Group {
  const wood = std("#8a5a34", { tex: "planks", roughness: 0.85 });
  const metal = iron();
  const parts: Object3D[] = [part(new BoxGeometry(W, H, D), wood, [0, H / 2, 0])];
  // Vertical straps and corner brackets.
  for (const x of [-0.3, 0.3]) parts.push(part(new BoxGeometry(0.07, H + 0.02, D + 0.02), metal, [x, H / 2, 0]));
  const corner = new BoxGeometry(0.1, H + 0.03, 0.1);
  for (const x of [-1, 1]) for (const z of [-1, 1]) parts.push(part(corner, metal, [x * (W / 2 - 0.03), H / 2, z * (D / 2 - 0.03)]));
  // Base rim and rivets along the straps.
  parts.push(part(new BoxGeometry(W + 0.04, 0.05, D + 0.04), metal, [0, 0.025, 0]));
  const rivet = new SphereGeometry(0.02, 4, 3);
  for (const x of [-0.3, 0.3]) for (const y of [0.12, 0.3]) parts.push(part(rivet, metal, [x, y, D / 2 + 0.015]));
  return bake(group(parts));
}

function lid(): Group {
  const wood = std("#7a4e2c", { tex: "planks", roughness: 0.85 });
  const metal = iron();
  const brass = std("#b08a48", { metalness: 0.85, roughness: 0.35 });
  // Half-cylinder barrel lid, axis along X, hinge line at local z = 0.
  const arch = new CylinderGeometry(D / 2, D / 2, W + 0.02, 10, 1, false, 0, Math.PI);
  const band = new CylinderGeometry(D / 2 + 0.015, D / 2 + 0.015, 0.075, 10, 1, true, 0, Math.PI);
  return bake(
    group([
      part(arch, wood, [0, 0, D / 2], [0, 0, Math.PI / 2], [0.62, 1, 1]),
      part(band, metal, [-0.3, 0, D / 2], [0, 0, Math.PI / 2], [0.62, 1, 1]),
      part(band, metal, [0.3, 0, D / 2], [0, 0, Math.PI / 2], [0.62, 1, 1]),
      // Lock hasp on the front
      part(new BoxGeometry(0.16, 0.18, 0.04), brass, [0, -0.02, D + 0.01]),
    ]),
  );
}

function remains(): Group {
  const bone = std("#cabd9c", { tex: "bone", roughness: 0.85 });
  const dark = std("#120c0a", { roughness: 1 });
  const hatCloth = std("#3a2c5a", { tex: "cloth", roughness: 0.95 });
  const skull = group(
    [
      part(new SphereGeometry(0.12, 7, 5), bone, [0, 0.02, 0], [0, 0, 0], [1, 0.92, 1.1]),
      part(new BoxGeometry(0.13, 0.06, 0.1), bone, [0, -0.08, 0.05]),
      part(new BoxGeometry(0.04, 0.035, 0.02), dark, [-0.042, 0.02, 0.12]),
      part(new BoxGeometry(0.04, 0.035, 0.02), dark, [0.042, 0.02, 0.12]),
      part(new BoxGeometry(0.02, 0.03, 0.02), dark, [0, -0.025, 0.125]),
    ],
    [0.62, 0.12, 0.28],
    [0.1, -0.5, 0.15],
  );
  const boneGeo = new CylinderGeometry(0.022, 0.022, 0.42, 5);
  const knob = new SphereGeometry(0.035, 5, 4);
  const aBone = (x: number, z: number, r: number) =>
    group(
      [part(boneGeo, bone, [0, 0, 0]), part(knob, bone, [0, 0.21, 0]), part(knob, bone, [0, -0.21, 0])],
      [x, 0.035, z],
      [0, r, Math.PI / 2],
    );
  // A pointed hat, tip flopped over, slumped against the chest.
  const hat = group(
    [
      part(new TorusGeometry(0.2, 0.05, 4, 10), hatCloth, [0, 0, 0], [Math.PI / 2, 0, 0], [1, 1, 0.5]),
      part(new CylinderGeometry(0.1, 0.17, 0.22, 8), hatCloth, [0, 0.11, 0]),
      part(new ConeGeometry(0.1, 0.3, 7), hatCloth, [0.08, 0.3, 0], [0, 0, -0.9]),
      part(new CylinderGeometry(0.175, 0.175, 0.04, 8), std("#b08a48", { metalness: 0.7, roughness: 0.4 }), [0, 0.04, 0]),
    ],
    [-0.62, 0.06, 0.2],
    [0.25, 0.4, 0.35],
  );
  const staff = std("#4a3526", { tex: "bark" });
  return bake(
    group([
      skull,
      aBone(-0.55, 0.45, 0.6),
      aBone(-0.3, -0.5, -0.9),
      aBone(0.55, -0.4, 1.9),
      aBone(0.2, 0.55, 0.2),
      hat,
      // Snapped staff: two halves, one leaning on the chest.
      part(roughen(new CylinderGeometry(0.03, 0.035, 0.7, 5), 0.006, 3), staff, [0.3, 0.28, 0.42], [0.2, 0, 1.1]),
      part(roughen(new CylinderGeometry(0.03, 0.03, 0.5, 5), 0.006, 4), staff, [-0.25, 0.03, 0.62], [0, 0.4, Math.PI / 2]),
    ]),
  );
}

const T: { body?: Group; lid?: Group; remains?: Group } = {};

export function ChestModel({
  lidRef,
  seamRef,
  glow: glowColor,
  remains: showRemains,
}: {
  lidRef?: Ref<Group>;
  seamRef?: Ref<MeshStandardMaterial>;
  glow: string;
  remains: boolean;
}) {
  const parts = useMemo(
    () => ({
      body: instance((T.body ??= body())),
      lid: instance((T.lid ??= lid())),
      remains: instance((T.remains ??= remains())),
    }),
    [],
  );
  return (
    <group>
      <primitive object={parts.body} />
      {/* Glowing seam where the lid doesn't quite close */}
      <mesh position={[0, H + 0.01, 0]}>
        <boxGeometry args={[W - 0.04, 0.03, D - 0.04]} />
        <meshStandardMaterial ref={seamRef} color="#000" emissive={glowColor} emissiveIntensity={2.4} toneMapped={false} />
      </mesh>
      {/* Lid, hinged at the back edge */}
      <group ref={lidRef} position={[0, H + 0.01, -D / 2]}>
        <primitive object={parts.lid} />
        {/* Keyhole bleeding the chest's light */}
        <mesh position={[0, -0.03, D + 0.035]} material={glow(glowColor, 3)}>
          <boxGeometry args={[0.035, 0.07, 0.01]} />
        </mesh>
      </group>
      {showRemains && <primitive object={parts.remains} />}
    </group>
  );
}
