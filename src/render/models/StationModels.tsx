import { useMemo, type Ref } from "react";
import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  Object3D,
  SphereGeometry,
  TorusGeometry,
} from "three";
import { bake, glow, group, lathe, part, roughen, std, templateCache } from "./modelKit";
import { WizardModel } from "./WizardModel";

/** The camp's crafting corners, in the artpass model family (iron, planks,
 * bark, runestone — all pixel-painted): Old Wenna's cauldron and Brannoc's
 * forge. Pure presentation — world/villageProps.tsx owns the prompts, the
 * lights and the reactions; these expose refs for what animates (the brew's
 * surface, the coals). Origins are on the ground, front toward +z. */

function iron() {
  return std("#2e2c34", { tex: "iron", metalness: 0.75, roughness: 0.42 });
}

// ── Wenna's cauldron ─────────────────────────────────────────────────────────

export const BREW_COLOR = "#7dff6a";

/** A pot-bellied iron cauldron on a tripod over a pit of embers, a shelf of
 * jars and bundles behind, herbs drying on a line. */
function cauldronCorner(): Group {
  const metal = iron();
  const wood = std("#5a3e28", { tex: "planks", roughness: 0.9 });
  const bark = std("#4a321e", { tex: "bark", roughness: 0.9 });
  const stone = std("#5a5662", { tex: "runestone", roughness: 0.95 });
  const parts: Object3D[] = [];
  // The fire pit: a ring of rough stones, logs, embers.
  const rock = roughen(new IcosahedronGeometry(0.16, 0), 0.04, 3);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    parts.push(part(rock, stone, [Math.cos(a) * 0.62, 0.08, Math.sin(a) * 0.62], [a, a * 2, 0], [1, 0.7, 1]));
  }
  const log = roughen(new CylinderGeometry(0.06, 0.07, 0.8, 6), 0.012, 5);
  for (const [a, y] of [
    [0.3, 0.07],
    [1.9, 0.09],
    [3.4, 0.07],
  ] as const) {
    parts.push(part(log, bark, [Math.cos(a) * 0.12, y, Math.sin(a) * 0.12], [Math.PI / 2, 0, a], 1));
  }
  // The cauldron: a fat iron belly, a lip, three stubby legs.
  parts.push(
    part(
      lathe(
        [
          [0, 0.32],
          [0.28, 0.33],
          [0.44, 0.45],
          [0.5, 0.65],
          [0.46, 0.86],
          [0.4, 0.94],
          [0.44, 0.97],
          [0.42, 1.0],
          [0.37, 0.98],
        ],
        14,
      ),
      metal,
      [0, 0, 0],
    ),
  );
  const leg = new CylinderGeometry(0.035, 0.05, 0.36, 5);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    parts.push(part(leg, metal, [Math.cos(a) * 0.32, 0.18, Math.sin(a) * 0.32], [Math.sin(a) * 0.25, 0, -Math.cos(a) * 0.25]));
  }
  // Two ring handles.
  for (const s of [-1, 1]) parts.push(part(new TorusGeometry(0.08, 0.018, 4, 10), metal, [s * 0.5, 0.86, 0], [0, Math.PI / 2, 0]));
  // The shelf behind: a plank rack with jars and bundles.
  parts.push(part(new BoxGeometry(1.6, 0.06, 0.34), wood, [0, 1.15, -1.05]));
  parts.push(part(new BoxGeometry(1.6, 0.06, 0.34), wood, [0, 0.55, -1.05]));
  for (const x of [-0.78, 0.78]) parts.push(part(new BoxGeometry(0.07, 1.5, 0.34), wood, [x, 0.75, -1.05]));
  const jar = lathe([[0, -0.1], [0.07, -0.1], [0.09, -0.02], [0.07, 0.06], [0.04, 0.09], [0.045, 0.12], [0, 0.12]], 7);
  const glass = std("#9ab8d0", { roughness: 0.15, metalness: 0.2 });
  for (const [x, y] of [
    [-0.55, 1.28],
    [-0.3, 1.28],
    [0.1, 1.28],
    [0.45, 1.28],
    [-0.45, 0.68],
    [0.3, 0.68],
  ] as const) {
    parts.push(part(jar, glass, [x, y, -1.02], [0, x * 3, 0], 1, false));
  }
  // Drying herbs: bundles on a line strung between two poles.
  for (const x of [-1.0, 1.0]) parts.push(part(roughen(new CylinderGeometry(0.045, 0.055, 2.1, 6), 0.01, 7), bark, [x, 1.05, -0.4]));
  parts.push(part(new CylinderGeometry(0.006, 0.006, 2.0, 3), std("#8a7a5a", { tex: "cloth" }), [0, 1.95, -0.4], [0, 0, Math.PI / 2], 1, false));
  const bundle = new ConeGeometry(0.06, 0.28, 5);
  const herbs = ["#5a7a3a", "#8a6a3a", "#4a6a4a", "#7a5a6a", "#6a8a4a"];
  for (let i = 0; i < 5; i++) {
    parts.push(part(bundle, std(herbs[i]!, { tex: "cloth", roughness: 1 }), [-0.7 + i * 0.35, 1.8, -0.4], [Math.PI, i, 0]));
  }
  return bake(group(parts));
}

