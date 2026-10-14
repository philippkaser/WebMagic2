import { useMemo } from "react";
import { BoxGeometry, CylinderGeometry, Group, Object3D, TorusGeometry } from "three";
import { bake, glow, group, part, roughen, std } from "./modelKit";

/** The camp's guild board, in the artpass model family: two rough posts and
 * a plank board under a little shingled roof, pinned with parchment
 * notices — fellowships seeking company — and a lantern on a hook. Origin
 * on the ground; the board faces +z. Pure presentation: world/villageProps
 * GuildBoard owns the prompt and the light. */

function board(): Group {
  const wood = std("#5a3e28", { tex: "planks", roughness: 0.9 });
  const bark = std("#4a321e", { tex: "bark", roughness: 0.9 });
  const iron = std("#2e2c34", { tex: "iron", metalness: 0.75, roughness: 0.42 });
  const parchment = std("#d8c8a0", { tex: "cloth", roughness: 0.95 });
  const wax = std("#a8282a", { roughness: 0.4 });
  const parts: Object3D[] = [];
  const post = roughen(new CylinderGeometry(0.07, 0.09, 2.5, 6), 0.01, 3);
  for (const x of [-0.85, 0.85]) parts.push(part(post, bark, [x, 1.25, 0]));
  // The board, and a rail along its foot.
  parts.push(part(new BoxGeometry(1.7, 1.05, 0.06), wood, [0, 1.55, 0]));
  parts.push(part(new BoxGeometry(1.8, 0.08, 0.1), bark, [0, 1.0, 0.02]));
  // A little roof of two shingled planks.
  parts.push(part(new BoxGeometry(1.95, 0.05, 0.42), wood, [0, 2.18, 0.12], [0.5, 0, 0]));
  parts.push(part(new BoxGeometry(1.95, 0.05, 0.36), wood, [0, 2.2, -0.12], [-0.6, 0, 0]));
  // Notices, a little askew, each held by a wax seal.
  const notes: [number, number, number, number, number][] = [
    [-0.5, 1.7, 0.36, 0.42, 0.08],
    [0.05, 1.62, 0.4, 0.5, -0.05],
    [0.55, 1.75, 0.34, 0.36, 0.12],
    [-0.35, 1.25, 0.3, 0.26, -0.1],
    [0.45, 1.3, 0.38, 0.3, 0.04],
  ];
  for (const [x, y, w, h, tilt] of notes) {
    parts.push(part(new BoxGeometry(w, h, 0.01), parchment, [x, y, 0.04], [0, 0, tilt]));
    parts.push(part(new CylinderGeometry(0.025, 0.025, 0.012, 8), wax, [x, y + h / 2 - 0.05, 0.05], [Math.PI / 2, 0, 0]));
  }
  // The lantern's hook.
  parts.push(part(new BoxGeometry(0.3, 0.03, 0.03), iron, [0.95, 2.0, 0.12]));
  parts.push(part(new TorusGeometry(0.04, 0.01, 4, 8), iron, [1.08, 1.95, 0.12]));
  return bake(group(parts));
}

/** The lantern's flame (a separate mesh so the shell can flicker it). */
function flame(): Group {
  return group([part(new CylinderGeometry(0.035, 0.05, 0.1, 6), glow("#ffb84d", 2.6), [1.08, 1.84, 0.12], [0, 0, 0], 1, false)]);
}

export function GuildBoardModel() {
  const parts = useMemo(() => ({ body: board(), flame: flame() }), []);
  return (
    <group>
      <primitive object={parts.body} />
      <primitive object={parts.flame} />
    </group>
  );
}

/** Where the lantern hangs, for the shell's light (board-local). */
export const GUILD_LANTERN: [number, number, number] = [1.08, 1.84, 0.12];
