import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { Group, MeshStandardMaterial } from "three";
import { playHit, playPortal } from "../audio/sound";
import { floorScale } from "../core/config";
import { gameEvents } from "../core/events";
import { flashLight } from "../fx/DynamicLights";
import { spawnBurst } from "../fx/Particles";
import { playerPosition } from "../game/player-state";
import { combatActive, useGame } from "../state/gameStore";
import { getTrapDef } from "./trapCatalog";
import type { TrapKind, Vec3 } from "./types";

/** Dungeon traps. Behaviour lives here, tuning in trapCatalog.ts. Player
 * effects are LOCAL on each client (your health/position are yours — same
 * model as enemy contact damage), so spikes and warps need no networking.
 *
 * Guarded by combatActive(): live in the dungeon, and — dev builds only — in
 * the village dev arena. */
export function Trap({ kind, pos, floor }: { kind: TrapKind; pos: Vec3; floor: number }) {
  switch (kind) {
    case "spike":
      return <SpikeTrap pos={pos} floor={floor} />;
    case "warp":
      return <WarpTrap pos={pos} />;
  }
}

const SPIKE_OFFSETS: [number, number][] = [
  [-0.26, -0.26],
  [0.26, -0.26],
  [-0.26, 0.26],
  [0.26, 0.26],
  [0, 0],
];

/** A scab of dead flesh grown over the floor; the bone splinters underneath
 * stab up when something steps on it, then sink back and re-arm. */
function SpikeTrap({ pos, floor }: { pos: Vec3; floor: number }) {
  const def = getTrapDef("spike");
  const spikes = useRef<Group>(null);
  const armTimer = useRef(0);
  const pop = useRef(0);
  const scale = useMemo(() => floorScale(floor), [floor]);
  const r2 = def.radius * def.radius;

  useFrame((_, dt) => {
    armTimer.current -= dt;
    pop.current = Math.max(0, pop.current - dt * 3);
    if (spikes.current) spikes.current.position.y = -0.3 + pop.current * 0.36;
    if (!combatActive()) return;
    const dx = playerPosition.x - pos[0];
    const dz = playerPosition.z - pos[2];
    const dy = playerPosition.y - pos[1];
    if (dx * dx + dz * dz < r2 && Math.abs(dy) < 1.7 && armTimer.current <= 0) {
      armTimer.current = 1.2;
      pop.current = 1;
      useGame.getState().takeDamage(def.baseDamage * scale.enemyDamage);
      playHit();
      spawnBurst({
        position: [pos[0], pos[1] + 0.15, pos[2]],
        count: 10,
        color: ["#c8b898", "#a02020"],
        speed: 3,
        ttl: 0.4,
        size: 0.06,
      });
    }
  });

  return (
    <group position={pos}>
      {/* The scab — a shade off the slabs, easy to miss until it bites. */}
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0.7]} receiveShadow>
        <circleGeometry args={[def.radius, 7]} />
        <meshStandardMaterial color="#2a1418" roughness={0.95} />
      </mesh>
      {/* Old stains around the rim. */}
      <mesh position={[0, 0.025, 0]} rotation={[-Math.PI / 2, 0, 1.9]}>
        <ringGeometry args={[def.radius * 0.7, def.radius * 0.92, 6]} />
        <meshStandardMaterial color="#3a0c10" roughness={1} transparent opacity={0.8} side={2} />
      </mesh>
      <group ref={spikes} position={[0, -0.3, 0]}>
        {SPIKE_OFFSETS.map(([x, z], i) => (
          <mesh key={i} position={[x, 0.2, z]} rotation={[(i % 3) * 0.08, 0, (i % 2) * -0.1]} castShadow>
            <coneGeometry args={[0.06, 0.42 + (i % 2) * 0.08, 4]} />
            <meshStandardMaterial color="#b8a888" roughness={0.7} flatShading />
          </mesh>
        ))}
      </group>
    </group>
  );
}

/** A hairline tear in the floor that flings whoever steps on it down to the
 * next floor. Local and one-shot — each wizard triggers their own descent. */
function WarpTrap({ pos }: { pos: Vec3 }) {
  const def = getTrapDef("warp");
  const disc = useRef<MeshStandardMaterial>(null);
  const shards = useRef<Group>(null);
  const triggered = useRef(false);
  const r2 = def.radius * def.radius;

  useFrame(({ clock }, dt) => {
    if (disc.current) disc.current.emissiveIntensity = 1.2 + Math.sin(clock.elapsedTime * 3) * 0.5;
    if (shards.current) shards.current.rotation.y += dt * 0.6;
    if (!combatActive() || triggered.current) return;
    const dx = playerPosition.x - pos[0];
    const dz = playerPosition.z - pos[2];
    if (dx * dx + dz * dz < r2) {
      triggered.current = true;
      spawnBurst({
        position: [pos[0], pos[1] + 0.6, pos[2]],
        count: 22,
        color: ["#b46bff", "#ffffff"],
        speed: 5,
        ttl: 0.7,
        size: 0.08,
      });
      flashLight([pos[0], pos[1] + 0.6, pos[2]], "#b46bff", 20);
      playPortal();
      // descend() requires an active floor session; from the dev village arena
      // there is none, so guard it (a rejected requestFloor would strand us on
      // the loading screen). In a real dungeon you're always connected.
      if (useGame.getState().phase === "dungeon") {
        void useGame.getState().descend();
      } else {
        gameEvents.emit("message", "Warp rune — enter a real dungeon to test the descent");
      }
    }
  });

  return (
    <group position={pos}>
      {/* Jagged violet fracture, two offset rings so the edge never reads round. */}
      <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0.3]}>
        <ringGeometry args={[0.5, 0.95, 5]} />
        <meshStandardMaterial
          ref={disc}
          color="#0c0616"
          emissive="#b46bff"
          emissiveIntensity={1.2}
          toneMapped={false}
          side={2}
        />
      </mesh>
      <mesh position={[0, 0.025, 0]} rotation={[-Math.PI / 2, 0, 1.4]}>
        <ringGeometry args={[0.62, 0.8, 6]} />
        <meshStandardMaterial
          color="#0c0616"
          emissive="#7a3dcc"
          emissiveIntensity={0.7}
          toneMapped={false}
          transparent
          opacity={0.8}
          side={2}
        />
      </mesh>
      {/* Grit hanging over the crack, slowly circling. */}
      <group ref={shards}>
        {[0, 1, 2].map((i) => {
          const a = (i / 3) * Math.PI * 2;
          return (
            <mesh
              key={i}
              position={[Math.cos(a) * 0.6, 0.24 + i * 0.1, Math.sin(a) * 0.6]}
              rotation={[a, a * 1.3, 0]}
              scale={0.07 + (i % 2) * 0.03}
            >
              <tetrahedronGeometry args={[1, 0]} />
              <meshStandardMaterial color="#100c18" emissive="#b46bff" emissiveIntensity={0.8} flatShading />
            </mesh>
          );
        })}
      </group>
    </group>
  );
}
