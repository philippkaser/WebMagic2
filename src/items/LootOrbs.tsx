import { useFrame } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import { Group } from "three";
import { gameEvents } from "../core/events";
import { Rng } from "../core/rng";
import {
  addLightSource,
  removeLightSource,
  type DynamicLightSource,
} from "../fx/DynamicLights";
import { spawnBurst } from "../fx/Particles";
import { offerInteraction } from "../game/interactions";
import { playerPosition } from "../game/player-state";
import { isHost, useNet } from "../net/netStore";
import { setOrbProvider } from "../net/replication";
import { session } from "../net/session";
import { getItemDef } from "./catalog";
import { rollLoot } from "./loot";
import { useGame } from "../state/gameStore";
import type { Vec3 } from "../world/types";

/** Dropped-loot manager under host authority: the floor host rolls drops and
 * broadcasts spawns; pickups are granted by the host so an orb can never be
 * taken twice. Offline, we're always host and it behaves classically. */

interface Orb {
  id: string;
  defId: string;
  position: Vec3;
}

let orbCounter = 1;
let pushOrb: ((orb: Orb) => void) | null = null;
let takeOrbLocal: ((orbId: string, by: string) => void) | null = null;

/** Roll & drop loot at a position. Host-only — replicas receive the spawn
 * event instead, so exactly one roll happens per kill/break. */
export function dropLoot(position: Vec3, floor: number, chance = 1): void {
  if (!isHost()) return;
  if (Math.random() > chance) return;
  const def = rollLoot(new Rng((Math.random() * 0xffffffff) >>> 0), floor);
  const orb: Orb = {
    id: `orb_${orbCounter++}_${Math.random().toString(36).slice(2, 6)}`,
    defId: def.id,
    position,
  };
  pushOrb?.(orb);
  session.sendEntityEvent({ k: "orbSpawn", orbId: orb.id, defId: def.id, pos: position });
}

export function LootOrbs() {
  const [orbs, setOrbs] = useState<Orb[]>([]);
  const orbsRef = useRef<Orb[]>([]);
  orbsRef.current = orbs;
  const floorSeed = useGame((s) => s.floorSeed);

  // Late-join state sync: give the host access to the live orb list.
  useEffect(() => {
    setOrbProvider(() =>
      orbsRef.current.map((o) => ({ orbId: o.id, defId: o.defId, pos: o.position })),
    );
    return () => setOrbProvider(null);
  }, []);

  useEffect(() => {
    pushOrb = (orb) => setOrbs((prev) => [...prev, orb]);
    takeOrbLocal = (orbId, by) => {
      setOrbs((prev) => {
        const orb = prev.find((o) => o.id === orbId);
        if (!orb) return prev;
        if (by === useNet.getState().playerId || by === "self") {
          useGame.getState().equipItem(orb.defId);
        }
        spawnBurst({
          position: [orb.position[0], orb.position[1] + 0.5, orb.position[2]],
          count: 18,
          color: [getItemDef(orb.defId).color, "#ffffff"],
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
        if (ev.k === "orbSpawn") pushOrb?.({ id: ev.orbId, defId: ev.defId, position: ev.pos });
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

function LootOrb({ orb }: { orb: Orb }) {
  const group = useRef<Group>(null);
  const light = useRef<DynamicLightSource | null>(null);
  const requested = useRef(0);
  const def = getItemDef(orb.defId);
  const [x, y, z] = orb.position;

  useEffect(() => {
    const src = addLightSource({
      position: [x, y + 0.5, z],
      color: def.color,
      intensity: 2.4,
      distance: 5,
      priority: 1,
    });
    light.current = src;
    return () => {
      removeLightSource(src);
      light.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFrame(({ clock }, dt) => {
    const g = group.current;
    if (!g) return;
    const t = clock.elapsedTime;
    g.position.set(x, y + 0.35 + Math.sin(t * 2.4) * 0.12, z);
    g.rotation.y = t * 1.6;
    light.current?.position.copy(g.position);
    requested.current -= dt;

    const d2 = playerPosition.distanceToSquared(g.position);
    if (d2 < 5.5) {
      offerInteraction(`E — Take ${def.name}  (${def.desc})`, d2, () => {
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
    <group ref={group} position={orb.position}>
      <mesh>
        <octahedronGeometry args={[0.22]} />
        <meshStandardMaterial
          color="#0c0c14"
          emissive={def.color}
          emissiveIntensity={3.4}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
