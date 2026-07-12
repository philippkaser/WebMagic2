import { Fragment, useEffect, useRef, useState } from "react";
import { registerSyncProvider } from "../net/entities";
import { useGame } from "../state/gameStore";
import { Slime } from "./enemies";
import { getEnemyDef } from "./enemyRegistry";
import { despawnSpawned, spawnHandlers, type SpawnedEnemy } from "./spawnedEnemyStore";

/** Renders enemies spawned at runtime (slime children today). Wires the store
 * handlers and a late-join sync provider so a joiner mid-fight sees the current
 * children — the same mechanism loot orbs use. Mount it wherever runtime spawns
 * can happen (the dungeon floor, and the dev-village arena). */
export function SpawnedEnemies() {
  const [spawns, setSpawns] = useState<SpawnedEnemy[]>([]);
  const ref = useRef<SpawnedEnemy[]>([]);
  ref.current = spawns;
  const floorSeed = useGame((s) => s.floorSeed);

  useEffect(() => {
    spawnHandlers.push = (s) =>
      setSpawns((prev) => (prev.some((x) => x.id === s.id) ? prev : [...prev, s]));
    spawnHandlers.remove = (id) => setSpawns((prev) => prev.filter((x) => x.id !== id));
    spawnHandlers.live = () => ref.current;
    // Late joiner learns the live children and spawns them silently.
    const unregister = registerSyncProvider("spawnedEnemies", {
      collect: () => ref.current,
      apply: (data) => {
        for (const s of (data as SpawnedEnemy[]) ?? []) spawnHandlers.push?.(s);
      },
    });
    return () => {
      spawnHandlers.push = null;
      spawnHandlers.remove = null;
      spawnHandlers.live = null;
      unregister();
    };
  }, []);

  // Runtime spawns never carry across a floor change.
  useEffect(() => setSpawns([]), [floorSeed]);

  return (
    <>
      {spawns.map((s) =>
        s.kind === "slime" ? (
          <Slime
            key={s.id}
            entityId={s.id}
            position={s.pos}
            floor={s.floor}
            generation={s.generation}
            onDeath={() => despawnSpawned(s.id)}
          />
        ) : (
          <Fragment key={s.id}>
            {getEnemyDef(s.kind).render({
              entityId: s.id,
              pos: s.pos,
              floor: s.floor,
              onDeath: () => despawnSpawned(s.id),
            })}
          </Fragment>
        ),
      )}
    </>
  );
}
