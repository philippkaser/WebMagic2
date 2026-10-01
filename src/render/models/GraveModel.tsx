import { useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type Ref } from "react";
import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from "three";
import {
  addLightSource,
  removeLightSource,
  type DynamicLightSource,
} from "../../fx/DynamicLights";
import { spawnBurst } from "../../fx/Particles";
import { bake, group, instance, part, roughen, std } from "./modelKit";
import { assignRef, shared } from "./shared";

/** A fallen wizard's grave: their iron-bound chest, and what's left of them
 * — skull, scattered bones, a slumped pointed hat and a snapped staff —
 * with light leaking from under the lid in the colour of the robe they died
 * in. (The artpass "chest inherited from someone who died here".) Origin =
 * ground at its centre; long axis along X, about 1.44 m across with the
 * remains.
 *
 * `opened` swings the lid back on its hinges and lets the glow gutter down
 * to a dim light in the chest's mouth — the dungeon has already been
 * through it. The lid eases between poses, and mounts already in its
 * current pose (a late joiner sees an opened grave open, not opening).
 *
 * Presentational: behaviour (who may open it, what it held) lives with the
 * caller. Two opt-in extras are purely visual and cost nothing when off:
 *  - `motes`: soul motes drift up out of it (fx/Particles).
 *  - `light`: a faint pooled light (fx/DynamicLights) — static graves only;
 *    it's registered where the grave stands when mounted.
 * `glowRef` exposes the glow material if behaviour wants to pulse it; the
 * model itself only sets its brightness when `opened` changes. */

export interface GraveModelProps {
  /** The fallen wizard's robe color. Lifted to a readable ghost-glow (dark
   * robes still glow), hue kept. */
  color: string;
  opened?: boolean;
  motes?: boolean;
  light?: boolean;
  glowRef?: Ref<MeshStandardMaterial>;
  castShadow?: boolean;
}

const GLOW_CLOSED = 2.4;
const GLOW_OPEN = 0.5;
const LIGHT_CLOSED = 1.8;
const LIGHT_OPEN = 0.5;
/** Lid swing when fully open (rad about the back hinge; negative = back). */
const LID_OPEN = -1.25;
/** The whole grave is a little larger than a village chest. */
const SCALE = 1.15;

const W = 0.9;
const H = 0.5;
const D = 0.6;

function iron() {
  return std("#2e2c34", { tex: "iron", metalness: 0.75, roughness: 0.42 });
}

function chestBody(): Group {
  const wood = std("#6a4a30", { tex: "planks", roughness: 0.85 });
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

function chestLid(): Group {
  const wood = std("#5e4028", { tex: "planks", roughness: 0.85 });
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
    [0.6, 0.12, 0.3],
    [0.1, -0.5, 0.15],
  );
  const boneGeo = new CylinderGeometry(0.022, 0.022, 0.42, 5);
  const knob = new SphereGeometry(0.035, 5, 4);
  const aBone = (x: number, z: number, r: number) =>
    group([part(boneGeo, bone), part(knob, bone, [0, 0.21, 0]), part(knob, bone, [0, -0.21, 0])], [x, 0.035, z], [0, r, Math.PI / 2]);
  // A pointed hat, tip flopped over, slumped against the chest.
  const hat = group(
    [
      part(new TorusGeometry(0.2, 0.05, 4, 10), hatCloth, [0, 0, 0], [Math.PI / 2, 0, 0], [1, 1, 0.5]),
      part(new CylinderGeometry(0.1, 0.17, 0.22, 8), hatCloth, [0, 0.11, 0]),
      part(new ConeGeometry(0.1, 0.3, 7), hatCloth, [0.08, 0.3, 0], [0, 0, -0.9]),
      part(new CylinderGeometry(0.175, 0.175, 0.04, 8), std("#b08a48", { metalness: 0.7, roughness: 0.4 }), [0, 0.04, 0]),
    ],
    [-0.6, 0.06, 0.22],
    [0.25, 0.4, 0.35],
  );
  const staff = std("#4a3526", { tex: "bark" });
  return bake(
    group([
      skull,
      aBone(-0.5, 0.48, 0.6),
      aBone(-0.3, -0.48, -0.9),
      aBone(0.52, -0.42, 1.9),
      aBone(0.2, 0.52, 0.2),
      hat,
      // Snapped staff: two halves, one leaning on the chest.
      part(roughen(new CylinderGeometry(0.03, 0.035, 0.7, 5), 0.006, 3), staff, [0.3, 0.28, 0.42], [0.2, 0, 1.1]),
      part(roughen(new CylinderGeometry(0.03, 0.03, 0.5, 5), 0.006, 4), staff, [-0.25, 0.03, 0.6], [0, 0.4, Math.PI / 2]),
    ]),
  );
}

