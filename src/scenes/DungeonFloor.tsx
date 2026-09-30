import { useThree } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import { Color, Fog } from "three";
import { startAmbient, stopAmbient } from "../audio/sound";
import { gameEvents } from "../core/events";
import { hashSeed } from "../core/rng";
import { Boss } from "../enemies/Boss";
import { EnemyFx } from "../enemies/fx/EnemyFx";
import { ENEMY_COMPONENTS } from "../enemies/registry";
import { resetRegistries } from "../game/registry";
import type { ChestInfo } from "../net/protocol";
import { resetReplication, setExpectedEntities } from "../net/replication";
import { session } from "../net/session";
import { PlayerController } from "../player/PlayerController";
import { canExtract } from "../progression/progression";
import { useGame } from "../state/gameStore";
import { biomeFor } from "../world/biomes";
import { FloorGeometry } from "../world/FloorGeometry";
import { Breakable, DeathChest, Portal, Torch, TreasurePedestal } from "../world/props";
import type { FloorLayout } from "../world/types";

/** Renders one generated dungeon floor: instanced walls with greedy-merged
 * colliders, torches, physics props, enemies, treasure and portals. */
export function DungeonFloor({ layout }: { layout: FloorLayout }) {
  const scene = useThree((s) => s.scene);
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const [bossAlive, setBossAlive] = useState(layout.boss !== null);
  const biome = useMemo(() => biomeFor(layout.floor), [layout.floor]);

  useEffect(() => {
    scene.fog = new Fog(biome.fog.color, biome.fog.near, biome.fog.far);
    scene.background = new Color(biome.fog.color);
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
  }, [scene, gl, camera, biome]);

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
      <ambientLight intensity={biome.ambient.intensity} color={biome.ambient.color} />

      <FloorGeometry layout={layout} />

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
      <EnemyFx />
      {layout.enemies.map((enemy, i) => {
        const Enemy = ENEMY_COMPONENTS[enemy.kind];
        return <Enemy key={i} position={enemy.pos} floor={layout.floor} entityId={`e${i}`} />;
      })}

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
