import { useFrame } from "@react-three/fiber";
import {
  BallCollider,
  CuboidCollider,
  CylinderCollider,
  interactionGroups,
  RigidBody,
  type RapierRigidBody,
} from "@react-three/rapier";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Group, MeshStandardMaterial, Vector3 } from "three";
import { playHit, playPortal } from "../audio/sound";
import { GROUPS } from "../core/config";
import { Rng, hashSeed } from "../core/rng";
import { explode, sanitizeHit, type HitData } from "../combat/damage";
import {
  addLightSource,
  flashLight,
  removeLightSource,
  type DynamicLightSource,
} from "../fx/DynamicLights";
import { spawnBurst } from "../fx/Particles";
import { offerInteraction } from "../game/interactions";
import { playerPosition } from "../game/player-state";
import { allocId, registerDynamicBody, registerHittable } from "../game/registry";
import { wizardDistSqTo } from "../game/targets";
import { GOLD_DROPS } from "../items/economy";
import { rollDrop } from "../items/loot";
import { resolveItem } from "../items/catalog";
import { dropGold, dropLoot } from "../items/LootOrbs";
import { hostCommand, hostEvent } from "../net/channels";
import { registerSyncProvider } from "../net/entities";
import { isHost, useNet } from "../net/netStore";
import { session } from "../net/session";
import { useNetBody } from "../net/NetSystems";
import { useGame } from "../state/gameStore";
import { getTextures } from "../render/textures";
import type { PropKind, Vec3 } from "./types";

const PROP_GROUPS = interactionGroups(GROUPS.PROP, [
  GROUPS.WORLD,
  GROUPS.PLAYER,
  GROUPS.ENEMY,
  GROUPS.FRIENDLY_PROJECTILE,
  GROUPS.ENEMY_PROJECTILE,
  GROUPS.PROP,
]);

interface PropSpec {
  hp: number;
  mass: number;
  shards: string[];
  lootChance: number;
  explodes: boolean;
}

const SPECS: Record<PropKind, PropSpec> = {
  crate: { hp: 26, mass: 1.1, shards: ["#a8743c", "#6b4a24"], lootChance: 0.08, explodes: false },
  barrel: { hp: 42, mass: 2, shards: ["#8a5c2e", "#ff9a3c"], lootChance: 0.08, explodes: true },
  pot: { hp: 6, mass: 0.4, shards: ["#c98d5f", "#8a5a3a"], lootChance: 0.12, explodes: false },
};

/** A physical, breakable prop. Every dungeon floor scatters these so rooms
 * double as a physics sandbox: they tumble when shoved, shatter under fire,
 * sometimes hide loot — and barrels go up violently. The floor authority owns
 * their physics and health; replicas mirror position AND rotation through the
 * replication framework, so tumbling looks identical everywhere. */
