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
import { Group, MeshStandardMaterial, PointLight } from "three";
import { playPortal } from "../audio/sound";
import { GROUPS } from "../core/config";
import { Rng, hashSeed } from "../core/rng";
import { explode } from "../combat/damage";
import { flashLight, spawnBurst } from "../fx/Particles";
import { offerInteraction } from "../game/interactions";
import { playerPosition } from "../game/player-state";
import { allocId, registerDynamicBody, registerHittable } from "../game/registry";
import { rollLoot } from "../items/loot";
import { spawnLootOrb } from "../items/LootOrbs";
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
 * sometimes hide loot — and barrels go up violently. */
export function Breakable({ kind, position, floor }: { kind: PropKind; position: Vec3; floor: number }) {
  const body = useRef<RapierRigidBody>(null);
  const spec = SPECS[kind];
  const hp = useRef(spec.hp);
  const deadRef = useRef(false);
  const [dead, setDead] = useState(false);

  const kill = useCallback(() => {
    if (deadRef.current) return;
    deadRef.current = true;
    const t = body.current?.translation() ?? { x: position[0], y: position[1], z: position[2] };
    spawnBurst({
      position: [t.x, t.y, t.z],
      count: 22,
      color: spec.shards,
      speed: 5,
      ttl: 0.9,
      size: 0.09,
    });
    if (Math.random() < spec.lootChance) {
      const def = rollLoot(new Rng((Math.random() * 0xffffffff) >>> 0), floor);
      spawnLootOrb([t.x, Math.max(t.y, 0.5), t.z], def.id);
    }
    if (spec.explodes) {
      // Defer so the chain reaction never re-enters this hit handler.
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
        }),
      );
    }
    setDead(true);
  }, [floor, position, spec]);

  useEffect(() => {
    if (dead) return;
    const b = body.current;
    const unregisterHit = registerHittable({
      id: allocId(),
      team: "prop",
      getPosition: () => body.current?.translation() ?? { x: 0, y: -999, z: 0 },
      hit: (damage, impulse) => {
        if (deadRef.current) return;
        hp.current -= damage;
        body.current?.applyImpulse(impulse, true);
        if (hp.current <= 0) kill();
      },
    });
    const unregisterBody = b ? registerDynamicBody(b) : undefined;
    return () => {
      unregisterHit();
      unregisterBody?.();
    };
  }, [dead, kill]);

  if (dead) return null;
  return (
    <RigidBody ref={body} position={position} colliders={false} linearDamping={0.2} angularDamping={0.4}>
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

/** Wall torch: flickering warm light, glowing ember head, drifting sparks. */
export function Torch({ position }: { position: Vec3 }) {
  const light = useRef<PointLight>(null);
  const emberClock = useRef(Math.random());
  const seed = useMemo(() => hashSeed(position.join(",")) % 100, [position]);

  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime + seed;
    if (light.current) {
      light.current.intensity =
        7 + Math.sin(t * 9.3) * 1.4 + Math.sin(t * 23.7) * 0.9 + Math.sin(t * 3.1) * 0.9;
    }
    emberClock.current -= dt;
    if (emberClock.current <= 0) {
      emberClock.current = 0.16 + Math.random() * 0.12;
      spawnBurst({
        position: [position[0], position[1] + 0.12, position[2]],
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
    <group position={position}>
      <mesh position={[0, -0.22, 0]} rotation={[0.22, 0, 0]}>
        <cylinderGeometry args={[0.03, 0.045, 0.5, 6]} />
        <meshStandardMaterial color="#3d2c1c" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.08, 0.05]}>
        <sphereGeometry args={[0.09, 8, 6]} />
        <meshStandardMaterial color="#200" emissive="#ff8b3d" emissiveIntensity={4.5} toneMapped={false} />
      </mesh>
      <pointLight ref={light} position={[0, 0.25, 0.2]} color="#ff9a4d" intensity={7} distance={10} decay={1.9} />
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
  const sparkClock = useRef(0);

  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime;
    if (disc.current) {
      disc.current.emissiveIntensity = locked ? 0.35 : 1.9 + Math.sin(t * 2.2) * 0.5;
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
      <pointLight
        position={[0, 1.6, 0.8]}
        color={color}
        intensity={locked ? 1.5 : 9}
        distance={12}
        decay={1.9}
      />
    </group>
  );
}

/** Guaranteed floor treasure — the item is rolled deterministically from the
 * floor seed, so everyone in a shared instance sees the same reward. */
export function TreasurePedestal({ position, floor, seed }: { position: Vec3; floor: number; seed: number }) {
  const def = useMemo(() => rollLoot(new Rng((seed ^ 0x9c67f3a1) >>> 0), floor), [seed, floor]);
  const [taken, setTaken] = useState(false);
  const orb = useRef<Group>(null);

  useFrame(({ clock }) => {
    if (taken) return;
    const g = orb.current;
    if (g) {
      g.position.y = 1.45 + Math.sin(clock.elapsedTime * 2) * 0.09;
      g.rotation.y = clock.elapsedTime * 1.4;
    }
    const d2 =
      (playerPosition.x - position[0]) ** 2 + (playerPosition.z - position[2]) ** 2;
    if (d2 < 6) {
      offerInteraction(`E — Take ${def.name}  (${def.desc})`, d2, () => {
        useGame.getState().equipItem(def.id);
        spawnBurst({
          position: [position[0], position[1] + 1.5, position[2]],
          count: 20,
          color: [def.color, "#ffffff"],
          speed: 4,
          ttl: 0.7,
          size: 0.08,
        });
        flashLight([position[0], position[1] + 1.5, position[2]], def.color, 18);
        setTaken(true);
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
        <>
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
          <pointLight position={[0, 1.6, 0]} color={def.color} intensity={4} distance={7} decay={2} />
        </>
      )}
    </group>
  );
}
