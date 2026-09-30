import type { Group, MeshStandardMaterial } from "three";
import { BoxGeometry, ConeGeometry, OctahedronGeometry, TorusGeometry } from "three";
import { bake, MAT } from "./materials";

/** Warding obelisk: a stepped plinth scored with runes, and above it a
 * floating eye-crystal caged by an iron ring — the ward that still keeps
 * watch for masters long dead. */

export interface SentryRig {
  head: Group | null;
  ring: Group | null;
}

const plinthGeo = bake([
  { geo: new BoxGeometry(0.95, 0.28, 0.95), pos: [0, 0.14, 0] },
  { geo: new BoxGeometry(0.66, 0.62, 0.66), pos: [0, 0.59, 0], rot: [0, Math.PI / 4, 0] },
  { geo: new BoxGeometry(0.46, 0.2, 0.46), pos: [0, 1.0, 0] },
  { geo: new ConeGeometry(0.12, 0.3, 4), pos: [0.38, 0.4, 0.38] },
  { geo: new ConeGeometry(0.12, 0.3, 4), pos: [-0.38, 0.4, 0.38] },
  { geo: new ConeGeometry(0.12, 0.3, 4), pos: [0.38, 0.4, -0.38] },
  { geo: new ConeGeometry(0.12, 0.3, 4), pos: [-0.38, 0.4, -0.38] },
]);
/** Rune grooves on the four diagonal faces of the middle block. */
const runeGeo = bake(
  [0, 1, 2, 3].flatMap((i) => {
    const a = (i / 4) * Math.PI * 2;
    const r = 0.335;
    return [
      { geo: new BoxGeometry(0.06, 0.4, 0.02), pos: [Math.sin(a) * r, 0.6, Math.cos(a) * r] as [number, number, number], rot: [0, a, 0] as [number, number, number] },
      { geo: new BoxGeometry(0.22, 0.05, 0.02), pos: [Math.sin(a) * r, 0.68, Math.cos(a) * r] as [number, number, number], rot: [0, a, 0] as [number, number, number] },
    ];
  }),
);
const crystalGeo = bake([{ geo: new OctahedronGeometry(0.3, 0), scale: [0.8, 1.35, 0.8] }]);
const ringGeo = bake([
  { geo: new TorusGeometry(0.5, 0.045, 4, 10), rot: [Math.PI / 2, 0, 0] },
  { geo: new BoxGeometry(0.1, 0.1, 0.1), pos: [0.5, 0, 0] },
  { geo: new BoxGeometry(0.1, 0.1, 0.1), pos: [-0.5, 0, 0] },
  { geo: new BoxGeometry(0.1, 0.1, 0.1), pos: [0, 0, 0.5] },
  { geo: new BoxGeometry(0.1, 0.1, 0.1), pos: [0, 0, -0.5] },
]);

export const SENTRY_HEAD_Y = 1.55;

export function SentryModel({ rig, glow }: { rig: SentryRig; glow: MeshStandardMaterial }) {
  return (
    <group>
      <mesh geometry={plinthGeo} material={MAT.stone} castShadow receiveShadow />
      <mesh geometry={runeGeo} material={glow} />
      <group position={[0, SENTRY_HEAD_Y, 0]}>
        <group ref={(g) => void (rig.head = g)}>
          <mesh geometry={crystalGeo} material={glow} castShadow />
        </group>
        <group ref={(g) => void (rig.ring = g)}>
          <mesh geometry={ringGeo} material={MAT.iron} />
        </group>
      </group>
    </group>
  );
}