export function Breakable({
  kind,
  position,
  floor,
  entityId,
}: {
  kind: PropKind;
  position: Vec3;
  floor: number;
  entityId: string;
}) {
  const body = useRef<RapierRigidBody>(null);
  const spec = SPECS[kind];
  const hp = useRef(spec.hp);
  const deadRef = useRef(false);
  const [dead, setDead] = useState(false);

  const kill = useCallback(
    (remote: boolean, silent = false) => {
      if (deadRef.current) return;
      deadRef.current = true;
      const t = body.current?.translation() ?? { x: position[0], y: position[1], z: position[2] };
      if (!silent) {
        spawnBurst({
          position: [t.x, t.y, t.z],
          count: 22,
          color: spec.shards,
          speed: 5,
          ttl: 0.9,
          size: 0.09,
        });
        if (!remote) {
          dropLoot([t.x, Math.max(t.y, 0.5), t.z], floor, spec.lootChance);
          dropGold([t.x, Math.max(t.y, 0.5), t.z], floor, GOLD_DROPS.propChance, "prop");
        }
        if (spec.explodes) {
          // Defer so the chain reaction never re-enters this hit handler. A
          // replicated break explodes cosmetically vs entities (the host's
          // copy is authoritative) but still hurts and shoves the local player.
          const at: Vec3 = [t.x, t.y, t.z];
          queueMicrotask(() =>
            explode({
              position: at,
              radius: 3.9,
              damage: 30,
              impulse: 44,
              team: "neutral",
              color: "#ff9a3c",
              particles: 52,
              light: 52,
              remote,
            }),
          );
        }
      }
      setDead(true);
    },
    [floor, position, spec],
  );

  const net = useNetBody({
    id: entityId,
    body,
    rotation: true,
    enabled: !dead,
    fields: () => ({ hp: hp.current }),
    onFields: (f) => {
      if (f.hp !== undefined) hp.current = f.hp;
    },
    onCommand: (cmd, data) => {
      if (cmd === "hit") {
        const d = sanitizeHit(data);
        if (d) applyDamageRef.current(d.damage, d.impulse);
      }
    },
    onDespawn: (_data, catchup) => kill(true, catchup),
  });
  const netRef = useRef(net);
  netRef.current = net;

  const applyDamage = useCallback(
    (damage: number, impulse: { x: number; y: number; z: number }) => {
      if (deadRef.current) return;
      hp.current -= damage;
      body.current?.applyImpulse(impulse, true);
      if (hp.current <= 0) {
        kill(false);
        netRef.current.despawn();
      }
    },
    [kill],
  );
  const applyDamageRef = useRef(applyDamage);
  applyDamageRef.current = applyDamage;

  useEffect(() => {
    if (dead) return;
    const b = body.current;
    const unregisterHit = registerHittable({
      id: allocId(),
      team: "prop",
      getPosition: () => body.current?.translation() ?? { x: 0, y: -999, z: 0 },
      hit: (damage, impulse) => {
        if (deadRef.current) return;
        playHit();
        if (isHost()) {
          applyDamageRef.current(damage, impulse);
        } else {
          netRef.current.command("hit", { damage, impulse } satisfies HitData);
          // Predicted shove — the crate reacts the instant you hit it.
          netRef.current.predictImpulse(impulse);
        }
      },
    });
    const unregisterBody = b ? registerDynamicBody(b) : undefined;
    return () => {
      unregisterHit();
      unregisterBody?.();
    };
  }, [dead]);

  if (dead) return null;
  return (
    <RigidBody
      ref={body}
      position={position}
      type={net.bodyType}
      colliders={false}
      linearDamping={0.2}
      angularDamping={0.4}
    >
      {kind === "crate" && (
        <>
          <CuboidCollider args={[0.42, 0.42, 0.42]} mass={spec.mass} collisionGroups={PROP_GROUPS} />
          <CrateMesh />
        </>
      )}
      {kind === "barrel" && (
        <>
          <CylinderCollider args={[0.48, 0.4]} mass={spec.mass} collisionGroups={PROP_GROUPS} />
          <BarrelMesh />
        </>
      )}
      {kind === "pot" && (
        <>
          <BallCollider args={[0.3]} mass={spec.mass} collisionGroups={PROP_GROUPS} />
          <PotMesh />
        </>
      )}
    </RigidBody>
  );
}

function CrateMesh() {
  const tex = useMemo(() => getTextures("planks"), []);
  return (
    <mesh castShadow receiveShadow>
      <boxGeometry args={[0.84, 0.84, 0.84]} />
      <meshStandardMaterial map={tex.map} normalMap={tex.normalMap} roughness={0.85} />
    </mesh>
  );
}

function BarrelMesh() {
  const tex = useMemo(() => getTextures("barrel"), []);
  return (
    <mesh castShadow receiveShadow>
      <cylinderGeometry args={[0.36, 0.4, 0.96, 10]} />
      <meshStandardMaterial map={tex.map} normalMap={tex.normalMap} roughness={0.75} metalness={0.15} />
    </mesh>
  );
}

function PotMesh() {
  const tex = useMemo(() => getTextures("ceramic"), []);
  return (
    <group>
      <mesh castShadow receiveShadow scale={[1, 1.15, 1]}>
        <sphereGeometry args={[0.3, 10, 8]} />
        <meshStandardMaterial map={tex.map} normalMap={tex.normalMap} roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.36, 0]}>
        <cylinderGeometry args={[0.12, 0.16, 0.12, 8]} />
        <meshStandardMaterial map={tex.map} roughness={0.6} />
      </mesh>
    </group>
  );
}

/** Wall torch: flickering warm light (via the dynamic light pool), glowing
 * ember head, drifting sparks. */
