import {
  BoxGeometry,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  type Material,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  OctahedronGeometry,
  TorusGeometry,
} from "three";
import { additive, bake, glow, group, lathe, part, roughen, std } from "./modelKit";
import { getModelTextures } from "./modelPaint";

/** The room events' furniture (roomEvents/catalog.ts), in the artpass model
 * family — planks, iron, runestone, all pixel-painted, no assets. Pure
 * presentation: roomEvents/RoomEvents.tsx owns state, prompts, lights and
 * animation, through the parts and materials each builder hands back.
 * Origins are on the ground; fronts face +z. Each event animates its own
 * copy, so builders return everything they made for disposeBuilt(). */

interface Built {
  root: Group;
  /** Materials this copy owns (cloned to animate alone). */
  owned: Material[];
}

/** Free a built model's geometry and the materials it owns (interned
 * materials are shared and stay). */
export function disposeBuilt(b: Built): void {
  b.root.traverse((n) => {
    if (n instanceof Mesh) n.geometry.dispose();
  });
  for (const m of b.owned) m.dispose();
}

function iron(): MeshStandardMaterial {
  return std("#2e2c34", { tex: "iron", metalness: 0.75, roughness: 0.42 });
}

function runeStone(color: string, intensity: number): MeshStandardMaterial {
  return std("#4a4658", {
    tex: "runestone",
    roughness: 0.88,
    emissive: color,
    emissiveIntensity: intensity,
    emissiveMap: getModelTextures("glyphs").map,
  });
}

// ── The vault ────────────────────────────────────────────────────────────────

export interface VaultParts extends Built {
  /** Hinged at the chest's back edge: rotate x negative to open. */
  lid: Group;
  /** The lock's gem: its colour and glow tell the vault's state. */
  seal: MeshStandardMaterial;
  /** The chains across the lid, gone once it unseals. */
  chains: Group;
  /** The light inside, shown when the lid lifts. */
  hoard: Mesh;
}

/** An iron-bound strongbox on a runestone plinth, chained shut, its lock a
 * gem that burns while the vault is sealed. */
export function buildVault(): VaultParts {
  const wood = std("#7a5034", { tex: "planks", roughness: 0.85 });
  // Brass-bound, so the bands catch what light there is.
  const metal = std("#a07a40", { tex: "iron", metalness: 0.8, roughness: 0.38 });
  const stone = std("#4a4658", { tex: "runestone", roughness: 0.92 });
  const seal = glow("#ff3b3b", 2.4).clone();
  const W = 1.1;
  const D = 0.7;
  const H = 0.55;
  const base = 0.16;
  const body: Object3D[] = [
    part(roughen(new BoxGeometry(1.55, base, 1.1, 2, 1, 2), 0.02, 4), stone, [0, base / 2, 0]),
    part(new BoxGeometry(W, H, D), wood, [0, base + H / 2, 0]),
  ];
  // Iron bands and corner caps.
  for (const x of [-W / 2 + 0.08, 0, W / 2 - 0.08]) body.push(part(new BoxGeometry(0.07, H + 0.02, D + 0.02), metal, [x, base + H / 2, 0]));
  for (const x of [-1, 1]) for (const z of [-1, 1]) body.push(part(new BoxGeometry(0.1, 0.1, 0.1), metal, [x * (W / 2), base + 0.05, z * (D / 2)]));
  // The lock plate and its gem.
  body.push(part(new BoxGeometry(0.22, 0.26, 0.04), metal, [0, base + H - 0.08, D / 2 + 0.02]));
  const gem = part(new OctahedronGeometry(0.07), seal, [0, base + H - 0.08, D / 2 + 0.06], [0, 0, 0], [1, 1.3, 0.6], false);
  body.push(gem);

  // The lid: a half-barrel hinged at the back.
  const lidParts: Object3D[] = [
    part(new CylinderGeometry(D / 2, D / 2, W, 10, 1, false, 0, Math.PI), wood, [0, 0, D / 2], [0, 0, Math.PI / 2]),
  ];
  for (const x of [-W / 2 + 0.08, 0, W / 2 - 0.08]) {
    lidParts.push(part(new CylinderGeometry(D / 2 + 0.015, D / 2 + 0.015, 0.07, 10, 1, true, 0, Math.PI), metal, [x, 0, D / 2], [0, 0, Math.PI / 2]));
  }
  const lid = group(lidParts, [0, base + H, -D / 2]);
  // The lid's half-barrel spans z ∈ [0, D] from the hinge; rotate it so the
  // round side faces up.
  lid.children.forEach((c) => c.rotateX(-Math.PI / 2));

  // Two chains crossing the lid.
  const link = new TorusGeometry(0.045, 0.012, 4, 8);
  const chainLinks: Object3D[] = [];
  for (const side of [-1, 1]) {
    for (let i = 0; i < 11; i++) {
      const t = i / 10 - 0.5;
      chainLinks.push(part(link, metal, [t * W * 0.95, base + H + 0.32 - Math.abs(t) * 0.25, side * 0.12 + t * side * 0.35], [0, (i % 2) * Math.PI / 2, side * 0.6], 1, false));
    }
  }
  const chains = group(chainLinks);
  const hoard = part(new BoxGeometry(W - 0.12, 0.02, D - 0.12), glow("#ffcf6a", 3).clone(), [0, base + H - 0.04, 0], [0, 0, 0], 1, false);
  hoard.visible = false;
  const root = group([bake(group(body)), lid, chains, hoard]);
  return { root, owned: [seal, hoard.material as Material], lid, seal, chains, hoard };
}

