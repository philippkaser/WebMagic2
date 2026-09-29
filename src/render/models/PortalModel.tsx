import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type Ref } from "react";
import {
  BoxGeometry,
  CircleGeometry,
  DoubleSide,
  Group,
  MeshStandardMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  TorusGeometry,
  type BufferGeometry,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { SEAL_GLYPHS, getSealGlyphAtlas } from "../textures";
import { shared, surfaceMaterial } from "./shared";

/** The portal: stone steps, a dark metal ring and a glowing disc. Origin is
 * the ground at the portal's centre; the ring stands at PORTAL_RING_Y.
 *
 * Behaviour (world/props.tsx Portal) owns the pooled light, sparks and the
 * interaction prompt, and animates the model through two refs: `discRef`
 * (disc brightness) and `ringRef` (the ring+disc group it spins on Z).
 *
 * `locked` reads as SEALED BY RUNES: while set, a ring of carved glyph
 * plates slowly counter-rotates over the (behaviour-dimmed) disc, bound by
 * a thin circle, with motes orbiting outside the ring — "this opens, just
 * not yet". Used for the way-home portal before the floor lets you leave,
 * and for exits sealed while a boss lives. The seal only mounts while
 * locked, so an open portal pays nothing for it. */

/** Height of the ring's centre above the portal origin. */
export const PORTAL_RING_Y = 1.5;

const stepGeo = shared(() => new BoxGeometry(3.4, 0.24, 1.6));
const stepMat = shared(() =>
  surfaceMaterial("slab", { roughness: 0.85, metalness: 0.05, envMapIntensity: 0.5 }),
);
const ringGeo = shared(() => new TorusGeometry(1.15, 0.13, 8, 24));
const ringMat = shared(
  () => new MeshStandardMaterial({ color: "#2c2836", metalness: 0.6, roughness: 0.35 }),
);
const discGeo = shared(() => new CircleGeometry(1.05, 24));

// ── The seal ─────────────────────────────────────────────────────────────────

const SEAL_RADIUS = 0.74;
const PLATE = 0.26;
const MOTES = 6;

/** Every glyph plate, both faces of the disc, merged into ONE geometry (one
 * draw call). Each plate's UVs are remapped onto its own atlas slot, and
 * plates are turned so each glyph's "up" points away from the centre. */
const sealPlatesGeo = shared(() => {
  const parts: BufferGeometry[] = [];
  for (const side of [1, -1]) {
    for (let k = 0; k < SEAL_GLYPHS; k++) {
      const g = new PlaneGeometry(PLATE, PLATE);
      const uv = g.getAttribute("uv");
      for (let i = 0; i < uv.count; i++) uv.setX(i, (k + uv.getX(i)) / SEAL_GLYPHS);
      // Back-face plates sit half a slot round so the two faces interleave.
      const a = ((k + (side < 0 ? 0.5 : 0)) / SEAL_GLYPHS) * Math.PI * 2;
      // Flip back plates to face −Z FIRST, so the Z turn still points their
      // glyph's up (+Y) outward and they read unmirrored from behind.
      if (side < 0) g.rotateY(Math.PI);
      g.rotateZ(a - Math.PI / 2);
      g.translate(Math.cos(a) * SEAL_RADIUS, Math.sin(a) * SEAL_RADIUS, 0.05 * side);
      parts.push(g);
    }
  }
  const merged = mergeGeometries(parts);
  for (const g of parts) g.dispose();
  return merged;
});

const bindingGeo = shared(() => new TorusGeometry(SEAL_RADIUS - 0.2, 0.012, 4, 48));

const motesGeo = shared(() => {
  const parts: BufferGeometry[] = [];
  for (let k = 0; k < MOTES; k++) {
    const a = (k / MOTES) * Math.PI * 2;
    const g = new OctahedronGeometry(0.05);
    g.translate(Math.cos(a) * 1.38, Math.sin(a) * 1.38, k % 2 ? 0.06 : -0.06);
    parts.push(g);
  }
  const merged = mergeGeometries(parts);
  for (const g of parts) g.dispose();
  return merged;
});

function PortalSeal({ color }: { color: string }) {
  const plates = useRef<Group>(null);
  const motes = useRef<Group>(null);
  const mats = useMemo(() => {
    const atlas = getSealGlyphAtlas();
    return {
      glyph: new MeshStandardMaterial({
        color: "#000000",
        emissive: color,
        emissiveIntensity: 1.8,
        emissiveMap: atlas,
        alphaMap: atlas,
        // Hard cut, no blending: crisp pixel glyphs and no sort order issues
        // against the transparent disc.
        alphaTest: 0.5,
        toneMapped: false,
      }),
      mote: new MeshStandardMaterial({
        color: "#000000",
        emissive: color,
        emissiveIntensity: 2.2,
        toneMapped: false,
      }),
    };
  }, [color]);
  useEffect(
    () => () => {
      mats.glyph.dispose();
      mats.mote.dispose();
    },
    [mats],
  );

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (plates.current) {
      plates.current.rotation.z = -t * 0.22;
      plates.current.scale.setScalar(1 + Math.sin(t * 0.9) * 0.025);
    }
    if (motes.current) motes.current.rotation.z = t * 0.45;
    mats.glyph.emissiveIntensity = 1.7 + Math.sin(t * 1.9) * 0.5;
  });

  return (
    <group position={[0, PORTAL_RING_Y, 0]}>
      <group ref={plates}>
        <mesh geometry={sealPlatesGeo()} material={mats.glyph} />
        <mesh geometry={bindingGeo()} material={mats.mote} />
      </group>
      <group ref={motes}>
        <mesh geometry={motesGeo()} material={mats.mote} />
      </group>
    </group>
  );
}

export function PortalModel({
  color,
  locked = false,
  sealColor,
  discRef,
  ringRef,
}: {
  /** Disc glow (and, by default, the seal's rune color). */
  color: string;
  /** Show the rune seal. Behaviour separately dims the disc via discRef. */
  locked?: boolean;
  /** Seal rune color, if it should differ from the disc. */
  sealColor?: string;
  discRef?: Ref<MeshStandardMaterial>;
  ringRef?: Ref<Group>;
}) {
  return (
    <group>
      {/* Steps */}
      <mesh geometry={stepGeo()} material={stepMat()} position={[0, 0.12, 0]} receiveShadow />
      <group ref={ringRef} position={[0, PORTAL_RING_Y, 0]}>
        <mesh geometry={ringGeo()} material={ringMat()} castShadow />
        <mesh geometry={discGeo()}>
          <meshStandardMaterial
            ref={discRef}
            color="#05030a"
            emissive={color}
            emissiveIntensity={1.9}
            toneMapped={false}
            transparent
            opacity={0.92}
            side={DoubleSide}
          />
        </mesh>
      </group>
      {locked && <PortalSeal color={sealColor ?? color} />}
    </group>
  );
}
