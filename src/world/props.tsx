import { useFrame } from "@react-three/fiber";
import { CuboidCollider, RigidBody, type RapierRigidBody } from "@react-three/rapier";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Group, MeshStandardMaterial, Vector3 } from "three";
import { playHit, playPortal, playSealBreak, playSealedTouch } from "../audio/sound";
import { hashSeed } from "../core/rng";
import { explode, sanitizeHit, type HitData } from "../weapons/damage";
import {
  addLightSource,
  flashLight,
  removeLightSource,
  type DynamicLightSource,
} from "../fx/DynamicLights";
import { shatterFx, torchEmberFx, torchSmokeFx, torchSparkFx, runeBurstFx, soulRiseFx } from "../fx/effects";
import { addFlame, removeFlame, type FlameHandle } from "../fx/Flames";
import { spawnBurst } from "../fx/Particles";
import { bodyProps, SpecCollider } from "../game/bodies";
import { offerInteraction } from "../game/interactions";
import { playerPosition } from "../game/player-state";
import { allocId, registerDynamicBody, registerHittable } from "../game/registry";
import { wizardDistSqTo } from "../game/targets";
import { resolveItem } from "../items/catalog";
import { treasureItem } from "../items/dropTables";
import { reportLoot } from "../items/LootOrbs";
import { TREASURE_ORB } from "../items/lootBook";
import { hostCommand, hostEvent } from "../net/channels";
import { registerSyncProvider } from "../net/entities";
import { isHost, useNet } from "../net/netStore";
import { session } from "../net/session";
import { useNetBody } from "../net/NetSystems";
import { PROP_BODIES, RIFT_STONES, WORLD_GROUPS } from "../sim/bodies";
import { useGame } from "../state/gameStore";
import { registerPortalAnchor } from "../transition/portals";
import { smoothstep } from "../transition/timeline";
import { isTraveling } from "../transition/travel";
import { PEDESTAL_ORB_Y, PedestalModel } from "../render/models/PedestalModel";
import { RIFT_Y, PortalModel, newPortalDrive, riftActivity } from "../render/models/PortalModel";
import { BarrelModel, CrateModel, PotModel } from "../render/models/PropModels";
import { TORCH_EMBER_INTENSITY, TorchModel } from "../render/models/TorchModel";
import type { PropKind, Vec3 } from "./types";

interface PropSpec {
  hp: number;
  shards: string[];
  explodes: boolean;
}

const SPECS: Record<PropKind, PropSpec> = {
  crate: { hp: 26, shards: ["#a8743c", "#6b4a24", "#8a5c2e"], explodes: false },
  barrel: { hp: 42, shards: ["#8a5c2e", "#5a3a1c", "#6e6e74"], explodes: true },
  pot: { hp: 6, shards: ["#c98d5f", "#8a5a3a", "#e0b48a"], explodes: false },
};

/** Debris amount per prop (a pot is a handful of sherds, a barrel a lot of
 * staves and hoops). */
const SHATTER_SCALE: Record<PropKind, number> = { crate: 1, barrel: 1.2, pot: 0.75 };

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
        // Tumbling lit chunks that bounce and settle, and a puff of dust.
        shatterFx(t, spec.shards, SHATTER_SCALE[kind]);
        // What it hid is the loot book's roll; the authority reports the break.
        if (!remote) reportLoot(entityId, { kind: "prop", prop: kind }, [t.x, Math.max(t.y, 0.5), t.z]);
        if (spec.explodes) {
          // Defer so the chain reaction never re-enters this hit handler. A
          // replicated break explodes cosmetically vs entities (the host's
          // copy is authoritative) but still hurts and shoves the local player.
          const at: Vec3 = [t.x, t.y, t.z];
          queueMicrotask(() =>
            explode({
              position: at,
              radius: 3.4,
              damage: 26,
              impulse: 28,
              team: "neutral",
              color: "#ff9a3c",
              particles: 36,
              light: 40,
              remote,
            }),
          );
        }
      }
      setDead(true);
    },
    [floor, position, spec, kind],
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
        const d = sanitizeHit(data, floor);
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
        const at = body.current?.translation();
        playHit(at ? [at.x, at.y, at.z] : undefined);
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
    <RigidBody ref={body} position={position} {...bodyProps(PROP_BODIES[kind])} type={net.bodyType}>
      <SpecCollider spec={PROP_BODIES[kind]} />
      {kind === "crate" && <CrateModel />}
      {kind === "barrel" && <BarrelModel />}
      {kind === "pot" && <PotModel seed={entityId} />}
    </RigidBody>
  );
}

