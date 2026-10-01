import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  OctahedronGeometry,
  PlaneGeometry,
  ShaderMaterial,
  Shape,
  SphereGeometry,
  TorusGeometry,
} from "three";
import { ENCHANT_COLOR } from "../items/affixes";
import { resolveItem } from "../items/catalog";
import type { ItemDef } from "../items/types";
import { additive, glow, group, instance, lathe, part, std } from "../render/models/modelKit";
import { StaffModel } from "../render/models/StaffModel";
import { uiNow } from "./clock";

/** Every item as a small physical object — the same model in your hands in
 * the inventory, lying on a merchant's table, and glowing on a dungeon floor
 * where it dropped. The artpass model family: a staff is the very staff you
 * would wield (render/models/StaffModel), an amulet hangs on its chain, a
 * cloak is folded with its hood and clasp, boots come as a curl-toed pair,
 * a draught is a corked flask of glowing liquid — each tinted by the item's
 * own colour, painted with the models' pixel textures. Enchanted items wear
 * a slow violet aura.
 *
 * Fits a ~1 m tall box centred on the origin; callers scale it (an inventory
 * cell holds it at ~0.1). Works in either canvas: templates are built once
 * per item and cloned per use, sharing geometry and materials, and three.js
 * uploads them once per renderer. */

const GOLD = "#c9a052";

const G = {
  chain: new TorusGeometry(0.15, 0.012, 4, 14),
  bezel: new TorusGeometry(0.06, 0.016, 4, 10),
  prong: new ConeGeometry(0.012, 0.05, 4),
  gemOcta: new OctahedronGeometry(0.058),
  gemIco: new IcosahedronGeometry(0.056, 0),
  gemSmall: new OctahedronGeometry(0.026),
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
  // A round-bellied flask with a long neck and a lipped mouth.
  flask: lathe(
    [
      [0.0, -0.3],
      [0.15, -0.3],
      [0.24, -0.21],
      [0.27, -0.07],
      [0.22, 0.07],
      [0.1, 0.14],
      [0.075, 0.2],
      [0.075, 0.3],
      [0.1, 0.32],
      [0.085, 0.34],
    ],
    10,
  ),
  liquid: lathe(
    [
      [0.0, -0.27],
      [0.13, -0.27],
      [0.215, -0.19],
      [0.24, -0.07],
      [0.2, 0.04],
      [0.0, 0.04],
    ],
    10,
  ),
  cork: new CylinderGeometry(0.075, 0.062, 0.12, 7),
  twine: new TorusGeometry(0.085, 0.014, 3, 10),
  label: new BoxGeometry(0.2, 0.13, 0.02),
  vane: featherVane(),
  quill: new CylinderGeometry(0.012, 0.02, 0.9, 5),
  mote: new OctahedronGeometry(0.03),
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

/** A feather's vane: a long leaf, with notches where the barbs split. One
 * simple outline (right edge up, tip, left edge down) so it triangulates. */
function featherVane(): ExtrudeGeometry {
  const s = new Shape();
  const n = 9;
  const L = 0.8;
  const width = (t: number, k: number) => Math.sin(t * Math.PI) ** 0.7 * k * (1 - t * 0.25);
  s.moveTo(0, -L / 2);
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const y = -L / 2 + t * L;
    const w = width(t, 0.15);
    // A barb split every third step: the edge steps in, then out again.
    s.lineTo(i % 3 === 0 ? w * 0.6 : w, y - 0.025);
    s.lineTo(w, y);
  }
  s.lineTo(0, L / 2);
  for (let i = n - 1; i >= 1; i--) {
    const t = i / n;
    const y = -L / 2 + t * L;
    const w = width(t, 0.12);
    s.lineTo(-w, y);
    s.lineTo(i % 4 === 1 ? -w * 0.55 : -w, y - 0.03);
  }
  s.closePath();
  const g = new ExtrudeGeometry(s, { depth: 0.015, bevelEnabled: false });
  g.translate(0, 0, -0.0075);
  return g;
}

function mix(a: string, b: string, k: number): string {
  return `#${new Color(a).lerp(new Color(b), k).getHexString()}`;
}

function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

function tagGlow<T extends Object3D>(o: T): T {
  o.userData.glow = true;
  return o;
}

