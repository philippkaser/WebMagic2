import { useMemo } from "react";
import { BoxGeometry, ConeGeometry, CylinderGeometry, Group, Object3D, TorusGeometry } from "three";
import { bake, group, instance, part, roughen, std } from "./kit";
import { getModelTextures } from "./modelTextures";

/** Carved stonework: the treasure altar, the village waystone monolith and
 * the broken standing stones that frame every rift. Rune carvings are an
 * emissive glyph map, so the same stone glows in whatever color its magic
 * is — the treasure's own color, the waystone's teal, the rift's hue. */

function runeStone(color: string, intensity = 1.3) {
  return std("#4a4658", {
    tex: "runestone",
    roughness: 0.85,
    emissive: color,
    emissiveIntensity: intensity,
    emissiveMap: getModelTextures("glyphs").map,
  });
}

const plain = () => std("#4a4658", { tex: "runestone", roughness: 0.9 });

// ── Treasure altar ──────────────────────────────────────────────────────────

/** Height of the altar's top surface: where the treasure hovers from. */
export const ALTAR_TOP = 1.04;

function altar(color: string): Group {
  const stone = plain();
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

// ── Waystone monolith ───────────────────────────────────────────────────────

/** Where the glowing face plate sits on the slab (slab-local). */
export const WAYSTONE_FACE = { y: 1.5, z: 0.19, size: 0.84 };

function waystone(): Group {
  const stone = plain();
  const runes = runeStone("#46ffd0", 0.9);
  // A slab that narrows toward a sheared top, with chipped edges.
  const slab = new BoxGeometry(1.15, 2.3, 0.36, 3, 6, 1);
  const pos = slab.getAttribute("position");
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const t = (y + 1.15) / 2.3;
    pos.setX(i, pos.getX(i) * (1 - t * 0.18));
    // Sheared top: one corner broken lower than the other.
    if (t > 0.99) pos.setY(i, y - (pos.getX(i) > 0 ? 0.2 : 0));
  }
  roughen(slab, 0.03, 7);
  return bake(
    group([
      part(roughen(new BoxGeometry(1.9, 0.3, 1.2, 3, 1, 2), 0.03, 4), stone, [0, 0.15, 0]),
      part(roughen(new BoxGeometry(1.4, 0.16, 0.8, 2, 1, 2), 0.02, 5), stone, [0, 0.36, 0]),
      part(slab, stone, [0, 1.55, 0]),
      // Rune columns carved down both flanks.
      part(new BoxGeometry(0.02, 1.7, 0.2), runes, [-0.53, 1.45, 0]),
      part(new BoxGeometry(0.02, 1.7, 0.2), runes, [0.53, 1.45, 0]),
      part(new BoxGeometry(0.8, 0.14, 0.02), runes, [0, 0.72, 0.185]),
    ]),
  );
}

// ── Rift standing stones ────────────────────────────────────────────────────

/** Footprints of the solid stones around a rift, for the owner's colliders.
 * Both stand behind the tear (-Z, away from the village approach) and inside
 * x ∈ ±2.1, so a second rift two tiles along X never overlaps them. */
export const RIFT_STONES: { pos: [number, number, number]; half: [number, number, number] }[] = [
  { pos: [-1.75, 1.3, -1.3], half: [0.3, 1.3, 0.3] },
  { pos: [1.75, 0.8, -1.2], half: [0.32, 0.8, 0.32] },
];

function riftFrame(color: string): Group {
  const stone = plain();
  const runes = runeStone(color, 0.8);
  const menhir = (h: number, seed: number) => {
    const g = new CylinderGeometry(0.22, 0.34, h, 5, 4);
    return roughen(g, 0.05, seed);
  };
  return bake(
    group([
      // Round dais under the tear, with a glowing inlaid ring.
      part(roughen(new CylinderGeometry(1.75, 1.85, 0.24, 10, 1), 0.03, 11), stone, [0, 0.12, 0]),
      part(new TorusGeometry(1.45, 0.035, 3, 24), runes, [0, 0.245, 0], [Math.PI / 2, 0, 0]),
      // Tall stone on the left, leaning in.
      part(menhir(2.7, 12), runes, [-1.75, 1.3, -1.3], [0.06, 0.4, -0.08]),
      // The right one snapped: a stump, and its top lying in the dust.
      part(menhir(1.6, 13), runes, [1.75, 0.8, -1.2], [-0.05, -0.3, 0.06]),
      part(menhir(1.1, 14), stone, [0.75, 0.25, -2.1], [Math.PI / 2 - 0.1, 1.9, 0.2]),
      // Rubble
      part(roughen(new BoxGeometry(0.34, 0.24, 0.3), 0.04, 15), stone, [-1.2, 0.12, 1.4], [0, 0.5, 0.1]),
      part(roughen(new BoxGeometry(0.22, 0.18, 0.26), 0.03, 16), stone, [1.35, 0.09, 0.9], [0.2, 1.1, 0]),
      part(roughen(new BoxGeometry(0.18, 0.14, 0.2), 0.03, 17), stone, [-1.9, 0.07, -0.5], [0, 0.3, 0.3]),
    ]),
  );
}

// ── Components ──────────────────────────────────────────────────────────────

const templates = new Map<string, Group>();

function cached(key: string, build: () => Group): Object3D {
  let t = templates.get(key);
  if (!t) {
    t = build();
    templates.set(key, t);
  }
  return instance(t);
}

export function AltarModel({ color }: { color: string }) {
  const obj = useMemo(() => cached(`altar:${color}`, () => altar(color)), [color]);
  return <primitive object={obj} />;
}

export function WaystoneModel() {
  const obj = useMemo(() => cached("waystone", waystone), []);
  return <primitive object={obj} />;
}

export function RiftFrameModel({ color }: { color: string }) {
  const obj = useMemo(() => cached(`rift:${color}`, () => riftFrame(color)), [color]);
  return <primitive object={obj} />;
}
