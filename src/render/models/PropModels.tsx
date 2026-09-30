import { useMemo } from "react";
import { BoxGeometry, CylinderGeometry, Group, Object3D, SphereGeometry, TorusGeometry } from "three";
import { hashSeed } from "../../core/rng";
import { bake, glow, group, instance, lathe, part, roughen, std } from "./kit";

/** The breakable dungeon clutter: iron-cornered crates, hooped barrels
 * (with a scorched warning rune — they explode) and three shapes of clay
 * pot. Each is centered on its physics collider: crate 0.84 cube, barrel
 * 0.96 tall × 0.4 radius, pot 0.3 radius ball. All baked to a handful of
 * draw calls. */

const IRON = "#34323a";

function crate(): Group {
  const planks = std("#a07048", { tex: "planks", roughness: 0.85 });
  const frame = std("#5e3f24", { tex: "bark", roughness: 0.9 });
  const iron = std(IRON, { tex: "iron", metalness: 0.7, roughness: 0.45 });
  const h = 0.42;
  const parts: Object3D[] = [part(new BoxGeometry(0.8, 0.8, 0.8), planks)];
  // Edge frame: twelve beams along the cube's edges.
  const beam = new BoxGeometry(0.1, 0.86, 0.1);
  for (const [x, z] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]) {
    parts.push(part(beam, frame, [x * (h - 0.04), 0, z * (h - 0.04)]));
    parts.push(part(beam, frame, [x * (h - 0.04), z * (h - 0.04), 0], [Math.PI / 2, 0, 0]));
    parts.push(part(beam, frame, [0, x * (h - 0.04), z * (h - 0.04)], [0, 0, Math.PI / 2]));
  }
  // A diagonal brace across each side face.
  const brace = new BoxGeometry(0.08, 1.0, 0.04);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const face = group([part(brace, frame, [0, 0, 0], [0, 0, i % 2 ? 0.78 : -0.78])], [Math.sin(a) * 0.41, 0, Math.cos(a) * 0.41], [0, a, 0]);
    parts.push(face);
  }
  // Iron corner caps with a rivet each.
  const cap = new BoxGeometry(0.15, 0.15, 0.15);
  const rivet = new SphereGeometry(0.022, 4, 3);
  for (const x of [-1, 1]) {
    for (const y of [-1, 1]) {
      for (const z of [-1, 1]) {
        parts.push(part(cap, iron, [x * (h - 0.05), y * (h - 0.05), z * (h - 0.05)]));
        parts.push(part(rivet, iron, [x * (h - 0.05), y * (h - 0.05), z * (h + 0.03)]));
      }
    }
  }
  return bake(group(parts));
}

function barrel(): Group {
  const staves = std("#8a5a32", { tex: "barrel", roughness: 0.8 });
  const lid = std("#6a4526", { tex: "planks", roughness: 0.9 });
  const iron = std(IRON, { tex: "iron", metalness: 0.75, roughness: 0.4 });
  const body = lathe(
    [
      [0.0, -0.48],
      [0.33, -0.48],
      [0.37, -0.3],
      [0.4, 0],
      [0.37, 0.3],
      [0.33, 0.48],
      [0.3, 0.48],
      [0.3, 0.44],
      [0.0, 0.44],
    ],
    12,
  );
  const hoop = (y: number, r: number) => part(new CylinderGeometry(r, r, 0.06, 12, 1, true), iron, [0, y, 0]);
  return bake(
    group([
      part(body, staves),
      part(new CylinderGeometry(0.3, 0.3, 0.02, 10), lid, [0, 0.445, 0]),
      hoop(-0.42, 0.345),
      hoop(-0.2, 0.39),
      hoop(0.2, 0.39),
      hoop(0.42, 0.345),
      // Bung and a scorched strip around it: somebody learned the hard way.
      part(new CylinderGeometry(0.035, 0.035, 0.05, 6), lid, [0, 0.05, 0.395], [Math.PI / 2, 0, 0]),
      part(new TorusGeometry(0.06, 0.012, 4, 8), iron, [0.18, 0.46, 0.05], [Math.PI / 2, 0, 0]),
      // Volatile rune: faintly glowing ember sigil telegraphs "this explodes".
      Object.assign(part(new BoxGeometry(0.1, 0.1, 0.02), glow("#ff7a2a", 0.9), [0, -0.02, 0.4], [0, 0, Math.PI / 4], 1, false), {
        userData: { glow: true },
      }),
    ]),
  );
}

