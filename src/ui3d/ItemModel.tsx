import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshStandardMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  ShaderMaterial,
  SphereGeometry,
  TorusGeometry,
  type BufferGeometry,
} from "three";
import { ENCHANT_COLOR } from "../items/affixes";
import { resolveItem } from "../items/catalog";
import type { ItemDef } from "../items/types";
import { uiNow } from "./clock";
import { glowMaterial, metalMaterial } from "./materials";

/** Every item as a small physical object — the same model in your hands in
 * the inventory, lying on a merchant's table, and glowing on a dungeon
 * floor where it dropped. Built from primitives per item family, varied by
 * the item's colour and id; enchanted items wear a slow violet aura.
 *
 * Fits a ~1 m tall box centred on the origin; callers scale it (an inventory
 * cell holds it at ~0.1). Works in either canvas: geometry and materials are
 * shared singletons, and three.js uploads them once per renderer. */

// ── Shared geometry ──────────────────────────────────────────────────────────

let geo: ReturnType<typeof buildGeometry> | null = null;

function buildGeometry() {
  const cloak = new CylinderGeometry(0.12, 0.36, 0.78, 14, 4, true);
  // Folds: ripple the cone's radius around its circumference, more at the hem.
  const p = cloak.getAttribute("position");
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const a = Math.atan2(z, x);
    const hem = (0.39 - y) / 0.78; // 0 at the collar, 1 at the hem
    const r = 1 + Math.sin(a * 7) * 0.09 * hem;
    p.setXYZ(i, x * r, y - Math.cos(a * 7) * 0.025 * hem, z * r);
  }
  cloak.computeVertexNormals();
  return {
    shaft: new CylinderGeometry(0.028, 0.036, 1, 7),
    ring: new TorusGeometry(1, 0.22, 6, 14),
    thinRing: new TorusGeometry(1, 0.06, 5, 24),
    octa: new OctahedronGeometry(1, 0),
    ico: new IcosahedronGeometry(1, 0),
    sphere: new SphereGeometry(1, 14, 10),
    cone: new CylinderGeometry(0, 1, 1, 5),
    box: new BoxGeometry(1, 1, 1),
    cyl: new CylinderGeometry(1, 1, 1, 10),
    cloak,
    plane: new PlaneGeometry(1, 1),
  };
}

function g() {
  return (geo ??= buildGeometry());
}

// ── Shared materials ─────────────────────────────────────────────────────────

const mats = new Map<string, MeshStandardMaterial>();
function standard(key: string, params: ConstructorParameters<typeof MeshStandardMaterial>[0]): MeshStandardMaterial {
  let m = mats.get(key);
  if (!m) {
    m = new MeshStandardMaterial(params);
    mats.set(key, m);
  }
  return m;
}
const wood = () => standard("wood", { color: "#5a3f2a", roughness: 0.8 });
const darkWood = () => standard("darkwood", { color: "#2e2019", roughness: 0.75 });
const leather = () => standard("leather", { color: "#4b3222", roughness: 0.7 });
const sole = () => standard("sole", { color: "#1c1512", roughness: 0.9 });
const cork = () => standard("cork", { color: "#8a6a44", roughness: 0.95 });
const glass = () =>
  standard("glass", {
    color: "#cfe6ff",
    roughness: 0.08,
    metalness: 0.2,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
  });
