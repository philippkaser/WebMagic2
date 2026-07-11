import { useFrame } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import { Group } from "three";
import { Rng } from "../core/rng";
import {
  addLightSource,
  removeLightSource,
  type DynamicLightSource,
} from "../fx/DynamicLights";
import { spawnBurst } from "../fx/Particles";
import { offerInteraction } from "../game/interactions";
import { playerPosition } from "../game/player-state";
import { wizardDistSqTo } from "../game/targets";
import { hostCommand, hostEvent } from "../net/channels";
import { registerSyncProvider } from "../net/entities";
import { isHost, useNet } from "../net/netStore";
import { session } from "../net/session";
import { getItemDef } from "./catalog";
import { rollLoot } from "./loot";
import { useGame } from "../state/gameStore";
import type { Vec3 } from "../world/types";

/** Dropped-loot manager under host authority: the floor authority rolls
 * drops and announces spawns; pickups are granted by the authority so an orb
 * can never be taken twice. All of it is typed net messages — pickup code has
 * no host/replica branches, and offline the same requests dispatch locally. */

interface Orb {
  id: string;
  defId: string;
  position: Vec3;
}

let orbCounter = 1;
let pushOrb: ((orb: Orb) => void) | null = null;
let takeOrbLocal: ((orbId: string, by: string) => void) | null = null;
let liveOrbs: (() => Orb[]) | null = null;

const orbSpawned = hostEvent<{ orbId: string; defId: string; pos: Vec3 }>(
  "orbSpawned",
  (d) => pushOrb?.({ id: d.orbId, defId: d.defId, position: d.pos }),
);

const orbTaken = hostEvent<{ orbId: string; by: string }>("orbTaken", (d) =>
  takeOrbLocal?.(d.orbId, d.by),
);

/** Grant radius. Pickups are offered within ~2.3 m; the slack covers the
 * requester's movement during one round trip. Anything farther is a client
 * trying to vacuum loot across the map. */
const TAKE_RANGE_SQ = 6 * 6;

const takeOrb = hostCommand<{ orbId: string }>("takeOrb", (d, meta) => {
  // First come, first served — grant only if the orb still exists and the
  // requesting wizard is actually standing at it.
  const orb = liveOrbs?.().find((o) => o.id === d.orbId);
  if (!orb) return;
  if (wizardDistSqTo(meta.from, orb.position[0], orb.position[1], orb.position[2]) > TAKE_RANGE_SQ)
    return;
  orbTaken.announce({ orbId: d.orbId, by: meta.from });
  // Host attestation makes the item bankable server-side for that player.
  session.attestGrant(meta.from, orb.defId);
});

/** Roll & drop loot at a position. Authority-only — replicas receive the
 * spawn event instead, so exactly one roll happens per kill/break. */
export function dropLoot(position: Vec3, floor: number, chance = 1): void {
  if (!isHost()) return;
  if (Math.random() > chance) return;
  const def = rollLoot(new Rng((Math.random() * 0xffffffff) >>> 0), floor);
  orbSpawned.announce({
    orbId: `orb_${orbCounter++}_${Math.random().toString(36).slice(2, 6)}`,
    defId: def.id,
    pos: position,
  });
}

export function LootOrbs() {
  const [orbs, setOrbs] = useState<Orb[]>([]);
  const orbsRef = useRef<Orb[]>([]);
  orbsRef.current = orbs;
  const floorSeed = useGame((s) => s.floorSeed);

  useEffect(() => {
    pushOrb = (orb) => setOrbs((prev) => (prev.some((o) => o.id === orb.id) ? prev : [...prev, orb]));
    takeOrbLocal = (orbId, by) => {
      setOrbs((prev) => {
        const orb = prev.find((o) => o.id === orbId);
        if (!orb) return prev;
        const myId = useNet.getState().playerId;
        if (by === myId || by === "self") {
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
    liveOrbs = () => orbsRef.current;
    // Late-join sync: ship the live orb list; the joiner spawns them silently.
    const unregister = registerSyncProvider("orbs", {
      collect: () => orbsRef.current,
      apply: (data) => {
        for (const orb of (data as Orb[]) ?? []) pushOrb?.(orb);
      },
    });
    return () => {
      pushOrb = null;
      takeOrbLocal = null;
      liveOrbs = null;
      unregister();
    };
  }, []);

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
        if (requested.current > 0) return;
        requested.current = 0.6; // throttle re-requests while awaiting grant
        takeOrb.request({ orbId: orb.id });
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
