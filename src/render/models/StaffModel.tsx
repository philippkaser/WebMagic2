import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  OctahedronGeometry,
  Shape,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from "three";
import { getItemDef, hasItemDef } from "../../items/catalog";
import { dimTree, glow, group, instance, part, roughen, std } from "./kit";

/** One distinct staff per catalog entry. All staffs share a frame of
 * reference — butt at y=0, head crowning ~1.4–1.7 — so the viewmodel, the
 * wizards' hands and the floor loot can hold any of them the same way.
 * Crystal/ember meshes are tagged `userData.glow` (the viewmodel pulses its
 * own copies); anything tagged `userData.spin` turns about Y on its own. */

export interface StaffStyle {
  /** Height of the glowing heart, for motes and the personal tint light. */
  headY: number;
  /** Colors the viewmodel's idle motes are drawn from. */
  motes: string[];
  /** How motes behave: drifting sparks, rising embers or crackling arcs. */
  moteKind: "drift" | "ember" | "spark" | "sink";
}

const MOTES: Record<string, Omit<StaffStyle, "headY">> = {
  apprentice_staff: { motes: ["#7fd4ff", "#d8f4ff"], moteKind: "drift" },
  ember_staff: { motes: ["#ff8b3d", "#ffd27a", "#ff5a2a"], moteKind: "ember" },
  arc_staff: { motes: ["#b7f74f", "#f4ffd0"], moteKind: "spark" },
  gravewood_staff: { motes: ["#7affb0", "#2f8f5a"], moteKind: "sink" },
  void_staff: { motes: ["#c86bff", "#5a2a8a", "#f0d8ff"], moteKind: "sink" },
  starfall_staff: { motes: ["#ffe27a", "#ffffff", "#ffb13d"], moteKind: "drift" },
};

const styles = new Map<string, StaffStyle>();

export function staffStyle(defId: string): StaffStyle {
  const id = BUILDERS[defId] ? defId : "apprentice_staff";
  let st = styles.get(id);
  if (!st) {
    const t = staffTemplate(id);
    t.updateMatrixWorld(true);
    let headY = 1.5;
    t.traverse((n) => {
      if (n.userData.heart) headY = n.getWorldPosition(new Vector3()).y;
    });
    st = { headY, ...MOTES[id] };
    styles.set(id, st);
  }
  return st;
}

// ── Builders ────────────────────────────────────────────────────────────────

type V3 = [number, number, number];

function glowPart(geo: Mesh["geometry"], color: string, p: V3, r: V3 = [0, 0, 0], s: number | V3 = 1, intensity = 2.6) {
  const m = part(geo, glow(color, intensity), p, r, s, false);
  m.userData.glow = true;
  return m;
}

/** Tag the mesh motes and tint light should emanate from. */
function heart<T extends Object3D>(o: T): T {
  o.userData.heart = true;
  return o;
}

/** A tapering shaft built from a few slightly kinked segments. */
function shaft(color: string, length: number, r0: number, r1: number, kinks: number[] = [], tex: "bark" | "iron" = "bark") {
  const mat = std(color, { tex, roughness: 0.8 });
  const segs = Math.max(1, kinks.length + 1);
  const out: Object3D[] = [];
  let x = 0;
  let y = 0;
  for (let i = 0; i < segs; i++) {
    const len = length / segs;
    const tilt = kinks[i] ?? 0;
    const ra = r0 + ((r1 - r0) * i) / segs;
    const rb = r0 + ((r1 - r0) * (i + 1)) / segs;
    const geo = new CylinderGeometry(rb, ra, len * 1.04, 6, 1);
    const m = part(geo, mat, [x + Math.sin(tilt) * len * 0.5, y + len * 0.5, 0], [0, 0, -tilt]);
    out.push(m);
    x += Math.sin(tilt) * len;
    y += Math.cos(tilt) * len;
  }
  return { parts: out, top: [x, y] as [number, number] };
}

function ring(color: string, y: number, r: number, tube = 0.012, metal = true) {
  return part(
    new TorusGeometry(r, tube, 4, 8),
    std(color, { metalness: metal ? 0.85 : 0, roughness: metal ? 0.35 : 0.8 }),
    [0, y, 0],
    [Math.PI / 2, 0, 0],
  );
}

