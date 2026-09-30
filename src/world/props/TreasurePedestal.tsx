import { useFrame } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { gameEvents } from "../../core/events";
import { Rng } from "../../core/rng";
import { addLightSource, flashLight, removeLightSource } from "../../fx/DynamicLights";
import { spawnBurst } from "../../fx/Particles";
import { offerInteraction } from "../../game/interactions";
import { playerPosition } from "../../game/player-state";
import { getItemDef } from "../../items/catalog";
import { itemTitle } from "../../items/inventory";
import { rollItem } from "../../items/loot";
import { isHost, useNet } from "../../net/netStore";
import { setTreasureProvider } from "../../net/replication";
import { session } from "../../net/session";
import { AltarModel, ALTAR_TOP } from "../../render/models/AltarModels";
import { LootModel } from "../../render/models/LootModel";
import { useGame } from "../../state/gameStore";
import type { Vec3 } from "../types";

/** Guaranteed floor treasure — the item is rolled deterministically from the
 * floor seed, so everyone in a shared instance sees the same reward. */
export function TreasurePedestal({ position, floor, seed }: { position: Vec3; floor: number; seed: number }) {
  // A treasure is a cut above ordinary drops.
  const item = useMemo(() => rollItem(new Rng((seed ^ 0x9c67f3a1) >>> 0), floor, 1), [seed, floor]);
  const def = getItemDef(item.defId);
  const [taken, setTaken] = useState(false);
  const takenRef = useRef(false);
  const requested = useRef(0);

  const consume = useCallback(
    (byMe: boolean, silent = false) => {
      if (takenRef.current) return;
      takenRef.current = true;
      setTaken(true);
      if (byMe) useGame.getState().pickUpItem(item);
      if (!silent) {
        spawnBurst({
          position: [position[0], position[1] + 1.5, position[2]],
          count: 20,
          color: [def.color, "#ffffff"],
          speed: 4,
          ttl: 0.7,
          size: 0.08,
        });
        flashLight([position[0], position[1] + 1.5, position[2]], def.color, 18);
      }
    },
    [item, def, position],
  );

  // Late-join state sync: tell the host whether the treasure is gone.
  useEffect(() => {
    setTreasureProvider(() => takenRef.current);
    return () => setTreasureProvider(null);
  }, []);

  // Replica: the host announced who got it.
  useEffect(
    () =>
      gameEvents.on("entityEvent", (ev) => {
        if (ev.k === "treasureTaken") {
          consume(ev.by !== "" && ev.by === useNet.getState().playerId, ev.silent);
        }
      }),
    [consume],
  );

  // Host: grant a replica's request — one treasure, first come first served.
  useEffect(
    () =>
      gameEvents.on("orbRequest", ({ playerId, orbId }) => {
        if (orbId !== "treasure" || !isHost() || takenRef.current) return;
        session.sendEntityEvent({ k: "treasureTaken", by: playerId });
        consume(false);
      }),
    [consume],
  );

  useEffect(() => {
    if (taken) return;
    const src = addLightSource({
      position: [position[0], position[1] + 1.6, position[2]],
      color: def.color,
      intensity: 4,
      distance: 7,
      priority: 1,
    });
    return () => removeLightSource(src);
  }, [taken, def, position]);

  useFrame((_, dt) => {
    if (taken) return;
    requested.current -= dt;
    const d2 =
      (playerPosition.x - position[0]) ** 2 + (playerPosition.z - position[2]) ** 2;
    if (d2 < 6) {
      offerInteraction(`E — Take ${itemTitle(item)} · Lv ${item.level}  (${def.desc})`, d2, () => {
        if (takenRef.current) return;
        if (isHost()) {
          session.sendEntityEvent({
            k: "treasureTaken",
            by: useNet.getState().playerId || "self",
          });
          consume(true);
        } else if (requested.current <= 0) {
          requested.current = 0.6;
          session.sendTakeOrb("treasure");
        }
      });
    }
  });

  return (
    <group position={position}>
      <AltarModel color={def.color} />
      {!taken && (
        <group position={[0, ALTAR_TOP, 0]}>
          <LootModel item={item} groundY={0} float={0.42} />
        </group>
      )}
    </group>
  );
}