/** Wall torch: a living shader flame (fx/Flames) over the glowing ember head
 * of render/models/TorchModel, a flickering light from the dynamic pool, and
 * what a fire sheds — rising embers, a thread of lit smoke, the odd popping
 * spark. Light, ember and flame all breathe on one flicker. `color` /
 * `intensity` let each depth biome burn its own fire (teal in the Drowned
 * Halls, small and warm in the Hollow). */
/** Torches farther than this (m) from the player stop shedding particles. */
const TORCH_FX_RANGE_SQ = 22 * 22;

/** How far world gen pushes a wall torch from its tile centre toward the
 * wall (gen/population.ts: TILE × 0.42); tile centres sit on odd metres. */
const TORCH_INSET = 0.84;

/** The bracket direction for a torch at `position`: dungeon torches hang on
 * the north or south edge of a room, inset from the tile centre toward the
 * wall, so the inset's sign says which wall (yaw 0 → bracket to −z/north,
 * π → +z/south). Anything else (village posts) stands free: null. */
export function torchWallYaw(position: Vec3): number | null {
  const z = position[2];
  const centre = Math.round((z - 1) / 2) * 2 + 1;
  const dz = z - centre;
  if (Math.abs(Math.abs(dz) - TORCH_INSET) > 0.05) return null;
  return dz < 0 ? 0 : Math.PI;
}

export function Torch({
  position,
  color = "#ff9a4d",
  intensity = 1,
}: {
  position: Vec3;
  color?: string;
  intensity?: number;
}) {
  const group = useRef<Group>(null);
  const ember = useRef<MeshStandardMaterial>(null);
  const light = useRef<DynamicLightSource | null>(null);
  const worldPos = useRef(new Vector3(...position));
  const emberClock = useRef(Math.random());
  const smokeClock = useRef(Math.random() * 0.5);
  const sparkClock = useRef(1 + Math.random() * 4);
  const flame = useRef<FlameHandle | null>(null);
  const top = useRef(new Vector3());
  const seed = useMemo(() => hashSeed(position.join(",")) % 100, [position]);
  const wallYaw = useMemo(() => torchWallYaw(position), [position]);

  useEffect(() => {
    // Torches can be nested (village posts) — register the light at the
    // torch's *world* position.
    const g = group.current!;
    g.updateWorldMatrix(true, false);
    g.getWorldPosition(worldPos.current);
    const src = addLightSource({
      position: [worldPos.current.x, worldPos.current.y + 0.25, worldPos.current.z + 0.2],
      color,
      intensity: 7 * intensity,
      distance: 10,
      priority: 1,
    });
    light.current = src;
    // The flame stands on the ember head (TorchModel: ember at y 0.08,
    // z 0.05); weaker biome fires burn smaller.
    const w = worldPos.current;
    const f = addFlame({
      position: [w.x, w.y + 0.07, w.z + 0.05],
      color,
      scale: 0.62 * (0.7 + 0.3 * intensity),
    });
    flame.current = f;
    top.current.set(w.x, w.y + 0.07 + f.scale * 0.8, w.z + 0.05);
    return () => {
      removeLightSource(src);
      light.current = null;
      removeFlame(f);
      flame.current = null;
    };
  }, [position, color, intensity]);

  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime + seed;
    const flicker = 7 + Math.sin(t * 9.3) * 1.4 + Math.sin(t * 23.7) * 0.9 + Math.sin(t * 3.1) * 0.9;
    if (light.current) light.current.intensity = flicker * intensity;
    // The flame breathes with its light (a quarter of the swing, so the
    // ember never looks like it's going out).
    if (ember.current) {
      ember.current.emissiveIntensity = TORCH_EMBER_INTENSITY * (0.75 + (0.25 * flicker) / 7);
    }
    if (flame.current) flame.current.intensity = (0.72 + (0.28 * flicker) / 7) * (0.8 + 0.2 * intensity);

    // What the fire sheds — only near the player: a distant torch's embers
    // are sub-pixel and fogged anyway, so they'd be budget spent on nothing.
    const w = worldPos.current;
    const dx = w.x - playerPosition.x;
    const dz = w.z - playerPosition.z;
    if (dx * dx + dz * dz > TORCH_FX_RANGE_SQ) return;
    emberClock.current -= dt;
    if (emberClock.current <= 0) {
      emberClock.current = 0.2 + Math.random() * 0.25;
      torchEmberFx(top.current, color);
    }
    smokeClock.current -= dt;
    if (smokeClock.current <= 0) {
      smokeClock.current = 0.45 + Math.random() * 0.3;
      torchSmokeFx(top.current);
    }
    sparkClock.current -= dt;
    if (sparkClock.current <= 0) {
      sparkClock.current = 2 + Math.random() * 4;
      torchSparkFx(top.current, color);
    }
  });

  return (
    <group ref={group} position={position}>
      <TorchModel emberRef={ember} emberColor={color} wallYaw={wallYaw} />
    </group>
  );
}