function grip(y0: number, y1: number, r: number) {
  return part(new CylinderGeometry(r, r, y1 - y0, 6), std("#5a3a24", { tex: "leather" }), [0, (y0 + y1) / 2, 0]);
}

const BRASS = "#b08a48";
const IRON = "#3a3840";

function apprentice(): Group {
  const { parts } = shaft("#c9a878", 1.36, 0.036, 0.026);
  const fork: Object3D[] = [];
  // Three prongs of living ash flaring out, then curling back over the crystal.
  const ash = std("#c9a878", { tex: "bark" });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const lower = part(new CylinderGeometry(0.011, 0.016, 0.17, 5), ash, [0, 0.075, 0.032], [0.45, 0, 0]);
    const upper = part(new ConeGeometry(0.011, 0.14, 5), ash, [0, 0.2, 0.05], [-0.35, 0, 0]);
    fork.push(group([lower, upper], [0, 1.34, 0], [0, a, 0]));
  }
  // A tiny leaf sprouting from the fork — the ash is still alive.
  const leaf = part(new SphereGeometry(0.03, 4, 3), std("#5f8a3a", { roughness: 0.7 }), [0.05, 1.3, 0], [0, 0, -0.8], [1, 0.35, 0.6]);
  return group([
    ...parts,
    grip(0.52, 0.78, 0.034),
    ring(BRASS, 0.52, 0.035),
    ring(BRASS, 0.78, 0.035),
    ring(BRASS, 1.33, 0.026),
    part(new CylinderGeometry(0.026, 0.02, 0.06, 6), std(BRASS, { metalness: 0.8, roughness: 0.35 }), [0, 0.03, 0]),
    ...fork,
    leaf,
    heart(glowPart(new OctahedronGeometry(0.05), "#7fd4ff", [0, 1.5, 0.02], [0, 0.4, 0], [1, 1.7, 1])),
  ]);
}

function ember(): Group {
  const { parts } = shaft("#3b2a22", 1.34, 0.03, 0.026);
  const iron = std(IRON, { tex: "iron", metalness: 0.75, roughness: 0.45 });
  const cage: Object3D[] = [];
  // Six bars bowing out around the coal, pinched at top and bottom.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const lo = part(new BoxGeometry(0.014, 0.1, 0.014), iron, [0, 0.04, 0.05], [0.55, 0, 0]);
    const mid = part(new BoxGeometry(0.014, 0.1, 0.014), iron, [0, 0.13, 0.075]);
    const hi = part(new BoxGeometry(0.014, 0.1, 0.014), iron, [0, 0.22, 0.05], [-0.55, 0, 0]);
    cage.push(group([lo, mid, hi], [0, 1.36, 0], [0, a, 0]));
  }
  const coal = new IcosahedronGeometry(0.058, 0);
  return group([
    ...parts,
    grip(0.5, 0.74, 0.036),
    ring(IRON, 0.5, 0.038, 0.014),
    ring(IRON, 0.74, 0.038, 0.014),
    ring(IRON, 0.98, 0.033, 0.012),
    ring(IRON, 1.18, 0.031, 0.012),
    // Cup the cage sits in
    part(new CylinderGeometry(0.06, 0.03, 0.06, 6, 1, true), iron, [0, 1.36, 0]),
    ...cage,
    ring(IRON, 1.6, 0.03, 0.01),
    part(new ConeGeometry(0.018, 0.1, 5), iron, [0, 1.66, 0]),
    heart(glowPart(coal, "#ff8b3d", [0, 1.49, 0], [0.3, 0.2, 0], 1, 3.2)),
    glowPart(new IcosahedronGeometry(0.03, 0), "#ffd27a", [0, 1.49, 0.02], [0, 0, 0], 1, 4),
    part(new CylinderGeometry(0.026, 0.02, 0.05, 6), iron, [0, 0.025, 0]),
  ]);
}

