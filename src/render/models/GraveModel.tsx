import { useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type Ref } from "react";
import { BoxGeometry, Color, ConeGeometry, Group, MeshStandardMaterial, Vector3 } from "three";
import {
  addLightSource,
  removeLightSource,
  type DynamicLightSource,
} from "../../fx/DynamicLights";
import { spawnBurst } from "../../fx/Particles";
import { assignRef, shared, surfaceMaterial } from "./shared";

/** A fallen wizard's grave: a small stone sarcophagus on a plinth, its lid
 * carved with a wizard's hat, light leaking from the seam in the color of
 * the robe its owner died in. Origin = ground at its centre; long axis
 * along X, the hat's brim end at −X.
 *
 * `opened` slides the lid ajar and lets the glow gutter down to a dim light
 * in the grave's mouth — the dungeon has already been through it. The lid
 * eases between poses, and mounts already in its current pose (a late
 * joiner sees an opened grave open, not opening).
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

const GLOW_CLOSED = 1.4;
const GLOW_OPEN = 0.3;
const LIGHT_CLOSED = 1.8;
const LIGHT_OPEN = 0.5;

/** Lid pose when fully ajar (lerped from the closed pose by `open`). */
const AJAR = { x: 0.4, z: 0.08, yaw: 0.32, tilt: -0.1 };

const plinthGeo = shared(() => new BoxGeometry(1.44, 0.08, 0.84));
const bodyGeo = shared(() => new BoxGeometry(1.3, 0.52, 0.7));
const mouthGeo = shared(() => new BoxGeometry(1.2, 0.03, 0.6));
const lidGeo = shared(() => new BoxGeometry(1.38, 0.1, 0.78));
const ridgeGeo = shared(() => new BoxGeometry(1.3, 0.06, 0.4));
const hatGeo = shared(() => new ConeGeometry(0.13, 0.36, 4));
const brimGeo = shared(() => new BoxGeometry(0.04, 0.03, 0.34));
/** Pale carved stone — lifted above the floor slabs so the grave reads as a
 * made thing, not more floor. (Linear color > 1 brightens the map.) */
const stoneMat = shared(() =>
  surfaceMaterial("slab", {
    color: new Color(1.45, 1.4, 1.55),
    roughness: 0.85,
    metalness: 0.05,
    envMapIntensity: 0.5,
  }),
);

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

  const ghost = useMemo(() => ghostColor(color), [color]);
  const ghostHex = useMemo(() => `#${ghost.getHexString()}`, [ghost]);
  const glow = useMemo(
    () =>
      new MeshStandardMaterial({
        color: "#05050a",
        emissive: ghost,
        emissiveIntensity: GLOW_CLOSED,
        toneMapped: false,
      }),
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
  }, [light, ghostHex, at]);

  useFrame((_, dt) => {
    // Ease the lid; idle once it has arrived.
    const target = opened ? 1 : 0;
    const g = lid.current;
    if (g && open.current !== target) {
      open.current += (target - open.current) * Math.min(1, dt * 4);
      if (Math.abs(target - open.current) < 0.002) open.current = target;
      const k = open.current;
      g.position.x = AJAR.x * k;
      g.position.z = AJAR.z * k;
      g.rotation.y = AJAR.yaw * k;
      g.rotation.z = AJAR.tilt * k;
    }

    if (!motes || !root.current) return;
    moteClock.current -= dt;
    if (moteClock.current > 0) return;
    moteClock.current = 0.16 + Math.random() * 0.14;
    root.current.getWorldPosition(at);
    at.x += (Math.random() - 0.5) * 1.0;
    at.y += 0.7;
    at.z += (Math.random() - 0.5) * 0.5;
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
    });
  });

  return (
    <group ref={root}>
      <mesh geometry={plinthGeo()} material={stoneMat()} position={[0, 0.04, 0]} receiveShadow />
      <mesh
        geometry={bodyGeo()}
        material={stoneMat()}
        position={[0, 0.34, 0]}
        castShadow={castShadow}
        receiveShadow
      />
      {/* The grave's mouth: its edges are the glowing seam under a closed
          lid; its top is the dim glow you look into once it's open. */}
      <mesh geometry={mouthGeo()} material={glow} position={[0, 0.6, 0]} />
      <group
        ref={lid}
        position={[AJAR.x * k0, 0.625, AJAR.z * k0]}
        rotation={[0, AJAR.yaw * k0, AJAR.tilt * k0]}
      >
        <mesh geometry={lidGeo()} material={stoneMat()} position={[0, 0.05, 0]} castShadow={castShadow} receiveShadow />
        <mesh geometry={ridgeGeo()} material={stoneMat()} position={[0, 0.13, 0]} castShadow={castShadow} />
        {/* Carved hat relief, point toward +X, flattened onto the ridge. */}
        <mesh
          geometry={hatGeo()}
          material={glow}
          position={[0.02, 0.175, 0]}
          rotation={[0, 0, -Math.PI / 2]}
          scale={[0.35, 1, 1]}
        />
        <mesh geometry={brimGeo()} material={glow} position={[-0.17, 0.175, 0]} />
      </group>
    </group>
  );
}
