import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import {
  AdditiveBlending,
  BackSide,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  RingGeometry,
  SphereGeometry,
  BoxGeometry,
} from "three";
import { shared } from "./shared";

/** THE wizard body — robe, head, hat, staff with glowing crystal, and
 * optionally boots and a floating amulet gem. One component renders both the
 * remote wizards on shared floors and the live preview in the inventory
 * screen, so "what a wizard looks like" has exactly one definition.
 *
 * The root is a single group on purpose: RemoteWizards bobs `children[0]`
 * of its own group, i.e. this root, for the walk cycle.
 *
 * Geometry is shared across every wizard; materials are per instance (the
 * colors are per wizard). Idle life is cheap and allocation-free: the staff
 * crystal bobs and turns, and an `aura` breathes. */

const robeGeo = shared(() => new ConeGeometry(0.45, 1.5, 8));
const headGeo = shared(() => new SphereGeometry(0.22, 10, 8));
const hatGeo = shared(() => new ConeGeometry(0.32, 0.62, 8));
const brimGeo = shared(() => new CylinderGeometry(0.44, 0.46, 0.035, 10));
const bandGeo = shared(() => new CylinderGeometry(0.285, 0.315, 0.06, 8, 1, true));
// Hem trim hugs the robe's 8-sided cone at its bottom 7 cm (open-ended so
// it's just a band); the sash does the same at the waist.
const hemGeo = shared(() => new CylinderGeometry(0.44, 0.464, 0.07, 8, 1, true));
const sashGeo = shared(() => new CylinderGeometry(0.182, 0.2, 0.06, 8, 1, true));
const gemGeo = shared(() => new OctahedronGeometry(0.06));
const bootGeo = shared(() => new BoxGeometry(0.16, 0.14, 0.3));
const staffGeo = shared(() => new CylinderGeometry(0.03, 0.04, 1.5, 6));
const crystalGeo = shared(() => new OctahedronGeometry(0.09));
const auraRingGeo = shared(() => new RingGeometry(0.52, 0.68, 24));
const auraShellGeo = shared(() => new SphereGeometry(1, 12, 10));

/** Gold thread: robe trim is the robe color pulled toward it. */
const THREAD = new Color("#d9c08a");
const CRYSTAL_Y = 0.85;

export function WizardModel({
  robeColor,
  staffColor,
  bootsColor,
  amuletColor,
  castShadow = false,
  aura = null,
}: {
  robeColor: string;
  staffColor: string;
  /** Omit to render the classic bootless silhouette (remote wizards). */
  bootsColor?: string | null;
  amuletColor?: string | null;
  castShadow?: boolean;
  /** A soft halo in this color (e.g. marking a pact ally). Null/omitted = none. */
  aura?: string | null;
}) {
  const crystal = useRef<Mesh>(null);
  const auraRing = useRef<MeshBasicMaterial>(null);
  const auraShell = useRef<MeshBasicMaterial>(null);
  // Desync idle motion between wizards standing together.
  const phase = useMemo(() => Math.random() * Math.PI * 2, []);
  const trim = useMemo(() => `#${new Color(robeColor).lerp(THREAD, 0.45).getHexString()}`, [robeColor]);
  const hatShade = useMemo(() => `#${new Color(robeColor).multiplyScalar(0.72).getHexString()}`, [robeColor]);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime + phase;
    const c = crystal.current;
    if (c) {
      c.position.y = CRYSTAL_Y + Math.sin(t * 2.1) * 0.03;
      c.rotation.y = t * 1.2;
    }
    if (auraRing.current) auraRing.current.opacity = 0.42 + Math.sin(t * 2.4) * 0.14;
    if (auraShell.current) auraShell.current.opacity = 0.08 + Math.sin(t * 2.4) * 0.03;
  });

  return (
    <group>
      {/* Robe, with a gold-thread hem and sash */}
      <mesh geometry={robeGeo()} position={[0, -0.1, 0]} castShadow={castShadow}>
        <meshStandardMaterial color={robeColor} roughness={0.85} />
      </mesh>
      <mesh geometry={hemGeo()} position={[0, -0.815, 0]}>
        <meshStandardMaterial color={trim} roughness={0.6} metalness={0.3} />
      </mesh>
      <mesh geometry={sashGeo()} position={[0, 0.05, 0]}>
        <meshStandardMaterial color={trim} roughness={0.6} metalness={0.3} />
      </mesh>
      {/* Head */}
      <mesh geometry={headGeo()} position={[0, 0.8, 0]} castShadow={castShadow}>
        <meshStandardMaterial color="#d8b894" roughness={0.8} />
      </mesh>
      {/* Hat: cone, wide brim, a band of trim */}
      <mesh geometry={hatGeo()} position={[0, 1.12, 0]} castShadow={castShadow}>
        <meshStandardMaterial color={robeColor} roughness={0.9} />
      </mesh>
      <mesh geometry={brimGeo()} position={[0, 0.84, 0]} castShadow={castShadow}>
        <meshStandardMaterial color={hatShade} roughness={0.9} />
      </mesh>
      <mesh geometry={bandGeo()} position={[0, 0.89, 0]}>
        <meshStandardMaterial color={trim} roughness={0.6} metalness={0.3} />
      </mesh>
      {/* Amulet: a small gem hovering at the chest */}
      {amuletColor && (
        <mesh geometry={gemGeo()} position={[0, 0.42, 0.33]}>
          <meshStandardMaterial
            color="#0a0a12"
            emissive={amuletColor}
            emissiveIntensity={2.2}
            toneMapped={false}
          />
        </mesh>
      )}
      {/* Boots peeking out under the robe hem */}
      {bootsColor &&
        [-0.16, 0.16].map((x) => (
          <mesh key={x} geometry={bootGeo()} position={[x, -0.82, 0.12]} castShadow={castShadow}>
            <meshStandardMaterial color={bootsColor} roughness={0.8} />
          </mesh>
        ))}
      {/* Staff */}
      <group position={[0.42, 0.1, 0.1]} rotation={[0, 0, -0.12]}>
        <mesh geometry={staffGeo()} castShadow={castShadow}>
          <meshStandardMaterial color="#4a3526" roughness={0.85} />
        </mesh>
        <mesh ref={crystal} geometry={crystalGeo()} position={[0, CRYSTAL_Y, 0]}>
          <meshStandardMaterial
            color="#0a0a12"
            emissive={staffColor}
            emissiveIntensity={2}
            toneMapped={false}
          />
        </mesh>
      </group>
      {/* Aura: a breathing ring at the feet and a faint additive haze. The
          haze is back-faces only, so it glows around the silhouette rather
          than fogging the wizard's front. */}
      {aura && (
        <>
          <mesh geometry={auraRingGeo()} position={[0, -0.83, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <meshBasicMaterial
              ref={auraRing}
              color={aura}
              transparent
              opacity={0.42}
              blending={AdditiveBlending}
              depthWrite={false}
              side={DoubleSide}
              toneMapped={false}
            />
          </mesh>
          <mesh geometry={auraShellGeo()} position={[0, 0.15, 0]} scale={[0.62, 1.15, 0.62]}>
            <meshBasicMaterial
              ref={auraShell}
              color={aura}
              transparent
              opacity={0.08}
              blending={AdditiveBlending}
              depthWrite={false}
              side={BackSide}
              toneMapped={false}
            />
          </mesh>
        </>
      )}
    </group>
  );
}