export function Torch({ position }: { position: Vec3 }) {
  const group = useRef<Group>(null);
  const light = useRef<DynamicLightSource | null>(null);
  const worldPos = useRef(new Vector3(...position));
  const emberClock = useRef(Math.random());
  const seed = useMemo(() => hashSeed(position.join(",")) % 100, [position]);

  useEffect(() => {
    // Torches can be nested (village posts) — register the light at the
    // torch's *world* position.
    const g = group.current!;
    g.updateWorldMatrix(true, false);
    g.getWorldPosition(worldPos.current);
    const src = addLightSource({
      position: [worldPos.current.x, worldPos.current.y + 0.25, worldPos.current.z + 0.2],
      color: "#ff9a4d",
      intensity: 7,
      distance: 10,
      priority: 1,
    });
    light.current = src;
    return () => {
      removeLightSource(src);
      light.current = null;
    };
  }, [position]);

  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime + seed;
    if (light.current) {
      light.current.intensity =
        7 + Math.sin(t * 9.3) * 1.4 + Math.sin(t * 23.7) * 0.9 + Math.sin(t * 3.1) * 0.9;
    }
    emberClock.current -= dt;
    if (emberClock.current <= 0) {
      emberClock.current = 0.16 + Math.random() * 0.12;
      const w = worldPos.current;
      spawnBurst({
        position: [w.x, w.y + 0.12, w.z],
        count: 1,
        color: ["#ffb257", "#ff6b2e"],
        speed: 0.5,
        upward: 1.3,
        ttl: 0.8,
        size: 0.05,
        gravity: 0.6,
        drag: 0.4,
      });
    }
  });

  return (
    <group ref={group} position={position}>
      <mesh position={[0, -0.22, 0]} rotation={[0.22, 0, 0]}>
        <cylinderGeometry args={[0.03, 0.045, 0.5, 6]} />
        <meshStandardMaterial color="#3d2c1c" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.08, 0.05]}>
        <sphereGeometry args={[0.09, 8, 6]} />
        <meshStandardMaterial color="#200" emissive="#ff8b3d" emissiveIntensity={4.5} toneMapped={false} />
      </mesh>
    </group>
  );
}

/** Interactive portal ring. While `locked`, it burns dim and refuses use. */
export function Portal({
  position,
  color,
  prompt,
  onUse,
  locked = false,
  lockedPrompt = "The portal is sealed…",
}: {
  position: Vec3;
  color: string;
  prompt: string;
  onUse: () => void;
  locked?: boolean;
  lockedPrompt?: string;
}) {
  const disc = useRef<MeshStandardMaterial>(null);
  const group = useRef<Group>(null);
  const light = useRef<DynamicLightSource | null>(null);
  const sparkClock = useRef(0);

  useEffect(() => {
    const src = addLightSource({
      position: [position[0], position[1] + 1.6, position[2] + 0.8],
      color,
      intensity: 9,
      distance: 12,
      priority: 2,
    });
    light.current = src;
    return () => {
      removeLightSource(src);
      light.current = null;
    };
  }, [position, color]);

  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime;
    if (disc.current) {
      disc.current.emissiveIntensity = locked ? 0.35 : 1.9 + Math.sin(t * 2.2) * 0.5;
    }
    if (light.current) {
      light.current.intensity = locked ? 1.5 : 9 + Math.sin(t * 2.2) * 1.2;
    }
    if (group.current) group.current.rotation.z = t * (locked ? 0.06 : 0.35);

    sparkClock.current -= dt;
    if (sparkClock.current <= 0 && !locked) {
      sparkClock.current = 0.09;
      const a = Math.random() * Math.PI * 2;
      spawnBurst({
        position: [position[0] + Math.cos(a) * 1.1, position[1] + 1.5 + Math.sin(a) * 1.1, position[2]],
        count: 1,
        color,
        speed: 0.4,
        upward: 0.7,
        ttl: 0.9,
        size: 0.05,
        gravity: 0,
        drag: 0.5,
      });
    }

    const d2 =
      (playerPosition.x - position[0]) ** 2 + (playerPosition.z - position[2]) ** 2;
    if (d2 < 7) {
      if (locked) {
        offerInteraction(lockedPrompt, d2, () => {});
      } else {
        offerInteraction(prompt, d2, () => {
          playPortal();
          onUse();
        });
      }
    }
  });

  return (
    <group position={position}>
      {/* Steps */}
      <mesh position={[0, 0.12, 0]} receiveShadow>
        <boxGeometry args={[3.4, 0.24, 1.6]} />
        <meshStandardMaterial color="#4a4452" roughness={0.85} />
      </mesh>
      <group ref={group} position={[0, 1.5, 0]}>
        <mesh castShadow>
          <torusGeometry args={[1.15, 0.13, 8, 24]} />
          <meshStandardMaterial color="#2c2836" metalness={0.6} roughness={0.35} />
        </mesh>
        <mesh>
          <circleGeometry args={[1.05, 24]} />
          <meshStandardMaterial
            ref={disc}
            color="#05030a"
            emissive={color}
            emissiveIntensity={1.9}
            toneMapped={false}
            transparent
            opacity={0.92}
            side={2}
          />
        </mesh>
      </group>
    </group>
  );
}

