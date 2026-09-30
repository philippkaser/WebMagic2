import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { Group, Mesh, OctahedronGeometry, PlaneGeometry, TorusGeometry, Vector3 } from "three";
import { spawnBurst } from "../../fx/Particles";
import { getItemDef } from "../../items/catalog";
import { RARITIES } from "../../items/rarity";
import type { ItemInstance } from "../../items/types";
import { additive, glow } from "./kit";
import { ItemModel } from "./ItemModel";
import { getFxTexture } from "./modelTextures";

/** A dropped item: its miniature floating and turning above the floor, with
 * a rarity treatment that escalates so good loot reads across a room —
 * common: a pool of its own light; rare: + a halo; epic: + a turning rune
 * sigil on the floor; legendary: + a pillar of light and orbiting sparks.
 * `groundY` is the floor height relative to the model's origin. */

const G = {
  pool: new PlaneGeometry(1.4, 1.4),
  sigil: new PlaneGeometry(2, 2),
  halo: new TorusGeometry(0.55, 0.02, 3, 20),
  beam: new PlaneGeometry(0.6, 7),
  spark: new OctahedronGeometry(0.035),
};

const beamPos = new Vector3();
/** Floor loot is shown larger than life so it reads across a room. */
const ITEM_SCALE = 1.5;

export function LootModel({ item, groundY, float = 0.45 }: { item: ItemInstance; groundY: number; float?: number }) {
  const floater = useRef<Group>(null);
  const halo = useRef<Mesh>(null);
  const sigil = useRef<Mesh>(null);
  const beam = useRef<Mesh>(null);
  const sparks = useRef<Group>(null);
  const sparkClock = useRef(0);
  const phase = useRef(Math.random() * 10);
  const color = getItemDef(item.defId).color;
  const rarity = RARITIES[item.rarity].color;
  const tier = item.rarity === "legendary" ? 3 : item.rarity === "epic" ? 2 : item.rarity === "rare" ? 1 : 0;

  useFrame(({ clock, camera }, dt) => {
    const t = clock.elapsedTime + phase.current;
    const f = floater.current;
    if (f) {
      f.position.y = float + Math.sin(t * 2.2) * 0.08;
      f.rotation.y = t * 1.3;
    }
    if (halo.current) {
      halo.current.position.y = float + Math.sin(t * 2.2 - 0.6) * 0.08;
      halo.current.rotation.set(Math.PI / 2 + Math.sin(t * 0.9) * 0.25, 0, Math.cos(t * 0.7) * 0.25);
    }
    if (sigil.current) sigil.current.rotation.z = t * 0.35;
    if (sparks.current) sparks.current.rotation.y = -t * 2.1;
    if (beam.current) {
      // Y-billboard: the pillar always shows its bright face.
      const b = beam.current;
      b.getWorldPosition(beamPos);
      b.rotation.y = Math.atan2(camera.position.x - beamPos.x, camera.position.z - beamPos.z);
      sparkClock.current -= dt;
      if (sparkClock.current <= 0) {
        sparkClock.current = 0.18;
        spawnBurst({
          position: [beamPos.x + (Math.random() - 0.5) * 0.4, beamPos.y - 3.4, beamPos.z + (Math.random() - 0.5) * 0.4],
          count: 1,
          color: [rarity, "#fff3c0"],
          speed: 0.2,
          upward: 1.6,
          ttl: 1.4,
          size: 0.05,
          gravity: 0.4,
          drag: 0.3,
        });
      }
    }
  });

  return (
    <group>
      <group ref={floater} scale={ITEM_SCALE}>
        <ItemModel defId={item.defId} />
      </group>
      {/* Pool of the item's own light on the floor */}
      <mesh geometry={G.pool} material={additive(color, 0.55, getFxTexture("radial"))} position={[0, groundY + 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]} />
      {tier >= 1 && <mesh ref={halo} geometry={G.halo} material={glow(rarity, 2.2)} />}
      {tier >= 2 && (
        <mesh
          ref={sigil}
          geometry={G.sigil}
          material={additive(rarity, 0.8, getFxTexture("runeRing"))}
          position={[0, groundY + 0.04, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
        />
      )}
      {tier >= 3 && (
        <>
          <mesh ref={beam} geometry={G.beam} material={additive(rarity, 1, getFxTexture("beam"))} position={[0, groundY + 3.5, 0]} />
          <group ref={sparks} position={[0, float, 0]}>
            {[0, 1, 2].map((i) => (
              <mesh
                key={i}
                geometry={G.spark}
                material={glow("#fff3c0", 3)}
                position={[Math.cos((i / 3) * Math.PI * 2) * 0.55, (i - 1) * 0.15, Math.sin((i / 3) * Math.PI * 2) * 0.55]}
              />
            ))}
          </group>
        </>
      )}
    </group>
  );
}
