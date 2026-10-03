import { useFrame } from "@react-three/fiber";
import { Fragment, useEffect, useRef } from "react";
import { Group, MeshStandardMaterial } from "three";
import { getEnemyDef } from "../enemies/registry";
import { useDevRoom } from "../game/devRoom";
import { Trap } from "./traps";
import { offerInteraction } from "../game/interactions";
import { playerPosition } from "../game/player-state";
import { addLightSource, removeLightSource } from "../fx/DynamicLights";
import { DevSlabModel } from "../render/models/DevSlabModel";
import { useGame } from "../state/gameStore";
import type { Vec3 } from "./types";

const DEV_COLOR = "#7cff9e";

/** The dev-room slab: a glowing monolith behind the village spawn that opens
 * the DevRoom testing panel. Only ever mounted in dev builds (see Village),
 * so it never appears on a deployed server. */
export function DevSlab({ position }: { position: Vec3 }) {
  const disc = useRef<MeshStandardMaterial>(null);
  const group = useRef<Group>(null);

  useEffect(() => {
    const src = addLightSource({
      position: [position[0], position[1] + 1.6, position[2]],
      color: DEV_COLOR,
      intensity: 6,
      distance: 9,
      priority: 1,
    });
    return () => removeLightSource(src);
  }, [position]);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (disc.current) disc.current.emissiveIntensity = 1.8 + Math.sin(t * 2.4) * 0.5;
    if (group.current) group.current.rotation.y = t * 0.25;

    const d2 = (playerPosition.x - position[0]) ** 2 + (playerPosition.z - position[2]) ** 2;
    if (d2 < 8) {
      offerInteraction(
        "E — Dev Room (test bench)",
        d2,
        () => {
          document.exitPointerLock();
          useGame.getState().setOverlay("devroom");
        },
        [position[0], position[1] + 1.6, position[2]],
      );
    }
  });

  return (
    <group position={position}>
      <DevSlabModel color={DEV_COLOR} faceRef={disc} moteRef={group} />
    </group>
  );
}

/** Renders every enemy spawned from the DevRoom panel. Mounted alongside the
 * slab (dev builds only). Solo/offline the local client is the authority, so
 * these enemies simply simulate — combatActive() lets them think in the
 * village while a dev session is running. */
export function DevSpawns() {
  const spawns = useDevRoom((s) => s.spawns);
  const traps = useDevRoom((s) => s.traps);
  const remove = useDevRoom((s) => s.remove);
  return (
    <>
      {spawns.map((s) => (
        <Fragment key={s.id}>
          {getEnemyDef(s.kind).render({
            entityId: s.id,
            pos: s.pos,
            floor: s.floor,
            onDeath: () => remove(s.id),
          })}
        </Fragment>
      ))}
      {traps.map((t) => (
        <Trap key={t.id} kind={t.kind} pos={t.pos} floor={t.floor} />
      ))}
    </>
  );
}
