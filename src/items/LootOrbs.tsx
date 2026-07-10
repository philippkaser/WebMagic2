import { useFrame } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import { Group } from "three";
import { spawnBurst } from "../fx/Particles";
import { offerInteraction } from "../game/interactions";
import { playerPosition } from "../game/player-state";
import { getItemDef } from "./catalog";
import { useGame } from "../state/gameStore";
import type { Vec3 } from "../world/types";

/** Dropped-loot manager: enemies and props call spawnLootOrb(); orbs hover in
 * place and are picked up with E (equipping swaps the current slot item). */

interface Orb {
  id: number;
  defId: string;
  position: Vec3;
}

let nextOrbId = 1;
let pushOrb: ((orb: Orb) => void) | null = null;

export function spawnLootOrb(position: Vec3, defId: string): void {
  pushOrb?.({ id: nextOrbId++, defId, position });
}

export function LootOrbs() {
  const [orbs, setOrbs] = useState<Orb[]>([]);
  const floorSeed = useGame((s) => s.floorSeed);

  useEffect(() => {
    pushOrb = (orb) => setOrbs((prev) => [...prev, orb]);
    return () => {
      pushOrb = null;
    };
  }, []);

  // Loot left behind vanishes when the floor changes.
  useEffect(() => setOrbs([]), [floorSeed]);

  const remove = (id: number) => setOrbs((prev) => prev.filter((o) => o.id !== id));

  return (
    <>
      {orbs.map((orb) => (
        <LootOrb key={orb.id} orb={orb} onTaken={() => remove(orb.id)} />
      ))}
    </>
  );
}

function LootOrb({ orb, onTaken }: { orb: Orb; onTaken: () => void }) {
  const group = useRef<Group>(null);
  const def = getItemDef(orb.defId);
  const [x, y, z] = orb.position;

  useFrame(({ clock }) => {
    const g = group.current;
    if (!g) return;
    const t = clock.elapsedTime;
    g.position.set(x, y + 0.35 + Math.sin(t * 2.4 + orb.id) * 0.12, z);
    g.rotation.y = t * 1.6;

    const d2 = playerPosition.distanceToSquared(g.position);
    if (d2 < 5.5) {
      offerInteraction(`E — Take ${def.name}  (${def.desc})`, d2, () => {
        useGame.getState().equipItem(def.id);
        spawnBurst({
          position: [x, y + 0.5, z],
          count: 18,
          color: [def.color, "#ffffff"],
          speed: 3.5,
          ttl: 0.6,
          size: 0.07,
          gravity: -2,
        });
        onTaken();
      });
    }
  });

  // No pointLight here on purpose: orbs spawn mid-combat, and mounting a new
  // light forces a scene-wide shader recompile (frame spike). Emissive + bloom
  // reads just as well.
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
