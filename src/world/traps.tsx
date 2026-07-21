import { useFrame } from "@react-three/fiber";
import { useRapier } from "@react-three/rapier";
import { useMemo, useRef } from "react";
import { Group, MeshStandardMaterial, Vector3 } from "three";
import { playHit, playPortal } from "../audio/sound";
import { enemyCast } from "../combat/remoteEffects";
import { floorScale } from "../core/config";
import { gameEvents } from "../core/events";
import { flashLight } from "../fx/DynamicLights";
import { spawnBurst } from "../fx/Particles";
import { playerPosition } from "../game/player-state";
import { nearestWizardTo } from "../game/targets";
import { isHost } from "../net/netStore";
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
      playHit();
      spawnBurst({
        position: [pos[0], pos[1] + 0.15, pos[2]],
        count: 10,
        color: ["#c8ccd4", "#ff6a6a"],
        speed: 3,
        ttl: 0.4,
        size: 0.06,
      });
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
 * with clear line of sight. Host-authoritative like the sentry's shot. */
function DartTrap({ pos, floor }: { pos: Vec3; floor: number }) {
  const def = getTrapDef("dart");
  const scale = useMemo(() => floorScale(floor), [floor]);
  const fireTimer = useRef(1 + Math.random() * 1.5);
  const { world, rapier } = useRapier();
  const losRay = useMemo(() => new rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }), [rapier]);
  const aim = useMemo(() => new Vector3(), []);

  useFrame((_, dt) => {
    if (!combatActive() || !isHost()) return;
    fireTimer.current -= dt;
    if (fireTimer.current > 0) return;
    const head = { x: pos[0], y: pos[1] + 0.6, z: pos[2] };
    const target = nearestWizardTo(head.x, head.y, head.z);
    if (target.dist > def.radius) return;
    aim.set(target.pos.x - head.x, target.pos.y - head.y, target.pos.z - head.z).normalize();
    losRay.origin.x = head.x;
    losRay.origin.y = head.y;
    losRay.origin.z = head.z;
    losRay.dir.x = aim.x;
    losRay.dir.y = aim.y;
    losRay.dir.z = aim.z;
    // maxToi stops 0.6 short of the target, so the wizard's own collider never
    // counts as "blocked" — only walls/props between do.
    if (world.castRay(losRay, target.dist - 0.6, true) !== null) return;
    fireTimer.current = 1.6;
    const speed = 26;
    aim.multiplyScalar(speed);
    enemyCast.announce({
      origin: [head.x + (aim.x / speed) * 0.5, head.y, head.z + (aim.z / speed) * 0.5],
      velocity: [aim.x, aim.y, aim.z],
      damage: def.baseDamage * scale.enemyDamage,
      color: "#ffd24a",
      size: 0.1,
      blastRadius: 0,
      blastImpulse: 0,
    });
    flashLight([head.x, head.y, head.z], "#ffd24a", 8);
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