function arc(): Group {
  const { parts } = shaft("#2f3a30", 1.3, 0.028, 0.024);
  const copper = std("#c07a3a", { metalness: 0.9, roughness: 0.3 });
  const coil: Object3D[] = [];
  for (let i = 0; i < 7; i++) {
    coil.push(part(new TorusGeometry(0.036, 0.009, 4, 8), copper, [0, 1.0 + i * 0.032, 0], [Math.PI / 2 + 0.12, 0, 0]));
  }
  // Three tesla prongs, each tipped with a spark bead.
  const prongs: Object3D[] = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.3;
    const rod = part(new CylinderGeometry(0.008, 0.012, 0.26, 4), copper, [0, 0.12, 0.05], [0.42, 0, 0]);
    const bead = glowPart(new OctahedronGeometry(0.02), "#b7f74f", [0, 0.24, 0.1], [0, 0, 0], 1, 3.5);
    prongs.push(group([rod, bead], [0, 1.3, 0], [0, a, 0]));
  }
  return group([
    ...parts,
    grip(0.46, 0.72, 0.034),
    ring("#c07a3a", 0.46, 0.036),
    ring("#c07a3a", 0.72, 0.036),
    ...coil,
    part(new CylinderGeometry(0.05, 0.03, 0.05, 6), std(IRON, { tex: "iron", metalness: 0.7, roughness: 0.4 }), [0, 1.3, 0]),
    ...prongs,
    heart(glowPart(new IcosahedronGeometry(0.045, 0), "#b7f74f", [0, 1.52, 0], [0, 0, 0], 1, 3)),
    part(new CylinderGeometry(0.024, 0.018, 0.05, 6), copper, [0, 0.025, 0]),
  ]);
}

function gravewood(): Group {
  const { parts, top } = shaft("#4d4636", 1.34, 0.036, 0.024, [0.08, -0.1, 0.12, -0.06]);
  for (const p of parts) roughen((p as Mesh).geometry, 0.008, 3);
  const bark = std("#3e3a2c", { tex: "bark" });
  const bone = std("#a89a7c", { tex: "bone", roughness: 0.9 });
  const [tx, ty] = top;
  // Roots clawing up around the skull.
  const roots: Object3D[] = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    const r = part(new TorusGeometry(0.075, 0.011, 4, 7, Math.PI * 0.9), bark, [0.06, 0.06, 0], [0, 0, 0.3]);
    roots.push(group([r], [tx, ty - 0.02, 0], [0, a, 0]));
  }
  const skull = group(
    [
      part(new SphereGeometry(0.075, 7, 5), bone, [0, 0.03, 0], [0, 0, 0], [1, 0.95, 1.08]),
      part(new BoxGeometry(0.08, 0.04, 0.07), bone, [0, -0.035, 0.03]), // jaw
      glowPart(new BoxGeometry(0.03, 0.026, 0.012), "#7affb0", [-0.027, 0.026, 0.074], [0, 0, 0], 1, 3.6),
      glowPart(new BoxGeometry(0.03, 0.026, 0.012), "#7affb0", [0.027, 0.026, 0.074], [0, 0, 0], 1, 3.6),
      part(new BoxGeometry(0.012, 0.016, 0.01), std("#1a1410"), [0, 0.0, 0.08]), // nose hole
    ],
    [tx, ty + 0.14, 0],
    [0.15, 0, 0],
  );
  // A dangling finger-bone charm on a cord.
  const charm = group(
    [
      part(new CylinderGeometry(0.003, 0.003, 0.14, 3), std("#2a2218"), [0, -0.07, 0]),
      part(new CylinderGeometry(0.009, 0.009, 0.05, 4), bone, [0, -0.16, 0]),
    ],
    [tx - 0.05, ty - 0.02, 0.02],
    [0, 0, 0.12],
  );
  return group([
    ...parts,
    grip(0.5, 0.72, 0.04),
    ...roots,
    skull,
    charm,
    // Faint soul-light in the skull's heart
    heart(glowPart(new OctahedronGeometry(0.022), "#7affb0", [tx, ty + 0.17, 0], [0, 0, 0], 1, 2)),
  ]);
}

