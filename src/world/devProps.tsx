import { useFrame } from "@react-three/fiber";
import { Fragment, useEffect, useRef } from "react";
import { Group, MeshStandardMaterial } from "three";
import { getEnemyDef } from "../combat/enemyRegistry";
import { useDevRoom } from "../game/devRoom";
import { Trap } from "./traps";
import { offerInteraction } from "../game/interactions";
import { playerPosition } from "../game/player-state";
import { addLightSource, removeLightSource } from "../fx/DynamicLights";
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
      offerInteraction("E — Dev Room (test bench)", d2, () => {
        document.exitPointerLock();
        useGame.getState().setOverlay("devroom");
      });
    }
  });

  return (
    <group position={position}>
      {/* Base */}
      <mesh position={[0, 0.15, 0]} receiveShadow>
        <boxGeometry args={[1.8, 0.3, 1.8]} />
        <meshStandardMaterial color="#2a3a30" roughness={0.85} />
      </mesh>
      {/* Slab */}
      <mesh position={[0, 1.4, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.4, 2.4, 0.4]} />
        <meshStandardMaterial color="#1c2620" roughness={0.7} metalness={0.2} />
      </mesh>
      {/* Glowing rune face */}
      <mesh position={[0, 1.55, 0.22]}>
        <planeGeometry args={[0.9, 1.6]} />
        <meshStandardMaterial
          ref={disc}
          color="#04120a"
          emissive={DEV_COLOR}
          emissiveIntensity={1.8}
          toneMapped={false}
        />
      </mesh>
      {/* Orbiting mote so it reads as "interactive/magical" at a glance */}
      <group ref={group} position={[0, 2, 0]}>
        <mesh position={[0.9, 0, 0]}>
          <octahedronGeometry args={[0.14]} />
          <meshStandardMaterial
            color="#0c0c14"
            emissive={DEV_COLOR}
            emissiveIntensity={3}
            toneMapped={false}
          />
        </mesh>
      </group>
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
