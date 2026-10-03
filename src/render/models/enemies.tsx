import type { Ref } from "react";
import {
  BoxGeometry,
  IcosahedronGeometry,
  MeshStandardMaterial,
  OctahedronGeometry,
  SphereGeometry,
  type Group,
  type Mesh,
} from "three";

/** What every enemy looks like — pure presentation, no behaviour. Each model
 * renders the meshes that sit inside the enemy's rigid body and hands back,
 * through refs, exactly the handles its behaviour animates: the emissive
 * "flash" material (hit flashes, charge glows, the shadow's lunge opacity),
 * the slime's squash mesh, the sentry's tracking head, the Warden's spinning
 * shell. The component in enemies/kinds/ owns the body, the brain and the
 * per-frame writes; this file owns shapes and colours.
 *
 * Sharing: enemies mount and die constantly (and slimes multiply), so every
 * geometry is built once at module scope, as are the materials that never
 * animate (eyes, cores, stone). R3F only disposes objects it created itself,
 * so passing these as props is safe across unmounts. Flash materials stay
 * per-instance — one wisp's hit flash must not light up all of them. */

/** Resting emissive intensity of each flash material — the base the kind
 * components animate from (base + flash × gain + …). */
export const ENEMY_GLOW = {
  wisp: 1.7,
  sentry: 1.4,
  shadow: 0.8,
  slime: 0.9,
  warden: 1.3,
} as const;

/** The shadow is mostly murk; it solidifies while lunging. */
export const SHADOW_OPACITY = { lurking: 0.55, lunging: 0.95 } as const;

/** The Warden's signature red — also its light, bursts and bolts. */
export const WARDEN_COLOR = "#ff3d2e";

// ── Shared geometry ──────────────────────────────────────────────────────────
const wispBody = new IcosahedronGeometry(0.42, 0);
const wispCore = new SphereGeometry(0.14, 8, 8);
const sentryPlinth = new BoxGeometry(0.8, 0.9, 0.8);
const sentryHead = new OctahedronGeometry(0.34);
const shadowBody = new IcosahedronGeometry(0.5, 0);
const shadowEye = new SphereGeometry(0.05, 6, 6);
const slimeBody = new IcosahedronGeometry(0.5, 1);
/** Generation-0 eye; smaller slimes scale the mesh rather than rebuild it. */
const slimeEye = new SphereGeometry(0.06, 6, 6);
const wardenBody = new IcosahedronGeometry(1.15, 1);
const wardenShard = new OctahedronGeometry(0.22);
const wardenCore = new SphereGeometry(0.42, 10, 10);

// ── Shared static materials ──────────────────────────────────────────────────
/** A self-lit accent (eye, core, shard): dark base, bright unclamped emissive
 * so bloom picks it up. */
function glowMaterial(color: string, emissive: string, emissiveIntensity: number) {
  return new MeshStandardMaterial({ color, emissive, emissiveIntensity, toneMapped: false });
}

const wispCoreMat = glowMaterial("#000", "#f0dcff", 4);
const sentryPlinthMat = new MeshStandardMaterial({ color: "#3a3442", roughness: 0.9 });
const shadowEyeMat = glowMaterial("#000", "#c89cff", 3);
const slimeEyeMat = glowMaterial("#04140a", "#d4ffb0", 2);
const wardenShardMat = glowMaterial("#0c0402", "#ff8b3d", 2.4);
const wardenCoreMat = glowMaterial("#000", "#ffd0b0", 3.4);

/** Paired eyes sit symmetrically about the face. */
const SHADOW_EYE_X = [0.13, -0.13] as const;
const SLIME_EYE_X = [0.16, -0.16] as const;

/** The Warden's three orbiting shards, evenly spaced and staggered in height. */
const WARDEN_SHARDS = [0, 1, 2].map(
  (i) =>
    [
      Math.cos((i / 3) * Math.PI * 2) * 1.7,
      Math.sin(i * 2.1) * 0.4,
      Math.sin((i / 3) * Math.PI * 2) * 1.7,
    ] as const,
);

type MaterialRef = Ref<MeshStandardMaterial>;

