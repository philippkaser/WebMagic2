import type { Ref, RefObject } from "react";
import {
  BoxGeometry,
  Color,
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

/** Each flash material's own emissive hue (what a hit flash fades back to). */
export const ENEMY_HUE = {
  wisp: "#b46bff",
  sentry: "#ff5136",
  shadow: "#5a2d8a",
  slime: "#7fdc4a",
  warden: WARDEN_COLOR,
} as const;

const HUE_COLOR = {
  wisp: new Color(ENEMY_HUE.wisp),
  sentry: new Color(ENEMY_HUE.sentry),
  shadow: new Color(ENEMY_HUE.shadow),
  slime: new Color(ENEMY_HUE.slime),
  warden: new Color(ENEMY_HUE.warden),
} as const;

const WHITE = new Color(1, 1, 1);

/** The hit flash, the pixel-art way: on the frames a blow lands the body
 * blanches pure white (`white`, stepped 1 → ½ → 0), then shows its own hue
 * flaring (`flash`, fading) before settling back to its resting `glow`. One
 * Color copy per call, no allocation. */
export function hitFlash(
  mat: MeshStandardMaterial,
  hue: keyof typeof HUE_COLOR,
  glow: number,
  flash: number,
  white: number,
  gain = 6,
): void {
  mat.emissive.copy(HUE_COLOR[hue]);
  if (white > 0) mat.emissive.lerp(WHITE, white);
  mat.emissiveIntensity = glow + flash * gain + white * 4;
}

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

/** Resting brightness of the accents (eyes flare and dim from these). */
export const ACCENT_GLOW = { wispCore: 4, shadowEye: 3, slimeEye: 2, wardenShard: 2.4, wardenCore: 3.4 } as const;

/** Every part's material, as parameters — so a living body's JSX material
 * and a corpse's own copy (makeEnemyMaterial) are the same stuff. */
const PARTS = {
  wispBody: { color: "#160d26", emissive: ENEMY_HUE.wisp, emissiveIntensity: ENEMY_GLOW.wisp, flatShading: true, roughness: 0.4 },
  sentryCrystal: { color: "#1c0c08", emissive: ENEMY_HUE.sentry, emissiveIntensity: ENEMY_GLOW.sentry, flatShading: true, roughness: 0.3 },
  shadowBody: {
    color: "#0a0616",
    emissive: ENEMY_HUE.shadow,
    emissiveIntensity: ENEMY_GLOW.shadow,
    flatShading: true,
    roughness: 0.6,
    transparent: true,
    opacity: SHADOW_OPACITY.lurking,
  },
  slimeBody: {
    color: "#1f3a1a",
    emissive: ENEMY_HUE.slime,
    emissiveIntensity: ENEMY_GLOW.slime,
    transparent: true,
    opacity: 0.85,
    roughness: 0.5,
    flatShading: true,
  },
  wardenBody: {
    color: "#1c0806",
    emissive: WARDEN_COLOR,
    emissiveIntensity: ENEMY_GLOW.warden,
    flatShading: true,
    roughness: 0.35,
    metalness: 0.3,
  },
} as const;

export type EnemyPart =
  | keyof typeof PARTS
  | "wispCore"
  | "sentryPlinth"
  | "shadowEye"
  | "slimeEye"
  | "wardenShard"
  | "wardenCore";

/** A fresh, owned copy of a part's material (the caller disposes it): a
 * corpse's, or a living body's own eyes so they can flare and dim alone. */
export function makeEnemyMaterial(part: EnemyPart): MeshStandardMaterial {
  switch (part) {
    case "wispCore":
      return wispCoreMat.clone();
    case "sentryPlinth":
      return sentryPlinthMat.clone();
    case "shadowEye":
      return shadowEyeMat.clone();
    case "slimeEye":
      return slimeEyeMat.clone();
    case "wardenShard":
      return wardenShardMat.clone();
    case "wardenCore":
      return wardenCoreMat.clone();
    default:
      return new MeshStandardMaterial({ ...PARTS[part] });
  }
}

/** Paired eyes sit symmetrically about the face. */
const SHADOW_EYE_X = [0.13, -0.13] as const;
const SLIME_EYE_X = [0.16, -0.16] as const;

/** The Warden's three orbiting shards, evenly spaced and staggered in height. */
export const WARDEN_SHARDS = [0, 1, 2].map(
  (i) =>
    [
      Math.cos((i / 3) * Math.PI * 2) * 1.7,
      Math.sin(i * 2.1) * 0.4,
      Math.sin((i / 3) * Math.PI * 2) * 1.7,
    ] as const,
);

type MaterialRef = Ref<MeshStandardMaterial>;

/** The flash material as JSX (living bodies), or a given material (corpses). */
function Flash({ part, materialRef, material }: { part: keyof typeof PARTS; materialRef?: MaterialRef; material?: MeshStandardMaterial }) {
  if (material) return <primitive object={material} attach="material" />;
  return <meshStandardMaterial ref={materialRef} {...PARTS[part]} />;
}

/** Wisp — a faceted violet mote around a white-hot core. */
export function WispModel({
  materialRef,
  material,
  coreMaterial,
}: {
  materialRef?: MaterialRef;
  material?: MeshStandardMaterial;
  coreMaterial?: MeshStandardMaterial;
}) {
  return (
    <>
      <mesh geometry={wispBody} castShadow>
        <Flash part="wispBody" materialRef={materialRef} material={material} />
      </mesh>
      <mesh geometry={wispCore} material={coreMaterial ?? wispCoreMat} />
    </>
  );
}

/** Sentry — a stone plinth under a burning crystal head. `headRef` turns to
 * track; the crystal's material flashes and winds up before each shot. */
export function SentryModel({
  headRef,
  materialRef,
  material,
  plinthRef,
  plinthMaterial,
}: {
  headRef?: Ref<Group>;
  materialRef?: MaterialRef;
  material?: MeshStandardMaterial;
  plinthRef?: Ref<Mesh>;
  plinthMaterial?: MeshStandardMaterial;
}) {
  return (
    <>
      <mesh
        ref={plinthRef}
        geometry={sentryPlinth}
        material={plinthMaterial ?? sentryPlinthMat}
        position={[0, 0.45, 0]}
        castShadow
      />
      <group ref={headRef} position={[0, 1.05, 0]}>
        <mesh geometry={sentryHead} castShadow>
          <Flash part="sentryCrystal" materialRef={materialRef} material={material} />
        </mesh>
      </group>
    </>
  );
}

/** Shadow — translucent murk with two faint eyes peering out of it. Its
 * material's opacity is animated (it solidifies to strike); `eyeMaterial`
 * lets its eyes flare on their own, `eyesRef` move apart from the body
 * (they linger when it unravels). */
export function ShadowModel({
  materialRef,
  material,
  eyeMaterial,
  bodyRef,
  eyesRef,
}: {
  materialRef?: MaterialRef;
  material?: MeshStandardMaterial;
  eyeMaterial?: MeshStandardMaterial;
  bodyRef?: Ref<Mesh>;
  eyesRef?: Ref<Group>;
}) {
  return (
    <>
      <mesh ref={bodyRef} geometry={shadowBody} castShadow>
        <Flash part="shadowBody" materialRef={materialRef} material={material} />
      </mesh>
      <group ref={eyesRef}>
        {SHADOW_EYE_X.map((x) => (
          <mesh key={x} geometry={shadowEye} material={eyeMaterial ?? shadowEyeMat} position={[x, 0.06, 0.34]} />
        ))}
      </group>
    </>
  );
}

/** Slime — a jelly blob with two beady eyes, drawn at `size` (its split
 * generation's scale). The living body's puppet squashes the whole view. */
export function SlimeModel({
  size,
  meshRef,
  materialRef,
  material,
  eyeMaterial,
}: {
  size: number;
  meshRef?: Ref<Mesh>;
  materialRef?: MaterialRef;
  material?: MeshStandardMaterial;
  eyeMaterial?: MeshStandardMaterial;
}) {
  return (
    <>
      <mesh ref={meshRef} geometry={slimeBody} castShadow scale={size}>
        <Flash part="slimeBody" materialRef={materialRef} material={material} />
      </mesh>
      {SLIME_EYE_X.map((x) => (
        <mesh
          key={x}
          geometry={slimeEye}
          material={eyeMaterial ?? slimeEyeMat}
          position={[x * size, 0.1 * size, 0.34 * size]}
          scale={size}
        />
      ))}
    </>
  );
}

/** Warden of the Deep — a smouldering armoured shell ringed by three ember
 * shards around a blazing core. `shellRef` (shell + shards) spins; the core
 * stays still at the centre. `shardRefs` lets the shards fold in before a
 * charge (and fly off when it dies). */
export function WardenModel({
  shellRef,
  materialRef,
  material,
  shardRefs,
  shardMaterial,
  coreMaterial,
}: {
  shellRef?: Ref<Group>;
  materialRef?: MaterialRef;
  material?: MeshStandardMaterial;
  shardRefs?: RefObject<(Mesh | null)[]>;
  shardMaterial?: MeshStandardMaterial;
  coreMaterial?: MeshStandardMaterial;
}) {
  return (
    <>
      <group ref={shellRef}>
        <mesh geometry={wardenBody} castShadow>
          <Flash part="wardenBody" materialRef={materialRef} material={material} />
        </mesh>
        {WARDEN_SHARDS.map((position, i) => (
          <mesh
            key={i}
            ref={(m) => {
              if (shardRefs?.current) shardRefs.current[i] = m;
            }}
            geometry={wardenShard}
            material={shardMaterial ?? wardenShardMat}
            position={position}
          />
        ))}
      </group>
      <mesh geometry={wardenCore} material={coreMaterial ?? wardenCoreMat} />
    </>
  );
}
