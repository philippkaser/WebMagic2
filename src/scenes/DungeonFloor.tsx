import { useThree } from "@react-three/fiber";
import { CuboidCollider, RigidBody } from "@react-three/rapier";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Color, Fog, InstancedMesh, Object3D } from "three";
import { startAmbient, stopAmbient } from "../audio/sound";
import { TILE, WALL_HEIGHT } from "../core/config";
import { gameEvents } from "../core/events";
import { hashSeed } from "../core/rng";
import { Sentry, Wisp } from "../enemies";
import { Boss } from "../enemies/Boss";
import { resetRegistries } from "../game/registry";
import type { ChestInfo } from "../net/protocol";
import { resetReplication, setExpectedEntities } from "../net/replication";
import { session } from "../net/session";
import { COLLISION } from "../physics/groups";
import { PlayerController } from "../player/PlayerController";
import { canExtract } from "../progression/progression";
import { getTextures } from "../render/textures";
import { useGame } from "../state/gameStore";
import { Breakable, DeathChest, Portal, Torch, TreasurePedestal } from "../world/props";
import type { FloorLayout } from "../world/types";

const WORLD_GROUPS = COLLISION.world;

/** Renders one generated dungeon floor: instanced walls with greedy-merged
 * colliders, torches, physics props, enemies, treasure and portals. */
export function DungeonFloor({ layout }: { layout: FloorLayout }) {
  const scene = useThree((s) => s.scene);
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const [bossAlive, setBossAlive] = useState(layout.boss !== null);

  useEffect(() => {
    scene.fog = new Fog("#070409", 9, 50);
    scene.background = new Color("#070409");
    startAmbient("dungeon");
    // Tell replication which entity ids this floor spawns, so the host can
    // compute the dead set for late joiners.
    setExpectedEntities([
      ...layout.enemies.map((_, i) => `e${i}`),
      ...layout.props.map((_, i) => `p${i}`),
      ...(layout.boss ? ["boss"] : []),
    ]);
    // Pre-compile every material against the floor's final light count now,
    // during the load moment, instead of stuttering on the first explosion.
    const warmup = requestAnimationFrame(() => gl.compile(scene, camera));
    return () => {
      cancelAnimationFrame(warmup);
      scene.fog = null;
      stopAmbient();
      resetRegistries();
      resetReplication();
    };
  }, [scene, gl, camera]);

  // Fan players out around the spawn tile so floor-mates don't materialize
  // inside each other.
  const spawnPoint = useMemo<typeof layout.spawn>(() => {
    const angle = (hashSeed(session.playerId || "solo") % 6283) / 1000;
    return [
      layout.spawn[0] + Math.cos(angle) * 1.1,
      layout.spawn[1],
      layout.spawn[2] + Math.sin(angle) * 1.1,
    ];
  }, [layout.spawn]);

  const descend = () => void useGame.getState().descend();
  // Pointer lock survives the warp home — arrival in the village is seamless.
  const extract = () => void useGame.getState().extract();
  const homewardOpen = useGame((s) => canExtract(s.run));
  const chests = useFloorChests();

  return (
    <group>
      <ambientLight intensity={0.14} color="#5a6a9a" />

      <WallsAndFloor layout={layout} />

      {layout.torches.map((pos, i) => (
        <Torch key={i} position={pos} />
      ))}
      {layout.props.map((prop, i) => (
        <Breakable
          key={i}
          kind={prop.kind}
          position={prop.pos}
          floor={layout.floor}
          entityId={`p${i}`}
        />
      ))}
      {layout.enemies.map((enemy, i) =>
        enemy.kind === "wisp" ? (
          <Wisp key={i} position={enemy.pos} floor={layout.floor} entityId={`e${i}`} />
        ) : (
          <Sentry key={i} position={enemy.pos} floor={layout.floor} entityId={`e${i}`} />
        ),
      )}

      <TreasurePedestal position={layout.treasure} floor={layout.floor} seed={layout.seed} />

      {layout.boss && bossAlive && (
        <Boss position={layout.boss} floor={layout.floor} onDeath={() => setBossAlive(false)} />
      )}

      <Portal
        position={layout.exit}
        color="#46ffd0"
        prompt={`E — Descend to floor ${layout.floor + 1}`}
        onUse={descend}
        locked={bossAlive}
        lockedPrompt="Sealed — the Warden of the Deep still lives"
      />
      {homewardOpen && (
        <Portal
          position={layout.homeward}
          color="#ffd44f"
          prompt="E — Escape homeward (keep everything you carry)"
          onUse={extract}
          locked={bossAlive}
          lockedPrompt="Sealed — the Warden of the Deep still lives"
        />
      )}

      {chests.map((chest) => (
        <DeathChest
          key={chest.id}
          chest={chest}
          position={chest.pos ?? layout.remainsSlots[(chest.slot ?? 0) % layout.remainsSlots.length]}
        />
      ))}

      <PlayerController spawn={spawnPoint} />
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

/** Death chests on this floor: the server's list at arrival, then live
 * spawns (a floor-mate fell) and claims (someone opened one). */
function useFloorChests(): ChestInfo[] {
  const [chests, setChests] = useState<ChestInfo[]>(() => session.chests);
  useEffect(() => {
    const offSpawn = gameEvents.on("chestSpawn", (chest) => setChests((prev) => [...prev, chest]));
    const offOpen = gameEvents.on("chestOpened", ({ chestId }) =>
      setChests((prev) => prev.filter((c) => c.id !== chestId)),
    );
    return () => {
      offSpawn();
      offOpen();
    };
  }, []);
  return chests;
}
