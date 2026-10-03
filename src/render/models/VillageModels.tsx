import { useMemo, type Ref } from "react";
import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Object3D,
  OctahedronGeometry,
  SphereGeometry,
  TorusGeometry,
} from "three";
import { bake, glow, group, lathe, part, roughen, std, templateCache } from "./modelKit";
import { shared } from "./shared";
import { WizardModel } from "./WizardModel";

/** Village fixtures: the storage chest and Maro's merchant stall, in the
 * artpass model family (planks, iron, leather, cloth — all pixel-painted).
 * Pure presentation — world/villageProps.tsx owns the interaction prompts
 * and the lantern light, and animates through refs. Origins are on the
 * ground; callers position and rotate the whole fixture. */

const W = 0.9;
const H = 0.5;
const D = 0.6;

function iron() {
  return std("#2e2c34", { tex: "iron", metalness: 0.75, roughness: 0.42 });
}

// ── Storage chest ────────────────────────────────────────────────────────────

/** Iron-bound wooden chest with an arched barrel lid. */
function chestBody(): Group {
  const wood = std("#8a5a34", { tex: "planks", roughness: 0.85 });
  const metal = iron();
  const parts: Object3D[] = [part(new BoxGeometry(W, H, D), wood, [0, H / 2, 0])];
  for (const x of [-0.3, 0.3]) parts.push(part(new BoxGeometry(0.07, H + 0.02, D + 0.02), metal, [x, H / 2, 0]));
  const corner = new BoxGeometry(0.1, H + 0.03, 0.1);
  for (const x of [-1, 1]) for (const z of [-1, 1]) parts.push(part(corner, metal, [x * (W / 2 - 0.03), H / 2, z * (D / 2 - 0.03)]));
  parts.push(part(new BoxGeometry(W + 0.04, 0.05, D + 0.04), metal, [0, 0.025, 0]));
  const rivet = new SphereGeometry(0.02, 4, 3);
  for (const x of [-0.3, 0.3]) for (const y of [0.12, 0.3]) parts.push(part(rivet, metal, [x, y, D / 2 + 0.015]));
  return bake(group(parts));
}

function chestLid(): Group {
  const wood = std("#7a4e2c", { tex: "planks", roughness: 0.85 });
  const metal = iron();
  const brass = std("#b08a48", { metalness: 0.85, roughness: 0.35 });
  const arch = new CylinderGeometry(D / 2, D / 2, W + 0.02, 10, 1, false, 0, Math.PI);
  const band = new CylinderGeometry(D / 2 + 0.015, D / 2 + 0.015, 0.075, 10, 1, true, 0, Math.PI);
  return bake(
    group([
      part(arch, wood, [0, 0, D / 2], [0, 0, Math.PI / 2], [0.62, 1, 1]),
      part(band, metal, [-0.3, 0, D / 2], [0, 0, Math.PI / 2], [0.62, 1, 1]),
      part(band, metal, [0.3, 0, D / 2], [0, 0, Math.PI / 2], [0.62, 1, 1]),
      part(new BoxGeometry(0.16, 0.18, 0.04), brass, [0, -0.02, D + 0.01]),
      part(new BoxGeometry(0.035, 0.07, 0.01), glow("#ffbf5e", 3), [0, -0.03, D + 0.035], [0, 0, 0], 1, false),
    ]),
  );
}

const chest = shared(() => ({ body: chestBody(), lid: chestLid() }));
const seamGeo = shared(() => new BoxGeometry(W - 0.04, 0.03, D - 0.04));
/** The chest is a touch larger than a dungeon grave's: it holds 30 slots. */
const CHEST_SCALE = 1.2;

/** The wizard's own chest. `lidRef` is the lid's hinge group (at the back
 * top edge); rotate it on X (negative = open) to creak it open. A warm light
 * leaks from the seam. */
export function ChestModel({ lidRef }: { lidRef?: Ref<Group> }) {
  const parts = useMemo(() => ({ body: chest().body.clone(), lid: chest().lid.clone() }), []);
  return (
    <group scale={CHEST_SCALE}>
      <primitive object={parts.body} />
      <mesh geometry={seamGeo()} material={glow("#ffbf5e", 1.6)} position={[0, H + 0.01, 0]} />
      <group ref={lidRef} position={[0, H + 0.01, -D / 2]}>
        <primitive object={parts.lid} />
      </group>
    </group>
  );
}

