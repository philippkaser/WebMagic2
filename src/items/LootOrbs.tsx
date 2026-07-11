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
import { wizardDistSqTo } from "../game/targets";
import { hostCommand, hostEvent } from "../net/channels";
import { registerSyncProvider } from "../net/entities";
import { isHost, useNet } from "../net/netStore";
import { session } from "../net/session";
import { getItemDef, resolveItem } from "./catalog";
import { bossGoldAmount, enemyGoldAmount, propGoldAmount } from "./economy";
import { rollDrop } from "./loot";
import { useGame } from "../state/gameStore";
import type { Vec3 } from "../world/types";

/** Dropped-loot manager under host authority: the floor authority rolls
 * drops and announces spawns; pickups are granted by the authority so an orb
 * can never be taken twice. All of it is typed net messages — pickup code has
 * no host/replica branches, and offline the same requests dispatch locally.
 *
 * Two orb families share the pipeline: ITEM orbs (E to take, routed into the
 * inventory) and GOLD orbs (vacuumed automatically by walking close). */

interface Orb {
  id: string;
  /** Item orb when set; gold orb when null. */
  defId: string | null;
  gold: number;
  position: Vec3;
}

let orbCounter = 1;
let pushOrb: ((orb: Orb) => void) | null = null;
let takeOrbLocal: ((orbId: string, by: string) => void) | null = null;
let liveOrbs: (() => Orb[]) | null = null;

const orbSpawned = hostEvent<{ orbId: string; defId: string | null; gold: number; pos: Vec3 }>(
  "orbSpawned",
  (d) => pushOrb?.({ id: d.orbId, defId: d.defId ?? null, gold: d.gold ?? 0, position: d.pos }),
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
  // Host attestation makes the pickup bankable server-side for that player.
  if (orb.defId) session.attestGrant(meta.from, orb.defId);
  else if (orb.gold > 0) session.attestGold(meta.from, orb.gold);
});

/** Player-dropped items become real orbs at the dropper's feet — anyone on
 * the floor can take them, which makes dropping double as gifting. The host
 * validates the position against the dropper like any pickup. */
const dropOrb = hostCommand<{ defId: string; pos: Vec3 }>("dropOrb", (d, meta) => {
  if (typeof d.defId !== "string" || !Array.isArray(d.pos)) return;
  try {
    resolveItem(d.defId); // validates base AND affix
  } catch {
    return; // unknown id from a hacked/newer client — refuse to spawn it
  }
  if (wizardDistSqTo(meta.from, d.pos[0], d.pos[1], d.pos[2]) > TAKE_RANGE_SQ) return;
  announceOrb(d.defId, 0, d.pos);
});

function announceOrb(defId: string | null, gold: number, pos: Vec3): void {
  orbSpawned.announce({
    orbId: `orb_${orbCounter++}_${Math.random().toString(36).slice(2, 6)}`,
    defId,
    gold,
    pos,
  });
}

/** Roll & drop loot at a position. Authority-only — replicas receive the
 * spawn event instead, so exactly one roll happens per kill/break. */
export function dropLoot(position: Vec3, floor: number, chance = 1): void {
  if (!isHost()) return;
  if (Math.random() > chance) return;
  // Full item roll: base + possible enchantment (rarity scales with depth).
  const itemId = rollDrop(new Rng((Math.random() * 0xffffffff) >>> 0), floor);
  announceOrb(itemId, 0, position);
}

/** Drop one SPECIFIC item (boss feathers, scripted rewards) — no roll. */
export function dropItem(defId: string, position: Vec3): void {
  if (!isHost()) return;
  announceOrb(defId, 0, position);
}

/** Scatter coins at a position. Amounts live in items/economy.ts — the one
 * balance sheet — scaled by who dropped them. Authority-only, like items. */