function amulet(def: ItemDef): Group {
  const gold = std(GOLD, { metalness: 0.85, roughness: 0.35 });
  const gem = hashId(def.id) < 0.5 ? G.gemOcta : G.gemIco;
  const big = def.tier >= 3 ? 1.25 : 1;
  const pendant = group([
    part(G.bezel, gold, [0, 0, 0], [0, 0, 0], big),
    tagGlow(part(gem, glow(def.color, 2.6), [0, 0, 0.01], [0, 0, 0], [big, 1.25 * big, 0.7 * big], false)),
  ]);
  // Finer amulets grip their stone in claws.
  if (def.tier >= 2) {
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      pendant.add(part(G.prong, gold, [Math.cos(a) * 0.06 * big, Math.sin(a) * 0.06 * big, 0.02], [0, 0, a - Math.PI / 2]));
    }
  }
  // Multiplicity: two lesser stones echo the great one.
  if ((def.passives?.extraProjectiles ?? 0) > 0) {
    for (const s of [-1, 1]) pendant.add(tagGlow(part(G.gemSmall, glow(def.color, 2.4), [s * 0.1, -0.05, 0.01], [0, 0, s * 0.3], 1, false)));
  }
  pendant.position.y = -0.13;
  const out = group([part(G.chain, gold, [0, 0.04, 0], [0, 0, 0], [1, 1.1, 1]), pendant]);
  out.scale.setScalar(2.3);
  out.position.y = 0.05;
  return group([out]);
}

function cloak(def: ItemDef): Group {
  const cloth = std(def.color, { tex: "cloth", roughness: 0.95, doubleSide: true });
  const lining = std(mix(def.color, "#000000", 0.55), { tex: "cloth", roughness: 0.95, doubleSide: true });
  const gold = std(GOLD, { metalness: 0.85, roughness: 0.35 });
  const inner = group([
    part(G.cloak, cloth, [0, 0, 0]),
    part(G.cloak, lining, [0, 0, 0.004], [0, 0, 0], [0.97, 0.99, 0.97]),
    part(G.hood, cloth, [0, 0.17, -0.02]),
    part(G.hoodVoid, std("#050308", { roughness: 1 }), [0, 0.24, -0.01], [0, 0, 0], [1, 0.9, 0.9], false),
    part(G.clasp, gold, [0, 0.19, 0.08]),
    tagGlow(part(G.claspGem, glow(mix(def.color, "#ffffff", 0.3), 2.2), [0, 0.19, 0.095], [0, 0, 0], 1, false)),
  ]);
  // A blinking cloak shimmers: a faint afterimage hem.
  if (def.dash) inner.add(tagGlow(part(G.cloak, additive(def.color, 0.25), [0, -0.02, -0.03], [0, 0.15, 0], 1.06, false)));
  // Flattened like a garment on a hanger: broad shoulders, shallow depth —
  // reads as "cloak" rather than "tent" from any side.
  inner.scale.set(1.25 * 1.55, 0.9 * 1.55, 0.6 * 1.55);
  inner.position.y = -0.03;
  return group([inner]);
}

function boots(def: ItemDef): Group {
  const leather = std(mix("#4a3020", def.color, 0.25), { tex: "leather", roughness: 0.8 });
  const dyed = std(def.color, { tex: "leather", roughness: 0.75 });
  const sole = std("#1e1612", { roughness: 0.9 });
  const trim = std(def.tier >= 2 ? GOLD : "#8a7a5a", { metalness: 0.7, roughness: 0.4 });
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
    if (def.jump === "double") {
      for (let i = 0; i < 3; i++) g.add(part(G.spring, trim, [0, -0.03 - i * 0.02, -0.04], [Math.PI / 2, 0, 0]));
    }
    if (def.jump === "hover") {
      const wing = additive(def.color, 0.7);
      g.add(tagGlow(part(G.wing, wing, [0.09, 0.2, -0.05], [0, 0.9, 0.35], 1, false)));
      g.add(tagGlow(part(G.wing, wing, [-0.09, 0.2, -0.05], [0, -0.9, -0.35], 1, false)));
    }
    return g;
  };
  const pair = group([boot(-0.09, 0.12), boot(0.1, -0.08)]);
  pair.scale.setScalar(2.3);
  pair.position.set(0, -0.36, -0.04);
  return group([pair]);
}

function draught(def: ItemDef): Group {
  const glass = new MeshStandardMaterial({
    color: "#cfe6ff",
    roughness: 0.1,
    metalness: 0.1,
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
  });
  const cork = std("#8a6a44", { tex: "bark", roughness: 0.95 });
  const twine = std("#6a5238", { tex: "leather", roughness: 0.9 });
  const label = std("#d6c49a", { tex: "cloth", roughness: 0.95 });
  return group([
    tagGlow(part(G.liquid, glow(def.color, 2.2), [0, 0, 0], [0, 0, 0], 1, false)),
    part(G.flask, glass, [0, 0, 0], [0, 0, 0], 1, false),
    part(G.cork, cork, [0, 0.37, 0]),
    part(G.twine, twine, [0, 0.23, 0], [Math.PI / 2, 0, 0]),
    part(G.label, label, [0, -0.1, 0.235], [-0.12, 0, 0]),
  ]);
}

