import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { BoxGeometry, ConeGeometry, CylinderGeometry, Group, MeshStandardMaterial, Object3D } from "three";
import { useArena } from "../../arena/arenaStore";
import { bake, glow, group, part, roughen, std } from "./modelKit";

/** The obelisk to the Proving Ground, in the artpass model family: a tall
 * four-sided needle of dark runestone on a stepped plinth, its faces cut
 * with ember-gold glyphs, a brazier either side. Origin on the ground; it
 * faces +z. The glyphs burn brighter while you wait in Varr's line. Pure
 * presentation: world/villageProps Obelisk owns the prompt and the light. */

/** Where the braziers' fires burn (obelisk-local), for the shell's lights. */
export const OBELISK_BRAZIERS: [number, number, number][] = [
  [-1.05, 0.95, 0.35],
  [1.05, 0.95, 0.35],
];

function stone(): Group {
  const rock = std("#2a2430", { tex: "runestone", roughness: 0.82 });
  const dark = std("#1c1820", { tex: "runestone", roughness: 0.9 });
  const iron = std("#2e2c34", { tex: "iron", metalness: 0.75, roughness: 0.42 });
  const parts: Object3D[] = [];
  // Stepped plinth.
  parts.push(part(roughen(new BoxGeometry(1.7, 0.22, 1.7), 0.015, 2), dark, [0, 0.11, 0]));
  parts.push(part(roughen(new BoxGeometry(1.3, 0.2, 1.3), 0.015, 3), rock, [0, 0.32, 0]));
  // The needle: a tapering four-sided shaft and its pyramidion.
  const shaft = roughen(new CylinderGeometry(0.28, 0.42, 3.6, 4, 6), 0.012, 5).rotateY(Math.PI / 4);
  parts.push(part(shaft, rock, [0, 2.22, 0]));
  parts.push(part(new ConeGeometry(0.29, 0.5, 4).rotateY(Math.PI / 4), dark, [0, 4.27, 0]));
  // Braziers: an iron bowl on three legs either side.
  for (const [x, y, z] of OBELISK_BRAZIERS) {
    parts.push(part(new CylinderGeometry(0.26, 0.14, 0.18, 8), iron, [x, y, z]));
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      parts.push(part(new CylinderGeometry(0.025, 0.03, 0.9, 5), iron, [x + Math.cos(a) * 0.14, 0.45, z + Math.sin(a) * 0.14], [Math.sin(a) * 0.18, 0, -Math.cos(a) * 0.18]));
    }
  }
  return bake(group(parts));
}

/** The glyphs down each face and the braziers' coals (one glowing
 * material, so the shell can make them burn brighter). */
function glyphs(material: MeshStandardMaterial): Group {
  const parts: Object3D[] = [];
  const marks: [number, number, number][] = [
    [0, 1.1, 0.12],
    [0, 1.5, 0.08],
    [0, 1.9, 0.14],
    [0, 2.3, 0.07],
    [0, 2.7, 0.1],
    [0, 3.1, 0.06],
    [0, 3.45, 0.09],
  ];
  for (let face = 0; face < 4; face++) {
    const yaw = (face / 4) * Math.PI * 2;
    for (const [, y, w] of marks) {
      // The shaft tapers: each glyph sits on the face at its height.
      const r = 0.42 - ((y - 0.42) / 3.6) * 0.14;
      const inset = r * Math.SQRT1_2 + 0.012;
      parts.push(part(new BoxGeometry(w, 0.045, 0.01), material, [Math.sin(yaw) * inset, y, Math.cos(yaw) * inset], [0, yaw, 0]));
    }
  }
  for (const [x, y, z] of OBELISK_BRAZIERS) parts.push(part(new CylinderGeometry(0.2, 0.2, 0.06, 8), material, [x, y + 0.08, z]));
  return group(parts);
}

export function ObeliskModel() {
  const glyphMat = useMemo(() => glow("#ff8a3c", 2.4).clone(), []);
  const parts = useMemo(() => ({ body: stone(), glyphs: glyphs(glyphMat) }), [glyphMat]);
  const heat = useRef(0);
  useFrame(({ clock }, dt) => {
    const waiting = useArena.getState().queue !== null;
    heat.current += ((waiting ? 1 : 0) - heat.current) * Math.min(1, dt * 3);
    const t = clock.elapsedTime;
    glyphMat.emissiveIntensity = 1.6 + Math.sin(t * 1.7) * 0.35 + heat.current * (1.6 + Math.sin(t * 6) * 0.5);
  });
  return (
    <group>
      <primitive object={parts.body} />
      <primitive object={parts.glyphs} />
    </group>
  );
}
