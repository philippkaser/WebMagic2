import { useMemo } from "react";
import {
  BoxGeometry,
  BufferGeometry,
  ConeGeometry,
  Color,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  OctahedronGeometry,
  PlaneGeometry,
  SphereGeometry,
  TorusGeometry,
} from "three";
import { getItemDef, hasItemDef } from "../../items/catalog";
import { hashSeed } from "../../core/rng";
import { additive, glow, group, instance, lathe, part, std } from "./kit";
import { StaffModel } from "./StaffModel";

/** Miniature, floor-sized versions of every item: a staff laid at a slant,
 * an amulet on its chain, a folded cloak with its clasp, a pair of boots —
 * all tinted by the item's own color so a drop reads before its name does.
 * Centered on the origin, roughly 0.6 m across. */

const GOLD = "#c9a052";

const G = {
  chain: new TorusGeometry(0.15, 0.012, 4, 14),
  bezel: new TorusGeometry(0.06, 0.016, 4, 10),
  gemOcta: new OctahedronGeometry(0.058),
  gemIco: new IcosahedronGeometry(0.056, 0),
  locket: new SphereGeometry(0.06, 7, 5),
  hinge: new BoxGeometry(0.02, 0.03, 0.02),
  cloak: folds(
    lathe(
      [
        [0.06, 0.24],
        [0.14, 0.17],
        [0.2, 0.02],
        [0.25, -0.14],
        [0.31, -0.28],
      ],
      12,
      Math.PI * 0.22,
      Math.PI * 1.56,
    ),
  ),
  // A peaked hood, open at the front, slumped over nothing.
  hood: lathe(
    [
      [0.0, 0.2],
      [0.08, 0.17],
      [0.12, 0.1],
      [0.13, 0.02],
      [0.11, -0.05],
    ],
    8,
    0.7,
    Math.PI * 2 - 1.4,
  ),
  hoodVoid: new SphereGeometry(0.1, 6, 4),
  clasp: new TorusGeometry(0.035, 0.012, 4, 8),
  claspGem: new OctahedronGeometry(0.025),
  bootShaft: new CylinderGeometry(0.062, 0.056, 0.26, 7),
  bootFoot: new SphereGeometry(0.07, 7, 5),
  // Wizard boots: the toe runs long and curls up into a point.
  bootToe: new ConeGeometry(0.045, 0.16, 6),
  bootCuff: new CylinderGeometry(0.085, 0.066, 0.07, 7),
  bootSole: new BoxGeometry(0.12, 0.022, 0.22),
  spring: new TorusGeometry(0.035, 0.008, 3, 8),
  buckle: new BoxGeometry(0.13, 0.025, 0.13),
  wing: new PlaneGeometry(0.18, 0.1),
};

/** Vertical drapery folds and a ragged hem for the lathed cloak. */
function folds<T extends BufferGeometry>(geo: T): T {
  const pos = geo.getAttribute("position");
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const a = Math.atan2(x, z);
    const drop = Math.max(0, 0.2 - y) / 0.48; // folds deepen toward the hem
    const k = 1 + Math.sin(a * 7) * 0.12 * drop;
    pos.setXYZ(i, x * k, y + (y < -0.2 ? Math.sin(a * 11) * 0.025 : 0), z * k);
  }
  geo.computeVertexNormals();
  return geo;
}

function mix(a: string, b: string, k: number): string {
  return `#${new Color(a).lerp(new Color(b), k).getHexString()}`;
}

function amulet(defId: string, color: string): Group {
  const gold = std(GOLD, { metalness: 0.85, roughness: 0.35 });
  const gem = defId === "amulet_moth" ? null : hashSeed(defId) % 2 ? G.gemOcta : G.gemIco;
  const pendant: Group = gem
    ? group([
        part(G.bezel, gold, [0, 0, 0]),
        Object.assign(part(gem, glow(color, 2.6), [0, 0, 0.01], [0, 0, 0], [1, 1.25, 0.7], false), { userData: { glow: true } }),
      ])
    : group([
        // The Moth-Queen's locket: a closed oval with a sliver of light leaking out.
        part(G.locket, gold, [0, 0, 0], [0, 0, 0], [1, 1.25, 0.55]),
        part(G.hinge, gold, [0, 0.075, 0]),
        part(new BoxGeometry(0.1, 0.008, 0.07), glow(color, 3), [0, 0, 0], [0, 0, 0.3], 1, false),
      ]);
  pendant.position.y = -0.13;
  return group([part(G.chain, gold, [0, 0.04, 0], [0, 0, 0], [1, 1.1, 1]), pendant]);
}

