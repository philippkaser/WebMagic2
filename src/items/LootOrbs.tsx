import { useFrame } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import { gameEvents } from "../core/events";
import { Rng } from "../core/rng";
import { addLightSource, removeLightSource } from "../fx/DynamicLights";
import { spawnBurst } from "../fx/Particles";
import { offerInteraction } from "../game/interactions";
import { playerPosition } from "../game/player-state";
import { isHost, useNet } from "../net/netStore";
import { setOrbProvider } from "../net/replication";
import { session } from "../net/session";
import { LootModel } from "../render/models/LootModel";
import { useGame } from "../state/gameStore";
import type { Vec3 } from "../world/types";
import { getItemDef } from "./catalog";
import { itemTitle } from "./inventory";
import { rollItem } from "./loot";
import { RARITIES } from "./rarity";
import type { ItemInstance } from "./types";

/** Dropped-loot manager under host authority: the floor host rolls drops and
 * broadcasts spawns; pickups are granted by the host so an orb can never be
 * taken twice. Offline, we're always host and it behaves classically. */

interface Orb {
  id: string;
  item: ItemInstance;
  position: Vec3;
}

let orbCounter = 1;
let pushOrb: ((orb: Orb) => void) | null = null;
let takeOrbLocal: ((orbId: string, by: string) => void) | null = null;

/** Roll & drop loot at a position. Host-only — replicas receive the spawn
 * event instead, so exactly one roll happens per kill/break. */
export function dropLoot(position: Vec3, floor: number, chance = 1, bonus = 0): void {
  if (!isHost()) return;
  if (Math.random() > chance) return;
  const item = rollItem(new Rng((Math.random() * 0xffffffff) >>> 0), floor, bonus);
  const orb: Orb = {
    id: `orb_${orbCounter++}_${Math.random().toString(36).slice(2, 6)}`,
    item,
    position,
  };
  pushOrb?.(orb);
  session.sendEntityEvent({ k: "orbSpawn", orb: { orbId: orb.id, item, pos: position } });
}

export function LootOrbs() {
  const [orbs, setOrbs] = useState<Orb[]>([]);
  const orbsRef = useRef<Orb[]>([]);
  orbsRef.current = orbs;
  const floorSeed = useGame((s) => s.floorSeed);

  // Late-join state sync: give the host access to the live orb list.
  useEffect(() => {
    setOrbProvider(() =>
      orbsRef.current.map((o) => ({ orbId: o.id, item: o.item, pos: o.position })),
    );
    return () => setOrbProvider(null);
  }, []);

  useEffect(() => {
    pushOrb = (orb) => setOrbs((prev) => [...prev, orb]);
    // Dev-only: conjure a specific drop for looking at loot visuals.
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__dropLoot = (
        defId: string,
        rarity: ItemInstance["rarity"] = "common",
        at: Vec3 = [playerPosition.x, 0.5, playerPosition.z - 2.5],
      ) =>
        pushOrb?.({
          id: `orb_dev_${orbCounter++}`,
          item: { uid: `dev_${orbCounter}`, defId, level: 1, rarity, runLoot: true },
          position: at,
        });
    }
    takeOrbLocal = (orbId, by) => {
      setOrbs((prev) => {
        const orb = prev.find((o) => o.id === orbId);
        if (!orb) return prev;
        if (by === useNet.getState().playerId || by === "self") {
          useGame.getState().pickUpItem(orb.item);
        }
        spawnBurst({
          position: [orb.position[0], orb.position[1] + 0.5, orb.position[2]],
          count: 18,
          color: [getItemDef(orb.item.defId).color, RARITIES[orb.item.rarity].color, "#ffffff"],
          speed: 3.5,
          ttl: 0.6,
          size: 0.07,
          gravity: -2,
        });
        return prev.filter((o) => o.id !== orbId);
      });
    };
    return () => {
      pushOrb = null;
      takeOrbLocal = null;
    };
  }, []);

  // Replica: spawns/pickups decided by the host.
  useEffect(
    () =>
      gameEvents.on("entityEvent", (ev) => {
        if (ev.k === "orbSpawn") pushOrb?.({ id: ev.orb.orbId, item: ev.orb.item, position: ev.orb.pos });
        else if (ev.k === "orbTaken") takeOrbLocal?.(ev.orbId, ev.by);
      }),
    [],
  );

  // Host: grant pickup requests from replicas (first come, first served).
  useEffect(
    () =>
      gameEvents.on("orbRequest", ({ playerId, orbId }) => {
        if (!isHost() || !orbId.startsWith("orb_")) return;
        setOrbs((prev) => {
          if (!prev.some((o) => o.id === orbId)) return prev; // already gone
          session.sendEntityEvent({ k: "orbTaken", orbId, by: playerId });
          takeOrbLocal?.(orbId, playerId);
          return prev;
        });
      }),
    [],
  );

  // Loot left behind vanishes when the floor changes.
  useEffect(() => setOrbs([]), [floorSeed]);

  return (
    <>
      {orbs.map((orb) => (
        <LootOrb key={orb.id} orb={orb} />
      ))}
    </>
  );
}

/** Loot rests on the floor at y=0; anything spawned higher (a pedestal, a
 * ledge) just floats without a floor decal reaching down to it. */
function groundOffset(y: number): number {
  return y >= 0 && y < 3 ? -y : -0.1;
}

function LootOrb({ orb }: { orb: Orb }) {
  const requested = useRef(0);
  const def = getItemDef(orb.item.defId);
  const [x, y, z] = orb.position;

  useEffect(() => {
    // Better loot throws a little more light (legendary: 2.4 → 4.2).
    const src = addLightSource({
      position: [x, y + 0.6, z],
      color: def.color,
      intensity: 2.4 + (RARITIES[orb.item.rarity].mult - 1) * 3.6,
      distance: 5,
      priority: 1,
    });
    return () => removeLightSource(src);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFrame((_, dt) => {
    requested.current -= dt;
    const d2 = (playerPosition.x - x) ** 2 + (playerPosition.y - (y + 0.45)) ** 2 + (playerPosition.z - z) ** 2;
    if (d2 < 5.5) {
      offerInteraction(`E — Take ${itemTitle(orb.item)} · Lv ${orb.item.level}  (${def.desc})`, d2, () => {
        if (isHost()) {
          session.sendEntityEvent({
            k: "orbTaken",
            orbId: orb.id,
            by: useNet.getState().playerId || "self",
          });
          takeOrbLocal?.(orb.id, "self");
        } else if (requested.current <= 0) {
          requested.current = 0.6; // throttle re-requests while awaiting grant
          session.sendTakeOrb(orb.id);
        }
      });
    }
  });

  return (
    <group position={orb.position}>
      <LootModel item={orb.item} groundY={groundOffset(y)} />
    </group>
  );
}
