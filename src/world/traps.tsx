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

/** Fangs of bone hidden in a split of the floor. They lie flush until
 * something crosses them, then stab up out of the crack — a maw biting shut —
 * before sinking back to re-arm. No flat disc: the shape is the teeth and the
 * broken slab they push through. */
function SpikeTrap({ pos, floor }: { pos: Vec3; floor: number }) {
  const def = getTrapDef("spike");
  const teeth = useRef<Group>(null);
  const armTimer = useRef(0);
  const pop = useRef(0);
  const scale = useMemo(() => floorScale(floor), [floor]);
  const r2 = def.radius * def.radius;

  // A ragged double row of fangs of varied length/lean, seeded once.
  const fangs = useMemo(() => {
    const out: { x: number; z: number; h: number; lean: number; tilt: number; twist: number }[] = [];
    for (let i = 0; i < 9; i++) {
      const row = i < 5 ? -0.14 : 0.14;
      const along = ((i % 5) - 2) * 0.19;
      out.push({
        x: along + (i % 2) * 0.05,
        z: row + (i % 3) * 0.03,
        h: 0.34 + ((i * 37) % 5) * 0.06,
        lean: ((i % 3) - 1) * 0.25,
        tilt: ((i % 2) - 0.5) * 0.3,
        twist: (i * 1.3) % Math.PI,
      });
    }
    return out;
  }, []);

  useFrame((_, dt) => {
    armTimer.current -= dt;
    pop.current = Math.max(0, pop.current - dt * 3);
    if (teeth.current) teeth.current.position.y = -0.42 + pop.current * 0.5;
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
        position: [pos[0], pos[1] + 0.25, pos[2]],
        count: 12,
        color: ["#c8b898", "#a02020", "#3a2418"],
        speed: 3.5,
        upward: 1.4,
        ttl: 0.45,
        size: 0.06,
      });
    }
  });

  return (
    <group position={pos}>
      {/* Broken slabs shoved aside where the crack opened — angular rubble,
          not a ring. */}
      {[0, 1, 2, 3].map((i) => {
        const a = (i / 4) * Math.PI * 2 + 0.4;
        return (
          <mesh
            key={i}
            position={[Math.cos(a) * 0.42, 0.04, Math.sin(a) * 0.42]}
            rotation={[(i % 2) * 0.3 - 0.15, a, 0.12]}
            receiveShadow
          >
            <boxGeometry args={[0.4, 0.08, 0.3]} />
            <meshStandardMaterial color="#2c2630" roughness={0.95} flatShading />
          </mesh>
        );
      })}
      {/* The dark gap the fangs rise from. */}
      <mesh position={[0, 0.015, 0]} rotation={[-Math.PI / 2, 0, 0.3]}>
        <planeGeometry args={[0.7, 0.5]} />
        <meshStandardMaterial color="#050307" roughness={1} />
      </mesh>
      {/* The fangs, hidden below until they strike. */}
      <group ref={teeth} position={[0, -0.42, 0]}>
        {fangs.map((f, i) => (
          <mesh
            key={i}
            position={[f.x, f.h * 0.5, f.z]}
            rotation={[f.tilt, f.twist, f.lean]}
            castShadow
          >
            <coneGeometry args={[0.07, f.h, 4]} />
            <meshStandardMaterial color="#b8a888" roughness={0.7} flatShading />
          </mesh>
        ))}
      </group>
    </group>
  );
}

/** A wound in the floor that swallows whoever steps on it and spits them out a
 * floor below. Not a painted rune — a jagged violet gash of crossed slabs
 * pulled apart, glowing from the depth between, with grit hanging in the pull. */
function WarpTrap({ pos }: { pos: Vec3 }) {
  const def = getTrapDef("warp");
  const glowMat = useRef<MeshStandardMaterial>(null);
  const grit = useRef<Group>(null);
  const triggered = useRef(false);
  const r2 = def.radius * def.radius;

  useFrame(({ clock }, dt) => {
    if (glowMat.current)
      glowMat.current.emissiveIntensity = 1.3 + Math.sin(clock.elapsedTime * 3) * 0.6;
    if (grit.current) {
      grit.current.rotation.y += dt * 0.7;
      grit.current.position.y = 0.3 + Math.sin(clock.elapsedTime * 1.5) * 0.05;
    }
    if (!combatActive() || triggered.current) return;
    const dx = playerPosition.x - pos[0];
    const dz = playerPosition.z - pos[2];
    if (dx * dx + dz * dz < r2) {
      triggered.current = true;
      spawnBurst({
        position: [pos[0], pos[1] + 0.6, pos[2]],
        count: 24,
        color: ["#b46bff", "#e2ccff", "#ffffff"],
        speed: 5,
        upward: 2,
        ttl: 0.7,
        size: 0.08,
      });
      flashLight([pos[0], pos[1] + 0.6, pos[2]], "#b46bff", 22);
      playPortal();
      // descend() needs an active floor session; from the dev village arena
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
      {/* The glow from the depths, seen through the gap between the slabs. */}
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.62, 6]} />
        <meshStandardMaterial
          ref={glowMat}
          color="#0c0616"
          emissive="#b46bff"
          emissiveIntensity={1.3}
          toneMapped={false}
        />
      </mesh>
      {/* Slabs of floor heaved apart, forming a jagged four-pointed gash. */}
      {[0, 1, 2, 3, 4, 5].map((i) => {
        const a = (i / 6) * Math.PI * 2;
        const len = 0.5 + (i % 3) * 0.16;
        return (
          <mesh
            key={i}
            position={[Math.cos(a) * (0.5 + len * 0.4), 0.06 + (i % 2) * 0.04, Math.sin(a) * (0.5 + len * 0.4)]}
            rotation={[(i % 2) * 0.4 - 0.2, -a, 0.18 + (i % 3) * 0.1]}
            castShadow
          >
            <boxGeometry args={[len, 0.12, 0.26]} />
            <meshStandardMaterial color="#241e2a" roughness={0.95} flatShading />
          </mesh>
        );
      })}
      {/* Grit torn off the edges, circling the pull. */}
      <group ref={grit} position={[0, 0.3, 0]}>
        {[0, 1, 2, 3].map((i) => {
          const a = (i / 4) * Math.PI * 2;
          return (
            <mesh
              key={i}
              position={[Math.cos(a) * 0.55, (i % 2) * 0.12, Math.sin(a) * 0.55]}
              rotation={[a, a * 1.3, a * 0.6]}
              scale={0.06 + (i % 2) * 0.03}
            >
              <tetrahedronGeometry args={[1, 0]} />
              <meshStandardMaterial color="#100c18" emissive="#b46bff" emissiveIntensity={0.9} flatShading />
            </mesh>
          );
        })}
      </group>
    </group>
  );
}