const T = shared(() => ({ body: chestBody(), lid: chestLid(), remains: remains() }));
const seamGeo = shared(() => new BoxGeometry(W - 0.04, 0.03, D - 0.04));
const keyholeGeo = shared(() => new BoxGeometry(0.035, 0.07, 0.01));

function ghostColor(robe: string): Color {
  const c = new Color(robe);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, Math.min(hsl.s, 0.7), Math.max(hsl.l, 0.62));
  return c;
}

export function GraveModel({
  color,
  opened = false,
  motes = false,
  light = false,
  glowRef,
  castShadow = true,
}: GraveModelProps) {
  const root = useRef<Group>(null);
  const lid = useRef<Group>(null);
  // The mount pose, frozen: if it followed `opened`, R3F would snap the lid
  // to the new pose on re-render and the ease below would jump.
  const [k0] = useState(() => (opened ? 1 : 0));
  const open = useRef(k0);
  const moteClock = useRef(0);
  const at = useMemo(() => new Vector3(), []);
  const lightSrc = useRef<DynamicLightSource | null>(null);

  const parts = useMemo(() => {
    const t = T();
    const out = { body: instance(t.body), lid: instance(t.lid), remains: instance(t.remains) };
    for (const o of Object.values(out)) o.traverse((n) => n instanceof Mesh && (n.castShadow = castShadow));
    return out;
  }, [castShadow]);

  const ghost = useMemo(() => ghostColor(color), [color]);
  const ghostHex = useMemo(() => `#${ghost.getHexString()}`, [ghost]);
  const glow = useMemo(
    () =>
      new MeshStandardMaterial({
        color: "#05050a",
        emissive: ghost,
        emissiveIntensity: k0 ? GLOW_OPEN : GLOW_CLOSED,
        toneMapped: false,
      }),
    // k0 is frozen at mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ghost],
  );
  useEffect(() => () => glow.dispose(), [glow]);
  useLayoutEffect(() => {
    assignRef(glowRef, glow);
    return () => assignRef(glowRef, null);
  }, [glowRef, glow]);
  useEffect(() => {
    glow.emissiveIntensity = opened ? GLOW_OPEN : GLOW_CLOSED;
    if (lightSrc.current) lightSrc.current.intensity = opened ? LIGHT_OPEN : LIGHT_CLOSED;
  }, [glow, opened]);

  useEffect(() => {
    if (!light || !root.current) return;
    root.current.updateWorldMatrix(true, false);
    root.current.getWorldPosition(at);
    const src = addLightSource({
      position: [at.x, at.y + 0.9, at.z],
      color: ghostHex,
      intensity: opened ? LIGHT_OPEN : LIGHT_CLOSED,
      distance: 4.5,
      priority: 1,
    });
    lightSrc.current = src;
    return () => {
      removeLightSource(src);
      lightSrc.current = null;
    };
    // `opened` is applied by the effect above; re-registering on it would
    // just churn the pool.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [light, ghostHex, at]);

  useFrame((_, dt) => {
    // Ease the lid; idle once it has arrived.
    const target = opened ? 1 : 0;
    const g = lid.current;
    if (g && open.current !== target) {
      open.current += (target - open.current) * Math.min(1, dt * 4);
      if (Math.abs(target - open.current) < 0.002) open.current = target;
      g.rotation.x = LID_OPEN * open.current;
    }

    if (!motes || !root.current) return;
    moteClock.current -= dt;
    if (moteClock.current > 0) return;
    moteClock.current = 0.16 + Math.random() * 0.14;
    root.current.getWorldPosition(at);
    at.x += (Math.random() - 0.5) * 0.8;
    at.y += 0.7;
    at.z += (Math.random() - 0.5) * 0.4;
    spawnBurst({
      position: at,
      count: 1,
      color: [ghostHex, "#ffffff"],
      speed: 0.25,
      upward: 0.8,
      ttl: 1.8,
      size: 0.05,
      gravity: 0.3,
      drag: 0.7,
      // Wandering soul-light rather than a solid chip.
      style: "soul",
      endColor: ghostHex,
      intensity: 2,
    });
  });

  return (
    <group ref={root} scale={SCALE}>
      <primitive object={parts.body} />
      <primitive object={parts.remains} />
      {/* The chest's mouth: under a closed lid its edges are the glowing
          seam; once open, its top is the dim light you look into. */}
      <mesh geometry={seamGeo()} material={glow} position={[0, H + 0.01, 0]} />
      {/* Lid, hinged at the back edge. */}
      <group ref={lid} position={[0, H + 0.01, -D / 2]} rotation={[LID_OPEN * k0, 0, 0]}>
        <primitive object={parts.lid} />
        {/* Keyhole bleeding the chest's light */}
        <mesh geometry={keyholeGeo()} material={glow} position={[0, -0.03, D + 0.035]} />
      </group>
    </group>
  );
}