function hollow(): Group {
  const obsidian = std("#1b1624", { metalness: 0.6, roughness: 0.28 });
  const silver = std("#b9aed0", { metalness: 0.9, roughness: 0.3 });
  const shaftGeo = new CylinderGeometry(0.02, 0.03, 1.32, 5);
  const shard = new OctahedronGeometry(0.022);
  // Floating shards orbiting the hollow; the pivot spins, the shards bob.
  const orbit = group(
    [0, 1, 2].map((i) => {
      const a = (i / 3) * Math.PI * 2;
      return glowPart(shard, "#c86bff", [Math.cos(a) * 0.2, (i - 1) * 0.04, Math.sin(a) * 0.2], [0.4, a, 0], [0.6, 1.2, 0.6], 2.2);
    }),
    [0, 1.56, 0],
  );
  orbit.userData.spin = 1.4;
  const ringMesh = part(new TorusGeometry(0.13, 0.022, 5, 12), obsidian, [0, 1.56, 0]);
  const ringTrim = part(new TorusGeometry(0.13, 0.008, 3, 12), silver, [0, 1.56, 0.02]);
  // The void inside: a black pupil with a glowing rim that watches back.
  const pupil = part(new SphereGeometry(0.06, 8, 6), std("#000000", { roughness: 1 }), [0, 1.56, 0], [0, 0, 0], [1, 1, 0.5], false);
  const rim = glowPart(new TorusGeometry(0.075, 0.012, 4, 12), "#c86bff", [0, 1.56, 0], [0, 0, 0], 1, 3.2);
  return group([
    part(shaftGeo, obsidian, [0, 0.66, 0]),
    part(new CylinderGeometry(0.036, 0.036, 0.22, 5), std("#2a2236", { tex: "leather" }), [0, 0.62, 0]),
    ring("#b9aed0", 0.5, 0.037, 0.01),
    ring("#b9aed0", 0.74, 0.037, 0.01),
    // Silver claw holding the ring
    part(new ConeGeometry(0.04, 0.12, 5), silver, [0, 1.38, 0], [Math.PI, 0, 0]),
    part(new BoxGeometry(0.02, 0.08, 0.02), silver, [-0.08, 1.42, 0], [0, 0, 0.7]),
    part(new BoxGeometry(0.02, 0.08, 0.02), silver, [0.08, 1.42, 0], [0, 0, -0.7]),
    ringMesh,
    ringTrim,
    pupil,
    heart(rim),
    orbit,
    part(new ConeGeometry(0.03, 0.08, 5), silver, [0, -0.02, 0], [Math.PI, 0, 0]),
  ]);
}

function starGeometry(outer: number, inner: number, depth: number) {
  const s = new Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? inner : outer;
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const g = new ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: depth * 0.6, bevelSize: depth * 0.4, bevelSegments: 1 });
  g.center();
  return g;
}

function starfall(): Group {
  const gold = std("#d9b45a", { metalness: 0.9, roughness: 0.3 });
  const dark = std("#2a2030", { metalness: 0.5, roughness: 0.4 });
  const crown: Object3D[] = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    crown.push(group([part(new ConeGeometry(0.016, 0.13, 4), gold, [0, 0.05, 0.085], [0.28, 0, 0])], [0, 1.44, 0], [0, a, 0]));
  }
  const star = glowPart(starGeometry(0.075, 0.032, 0.02), "#ffe27a", [0, 0, 0], [0, 0, 0], 1, 3.4);
  const starPivot = group([star], [0, 1.6, 0]);
  starPivot.userData.spin = 0.9;
  heart(starPivot);
  const motes = group(
    [0, 1, 2, 3].map((i) => {
      const a = (i / 4) * Math.PI * 2;
      return glowPart(new OctahedronGeometry(0.014), "#fff3c0", [Math.cos(a) * 0.15, Math.sin(i * 2.1) * 0.05, Math.sin(a) * 0.15], [0, 0, 0], 1, 3);
    }),
    [0, 1.6, 0],
  );
  motes.userData.spin = -1.8;
  return group([
    part(new CylinderGeometry(0.022, 0.028, 1.4, 6), dark, [0, 0.7, 0]),
    // Gold spiral banding up the shaft
    ...[0.3, 0.55, 0.8, 1.05, 1.25].map((y) => ring("#d9b45a", y, 0.03, 0.009)),
    grip(0.58, 0.76, 0.034),
    part(new SphereGeometry(0.04, 6, 4), gold, [0, 1.4, 0]),
    part(new CylinderGeometry(0.09, 0.04, 0.05, 7, 1, true), gold, [0, 1.46, 0]),
    ...crown,
    starPivot,
    motes,
    part(new ConeGeometry(0.03, 0.08, 6), gold, [0, -0.02, 0], [Math.PI, 0, 0]),
  ]);
}