/** Rift stones are architecture: solid to wizards, monsters, spells and
 * tumbling props alike. */
/** Interactive rift. The look is render/models/PortalModel (the tear, its
 * mote swarm, the rune dais and standing stones); this is the behaviour: the
 * pooled light, sparks thrown off the tear's rim, the stones' colliders, the
 * prompt, and the numbers that drive the wound (proximity, the seal, the
 * surge when a journey starts here). While `locked` the wound is nearly shut
 * — a dim slit that refuses use; trying it makes it flinch; when it unlocks
 * mid-floor (the Warden falls) the seal breaks and it rips open. Open rifts
 * register a travel anchor so the journey (transition/) tears open around
 * this one. */
export function Portal({
  position,
  color,
  prompt,
  onUse,
  locked = false,
  lockedPrompt = "The rift is sealed…",
}: {
  position: Vec3;
  color: string;
  prompt: string;
  onUse: () => void;
  locked?: boolean;
  lockedPrompt?: string;
}) {
  // Created once: the model reads it every frame, this behaviour writes it.
  const [drive] = useState(() => newPortalDrive(locked));
  const light = useRef<DynamicLightSource | null>(null);
  const sparkClock = useRef(0);
  const wasLocked = useRef(locked);
  // Reusable burst options (rim sparks) — no per-frame garbage.
  const rim = useMemo(
    () => ({
      position: [0, 0, 0] as [number, number, number],
      count: 1,
      color,
      speed: 0.4,
      upward: 0.7,
      ttl: 0.9,
      size: 0.05,
      gravity: 0,
      drag: 0.5,
      style: "spark" as const,
    }),
    [color],
  );

  useEffect(() => {
    const src = addLightSource({
      position: [position[0], position[1] + RIFT_Y - 0.1, position[2] + 0.8],
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

  useEffect(() => {
    if (locked) return;
    return registerPortalAnchor({
      x: position[0],
      y: position[1] + RIFT_Y,
      z: position[2],
      surge: () => {
        drive.surge = 1;
      },
    });
  }, [position, locked, drive]);

  useFrame(({ clock }, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const t = clock.elapsedTime;
    const cx = position[0];
    const cy = position[1] + RIFT_Y;
    const cz = position[2];

    // The seal: holds at 1 while locked; tears open over ~1.3 s once
    // unlocked (the model eases the wound's width along it).
    if (wasLocked.current && !locked) {
      playSealBreak();
      spawnBurst({ position: [cx, cy, cz], count: 40, color: [color, "#ffffff"], speed: 7, upward: 1, ttl: 1, size: 0.08, gravity: -6, style: "spark" });
      runeBurstFx([cx, position[1] + 0.25, cz], color);
      flashLight([cx, cy, cz + 0.6], color, 34, 14);
    }
    wasLocked.current = locked;
    drive.seal = locked ? 1 : Math.max(0, drive.seal - dt / 1.3);
    drive.surge = Math.max(0, drive.surge - dt * 0.8);
    drive.refusal = Math.max(0, drive.refusal - dt * 1.8);

    const dx = playerPosition.x - cx;
    const dz = playerPosition.z - cz;
    const d2 = dx * dx + dz * dz;
    const near = 1 - smoothstep(1.4, 9, Math.sqrt(d2));
    drive.proximity += (near - drive.proximity) * Math.min(1, dt * 3);
    const prox = drive.proximity;
    const act = riftActivity(drive.seal);

    if (light.current) {
      light.current.intensity =
        act * (8 + prox * 5 + drive.surge * 16 + Math.sin(t * 2.2) * 1.2) +
        drive.refusal * 6 +
        4 * drive.seal * (1 - drive.seal) * 20;
    }

    // Sparks thrown off the tear's rim (in its facing plane) — more of them
    // as you come close; only near the player: far away they're a few pixels
    // in the fog, and every one costs the shared particle pool a slot.
    if (!locked && d2 < PORTAL_FX_RANGE_SQ) {
      sparkClock.current -= dt;
      if (sparkClock.current <= 0) {
        sparkClock.current = 0.09 / (1 + prox * 1.5);
        const a = Math.random() * Math.PI * 2;
        const across = Math.cos(a) * 0.75 * act;
        rim.position[0] = cx + Math.cos(drive.yaw) * across;
        rim.position[1] = cy + Math.sin(a) * 1.6;
        rim.position[2] = cz - Math.sin(drive.yaw) * across;
        spawnBurst(rim);
      }
    }

    if (d2 < 7 && !isTraveling()) {
      // Low on the tear's face, in front of it: readable from the dais
      // without craning up past the wound.
      const at: [number, number, number] = [position[0], position[1] + 3.1, position[2]];
      if (locked) {
        offerInteraction(lockedPrompt, d2, () => {
          playSealedTouch();
          drive.refusal = 1;
        }, at);
      } else {
        offerInteraction(
          prompt,
          d2,
          () => {
            playPortal(position);
            onUse();
          },
          at,
        );
      }
    }
  });

  return (
    <group position={position}>
      <PortalModel color={color} drive={drive} />
      {/* The standing stones are solid; the dais stays walk-through. */}
      <RigidBody type="fixed" colliders={false}>
        {RIFT_STONES.map((s, i) => (
          <CuboidCollider key={i} position={s.pos} args={s.half} collisionGroups={WORLD_GROUPS} />
        ))}
      </RigidBody>
    </group>
  );
}

/** Beyond this (m, squared) a rift throws no sparks. */
const PORTAL_FX_RANGE_SQ = 20 * 20;

// ── Floor treasure networking ────────────────────────────────────────────────
// One treasure per floor, first come first served, granted by the authority.
// The take request and the taken fact are plain typed net messages — no
// isHost branching at the interaction site, and single-player is the same
// code path (requests dispatch locally on the host).

let consumeTreasure: ((by: string, silent: boolean) => void) | null = null;
let treasureTakenNow: (() => boolean) | null = null;
let treasurePos: Vec3 | null = null;

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
  // The treasure is an orb in the floor's loot book from the start: the book
  // grants it to whoever the host says took it, once.
  session.claimOrb(meta.from, TREASURE_ORB);
});

/** Guaranteed floor treasure — the item is rolled deterministically from the
 * floor seed, so everyone in a shared instance sees the same reward. */
export function TreasurePedestal({ position, floor, seed }: { position: Vec3; floor: number; seed: number }) {
  // Deterministic full roll (base + possible enchantment) from the floor
  // seed — everyone in the instance sees the same reward.
  const item = useMemo(() => resolveItem(treasureItem(seed, floor)), [seed, floor]);
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
          style: "glow",
        });
        soulRiseFx([position[0], position[1] + 1.2, position[2]], def.color, 14);
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
      g.position.y = PEDESTAL_ORB_Y + Math.sin(clock.elapsedTime * 2) * 0.09;
      g.rotation.y = clock.elapsedTime * 1.4;
    }
    requested.current -= dt;
    const d2 =
      (playerPosition.x - position[0]) ** 2 + (playerPosition.z - position[2]) ** 2;
    if (d2 < 6) {
      // Gate on inventory space BEFORE requesting — a granted treasure that
      // can't be held would be lost.
      if (!useGame.getState().canAcquire(item.itemId)) {
        offerInteraction(`Inventory full — can't take ${item.name}`, d2, () => {}, [
          position[0],
          position[1] + 2.1,
          position[2],
        ]);
        return;
      }
      const desc = item.affix ? `${item.affix.desc} · ${def.desc}` : def.desc;
      offerInteraction(
        `E — Take ${item.name}  (${desc})`,
        d2,
        () => {
          if (takenRef.current || requested.current > 0) return;
          requested.current = 0.6; // throttle re-requests while awaiting grant
          takeTreasure.request({});
        },
        [position[0], position[1] + 2.1, position[2]],
      );
    }
  });

  return (
    <group position={position}>
      <PedestalModel color={def.color} taken={taken} orbRef={orb} />
    </group>
  );
}