function cloak(defId: string, color: string): Group {
  const cloth = std(color, { tex: "cloth", roughness: 0.95, doubleSide: true });
  const lining = std(mix(color, "#000000", 0.55), { tex: "cloth", roughness: 0.95, doubleSide: true });
  const gold = std(GOLD, { metalness: 0.85, roughness: 0.35 });
  const out = group([
    part(G.cloak, cloth, [0, 0, 0]),
    part(G.cloak, lining, [0, 0, 0.004], [0, 0, 0], [0.97, 0.99, 0.97]),
    part(G.hood, cloth, [0, 0.17, -0.02]),
    part(G.hoodVoid, std("#050308", { roughness: 1 }), [0, 0.24, -0.01], [0, 0, 0], [1, 0.9, 0.9], false),
    part(G.clasp, gold, [0, 0.19, 0.08]),
    Object.assign(part(G.claspGem, glow(mix(color, "#ffffff", 0.3), 2.2), [0, 0.19, 0.095], [0, 0, 0], 1, false), {
      userData: { glow: true },
    }),
  ]);
  // Blinking cloaks shimmer: a faint afterimage hem.
  if (defId === "cloak_blink" || defId === "cloak_ember") {
    out.add(part(G.cloak, additive(color, 0.25), [0, -0.02, -0.03], [0, 0.15, 0], 1.06, false));
  }
  // Flattened like a garment on a hanger: broad shoulders, shallow depth —
  // reads as "cloak" rather than "tent" from any side.
  out.scale.set(1.25, 0.9, 0.6);
  return out;
}

function boots(defId: string, color: string): Group {
  const leather = std(mix("#4a3020", color, 0.25), { tex: "leather", roughness: 0.8 });
  const dyed = std(color, { tex: "leather", roughness: 0.75 });
  const sole = std("#1e1612", { roughness: 0.9 });
  const trim = std(defId === "boots_stride" ? GOLD : "#8a7a5a", { metalness: 0.7, roughness: 0.4 });
  const boot = (x: number, ry: number) => {
    const g = group(
      [
        part(G.bootShaft, leather, [0, 0.16, -0.03]),
        part(G.bootCuff, dyed, [0, 0.3, -0.03]),
        part(G.bootFoot, leather, [0, 0.05, 0.02], [0, 0, 0], [1, 0.8, 1.3]),
        part(G.bootToe, leather, [0, 0.06, 0.15], [1.15, 0, 0], [1, 1, 0.8]),
        part(G.bootSole, sole, [0, -0.003, 0.03]),
        part(G.buckle, trim, [0, 0.12, -0.03]),
      ],
      [x, 0, 0],
      [0, ry, 0],
    );
    if (defId === "boots_springheel") {
      for (let i = 0; i < 3; i++) g.add(part(G.spring, trim, [0, -0.03 - i * 0.02, -0.04], [Math.PI / 2, 0, 0]));
    }
    if (defId === "boots_hover") {
      const wingMat = additive(color, 0.7);
      g.add(part(G.wing, wingMat, [0.09, 0.2, -0.05], [0, 0.9, 0.35], 1, false));
      g.add(part(G.wing, wingMat, [-0.09, 0.2, -0.05], [0, -0.9, -0.35], 1, false));
    }
    return g;
  };
  const pair = group([boot(-0.09, 0.12), boot(0.1, -0.08)], [0, -0.12, 0]);
  pair.scale.setScalar(0.85);
  return pair;
}

const templates = new Map<string, Group>();

function itemTemplate(defId: string): Group | null {
  if (!hasItemDef(defId)) return null;
  let t = templates.get(defId);
  if (!t) {
    const def = getItemDef(defId);
    if (def.slot === "amulet") t = amulet(defId, def.color);
    else if (def.slot === "cloak") t = cloak(defId, def.color);
    else if (def.slot === "boots") t = boots(defId, def.color);
    else return null;
    templates.set(defId, t);
  }
  return t;
}

/** The miniature for an item def. Staffs reuse their full model, shrunk. */
export function ItemModel({ defId }: { defId: string }) {
  const obj = useMemo(() => {
    const t = itemTemplate(defId);
    return t ? instance(t) : null;
  }, [defId]);
  if (obj) return <primitive object={obj} />;
  return (
    <group rotation={[0, 0, 0.75]} position={[0.05, -0.02, 0]} scale={0.42}>
      <group position={[0, -0.8, 0]}>
        <StaffModel defId={defId} />
      </group>
    </group>
  );
}
