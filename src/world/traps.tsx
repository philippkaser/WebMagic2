import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, useState } from "react";
import { Group, MeshStandardMaterial } from "three";
import { playHit, playPortal } from "../audio/sound";
import { floorScale } from "../core/config";
import { gameEvents } from "../core/events";
import { flashLight } from "../fx/DynamicLights";
import { castFlareFx, spikeFx, warpFx } from "../fx/effects";
import { browserSim } from "../game/browserSim";
import { playerPosition } from "../game/player-state";
import { isHost } from "../net/netStore";
import { DART, DartTrapController } from "../sim/traps";
import { combatActive, useGame } from "../state/gameStore";
import { getTrapDef } from "./trapCatalog";
import type { TrapKind, Vec3 } from "./types";

/** Dungeon traps. Behaviour lives here, tuning in trapCatalog.ts. Player
 * effects are LOCAL on each client (your health/position are yours — same
 * model as enemy contact damage), so spikes and warps need no networking; the
 * dart's projectile is a host-authoritative event replayed everywhere, so
 * exactly one bolt is fired no matter how many wizards share the floor.
 *
 * Guarded by combatActive(): live in the dungeon, and — dev builds only — in
 * the village dev arena. */
export function Trap({ kind, pos, floor }: { kind: TrapKind; pos: Vec3; floor: number }) {
  switch (kind) {
    case "spike":
      return <SpikeTrap pos={pos} floor={floor} />;
    case "dart":
      return <DartTrap pos={pos} floor={floor} />;
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

/** Flush floor plate; spikes hide below and stab up when something steps on
 * them, then retract and re-arm. */
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
      playHit(pos);
      spikeFx(pos);
    }
  });

  return (
    <group position={pos}>
      {/* Nearly-flush plate — easy to miss until it bites. */}
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[def.radius, 14]} />
        <meshStandardMaterial color="#20242c" roughness={0.9} metalness={0.35} />
      </mesh>
      <group ref={spikes} position={[0, -0.3, 0]}>
        {SPIKE_OFFSETS.map(([x, z], i) => (
          <mesh key={i} position={[x, 0.2, z]} castShadow>
            <coneGeometry args={[0.06, 0.42, 4]} />
            <meshStandardMaterial color="#9aa0a8" metalness={0.7} roughness={0.3} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

/** Wall emitter that fires a fast straight bolt at the nearest wizard in range
 * with clear line of sight. Its clock and aim are the sim's
 * (sim/traps.ts) and run on the floor's authority only, like the sentry. */
function DartTrap({ pos, floor }: { pos: Vec3; floor: number }) {
  const [dart] = useState(() => new DartTrapController(browserSim, pos, floor));

  useFrame((_, dt) => {
    if (!combatActive() || !isHost()) return;
    const aim = dart.think(dt);
    if (!aim) return;
    // Muzzle flash on the emitter's face, down the line of fire.
    const head = { x: pos[0], y: pos[1] + DART.headHeight, z: pos[2] };
    castFlareFx([head.x + aim.x * 0.45, head.y, head.z + aim.z * 0.45], aim, DART.color, undefined, 1.6);
    flashLight([head.x, head.y, head.z], DART.color, 8);
  });

  return (
    <group position={pos}>
      <mesh position={[0, 0.6, 0]} castShadow>
        <boxGeometry args={[0.42, 0.42, 0.24]} />
        <meshStandardMaterial color="#2a2630" roughness={0.8} metalness={0.25} />
      </mesh>
      <mesh position={[0, 0.6, 0.13]}>
        <circleGeometry args={[0.09, 10]} />
        <meshStandardMaterial color="#100800" emissive="#ffd24a" emissiveIntensity={2.4} toneMapped={false} />
      </mesh>
    </group>
  );
}

/** Floor sigil that flings whoever steps on it down to the next floor. Local
 * and one-shot — each wizard triggers their own descent. */
function WarpTrap({ pos }: { pos: Vec3 }) {
  const def = getTrapDef("warp");
  const disc = useRef<MeshStandardMaterial>(null);
  const triggered = useRef(false);
  const r2 = def.radius * def.radius;

  useFrame(({ clock }) => {
    if (disc.current) disc.current.emissiveIntensity = 1.2 + Math.sin(clock.elapsedTime * 3) * 0.5;
    if (!combatActive() || triggered.current) return;
    const dx = playerPosition.x - pos[0];
    const dz = playerPosition.z - pos[2];
    if (dx * dx + dz * dz < r2) {
      triggered.current = true;
      warpFx(pos, "#b46bff");
      flashLight([pos[0], pos[1] + 0.6, pos[2]], "#b46bff", 20);
      playPortal(pos);
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
      <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.5, 0.95, 22]} />
        <meshStandardMaterial
          ref={disc}
          color="#0c0616"
          emissive="#b46bff"
          emissiveIntensity={1.2}
          toneMapped={false}
          side={2}
        />
      </mesh>
    </group>
  );
}
