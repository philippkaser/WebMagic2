import type { Group, MeshStandardMaterial } from "three";
import { BoxGeometry, ConeGeometry, TorusGeometry } from "three";
import { bake, MAT } from "./materials";

/** Bone skitter: a skull riding a ribcage on six splintered legs — what the
 * catacombs build from the ones who didn't make it out. Origin = the body's
 * center, ~0.35 above the floor (feet reach y = -0.35). */

export interface SkitterRig {
  /** Pitches/crouches as a whole. */
  body: Group | null;
  jaw: Group | null;
  legs: (Group | null)[];
}

type V3 = [number, number, number];

/** A box spanning a→b in the XY plane (legs bend in their own plane). */
function segment(a: V3, b: V3, thick: number) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  return {
    geo: new BoxGeometry(len, thick, thick),
    pos: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2] as V3,
    rot: [0, 0, Math.atan2(dy, dx)] as V3,
  };
}

const HIP: V3 = [0, 0, 0];
const KNEE: V3 = [0.3, 0.22, 0];
const FOOT: V3 = [0.52, -0.35, 0];
/** One leg pointing +X; left legs are the same group turned half around. */
const legGeo = bake([
  segment(HIP, KNEE, 0.06),
  segment(KNEE, FOOT, 0.05),
  { geo: new ConeGeometry(0.04, 0.12, 4), pos: [0.54, -0.38, 0], rot: [0, 0, Math.PI] },
]);

const ribsGeo = bake([
  { geo: new BoxGeometry(0.09, 0.09, 0.72), pos: [0, 0.1, -0.02] },
  ...[0.2, 0.05, -0.1, -0.25].map((z, i) => ({
    geo: new TorusGeometry(0.19 - i * 0.02, 0.028, 3, 6, Math.PI),
    pos: [0, 0.07, z] as V3,
    rot: [0, 0, Math.PI] as V3,
  })),
  { geo: new BoxGeometry(0.26, 0.1, 0.14), pos: [0, 0.02, -0.34] },
  { geo: new BoxGeometry(0.06, 0.06, 0.2), pos: [0, 0.12, -0.5], rot: [0.5, 0, 0] },
  { geo: new BoxGeometry(0.05, 0.05, 0.16), pos: [0, 0.2, -0.62], rot: [0.9, 0, 0] },
]);
const skullGeo = bake([
  { geo: new BoxGeometry(0.34, 0.26, 0.32), pos: [0, 0.08, 0] },
  { geo: new BoxGeometry(0.28, 0.1, 0.1), pos: [0, -0.02, 0.15] },
  { geo: new ConeGeometry(0.035, 0.18, 4), pos: [0.12, -0.08, 0.2], rot: [-2.3, 0, 0] },
  { geo: new ConeGeometry(0.035, 0.18, 4), pos: [-0.12, -0.08, 0.2], rot: [-2.3, 0, 0] },
]);
const socketGeo = bake([
  { geo: new BoxGeometry(0.09, 0.07, 0.04), pos: [-0.075, 0.1, 0.16] },
  { geo: new BoxGeometry(0.09, 0.07, 0.04), pos: [0.075, 0.1, 0.16] },
]);
const jawGeo = bake([
  { geo: new BoxGeometry(0.26, 0.06, 0.26), pos: [0, 0, 0.13] },
  { geo: new ConeGeometry(0.025, 0.08, 4), pos: [0.08, 0.05, 0.24] },
  { geo: new ConeGeometry(0.025, 0.08, 4), pos: [-0.08, 0.05, 0.24] },
]);

/** Hip spots along the ribcage (z) — three per side — and how far each
 * pair fans forward/back. */
const HIPS = [0.18, 0, -0.18];
const FAN = [0.6, 0, -0.6];

export function SkitterModel({ rig, glow }: { rig: SkitterRig; glow: MeshStandardMaterial }) {
  return (
    <group ref={(g) => void (rig.body = g)}>
      <mesh geometry={ribsGeo} material={MAT.boneDark} castShadow />
      <group position={[0, 0.06, 0.4]}>
        <mesh geometry={skullGeo} material={MAT.bone} castShadow />
        <mesh geometry={socketGeo} material={glow} />
        <group ref={(g) => void (rig.jaw = g)} position={[0, -0.07, -0.04]}>
          <mesh geometry={jawGeo} material={MAT.bone} />
        </group>
      </group>
      {[0, 1].flatMap((side) =>
        HIPS.map((z, i) => {
          const idx = side * 3 + i;
          const yaw = side ? Math.PI + FAN[i] : -FAN[i];
          return (
            <group key={idx} position={[side ? -0.1 : 0.1, 0.02, z]} rotation={[0, yaw, 0]}>
              <group ref={(g) => void (rig.legs[idx] = g)}>
                <mesh geometry={legGeo} material={MAT.bone} castShadow />
              </group>
            </group>
          );
        }),
      )}
    </group>
  );
}