/** Wisp — a faceted violet mote around a white-hot core. */
export function WispModel({ materialRef }: { materialRef?: MaterialRef }) {
  return (
    <>
      <mesh geometry={wispBody} castShadow>
        <meshStandardMaterial
          ref={materialRef}
          color="#160d26"
          emissive="#b46bff"
          emissiveIntensity={ENEMY_GLOW.wisp}
          flatShading
          roughness={0.4}
        />
      </mesh>
      <mesh geometry={wispCore} material={wispCoreMat} />
    </>
  );
}

/** Sentry — a stone plinth under a burning crystal head. `headRef` turns to
 * track; the crystal's material flashes and winds up before each shot. */
export function SentryModel({
  headRef,
  materialRef,
}: {
  headRef?: Ref<Group>;
  materialRef?: MaterialRef;
}) {
  return (
    <>
      <mesh geometry={sentryPlinth} material={sentryPlinthMat} position={[0, 0.45, 0]} castShadow />
      <group ref={headRef} position={[0, 1.05, 0]}>
        <mesh geometry={sentryHead} castShadow>
          <meshStandardMaterial
            ref={materialRef}
            color="#1c0c08"
            emissive="#ff5136"
            emissiveIntensity={ENEMY_GLOW.sentry}
            flatShading
            roughness={0.3}
          />
        </mesh>
      </group>
    </>
  );
}

/** Shadow — translucent murk with two faint eyes peering out of it. Its
 * material's opacity is animated (it solidifies to strike). */
export function ShadowModel({ materialRef }: { materialRef?: MaterialRef }) {
  return (
    <>
      <mesh geometry={shadowBody} castShadow>
        <meshStandardMaterial
          ref={materialRef}
          color="#0a0616"
          emissive="#5a2d8a"
          emissiveIntensity={ENEMY_GLOW.shadow}
          flatShading
          roughness={0.6}
          transparent
          opacity={SHADOW_OPACITY.lurking}
        />
      </mesh>
      {SHADOW_EYE_X.map((x) => (
        <mesh key={x} geometry={shadowEye} material={shadowEyeMat} position={[x, 0.06, 0.34]} />
      ))}
    </>
  );
}

/** Slime — a jelly blob with two beady eyes, drawn at `size` (its split
 * generation's scale). `meshRef` is the body, which the component squashes
 * and stretches each frame (the eyes stay put — they read as floating in it). */
export function SlimeModel({
  size,
  meshRef,
  materialRef,
}: {
  size: number;
  meshRef?: Ref<Mesh>;
  materialRef?: MaterialRef;
}) {
  return (
    <>
      <mesh ref={meshRef} geometry={slimeBody} castShadow scale={size}>
        <meshStandardMaterial
          ref={materialRef}
          color="#1f3a1a"
          emissive="#7fdc4a"
          emissiveIntensity={ENEMY_GLOW.slime}
          transparent
          opacity={0.85}
          roughness={0.5}
          flatShading
        />
      </mesh>
      {SLIME_EYE_X.map((x) => (
        <mesh
          key={x}
          geometry={slimeEye}
          material={slimeEyeMat}
          position={[x * size, 0.1 * size, 0.34 * size]}
          scale={size}
        />
      ))}
    </>
  );
}

/** Warden of the Deep — a smouldering armoured shell ringed by three ember
 * shards around a blazing core. `shellRef` (shell + shards) spins; the core
 * stays still at the centre. */
export function WardenModel({
  shellRef,
  materialRef,
}: {
  shellRef?: Ref<Group>;
  materialRef?: MaterialRef;
}) {
  return (
    <>
      <group ref={shellRef}>
        <mesh geometry={wardenBody} castShadow>
          <meshStandardMaterial
            ref={materialRef}
            color="#1c0806"
            emissive={WARDEN_COLOR}
            emissiveIntensity={ENEMY_GLOW.warden}
            flatShading
            roughness={0.35}
            metalness={0.3}
          />
        </mesh>
        {WARDEN_SHARDS.map((position, i) => (
          <mesh key={i} geometry={wardenShard} material={wardenShardMat} position={position} />
        ))}
      </group>
      <mesh geometry={wardenCore} material={wardenCoreMat} />
    </>
  );
}