/** Builder + the height where its head begins: everything mounted above it
 * is scaled up so heads read as chunky silhouettes at the game's low dpr. */
const BUILDERS: Record<string, { build: () => Group; base: number }> = {
  apprentice_staff: { build: apprentice, base: 1.32 },
  ember_staff: { build: ember, base: 1.33 },
  arc_staff: { build: arc, base: 1.28 },
  gravewood_staff: { build: gravewood, base: 1.25 },
  void_staff: { build: hollow, base: 1.34 },
  starfall_staff: { build: starfall, base: 1.38 },
};

const HEAD_SCALE = 1.4;

function enlargeHead(root: Group, base: number) {
  for (const c of root.children) {
    if (c.position.y < base - 1e-3) continue;
    c.position.set(c.position.x * HEAD_SCALE, base + (c.position.y - base) * HEAD_SCALE, c.position.z * HEAD_SCALE);
    c.scale.multiplyScalar(HEAD_SCALE);
  }
}

const templates = new Map<string, Group>();

function staffTemplate(defId: string): Group {
  const id = BUILDERS[defId] ? defId : "apprentice_staff";
  let t = templates.get(id);
  if (!t) {
    const { build, base } = BUILDERS[id];
    t = build();
    enlargeHead(t, base);
    templates.set(id, t);
  }
  return t;
}

/** Resolve a (possibly unknown, e.g. from a newer peer) staff def id. */
export function knownStaffId(defId: string | undefined): string {
  return defId && hasItemDef(defId) && getItemDef(defId).slot === "staff" ? defId : "apprentice_staff";
}

/** A staff instance. `ownGlow` gives this copy private crystal materials,
 * handed to `onGlow` so the owner can pulse them without lighting up every
 * other copy of the same staff. */
export function StaffModel({
  defId,
  ownGlow = false,
  onGlow,
  shadows = true,
  dim,
}: {
  defId: string;
  ownGlow?: boolean;
  onGlow?: (materials: MeshStandardMaterial[]) => void;
  shadows?: boolean;
  /** Albedo multiplier for surfaces (not crystals) — see kit `dimmed`. */
  dim?: number;
}) {
  const { root, spinners, glows } = useMemo(() => {
    const root = instance(staffTemplate(defId));
    if (dim !== undefined) dimTree(root, dim);
    const spinners: Object3D[] = [];
    const glows: MeshStandardMaterial[] = [];
    const privateCopies = new Map<MeshStandardMaterial, MeshStandardMaterial>();
    root.traverse((n) => {
      if (n.userData.spin) spinners.push(n);
      if (!(n instanceof Mesh)) return;
      n.castShadow = shadows && n.castShadow;
      if (ownGlow && n.userData.glow) {
        const src = n.material as MeshStandardMaterial;
        let copy = privateCopies.get(src);
        if (!copy) {
          copy = src.clone();
          copy.userData.baseIntensity = src.emissiveIntensity;
          privateCopies.set(src, copy);
          glows.push(copy);
        }
        n.material = copy;
      }
    });
    return { root, spinners, glows };
  }, [defId, ownGlow, shadows, dim]);

  useEffect(() => {
    onGlow?.(glows);
    return () => glows.forEach((m) => m.dispose());
  }, [glows, onGlow]);

  useFrame((_, dt) => {
    for (const s of spinners) s.rotation.y += s.userData.spin * dt;
  });

  return <primitive object={root} />;
}