export function dropGold(
  position: Vec3,
  floor: number,
  chance: number,
  source: "enemy" | "prop" | "boss",
): void {
  if (!isHost()) return;
  if (Math.random() > chance) return;
  const rng = new Rng((Math.random() * 0xffffffff) >>> 0);
  const amount =
    source === "boss"
      ? bossGoldAmount(rng, floor)
      : source === "enemy"
        ? enemyGoldAmount(rng, floor)
        : propGoldAmount(rng, floor);
  if (amount > 0) announceOrb(null, amount, position);
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
          if (orb.defId) useGame.getState().acquireItem(orb.defId);
          else if (orb.gold > 0) useGame.getState().addGold(orb.gold);
        }
        spawnBurst({
          position: [orb.position[0], orb.position[1] + 0.5, orb.position[2]],
          count: orb.defId ? 18 : 10,
          color: orb.defId ? [getItemDef(orb.defId).color, "#ffffff"] : ["#ffd24d", "#ffefb0"],
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
    // Inventory drops: scatter the stack around the player's feet.
    const offDrop = gameEvents.on("dropItems", ({ defId, qty }) => {
      for (let i = 0; i < Math.min(qty, 8); i++) {
        const a = Math.random() * Math.PI * 2;
        dropOrb.request({
          defId,
          pos: [
            playerPosition.x + Math.cos(a) * (0.6 + Math.random() * 0.4),
            Math.max(playerPosition.y - 0.5, 0.4),
            playerPosition.z + Math.sin(a) * (0.6 + Math.random() * 0.4),
          ],
        });
      }
    });
    return () => {
      pushOrb = null;
      takeOrbLocal = null;
      liveOrbs = null;
      unregister();
      offDrop();
    };
  }, []);

  // Loot left behind vanishes when the floor changes.
  useEffect(() => setOrbs([]), [floorSeed]);

  return (
    <>
      {orbs.map((orb) =>
        orb.defId ? <ItemOrb key={orb.id} orb={orb} /> : <GoldOrb key={orb.id} orb={orb} />,
      )}
    </>
  );
}

function ItemOrb({ orb }: { orb: Orb }) {
  const group = useRef<Group>(null);
  const light = useRef<DynamicLightSource | null>(null);
  const requested = useRef(0);
  const item = resolveItem(orb.defId!);
  const def = item.def;
  const [x, y, z] = orb.position;
  // Orbs hover gently DOWN to the floor — kills mid-air leave no sky loot.
  const fallY = useRef(y);

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
    fallY.current = Math.max(0, fallY.current - dt * 1.7);
    g.position.set(x, fallY.current + 0.35 + Math.sin(t * 2.4) * 0.12, z);
    g.rotation.y = t * 1.6;
    light.current?.position.copy(g.position);
    requested.current -= dt;

    const d2 = playerPosition.distanceToSquared(g.position);
    if (d2 < 5.5) {
      // A full inventory blocks the request client-side, BEFORE the grant —
      // a granted orb is gone forever, so never ask for what can't be held.
      if (!useGame.getState().canAcquire(orb.defId!)) {
        offerInteraction(`Inventory full — can't take ${item.name}`, d2, () => {});
        return;
      }
      const desc = item.affix ? `${item.affix.desc} · ${def.desc}` : def.desc;
      offerInteraction(`E — Take ${item.name}  (${desc})`, d2, () => {
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

/** Coins don't ask questions — walk close and they're yours. */
const GOLD_VACUUM_RANGE_SQ = 1.7 * 1.7;
const GOLD_COLOR = "#ffcf4d";

function GoldOrb({ orb }: { orb: Orb }) {
  const group = useRef<Group>(null);
  const light = useRef<DynamicLightSource | null>(null);
  const requested = useRef(0);
  const [x, y, z] = orb.position;
  const fallY = useRef(y);

  useEffect(() => {
    const src = addLightSource({
      position: [x, y + 0.4, z],
      color: GOLD_COLOR,
      intensity: 1.6,
      distance: 4,
      priority: 0,
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
    fallY.current = Math.max(0, fallY.current - dt * 1.7);
    g.position.set(x, fallY.current + 0.22 + Math.sin(t * 3.1 + x) * 0.06, z);
    g.rotation.y = t * 2.2;
    light.current?.position.copy(g.position);
    requested.current -= dt;

    if (requested.current <= 0 && playerPosition.distanceToSquared(g.position) < GOLD_VACUUM_RANGE_SQ) {
      requested.current = 0.6; // throttle while the grant round-trips
      takeOrb.request({ orbId: orb.id });
    }
  });

  return (
    <group ref={group} position={orb.position}>
      {/* A small heap of coins: three flattened discs. */}
      {([[0, 0, 0], [0.09, 0.05, 0.06], [-0.08, 0.1, -0.04]] as Vec3[]).map((p, i) => (
        <mesh key={i} position={p} rotation={[0.3 * i, i, 0]}>
          <cylinderGeometry args={[0.09, 0.09, 0.03, 8]} />
          <meshStandardMaterial
            color="#3a2a08"
            emissive={GOLD_COLOR}
            emissiveIntensity={2.2}
            toneMapped={false}
            metalness={0.6}
            roughness={0.3}
          />
        </mesh>
      ))}
    </group>
  );
}