// ── Merchant stall ───────────────────────────────────────────────────────────

const STRIPES = ["#6a2a30", "#c8b48a"];

function stall(): Group {
  const plank = std("#8a6040", { tex: "planks", roughness: 0.85 });
  const darkPlank = std("#5a3e28", { tex: "planks", roughness: 0.9 });
  const post = std("#4a321e", { tex: "bark", roughness: 0.9 });
  const metal = iron();
  const parts: Object3D[] = [];
  // Counter: a plank box with iron-capped corners and a lighter top board.
  parts.push(part(new BoxGeometry(2.3, 0.86, 0.62), darkPlank, [0, 0.43, 0.9]));
  parts.push(part(new BoxGeometry(2.46, 0.08, 0.76), plank, [0, 0.9, 0.92]));
  for (const x of [-1.12, 1.12]) {
    parts.push(part(new BoxGeometry(0.1, 0.88, 0.1), metal, [x, 0.44, 1.18]));
    parts.push(part(new BoxGeometry(0.1, 0.88, 0.1), metal, [x, 0.44, 0.62]));
  }
  parts.push(part(new BoxGeometry(2.32, 0.06, 0.04), metal, [0, 0.62, 1.22]));
  // Four posts, the front pair taller so the awning slopes down to the back.
  for (const x of [-1.2, 1.2]) {
    parts.push(part(roughen(new CylinderGeometry(0.06, 0.07, 2.6, 6), 0.01, 3), post, [x, 1.3, 1.3]));
    parts.push(part(roughen(new CylinderGeometry(0.06, 0.07, 2.2, 6), 0.01, 4), post, [x, 1.1, -0.45]));
  }
  // Striped canvas awning, sloping from the front posts to the back.
  const slope = Math.atan2(0.4, 1.75);
  const awning = new Group();
  awning.position.set(0, 2.42, 0.42);
  awning.rotation.x = slope;
  const n = 8;
  for (let i = 0; i < n; i++) {
    const cloth = std(STRIPES[i % 2], { tex: "cloth", roughness: 0.95 });
    awning.add(part(new BoxGeometry(2.7 / n, 0.04, 2.0), cloth, [-1.35 + (i + 0.5) * (2.7 / n), 0, 0]));
    // Scalloped valance hanging off the front edge.
    awning.add(part(new ConeGeometry(0.16, 0.24, 4), cloth, [-1.35 + (i + 0.5) * (2.7 / n), -0.12, 1.0], [Math.PI, Math.PI / 4, 0], [1, 1, 0.2]));
  }
  parts.push(awning);
  // Stock under and beside the counter: a crate, a sack, a little keg.
  parts.push(part(new BoxGeometry(0.5, 0.5, 0.5), plank, [1.55, 0.25, 0.6], [0, 0.3, 0]));
  parts.push(part(roughen(new SphereGeometry(0.28, 6, 5), 0.03, 9), std("#8a7a5a", { tex: "cloth" }), [-1.55, 0.25, 0.9], [0, 0, 0], [1, 1.1, 0.9]));
  parts.push(part(new TorusGeometry(0.1, 0.03, 3, 8), std("#5a4632", { tex: "leather" }), [-1.55, 0.52, 0.9], [Math.PI / 2, 0, 0]));
  parts.push(part(lathe([[0, -0.2], [0.17, -0.2], [0.2, 0], [0.17, 0.2], [0, 0.2]], 8), std("#7a5030", { tex: "barrel" }), [1.5, 0.2, -0.2]));
  return bake(group(parts));
}