// ── The ward circle ──────────────────────────────────────────────────────────

export const WARD_RUNES = 24;

export interface WardParts extends Built {
  /** The standing stones' carvings (shared material — set its glow). */
  glyphs: MeshStandardMaterial;
  /** One per progress rune round the ring, in order. */
  runes: Mesh[];
  /** Lit and unlit looks for the progress runes. */
  runeOn: MeshStandardMaterial;
  runeOff: MeshStandardMaterial;
  /** The crystal over the heart stone. */
  heart: Group;
  /** The column of light that grows as the circle holds. */
  beam: Mesh;
  /** The stones, to topple when it breaks. */
  stones: Object3D[];
}

export function buildWard(radius: number, color: string): WardParts {
  const glyphs = runeStone(color, 0.25).clone();
  const stone = std("#4a4658", { tex: "runestone", roughness: 0.92 });
  const stones: Object3D[] = [];
  const slab = roughen(new BoxGeometry(0.42, 1.5, 0.28, 2, 3, 2), 0.03, 7);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const s = part(slab, glyphs, [Math.cos(a) * radius, 0.72, Math.sin(a) * radius], [0.04 * Math.sin(i * 3), -a + Math.PI / 2, 0.05 * Math.cos(i * 5)], [1, 0.85 + (i % 3) * 0.12, 1]);
    stones.push(s);
  }
  const runeOn = glow(color, 2.6).clone();
  const runeOff = std("#2a2830", { tex: "runestone", roughness: 0.95 });
  const tile = new BoxGeometry(0.22, 0.04, 0.12);
  const runes: Mesh[] = [];
  for (let i = 0; i < WARD_RUNES; i++) {
    const a = (i / WARD_RUNES) * Math.PI * 2 - Math.PI / 2;
    runes.push(part(tile, runeOff, [Math.cos(a) * (radius - 0.55), 0.02, Math.sin(a) * (radius - 0.55)], [0, -a, 0], 1, false));
  }
  const altar = part(roughen(new CylinderGeometry(0.34, 0.42, 0.55, 7), 0.02, 9), stone, [0, 0.27, 0]);
  const heart = group([part(new OctahedronGeometry(0.16), glow(color, 2.2).clone(), [0, 0, 0], [0, 0, 0], [1, 1.5, 1], false)], [0, 1.1, 0]);
  const beam = part(new CylinderGeometry(0.12, 0.2, 1, 8, 1, true), additive(color, 0.16), [0, 0.5, 0], [0, 0, 0], 1, false);
  beam.scale.y = 0.001;
  const root = group([...stones, ...runes, altar, heart, beam]);
  const heartGlow = (heart.children[0] as Mesh).material as Material;
  return { root, owned: [glyphs, runeOn, heartGlow], glyphs, runes, runeOn, runeOff, heart, beam, stones };
}

// ── The shrine ───────────────────────────────────────────────────────────────

export interface ShrineParts extends Built {
  /** The flame in the offering bowl (scale it, hide it when spent). */
  flame: Mesh;
  /** The idol's eyes. */
  eyes: MeshStandardMaterial;
}

/** A horned stele with a carved face over an iron offering bowl — one of the
 * old powers, burning in the colour of the bargain it offers. */