function cloth(color: string): MeshStandardMaterial {
  return standard(`cloth:${color}`, {
    color: new Color(color).multiplyScalar(0.55),
    roughness: 0.9,
    side: DoubleSide,
  });
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
  float a = pow(max(0.0, 1.0 - r), 2.2) * uIntensity;
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

// ── Parts ────────────────────────────────────────────────────────────────────

type Part = {
  geometry: BufferGeometry;
  material: MeshStandardMaterial;
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale: [number, number, number] | number;
  /** Rotates with the item's inner animation (orbiting rings, gems). */
  spin?: boolean;
};

function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

function staffParts(def: ItemDef): Part[] {
  const G = g();
  const gem = glowMaterial(def.color, 3);
  const band = metalMaterial("#9a8050");
  const wand = def.id.includes("seeker");
  const len = wand ? 0.7 : 0.95;
  const top = len / 2;
  const parts: Part[] = [
    { geometry: G.shaft, material: def.tier >= 3 ? darkWood() : wood(), scale: [1, len, 1] },
    { geometry: G.ring, material: band, position: [0, top - 0.12, 0], rotation: [Math.PI / 2, 0, 0], scale: 0.04 },
    { geometry: G.ring, material: band, position: [0, -top + 0.25, 0], rotation: [Math.PI / 2, 0, 0], scale: 0.036 },
  ];
  if (def.id.includes("void")) {
    parts.push(
      { geometry: G.sphere, material: glowMaterial(def.color, 1.2), position: [0, top + 0.08, 0], scale: 0.075 },
      { geometry: G.thinRing, material: gem, position: [0, top + 0.08, 0], rotation: [1.1, 0, 0], scale: 0.13, spin: true },
    );
  } else if (def.id.includes("arc")) {
    for (const s of [-1, 1])
      parts.push({ geometry: G.shaft, material: band, position: [s * 0.045, top + 0.06, 0], rotation: [0, 0, -s * 0.45], scale: [0.6, 0.16, 0.6] });
    parts.push({ geometry: G.ico, material: gem, position: [0, top + 0.1, 0], scale: 0.045, spin: true });
  } else if (def.id.includes("splinter")) {
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      parts.push({ geometry: G.octa, material: gem, position: [Math.cos(a) * 0.04, top + 0.07 + i * 0.015, Math.sin(a) * 0.04], rotation: [0.3, a, 0.4], scale: [0.03, 0.07, 0.03] });
    }
  } else if (def.id.includes("ember")) {
    parts.push({ geometry: G.octa, material: gem, position: [0, top + 0.09, 0], scale: [0.055, 0.09, 0.055], spin: true });
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      parts.push({ geometry: G.cone, material: band, position: [Math.cos(a) * 0.05, top + 0.05, Math.sin(a) * 0.05], rotation: [Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5], scale: [0.012, 0.1, 0.012] });
    }
  } else {
    parts.push({ geometry: G.octa, material: gem, position: [0, top + 0.08, 0], scale: [wand ? 0.04 : 0.06, wand ? 0.06 : 0.09, wand ? 0.04 : 0.06], spin: true });
  }
  return parts;
}

function amuletParts(def: ItemDef): Part[] {
  const G = g();
  const gold = metalMaterial("#b8913e");
  const h = hashId(def.id);
  const gemGeo = h < 0.33 ? G.octa : h < 0.66 ? G.ico : G.sphere;
  return [
    // Chain: a tall thin loop.
    { geometry: G.thinRing, material: metalMaterial("#8c7a58"), position: [0, 0.2, 0], scale: [0.26, 0.34, 0.26] },
    { geometry: G.ring, material: gold, position: [0, -0.18, 0], scale: 0.13 },
    { geometry: gemGeo, material: glowMaterial(def.color, 2.6), position: [0, -0.18, 0.01], scale: def.tier >= 3 ? 0.12 : 0.1, spin: true },
  ];
}

function cloakParts(def: ItemDef): Part[] {
  const G = g();
  return [
    { geometry: G.cloak, material: cloth(def.color), scale: 1 },
    { geometry: G.ring, material: cloth(def.color), position: [0, 0.38, 0], rotation: [Math.PI / 2, 0, 0], scale: 0.13 },
    { geometry: G.octa, material: glowMaterial(def.color, 2.2), position: [0, 0.37, 0.15], scale: 0.045 },
  ];
}

function bootsParts(def: ItemDef): Part[] {
  const G = g();
  const parts: Part[] = [];
  const trim = glowMaterial(def.color, def.tier >= 2 ? 1.8 : 0.6);
  for (const s of [-1, 1]) {
    const x = s * 0.15;
    parts.push(
      { geometry: G.cyl, material: leather(), position: [x, 0.08, -0.03], scale: [0.09, 0.4, 0.09] },
      { geometry: G.box, material: leather(), position: [x, -0.17, 0.05], scale: [0.15, 0.12, 0.3] },
      { geometry: G.box, material: sole(), position: [x, -0.245, 0.05], scale: [0.16, 0.035, 0.31] },
      { geometry: G.ring, material: trim, position: [x, 0.27, -0.03], rotation: [Math.PI / 2, 0, 0], scale: 0.095 },
    );
    if (def.jump === "double")
      parts.push({ geometry: G.ring, material: metalMaterial("#7fa090"), position: [x, -0.3, -0.07], rotation: [Math.PI / 2, 0, 0], scale: [0.05, 0.05, 0.1] });
    if (def.jump === "hover")
      parts.push({ geometry: G.cyl, material: glowMaterial(def.color, 2.4), position: [x, -0.29, 0.05], scale: [0.08, 0.008, 0.12] });
  }
  return parts;
}