/** Three pot silhouettes; which one a pot gets is stable per entity. */
const POT_PROFILES: [number, number][][] = [
  // Round amphora with a narrow neck.
  [
    [0.0, -0.3],
    [0.14, -0.3],
    [0.27, -0.16],
    [0.3, 0.0],
    [0.24, 0.16],
    [0.1, 0.25],
    [0.09, 0.33],
    [0.13, 0.37],
    [0.1, 0.37],
  ],
  // Tall urn with a flared lip.
  [
    [0.0, -0.3],
    [0.12, -0.3],
    [0.16, -0.24],
    [0.26, -0.02],
    [0.25, 0.14],
    [0.16, 0.3],
    [0.2, 0.4],
    [0.17, 0.41],
  ],
  // Squat jar.
  [
    [0.0, -0.3],
    [0.2, -0.3],
    [0.3, -0.18],
    [0.32, -0.02],
    [0.28, 0.12],
    [0.2, 0.17],
    [0.2, 0.22],
    [0.0, 0.22],
  ],
];
const POT_GLAZES = ["#b8764a", "#8a6a8a", "#6a8a7a"];

function pot(variant: number): Group {
  const clay = std(POT_GLAZES[variant], { tex: "ceramic", roughness: 0.55 });
  const band = std("#2a1a14", { roughness: 0.7 });
  const parts: Object3D[] = [part(roughen(lathe(POT_PROFILES[variant], 10), 0.008, variant + 1), clay)];
  // Painted band around the belly.
  parts.push(part(new CylinderGeometry(0.305, 0.305, 0.04, 10, 1, true), band, [0, variant === 1 ? 0.02 : 0.0, 0], [0, 0, 0], [variant === 1 ? 0.86 : variant === 2 ? 1.05 : 1, 1, variant === 1 ? 0.86 : variant === 2 ? 1.05 : 1]));
  if (variant === 0) {
    // Amphora handles.
    for (const s of [-1, 1]) parts.push(part(new TorusGeometry(0.08, 0.02, 4, 8, Math.PI), clay, [s * 0.14, 0.24, 0], [0, 0, s * -1.2]));
  }
  if (variant === 2) {
    // Lid with a knob.
    parts.push(part(new CylinderGeometry(0.22, 0.22, 0.04, 10), clay, [0, 0.24, 0]));
    parts.push(part(new SphereGeometry(0.045, 6, 4), clay, [0, 0.28, 0]));
  }
  return bake(group(parts));
}

const templates = new Map<string, Group>();

function template(key: string, build: () => Group): Group {
  let t = templates.get(key);
  if (!t) {
    t = build();
    templates.set(key, t);
  }
  return t;
}

export function CrateModel() {
  const obj = useMemo(() => instance(template("crate", crate)), []);
  return <primitive object={obj} />;
}

export function BarrelModel() {
  const obj = useMemo(() => instance(template("barrel", barrel)), []);
  return <primitive object={obj} />;
}

/** `seed` picks the silhouette so every client sees the same pot. */
export function PotModel({ seed }: { seed: string }) {
  const variant = hashSeed(seed) % POT_PROFILES.length;
  const obj = useMemo(() => instance(template(`pot${variant}`, () => pot(variant))), [variant]);
  return <primitive object={obj} />;
}