export function buildShrine(color: string): ShrineParts {
  const stone = std("#4a4658", { tex: "runestone", roughness: 0.92 });
  const carved = runeStone(color, 0.6);
  const metal = iron();
  const eyes = glow(color, 3).clone();
  const body: Object3D[] = [
    part(roughen(new BoxGeometry(1.3, 0.16, 1.0, 2, 1, 2), 0.02, 2), stone, [0, 0.08, -0.15]),
    part(roughen(new BoxGeometry(1.0, 0.14, 0.75, 2, 1, 2), 0.015, 3), stone, [0, 0.23, -0.2]),
    part(roughen(new BoxGeometry(0.62, 1.7, 0.32, 2, 4, 2), 0.025, 5), carved, [0, 1.15, -0.32]),
    // The horns.
    part(new ConeGeometry(0.08, 0.55, 5), stone, [-0.3, 2.05, -0.32], [0, 0, 0.7]),
    part(new ConeGeometry(0.08, 0.55, 5), stone, [0.3, 2.05, -0.32], [0, 0, -0.7]),
    // The brow and the eyes.
    part(new BoxGeometry(0.5, 0.08, 0.1), stone, [0, 1.62, -0.13]),
    part(new BoxGeometry(0.09, 0.05, 0.04), eyes, [-0.12, 1.52, -0.15], [0, 0, 0], 1, false),
    part(new BoxGeometry(0.09, 0.05, 0.04), eyes, [0.12, 1.52, -0.15], [0, 0, 0], 1, false),
    // The offering bowl on its iron stand.
    part(new CylinderGeometry(0.035, 0.05, 0.6, 6), metal, [0, 0.55, 0.25]),
    part(
      lathe(
        [
          [0.05, 0],
          [0.22, 0.05],
          [0.27, 0.14],
        ],
        10,
      ),
      metal,
      [0, 0.83, 0.25],
    ),
  ];
  const flame = part(new ConeGeometry(0.15, 0.42, 6), additive(color, 0.9), [0, 1.15, 0.25], [0, 0, 0], 1, false);
  const root = group([bake(group(body)), flame]);
  return { root, owned: [eyes], flame, eyes };
}

// ── The fountain ─────────────────────────────────────────────────────────────

export interface FountainParts extends Built {
  /** The pool's surface (animate its glow). */
  water: MeshStandardMaterial;
  /** The thin fall from the upper bowl. */
  fall: Mesh;
}

/** A round basin of old stone, a column with a small bowl, clear water
 * falling from it and glowing faintly blue. */
export function buildFountain(): FountainParts {
  const stone = std("#5a5662", { tex: "runestone", roughness: 0.9 });
  const water = new MeshStandardMaterial({ color: "#1c4a7a", emissive: "#5db9ff", emissiveIntensity: 0.9, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.85 });
  const rim = lathe(
    [
      [0.95, 0],
      [1.05, 0.05],
      [1.05, 0.42],
      [0.93, 0.48],
      [0.88, 0.44],
      [0.88, 0.12],
      [0, 0.12],
    ],
    16,
  );
  const body: Object3D[] = [
    part(rim, stone, [0, 0, 0]),
    part(roughen(new CylinderGeometry(0.14, 0.2, 1.05, 7), 0.015, 4), stone, [0, 0.62, 0]),
    part(
      lathe(
        [
          [0.06, 0],
          [0.32, 0.06],
          [0.36, 0.16],
          [0.3, 0.17],
          [0.05, 0.08],
        ],
        12,
      ),
      stone,
      [0, 1.1, 0],
    ),
  ];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    body.push(part(roughen(new IcosahedronGeometry(0.12, 0), 0.03, 6 + i), stone, [Math.cos(a) * 1.0, 0.48, Math.sin(a) * 1.0]));
  }
  const pool = part(new CircleGeometry(0.88, 20), water, [0, 0.36, 0], [-Math.PI / 2, 0, 0], 1, false);
  const top = part(new CircleGeometry(0.3, 12), water, [0, 1.25, 0], [-Math.PI / 2, 0, 0], 1, false);
  const fall = part(new CylinderGeometry(0.03, 0.06, 0.9, 6, 1, true), additive("#9fe0ff", 0.45), [0.3, 0.82, 0], [0, 0, 0.1], 1, false);
  const root = group([bake(group(body)), pool, top, fall]);
  return { root, owned: [water], water, fall };
}