const cauldrons = templateCache<0>(cauldronCorner);
const brewGeo = new CylinderGeometry(0.4, 0.4, 0.02, 14);
const bubbleGeo = new SphereGeometry(0.05, 5, 4);
const emberGeo = new IcosahedronGeometry(0.1, 0);

/** Wenna's corner. `brewRef` is the glowing surface of the brew (scale it,
 * colour it on a craft); `bubblesRef` holds a few bubble meshes behaviour
 * pops; `emberRef` the coals under the pot. Wenna stands behind it, stirring. */
export function CauldronModel({
  brewRef,
  bubblesRef,
  emberRef,
  bodyRef,
}: {
  brewRef?: Ref<Mesh>;
  bubblesRef?: Ref<Group>;
  emberRef?: Ref<Group>;
  bodyRef?: Ref<Group>;
}) {
  const corner = useMemo(() => cauldrons(0), []);
  return (
    <group>
      <primitive object={corner} />
      <mesh ref={brewRef} geometry={brewGeo} material={glow(BREW_COLOR, 1.8)} position={[0, 0.94, 0]} />
      <group ref={bubblesRef}>
        {[0, 1, 2, 3].map((i) => (
          <mesh key={i} geometry={bubbleGeo} material={glow(BREW_COLOR, 2.4)} position={[Math.cos(i * 1.7) * 0.2, 0.96, Math.sin(i * 1.7) * 0.2]} />
        ))}
      </group>
      <group ref={emberRef}>
        {[0, 1, 2].map((i) => (
          <mesh key={i} geometry={emberGeo} material={glow("#ff8a3d", 2.2)} position={[Math.cos(i * 2.1) * 0.16, 0.09, Math.sin(i * 2.1) * 0.16]} rotation={[i, i * 2, 0]} />
        ))}
      </group>
      <group ref={bodyRef} position={[0.55, 0, -0.55]} rotation={[0, -0.8, 0]}>
        <WizardModel robeColor="#3f5a34" staffColor="#7dff6a" eyeColor="#c8ffb0" amuletColor="#7dff6a" castShadow />
      </group>
    </group>
  );
}

// ── Brannoc's forge ──────────────────────────────────────────────────────────

export const FORGE_COLOR = "#ff7a2e";

/** A squat stone hearth with a chimney, the anvil on its stump, a quench
 * barrel, tongs and a hammer, a rack of half-finished staffs. */