/** A little stoppered flask for the counter. */
function flask(color: string): Group {
  const glass = std("#9ab8d0", { roughness: 0.15, metalness: 0.2 });
  return group([
    part(lathe([[0, -0.09], [0.06, -0.09], [0.08, -0.03], [0.06, 0.03], [0.025, 0.06], [0.025, 0.12], [0, 0.12]], 7), glass, [0, 0, 0], [0, 0, 0], 1, false),
    Object.assign(part(new SphereGeometry(0.066, 6, 4), glow(color, 2), [0, -0.035, 0], [0, 0, 0], [1, 0.75, 1], false), { userData: { glow: true } }),
    part(new CylinderGeometry(0.028, 0.024, 0.04, 5), std("#8a6a44", { tex: "bark" }), [0, 0.14, 0], [0, 0, 0], 1, false),
  ]);
}

function wares(): Group {
  return bake(
    group([
      group([flask("#ff5d6e")], [-0.75, 1.03, 0.85]),
      group([flask("#ff5d6e")], [-0.55, 1.03, 1.02], [0, 0.5, 0]),
      group([flask("#4f9dff")], [-0.3, 1.03, 0.9]),
      group([flask("#4f9dff")], [-0.12, 1.03, 1.06], [0, 1, 0]),
      // A feather of safe passage, standing in a jar.
      part(new CylinderGeometry(0.07, 0.06, 0.16, 7), std("#5a6a7a", { roughness: 0.3, metalness: 0.2 }), [0.55, 1.02, 0.95]),
      part(new OctahedronGeometry(0.1), glow("#ffe9a8", 1.6), [0.58, 1.3, 0.95], [0, 0, 0.3], [0.45, 2.2, 0.12], false),
      // Coins and a ledger.
      part(new CylinderGeometry(0.06, 0.06, 0.04, 8), std("#c9a052", { metalness: 0.8, roughness: 0.35 }), [0.9, 0.96, 1.08]),
      part(new BoxGeometry(0.3, 0.05, 0.22), std("#5a2a24", { tex: "leather" }), [0.25, 0.965, 0.85], [0, -0.3, 0]),
    ]),
    false,
  );
}

/** The lantern: an iron cage around a warm flame, hung from the awning. */
function lantern(): Group {
  const metal = iron();
  const parts: Object3D[] = [
    part(new BoxGeometry(0.2, 0.03, 0.2), metal, [0, 0.13, 0]),
    part(new BoxGeometry(0.2, 0.03, 0.2), metal, [0, -0.13, 0]),
    part(new ConeGeometry(0.13, 0.1, 4), metal, [0, 0.19, 0], [0, Math.PI / 4, 0]),
    part(new TorusGeometry(0.04, 0.01, 3, 6), metal, [0, 0.27, 0]),
    part(new CylinderGeometry(0.006, 0.006, 0.36, 3), metal, [0, 0.46, 0]),
    part(new BoxGeometry(0.11, 0.18, 0.11), glow("#ffb45e", 2.6), [0, 0, 0], [0, 0, 0], 1, false),
  ];
  for (const [x, z] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]) {
    parts.push(part(new BoxGeometry(0.02, 0.26, 0.02), metal, [x * 0.09, 0, z * 0.09]));
  }
  return bake(group(parts), false);
}

const stalls = templateCache<0>(stall);
const wareSets = templateCache<0>(wares);
const lanterns = templateCache<0>(lantern);

/** Maro the Provisioner's stall: counter, striped awning, a hanging lantern,
 * wares, and Maro himself — a hooded wizard who stopped descending years
 * ago — behind the counter. `bodyRef` is Maro's group (behaviour sways him).
 * The lantern sits at (0, 1.9, 0.6) — where the caller's light belongs. */
export function MerchantStallModel({ bodyRef }: { bodyRef?: Ref<Group> }) {
  const parts = useMemo(() => ({ stall: stalls(0), wares: wareSets(0), lantern: lanterns(0) }), []);
  return (
    <group>
      <primitive object={parts.stall} />
      <primitive object={parts.wares} />
      <primitive object={parts.lantern} position={[0, 1.9, 0.6]} />
      <group ref={bodyRef}>
        <group position={[0, 0.85, 0.05]}>
          <WizardModel robeColor="#6a4a2c" staffColor="#ffd24a" eyeColor="#ffd27a" amuletColor="#ffe9a8" castShadow />
        </group>
      </group>
    </group>
  );
}