function feather(def: ItemDef): Group {
  const vane = std(def.color, { tex: "cloth", roughness: 0.8, emissive: def.color, emissiveIntensity: 0.5, doubleSide: true });
  const quill = std("#e8dcc0", { tex: "bone", roughness: 0.6 });
  const inner = group(
    [
      part(G.vane, vane, [0, 0.05, 0]),
      part(G.quill, quill, [0, 0.0, 0.01]),
      tagGlow(part(G.mote, glow(def.color, 3), [0.18, 0.28, 0.02], [0, 0, 0.4], 1, false)),
      tagGlow(part(G.mote, glow(def.color, 3), [-0.16, -0.1, 0.02], [0, 0, 0.2], 0.7, false)),
    ],
    [0, 0, 0],
    [0, 0, 0.35],
  );
  return group([inner]);
}

const templates = new Map<string, Group>();

/** Built once per base item; the returned clone shares every buffer. */
function itemObject(def: ItemDef): Object3D | null {
  if (def.slot === "staff") return null;
  let t = templates.get(def.id);
  if (!t) {
    if (def.slot === "amulet") t = amulet(def);
    else if (def.slot === "cloak") t = cloak(def);
    else if (def.slot === "boots") t = boots(def);
    else if (def.consumable?.escape) t = feather(def);
    else t = draught(def);
    templates.set(def.id, t);
  }
  return instance(t);
}

// ── Aura: a soft additive disc that always faces the eye ─────────────────────

const AURA_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vec3 scale = vec3(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz), 1.0);
  mv.xy += position.xy * scale.xy;
  gl_Position = projectionMatrix * mv;
}
`;
const AURA_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uIntensity;
varying vec2 vUv;
void main() {
  vec2 d = vUv - 0.5;
  float r = length(d) * 2.0;
  // Banded falloff: steps of light, not a smooth airbrushed blob.
  float a = floor(pow(max(0.0, 1.0 - r), 2.2) * 6.0) / 6.0 * uIntensity;
  gl_FragColor = vec4(uColor * a, 0.0);
  #include <colorspace_fragment>
  gl_FragColor.a = 0.0;
}
`;

function auraMaterial(color: string): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uColor: { value: new Color(color) }, uIntensity: { value: 0.6 } },
    vertexShader: AURA_VERT,
    fragmentShader: AURA_FRAG,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    premultipliedAlpha: true,
  });
}

const auraPlane = new PlaneGeometry(1, 1);

export interface ItemModelProps {
  /** Full item id (`defId[+affix][@level]`). */
  itemId: string;
  /** Uniform scale (the model is ~1 m tall at 1). */
  scale?: number;
  /** Turns slowly about its vertical axis. */
  spin?: boolean;
  /** Extra aura intensity (hover/selection glow), added to the enchant aura. */
  highlight?: number;
  /** Like `highlight`, but read every frame — for glows that animate
   * (a hover easing in) without re-rendering the model. Added to it. */
  highlightRef?: { readonly current: number };
  position?: readonly [number, number, number];
  rotation?: readonly [number, number, number];
}

/** A staff stands on its butt; this centres its ~1.75 m on the origin at
 * ~1.1 m — a touch over the box, since sockets and floors hold staffs on a
 * slant, and the head must read at an inventory cell's size. */
const STAFF_ITEM_SCALE = 0.64;
const STAFF_ITEM_Y = -0.55;

export function ItemModel({ itemId, scale = 1, spin = false, highlight = 0, highlightRef, position, rotation }: ItemModelProps) {
  const item = useMemo(() => resolveItem(itemId), [itemId]);
  const obj = useMemo(() => itemObject(item.def), [item.def]);
  const aura = useMemo(() => auraMaterial(item.affix ? ENCHANT_COLOR : item.def.color), [item.affix, item.def.color]);
  useEffect(() => () => aura.dispose(), [aura]);
  const outer = useRef<Group>(null);
  const auraMesh = useRef<Mesh>(null);
  const phase = useMemo(() => hashId(itemId) * 10, [itemId]);

  useFrame((_, dt) => {
    const t = uiNow() + phase;
    if (outer.current && spin) outer.current.rotation.y += dt * 0.8;
    const base = item.affix ? 0.55 + Math.sin(t * 2.2) * 0.15 : 0;
    const g = base + highlight + (highlightRef?.current ?? 0);
    aura.uniforms.uIntensity!.value = g;
    if (auraMesh.current) auraMesh.current.visible = g > 0.01;
  });

  return (
    <group position={position as [number, number, number] | undefined} rotation={rotation as [number, number, number] | undefined} scale={scale}>
      <group ref={outer}>
        {obj ? (
          <primitive object={obj} />
        ) : (
          <group position={[0, STAFF_ITEM_Y, 0]} scale={STAFF_ITEM_SCALE}>
            <StaffModel itemId={itemId} shadows={false} />
          </group>
        )}
      </group>
      <mesh ref={auraMesh} geometry={auraPlane} material={aura} scale={1.3} renderOrder={4} />
    </group>
  );
}