// ── Floor treasure networking ────────────────────────────────────────────────
// One treasure per floor, first come first served, granted by the authority.
// The take request and the taken fact are plain typed net messages — no
// isHost branching at the interaction site, and single-player is the same
// code path (requests dispatch locally on the host).

let consumeTreasure: ((by: string, silent: boolean) => void) | null = null;
let treasureTakenNow: (() => boolean) | null = null;
let treasurePos: Vec3 | null = null;
let treasureDefId: string | null = null;

const treasureTaken = hostEvent<{ by: string }>("treasureTaken", (d) => {
  consumeTreasure?.(d.by, false);
});

/** Grant radius — interaction is offered within ~2.5 m; the slack covers one
 * round trip of movement. Farther requests are a client cheating. */
const TREASURE_RANGE_SQ = 6 * 6;

const takeTreasure = hostCommand<Record<string, never>>("takeTreasure", (_d, meta) => {
  if (treasureTakenNow?.()) return;
  const p = treasurePos;
  if (!p || wizardDistSqTo(meta.from, p[0], p[1], p[2]) > TREASURE_RANGE_SQ) return;
  treasureTaken.announce({ by: meta.from });
  // Host attestation makes the treasure bankable server-side for that player.
  if (treasureDefId) session.attestGrant(meta.from, treasureDefId);
});

/** Guaranteed floor treasure — the item is rolled deterministically from the
 * floor seed, so everyone in a shared instance sees the same reward. */
export function TreasurePedestal({ position, floor, seed }: { position: Vec3; floor: number; seed: number }) {
  // Deterministic full roll (base + possible enchantment) from the floor
  // seed — everyone in the instance sees the same reward.
  const item = useMemo(
    () => resolveItem(rollDrop(new Rng((seed ^ 0x9c67f3a1) >>> 0), floor)),
    [seed, floor],
  );
  const def = item.def;
  const [taken, setTaken] = useState(false);
  const takenRef = useRef(false);
  const requested = useRef(0);
  const orb = useRef<Group>(null);

  const consume = useCallback(
    (by: string, silent: boolean) => {
      if (takenRef.current) return;
      takenRef.current = true;
      setTaken(true);
      const myId = useNet.getState().playerId;
      if (by !== "" && (by === myId || by === "self")) useGame.getState().acquireItem(item.itemId);
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
    [def, item.itemId, position],
  );

  // Wire the module-level handlers + late-join sync while mounted.
  useEffect(() => {
    consumeTreasure = consume;
    treasureTakenNow = () => takenRef.current;
    treasurePos = position;
    treasureDefId = item.itemId;
    const unregister = registerSyncProvider("treasure", {
      collect: () => takenRef.current,
      apply: (data) => {
        if (data === true) consume("", true);
      },
    });
    return () => {
      consumeTreasure = null;
      treasureTakenNow = null;
      treasurePos = null;
      treasureDefId = null;
      unregister();
    };
  }, [consume, position, item.itemId]);

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

  useFrame(({ clock }, dt) => {
    if (taken) return;
    const g = orb.current;
    if (g) {
      g.position.y = 1.45 + Math.sin(clock.elapsedTime * 2) * 0.09;
      g.rotation.y = clock.elapsedTime * 1.4;
    }
    requested.current -= dt;
    const d2 =
      (playerPosition.x - position[0]) ** 2 + (playerPosition.z - position[2]) ** 2;
    if (d2 < 6) {
      // Gate on inventory space BEFORE requesting — a granted treasure that
      // can't be held would be lost.
      if (!useGame.getState().canAcquire(item.itemId)) {
        offerInteraction(`Inventory full — can't take ${item.name}`, d2, () => {});
        return;
      }
      const desc = item.affix ? `${item.affix.desc} · ${def.desc}` : def.desc;
      offerInteraction(`E — Take ${item.name}  (${desc})`, d2, () => {
        if (takenRef.current || requested.current > 0) return;
        requested.current = 0.6; // throttle re-requests while awaiting grant
        takeTreasure.request({});
      });
    }
  });

  return (
    <group position={position}>
      <mesh position={[0, 0.55, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.3, 0.42, 1.1, 8]} />
        <meshStandardMaterial color="#4e4658" roughness={0.8} />
      </mesh>
      {!taken && (
        <group ref={orb} position={[0, 1.45, 0]}>
          <mesh castShadow>
            <octahedronGeometry args={[0.26]} />
            <meshStandardMaterial
              color="#0c0c14"
              emissive={def.color}
              emissiveIntensity={2.8}
              toneMapped={false}
            />
          </mesh>
        </group>
      )}
    </group>
  );
}