function consumableParts(def: ItemDef): Part[] {
  const G = g();
  if (def.consumable?.escape) {
    // The Feather of Safe Passage.
    return [
      { geometry: G.sphere, material: glowMaterial(def.color, 1.6), rotation: [0, 0, 0.35], scale: [0.11, 0.42, 0.025] },
      { geometry: G.shaft, material: metalMaterial("#d8c79a"), position: [0.08, -0.3, 0], rotation: [0, 0, 0.35], scale: [0.35, 0.3, 0.35] },
    ];
  }
  return [
    { geometry: G.sphere, material: glowMaterial(def.color, 2.2), position: [0, -0.12, 0], scale: 0.19, spin: true },
    { geometry: G.sphere, material: glass(), position: [0, -0.1, 0], scale: 0.24 },
    { geometry: G.cyl, material: glass(), position: [0, 0.2, 0], scale: [0.07, 0.2, 0.07] },
    { geometry: G.cyl, material: cork(), position: [0, 0.33, 0], scale: [0.065, 0.08, 0.065] },
  ];
}

function partsFor(def: ItemDef): Part[] {
  switch (def.slot) {
    case "staff":
      return staffParts(def);
    case "amulet":
      return amuletParts(def);
    case "cloak":
      return cloakParts(def);
    case "boots":
      return bootsParts(def);
    default:
      return consumableParts(def);
  }
}

export interface ItemModelProps {
  /** Full item id (`defId[+affix][@level]`). */
  itemId: string;
  /** Uniform scale (the model is ~1 m tall at 1). */
  scale?: number;
  /** Turns slowly about its vertical axis. */
  spin?: boolean;
  /** Extra aura intensity (hover/selection glow), added to the enchant aura. */
  highlight?: number;
  position?: readonly [number, number, number];
  rotation?: readonly [number, number, number];
}

export function ItemModel({ itemId, scale = 1, spin = false, highlight = 0, position, rotation }: ItemModelProps) {
  const item = useMemo(() => resolveItem(itemId), [itemId]);
  const parts = useMemo(() => partsFor(item.def), [item.def]);
  const aura = useMemo(() => auraMaterial(item.affix ? ENCHANT_COLOR : item.def.color), [item.affix, item.def.color]);
  useEffect(() => () => aura.dispose(), [aura]);
  const outer = useRef<Group>(null);
  const inner = useRef<Group>(null);
  const auraMesh = useRef<Mesh>(null);
  const phase = useMemo(() => hashId(itemId) * 10, [itemId]);

  useFrame((_, dt) => {
    const t = uiNow() + phase;
    if (outer.current && spin) outer.current.rotation.y += dt * 0.8;
    if (inner.current) inner.current.rotation.y = t * 1.4;
    const base = item.affix ? 0.55 + Math.sin(t * 2.2) * 0.15 : 0;
    aura.uniforms.uIntensity!.value = base + highlight;
    if (auraMesh.current) auraMesh.current.visible = base + highlight > 0.01;
  });

  return (
    <group position={position as [number, number, number] | undefined} rotation={rotation as [number, number, number] | undefined} scale={scale}>
      <group ref={outer}>
        {parts
          .filter((p) => !p.spin)
          .map((p, i) => (
            <mesh key={i} geometry={p.geometry} material={p.material} position={p.position} rotation={p.rotation} scale={p.scale} />
          ))}
        {parts.some((p) => p.spin) && (
          <group ref={inner}>
            {parts
              .filter((p) => p.spin)
              .map((p, i) => (
                <mesh key={i} geometry={p.geometry} material={p.material} position={p.position} rotation={p.rotation} scale={p.scale} />
              ))}
          </group>
        )}
      </group>
      <mesh ref={auraMesh} geometry={g().plane} material={aura} scale={1.3} renderOrder={4} />
    </group>
  );
}