function forgeCorner(): Group {
  const metal = iron();
  const stone = std("#4a4650", { tex: "runestone", roughness: 0.95 });
  const bark = std("#4a321e", { tex: "bark", roughness: 0.9 });
  const wood = std("#5a3e28", { tex: "planks", roughness: 0.9 });
  const parts: Object3D[] = [];
  // Hearth: a stone block with a mouth, a chimney rising behind.
  parts.push(part(roughen(new BoxGeometry(1.5, 0.9, 1.1, 3, 2, 2), 0.03, 11), stone, [0, 0.45, -0.9]));
  parts.push(part(roughen(new BoxGeometry(0.7, 2.2, 0.7, 2, 4, 2), 0.03, 13), stone, [0, 1.95, -1.15]));
  parts.push(part(new BoxGeometry(0.85, 0.1, 0.85), stone, [0, 3.05, -1.15]));
  parts.push(part(new BoxGeometry(1.1, 0.08, 0.7), metal, [0, 0.92, -0.75]));
  // The anvil on its stump.
  parts.push(part(roughen(new CylinderGeometry(0.28, 0.32, 0.55, 7), 0.02, 17), bark, [0, 0.27, 0.45]));
  parts.push(part(new BoxGeometry(0.36, 0.12, 0.2), metal, [0, 0.6, 0.45]));
  parts.push(part(new BoxGeometry(0.22, 0.1, 0.14), metal, [0, 0.69, 0.45]));
  parts.push(part(new BoxGeometry(0.6, 0.09, 0.22), metal, [0, 0.78, 0.45]));
  parts.push(part(new ConeGeometry(0.11, 0.3, 4), metal, [0.42, 0.78, 0.45], [0, 0, -Math.PI / 2], [1, 1, 0.8]));
  // A hammer resting on the anvil, tongs leaning on the stump.
  parts.push(part(new CylinderGeometry(0.02, 0.025, 0.4, 5), bark, [-0.12, 0.84, 0.5], [0, 0.4, Math.PI / 2]));
  parts.push(part(new BoxGeometry(0.1, 0.08, 0.08), metal, [-0.3, 0.85, 0.42], [0, 0.4, 0]));
  parts.push(part(new CylinderGeometry(0.012, 0.012, 0.7, 3), metal, [0.3, 0.35, 0.72], [0.3, 0, -0.15]));
  parts.push(part(new CylinderGeometry(0.012, 0.012, 0.7, 3), metal, [0.34, 0.35, 0.72], [0.3, 0, -0.1]));
  // Quench barrel.
  parts.push(part(lathe([[0, -0.3], [0.24, -0.3], [0.28, 0], [0.24, 0.3], [0, 0.3]], 9), std("#6a4a30", { tex: "barrel" }), [-0.95, 0.3, 0.1]));
  parts.push(part(new CylinderGeometry(0.235, 0.235, 0.02, 9), std("#1a2a34", { roughness: 0.1, metalness: 0.3 }), [-0.95, 0.56, 0.1]));
  // A rack of staffs waiting for their heads.
  parts.push(part(new BoxGeometry(0.9, 0.06, 0.12), wood, [1.15, 1.1, -0.6], [0, -0.5, 0]));
  for (let i = 0; i < 4; i++) {
    parts.push(part(roughen(new CylinderGeometry(0.025, 0.03, 1.6, 5), 0.006, 20 + i), bark, [0.85 + i * 0.2, 0.8, -0.45 - i * 0.11], [0.12, 0, 0.08 - i * 0.04]));
  }
  return bake(group(parts));
}

const forges = templateCache<0>(forgeCorner);
const coalGeo = new BoxGeometry(0.9, 0.06, 0.5);
const sparkGeo = new IcosahedronGeometry(0.05, 0);

/** Brannoc's forge. `coalsRef` is the bed of coals in the hearth's mouth
 * (pulse its glow; flare it on a craft); Brannoc stands at the anvil. */
export function ForgeModel({ coalsRef, bodyRef }: { coalsRef?: Ref<Group>; bodyRef?: Ref<Group> }) {
  const corner = useMemo(() => forges(0), []);
  return (
    <group>
      <primitive object={corner} />
      <group ref={coalsRef}>
        <mesh geometry={coalGeo} material={glow(FORGE_COLOR, 2.4)} position={[0, 0.97, -0.75]} />
        {[0, 1, 2, 3].map((i) => (
          <mesh key={i} geometry={sparkGeo} material={glow("#ffd27a", 3)} position={[-0.3 + i * 0.2, 1.02, -0.75 + (i % 2) * 0.1]} rotation={[i, i, 0]} />
        ))}
      </group>
      <group ref={bodyRef} position={[-0.62, 0, 0.25]} rotation={[0, 0.5, 0]}>
        <WizardModel robeColor="#4a3226" staffColor="#ff7a2e" eyeColor="#ffb27a" amuletColor="#ff7a2e" castShadow />
      </group>
    </group>
  );
}
