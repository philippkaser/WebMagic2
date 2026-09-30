import { useFrame } from "@react-three/fiber";
import { BallCollider, CuboidCollider, CylinderCollider, RigidBody, type RapierRigidBody } from "@react-three/rapier";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Vector3 } from "three";
import { playHit } from "../../audio/sound";
import { explode } from "../../combat/damage";
import { spawnBurst } from "../../fx/Particles";
import { allocId, registerDynamicBody, registerHittable } from "../../game/registry";
import { dropLoot } from "../../items/LootOrbs";
import { isHost, selectIsHost, useNet } from "../../net/netStore";
import { registerEntity } from "../../net/replication";
import { session } from "../../net/session";
import { COLLISION } from "../../physics/groups";
import { getTextures } from "../../render/textures";
import type { PropKind, Vec3 } from "../types";

const PROP_GROUPS = COLLISION.prop;

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
 * sometimes hide loot — and barrels go up violently. The floor host owns
 * their physics and health; replicas interpolate and mirror breaks. */
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
  const host = useNet(selectIsHost);
  const spec = SPECS[kind];
  const hp = useRef(spec.hp);
  const deadRef = useRef(false);
  const [dead, setDead] = useState(false);
  const target = useMemo(() => new Vector3(...position), [position]);
  const hasSnap = useRef(false);

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
        if (!remote && isHost()) {
          dropLoot([t.x, Math.max(t.y, 0.5), t.z], floor, spec.lootChance);
          session.sendEntityEvent({ k: "propBroken", id: entityId });
        }
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
    [entityId, floor, position, spec],
  );

  const applyDamage = useCallback(
    (damage: number, impulse: { x: number; y: number; z: number }) => {
      if (deadRef.current) return;
      hp.current -= damage;
      body.current?.applyImpulse(impulse, true);
      if (hp.current <= 0) kill(false);
    },
    [kill],
  );

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
        if (isHost()) applyDamage(damage, impulse);
        else session.sendHit(entityId, damage, impulse);
      },
    });
    const unregisterEntity = registerEntity({
      id: entityId,
      snap: () => {
        if (deadRef.current) return null;
        const t = body.current?.translation();
        return t ? { id: entityId, p: [t.x, t.y, t.z], hp: hp.current } : null;
      },
      applyHit: applyDamage,
      applySnap: (s) => {
        target.set(s.p[0], s.p[1], s.p[2]);
        hasSnap.current = true;
        if (s.hp !== undefined) hp.current = s.hp;
      },
      onEvent: (ev) => {
        // "death" arrives via late-join stateSync; "propBroken" live.
        if (ev.k === "propBroken" || ev.k === "death") kill(true, ev.silent);
      },
    });
    const unregisterBody = b ? registerDynamicBody(b) : undefined;
    return () => {
      unregisterHit();
      unregisterEntity();
      unregisterBody?.();
    };
  }, [dead, kill, applyDamage, entityId, target]);

  // Replica: glide toward the host's authoritative position.
  useFrame((_, dt) => {
    const b = body.current;
    if (host || !b || deadRef.current || !hasSnap.current) return;
    const t = b.translation();
    const k = Math.min(1, dt * 9);
    b.setNextKinematicTranslation({
      x: t.x + (target.x - t.x) * k,
      y: t.y + (target.y - t.y) * k,
      z: t.z + (target.z - t.z) * k,
    });
  });

  if (dead) return null;
  return (
    <RigidBody
      ref={body}
      position={position}
      type={host ? "dynamic" : "kinematicPosition"}
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
