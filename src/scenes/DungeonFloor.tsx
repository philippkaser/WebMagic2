import { useThree } from "@react-three/fiber";
import { CuboidCollider, interactionGroups, RigidBody } from "@react-three/rapier";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Color, Fog, InstancedMesh, Object3D } from "three";
import { Sentry, Wisp } from "../combat/enemies";
import { GROUPS, TILE, WALL_HEIGHT } from "../core/config";
import { resetRegistries } from "../game/registry";
import { PlayerController } from "../player/PlayerController";
import { getTextures } from "../render/textures";
import { useGame } from "../state/gameStore";
import { Breakable, Portal, Torch, TreasurePedestal } from "../world/props";
import type { FloorLayout } from "../world/types";

const WORLD_GROUPS = interactionGroups(GROUPS.WORLD, [
  GROUPS.PLAYER,
  GROUPS.ENEMY,
  GROUPS.FRIENDLY_PROJECTILE,
  GROUPS.ENEMY_PROJECTILE,
  GROUPS.PROP,
]);

/** Renders one generated dungeon floor: instanced walls with greedy-merged
 * colliders, torches, physics props, enemies, treasure and portals. */
export function DungeonFloor({ layout }: { layout: FloorLayout }) {
  const scene = useThree((s) => s.scene);

  useEffect(() => {
    scene.fog = new Fog("#070409", 9, 50);
    scene.background = new Color("#070409");
    return () => {
      scene.fog = null;
      resetRegistries();
    };
  }, [scene]);

  const descend = () => void useGame.getState().descend();
  const bankAndLeave = () => {
    document.exitPointerLock();
    useGame.getState().bankAndLeave();
  };

  return (
    <group>
      <ambientLight intensity={0.14} color="#5a6a9a" />

      <WallsAndFloor layout={layout} />

      {layout.torches.map((pos, i) => (
        <Torch key={i} position={pos} />
      ))}
      {layout.props.map((prop, i) => (
        <Breakable key={i} kind={prop.kind} position={prop.pos} floor={layout.floor} />
      ))}
      {layout.enemies.map((enemy, i) =>
        enemy.kind === "wisp" ? (
          <Wisp key={i} position={enemy.pos} floor={layout.floor} />
        ) : (
          <Sentry key={i} position={enemy.pos} floor={layout.floor} />
        ),
      )}

      <TreasurePedestal position={layout.treasure} floor={layout.floor} seed={layout.seed} />

      <Portal
        position={layout.exit}
        color="#46ffd0"
        prompt={`E — Descend to floor ${layout.floor + 1}`}
        onUse={descend}
      />
      {layout.leave && (
        <Portal
          position={layout.leave}
          color="#ffd44f"
          prompt="E — Return to the village (bank your loot)"
          onUse={bankAndLeave}
        />
      )}

      <PlayerController spawn={layout.spawn} />
    </group>
  );
}

function WallsAndFloor({ layout }: { layout: FloorLayout }) {
  const walls = useRef<InstancedMesh>(null);
  const wallTex = useMemo(() => getTextures("stone"), []);
  const floorTex = useMemo(
    () => getTextures("slab", layout.extent / 2, layout.extent / 2),
    [layout.extent],
  );
  const ceilTex = useMemo(
    () => getTextures("dark", layout.extent / 2, layout.extent / 2),
    [layout.extent],
  );

  useLayoutEffect(() => {
    const mesh = walls.current;
    if (!mesh) return;
    const dummy = new Object3D();
    dummy.scale.set(TILE, WALL_HEIGHT, TILE);
    layout.wallInstances.forEach(([x, y, z], i) => {
      dummy.position.set(x, y, z);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [layout]);

  return (
    <group>
      {/* All static colliders in one fixed body. */}
      <RigidBody type="fixed" colliders={false}>
        {layout.wallBoxes.map((box, i) => (
          <CuboidCollider
            key={i}
            args={box.half}
            position={box.center}
            collisionGroups={WORLD_GROUPS}
          />
        ))}
        <CuboidCollider
          args={[layout.extent, 0.5, layout.extent]}
          position={[0, -0.5, 0]}
          collisionGroups={WORLD_GROUPS}
        />
        <CuboidCollider
          args={[layout.extent, 0.5, layout.extent]}
          position={[0, WALL_HEIGHT + 0.5, 0]}
          collisionGroups={WORLD_GROUPS}
        />
      </RigidBody>

      <instancedMesh
        ref={walls}
        args={[undefined, undefined, layout.wallInstances.length]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial
          map={wallTex.map}
          normalMap={wallTex.normalMap}
          roughness={0.88}
          metalness={0.06}
          envMapIntensity={0.4}
        />
      </instancedMesh>

      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[layout.extent * 2, layout.extent * 2]} />
        <meshStandardMaterial
          map={floorTex.map}
          normalMap={floorTex.normalMap}
          roughness={0.6}
          metalness={0.18}
          envMapIntensity={0.75}
        />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, WALL_HEIGHT, 0]}>
        <planeGeometry args={[layout.extent * 2, layout.extent * 2]} />
        <meshStandardMaterial map={ceilTex.map} normalMap={ceilTex.normalMap} roughness={0.95} />
      </mesh>
    </group>
  );
}
